import { and, desc, eq } from 'drizzle-orm'

import { db, schema } from '@/db/client'
import type {
  AgentCloneMemoryMode,
  AgentCloneRecordRow,
  AgentCloneSkillMode,
  AgentComparisonReportRow,
  AgentExperimentStatus,
  AgentProfileRow,
  AgentWhatIfAnalysisRow,
  AgentWhatIfImpactLevel,
  JsonObject,
  MemoryItemRow,
  ModelProfileRow,
} from '@/db/schema'
import { createMemoryItem } from '@/server/agent-memory-service'
import { createAgentProfile } from '@/server/control-plane-service'
import {
  newAgentCloneRecordId,
  newAgentComparisonReportId,
  newAgentWhatIfAnalysisId,
} from '@/server/ids'

export interface CloneAgentProfileArgs {
  name?: string
  nameSuffix?: string
  copyModelConfig?: boolean
  modelProfileId?: string | null
  fallbackModelProfileIds?: string[]
  skillMode?: AgentCloneSkillMode
  memoryMode?: AgentCloneMemoryMode
  copyPermissionConfig?: boolean
  modifications?: JsonObject
  experimentNote?: string
  status?: 'draft' | 'active'
}

export interface AgentCloneResult {
  sourceAgentProfile: AgentProfileRow
  clonedAgentProfile: AgentProfileRow
  cloneRecord: AgentCloneRecordRow
  copiedMemories: MemoryItemRow[]
}

export interface AgentComparisonTask {
  id?: string
  title: string
  input?: JsonObject
}

export interface CompareAgentProfilesArgs {
  leftAgentProfileId: string
  rightAgentProfileId: string
  tasks: AgentComparisonTask[]
  repetitions?: number
}

export interface AnalyzeAgentWhatIfArgs {
  agentProfileId: string
  proposedChanges?: JsonObject
}

interface AgentEstimate {
  model: JsonObject
  skillIds: string[]
  successRate: number
  averageCostPerTask: number
  averageSteps: number
}

interface TaskRunEstimate {
  taskId: string
  taskTitle: string
  repetition: number
  steps: number
  cost: number
  successProbability: number
}

export async function cloneAgentProfile(
  sourceAgentProfileId: string,
  args: CloneAgentProfileArgs,
): Promise<AgentCloneResult> {
  const source = await getRequiredAgentProfile(sourceAgentProfileId)
  const copyModelConfig = args.copyModelConfig ?? true
  const skillMode = args.skillMode ?? 'shared'
  const memoryMode = args.memoryMode ?? 'semantic_only'
  const copyPermissionConfig = args.copyPermissionConfig ?? true
  const recordId = newAgentCloneRecordId()

  const modelProfileId =
    args.modelProfileId !== undefined
      ? normalizeNullable(args.modelProfileId)
      : copyModelConfig
        ? source.modelProfileId
        : null
  if (modelProfileId) await getRequiredModelProfile(modelProfileId)

  const fallbackModelProfileIds = args.fallbackModelProfileIds ?? (copyModelConfig ? source.fallbackModelProfileIds : [])
  for (const fallbackId of fallbackModelProfileIds) {
    await getRequiredModelProfile(fallbackId)
  }

  const { skillIds, skillSnapshotMap } = buildClonedSkillIds(source, skillMode, recordId)
  const cloneName = args.name?.trim() || `${source.name} ${args.nameSuffix ?? '(experiment)'}`
  const clonedAgentProfile = await createAgentProfile({
    name: cloneName,
    role: source.role,
    description: source.description,
    modelProfileId,
    fallbackModelProfileIds,
    skillIds,
    mcpServerIds: [...source.mcpServerIds],
    cliProfileIds: [...source.cliProfileIds],
    softwareProfileIds: [...source.softwareProfileIds],
    memoryPolicy: { ...source.memoryPolicy, clonedFromAgentProfileId: source.id },
    autonomyPolicy: source.autonomyPolicy,
    workstationPolicy: source.workstationPolicy,
    permissionPolicy: copyPermissionConfig ? source.permissionPolicy : {},
    inputContract: source.inputContract,
    outputContract: source.outputContract,
    systemPrompt: source.systemPrompt,
    behaviorRules: [...source.behaviorRules],
    successCriteria: [...source.successCriteria],
    status: args.status ?? 'draft',
  })

  const copiedMemories =
    memoryMode === 'semantic_only'
      ? await cloneSemanticMemories(source.id, clonedAgentProfile.id, recordId)
      : []

  const now = Date.now()
  const modifications: JsonObject = {
    ...(args.modifications ?? {}),
    modelChange: {
      fromModelProfileId: source.modelProfileId,
      toModelProfileId: modelProfileId,
      copiedModelConfig: copyModelConfig,
    },
    skillSnapshotMap,
    permissionCopied: copyPermissionConfig,
    memoryMode,
  }
  const row = {
    id: recordId,
    sourceAgentProfileId: source.id,
    clonedAgentProfileId: clonedAgentProfile.id,
    copiedModelConfig: copyModelConfig,
    skillMode,
    memoryMode,
    copiedPermissionConfig: copyPermissionConfig,
    modifications,
    experimentNote: args.experimentNote?.trim() ?? '',
    copiedMemoryIds: copiedMemories.map((memory) => memory.id),
    status: 'created' as AgentExperimentStatus,
    createdAt: now,
    updatedAt: now,
  }
  await db.insert(schema.agentCloneRecords).values(row)
  const cloneRecord = await getRequiredCloneRecord(recordId)

  return {
    sourceAgentProfile: source,
    clonedAgentProfile,
    cloneRecord,
    copiedMemories,
  }
}

export async function listAgentCloneRecords(args: {
  sourceAgentProfileId?: string
  clonedAgentProfileId?: string
} = {}): Promise<AgentCloneRecordRow[]> {
  const rows = await db.query.agentCloneRecords.findMany({
    orderBy: [desc(schema.agentCloneRecords.createdAt)],
  })
  return rows.filter((row) => {
    if (args.sourceAgentProfileId && row.sourceAgentProfileId !== args.sourceAgentProfileId) return false
    if (args.clonedAgentProfileId && row.clonedAgentProfileId !== args.clonedAgentProfileId) return false
    return true
  })
}

export async function compareAgentProfiles(
  args: CompareAgentProfilesArgs,
): Promise<AgentComparisonReportRow> {
  if (!args.tasks.length) throw new Error('At least one comparison task is required.')
  const repetitions = Math.min(Math.max(args.repetitions ?? 3, 1), 5)
  const leftAgent = await getRequiredAgentProfile(args.leftAgentProfileId)
  const rightAgent = await getRequiredAgentProfile(args.rightAgentProfileId)
  const leftModel = leftAgent.modelProfileId ? await getRequiredModelProfile(leftAgent.modelProfileId) : null
  const rightModel = rightAgent.modelProfileId ? await getRequiredModelProfile(rightAgent.modelProfileId) : null

  const taskResults: JsonObject[] = []
  for (const task of args.tasks) {
    for (let repetition = 1; repetition <= repetitions; repetition += 1) {
      const left = estimateTaskRun(leftAgent, leftModel, task, repetition)
      const right = estimateTaskRun(rightAgent, rightModel, task, repetition)
      taskResults.push({
        taskId: task.id ?? slugify(task.title),
        taskTitle: task.title,
        repetition,
        left,
        right,
        delta: {
          steps: round(right.steps - left.steps, 2),
          cost: round(right.cost - left.cost, 4),
          successProbability: round(right.successProbability - left.successProbability, 4),
        },
      })
    }
  }

  const leftEstimate = summarizeAgentEstimate(leftAgent, leftModel, taskResults, 'left')
  const rightEstimate = summarizeAgentEstimate(rightAgent, rightModel, taskResults, 'right')
  const metrics: JsonObject = {
    left: leftEstimate,
    right: rightEstimate,
    deltas: {
      averageCostPercent: percentDelta(
        leftEstimate.averageCostPerTask,
        rightEstimate.averageCostPerTask,
      ),
      averageStepsPercent: percentDelta(leftEstimate.averageSteps, rightEstimate.averageSteps),
      successRateDelta: round(rightEstimate.successRate - leftEstimate.successRate, 4),
    },
  }
  const summary: JsonObject = buildComparisonSummary(leftAgent, rightAgent, leftEstimate, rightEstimate)
  const now = Date.now()
  const row = {
    id: newAgentComparisonReportId(),
    leftAgentProfileId: leftAgent.id,
    rightAgentProfileId: rightAgent.id,
    tasks: args.tasks.map((task) => ({
      id: task.id ?? slugify(task.title),
      title: task.title,
      input: task.input ?? {},
    })),
    metrics,
    taskResults,
    summary,
    status: 'completed' as AgentExperimentStatus,
    createdAt: now,
    updatedAt: now,
  }
  await db.insert(schema.agentComparisonReports).values(row)
  return getRequiredComparisonReport(row.id)
}

export async function listAgentComparisonReports(args: {
  agentProfileId?: string
} = {}): Promise<AgentComparisonReportRow[]> {
  const rows = await db.query.agentComparisonReports.findMany({
    orderBy: [desc(schema.agentComparisonReports.createdAt)],
  })
  if (!args.agentProfileId) return rows
  return rows.filter(
    (row) =>
      row.leftAgentProfileId === args.agentProfileId || row.rightAgentProfileId === args.agentProfileId,
  )
}

export async function analyzeAgentWhatIf(
  args: AnalyzeAgentWhatIfArgs,
): Promise<AgentWhatIfAnalysisRow> {
  const agent = await getRequiredAgentProfile(args.agentProfileId)
  const proposedChanges = args.proposedChanges ?? {}
  const currentModel = agent.modelProfileId ? await getRequiredModelProfile(agent.modelProfileId) : null
  const proposedModelId = readNullableString(proposedChanges.modelProfileId)
  const proposedModel =
    proposedModelId !== undefined
      ? proposedModelId
        ? await getRequiredModelProfile(proposedModelId)
        : null
      : currentModel
  const affectedWorkflowIds = await findAffectedWorkflowIds(agent.id)
  const impactItems = buildWhatIfImpactItems(agent, currentModel, proposedModel, proposedChanges)
  const summary = summarizeWhatIf(impactItems, affectedWorkflowIds)
  const now = Date.now()
  const row = {
    id: newAgentWhatIfAnalysisId(),
    agentProfileId: agent.id,
    proposedChanges,
    impactItems,
    affectedWorkflowIds,
    summary,
    status: 'completed' as AgentExperimentStatus,
    createdAt: now,
    updatedAt: now,
  }
  await db.insert(schema.agentWhatIfAnalyses).values(row)
  return getRequiredWhatIfAnalysis(row.id)
}

export async function listAgentWhatIfAnalyses(args: {
  agentProfileId?: string
} = {}): Promise<AgentWhatIfAnalysisRow[]> {
  const rows = await db.query.agentWhatIfAnalyses.findMany({
    orderBy: [desc(schema.agentWhatIfAnalyses.createdAt)],
  })
  if (!args.agentProfileId) return rows
  return rows.filter((row) => row.agentProfileId === args.agentProfileId)
}

async function getRequiredAgentProfile(id: string): Promise<AgentProfileRow> {
  const row = await db.query.agentProfiles.findFirst({ where: eq(schema.agentProfiles.id, id) })
  if (!row) throw new Error(`Agent profile not found: ${id}`)
  return row
}

async function getRequiredModelProfile(id: string): Promise<ModelProfileRow> {
  const row = await db.query.modelProfiles.findFirst({ where: eq(schema.modelProfiles.id, id) })
  if (!row) throw new Error(`Model profile not found: ${id}`)
  return row
}

async function getRequiredCloneRecord(id: string): Promise<AgentCloneRecordRow> {
  const row = await db.query.agentCloneRecords.findFirst({
    where: eq(schema.agentCloneRecords.id, id),
  })
  if (!row) throw new Error(`Agent clone record not found: ${id}`)
  return row
}

async function getRequiredComparisonReport(id: string): Promise<AgentComparisonReportRow> {
  const row = await db.query.agentComparisonReports.findFirst({
    where: eq(schema.agentComparisonReports.id, id),
  })
  if (!row) throw new Error(`Agent comparison report not found: ${id}`)
  return row
}

async function getRequiredWhatIfAnalysis(id: string): Promise<AgentWhatIfAnalysisRow> {
  const row = await db.query.agentWhatIfAnalyses.findFirst({
    where: eq(schema.agentWhatIfAnalyses.id, id),
  })
  if (!row) throw new Error(`Agent what-if analysis not found: ${id}`)
  return row
}

async function cloneSemanticMemories(
  sourceAgentProfileId: string,
  clonedAgentProfileId: string,
  recordId: string,
): Promise<MemoryItemRow[]> {
  const memories = await db.query.memoryItems.findMany({
    where: and(
      eq(schema.memoryItems.agentProfileId, sourceAgentProfileId),
      eq(schema.memoryItems.type, 'semantic'),
    ),
    orderBy: [desc(schema.memoryItems.importance), desc(schema.memoryItems.createdAt)],
  })
  const copied: MemoryItemRow[] = []
  for (const memory of memories) {
    copied.push(
      await createMemoryItem({
        agentProfileId: clonedAgentProfileId,
        scope: memory.scope,
        type: memory.type,
        title: memory.title,
        content: memory.content,
        sourceRunId: `agent-clone:${recordId}`,
        embedding: memory.embedding,
        confidence: memory.confidence,
        importance: memory.importance,
        expiresAt: memory.expiresAt,
        readAccess: memory.readAccess,
        writeAccess: memory.writeAccess,
        encryption: memory.encryption,
        containsDataTypes: memory.containsDataTypes,
      }),
    )
  }
  return copied
}

function buildClonedSkillIds(
  source: AgentProfileRow,
  skillMode: AgentCloneSkillMode,
  recordId: string,
): { skillIds: string[]; skillSnapshotMap: JsonObject } {
  if (skillMode === 'none') return { skillIds: [], skillSnapshotMap: {} }
  if (skillMode === 'shared') return { skillIds: [...source.skillIds], skillSnapshotMap: {} }
  const skillSnapshotMap: JsonObject = {}
  const skillIds = source.skillIds.map((skillId) => {
    const snapshotId = `skill_snapshot:${recordId}:${skillId}`
    skillSnapshotMap[skillId] = snapshotId
    return snapshotId
  })
  return { skillIds, skillSnapshotMap }
}

function summarizeAgentEstimate(
  agent: AgentProfileRow,
  model: ModelProfileRow | null,
  taskResults: JsonObject[],
  side: 'left' | 'right',
): AgentEstimate {
  const runs = taskResults
    .map((row) => row[side])
    .filter((row): row is TaskRunEstimate => isTaskRunEstimate(row))
  const cost = average(runs.map((run) => run.cost))
  const steps = average(runs.map((run) => run.steps))
  const successRate = average(runs.map((run) => run.successProbability))
  return {
    model: model
      ? {
          modelProfileId: model.id,
          provider: model.provider,
          model: model.model,
          contextWindow: model.contextWindow,
        }
      : {
          modelProfileId: null,
          provider: 'unconfigured',
          model: 'unconfigured',
          contextWindow: null,
        },
    skillIds: agent.skillIds,
    successRate: round(successRate, 4),
    averageCostPerTask: round(cost, 4),
    averageSteps: round(steps, 2),
  }
}

function estimateTaskRun(
  agent: AgentProfileRow,
  model: ModelProfileRow | null,
  task: AgentComparisonTask,
  repetition: number,
): TaskRunEstimate {
  const complexity = estimateTaskComplexity(task)
  const capabilityBonus =
    agent.skillIds.length * 0.03 +
    agent.cliProfileIds.length * 0.02 +
    agent.mcpServerIds.length * 0.02 +
    agent.softwareProfileIds.length * 0.015
  const modelQuality = estimateModelQuality(model)
  const successProbability = clamp(0.55 + modelQuality * 0.25 + capabilityBonus, 0.45, 0.98)
  const baseSteps = 8 + complexity * 1.8 - capabilityBonus * 8 - modelQuality * 2
  const repetitionVariance = (repetition - 1) * 0.25
  const steps = Math.max(2, Math.round(baseSteps + repetitionVariance))
  const cost = estimateModelCostWeight(model) * (0.04 + complexity * 0.015 + steps * 0.006)
  return {
    taskId: task.id ?? slugify(task.title),
    taskTitle: task.title,
    repetition,
    steps,
    cost: round(cost, 4),
    successProbability: round(successProbability, 4),
  }
}

function buildComparisonSummary(
  leftAgent: AgentProfileRow,
  rightAgent: AgentProfileRow,
  left: AgentEstimate,
  right: AgentEstimate,
): JsonObject {
  const rightSuccessDrop = left.successRate - right.successRate
  const recommendedAgentProfileId =
    right.averageCostPerTask < left.averageCostPerTask && rightSuccessDrop <= 0.05
      ? rightAgent.id
      : leftAgent.id
  return {
    recommendedAgentProfileId,
    recommendedAgentName: recommendedAgentProfileId === rightAgent.id ? rightAgent.name : leftAgent.name,
    reason:
      recommendedAgentProfileId === rightAgent.id
        ? 'Right Agent is cheaper without a material estimated success-rate drop.'
        : 'Left Agent keeps the stronger estimated quality or lower execution risk.',
    sideBySideFields: ['model', 'skills', 'successRate', 'averageCostPerTask', 'averageSteps'],
  }
}

function buildWhatIfImpactItems(
  agent: AgentProfileRow,
  currentModel: ModelProfileRow | null,
  proposedModel: ModelProfileRow | null,
  proposedChanges: JsonObject,
): JsonObject[] {
  const costDelta = percentDelta(estimateModelCostWeight(currentModel), estimateModelCostWeight(proposedModel))
  const latencyDelta = percentDelta(estimateModelLatencyWeight(currentModel), estimateModelLatencyWeight(proposedModel))
  const currentContextWindow = currentModel?.contextWindow ?? readOptionalNumber(proposedChanges.currentContextWindow)
  const proposedContextWindow =
    proposedModel?.contextWindow ?? readOptionalNumber(proposedChanges.contextWindow) ?? currentContextWindow
  const proposedSkillIds = readStringArray(proposedChanges.skillIds) ?? agent.skillIds
  const skillDelta = proposedSkillIds.length - agent.skillIds.length

  return [
    {
      key: 'cost',
      label: 'Estimated cost',
      level: costDelta < -20 ? 'positive' : costDelta > 20 ? 'warning' : 'neutral',
      current: currentModel ? describeModel(currentModel) : 'unconfigured',
      proposed: proposedModel ? describeModel(proposedModel) : 'unconfigured',
      deltaPercent: costDelta,
      message:
        costDelta < 0
          ? `Estimated model cost decreases by ${Math.abs(costDelta)}%.`
          : `Estimated model cost increases by ${costDelta}%.`,
    },
    {
      key: 'latency',
      label: 'Estimated latency',
      level: latencyDelta > 25 ? 'warning' : latencyDelta < -15 ? 'positive' : 'neutral',
      deltaPercent: latencyDelta,
      message:
        latencyDelta >= 0
          ? `Estimated latency increases by ${latencyDelta}%.`
          : `Estimated latency decreases by ${Math.abs(latencyDelta)}%.`,
    },
    {
      key: 'quality',
      label: 'Expected output quality',
      level: estimateModelQuality(proposedModel) + skillDelta * 0.02 < estimateModelQuality(currentModel) - 0.08
        ? 'warning'
        : 'neutral',
      currentSkillCount: agent.skillIds.length,
      proposedSkillCount: proposedSkillIds.length,
      message:
        skillDelta < 0
          ? 'Removing Skills may reduce task quality unless the new model compensates.'
          : 'No material quality drop is predicted from Skills/model changes.',
    },
    {
      key: 'context_window',
      label: 'Context window',
      level:
        currentContextWindow && proposedContextWindow && proposedContextWindow < currentContextWindow
          ? 'risk'
          : 'neutral',
      current: currentContextWindow ?? null,
      proposed: proposedContextWindow ?? null,
      message:
        currentContextWindow && proposedContextWindow && proposedContextWindow < currentContextWindow
          ? `Context window shrinks from ${currentContextWindow} to ${proposedContextWindow}; long historical workflows may be affected.`
          : 'Context window is unchanged or larger.',
    },
    {
      key: 'memory_compatibility',
      label: 'Memory compatibility',
      level: 'positive',
      message: 'Memory compatibility is unaffected because memory records are Agent-scoped and contracts stay stable.',
    },
  ]
}

async function findAffectedWorkflowIds(agentProfileId: string): Promise<string[]> {
  const nodes = await db.query.workflowNodes.findMany({
    where: eq(schema.workflowNodes.agentProfileId, agentProfileId),
  })
  return Array.from(new Set(nodes.map((node) => node.workflowId)))
}

function summarizeWhatIf(impactItems: JsonObject[], affectedWorkflowIds: string[]): JsonObject {
  const levels = impactItems.map((item) => item.level).filter((level): level is AgentWhatIfImpactLevel =>
    ['positive', 'neutral', 'warning', 'risk'].includes(String(level)),
  )
  const riskCount = levels.filter((level) => level === 'risk').length
  const warningCount = levels.filter((level) => level === 'warning').length
  return {
    overallRisk: riskCount > 0 ? 'review_required' : warningCount > 0 ? 'caution' : 'low',
    riskCount,
    warningCount,
    positiveCount: levels.filter((level) => level === 'positive').length,
    affectedWorkflowCount: affectedWorkflowIds.length,
    recommendation:
      riskCount > 0
        ? 'Run A/B comparison before applying this Agent configuration change.'
        : 'Change appears compatible with current Agent contracts.',
  }
}

function estimateTaskComplexity(task: AgentComparisonTask): number {
  const inputSize = JSON.stringify(task.input ?? {}).length
  return clamp(task.title.length / 80 + inputSize / 600, 0.5, 6)
}

function estimateModelCostWeight(model: ModelProfileRow | null): number {
  if (!model) return 1.15
  const provider = model.provider
  const modelName = model.model.toLowerCase()
  if (provider === 'ollama') return 0.08
  if (provider === 'deepseek') return 0.35
  if (provider === 'google') return 0.65
  if (provider === 'openrouter') return 0.75
  if (provider === 'custom' || provider === 'openai-compatible') return 0.8
  if (provider === 'anthropic') return modelName.includes('haiku') ? 0.55 : 0.95
  if (provider === 'openai') return modelName.includes('mini') ? 0.45 : 1
  return 0.85
}

function estimateModelLatencyWeight(model: ModelProfileRow | null): number {
  if (!model) return 1.1
  if (model.provider === 'ollama') return 0.7
  if (model.provider === 'deepseek') return 1.3
  if (model.provider === 'openrouter') return 1.2
  if (model.provider === 'custom' || model.provider === 'openai-compatible') return 1.15
  if (model.provider === 'anthropic') return 1.05
  if (model.provider === 'google') return 0.95
  return 1
}

function estimateModelQuality(model: ModelProfileRow | null): number {
  if (!model) return 0.35
  const modelName = model.model.toLowerCase()
  let score = 0.7
  if (model.provider === 'openai' || model.provider === 'anthropic') score = 0.82
  if (model.provider === 'google') score = 0.78
  if (model.provider === 'deepseek') score = 0.72
  if (model.provider === 'ollama') score = 0.62
  if (modelName.includes('mini') || modelName.includes('small')) score -= 0.08
  if (model.contextWindow && model.contextWindow >= 100000) score += 0.04
  if (model.supportsToolCalling) score += 0.03
  if (model.supportsJsonMode) score += 0.02
  return clamp(score, 0.3, 0.95)
}

function describeModel(model: ModelProfileRow): string {
  return `${model.provider}:${model.model}`
}

function isTaskRunEstimate(value: unknown): value is TaskRunEstimate {
  if (!value || typeof value !== 'object') return false
  const record = value as Record<string, unknown>
  return (
    typeof record.taskId === 'string' &&
    typeof record.steps === 'number' &&
    typeof record.cost === 'number' &&
    typeof record.successProbability === 'number'
  )
}

function readNullableString(value: unknown): string | null | undefined {
  if (value === undefined) return undefined
  if (value === null) return null
  if (typeof value === 'string') return value
  return undefined
}

function readOptionalNumber(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined
  return value
}

function readStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value) || !value.every((item) => typeof item === 'string')) return undefined
  return value
}

function normalizeNullable(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null
  const trimmed = value.trim()
  return trimmed ? trimmed : null
}

function percentDelta(from: number, to: number): number {
  if (from === 0) return to === 0 ? 0 : 100
  return round(((to - from) / from) * 100, 2)
}

function average(values: number[]): number {
  if (!values.length) return 0
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

function round(value: number, decimals: number): number {
  const factor = 10 ** decimals
  return Math.round(value * factor) / factor
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80) || 'task'
}
