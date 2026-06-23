import { desc } from 'drizzle-orm'

import { db, schema } from '@/db/client'
import type {
  DegradationAction,
  DegradationEventRow,
  DegradationEventStatus,
  DegradationPolicyRow,
  DegradationResourceType,
  DegradationTrigger,
  JsonObject,
} from '@/db/schema'
import { newDegradationEventId, newDegradationPolicyId } from '@/server/ids'
import { recordAuditLog } from '@/server/security-service'

export interface CreateDegradationPolicyArgs {
  name: string
  resourceType: DegradationResourceType
  resourceId?: string | null
  trigger?: DegradationTrigger
  action: DegradationAction
  fallbackResourceIds?: string[]
  enabled?: boolean
}

export interface EvaluateDegradationArgs {
  resourceType: DegradationResourceType
  resourceId?: string | null
  trigger?: DegradationTrigger
  fallbackCandidates?: string[]
  metadata?: JsonObject
}

export async function createDegradationPolicy(
  args: CreateDegradationPolicyArgs,
): Promise<DegradationPolicyRow> {
  const now = Date.now()
  const row: DegradationPolicyRow = {
    id: newDegradationPolicyId(),
    name: required(args.name, 'name'),
    resourceType: args.resourceType,
    resourceId: nullable(args.resourceId),
    trigger: args.trigger ?? 'offline',
    action: args.action,
    fallbackResourceIds: normalizeStringArray(args.fallbackResourceIds),
    enabled: args.enabled ?? true,
    createdAt: now,
    updatedAt: now,
  }
  await db.insert(schema.degradationPolicies).values(row)
  await recordAuditLog({
    actorType: 'system',
    action: 'degradation.policy.create',
    resourceType: 'degradation_policy',
    resourceId: row.id,
    riskLevel: 'low',
    message: `Degradation policy ${row.name} was created.`,
    metadata: {
      resourceType: row.resourceType,
      resourceId: row.resourceId,
      trigger: row.trigger,
      action: row.action,
    },
  })
  return row
}

export async function listDegradationPolicies(): Promise<DegradationPolicyRow[]> {
  return db.query.degradationPolicies.findMany({
    orderBy: [desc(schema.degradationPolicies.updatedAt)],
  })
}

export async function listDegradationEvents(limit = 100): Promise<DegradationEventRow[]> {
  return db.query.degradationEvents.findMany({
    orderBy: [desc(schema.degradationEvents.createdAt)],
    limit: Math.min(Math.max(limit, 1), 500),
  })
}

export async function evaluateDegradation(
  args: EvaluateDegradationArgs,
): Promise<DegradationEventRow> {
  const trigger = args.trigger ?? 'offline'
  const policy = await findMatchingPolicy(args.resourceType, nullable(args.resourceId), trigger)
  const action = policy?.action ?? defaultAction(args.resourceType)
  const fallbacks =
    policy?.fallbackResourceIds.length ? policy.fallbackResourceIds : normalizeStringArray(args.fallbackCandidates)
  const fallbackResourceId = fallbacks[0] ?? null
  const decision = decide(action, args.resourceType, trigger, fallbackResourceId)

  const row: DegradationEventRow = {
    id: newDegradationEventId(),
    policyId: policy?.id ?? null,
    resourceType: args.resourceType,
    resourceId: nullable(args.resourceId),
    trigger,
    action,
    status: decision.status,
    reason: decision.reason,
    fallbackResourceId,
    metadata: args.metadata ?? {},
    createdAt: Date.now(),
  }
  await db.insert(schema.degradationEvents).values(row)
  await recordAuditLog({
    actorType: 'system',
    action: 'degradation.evaluate',
    resourceType: args.resourceType,
    resourceId: row.resourceId ?? args.resourceType,
    status: decision.status === 'blocked' ? 'blocked' : 'warning',
    riskLevel: decision.status === 'blocked' ? 'high' : 'medium',
    message: decision.reason,
    metadata: {
      trigger,
      action,
      policyId: row.policyId,
      eventId: row.id,
      fallbackResourceId,
    },
  })
  return row
}

async function findMatchingPolicy(
  resourceType: DegradationResourceType,
  resourceId: string | null,
  trigger: DegradationTrigger,
): Promise<DegradationPolicyRow | null> {
  const policies = await listDegradationPolicies()
  return (
    policies.find(
      (policy) =>
        policy.enabled &&
        policy.resourceType === resourceType &&
        policy.trigger === trigger &&
        (policy.resourceId === resourceId || policy.resourceId === null),
    ) ?? null
  )
}

function defaultAction(resourceType: DegradationResourceType): DegradationAction {
  if (resourceType === 'model_profile') return 'use_fallback_model'
  if (resourceType === 'mcp_server') return 'use_fallback_server'
  if (resourceType === 'network_profile') return 'use_direct_network'
  if (resourceType === 'external_api') return 'mark_pending_retry'
  if (resourceType === 'browser_session') return 'pause_until_online'
  if (resourceType === 'task_queue') return 'keep_queue_state'
  return 'mark_unavailable'
}

function decide(
  action: DegradationAction,
  resourceType: DegradationResourceType,
  trigger: DegradationTrigger,
  fallbackResourceId: string | null,
): { status: DegradationEventStatus; reason: string } {
  if (action === 'use_fallback_model' || action === 'use_fallback_server') {
    if (fallbackResourceId) {
      return {
        status: 'applied',
        reason: `${resourceType} degraded after ${trigger}; using fallback ${fallbackResourceId}.`,
      }
    }
    return {
      status: 'blocked',
      reason: `${resourceType} needs a fallback after ${trigger}, but no fallback is configured.`,
    }
  }
  if (action === 'use_direct_network') {
    return {
      status: 'applied',
      reason: `${resourceType} degraded after ${trigger}; routing through direct network.`,
    }
  }
  if (action === 'mark_pending_retry') {
    return {
      status: 'pending_retry',
      reason: `${resourceType} degraded after ${trigger}; marked for later retry.`,
    }
  }
  if (action === 'pause_until_online') {
    return {
      status: 'pending_retry',
      reason: `${resourceType} degraded after ${trigger}; paused until connectivity recovers.`,
    }
  }
  if (action === 'keep_queue_state') {
    return {
      status: 'applied',
      reason: `${resourceType} degraded after ${trigger}; queue state is preserved.`,
    }
  }
  return {
    status: 'blocked',
    reason: `${resourceType} degraded after ${trigger}; marked unavailable.`,
  }
}

function normalizeStringArray(value: string[] | undefined): string[] {
  return Array.from(new Set((value ?? []).map((item) => item.trim()).filter(Boolean)))
}

function required(value: string, field: string): string {
  const trimmed = value.trim()
  if (!trimmed) throw new Error(`${field} is required`)
  return trimmed
}

function nullable(value: string | null | undefined): string | null {
  const trimmed = value?.trim()
  return trimmed ? trimmed : null
}
