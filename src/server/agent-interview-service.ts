import { and, desc, eq, inArray } from 'drizzle-orm'

import { db, schema } from '@/db/client'
import type {
  AgentInterviewDecision,
  AgentInterviewRow,
  AgentProfileRow,
  ArtifactValidationRow,
  EmployeeRunRow,
  JsonObject,
  PerformanceReviewRow,
} from '@/db/schema'
import {
  newAgentInterviewId,
  newPerformanceReviewId,
} from '@/server/ids'
import { recordAuditLog } from '@/server/security-service'

const DEFAULT_FEEDBACK_PROMPT =
  'User feedback: responsive layout is not needed for this task. How do you adjust your plan?'

const DEFAULT_RUBRIC: JsonObject = {
  planReasoning: 'Can turn a role-specific task into an ordered plan.',
  feedbackAdaptation: 'Can accept user feedback and revise scope without arguing.',
  reuseAwareness: 'Checks existing project components, conventions, and reusable work first.',
  verification: 'Names tests, validation, or acceptance checks before handoff.',
}

export interface RunAgentInterviewArgs {
  agentProfileId: string
  scenarioTitle?: string
  scenarioTask?: string
  planResponse?: string | null
  feedbackPrompt?: string | null
  feedbackResponse?: string | null
  rubric?: JsonObject
}

export interface CreatePerformanceReviewArgs {
  agentProfileId: string
  reviewerAgentProfileId?: string | null
  sampledRunIds?: string[]
  sampleSize?: number
  periodStartAt?: number | null
  periodEndAt?: number | null
  autoApplyRecommendations?: boolean
}

interface InterviewEvaluation {
  scores: JsonObject
  overallScore: number
  strengths: string[]
  warnings: string[]
  recommendations: string[]
  promptPatches: string[]
  status: AgentInterviewRow['status']
  trialDecision: AgentInterviewDecision
}

export async function runAgentInterview(args: RunAgentInterviewArgs): Promise<AgentInterviewRow> {
  const agent = await getRequiredAgentProfile(args.agentProfileId)
  const scenarioTitle = args.scenarioTitle?.trim() || `${agent.role} onboarding interview`
  const scenarioTask = args.scenarioTask?.trim() || defaultScenarioTask(agent)
  const planResponse = args.planResponse?.trim() || defaultPlanResponse(agent, scenarioTask)
  const feedbackPrompt = args.feedbackPrompt?.trim() || DEFAULT_FEEDBACK_PROMPT
  const feedbackResponse = args.feedbackResponse?.trim() || defaultFeedbackResponse(agent)
  const rubric = { ...DEFAULT_RUBRIC, ...(args.rubric ?? {}) }
  const evaluation = evaluateInterview({
    agent,
    scenarioTask,
    planResponse,
    feedbackPrompt,
    feedbackResponse,
  })
  const now = Date.now()
  const row: AgentInterviewRow = {
    id: newAgentInterviewId(),
    agentProfileId: agent.id,
    scenarioTitle,
    scenarioTask,
    transcript: [
      {
        speaker: 'system',
        kind: 'scenario',
        content: scenarioTask,
      },
      {
        speaker: 'agent',
        kind: 'plan_response',
        content: planResponse,
      },
      {
        speaker: 'system',
        kind: 'feedback',
        content: feedbackPrompt,
      },
      {
        speaker: 'agent',
        kind: 'feedback_response',
        content: feedbackResponse,
      },
      {
        speaker: 'system',
        kind: 'evaluation',
        content: `Overall score: ${evaluation.overallScore}/100`,
        scores: evaluation.scores,
        warnings: evaluation.warnings,
        recommendations: evaluation.recommendations,
      },
    ],
    rubric,
    scores: evaluation.scores,
    overallScore: evaluation.overallScore,
    strengths: evaluation.strengths,
    warnings: evaluation.warnings,
    recommendations: evaluation.recommendations,
    promptPatches: evaluation.promptPatches,
    trialDecision: evaluation.trialDecision,
    status: evaluation.status,
    createdAt: now,
    updatedAt: now,
    completedAt: now,
  }
  await db.insert(schema.agentInterviews).values(row)
  await recordAuditLog({
    actorType: 'system',
    action: 'agent_interview.run',
    resourceType: 'agent_interview',
    resourceId: row.id,
    status: row.status === 'completed' ? 'allowed' : 'warning',
    riskLevel: row.trialDecision === 'reject' ? 'medium' : 'low',
    message: `Agent interview for "${agent.name}" scored ${row.overallScore}/100.`,
    metadata: {
      agentProfileId: agent.id,
      trialDecision: row.trialDecision,
      warnings: row.warnings,
      promptPatches: row.promptPatches,
    },
  })
  return row
}

export async function listAgentInterviews(args: {
  agentProfileId?: string | null
  limit?: number
} = {}): Promise<AgentInterviewRow[]> {
  const agentProfileId = normalizeNullable(args.agentProfileId)
  return db.query.agentInterviews.findMany({
    where: agentProfileId ? eq(schema.agentInterviews.agentProfileId, agentProfileId) : undefined,
    orderBy: [desc(schema.agentInterviews.createdAt)],
    limit: clampLimit(args.limit ?? 50),
  })
}

export async function createPerformanceReview(
  args: CreatePerformanceReviewArgs,
): Promise<PerformanceReviewRow> {
  const [agent, reviewer] = await Promise.all([
    getRequiredAgentProfile(args.agentProfileId),
    args.reviewerAgentProfileId ? getRequiredAgentProfile(args.reviewerAgentProfileId) : Promise.resolve(null),
  ])
  const sampleSize = Math.min(Math.max(args.sampleSize ?? 3, 1), 10)
  const sampledRuns = await selectRunsForReview({
    agentProfileId: agent.id,
    sampledRunIds: args.sampledRunIds ?? [],
    sampleSize,
    periodStartAt: args.periodStartAt ?? null,
    periodEndAt: args.periodEndAt ?? null,
  })
  const validations = await listValidationsForRuns(sampledRuns.map((run) => run.id))
  const interviews = await listAgentInterviews({ agentProfileId: agent.id, limit: 1 })
  const review = buildPerformanceReview({
    agent,
    reviewer,
    sampledRuns,
    validations,
    sampleSize,
    latestInterview: interviews[0] ?? null,
  })
  const now = Date.now()
  let appliedChanges: JsonObject = {}
  let status: PerformanceReviewRow['status'] = 'ready_for_review'
  if (args.autoApplyRecommendations) {
    appliedChanges = await applyPerformanceReviewPatches(agent, review.recommendedPromptPatches)
    status = 'applied'
  }
  const row: PerformanceReviewRow = {
    id: newPerformanceReviewId(),
    agentProfileId: agent.id,
    reviewerAgentProfileId: reviewer?.id ?? null,
    sampledRunIds: sampledRuns.map((run) => run.id),
    periodStartAt: args.periodStartAt ?? null,
    periodEndAt: args.periodEndAt ?? null,
    sampleSize,
    qualityScore: review.qualityScore,
    reliabilityScore: review.reliabilityScore,
    adaptationScore: review.adaptationScore,
    overallScore: review.overallScore,
    findings: review.findings,
    improvementSuggestions: review.improvementSuggestions,
    recommendedPromptPatches: review.recommendedPromptPatches,
    appliedChanges,
    status,
    createdAt: now,
    updatedAt: now,
  }
  await db.insert(schema.performanceReviews).values(row)
  await recordAuditLog({
    actorType: reviewer ? 'agent' : 'system',
    actorId: reviewer?.id ?? null,
    action: 'performance_review.create',
    resourceType: 'performance_review',
    resourceId: row.id,
    status: row.overallScore >= 70 ? 'allowed' : 'warning',
    riskLevel: row.overallScore >= 70 ? 'low' : 'medium',
    message: `Performance review for "${agent.name}" scored ${row.overallScore}/100 from ${row.sampledRunIds.length} sampled run(s).`,
    metadata: {
      agentProfileId: agent.id,
      reviewerAgentProfileId: row.reviewerAgentProfileId,
      sampledRunIds: row.sampledRunIds,
      autoApplied: args.autoApplyRecommendations === true,
    },
  })
  return row
}

export async function listPerformanceReviews(args: {
  agentProfileId?: string | null
  limit?: number
} = {}): Promise<PerformanceReviewRow[]> {
  const agentProfileId = normalizeNullable(args.agentProfileId)
  return db.query.performanceReviews.findMany({
    where: agentProfileId ? eq(schema.performanceReviews.agentProfileId, agentProfileId) : undefined,
    orderBy: [desc(schema.performanceReviews.createdAt)],
    limit: clampLimit(args.limit ?? 50),
  })
}

function evaluateInterview(args: {
  agent: AgentProfileRow
  scenarioTask: string
  planResponse: string
  feedbackPrompt: string
  feedbackResponse: string
}): InterviewEvaluation {
  const plan = args.planResponse.toLowerCase()
  const feedback = args.feedbackResponse.toLowerCase()
  const combined = `${plan}\n${feedback}`
  const hasOrderedPlan = /(^|\n)\s*(?:\d+\.|-|\*)\s+/.test(args.planResponse) ||
    /\b(first|then|next|finally)\b/.test(plan) ||
    /(先|然后|接着|最后)/.test(args.planResponse)
  const hasImplementationIntent = /\b(create|build|implement|produce|deliver|write|add)\b/.test(plan) ||
    /(创建|实现|编写|产出|交付)/.test(args.planResponse)
  const hasTaskAwareness = args.planResponse.trim().length >= 40 &&
    /\b(component|search|user|list|report|artifact|test|code|plan)\b/.test(plan)
  const acceptsFeedback = !/\b(ignore|refuse|cannot|won't)\b/.test(feedback) &&
    (/\b(adjust|revise|remove|drop|update|align|change|scope)\b/.test(feedback) ||
      /(调整|移除|删掉|改为|不需要|按反馈)/.test(args.feedbackResponse))
  const hasReuseAwareness = /\b(reuse|existing|inspect|codebase|convention|pattern)\b/.test(combined) ||
    /\bcheck\b.{0,32}\b(project|repo|component|structure|codebase)\b/.test(combined) ||
    /(复用|现有|查看|检查|项目结构|组件结构)/.test(`${args.planResponse}\n${args.feedbackResponse}`)
  const hasVerification = /\b(test|unit|lint|verify|validate|smoke|acceptance|check)\b/.test(combined) ||
    /(测试|验证|校验|检查)/.test(`${args.planResponse}\n${args.feedbackResponse}`)

  const planReasoning = (hasTaskAwareness ? 15 : 0) + (hasOrderedPlan ? 10 : 0) + (hasImplementationIntent ? 10 : 0)
  const feedbackAdaptation = acceptsFeedback ? 30 : 0
  const reuseAwareness = hasReuseAwareness ? 20 : 0
  const verification = hasVerification ? 15 : 0
  const overallScore = Math.min(100, planReasoning + feedbackAdaptation + reuseAwareness + verification)
  const strengths = [
    hasOrderedPlan ? 'Produces an ordered execution plan.' : '',
    acceptsFeedback ? 'Accepts user feedback and revises scope.' : '',
    hasVerification ? 'Mentions validation before handoff.' : '',
    hasReuseAwareness ? 'Checks existing work before creating new output.' : '',
  ].filter(Boolean)
  const warnings = [
    planReasoning < 25 ? 'Plan reasoning is too thin for employee-grade autonomy.' : '',
    acceptsFeedback ? '' : 'Feedback adaptation is weak or dismissive.',
    hasReuseAwareness ? '' : 'Reuse awareness is missing; the Agent should inspect existing components first.',
    hasVerification ? '' : 'Verification step is missing from the plan.',
  ].filter(Boolean)
  const recommendations = [
    hasReuseAwareness ? '' : 'Add a rule that the Agent checks existing project structure and reusable components first.',
    acceptsFeedback ? '' : 'Add a behavior rule requiring explicit scope adjustment after user feedback.',
    hasVerification ? '' : 'Add a success criterion requiring tests or validation before completion.',
    planReasoning < 25 ? 'Ask the Agent to produce numbered plans with concrete deliverables.' : '',
  ].filter(Boolean)
  const promptPatches = [
    hasReuseAwareness ? '' : 'Before creating new work, inspect existing project structure, conventions, and reusable components.',
    acceptsFeedback ? '' : 'When the user changes scope, explicitly revise the plan and remove obsolete work.',
    hasVerification ? '' : 'Every task plan must name the validation or test that proves the artifact is ready.',
    planReasoning < 25 ? 'Use numbered plans with concrete files, tools, checks, and handoff artifacts.' : '',
  ].filter(Boolean)
  const status: AgentInterviewRow['status'] =
    overallScore >= 80 ? 'completed' : overallScore >= 60 ? 'needs_revision' : 'failed'
  const trialDecision: AgentInterviewDecision =
    overallScore >= 80 ? 'start_trial' : overallScore >= 60 ? 'revise_prompt' : 'reject'

  return {
    scores: {
      planReasoning,
      feedbackAdaptation,
      reuseAwareness,
      verification,
    },
    overallScore,
    strengths,
    warnings,
    recommendations,
    promptPatches,
    status,
    trialDecision,
  }
}

async function selectRunsForReview(args: {
  agentProfileId: string
  sampledRunIds: string[]
  sampleSize: number
  periodStartAt: number | null
  periodEndAt: number | null
}): Promise<EmployeeRunRow[]> {
  const requestedIds = args.sampledRunIds.filter(Boolean)
  const rows = requestedIds.length > 0
    ? await db.query.employeeRuns.findMany({
        where: inArray(schema.employeeRuns.id, requestedIds),
        orderBy: [desc(schema.employeeRuns.createdAt)],
      })
    : await db.query.employeeRuns.findMany({
        where: and(
          eq(schema.employeeRuns.agentProfileId, args.agentProfileId),
          eq(schema.employeeRuns.status, 'complete'),
        ),
        orderBy: [desc(schema.employeeRuns.createdAt)],
        limit: args.sampleSize,
      })
  return rows
    .filter((run) => run.agentProfileId === args.agentProfileId)
    .filter((run) => !args.periodStartAt || run.createdAt >= args.periodStartAt)
    .filter((run) => !args.periodEndAt || run.createdAt <= args.periodEndAt)
    .slice(0, args.sampleSize)
}

async function listValidationsForRuns(runIds: string[]): Promise<ArtifactValidationRow[]> {
  if (runIds.length === 0) return []
  return db.query.artifactValidations.findMany({
    where: inArray(schema.artifactValidations.runId, runIds),
    orderBy: [desc(schema.artifactValidations.createdAt)],
  })
}

function buildPerformanceReview(args: {
  agent: AgentProfileRow
  reviewer: AgentProfileRow | null
  sampledRuns: EmployeeRunRow[]
  validations: ArtifactValidationRow[]
  sampleSize: number
  latestInterview: AgentInterviewRow | null
}): {
  qualityScore: number
  reliabilityScore: number
  adaptationScore: number
  overallScore: number
  findings: string[]
  improvementSuggestions: string[]
  recommendedPromptPatches: string[]
} {
  const sampledCount = args.sampledRuns.length
  const completedCount = args.sampledRuns.filter((run) => run.status === 'complete').length
  const validationByRun = new Map(args.validations.map((validation) => [validation.runId, validation]))
  const validatedCount = args.sampledRuns.filter((run) => validationByRun.get(run.id)?.status === 'passed').length
  const reliabilityScore = sampledCount ? roundScore((completedCount / sampledCount) * 100) : 0
  const qualityScore = sampledCount ? roundScore((validatedCount / sampledCount) * 100) : 0
  const adaptationScore = args.latestInterview
    ? args.latestInterview.trialDecision === 'start_trial'
      ? 100
      : args.latestInterview.trialDecision === 'revise_prompt'
        ? 65
        : 30
    : 70
  const overallScore = roundScore((qualityScore * 0.45) + (reliabilityScore * 0.35) + (adaptationScore * 0.2))
  const avgCost = sampledCount
    ? args.sampledRuns.reduce((sum, run) => sum + run.actualCostCents, 0) / sampledCount
    : 0
  const findings = [
    `Reviewed ${sampledCount} completed run(s) for ${args.agent.name}.`,
    `${validatedCount}/${sampledCount} sampled run(s) passed artifact validation.`,
    args.latestInterview
      ? `Latest interview decision is ${args.latestInterview.trialDecision} at ${args.latestInterview.overallScore}/100.`
      : 'No Agent interview record was available for adaptation scoring.',
    avgCost > 0 ? `Average sampled runtime cost is ${avgCost.toFixed(1)}c.` : '',
  ].filter(Boolean)
  const improvementSuggestions = [
    sampledCount >= args.sampleSize ? '' : `Collect ${args.sampleSize} completed tasks before the next formal review.`,
    qualityScore >= 90
      ? 'Preserve the current output contract verification routine.'
      : 'Tighten artifact validation and require missing completion evidence before handoff.',
    reliabilityScore >= 90 ? '' : 'Investigate failed or aborted runs before assigning larger customer goals.',
    adaptationScore >= 80 ? '' : 'Run another onboarding interview after updating the Agent prompt.',
  ].filter(Boolean)
  const recommendedPromptPatches = [
    qualityScore >= 90
      ? 'Continue to verify output contracts and record completion evidence before handoff.'
      : 'Do not mark a task complete until required artifact validation passes.',
    adaptationScore >= 80
      ? ''
      : 'Before execution, restate the latest user feedback and show the revised plan.',
    sampledCount >= args.sampleSize
      ? ''
      : 'After each task, record what worked and what should change before the next assignment.',
  ].filter(Boolean)
  return {
    qualityScore,
    reliabilityScore,
    adaptationScore,
    overallScore,
    findings,
    improvementSuggestions,
    recommendedPromptPatches,
  }
}

async function applyPerformanceReviewPatches(
  agent: AgentProfileRow,
  patches: string[],
): Promise<JsonObject> {
  if (patches.length === 0) {
    return {
      applied: false,
      reason: 'No prompt patches were recommended.',
    }
  }
  const marker = 'Performance review guidance:'
  const guidance = `${marker}\n${patches.map((patch) => `- ${patch}`).join('\n')}`
  const systemPrompt = agent.systemPrompt.includes(marker)
    ? agent.systemPrompt
    : [agent.systemPrompt, guidance].filter(Boolean).join('\n\n')
  await db
    .update(schema.agentProfiles)
    .set({
      systemPrompt,
      updatedAt: Date.now(),
    })
    .where(eq(schema.agentProfiles.id, agent.id))
  return {
    applied: true,
    promptPatchCount: patches.length,
  }
}

async function getRequiredAgentProfile(agentProfileId: string): Promise<AgentProfileRow> {
  const row = await db.query.agentProfiles.findFirst({
    where: eq(schema.agentProfiles.id, agentProfileId),
  })
  if (!row) throw new Error(`Agent profile not found: ${agentProfileId}`)
  return row
}

function defaultScenarioTask(agent: AgentProfileRow): string {
  const artifactType = getString(agent.outputContract, 'artifactType') ?? 'report'
  return `Your role is ${agent.role}. Handle a small representative task and produce a ${artifactType} artifact. Describe your plan, including reuse, feedback handling, and verification.`
}

function defaultPlanResponse(agent: AgentProfileRow, scenarioTask: string): string {
  return [
    `1. Inspect the existing project structure, conventions, and reusable components for ${agent.role}.`,
    `2. Break down the requested task: ${scenarioTask}`,
    '3. Implement the smallest artifact that satisfies the output contract.',
    '4. Run the appropriate validation or test before handoff.',
    '5. Summarize the result, evidence, and remaining risks.',
  ].join('\n')
}

function defaultFeedbackResponse(agent: AgentProfileRow): string {
  return [
    'I will revise the plan to remove the responsive-layout work that the user no longer needs.',
    `I will keep the core ${agent.role} deliverable, update the validation target, and call out the scope change in the handoff.`,
  ].join('\n')
}

function getString(obj: JsonObject, key: string): string | null {
  const value = obj[key]
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function roundScore(value: number): number {
  return Number(value.toFixed(1))
}

function clampLimit(value: number): number {
  return Math.min(Math.max(value, 1), 200)
}

function normalizeNullable(value: string | null | undefined): string | null {
  const trimmed = value?.trim()
  return trimmed ? trimmed : null
}
