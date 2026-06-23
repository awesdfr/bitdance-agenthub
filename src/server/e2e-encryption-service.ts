import { and, desc, eq } from 'drizzle-orm'

import { db, schema } from '@/db/client'
import type {
  E2EEncryptionCheckRow,
  E2EEncryptionCheckScope,
  E2EEncryptionCheckStatus,
  E2EEncryptionPolicyRow,
  E2EEncryptionPolicyStatus,
  JsonObject,
  LocalIpcEncryption,
} from '@/db/schema'
import { newE2EEncryptionCheckId, newE2EEncryptionPolicyId } from '@/server/ids'
import { recordAuditLog } from '@/server/security-service'

export interface CreateE2EEncryptionPolicyArgs {
  name: string
  localIPC?: {
    encryption?: LocalIpcEncryption
  }
  remoteCommunication?: {
    encryption?: 'tls_1_3'
    certificatePinning?: boolean
    mutualTLS?: boolean
  }
  dataExport?: {
    encryptExport?: boolean
    passwordProtected?: boolean
  }
  notes?: string
  status?: E2EEncryptionPolicyStatus
}

export interface EvaluateE2EEncryptionArgs {
  policyId: string
  scope: E2EEncryptionCheckScope
  resourceType: string
  resourceId?: string | null
  observed?: JsonObject
}

export async function createE2EEncryptionPolicy(
  args: CreateE2EEncryptionPolicyArgs,
): Promise<E2EEncryptionPolicyRow> {
  const now = Date.now()
  const row: E2EEncryptionPolicyRow = {
    id: newE2EEncryptionPolicyId(),
    name: args.name.trim(),
    localIpcEncryption: args.localIPC?.encryption ?? 'none',
    remoteEncryption: args.remoteCommunication?.encryption ?? 'tls_1_3',
    certificatePinning: args.remoteCommunication?.certificatePinning ?? true,
    mutualTls: args.remoteCommunication?.mutualTLS ?? false,
    encryptExport: args.dataExport?.encryptExport ?? true,
    passwordProtected: args.dataExport?.passwordProtected ?? true,
    notes: args.notes?.trim() ?? '',
    status: args.status ?? 'active',
    createdAt: now,
    updatedAt: now,
  }
  await db.insert(schema.e2eEncryptionPolicies).values(row)
  await recordAuditLog({
    actorType: 'system',
    action: 'e2e_encryption.policy.create',
    resourceType: 'e2e_encryption_policy',
    resourceId: row.id,
    status: 'allowed',
    riskLevel: 'low',
    message: 'E2E encryption policy reserved for local/remote/export communication.',
    metadata: policySnapshot(row),
  })
  return row
}

export async function listE2EEncryptionPolicies(args: {
  status?: E2EEncryptionPolicyStatus
  limit?: number
} = {}): Promise<E2EEncryptionPolicyRow[]> {
  return db.query.e2eEncryptionPolicies.findMany({
    where: args.status ? eq(schema.e2eEncryptionPolicies.status, args.status) : undefined,
    orderBy: [desc(schema.e2eEncryptionPolicies.createdAt)],
    limit: Math.min(Math.max(args.limit ?? 50, 1), 200),
  })
}

export async function evaluateE2EEncryption(
  args: EvaluateE2EEncryptionArgs,
): Promise<E2EEncryptionCheckRow> {
  const policy = await getRequiredPolicy(args.policyId)
  const observed = args.observed ?? {}
  const findings = findingsForScope(policy, args.scope, observed)
  const status = statusForFindings(findings)
  const row: E2EEncryptionCheckRow = {
    id: newE2EEncryptionCheckId(),
    policyId: policy.id,
    scope: args.scope,
    resourceType: args.resourceType.trim(),
    resourceId: normalizeNullable(args.resourceId),
    status,
    findings,
    result: {
      policy: policySnapshot(policy),
      observed,
      dryRun: true,
      liveCertificateValidation: false,
      liveEncryptionMutation: false,
    },
    createdAt: Date.now(),
  }
  await db.insert(schema.e2eEncryptionChecks).values(row)
  await recordAuditLog({
    actorType: 'system',
    action: `e2e_encryption.check.${args.scope}`,
    resourceType: row.resourceType,
    resourceId: row.resourceId,
    status: status === 'blocked' ? 'blocked' : status === 'warning' ? 'warning' : 'allowed',
    riskLevel: status === 'blocked' ? 'high' : status === 'warning' ? 'medium' : 'low',
    message: findings.length ? findings.join('; ') : 'E2E encryption dry-run check passed.',
    metadata: {
      e2eEncryptionPolicyId: policy.id,
      e2eEncryptionCheckId: row.id,
      scope: row.scope,
    },
  })
  return row
}

export async function listE2EEncryptionChecks(args: {
  policyId?: string
  scope?: E2EEncryptionCheckScope
  status?: E2EEncryptionCheckStatus
  limit?: number
} = {}): Promise<E2EEncryptionCheckRow[]> {
  const filters = [
    args.policyId ? eq(schema.e2eEncryptionChecks.policyId, args.policyId) : undefined,
    args.scope ? eq(schema.e2eEncryptionChecks.scope, args.scope) : undefined,
    args.status ? eq(schema.e2eEncryptionChecks.status, args.status) : undefined,
  ].filter(Boolean)
  return db.query.e2eEncryptionChecks.findMany({
    where: filters.length > 0 ? and(...filters) : undefined,
    orderBy: [desc(schema.e2eEncryptionChecks.createdAt)],
    limit: Math.min(Math.max(args.limit ?? 50, 1), 200),
  })
}

async function getRequiredPolicy(id: string): Promise<E2EEncryptionPolicyRow> {
  const policy = await db.query.e2eEncryptionPolicies.findFirst({
    where: eq(schema.e2eEncryptionPolicies.id, id),
  })
  if (!policy) throw new Error(`E2E encryption policy not found: ${id}`)
  return policy
}

function findingsForScope(
  policy: E2EEncryptionPolicyRow,
  scope: E2EEncryptionCheckScope,
  observed: JsonObject,
): string[] {
  const findings: string[] = []
  if (scope === 'local_ipc') {
    const observedEncryption = stringValue(observed.encryption)
    if (observedEncryption && observedEncryption !== policy.localIpcEncryption) {
      findings.push(`local_ipc_encryption_mismatch:${observedEncryption}`)
    }
    if (policy.localIpcEncryption === 'none') {
      findings.push('local_ipc_encryption_none_allowed_for_local_only')
    }
    return findings
  }
  if (scope === 'remote_communication') {
    const observedEncryption = stringValue(observed.encryption)
    if (observedEncryption && observedEncryption !== 'tls_1_3') {
      findings.push(`remote_encryption_not_tls_1_3:${observedEncryption}`)
    }
    if (!policy.certificatePinning) findings.push('certificate_pinning_disabled')
    if (!policy.mutualTls) findings.push('mutual_tls_disabled')
    return findings
  }
  if (!policy.encryptExport) findings.push('export_encryption_disabled')
  if (!policy.passwordProtected) findings.push('export_password_protection_disabled')
  if (observed.passwordProtected === false) findings.push('observed_export_without_password')
  return findings
}

function statusForFindings(findings: string[]): E2EEncryptionCheckStatus {
  if (
    findings.some((finding) =>
      [
        'remote_encryption_not_tls_1_3',
        'export_encryption_disabled',
        'observed_export_without_password',
      ].some((prefix) => finding.startsWith(prefix)),
    )
  ) {
    return 'blocked'
  }
  return findings.length > 0 ? 'warning' : 'ok'
}

function policySnapshot(policy: E2EEncryptionPolicyRow): JsonObject {
  return {
    localIPC: { encryption: policy.localIpcEncryption },
    remoteCommunication: {
      encryption: policy.remoteEncryption,
      certificatePinning: policy.certificatePinning,
      mutualTLS: policy.mutualTls,
    },
    dataExport: {
      encryptExport: policy.encryptExport,
      passwordProtected: policy.passwordProtected,
    },
  }
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function normalizeNullable(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? ''
  return trimmed ? trimmed : null
}
