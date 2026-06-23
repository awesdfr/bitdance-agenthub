import { createHash } from 'node:crypto'

import { desc } from 'drizzle-orm'

import { db, schema } from '@/db/client'
import type {
  FeatureFlagEvaluationRow,
  FeatureFlagEvaluationStatus,
  FeatureFlagRow,
  FeatureFlagStatus,
  FeatureFlagTargetUsers,
} from '@/db/schema'
import { newFeatureFlagEvaluationId, newFeatureFlagId } from '@/server/ids'
import { recordAuditLog } from '@/server/security-service'

export interface CreateFeatureFlagArgs {
  name: string
  description?: string
  status?: FeatureFlagStatus
  rolloutPercent?: number
  targetUsers?: FeatureFlagTargetUsers
  targetUserIds?: string[]
  requiresFlags?: string[]
  conflictsWith?: string[]
  remoteOverride?: boolean
  remoteDisabled?: boolean
}

export interface EvaluateFeatureFlagArgs {
  userId?: string | null
  groups?: string[]
}

export async function createFeatureFlag(args: CreateFeatureFlagArgs): Promise<FeatureFlagRow> {
  const now = Date.now()
  const row: FeatureFlagRow = {
    id: newFeatureFlagId(),
    name: normalizeRequired(args.name, 'name'),
    description: args.description?.trim() ?? '',
    status: args.status ?? 'development',
    rolloutPercent: clampPercent(args.rolloutPercent ?? 0),
    targetUsers: args.targetUsers ?? 'internal',
    targetUserIds: normalizeStringArray(args.targetUserIds),
    requiresFlags: normalizeStringArray(args.requiresFlags),
    conflictsWith: normalizeStringArray(args.conflictsWith),
    remoteOverride: args.remoteOverride ?? true,
    remoteDisabled: args.remoteDisabled ?? false,
    createdAt: now,
    updatedAt: now,
  }
  await db.insert(schema.featureFlags).values(row)
  await recordAuditLog({
    actorType: 'system',
    action: 'feature_flag.create',
    resourceType: 'feature_flag',
    resourceId: row.id,
    riskLevel: row.status === 'released' ? 'medium' : 'low',
    message: `Feature flag ${row.name} was created.`,
    metadata: { status: row.status, rolloutPercent: row.rolloutPercent },
  })
  return row
}

export async function listFeatureFlags(): Promise<FeatureFlagRow[]> {
  return db.query.featureFlags.findMany({
    orderBy: [desc(schema.featureFlags.updatedAt)],
  })
}

export async function listFeatureFlagEvaluations(limit = 100): Promise<FeatureFlagEvaluationRow[]> {
  return db.query.featureFlagEvaluations.findMany({
    orderBy: [desc(schema.featureFlagEvaluations.createdAt)],
    limit: Math.min(Math.max(limit, 1), 500),
  })
}

export async function evaluateFeatureFlag(
  id: string,
  args: EvaluateFeatureFlagArgs = {},
): Promise<FeatureFlagEvaluationRow> {
  const flags = await listFeatureFlags()
  const flag = flags.find((row) => row.id === id)
  if (!flag) throw new Error(`Feature flag not found: ${id}`)
  const decision = evaluateFlag(flag, flags, args)
  const row: FeatureFlagEvaluationRow = {
    id: newFeatureFlagEvaluationId(),
    featureFlagId: flag.id,
    userId: normalizeNullable(args.userId),
    groups: normalizeStringArray(args.groups),
    status: decision.status,
    reason: decision.reason,
    bucket: decision.bucket,
    createdAt: Date.now(),
  }
  await db.insert(schema.featureFlagEvaluations).values(row)
  await recordAuditLog({
    actorType: 'system',
    action: 'feature_flag.evaluate',
    resourceType: 'feature_flag',
    resourceId: flag.id,
    status: decision.status === 'enabled' ? 'allowed' : 'warning',
    riskLevel: decision.status === 'enabled' ? 'low' : 'medium',
    message: decision.reason,
    metadata: {
      userId: row.userId,
      groups: row.groups,
      bucket: row.bucket,
      evaluationId: row.id,
    },
  })
  return row
}

function evaluateFlag(
  flag: FeatureFlagRow,
  allFlags: FeatureFlagRow[],
  args: EvaluateFeatureFlagArgs,
): { status: FeatureFlagEvaluationStatus; reason: string; bucket: number | null } {
  if (flag.remoteOverride && flag.remoteDisabled) {
    return { status: 'blocked', reason: 'Feature is remotely disabled for rollback.', bucket: null }
  }
  if (flag.status === 'deprecated') {
    return { status: 'disabled', reason: 'Feature is deprecated.', bucket: null }
  }
  if (flag.status === 'development' && !hasGroup(args.groups, 'internal')) {
    return { status: 'disabled', reason: 'Development feature is limited to internal users.', bucket: null }
  }

  const missingRequirement = flag.requiresFlags.find((required) => {
    const requiredFlag = findFlagByIdOrName(allFlags, required)
    return !requiredFlag || !flagStructurallyEnabled(requiredFlag)
  })
  if (missingRequirement) {
    return { status: 'blocked', reason: `Required flag is not enabled: ${missingRequirement}.`, bucket: null }
  }

  const conflict = flag.conflictsWith.find((conflicting) => {
    const conflictingFlag = findFlagByIdOrName(allFlags, conflicting)
    return conflictingFlag ? flagStructurallyEnabled(conflictingFlag) : false
  })
  if (conflict) {
    return { status: 'blocked', reason: `Conflicting flag is enabled: ${conflict}.`, bucket: null }
  }

  const target = targetMatches(flag, args)
  if (!target.matches) return { status: 'disabled', reason: target.reason, bucket: null }

  const bucket = rolloutBucket(flag.id, args.userId ?? 'anonymous')
  if (bucket >= flag.rolloutPercent) {
    return {
      status: 'disabled',
      reason: `Rollout bucket ${bucket.toFixed(2)} is outside ${flag.rolloutPercent}%.`,
      bucket,
    }
  }
  return {
    status: 'enabled',
    reason: `Feature enabled by ${flag.status} rollout ${flag.rolloutPercent}%.`,
    bucket,
  }
}

function flagStructurallyEnabled(flag: FeatureFlagRow): boolean {
  return (
    flag.status !== 'deprecated' &&
    !(flag.remoteOverride && flag.remoteDisabled) &&
    flag.rolloutPercent > 0
  )
}

function targetMatches(
  flag: FeatureFlagRow,
  args: EvaluateFeatureFlagArgs,
): { matches: boolean; reason: string } {
  if (flag.targetUsers === 'all') return { matches: true, reason: 'Target all users.' }
  if (flag.targetUsers === 'beta_testers') {
    return hasGroup(args.groups, 'beta_testers')
      ? { matches: true, reason: 'Target beta testers.' }
      : { matches: false, reason: 'User is not in beta_testers group.' }
  }
  if (flag.targetUsers === 'internal') {
    return hasGroup(args.groups, 'internal')
      ? { matches: true, reason: 'Target internal users.' }
      : { matches: false, reason: 'User is not internal.' }
  }
  const userId = args.userId?.trim()
  return userId && flag.targetUserIds.includes(userId)
    ? { matches: true, reason: 'User is explicitly targeted.' }
    : { matches: false, reason: 'User is not explicitly targeted.' }
}

function findFlagByIdOrName(flags: FeatureFlagRow[], value: string): FeatureFlagRow | null {
  return flags.find((flag) => flag.id === value || flag.name === value) ?? null
}

function rolloutBucket(flagId: string, userId: string): number {
  const digest = createHash('sha256').update(`${flagId}:${userId}`).digest()
  const int = digest.readUInt32BE(0)
  return (int / 0xffffffff) * 100
}

function hasGroup(groups: string[] | undefined, group: string): boolean {
  return normalizeStringArray(groups).includes(group)
}

function normalizeStringArray(value: string[] | undefined): string[] {
  return Array.from(new Set((value ?? []).map((item) => item.trim()).filter(Boolean)))
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

function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.min(100, value))
}
