import { desc, eq } from 'drizzle-orm'

import { db, schema } from '@/db/client'
import type {
  DataExportFormat,
  DataExportManifestRow,
  DataExportScope,
  JsonObject,
  MemoryItemRow,
  PiiDetectedBy,
  PiiMarkerRow,
  PiiMarkerStatus,
  PiiType,
  RetentionEntity,
  RetentionExpiryAction,
  RetentionPolicyRow,
  StorageQuotaScope,
  StorageQuotaSnapshotRow,
  StorageQuotaStatus,
} from '@/db/schema'
import {
  newDataExportManifestId,
  newPiiMarkerId,
  newRetentionPolicyId,
  newStorageQuotaSnapshotId,
} from '@/server/ids'
import { recordAuditLog } from '@/server/security-service'

export interface CreateRetentionPolicyArgs {
  entity: RetentionEntity
  retentionPeriod: string
  onExpiry?: RetentionExpiryAction
  maxStorageBytes?: number | null
  enabled?: boolean
}

export interface RetentionEvaluation {
  policy: RetentionPolicyRow
  cutoffAt: number | null
  expiredCandidateCount: number
  action: RetentionExpiryAction
  dryRun: true
}

export interface ComputeStorageQuotaArgs {
  scope?: StorageQuotaScope
  scopeId?: string | null
  maxTotalBytes?: number
  warnAtPercent?: number
  blockAtPercent?: number
}

export interface ScanPiiArgs {
  memoryItemId?: string | null
  limit?: number
}

export interface CreateDataExportManifestArgs {
  scope?: DataExportScope
  scopeId?: string | null
  format?: DataExportFormat
  includeSecrets?: boolean
}

const DEFAULT_QUOTA_BYTES = 1024 * 1024 * 1024

const PII_PATTERNS: Array<{ type: PiiType; detectedBy: PiiDetectedBy; regex: RegExp }> = [
  { type: 'email', detectedBy: 'regex', regex: /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi },
  { type: 'phone', detectedBy: 'regex', regex: /(?<!\d)(?:\+?\d[\d\s().-]{7,}\d)(?!\d)/g },
  { type: 'id_number', detectedBy: 'regex', regex: /\b\d{17}[\dXx]\b/g },
  { type: 'ip', detectedBy: 'regex', regex: /\b(?:\d{1,3}\.){3}\d{1,3}\b/g },
]

export async function createRetentionPolicy(
  args: CreateRetentionPolicyArgs,
): Promise<RetentionPolicyRow> {
  const now = Date.now()
  const row: RetentionPolicyRow = {
    id: newRetentionPolicyId(),
    entity: args.entity,
    retentionPeriod: normalizeRequired(args.retentionPeriod, 'retentionPeriod'),
    onExpiry: args.onExpiry ?? 'ask_user',
    maxStorageBytes: args.maxStorageBytes ?? null,
    enabled: args.enabled ?? true,
    createdAt: now,
    updatedAt: now,
  }
  await db.insert(schema.retentionPolicies).values(row)
  await recordAuditLog({
    actorType: 'system',
    action: 'data_lifecycle.retention_policy.create',
    resourceType: 'retention_policy',
    resourceId: row.id,
    riskLevel: row.onExpiry === 'delete' ? 'high' : 'low',
    message: `Retention policy for ${row.entity} was created.`,
    metadata: { retentionPeriod: row.retentionPeriod, onExpiry: row.onExpiry },
  })
  return row
}

export async function listRetentionPolicies(): Promise<RetentionPolicyRow[]> {
  return db.query.retentionPolicies.findMany({
    orderBy: [desc(schema.retentionPolicies.createdAt)],
  })
}

export async function evaluateRetentionPolicies(): Promise<RetentionEvaluation[]> {
  const policies = await listRetentionPolicies()
  const rows = await Promise.all(
    policies
      .filter((policy) => policy.enabled)
      .map(async (policy) => {
        const cutoffAt = parseRetentionCutoff(policy.retentionPeriod)
        return {
          policy,
          cutoffAt,
          expiredCandidateCount: cutoffAt ? await countExpiredCandidates(policy.entity, cutoffAt) : 0,
          action: policy.onExpiry,
          dryRun: true as const,
        }
      }),
  )
  await recordAuditLog({
    actorType: 'system',
    action: 'data_lifecycle.retention_policy.evaluate',
    resourceType: 'retention_policy',
    status: 'warning',
    riskLevel: 'medium',
    message: 'Retention policies were evaluated in dry-run mode; no data was deleted.',
    metadata: { evaluated: rows.length },
  })
  return rows
}

export async function computeStorageQuotaSnapshot(
  args: ComputeStorageQuotaArgs = {},
): Promise<StorageQuotaSnapshotRow> {
  const now = Date.now()
  const scope = args.scope ?? 'workspace'
  const breakdown = await computeStorageBreakdown(scope, args.scopeId ?? null)
  const currentBytes = Object.values(breakdown).reduce((sum, value) => sum + value, 0)
  const maxTotalBytes = args.maxTotalBytes ?? DEFAULT_QUOTA_BYTES
  const warnAtPercent = args.warnAtPercent ?? 80
  const blockAtPercent = args.blockAtPercent ?? 95
  const status = quotaStatus(currentBytes, maxTotalBytes, warnAtPercent, blockAtPercent)
  const row: StorageQuotaSnapshotRow = {
    id: newStorageQuotaSnapshotId(),
    scope,
    scopeId: normalizeNullable(args.scopeId),
    maxTotalBytes,
    currentBytes,
    breakdown,
    warnAtPercent,
    blockAtPercent,
    status,
    createdAt: now,
    updatedAt: now,
  }
  await db.insert(schema.storageQuotaSnapshots).values(row)
  await recordAuditLog({
    actorType: 'system',
    action: 'data_lifecycle.storage_quota.compute',
    resourceType: 'storage_quota',
    resourceId: row.id,
    status: status === 'blocked' ? 'blocked' : status === 'warning' ? 'warning' : 'allowed',
    riskLevel: status === 'blocked' ? 'high' : 'low',
    message: `Storage quota snapshot is ${status}.`,
    metadata: { scope: row.scope, scopeId: row.scopeId, currentBytes, maxTotalBytes },
  })
  return row
}

export async function listStorageQuotaSnapshots(limit = 50): Promise<StorageQuotaSnapshotRow[]> {
  return db.query.storageQuotaSnapshots.findMany({
    orderBy: [desc(schema.storageQuotaSnapshots.createdAt)],
    limit: Math.min(Math.max(limit, 1), 200),
  })
}

export async function scanMemoryForPii(args: ScanPiiArgs = {}): Promise<PiiMarkerRow[]> {
  const memories = await listTargetMemories(args.memoryItemId, args.limit)
  const existing = await db.query.piiMarkers.findMany()
  const existingKeys = new Set(existing.map((marker) => markerKey(marker)))
  const created: PiiMarkerRow[] = []
  for (const memory of memories) {
    for (const marker of findPiiMarkers(memory)) {
      const key = `${memory.id}:${marker.piiType}:${marker.location}`
      if (existingKeys.has(key)) continue
      const now = Date.now()
      const row: PiiMarkerRow = {
        id: newPiiMarkerId(),
        memoryItemId: memory.id,
        piiType: marker.piiType,
        detectedBy: marker.detectedBy,
        location: marker.location,
        excerpt: marker.excerpt,
        status: 'flagged',
        createdAt: now,
        reviewedAt: null,
        updatedAt: now,
      }
      await db.insert(schema.piiMarkers).values(row)
      existingKeys.add(key)
      created.push(row)
    }
  }
  await recordAuditLog({
    actorType: 'system',
    action: 'data_lifecycle.pii.scan',
    resourceType: 'memory_item',
    resourceId: args.memoryItemId ?? null,
    status: created.length > 0 ? 'warning' : 'allowed',
    riskLevel: created.length > 0 ? 'medium' : 'low',
    message: `${created.length} PII markers were created from memory scan.`,
    metadata: { created: created.length, scanned: memories.length },
  })
  return created
}

export async function listPiiMarkers(limit = 100): Promise<PiiMarkerRow[]> {
  return db.query.piiMarkers.findMany({
    orderBy: [desc(schema.piiMarkers.createdAt)],
    limit: Math.min(Math.max(limit, 1), 500),
  })
}

export async function updatePiiMarkerStatus(
  id: string,
  status: PiiMarkerStatus,
): Promise<PiiMarkerRow> {
  const now = Date.now()
  await db
    .update(schema.piiMarkers)
    .set({
      status,
      reviewedAt: status === 'flagged' ? null : now,
      updatedAt: now,
    })
    .where(eq(schema.piiMarkers.id, id))
  const marker = await getRequiredPiiMarker(id)
  await recordAuditLog({
    actorType: 'system',
    action: 'data_lifecycle.pii.status',
    resourceType: 'pii_marker',
    resourceId: id,
    status: status === 'cleared' ? 'allowed' : 'warning',
    riskLevel: status === 'redacted' ? 'medium' : 'low',
    message: `PII marker status changed to ${status}.`,
  })
  return marker
}

export async function createDataExportManifest(
  args: CreateDataExportManifestArgs = {},
): Promise<DataExportManifestRow> {
  const scope = args.scope ?? 'workspace'
  const scopeId = normalizeNullable(args.scopeId)
  const manifest = await buildExportManifest(scope, scopeId, args.includeSecrets ?? false)
  const row: DataExportManifestRow = {
    id: newDataExportManifestId(),
    scope,
    scopeId,
    format: args.format ?? 'zip_manifest',
    includeSecrets: args.includeSecrets ?? false,
    status: 'ready',
    manifest,
    createdAt: Date.now(),
  }
  await db.insert(schema.dataExportManifests).values(row)
  await recordAuditLog({
    actorType: 'system',
    action: 'data_lifecycle.export_manifest.create',
    resourceType: 'data_export_manifest',
    resourceId: row.id,
    riskLevel: row.includeSecrets ? 'high' : 'low',
    message: 'Portable export manifest was created without packaging secret values.',
    metadata: { scope: row.scope, scopeId: row.scopeId, format: row.format },
  })
  return row
}

export async function listDataExportManifests(limit = 50): Promise<DataExportManifestRow[]> {
  return db.query.dataExportManifests.findMany({
    orderBy: [desc(schema.dataExportManifests.createdAt)],
    limit: Math.min(Math.max(limit, 1), 200),
  })
}

async function countExpiredCandidates(entity: RetentionEntity, cutoffAt: number): Promise<number> {
  const rows = await rowsForRetentionEntity(entity)
  return rows.filter((row) => getRowTimestamp(row) < cutoffAt).length
}

async function rowsForRetentionEntity(entity: RetentionEntity): Promise<Record<string, unknown>[]> {
  if (entity === 'artifact') return db.query.artifacts.findMany()
  if (entity === 'memory') return db.query.memoryItems.findMany()
  if (entity === 'audit_log') return db.query.auditLogs.findMany()
  if (entity === 'run_event') return db.query.employeeRunEvents.findMany()
  if (entity === 'run_log') return db.query.employeeRuns.findMany()
  return db.query.computerActionEvents.findMany()
}

function getRowTimestamp(row: Record<string, unknown>): number {
  const value = row.createdAt ?? row.startedAt ?? row.created_at ?? 0
  return typeof value === 'number' ? value : 0
}

function parseRetentionCutoff(period: string): number | null {
  const trimmed = period.trim().toLowerCase()
  if (!trimmed || trimmed === 'forever') return null
  const match = /^(\d+)\s*(d|day|days|w|week|weeks|m|month|months|y|year|years)$/.exec(trimmed)
  if (!match) return null
  const value = Number(match[1])
  const unit = match[2]
  const days =
    unit.startsWith('y') ? value * 365 :
    unit.startsWith('m') ? value * 30 :
    unit.startsWith('w') ? value * 7 :
    value
  return Date.now() - days * 24 * 60 * 60 * 1000
}

async function computeStorageBreakdown(
  scope: StorageQuotaScope,
  scopeId: string | null,
): Promise<Record<string, number>> {
  const [
    artifacts,
    computerActions,
    auditLogs,
    employeeEvents,
    memories,
    computerSessions,
  ] = await Promise.all([
    db.query.artifacts.findMany(),
    db.query.computerActionEvents.findMany(),
    db.query.auditLogs.findMany(),
    db.query.employeeRunEvents.findMany(),
    db.query.memoryItems.findMany(),
    db.query.computerSessions.findMany(),
  ])
  const scopedMemories = scope === 'agent' && scopeId
    ? memories.filter((row) => row.agentProfileId === scopeId)
    : memories
  const scopedSessions = scope === 'agent' && scopeId
    ? computerSessions.filter((row) => row.agentProfileId === scopeId)
    : computerSessions
  return {
    artifacts: estimateRows(artifacts),
    screenshots: estimateRows(computerActions),
    logs: estimateRows(auditLogs) + estimateRows(employeeEvents),
    memories: estimateRows(scopedMemories),
    browser_profiles: estimateRows(scopedSessions.map((row) => ({
      id: row.id,
      browserProfilePath: row.browserProfilePath,
      workspacePath: row.workspacePath,
      tempPath: row.tempPath,
    }))),
  }
}

function estimateRows(rows: unknown[]): number {
  return rows.reduce<number>(
    (sum, row) => sum + Buffer.byteLength(JSON.stringify(row), 'utf8'),
    0,
  )
}

function quotaStatus(
  currentBytes: number,
  maxTotalBytes: number,
  warnAtPercent: number,
  blockAtPercent: number,
): StorageQuotaStatus {
  if (maxTotalBytes <= 0) return 'blocked'
  const percent = (currentBytes / maxTotalBytes) * 100
  if (percent >= blockAtPercent) return 'blocked'
  if (percent >= warnAtPercent) return 'warning'
  return 'ok'
}

async function listTargetMemories(memoryItemId?: string | null, limit = 100): Promise<MemoryItemRow[]> {
  if (memoryItemId) {
    const row = await db.query.memoryItems.findFirst({
      where: eq(schema.memoryItems.id, memoryItemId),
    })
    return row ? [row] : []
  }
  return db.query.memoryItems.findMany({
    orderBy: [desc(schema.memoryItems.createdAt)],
    limit: Math.min(Math.max(limit, 1), 500),
  })
}

function findPiiMarkers(memory: MemoryItemRow): Array<{
  piiType: PiiType
  detectedBy: PiiDetectedBy
  location: string
  excerpt: string
}> {
  return PII_PATTERNS.flatMap((pattern) =>
    Array.from(memory.content.matchAll(pattern.regex)).map((match) => {
      const start = match.index ?? 0
      const end = start + match[0].length
      return {
        piiType: pattern.type,
        detectedBy: pattern.detectedBy,
        location: `${start}-${end}`,
        excerpt: excerpt(memory.content, start, end),
      }
    }),
  )
}

function markerKey(marker: PiiMarkerRow): string {
  return `${marker.memoryItemId}:${marker.piiType}:${marker.location}`
}

async function getRequiredPiiMarker(id: string): Promise<PiiMarkerRow> {
  const row = await db.query.piiMarkers.findFirst({ where: eq(schema.piiMarkers.id, id) })
  if (!row) throw new Error(`PII marker not found: ${id}`)
  return row
}

async function buildExportManifest(
  scope: DataExportScope,
  scopeId: string | null,
  includeSecrets: boolean,
): Promise<JsonObject> {
  const [
    agents,
    models,
    networks,
    cliProfiles,
    skills,
    workflows,
    memories,
    playbooks,
    configVersions,
  ] = await Promise.all([
    db.query.agentProfiles.findMany(),
    db.query.modelProfiles.findMany(),
    db.query.networkProfiles.findMany(),
    db.query.cliProfiles.findMany(),
    db.query.skills.findMany(),
    db.query.workflows.findMany(),
    db.query.memoryItems.findMany(),
    db.query.playbooks.findMany(),
    db.query.configVersions.findMany(),
  ])
  const scopedAgents = scope === 'agent' && scopeId ? agents.filter((row) => row.id === scopeId) : agents
  const scopedMemories = scope === 'agent' && scopeId
    ? memories.filter((row) => row.agentProfileId === scopeId)
    : memories
  return {
    scope,
    scopeId,
    generatedAt: Date.now(),
    formatVersion: 1,
    secrets: {
      included: false,
      requested: includeSecrets,
      note: 'Secret values are never embedded in this portable manifest; migrate env refs separately.',
    },
    counts: {
      agentProfiles: scopedAgents.length,
      modelProfiles: models.length,
      networkProfiles: networks.length,
      cliProfiles: cliProfiles.length,
      skills: skills.length,
      workflows: workflows.length,
      memories: scopedMemories.length,
      playbooks: playbooks.length,
      configVersions: configVersions.length,
    },
    refs: {
      agentProfileIds: scopedAgents.map((row) => row.id),
      workflowIds: workflows.map((row) => row.id),
      memoryIds: scopedMemories.map((row) => row.id),
    },
  }
}

function excerpt(content: string, start: number, end: number): string {
  return content.slice(Math.max(0, start - 16), Math.min(content.length, end + 16))
}

function normalizeRequired(value: string, field: string): string {
  const trimmed = value.trim()
  if (!trimmed) throw new Error(`${field} is required`)
  return trimmed
}

function normalizeNullable(value: string | null | undefined): string | null {
  const trimmed = value?.trim()
  return trimmed ? trimmed : null
}
