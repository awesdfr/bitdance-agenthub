import { and, desc, eq } from 'drizzle-orm'

import { db, schema } from '@/db/client'
import type {
  ApprovalEscalationStep,
  ApprovalOnTimeout,
  AutoApproveCondition,
  HumanApprovalPolicyConfig,
  HumanApprovalPolicyRow,
  HumanApprovalPolicyStatus,
  JsonObject,
  PlanApprovalOverallDecision,
  PlanApprovalResultRow,
  PlanStepDecision,
  TakeoverActionType,
  TakeoverResource,
  TakeoverSessionRow,
  TakeoverSessionStatus,
} from '@/db/schema'
import {
  newHumanApprovalPolicyId,
  newPlanApprovalResultId,
  newTakeoverSessionId,
} from '@/server/ids'

export const DEFAULT_HUMAN_APPROVAL_POLICY_CONFIG: HumanApprovalPolicyConfig = {
  timeoutSeconds: 3600,
  onTimeout: 'keep_waiting',
  batching: {
    enabled: false,
    maxBatchSize: 10,
    maxWaitSeconds: 120,
    mergeSimilar: true,
  },
  autoApproveConditions: [],
  escalationChain: [
    {
      level: 1,
      approver: 'user',
      escalateAfterSeconds: 0,
    },
  ],
}

export interface CreateHumanApprovalPolicyArgs {
  agentProfileId?: string | null
  workflowId?: string | null
  name: string
  config?: Partial<HumanApprovalPolicyConfig>
  status?: HumanApprovalPolicyStatus
}

export interface HumanApprovalPolicyEvaluation {
  policy: HumanApprovalPolicyRow
  elapsedSeconds: number
  timedOut: boolean
  timeoutAction: ApprovalOnTimeout | 'not_timed_out'
  autoApproved: boolean
  matchedAutoApproveCondition: AutoApproveCondition | null
  escalationTarget: ApprovalEscalationStep | null
  batching: HumanApprovalPolicyConfig['batching'] & {
    shouldBatch: boolean
    suggestedBatchKey: string | null
  }
  recommendation:
    | 'approve'
    | 'reject'
    | 'wait'
    | 'escalate'
    | 'batch'
}

export interface RecordPlanApprovalResultArgs {
  approvalRequestId?: string | null
  agentProfileId?: string | null
  employeeRunId?: string | null
  workflowRunId?: string | null
  planId?: string | null
  stepDecisions: PlanStepDecision[]
  overallDecision?: PlanApprovalOverallDecision
  summary?: string
}

export interface StartTakeoverSessionArgs {
  runId?: string | null
  agentProfileId?: string | null
  stepId: string
  resource: TakeoverResource
  observation?: JsonObject
}

export interface RecordTakeoverActionArgs {
  type: TakeoverActionType
  payload?: JsonObject
  timestamp?: number
}

export async function createHumanApprovalPolicy(
  args: CreateHumanApprovalPolicyArgs,
): Promise<HumanApprovalPolicyRow> {
  const now = Date.now()
  const name = args.name.trim()
  if (!name) throw new Error('Human approval policy name is required.')
  const row: HumanApprovalPolicyRow = {
    id: newHumanApprovalPolicyId(),
    agentProfileId: normalizeNullable(args.agentProfileId),
    workflowId: normalizeNullable(args.workflowId),
    name,
    config: normalizeHumanApprovalPolicyConfig(args.config),
    status: args.status ?? 'active',
    createdAt: now,
    updatedAt: now,
  }
  await db.insert(schema.humanApprovalPolicies).values(row)
  return row
}

export async function listHumanApprovalPolicies(args: {
  agentProfileId?: string
  workflowId?: string
  status?: HumanApprovalPolicyStatus
  limit?: number
} = {}): Promise<HumanApprovalPolicyRow[]> {
  const filters = [
    args.agentProfileId ? eq(schema.humanApprovalPolicies.agentProfileId, args.agentProfileId) : undefined,
    args.workflowId ? eq(schema.humanApprovalPolicies.workflowId, args.workflowId) : undefined,
    args.status ? eq(schema.humanApprovalPolicies.status, args.status) : undefined,
  ].filter(Boolean)
  return db.query.humanApprovalPolicies.findMany({
    where: filters.length > 0 ? and(...filters) : undefined,
    orderBy: [desc(schema.humanApprovalPolicies.createdAt)],
    limit: Math.min(Math.max(args.limit ?? 100, 1), 500),
  })
}

export async function evaluateHumanApprovalPolicy(args: {
  policyId: string
  facts?: JsonObject
  requestedAt?: number | null
  elapsedSeconds?: number | null
  autoApprovalsUsedInRun?: number
  approvalType?: string | null
}): Promise<HumanApprovalPolicyEvaluation> {
  const policy = await getHumanApprovalPolicy(args.policyId)
  const config = normalizeHumanApprovalPolicyConfig(policy.config)
  const elapsedSeconds = Math.max(
    0,
    Math.floor(
      args.elapsedSeconds ??
        (args.requestedAt ? (Date.now() - args.requestedAt) / 1000 : 0),
    ),
  )
  const facts = args.facts ?? {}
  const timedOut = elapsedSeconds >= config.timeoutSeconds
  const matchedAutoApproveCondition =
    config.autoApproveConditions.find((condition) =>
      evaluateCondition(condition.condition, facts) &&
      (args.autoApprovalsUsedInRun ?? 0) < condition.maxAutoApprovalsPerRun,
    ) ?? null
  const escalationTarget =
    [...config.escalationChain]
      .sort((a, b) => b.level - a.level)
      .find((step) => elapsedSeconds >= step.escalateAfterSeconds) ?? null
  const shouldBatch =
    config.batching.enabled &&
    !matchedAutoApproveCondition &&
    !timedOut &&
    String(args.approvalType ?? '').trim().length > 0
  const recommendation = matchedAutoApproveCondition
    ? 'approve'
    : timedOut
      ? timeoutRecommendation(config.onTimeout)
      : shouldBatch
        ? 'batch'
        : escalationTarget && escalationTarget.level > 1
          ? 'escalate'
          : 'wait'
  return {
    policy,
    elapsedSeconds,
    timedOut,
    timeoutAction: timedOut ? config.onTimeout : 'not_timed_out',
    autoApproved: Boolean(matchedAutoApproveCondition),
    matchedAutoApproveCondition,
    escalationTarget,
    batching: {
      ...config.batching,
      shouldBatch,
      suggestedBatchKey: shouldBatch ? `${args.approvalType}:${facts.risk_level ?? facts.riskLevel ?? 'unknown'}` : null,
    },
    recommendation,
  }
}

export async function recordPlanApprovalResult(
  args: RecordPlanApprovalResultArgs,
): Promise<PlanApprovalResultRow> {
  if (args.stepDecisions.length === 0) throw new Error('At least one plan step decision is required.')
  const overallDecision = args.overallDecision ?? computeOverallDecision(args.stepDecisions)
  const row: PlanApprovalResultRow = {
    id: newPlanApprovalResultId(),
    approvalRequestId: normalizeNullable(args.approvalRequestId),
    agentProfileId: normalizeNullable(args.agentProfileId),
    employeeRunId: normalizeNullable(args.employeeRunId),
    workflowRunId: normalizeNullable(args.workflowRunId),
    planId: normalizeNullable(args.planId),
    stepDecisions: args.stepDecisions,
    overallDecision,
    summary: args.summary?.trim() || summarizePlanApproval(args.stepDecisions, overallDecision),
    createdAt: Date.now(),
  }
  await db.insert(schema.planApprovalResults).values(row)
  if (row.approvalRequestId) await resolveLinkedApprovalRequest(row)
  return row
}

export async function listPlanApprovalResults(args: {
  approvalRequestId?: string
  agentProfileId?: string
  employeeRunId?: string
  workflowRunId?: string
  limit?: number
} = {}): Promise<PlanApprovalResultRow[]> {
  const filters = [
    args.approvalRequestId ? eq(schema.planApprovalResults.approvalRequestId, args.approvalRequestId) : undefined,
    args.agentProfileId ? eq(schema.planApprovalResults.agentProfileId, args.agentProfileId) : undefined,
    args.employeeRunId ? eq(schema.planApprovalResults.employeeRunId, args.employeeRunId) : undefined,
    args.workflowRunId ? eq(schema.planApprovalResults.workflowRunId, args.workflowRunId) : undefined,
  ].filter(Boolean)
  return db.query.planApprovalResults.findMany({
    where: filters.length > 0 ? and(...filters) : undefined,
    orderBy: [desc(schema.planApprovalResults.createdAt)],
    limit: Math.min(Math.max(args.limit ?? 100, 1), 500),
  })
}

export async function startTakeoverSession(
  args: StartTakeoverSessionArgs,
): Promise<TakeoverSessionRow> {
  const now = Date.now()
  const row: TakeoverSessionRow = {
    id: newTakeoverSessionId(),
    runId: normalizeNullable(args.runId),
    agentProfileId: normalizeNullable(args.agentProfileId),
    stepId: args.stepId.trim(),
    resource: args.resource,
    status: 'active',
    userActions: [],
    observation: args.observation ?? {},
    createdAt: now,
    updatedAt: now,
    completedAt: null,
  }
  if (!row.stepId) throw new Error('Takeover stepId is required.')
  await db.insert(schema.takeoverSessions).values(row)
  return row
}

export async function recordTakeoverAction(
  takeoverSessionId: string,
  args: RecordTakeoverActionArgs,
): Promise<TakeoverSessionRow> {
  const session = await getTakeoverSession(takeoverSessionId)
  if (session.status !== 'active') throw new Error(`Takeover session is ${session.status}.`)
  const action = {
    type: args.type,
    payload: args.payload ?? {},
    timestamp: args.timestamp ?? Date.now(),
  }
  await db
    .update(schema.takeoverSessions)
    .set({
      userActions: [...session.userActions, action],
      updatedAt: Date.now(),
    })
    .where(eq(schema.takeoverSessions.id, takeoverSessionId))
  return getTakeoverSession(takeoverSessionId)
}

export async function completeTakeoverSession(args: {
  takeoverSessionId: string
  status?: Extract<TakeoverSessionStatus, 'completed' | 'cancelled'>
  observation?: JsonObject
}): Promise<TakeoverSessionRow> {
  const session = await getTakeoverSession(args.takeoverSessionId)
  if (session.status !== 'active') throw new Error(`Takeover session is ${session.status}.`)
  const now = Date.now()
  await db
    .update(schema.takeoverSessions)
    .set({
      status: args.status ?? 'completed',
      observation: args.observation ?? session.observation,
      updatedAt: now,
      completedAt: now,
    })
    .where(eq(schema.takeoverSessions.id, args.takeoverSessionId))
  return getTakeoverSession(args.takeoverSessionId)
}

export async function listTakeoverSessions(args: {
  runId?: string
  agentProfileId?: string
  status?: TakeoverSessionStatus
  resource?: TakeoverResource
  limit?: number
} = {}): Promise<TakeoverSessionRow[]> {
  const filters = [
    args.runId ? eq(schema.takeoverSessions.runId, args.runId) : undefined,
    args.agentProfileId ? eq(schema.takeoverSessions.agentProfileId, args.agentProfileId) : undefined,
    args.status ? eq(schema.takeoverSessions.status, args.status) : undefined,
    args.resource ? eq(schema.takeoverSessions.resource, args.resource) : undefined,
  ].filter(Boolean)
  return db.query.takeoverSessions.findMany({
    where: filters.length > 0 ? and(...filters) : undefined,
    orderBy: [desc(schema.takeoverSessions.createdAt)],
    limit: Math.min(Math.max(args.limit ?? 100, 1), 500),
  })
}

function normalizeHumanApprovalPolicyConfig(
  config: Partial<HumanApprovalPolicyConfig> | HumanApprovalPolicyConfig | undefined,
): HumanApprovalPolicyConfig {
  return {
    ...DEFAULT_HUMAN_APPROVAL_POLICY_CONFIG,
    ...(config ?? {}),
    batching: {
      ...DEFAULT_HUMAN_APPROVAL_POLICY_CONFIG.batching,
      ...(config?.batching ?? {}),
    },
    autoApproveConditions: config?.autoApproveConditions ?? DEFAULT_HUMAN_APPROVAL_POLICY_CONFIG.autoApproveConditions,
    escalationChain: config?.escalationChain ?? DEFAULT_HUMAN_APPROVAL_POLICY_CONFIG.escalationChain,
  }
}

function timeoutRecommendation(onTimeout: ApprovalOnTimeout): HumanApprovalPolicyEvaluation['recommendation'] {
  if (onTimeout === 'auto_approve') return 'approve'
  if (onTimeout === 'auto_reject') return 'reject'
  if (onTimeout === 'escalate_to_admin') return 'escalate'
  return 'wait'
}

function computeOverallDecision(stepDecisions: PlanStepDecision[]): PlanApprovalOverallDecision {
  if (stepDecisions.some((step) => step.decision === 'rejected')) return 'rejected'
  if (stepDecisions.some((step) => step.decision === 'modified' || step.decision === 'skipped')) {
    return 'approved_with_changes'
  }
  return 'approved'
}

function summarizePlanApproval(
  stepDecisions: PlanStepDecision[],
  overallDecision: PlanApprovalOverallDecision,
): string {
  const counts = stepDecisions.reduce<Record<string, number>>((acc, step) => {
    acc[step.decision] = (acc[step.decision] ?? 0) + 1
    return acc
  }, {})
  return `Plan ${overallDecision}: ${stepDecisions.length} steps reviewed; approved=${counts.approved ?? 0}, modified=${counts.modified ?? 0}, skipped=${counts.skipped ?? 0}, rejected=${counts.rejected ?? 0}.`
}

async function resolveLinkedApprovalRequest(row: PlanApprovalResultRow): Promise<void> {
  if (!row.approvalRequestId) return
  const approval = await db.query.approvalRequests.findFirst({
    where: eq(schema.approvalRequests.id, row.approvalRequestId),
  })
  if (!approval || approval.status !== 'pending') return
  await db
    .update(schema.approvalRequests)
    .set({
      status: row.overallDecision === 'rejected' ? 'rejected' : 'approved',
      response: {
        planApprovalResultId: row.id,
        overallDecision: row.overallDecision,
        stepDecisions: row.stepDecisions,
      },
      resolvedAt: Date.now(),
    })
    .where(eq(schema.approvalRequests.id, row.approvalRequestId))
}

async function getHumanApprovalPolicy(id: string): Promise<HumanApprovalPolicyRow> {
  const row = await db.query.humanApprovalPolicies.findFirst({
    where: eq(schema.humanApprovalPolicies.id, id),
  })
  if (!row) throw new Error(`Human approval policy not found: ${id}`)
  return row
}

async function getTakeoverSession(id: string): Promise<TakeoverSessionRow> {
  const row = await db.query.takeoverSessions.findFirst({
    where: eq(schema.takeoverSessions.id, id),
  })
  if (!row) throw new Error(`Takeover session not found: ${id}`)
  return row
}

function evaluateCondition(condition: string, facts: JsonObject): boolean {
  return condition
    .split(/\s+AND\s+/i)
    .every((part) => evaluateConditionPart(part.trim(), facts))
}

function evaluateConditionPart(condition: string, facts: JsonObject): boolean {
  const match = /^([a-zA-Z0-9_.-]+)\s*(==|!=|>=|<=|>|<)\s*(.+)$/.exec(condition)
  if (!match) return Boolean(getFact(facts, condition))
  const left = getFact(facts, match[1])
  const right = parseLiteral(match[3])
  switch (match[2]) {
    case '==':
      return left === right
    case '!=':
      return left !== right
    case '>':
      return Number(left) > Number(right)
    case '<':
      return Number(left) < Number(right)
    case '>=':
      return Number(left) >= Number(right)
    case '<=':
      return Number(left) <= Number(right)
    default:
      return false
  }
}

function getFact(facts: JsonObject, path: string): unknown {
  return path.split('.').reduce<unknown>((value, key) => {
    if (!value || typeof value !== 'object') return undefined
    return (value as Record<string, unknown>)[key]
  }, facts)
}

function parseLiteral(raw: string): unknown {
  const trimmed = raw.trim()
  if (trimmed === 'true') return true
  if (trimmed === 'false') return false
  if (trimmed === 'null') return null
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) return Number(trimmed)
  const quoted = /^["'](.*)["']$/.exec(trimmed)
  return quoted ? quoted[1] : trimmed
}

function normalizeNullable(value: string | null | undefined): string | null {
  if (value === undefined || value === null) return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}
