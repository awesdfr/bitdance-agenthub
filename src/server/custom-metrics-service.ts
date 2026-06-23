import { desc, eq } from 'drizzle-orm'

import { db, schema } from '@/db/client'
import type {
  CustomMetricEvaluationRow,
  CustomMetricEvaluationStatus,
  CustomMetricProfileRow,
  CustomMetricScope,
  JsonObject,
  OptimizationTarget,
} from '@/db/schema'
import { newCustomMetricEvaluationId, newCustomMetricProfileId } from '@/server/ids'
import { recordAuditLog } from '@/server/security-service'

interface MetricWeights {
  costWeight?: number
  speedWeight?: number
  qualityWeight?: number
  safetyWeight?: number
}

interface MetricConstraints {
  maxCostPerTask?: number
  maxTimePerTask?: number
  minQualityScore?: number
  requireApprovalFor?: string[]
}

interface NormalizedMetricConstraints {
  maxCostPerTask?: number
  maxTimePerTask?: number
  minQualityScore?: number
  requireApprovalFor: string[]
}

export interface CreateCustomMetricProfileArgs {
  name: string
  scope?: CustomMetricScope
  scopeId?: string | null
  optimizationTarget?: OptimizationTarget
  weights?: MetricWeights
  constraints?: MetricConstraints
}

export interface EvaluateCustomMetricArgs {
  resourceType?: string
  resourceId?: string | null
  estimatedCostCents?: number
  estimatedDurationMs?: number
  qualityScore?: number
  actionTypes?: string[]
}

export async function createCustomMetricProfile(
  args: CreateCustomMetricProfileArgs,
): Promise<CustomMetricProfileRow> {
  const now = Date.now()
  const target = args.optimizationTarget ?? 'balanced'
  const row: CustomMetricProfileRow = {
    id: newCustomMetricProfileId(),
    name: args.name.trim(),
    scope: args.scope ?? 'workspace',
    scopeId: normalizeNullable(args.scopeId),
    optimizationTarget: target,
    weights: normalizeWeights(target, args.weights),
    constraints: normalizeConstraints(args.constraints) as unknown as JsonObject,
    createdAt: now,
    updatedAt: now,
  }
  await db.insert(schema.customMetricProfiles).values(row)
  await recordAuditLog({
    actorType: 'system',
    action: 'custom_metrics.profile.create',
    resourceType: 'custom_metric_profile',
    resourceId: row.id,
    status: 'allowed',
    riskLevel: 'low',
    message: `Custom metric profile ${row.name} created.`,
    metadata: {
      scope: row.scope,
      scopeId: row.scopeId,
      optimizationTarget: row.optimizationTarget,
      constraints: row.constraints,
    },
  })
  return row
}

export async function listCustomMetricProfiles(): Promise<CustomMetricProfileRow[]> {
  return db.query.customMetricProfiles.findMany({
    orderBy: [desc(schema.customMetricProfiles.createdAt)],
    limit: 100,
  })
}

export async function listCustomMetricEvaluations(limit = 100): Promise<CustomMetricEvaluationRow[]> {
  return db.query.customMetricEvaluations.findMany({
    orderBy: [desc(schema.customMetricEvaluations.createdAt)],
    limit,
  })
}

export async function evaluateCustomMetricProfile(
  profileId: string,
  args: EvaluateCustomMetricArgs,
): Promise<CustomMetricEvaluationRow> {
  const profile = await getRequiredCustomMetricProfile(profileId)
  const constraints = normalizeConstraints(profile.constraints)
  const weights = normalizeWeights(profile.optimizationTarget, profile.weights as MetricWeights)
  const estimate = {
    estimatedCostCents: Math.max(0, args.estimatedCostCents ?? 0),
    estimatedDurationMs: Math.max(0, args.estimatedDurationMs ?? 0),
    qualityScore: clamp(args.qualityScore ?? 80, 0, 100),
    actionTypes: Array.from(new Set((args.actionTypes ?? []).map((item) => item.trim()).filter(Boolean))),
  }
  const violations = buildConstraintViolations(constraints, estimate)
  const subScores = {
    cost: scoreCost(estimate.estimatedCostCents, constraints.maxCostPerTask),
    speed: scoreSpeed(estimate.estimatedDurationMs, constraints.maxTimePerTask),
    quality: estimate.qualityScore,
    safety: scoreSafety(constraints.requireApprovalFor ?? [], estimate.actionTypes),
  }
  const score = Math.round(
    subScores.cost * weights.costWeight +
      subScores.speed * weights.speedWeight +
      subScores.quality * weights.qualityWeight +
      subScores.safety * weights.safetyWeight,
  )
  const status = statusForEvaluation(violations)
  const row: CustomMetricEvaluationRow = {
    id: newCustomMetricEvaluationId(),
    customMetricProfileId: profile.id,
    resourceType: args.resourceType?.trim() || 'task_estimate',
    resourceId: normalizeNullable(args.resourceId),
    estimatedCostCents: estimate.estimatedCostCents,
    estimatedDurationMs: estimate.estimatedDurationMs,
    qualityScore: estimate.qualityScore,
    actionTypes: estimate.actionTypes,
    score,
    status,
    violations,
    recommendation: buildRecommendation(status, profile.optimizationTarget, violations),
    createdAt: Date.now(),
  }
  await db.insert(schema.customMetricEvaluations).values(row)
  await recordAuditLog({
    actorType: 'system',
    action: 'custom_metrics.evaluate',
    resourceType: row.resourceType,
    resourceId: row.resourceId,
    status: row.status === 'blocked' ? 'blocked' : row.status === 'ok' ? 'allowed' : 'warning',
    riskLevel: row.status === 'blocked' ? 'high' : row.status === 'ok' ? 'low' : 'medium',
    message: `Custom metric evaluation scored ${row.score}.`,
    metadata: {
      customMetricProfileId: profile.id,
      optimizationTarget: profile.optimizationTarget,
      violations,
      subScores,
      weights,
    },
  })
  return row
}

async function getRequiredCustomMetricProfile(id: string): Promise<CustomMetricProfileRow> {
  const row = await db.query.customMetricProfiles.findFirst({
    where: eq(schema.customMetricProfiles.id, id),
  })
  if (!row) throw new Error(`Custom metric profile not found: ${id}`)
  return row
}

function normalizeWeights(target: OptimizationTarget, weights: MetricWeights = {}): Required<MetricWeights> {
  const defaults = weightsForTarget(target)
  const raw = {
    costWeight: weights.costWeight ?? defaults.costWeight,
    speedWeight: weights.speedWeight ?? defaults.speedWeight,
    qualityWeight: weights.qualityWeight ?? defaults.qualityWeight,
    safetyWeight: weights.safetyWeight ?? defaults.safetyWeight,
  }
  const total = raw.costWeight + raw.speedWeight + raw.qualityWeight + raw.safetyWeight || 1
  return {
    costWeight: raw.costWeight / total,
    speedWeight: raw.speedWeight / total,
    qualityWeight: raw.qualityWeight / total,
    safetyWeight: raw.safetyWeight / total,
  }
}

function weightsForTarget(target: OptimizationTarget): Required<MetricWeights> {
  if (target === 'minimize_cost') {
    return { costWeight: 0.6, speedWeight: 0.15, qualityWeight: 0.15, safetyWeight: 0.1 }
  }
  if (target === 'maximize_speed') {
    return { costWeight: 0.15, speedWeight: 0.6, qualityWeight: 0.15, safetyWeight: 0.1 }
  }
  if (target === 'maximize_quality') {
    return { costWeight: 0.1, speedWeight: 0.1, qualityWeight: 0.65, safetyWeight: 0.15 }
  }
  if (target === 'maximize_safety') {
    return { costWeight: 0.1, speedWeight: 0.1, qualityWeight: 0.2, safetyWeight: 0.6 }
  }
  return { costWeight: 0.25, speedWeight: 0.25, qualityWeight: 0.3, safetyWeight: 0.2 }
}

function normalizeConstraints(constraints: MetricConstraints | JsonObject = {}): NormalizedMetricConstraints {
  const raw = constraints as Record<string, unknown>
  return {
    maxCostPerTask: optionalNumberValue(raw.maxCostPerTask),
    maxTimePerTask: optionalNumberValue(raw.maxTimePerTask),
    minQualityScore: optionalNumberValue(raw.minQualityScore),
    requireApprovalFor: Array.isArray(raw.requireApprovalFor)
      ? raw.requireApprovalFor.filter((item): item is string => typeof item === 'string')
      : [],
  }
}

function buildConstraintViolations(
  constraints: MetricConstraints,
  estimate: {
    estimatedCostCents: number
    estimatedDurationMs: number
    qualityScore: number
    actionTypes: string[]
  },
): string[] {
  const violations: string[] = []
  if (
    typeof constraints.maxCostPerTask === 'number' &&
    estimate.estimatedCostCents > constraints.maxCostPerTask
  ) {
    violations.push('maxCostPerTask')
  }
  if (
    typeof constraints.maxTimePerTask === 'number' &&
    estimate.estimatedDurationMs > constraints.maxTimePerTask
  ) {
    violations.push('maxTimePerTask')
  }
  if (
    typeof constraints.minQualityScore === 'number' &&
    estimate.qualityScore < constraints.minQualityScore
  ) {
    violations.push('minQualityScore')
  }
  const approvalMatches = estimate.actionTypes.filter((action) =>
    (constraints.requireApprovalFor ?? []).includes(action),
  )
  if (approvalMatches.length) violations.push(`approval:${approvalMatches.join(',')}`)
  return violations
}

function statusForEvaluation(violations: string[]): CustomMetricEvaluationStatus {
  if (violations.some((violation) => !violation.startsWith('approval:'))) return 'blocked'
  if (violations.some((violation) => violation.startsWith('approval:'))) return 'approval_required'
  return 'ok'
}

function buildRecommendation(
  status: CustomMetricEvaluationStatus,
  target: OptimizationTarget,
  violations: string[],
): string {
  if (status === 'ok') return `Task estimate fits the ${target} goal.`
  if (status === 'approval_required') {
    return 'Request user approval before executing the matched high-sensitivity actions.'
  }
  return `Revise the task plan before execution: ${violations.join(', ')}.`
}

function scoreCost(cost: number, maxCost?: number): number {
  if (!maxCost || maxCost <= 0) return 85
  return clamp(100 - (cost / maxCost) * 100, 0, 100)
}

function scoreSpeed(duration: number, maxDuration?: number): number {
  if (!maxDuration || maxDuration <= 0) return 85
  return clamp(100 - (duration / maxDuration) * 100, 0, 100)
}

function scoreSafety(requireApprovalFor: string[], actionTypes: string[]): number {
  if (!requireApprovalFor.length) return 90
  const matched = actionTypes.filter((action) => requireApprovalFor.includes(action)).length
  return clamp(100 - matched * 30, 0, 100)
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function optionalNumberValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function normalizeNullable(value: string | null | undefined): string | null {
  const trimmed = value?.trim()
  return trimmed ? trimmed : null
}
