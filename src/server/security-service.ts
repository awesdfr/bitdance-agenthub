import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'
import path from 'node:path'

import { and, desc, eq } from 'drizzle-orm'

import { db, schema } from '@/db/client'
import type {
  AuditActionStatus,
  AuditActorType,
  AuditLogRow,
  CredentialResourceType,
  CredentialScopeRow,
  JsonObject,
  RiskLevel,
  SandboxNetworkMode,
  SandboxPolicyRow,
  SecretKind,
  SecretVaultRow,
  SecurityFindingAction,
  SecurityFindingRow,
  SecurityFindingSeverity,
} from '@/db/schema'
import {
  newAuditLogId,
  newCredentialScopeId,
  newSandboxPolicyId,
  newSecretId,
  newSecurityFindingId,
} from '@/server/ids'

export interface CreateSecretArgs {
  name: string
  kind?: SecretKind
  valueRef?: string
  encryptedValue?: string
}

export async function createSecret(args: CreateSecretArgs): Promise<SecretVaultRow> {
  const now = Date.now()
  const kind = args.kind ?? (args.encryptedValue ? 'encrypted_value' : 'env_ref')
  const sealed =
    kind === 'encrypted_value'
      ? encryptSecretValue(args.encryptedValue ?? '')
      : { valueRef: normalizeRequired(args.valueRef, 'valueRef'), nonce: null }
  const row: SecretVaultRow = {
    id: newSecretId(),
    name: normalizeRequired(args.name, 'name'),
    kind,
    valueRef: sealed.valueRef,
    nonce: sealed.nonce,
    redactedPreview:
      kind === 'env_ref' ? `env:${sealed.valueRef}` : redactSecretPreview(args.encryptedValue ?? ''),
    status: 'active',
    createdAt: now,
    updatedAt: now,
    lastUsedAt: null,
  }
  await db.insert(schema.secretVault).values(row)
  await recordAuditLog({
    actorType: 'system',
    action: 'secret.create',
    resourceType: 'secret_vault',
    resourceId: row.id,
    riskLevel: 'medium',
    message: `Secret ${row.name} registered as ${row.kind}.`,
  })
  return row
}

export async function listSecrets(): Promise<SecretVaultRow[]> {
  return db.query.secretVault.findMany({ orderBy: [desc(schema.secretVault.createdAt)] })
}

export async function resolveSecretValue(secretId: string): Promise<string | null> {
  const secret = await getRequiredSecret(secretId)
  if (secret.status !== 'active') throw new Error(`Secret is ${secret.status}: ${secretId}`)
  const value =
    secret.kind === 'env_ref'
      ? process.env[secret.valueRef] ?? null
      : decryptSecretValue(secret.valueRef, secret.nonce)
  await db
    .update(schema.secretVault)
    .set({ lastUsedAt: Date.now(), updatedAt: Date.now() })
    .where(eq(schema.secretVault.id, secretId))
  await recordAuditLog({
    actorType: 'system',
    action: 'secret.resolve',
    resourceType: 'secret_vault',
    resourceId: secretId,
    riskLevel: 'medium',
    message: `Secret ${secret.name} was resolved for internal use.`,
    metadata: { kind: secret.kind, valuePresent: Boolean(value) },
  })
  return value
}

export interface CreateCredentialScopeArgs {
  secretId: string
  resourceType: CredentialResourceType
  resourceId: string
  capability?: string
}

export interface CredentialScopeCheckArgs {
  secretId: string
  resourceType: CredentialResourceType
  resourceId: string
  capability?: string
}

export interface CredentialScopeCheckResult {
  allowed: boolean
  reason: string
  credentialScopeId: string | null
  capability: string
}

export async function createCredentialScope(
  args: CreateCredentialScopeArgs,
): Promise<CredentialScopeRow> {
  await getRequiredSecret(args.secretId)
  const row: CredentialScopeRow = {
    id: newCredentialScopeId(),
    secretId: args.secretId,
    resourceType: args.resourceType,
    resourceId: normalizeRequired(args.resourceId, 'resourceId'),
    capability: args.capability?.trim() || 'use',
    createdAt: Date.now(),
  }
  await db.insert(schema.credentialScopes).values(row)
  await recordAuditLog({
    actorType: 'system',
    action: 'credential_scope.create',
    resourceType: row.resourceType,
    resourceId: row.resourceId,
    riskLevel: 'medium',
    message: `Credential scope ${row.capability} was granted.`,
    metadata: { secretId: row.secretId, credentialScopeId: row.id },
  })
  return row
}

export async function listCredentialScopes(): Promise<CredentialScopeRow[]> {
  return db.query.credentialScopes.findMany({
    orderBy: [desc(schema.credentialScopes.createdAt)],
  })
}

export async function checkCredentialScope(
  args: CredentialScopeCheckArgs,
): Promise<CredentialScopeCheckResult> {
  const capability = args.capability?.trim() || 'use'
  const scopes = await db.query.credentialScopes.findMany({
    where: eq(schema.credentialScopes.secretId, args.secretId),
  })
  const matched = scopes.find((scope) =>
    scopeMatches(scope, {
      resourceType: args.resourceType,
      resourceId: args.resourceId,
      capability,
    }),
  )
  const result: CredentialScopeCheckResult = matched
    ? {
        allowed: true,
        reason: `Credential scope ${matched.id} permits ${capability} on ${args.resourceType}:${args.resourceId}.`,
        credentialScopeId: matched.id,
        capability,
      }
    : {
        allowed: false,
        reason: `Secret ${args.secretId} is not scoped for ${capability} on ${args.resourceType}:${args.resourceId}.`,
        credentialScopeId: null,
        capability,
      }
  await recordAuditLog({
    actorType: 'system',
    action: 'credential_scope.check',
    resourceType: args.resourceType,
    resourceId: args.resourceId,
    status: result.allowed ? 'allowed' : 'blocked',
    riskLevel: result.allowed ? 'medium' : 'high',
    message: result.reason,
    metadata: {
      secretId: args.secretId,
      credentialScopeId: result.credentialScopeId,
      capability,
    },
  })
  return result
}

export async function assertCredentialScope(
  args: CredentialScopeCheckArgs,
): Promise<CredentialScopeCheckResult> {
  const result = await checkCredentialScope(args)
  if (!result.allowed) throw new Error(result.reason)
  return result
}

export async function resolveScopedSecretValue(
  secretId: string,
  args: Omit<CredentialScopeCheckArgs, 'secretId'>,
): Promise<{ value: string | null; scope: CredentialScopeCheckResult }> {
  const scope = await assertCredentialScope({ secretId, ...args })
  return { value: await resolveSecretValue(secretId), scope }
}

export interface CreateSandboxPolicyArgs {
  name: string
  level?: SandboxPolicyRow['level']
  allowedPaths?: string[]
  deniedPaths?: string[]
  allowedCommands?: string[]
  networkMode?: SandboxNetworkMode
  requiresApprovalForWrites?: boolean
}

export async function createSandboxPolicy(args: CreateSandboxPolicyArgs): Promise<SandboxPolicyRow> {
  const now = Date.now()
  const row: SandboxPolicyRow = {
    id: newSandboxPolicyId(),
    name: normalizeRequired(args.name, 'name'),
    level: args.level ?? 'strict',
    allowedPaths: normalizeStringArray(args.allowedPaths),
    deniedPaths: normalizeStringArray(args.deniedPaths),
    allowedCommands: normalizeStringArray(args.allowedCommands),
    networkMode: args.networkMode ?? 'model_only',
    requiresApprovalForWrites: args.requiresApprovalForWrites ?? true,
    createdAt: now,
    updatedAt: now,
  }
  await db.insert(schema.sandboxPolicies).values(row)
  await recordAuditLog({
    actorType: 'system',
    action: 'sandbox_policy.create',
    resourceType: 'sandbox_policy',
    resourceId: row.id,
    riskLevel: row.level === 'trusted' ? 'high' : 'low',
    message: `Sandbox policy ${row.name} was created.`,
    metadata: { level: row.level, networkMode: row.networkMode },
  })
  return row
}

export async function listSandboxPolicies(): Promise<SandboxPolicyRow[]> {
  return db.query.sandboxPolicies.findMany({
    orderBy: [desc(schema.sandboxPolicies.createdAt)],
  })
}

export interface SandboxAccessArgs {
  sandboxPolicyId: string
  action: 'read_file' | 'write_file' | 'run_command' | 'network'
  targetPath?: string | null
  command?: string | null
}

export interface SandboxAccessDecision {
  status: AuditActionStatus
  reason: string
  requiresApproval: boolean
}

export async function evaluateSandboxAccess(
  args: SandboxAccessArgs,
): Promise<SandboxAccessDecision> {
  const policy = await getRequiredSandboxPolicy(args.sandboxPolicyId)
  const decision = decideSandboxAccess(policy, args)
  await recordAuditLog({
    actorType: 'system',
    action: `sandbox.evaluate.${args.action}`,
    resourceType: 'sandbox_policy',
    resourceId: policy.id,
    status: decision.status,
    riskLevel: decision.status === 'blocked' ? 'high' : 'low',
    message: decision.reason,
    metadata: {
      action: args.action,
      targetPath: args.targetPath ?? null,
      command: args.command ?? null,
      requiresApproval: decision.requiresApproval,
    },
  })
  return decision
}

export interface RecordAuditLogArgs {
  actorType: AuditActorType
  actorId?: string | null
  action: string
  resourceType: string
  resourceId?: string | null
  status?: AuditActionStatus
  riskLevel?: RiskLevel
  message?: string
  metadata?: JsonObject
}

export async function recordAuditLog(args: RecordAuditLogArgs): Promise<AuditLogRow> {
  const row: AuditLogRow = {
    id: newAuditLogId(),
    actorType: args.actorType,
    actorId: normalizeNullable(args.actorId),
    action: normalizeRequired(args.action, 'action'),
    resourceType: normalizeRequired(args.resourceType, 'resourceType'),
    resourceId: normalizeNullable(args.resourceId),
    status: args.status ?? 'allowed',
    riskLevel: args.riskLevel ?? 'low',
    message: args.message?.trim() ?? '',
    metadata: args.metadata ?? {},
    createdAt: Date.now(),
  }
  await db.insert(schema.auditLogs).values(row)
  return row
}

export async function listAuditLogs(limit = 100): Promise<AuditLogRow[]> {
  return db.query.auditLogs.findMany({
    orderBy: [desc(schema.auditLogs.createdAt)],
    limit: Math.min(Math.max(limit, 1), 500),
  })
}

export async function listAuditLogsForResource(
  resourceType: string,
  resourceId: string,
): Promise<AuditLogRow[]> {
  return db.query.auditLogs.findMany({
    where: and(
      eq(schema.auditLogs.resourceType, resourceType),
      eq(schema.auditLogs.resourceId, resourceId),
    ),
    orderBy: [desc(schema.auditLogs.createdAt)],
  })
}

export interface CreateSecurityFindingArgs {
  sourceType: string
  sourceId?: string | null
  category: string
  severity?: SecurityFindingSeverity
  action?: SecurityFindingAction
  message: string
  evidence?: string
}

export async function createSecurityFinding(
  args: CreateSecurityFindingArgs,
): Promise<SecurityFindingRow> {
  const row: SecurityFindingRow = {
    id: newSecurityFindingId(),
    sourceType: normalizeRequired(args.sourceType, 'sourceType'),
    sourceId: normalizeNullable(args.sourceId),
    category: normalizeRequired(args.category, 'category'),
    severity: args.severity ?? 'medium',
    action: args.action ?? 'log',
    message: normalizeRequired(args.message, 'message'),
    evidence: args.evidence?.slice(0, 500) ?? '',
    createdAt: Date.now(),
    resolvedAt: null,
  }
  await db.insert(schema.securityFindings).values(row)
  await recordAuditLog({
    actorType: 'system',
    action: 'security_finding.create',
    resourceType: row.sourceType,
    resourceId: row.sourceId,
    status: row.action === 'block' ? 'blocked' : 'warning',
    riskLevel: findingRiskLevel(row.severity),
    message: row.message,
    metadata: { category: row.category, securityFindingId: row.id },
  })
  return row
}

export async function listSecurityFindings(limit = 100): Promise<SecurityFindingRow[]> {
  return db.query.securityFindings.findMany({
    orderBy: [desc(schema.securityFindings.createdAt)],
    limit: Math.min(Math.max(limit, 1), 500),
  })
}

export async function scanExternalTextForPromptInjection(args: {
  text: string
  sourceType: string
  sourceId?: string | null
}): Promise<SecurityFindingRow | null> {
  const match = PROMPT_INJECTION_PATTERNS.find((pattern) => pattern.test(args.text))
  if (!match) return null
  return createSecurityFinding({
    sourceType: args.sourceType,
    sourceId: args.sourceId,
    category: 'prompt_injection',
    severity: 'high',
    action: 'require_approval',
    message: 'External text contains prompt-injection-like instructions.',
    evidence: args.text,
  })
}

export async function filterPotentialSecretOutput(args: {
  text: string
  sourceType: string
  sourceId?: string | null
}): Promise<{ text: string; finding: SecurityFindingRow | null }> {
  const redacted = args.text.replace(SECRET_LIKE_PATTERN, '$1[REDACTED]')
  if (redacted === args.text) return { text: args.text, finding: null }
  const finding = await createSecurityFinding({
    sourceType: args.sourceType,
    sourceId: args.sourceId,
    category: 'secret_output',
    severity: 'high',
    action: 'redact',
    message: 'Output contained secret-like material and was redacted.',
    evidence: args.text,
  })
  return { text: redacted, finding }
}

async function getRequiredSecret(id: string): Promise<SecretVaultRow> {
  const row = await db.query.secretVault.findFirst({ where: eq(schema.secretVault.id, id) })
  if (!row) throw new Error(`Secret not found: ${id}`)
  return row
}

async function getRequiredSandboxPolicy(id: string): Promise<SandboxPolicyRow> {
  const row = await db.query.sandboxPolicies.findFirst({
    where: eq(schema.sandboxPolicies.id, id),
  })
  if (!row) throw new Error(`Sandbox policy not found: ${id}`)
  return row
}

function decideSandboxAccess(
  policy: SandboxPolicyRow,
  args: SandboxAccessArgs,
): SandboxAccessDecision {
  if (args.action === 'network') {
    if (policy.networkMode === 'none') {
      return { status: 'blocked', reason: 'Sandbox policy blocks network access.', requiresApproval: false }
    }
    return { status: 'allowed', reason: `Network mode is ${policy.networkMode}.`, requiresApproval: false }
  }

  if (args.action === 'run_command') {
    const command = args.command?.trim() ?? ''
    if (!command) {
      return { status: 'blocked', reason: 'Command is required for sandbox evaluation.', requiresApproval: false }
    }
    if (policy.allowedCommands.length > 0 && !startsWithCommand(command, policy.allowedCommands)) {
      return { status: 'blocked', reason: 'Command is not in allowedCommands.', requiresApproval: false }
    }
    return { status: 'allowed', reason: 'Command is allowed by sandbox policy.', requiresApproval: false }
  }

  const targetPath = normalizePathForPolicy(args.targetPath ?? '')
  if (!targetPath) {
    return { status: 'blocked', reason: 'targetPath is required for file access.', requiresApproval: false }
  }
  if (startsWithAny(targetPath, policy.deniedPaths.map(normalizePathForPolicy))) {
    return { status: 'blocked', reason: 'Path is explicitly denied by sandbox policy.', requiresApproval: false }
  }
  if (policy.level !== 'trusted') {
    const allowed = startsWithAny(targetPath, policy.allowedPaths.map(normalizePathForPolicy))
    if (!allowed) {
      return { status: 'blocked', reason: 'Path is outside allowed sandbox paths.', requiresApproval: false }
    }
  }
  if (args.action === 'write_file' && policy.requiresApprovalForWrites) {
    return { status: 'warning', reason: 'Write is allowed but requires approval.', requiresApproval: true }
  }
  return { status: 'allowed', reason: 'File access is allowed by sandbox policy.', requiresApproval: false }
}

function encryptSecretValue(value: string): { valueRef: string; nonce: string } {
  const key = getVaultKey()
  const nonce = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, nonce)
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return {
    valueRef: Buffer.concat([encrypted, tag]).toString('base64'),
    nonce: nonce.toString('base64'),
  }
}

function decryptSecretValue(valueRef: string, nonce: string | null): string {
  if (!nonce) throw new Error('Encrypted secret is missing nonce.')
  const key = getVaultKey()
  const payload = Buffer.from(valueRef, 'base64')
  const encrypted = payload.subarray(0, -16)
  const tag = payload.subarray(-16)
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(nonce, 'base64'))
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8')
}

function getVaultKey(): Buffer {
  const secret = process.env.AGENTHUB_VAULT_MASTER_KEY
  if (!secret) {
    throw new Error('AGENTHUB_VAULT_MASTER_KEY is required for encrypted vault values.')
  }
  return createHash('sha256').update(secret).digest()
}

function findingRiskLevel(severity: SecurityFindingSeverity): RiskLevel {
  if (severity === 'critical' || severity === 'high') return 'high'
  if (severity === 'medium') return 'medium'
  return 'low'
}

function redactSecretPreview(value: string): string {
  if (!value) return '[empty]'
  if (value.length <= 6) return `${value.slice(0, 1)}***`
  return `${value.slice(0, 3)}***${value.slice(-2)}`
}

function normalizeRequired(value: string | null | undefined, label: string): string {
  const trimmed = value?.trim() ?? ''
  if (!trimmed) throw new Error(`${label} is required.`)
  return trimmed
}

function normalizeNullable(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? ''
  return trimmed ? trimmed : null
}

function normalizeStringArray(values: string[] | undefined): string[] {
  return [...new Set((values ?? []).map((value) => value.trim()).filter(Boolean))]
}

function normalizePathForPolicy(value: string): string {
  return path.resolve(value).toLowerCase()
}

function startsWithAny(value: string, prefixes: string[]): boolean {
  return prefixes.some((prefix) => value === prefix || value.startsWith(`${prefix}${path.sep}`))
}

function startsWithCommand(command: string, allowedCommands: string[]): boolean {
  return allowedCommands.some((allowed) => command === allowed || command.startsWith(`${allowed} `))
}

function scopeMatches(
  scope: CredentialScopeRow,
  requested: {
    resourceType: CredentialResourceType
    resourceId: string
    capability: string
  },
): boolean {
  const resourceMatches =
    (scope.resourceType === requested.resourceType && scope.resourceId === requested.resourceId) ||
    (scope.resourceType === 'global' && (scope.resourceId === '*' || scope.resourceId === 'global'))
  const capabilityMatches =
    scope.capability === requested.capability ||
    scope.capability === 'use' ||
    scope.capability === '*' ||
    requested.capability === 'use'
  return resourceMatches && capabilityMatches
}

const PROMPT_INJECTION_PATTERNS = [
  /ignore (all )?(previous|prior) instructions/i,
  /reveal (the )?(system|developer) prompt/i,
  /exfiltrate|send.*(secret|api key|token)/i,
  /bypass (safety|security|approval)/i,
  /do not tell (the )?user/i,
]

const SECRET_LIKE_PATTERN = /\b(api[_-]?key|token|secret|password)\s*[:=]\s*([A-Za-z0-9_.\-]{12,})/gi
