import { and, asc, eq } from 'drizzle-orm'

import { db, schema } from '@/db/client'
import type {
  ErrorCodeCatalogRow,
  ErrorCodeCategory,
  ErrorCodeSeverity,
  JsonObject,
  OpenSourceGovernanceStatus,
} from '@/db/schema'
import { newErrorCodeCatalogId } from '@/server/ids'
import { recordAuditLog } from '@/server/security-service'

export interface CreateErrorCodeCatalogEntryArgs {
  code?: string
  category: ErrorCodeCategory
  numericCode: string
  title: string
  description?: string
  severity?: ErrorCodeSeverity
  retryable?: boolean
  remediation?: string
  status?: OpenSourceGovernanceStatus
}

const categoryNames: Record<ErrorCodeCategory, string> = {
  M: 'Model',
  T: 'Tool',
  A: 'Agent',
  W: 'Workflow',
  R: 'Resource',
  F: 'File',
  S: 'Security',
  N: 'Network',
  SY: 'System',
}

const defaultErrorCodes: CreateErrorCodeCatalogEntryArgs[] = [
  entry('M', '001', 'Model timeout', 'The model request exceeded its configured timeout.', 'warning', true),
  entry('M', '002', 'Invalid model format', 'The model returned a malformed or non-contract response.'),
  entry('M', '003', 'Model refused', 'The model declined to answer or perform the requested operation.'),
  entry('M', '004', 'Invalid API key', 'The configured model credential is missing, invalid, or revoked.', 'critical'),
  entry('M', '005', 'Insufficient balance', 'The provider reports insufficient account balance or quota.', 'critical'),
  entry('M', '006', 'Vision unsupported', 'The selected model does not support required vision input.'),
  entry('M', '007', 'Context window overflow', 'The request exceeds the selected model context window.', 'warning'),
  entry('M', '008', 'Rate limited', 'The model provider throttled the request.', 'warning', true),
  entry('M', '009', 'Empty response', 'The model returned no usable content.', 'warning', true),
  entry('M', '010', 'Truncated response', 'The model response ended before the required artifact was complete.', 'warning', true),

  entry('T', '001', 'Tool timeout', 'The tool call exceeded its configured timeout.', 'warning', true),
  entry('T', '002', 'Invalid tool parameters', 'The tool received parameters that failed schema validation.'),
  entry('T', '003', 'Tool payload too large', 'The tool payload exceeded size limits.', 'warning'),
  entry('T', '004', 'Tool unavailable', 'The requested tool connection is disabled or unhealthy.', 'warning', true),
  entry('T', '005', 'Tool permission denied', 'The Agent lacks permission to use the requested tool.'),
  entry('T', '006', 'Dangerous tool operation', 'The tool action was classified as dangerous and blocked.', 'critical'),
  entry('T', '007', 'Tool retries exhausted', 'The tool failed after all retry attempts.', 'warning', true),

  entry('A', '001', 'Agent not found', 'The referenced Agent profile does not exist.'),
  entry('A', '002', 'Agent concurrency full', 'The Agent or workspace reached its concurrency limit.', 'warning', true),
  entry('A', '003', 'Agent budget exhausted', 'The Agent exceeded its configured token, time, or cost budget.', 'warning'),
  entry('A', '004', 'Agent stuck', 'The runtime detected no useful progress from the Agent.', 'warning'),
  entry('A', '005', 'Agent loop detected', 'The Agent repeated the same plan or action pattern.'),
  entry('A', '006', 'Agent permission denied', 'The Agent permission policy blocks the requested action.'),
  entry('A', '007', 'Agent autonomy limited', 'The autonomy policy requires approval or proposal-only behavior.'),
  entry('A', '008', 'Agent trial expired', 'The Agent cannot run because its trial or certification window expired.'),
  entry('A', '009', 'Agent archived', 'The Agent profile is archived and cannot accept new runs.'),

  entry('W', '001', 'Workflow cycle dependency', 'The workflow graph contains a cycle that cannot be executed.'),
  entry('W', '002', 'Workflow missing input', 'A workflow node is missing required mapped input.'),
  entry('W', '003', 'Workflow Agent missing', 'A workflow node references an Agent that does not exist.'),
  entry('W', '004', 'Workflow partial failure', 'One or more workflow branches failed while others completed.', 'warning'),
  entry('W', '005', 'Workflow timeout', 'The workflow exceeded its configured duration.', 'warning', true),

  entry('R', '001', 'Resource lock timeout', 'A resource lock could not be acquired before timeout.', 'warning', true),
  entry('R', '002', 'Resource lock conflict', 'Another Agent run already owns the requested resource lock.', 'warning', true),
  entry('R', '003', 'Disk full', 'The workspace or system disk is out of available storage.', 'critical'),
  entry('R', '004', 'Memory insufficient', 'The task needs more memory than currently available.', 'critical'),
  entry('R', '005', 'Browser creation failed', 'The isolated browser session could not be created.', 'warning', true),
  entry('R', '006', 'CPU/GPU insufficient', 'The requested job exceeds available compute capacity.', 'warning', true),

  entry('F', '001', 'File not found', 'The requested file path does not exist.'),
  entry('F', '002', 'File locked', 'The file is locked by another process or Agent run.', 'warning', true),
  entry('F', '003', 'File permission denied', 'The Agent cannot access the file under current permissions.'),
  entry('F', '004', 'File too large', 'The file exceeds configured read/write limits.', 'warning'),
  entry('F', '005', 'Unsupported file encoding', 'The file encoding is not supported by the operation.'),
  entry('F', '006', 'Path too long', 'The file path exceeds supported length limits.'),
  entry('F', '007', 'Sandbox blocked file access', 'The sandbox policy blocked access to the file path.'),

  entry('S', '001', 'Secret not found', 'The requested secret reference does not exist.'),
  entry('S', '002', 'Secret decrypt failed', 'The secret vault could not decrypt the requested secret.', 'critical'),
  entry('S', '003', 'Injection detected', 'Prompt, tool, or content injection was detected.', 'critical'),
  entry('S', '004', 'Content scan failed', 'The content safety or policy scan failed.'),
  entry('S', '005', 'Sandbox violation', 'An action attempted to violate sandbox boundaries.', 'critical'),
  entry('S', '006', 'Audit failed', 'The system could not write required audit evidence.', 'critical'),
  entry('S', '007', 'Permission validation failed', 'Permission evaluation failed before action execution.', 'critical'),

  entry('N', '001', 'Network connection failed', 'The network request could not connect.', 'warning', true),
  entry('N', '002', 'Proxy authentication failed', 'The configured proxy rejected authentication.', 'critical'),
  entry('N', '003', 'DNS failed', 'The hostname could not be resolved.', 'warning', true),
  entry('N', '004', 'Certificate failed', 'TLS certificate validation failed.', 'critical'),
  entry('N', '005', 'Firewall blocked', 'The network path appears blocked by a firewall.'),

  entry('SY', '001', 'Database connection failed', 'The local database could not be opened or queried.', 'critical', true),
  entry('SY', '002', 'Migration failed', 'Database bootstrap or migration failed.', 'critical'),
  entry('SY', '003', 'System disk full', 'The system disk is out of available storage.', 'critical'),
  entry('SY', '004', 'EventBus failed', 'The event bus could not publish, persist, or stream an event.', 'critical', true),
  entry('SY', '005', 'Process launch failed', 'A required local process could not be started.', 'critical', true),
  entry('SY', '006', 'Checkpoint corrupted', 'A persisted checkpoint could not be read or validated.', 'critical'),
  entry('SY', '007', 'Backup failed', 'Backup creation or verification failed.', 'critical'),
  entry('SY', '008', 'Update failed', 'Application update check, download, install, or rollback failed.', 'critical', true),
]

export function formatErrorCode(category: ErrorCodeCategory, numericCode: string): string {
  const normalizedNumber = normalizeNumericCode(numericCode)
  return `RX-${category}-${normalizedNumber}`
}

export async function createErrorCodeCatalogEntry(
  args: CreateErrorCodeCatalogEntryArgs,
): Promise<ErrorCodeCatalogRow> {
  const normalized = normalizeEntry(args)
  const now = Date.now()
  const row: ErrorCodeCatalogRow = {
    id: newErrorCodeCatalogId(),
    code: normalized.code,
    category: normalized.category,
    numericCode: normalized.numericCode,
    title: normalized.title,
    description: normalized.description,
    severity: normalized.severity,
    retryable: normalized.retryable,
    remediation: normalized.remediation,
    status: normalized.status,
    createdAt: now,
    updatedAt: now,
  }
  await db.insert(schema.errorCodeCatalog).values(row)
  await recordAuditLog({
    actorType: 'system',
    action: 'error_code_catalog.create',
    resourceType: 'error_code',
    resourceId: row.id,
    status: 'allowed',
    riskLevel: 'low',
    message: `${row.code} ${row.title} registered.`,
    metadata: errorCodeSnapshot(row),
  })
  return row
}

export async function listErrorCodeCatalog(args: {
  category?: ErrorCodeCategory
  code?: string
  status?: OpenSourceGovernanceStatus
  limit?: number
} = {}): Promise<ErrorCodeCatalogRow[]> {
  const filters = [
    args.category ? eq(schema.errorCodeCatalog.category, args.category) : undefined,
    args.code ? eq(schema.errorCodeCatalog.code, args.code.trim().toUpperCase()) : undefined,
    args.status ? eq(schema.errorCodeCatalog.status, args.status) : undefined,
  ].filter(Boolean)
  return db.query.errorCodeCatalog.findMany({
    where: filters.length > 0 ? and(...filters) : undefined,
    orderBy: [asc(schema.errorCodeCatalog.category), asc(schema.errorCodeCatalog.numericCode)],
    limit: Math.min(Math.max(args.limit ?? 100, 1), 300),
  })
}

export async function seedErrorCodeCatalog(): Promise<ErrorCodeCatalogRow[]> {
  for (const errorCode of defaultErrorCodes) {
    const code = formatErrorCode(errorCode.category, errorCode.numericCode)
    const existing = await db.query.errorCodeCatalog.findFirst({
      where: eq(schema.errorCodeCatalog.code, code),
    })
    if (!existing) await createErrorCodeCatalogEntry(errorCode)
  }
  return listErrorCodeCatalog({ limit: 200 })
}

export function getDefaultErrorCodeCount(): number {
  return defaultErrorCodes.length
}

function entry(
  category: ErrorCodeCategory,
  numericCode: string,
  title: string,
  description: string,
  severity: ErrorCodeSeverity = 'error',
  retryable = false,
): CreateErrorCodeCatalogEntryArgs {
  return {
    category,
    numericCode,
    title,
    description,
    severity,
    retryable,
    remediation: retryable
      ? `Retry with backoff after checking the ${categoryNames[category]} configuration.`
      : `Inspect the ${categoryNames[category]} configuration and resolve the underlying issue before retrying.`,
  }
}

function normalizeEntry(args: CreateErrorCodeCatalogEntryArgs): Required<CreateErrorCodeCatalogEntryArgs> {
  const numericCode = normalizeNumericCode(args.numericCode)
  const expectedCode = formatErrorCode(args.category, numericCode)
  const code = args.code?.trim().toUpperCase() ?? expectedCode
  if (code !== expectedCode) {
    throw new Error(`Error code ${code} does not match category ${args.category} and number ${numericCode}.`)
  }
  return {
    code,
    category: args.category,
    numericCode,
    title: args.title.trim(),
    description: args.description?.trim() ?? '',
    severity: args.severity ?? 'error',
    retryable: args.retryable ?? false,
    remediation: args.remediation?.trim() ?? '',
    status: args.status ?? 'active',
  }
}

function normalizeNumericCode(numericCode: string): string {
  const normalized = numericCode.trim().padStart(3, '0')
  if (!/^\d{3}$/.test(normalized)) {
    throw new Error('Error code number must be exactly three digits.')
  }
  return normalized
}

function errorCodeSnapshot(row: ErrorCodeCatalogRow): JsonObject {
  return {
    code: row.code,
    category: row.category,
    numericCode: row.numericCode,
    severity: row.severity,
    retryable: row.retryable,
  }
}
