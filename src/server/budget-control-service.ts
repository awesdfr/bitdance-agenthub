import { and, desc, eq, gte, lte, type SQL } from 'drizzle-orm'

import { db, schema } from '@/db/client'
import type {
  BudgetControlAction,
  BudgetCostBreakdown,
  BudgetEvaluationRow,
  BudgetEvaluationStatus,
  BudgetLimitType,
  BudgetModelRoutingRule,
  BudgetPolicyConfig,
  BudgetPolicyRow,
  BudgetPolicyStatus,
  BudgetScope,
  BudgetUsageGroupBy,
  BudgetUsageSnapshot,
  JsonObject,
} from '@/db/schema'
import { newBudgetEvaluationId, newBudgetPolicyId } from '@/server/ids'

const DEFAULT_CONFIG: BudgetPolicyConfig = {
  routingRules: [
    {
      condition: 'estimated_steps',
      operator: 'lt',
      value: 3,
      routeTo: 'preferred_low_cost_model',
      reason: 'Short tasks should prefer a lower-cost model when one is configured.',
    },
    {
      condition: 'needs_vision',
      operator: 'equals',
      value: true,
      routeTo: 'preferred_vision_model',
      reason: 'Vision tasks must use a vision-capable model even if it costs more.',
    },
    {
      condition: 'context_length',
      operator: 'gt',
      value: 64000,
      routeTo: 'preferred_large_context_model',
      reason: 'Large-context tasks need a model with enough context window.',
    },
  ],
  estimateFactors: {
    modelUnitPriceUsd: 0.00001,
    averageStepTokens: 2500,
    visionMultiplier: 1.8,
    largeContextMultiplier: 1.4,
    historicalTaskWeight: 0.35,
  },
  reportTags: ['agent', 'project', 'daily', 'monthly'],
}

const DEFAULT_POLICIES: Array<{
  name: string
  scope: BudgetScope
  limitType: BudgetLimitType
  limit: number
  hardCap: boolean
  notifyAtPercent: number
}> = [
  {
    name: 'Default per-task USD hard cap',
    scope: 'per_task',
    limitType: 'usd_amount',
    limit: 2,
    hardCap: true,
    notifyAtPercent: 80,
  },
  {
    name: 'Default per-Agent daily token warning',
    scope: 'per_agent_per_day',
    limitType: 'token_count',
    limit: 200_000,
    hardCap: false,
    notifyAtPercent: 75,
  },
  {
    name: 'Default project monthly USD hard cap',
    scope: 'per_project_per_month',
    limitType: 'usd_amount',
    limit: 100,
    hardCap: true,
    notifyAtPercent: 85,
  },
  {
    name: 'Default global monthly USD hard cap',
    scope: 'global_per_month',
    limitType: 'usd_amount',
    limit: 500,
    hardCap: true,
    notifyAtPercent: 90,
  },
]

export interface BudgetPolicyArgs {
  agentProfileId?: string | null
  projectId?: string | null
  name?: string
  scope?: BudgetScope
  limitType?: BudgetLimitType
  limit: number
  hardCap?: boolean
  notifyAtPercent?: number
  config?: PartialBudgetPolicyConfig
  status?: BudgetPolicyStatus
}

export interface PartialBudgetPolicyConfig {
  routingRules?: BudgetModelRoutingRule[]
  estimateFactors?: Partial<BudgetPolicyConfig['estimateFactors']>
  reportTags?: string[]
}

export interface BudgetEvaluationArgs {
  policyId?: string | null
  scope?: BudgetScope
  agentProfileId?: string | null
  employeeRunId?: string | null
  projectId?: string | null
  observedTokens?: number
  estimatedAdditionalTokens?: number
  observedUsd?: number
  estimatedAdditionalUsd?: number
  selectedModelProfileId?: string | null
  task?: JsonObject
  costBreakdown?: Partial<BudgetCostBreakdown>
}

export interface BudgetUsageReportArgs {
  groupBy?: BudgetUsageGroupBy
  agentProfileId?: string | null
  projectId?: string | null
  from?: number
  to?: number
}

export interface BudgetUsageReportRow {
  key: string
  label: string
  agentProfileId: string | null
  projectId: string | null
  runCount: number
  evaluationCount: number
  blockedCount: number
  notifyCount: number
  estimatedCostUsd: number
  actualCostUsd: number
}

export interface BudgetUsageReport {
  groupBy: BudgetUsageGroupBy
  from: number | null
  to: number | null
  rows: BudgetUsageReportRow[]
  csv: string
}

export async function seedBudgetPolicies(): Promise<BudgetPolicyRow[]> {
  const rows: BudgetPolicyRow[] = []
  for (const policy of DEFAULT_POLICIES) {
    const existing = await db.query.budgetPolicies.findFirst({
      where: eq(schema.budgetPolicies.name, policy.name),
    })
    rows.push(existing ?? (await createBudgetPolicy(policy)))
  }
  return rows
}

export async function createBudgetPolicy(args: BudgetPolicyArgs): Promise<BudgetPolicyRow> {
  const now = Date.now()
  const row = {
    id: newBudgetPolicyId(),
    agentProfileId: normalizeNullable(args.agentProfileId),
    projectId: normalizeNullable(args.projectId),
    name: args.name?.trim() || 'Budget policy',
    scope: args.scope ?? 'per_task',
    limitType: args.limitType ?? 'usd_amount',
    limit: Math.max(0.000001, args.limit),
    hardCap: args.hardCap ?? true,
    notifyAtPercent: clampPercent(args.notifyAtPercent ?? 80),
    config: mergeConfig(args.config),
    status: args.status ?? 'active',
    createdAt: now,
    updatedAt: now,
  } satisfies BudgetPolicyRow
  await db.insert(schema.budgetPolicies).values(row)
  return row
}

export async function listBudgetPolicies(args: {
  scope?: BudgetScope
  status?: BudgetPolicyStatus
  agentProfileId?: string
  projectId?: string
  limit?: number
} = {}): Promise<BudgetPolicyRow[]> {
  const conditions: SQL[] = []
  if (args.scope) conditions.push(eq(schema.budgetPolicies.scope, args.scope))
  if (args.status) conditions.push(eq(schema.budgetPolicies.status, args.status))
  if (args.agentProfileId) conditions.push(eq(schema.budgetPolicies.agentProfileId, args.agentProfileId))
  if (args.projectId) conditions.push(eq(schema.budgetPolicies.projectId, args.projectId))
  return db.query.budgetPolicies.findMany({
    where: conditions.length ? and(...conditions) : undefined,
    orderBy: [desc(schema.budgetPolicies.updatedAt)],
    limit: args.limit ?? 100,
  })
}

export async function evaluateBudget(args: BudgetEvaluationArgs): Promise<BudgetEvaluationRow> {
  const policy = await resolvePolicy(args)
  const usageSnapshot = await buildUsageSnapshot(policy, args)
  const decision = decideBudgetAction(policy, usageSnapshot)
  const routedModelProfileId = routeModelForTask(policy.config.routingRules, args.task)
  const selectedModelProfileId = normalizeNullable(args.selectedModelProfileId ?? readString(args.task, 'modelProfileId'))
  const row = {
    id: newBudgetEvaluationId(),
    policyId: policy.id,
    agentProfileId: normalizeNullable(args.agentProfileId ?? policy.agentProfileId),
    employeeRunId: normalizeNullable(args.employeeRunId),
    projectId: normalizeNullable(args.projectId ?? policy.projectId ?? readString(args.task, 'projectId')),
    scope: policy.scope,
    status: decision.status,
    action: decision.action,
    usageSnapshot,
    costBreakdown: mergeCostBreakdown(args.costBreakdown),
    selectedModelProfileId,
    routedModelProfileId,
    reason: buildDecisionReason(policy, usageSnapshot, decision, routedModelProfileId),
    createdAt: Date.now(),
  } satisfies BudgetEvaluationRow
  await db.insert(schema.budgetEvaluations).values(row)
  return row
}

export async function listBudgetEvaluations(args: {
  policyId?: string
  agentProfileId?: string
  projectId?: string
  status?: BudgetEvaluationStatus
  limit?: number
} = {}): Promise<BudgetEvaluationRow[]> {
  const conditions: SQL[] = []
  if (args.policyId) conditions.push(eq(schema.budgetEvaluations.policyId, args.policyId))
  if (args.agentProfileId) conditions.push(eq(schema.budgetEvaluations.agentProfileId, args.agentProfileId))
  if (args.projectId) conditions.push(eq(schema.budgetEvaluations.projectId, args.projectId))
  if (args.status) conditions.push(eq(schema.budgetEvaluations.status, args.status))
  return db.query.budgetEvaluations.findMany({
    where: conditions.length ? and(...conditions) : undefined,
    orderBy: [desc(schema.budgetEvaluations.createdAt)],
    limit: args.limit ?? 100,
  })
}

export async function buildBudgetUsageReport(
  args: BudgetUsageReportArgs = {},
): Promise<BudgetUsageReport> {
  const groupBy = args.groupBy ?? 'agent'
  const from = args.from ?? null
  const to = args.to ?? null
  const runConditions: SQL[] = []
  if (args.agentProfileId) runConditions.push(eq(schema.employeeRuns.agentProfileId, args.agentProfileId))
  if (from !== null) runConditions.push(gte(schema.employeeRuns.createdAt, from))
  if (to !== null) runConditions.push(lte(schema.employeeRuns.createdAt, to))
  const runs = await db.query.employeeRuns.findMany({
    where: runConditions.length ? and(...runConditions) : undefined,
    orderBy: [desc(schema.employeeRuns.createdAt)],
    limit: 1000,
  })
  const filteredRuns = runs.filter((run) => {
    const projectId = readString(run.input, 'projectId')
    return !args.projectId || projectId === args.projectId
  })

  const evaluationConditions: SQL[] = []
  if (args.agentProfileId) evaluationConditions.push(eq(schema.budgetEvaluations.agentProfileId, args.agentProfileId))
  if (args.projectId) evaluationConditions.push(eq(schema.budgetEvaluations.projectId, args.projectId))
  if (from !== null) evaluationConditions.push(gte(schema.budgetEvaluations.createdAt, from))
  if (to !== null) evaluationConditions.push(lte(schema.budgetEvaluations.createdAt, to))
  const evaluations = await db.query.budgetEvaluations.findMany({
    where: evaluationConditions.length ? and(...evaluationConditions) : undefined,
    orderBy: [desc(schema.budgetEvaluations.createdAt)],
    limit: 1000,
  })

  const rows = new Map<string, BudgetUsageReportRow>()
  for (const run of filteredRuns) {
    const projectId = readString(run.input, 'projectId')
    const bucket = bucketFor(groupBy, run.createdAt, run.agentProfileId, projectId)
    const row = ensureReportRow(rows, bucket, run.agentProfileId, projectId)
    row.runCount += 1
    row.estimatedCostUsd = roundUsd(row.estimatedCostUsd + centsToUsd(run.estimatedCostCents))
    row.actualCostUsd = roundUsd(row.actualCostUsd + centsToUsd(run.actualCostCents))
  }
  for (const evaluation of evaluations) {
    const bucket = bucketFor(groupBy, evaluation.createdAt, evaluation.agentProfileId, evaluation.projectId)
    const row = ensureReportRow(rows, bucket, evaluation.agentProfileId, evaluation.projectId)
    row.evaluationCount += 1
    if (evaluation.status === 'blocked') row.blockedCount += 1
    if (evaluation.status === 'notify') row.notifyCount += 1
  }
  const sortedRows = [...rows.values()].sort((a, b) => a.key.localeCompare(b.key))
  return {
    groupBy,
    from,
    to,
    rows: sortedRows,
    csv: toCsv(sortedRows),
  }
}

async function resolvePolicy(args: BudgetEvaluationArgs): Promise<BudgetPolicyRow> {
  const id = normalizeNullable(args.policyId)
  if (id) {
    const policy = await db.query.budgetPolicies.findFirst({
      where: eq(schema.budgetPolicies.id, id),
    })
    if (!policy) throw new Error(`Budget policy not found: ${id}`)
    return policy
  }
  const scope = args.scope ?? 'per_task'
  const policies = await listBudgetPolicies({ scope, status: 'active', limit: 200 })
  const agentId = normalizeNullable(args.agentProfileId)
  const projectId = normalizeNullable(args.projectId ?? readString(args.task, 'projectId'))
  const exact = policies.find(
    (policy) =>
      (!policy.agentProfileId || policy.agentProfileId === agentId) &&
      (!policy.projectId || policy.projectId === projectId),
  )
  if (exact) return exact
  const global = policies.find((policy) => !policy.agentProfileId && !policy.projectId)
  if (global) return global
  const seeded = await seedBudgetPolicies()
  return seeded.find((policy) => policy.scope === scope) ?? seeded[0]
}

async function buildUsageSnapshot(
  policy: BudgetPolicyRow,
  args: BudgetEvaluationArgs,
): Promise<BudgetUsageSnapshot> {
  const period = resolvePeriod(policy.scope)
  const historical = await calculateHistoricalUsage(policy, args, period)
  const consumedTokens = historical.tokens + Math.max(0, Math.round(args.observedTokens ?? 0))
  const consumedUsd = roundUsd(historical.usd + Math.max(0, args.observedUsd ?? 0))
  const estimatedAdditionalTokens = estimateAdditionalTokens(policy, args)
  const estimatedAdditionalUsd = estimateAdditionalUsd(policy, args, estimatedAdditionalTokens)
  const projectedTokens = consumedTokens + estimatedAdditionalTokens
  const projectedUsd = roundUsd(consumedUsd + estimatedAdditionalUsd)
  const used = policy.limitType === 'token_count' ? projectedTokens : projectedUsd
  return {
    consumedTokens,
    consumedUsd,
    estimatedAdditionalTokens,
    estimatedAdditionalUsd,
    projectedTokens,
    projectedUsd,
    usagePercent: roundPercent((used / Math.max(policy.limit, 0.000001)) * 100),
    periodStartAt: period.startAt,
    periodEndAt: period.endAt,
  }
}

async function calculateHistoricalUsage(
  policy: BudgetPolicyRow,
  args: BudgetEvaluationArgs,
  period: { startAt?: number; endAt?: number },
): Promise<{ tokens: number; usd: number }> {
  const runConditions: SQL[] = []
  if (period.startAt) runConditions.push(gte(schema.employeeRuns.createdAt, period.startAt))
  if (period.endAt) runConditions.push(lte(schema.employeeRuns.createdAt, period.endAt))
  const agentId = normalizeNullable(args.agentProfileId ?? policy.agentProfileId)
  if (policy.scope === 'per_agent_per_day' && agentId) {
    runConditions.push(eq(schema.employeeRuns.agentProfileId, agentId))
  }
  if (policy.scope === 'per_task') {
    const runId = normalizeNullable(args.employeeRunId)
    if (!runId) return { tokens: 0, usd: 0 }
    runConditions.push(eq(schema.employeeRuns.id, runId))
  }
  const runs = await db.query.employeeRuns.findMany({
    where: runConditions.length ? and(...runConditions) : undefined,
    orderBy: [desc(schema.employeeRuns.createdAt)],
    limit: 1000,
  })
  const projectId = normalizeNullable(args.projectId ?? policy.projectId ?? readString(args.task, 'projectId'))
  const scopedRuns = runs.filter((run) => {
    if (policy.scope !== 'per_project_per_month') return true
    return projectId ? readString(run.input, 'projectId') === projectId : true
  })
  const runUsd = scopedRuns.reduce(
    (sum, run) => sum + centsToUsd(run.actualCostCents || run.estimatedCostCents),
    0,
  )

  const routeConditions: SQL[] = []
  if (period.startAt) routeConditions.push(gte(schema.modelRouteDecisions.createdAt, period.startAt))
  if (period.endAt) routeConditions.push(lte(schema.modelRouteDecisions.createdAt, period.endAt))
  if (agentId && policy.scope === 'per_agent_per_day') {
    routeConditions.push(eq(schema.modelRouteDecisions.agentProfileId, agentId))
  }
  const routeDecisions =
    policy.scope === 'per_task' || policy.scope === 'per_project_per_month'
      ? []
      : await db.query.modelRouteDecisions.findMany({
          where: routeConditions.length ? and(...routeConditions) : undefined,
          orderBy: [desc(schema.modelRouteDecisions.createdAt)],
          limit: 1000,
        })
  const routeTokens = routeDecisions.reduce(
    (sum, decision) => sum + decision.estimatedInputTokens + decision.estimatedOutputTokens,
    0,
  )
  const routeUsd = routeDecisions.reduce((sum, decision) => sum + centsToUsd(decision.estimatedCostCents), 0)
  return {
    tokens: routeTokens,
    usd: roundUsd(runUsd > 0 ? runUsd : routeUsd),
  }
}

function estimateAdditionalTokens(policy: BudgetPolicyRow, args: BudgetEvaluationArgs): number {
  const explicit = args.estimatedAdditionalTokens
  if (explicit !== undefined) return Math.max(0, Math.round(explicit))
  const steps = Math.max(1, Math.round(readNumber(args.task, 'estimatedSteps') ?? 1))
  let estimate = steps * policy.config.estimateFactors.averageStepTokens
  if (readBoolean(args.task, 'needsVision')) estimate *= policy.config.estimateFactors.visionMultiplier
  if ((readNumber(args.task, 'contextLength') ?? 0) > 64_000) {
    estimate *= policy.config.estimateFactors.largeContextMultiplier
  }
  return Math.max(0, Math.round(estimate))
}

function estimateAdditionalUsd(
  policy: BudgetPolicyRow,
  args: BudgetEvaluationArgs,
  estimatedAdditionalTokens: number,
): number {
  if (args.estimatedAdditionalUsd !== undefined) return roundUsd(Math.max(0, args.estimatedAdditionalUsd))
  return roundUsd(estimatedAdditionalTokens * policy.config.estimateFactors.modelUnitPriceUsd)
}

function decideBudgetAction(
  policy: BudgetPolicyRow,
  snapshot: BudgetUsageSnapshot,
): { status: BudgetEvaluationStatus; action: BudgetControlAction } {
  if (snapshot.usagePercent >= 100 && policy.hardCap) {
    return { status: 'blocked', action: 'stop_task' }
  }
  if (snapshot.usagePercent >= policy.notifyAtPercent || snapshot.usagePercent >= 100) {
    return { status: 'notify', action: 'notify_user' }
  }
  return { status: 'ok', action: 'allow' }
}

function buildDecisionReason(
  policy: BudgetPolicyRow,
  snapshot: BudgetUsageSnapshot,
  decision: { status: BudgetEvaluationStatus; action: BudgetControlAction },
  routedModelProfileId: string | null,
): string {
  const unit = policy.limitType === 'token_count' ? 'tokens' : 'USD'
  const usage =
    policy.limitType === 'token_count'
      ? `${snapshot.projectedTokens}/${policy.limit} tokens`
      : `$${snapshot.projectedUsd.toFixed(4)}/$${policy.limit.toFixed(4)}`
  const route = routedModelProfileId ? ` Routed model hint: ${routedModelProfileId}.` : ''
  if (decision.status === 'blocked') {
    return `Projected ${unit} usage ${usage} exceeds the hard cap.${route}`
  }
  if (decision.status === 'notify') {
    return `Projected ${unit} usage ${usage} reached ${snapshot.usagePercent}% of the budget.${route}`
  }
  return `Projected ${unit} usage ${usage} is within budget.${route}`
}

function routeModelForTask(
  rules: BudgetModelRoutingRule[],
  task: JsonObject | undefined,
): string | null {
  if (!task) return null
  for (const rule of rules) {
    const value = taskValueForRule(rule.condition, task)
    if (matchesRule(value, rule.operator, rule.value)) return rule.routeTo
  }
  return null
}

function taskValueForRule(condition: BudgetModelRoutingRule['condition'], task: JsonObject): string | number | boolean | null {
  if (condition === 'task_type') return readString(task, 'taskType') ?? readString(task, 'type')
  if (condition === 'estimated_steps') return readNumber(task, 'estimatedSteps')
  if (condition === 'context_length') return readNumber(task, 'contextLength')
  if (condition === 'needs_vision') return readBoolean(task, 'needsVision')
  if (condition === 'time_of_day') {
    const date = new Date(readNumber(task, 'timestamp') ?? Date.now())
    return date.getHours()
  }
  return null
}

function matchesRule(
  value: string | number | boolean | null,
  operator: BudgetModelRoutingRule['operator'],
  expected: string | number | boolean,
): boolean {
  if (value === null) return false
  if (operator === 'equals') return value === expected
  const numericValue = Number(value)
  const numericExpected = Number(expected)
  if (!Number.isFinite(numericValue) || !Number.isFinite(numericExpected)) return false
  if (operator === 'lt') return numericValue < numericExpected
  return numericValue > numericExpected
}

function mergeConfig(input?: PartialBudgetPolicyConfig): BudgetPolicyConfig {
  return {
    routingRules: input?.routingRules ?? DEFAULT_CONFIG.routingRules,
    estimateFactors: {
      ...DEFAULT_CONFIG.estimateFactors,
      ...(input?.estimateFactors ?? {}),
    },
    reportTags: input?.reportTags ?? DEFAULT_CONFIG.reportTags,
  }
}

function mergeCostBreakdown(input?: Partial<BudgetCostBreakdown>): BudgetCostBreakdown {
  return {
    modelCalls: input?.modelCalls ?? [],
    toolExecutions: input?.toolExecutions ?? [],
    cliExecutions: input?.cliExecutions ?? [],
  }
}

function resolvePeriod(scope: BudgetScope): { startAt?: number; endAt?: number } {
  const now = new Date()
  if (scope === 'per_agent_per_day') {
    const start = new Date(now)
    start.setHours(0, 0, 0, 0)
    const end = new Date(start)
    end.setDate(end.getDate() + 1)
    return { startAt: start.getTime(), endAt: end.getTime() }
  }
  if (scope === 'per_project_per_month' || scope === 'global_per_month') {
    const start = new Date(now.getFullYear(), now.getMonth(), 1)
    const end = new Date(now.getFullYear(), now.getMonth() + 1, 1)
    return { startAt: start.getTime(), endAt: end.getTime() }
  }
  return {}
}

function bucketFor(
  groupBy: BudgetUsageGroupBy,
  timestamp: number,
  agentProfileId: string | null,
  projectId: string | null,
): { key: string; label: string } {
  if (groupBy === 'agent') return { key: agentProfileId ?? 'unassigned-agent', label: agentProfileId ?? 'Unassigned Agent' }
  if (groupBy === 'project') return { key: projectId ?? 'unassigned-project', label: projectId ?? 'Unassigned Project' }
  const date = new Date(timestamp)
  if (groupBy === 'day') {
    const key = date.toISOString().slice(0, 10)
    return { key, label: key }
  }
  if (groupBy === 'week') {
    const start = new Date(date)
    start.setDate(date.getDate() - date.getDay())
    start.setHours(0, 0, 0, 0)
    const key = start.toISOString().slice(0, 10)
    return { key, label: `Week of ${key}` }
  }
  const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
  return { key, label: key }
}

function ensureReportRow(
  rows: Map<string, BudgetUsageReportRow>,
  bucket: { key: string; label: string },
  agentProfileId: string | null,
  projectId: string | null,
): BudgetUsageReportRow {
  const existing = rows.get(bucket.key)
  if (existing) return existing
  const row: BudgetUsageReportRow = {
    key: bucket.key,
    label: bucket.label,
    agentProfileId,
    projectId,
    runCount: 0,
    evaluationCount: 0,
    blockedCount: 0,
    notifyCount: 0,
    estimatedCostUsd: 0,
    actualCostUsd: 0,
  }
  rows.set(bucket.key, row)
  return row
}

function toCsv(rows: BudgetUsageReportRow[]): string {
  const header = [
    'key',
    'label',
    'agentProfileId',
    'projectId',
    'runCount',
    'evaluationCount',
    'blockedCount',
    'notifyCount',
    'estimatedCostUsd',
    'actualCostUsd',
  ]
  return [
    header.join(','),
    ...rows.map((row) =>
      [
        row.key,
        row.label,
        row.agentProfileId ?? '',
        row.projectId ?? '',
        row.runCount,
        row.evaluationCount,
        row.blockedCount,
        row.notifyCount,
        row.estimatedCostUsd,
        row.actualCostUsd,
      ]
        .map(csvEscape)
        .join(','),
    ),
  ].join('\n')
}

function csvEscape(value: string | number): string {
  const raw = String(value)
  return raw.includes(',') || raw.includes('"') ? `"${raw.replaceAll('"', '""')}"` : raw
}

function centsToUsd(cents: number): number {
  return cents / 100
}

function roundUsd(value: number): number {
  return Math.round(value * 10_000) / 10_000
}

function roundPercent(value: number): number {
  return Math.round(value * 100) / 100
}

function clampPercent(value: number): number {
  return Math.min(100, Math.max(0.01, value))
}

function normalizeNullable(value?: string | null): string | null {
  const trimmed = value?.trim()
  return trimmed ? trimmed : null
}

function readString(input: JsonObject | undefined, key: string): string | null {
  const value = input?.[key]
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function readNumber(input: JsonObject | undefined, key: string): number | null {
  const value = input?.[key]
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) return Number(value)
  return null
}

function readBoolean(input: JsonObject | undefined, key: string): boolean {
  const value = input?.[key]
  if (typeof value === 'boolean') return value
  if (typeof value === 'string') return value.toLowerCase() === 'true'
  return false
}
