import { desc, eq } from 'drizzle-orm'

import { db, schema } from '@/db/client'
import type {
  AgentDiaryEntryRow,
  AgentProfileRow,
  AgentRetirementPlanRow,
  AgentRetirementStatus,
  ArtifactValidationRow,
  ContinuationPlanRow,
  ContinuationPlanStatus,
  EmployeeRunRow,
  JsonObject,
  KnowledgeTransferPackageRow,
  KnowledgeTransferReceiverHandling,
  LearningEventRow,
  MemoryItemRow,
  PlaybookRow,
  RunReflectionRow,
} from '@/db/schema'
import {
  newAgentDiaryEntryId,
  newAgentRetirementPlanId,
  newContinuationPlanId,
  newKnowledgeTransferPackageId,
  newMemoryItemId,
  newPlaybookId,
  newPlaybookVersionId,
} from '@/server/ids'
import { recordAuditLog } from '@/server/security-service'

export interface CreateAgentDiaryEntryArgs {
  agentProfileId?: string | null
  employeeRunId?: string | null
  workflowRunId?: string | null
  entryType?: AgentDiaryEntryRow['entryType']
  title: string
  content: string
  nextActions?: string[]
  blockers?: string[]
  tags?: string[]
  importance?: number
}

export interface CreateContinuationPlanArgs {
  agentProfileId?: string | null
  sourceRunId?: string | null
  workflowRunId?: string | null
  status?: ContinuationPlanStatus
  title: string
  summary: string
  nextSteps?: string[]
  resumeInput?: JsonObject
  requiredCapabilityRefs?: JsonObject[]
  dueAt?: number | null
}

export interface CreateAgentRetirementPlanArgs {
  agentProfileId: string
  targetAgentProfileId?: string | null
  status?: AgentRetirementStatus
  taskHandling?: JsonObject
  knowledgeExtraction?: JsonObject
  cleanupPolicy?: JsonObject
}

export interface CreateKnowledgeTransferPackageArgs {
  fromAgentProfileId: string
  toAgentProfileId: string
  retirementPlanId?: string | null
  receiverHandling?: KnowledgeTransferReceiverHandling
  transferItems?: JsonObject
}

export async function createAgentDiaryEntry(
  args: CreateAgentDiaryEntryArgs,
): Promise<AgentDiaryEntryRow> {
  const row = {
    id: newAgentDiaryEntryId(),
    agentProfileId: normalizeNullable(args.agentProfileId),
    employeeRunId: normalizeNullable(args.employeeRunId),
    workflowRunId: normalizeNullable(args.workflowRunId),
    entryType: args.entryType ?? 'run_summary',
    title: args.title.trim(),
    content: args.content.trim(),
    nextActions: args.nextActions ?? [],
    blockers: args.blockers ?? [],
    tags: args.tags ?? [],
    importance: clampImportance(args.importance ?? 0.5),
    createdAt: Date.now(),
  }
  await db.insert(schema.agentDiaryEntries).values(row)
  return row
}

export async function createContinuationPlan(
  args: CreateContinuationPlanArgs,
): Promise<ContinuationPlanRow> {
  const now = Date.now()
  const row = {
    id: newContinuationPlanId(),
    agentProfileId: normalizeNullable(args.agentProfileId),
    sourceRunId: normalizeNullable(args.sourceRunId),
    workflowRunId: normalizeNullable(args.workflowRunId),
    status: args.status ?? 'open',
    title: args.title.trim(),
    summary: args.summary.trim(),
    nextSteps: args.nextSteps ?? [],
    resumeInput: args.resumeInput ?? {},
    requiredCapabilityRefs: args.requiredCapabilityRefs ?? [],
    dueAt: args.dueAt ?? null,
    createdAt: now,
    updatedAt: now,
    completedAt: args.status === 'completed' ? now : null,
  }
  await db.insert(schema.continuationPlans).values(row)
  return row
}

export async function createAgentRetirementPlan(
  args: CreateAgentRetirementPlanArgs,
): Promise<AgentRetirementPlanRow> {
  const agent = await getRequiredAgentProfile(args.agentProfileId)
  const targetAgent = args.targetAgentProfileId
    ? await getRequiredAgentProfile(args.targetAgentProfileId)
    : null
  const now = Date.now()
  const analysis = await analyzeAgentRetirement(agent.id)
  const row: AgentRetirementPlanRow = {
    id: newAgentRetirementPlanId(),
    agentProfileId: agent.id,
    targetAgentProfileId: targetAgent?.id ?? null,
    status: args.status ?? 'ready_for_review',
    taskHandling: {
      running: targetAgent ? 'handoff' : 'cancel',
      queued: targetAgent ? 'handoff' : 'cancel',
      continuationPlans: targetAgent ? 'transfer' : 'cancel',
      schedules: targetAgent ? 'retarget' : 'pause',
      ...normalizeObject(args.taskHandling),
    },
    knowledgeExtraction: {
      exportMemories: true,
      exportPlaybooks: true,
      exportDecisionTrail: true,
      generateRetirementReport: true,
      ...normalizeObject(args.knowledgeExtraction),
    },
    cleanupPolicy: {
      workspace: 'retain',
      credentials: 'revoke_after_review',
      logs: 'retain_for_audit',
      destructiveCleanup: false,
      ...normalizeObject(args.cleanupPolicy),
    },
    analysis,
    retirementReport: buildRetirementReport(agent, targetAgent, analysis),
    farewellMessage: buildFarewellMessage(agent, targetAgent, analysis),
    createdAt: now,
    updatedAt: now,
    completedAt: args.status === 'completed' ? now : null,
  }
  await db.insert(schema.agentRetirementPlans).values(row)
  await recordAuditLog({
    actorType: 'system',
    action: 'agent_retirement.create',
    resourceType: 'agent_retirement_plan',
    resourceId: row.id,
    status: 'warning',
    riskLevel: 'medium',
    message: `Created retirement plan for ${agent.name}.`,
    metadata: {
      agentProfileId: agent.id,
      targetAgentProfileId: targetAgent?.id ?? null,
      memoryCount: getNumber(analysis, 'memoryCount'),
      playbookCount: getNumber(analysis, 'playbookCount'),
    },
  })
  return row
}

export async function completeAgentRetirementPlan(id: string): Promise<AgentRetirementPlanRow> {
  const plan = await getRequiredAgentRetirementPlan(id)
  const now = Date.now()
  await db
    .update(schema.agentRetirementPlans)
    .set({
      status: 'completed',
      updatedAt: now,
      completedAt: now,
    })
    .where(eq(schema.agentRetirementPlans.id, plan.id))
  await recordAuditLog({
    actorType: 'system',
    action: 'agent_retirement.complete',
    resourceType: 'agent_retirement_plan',
    resourceId: plan.id,
    status: 'warning',
    riskLevel: 'medium',
    message: 'Marked Agent retirement plan complete without destructive cleanup.',
    metadata: {
      agentProfileId: plan.agentProfileId,
      targetAgentProfileId: plan.targetAgentProfileId,
      destructiveCleanup: false,
    },
  })
  return getRequiredAgentRetirementPlan(plan.id)
}

export async function listAgentRetirementPlans(args: {
  agentProfileId?: string
  targetAgentProfileId?: string
  status?: AgentRetirementStatus
  limit?: number
} = {}): Promise<AgentRetirementPlanRow[]> {
  const rows = await db.query.agentRetirementPlans.findMany({
    orderBy: [desc(schema.agentRetirementPlans.createdAt)],
    limit: args.limit ?? 100,
  })
  return rows.filter((row) => {
    if (args.agentProfileId && row.agentProfileId !== args.agentProfileId) return false
    if (args.targetAgentProfileId && row.targetAgentProfileId !== args.targetAgentProfileId) {
      return false
    }
    if (args.status && row.status !== args.status) return false
    return true
  })
}

export async function createKnowledgeTransferPackage(
  args: CreateKnowledgeTransferPackageArgs,
): Promise<KnowledgeTransferPackageRow> {
  const fromAgent = await getRequiredAgentProfile(args.fromAgentProfileId)
  const toAgent = await getRequiredAgentProfile(args.toAgentProfileId)
  if (fromAgent.id === toAgent.id) {
    throw new Error('Knowledge transfer requires two different Agent profiles.')
  }
  if (args.retirementPlanId) {
    await getRequiredAgentRetirementPlan(args.retirementPlanId)
  }

  const transferItems = normalizeTransferItems(args.transferItems)
  const receiverHandling = args.receiverHandling ?? 'review_each'
  const selectedMemories = await selectTransferMemories(fromAgent.id, transferItems, receiverHandling)
  const selectedPlaybooks = await selectTransferPlaybooks(fromAgent.id, transferItems)
  const shouldClone = receiverHandling !== 'review_each'
  const createdMemoryIds = shouldClone
    ? await cloneMemoriesForAgent(selectedMemories, toAgent.id)
    : []
  const createdPlaybookIds = shouldClone
    ? await clonePlaybooksForAgent(selectedPlaybooks, toAgent.id)
    : []

  const now = Date.now()
  const row: KnowledgeTransferPackageRow = {
    id: newKnowledgeTransferPackageId(),
    retirementPlanId: normalizeNullable(args.retirementPlanId),
    fromAgentProfileId: fromAgent.id,
    toAgentProfileId: toAgent.id,
    status: shouldClone ? 'completed' : 'pending_review',
    receiverHandling,
    transferItems,
    memoryItemIds: selectedMemories.map((memory) => memory.id),
    playbookIds: selectedPlaybooks.map((playbook) => playbook.id),
    createdMemoryItemIds: createdMemoryIds,
    createdPlaybookIds,
    summary: {
      selectedMemories: selectedMemories.length,
      selectedPlaybooks: selectedPlaybooks.length,
      createdMemories: createdMemoryIds.length,
      createdPlaybooks: createdPlaybookIds.length,
      excludedMistakes: transferItems.excludeMistakes,
      receiverHandling,
    },
    createdAt: now,
    updatedAt: now,
    completedAt: shouldClone ? now : null,
  }
  await db.insert(schema.knowledgeTransferPackages).values(row)
  await recordAuditLog({
    actorType: 'system',
    action: 'knowledge_transfer.create',
    resourceType: 'knowledge_transfer_package',
    resourceId: row.id,
    status: shouldClone ? 'allowed' : 'warning',
    riskLevel: shouldClone ? 'low' : 'medium',
    message: `Prepared knowledge transfer from ${fromAgent.name} to ${toAgent.name}.`,
    metadata: row.summary,
  })
  return row
}

export async function listKnowledgeTransferPackages(args: {
  fromAgentProfileId?: string
  toAgentProfileId?: string
  retirementPlanId?: string
  status?: KnowledgeTransferPackageRow['status']
  limit?: number
} = {}): Promise<KnowledgeTransferPackageRow[]> {
  const rows = await db.query.knowledgeTransferPackages.findMany({
    orderBy: [desc(schema.knowledgeTransferPackages.createdAt)],
    limit: args.limit ?? 100,
  })
  return rows.filter((row) => {
    if (args.fromAgentProfileId && row.fromAgentProfileId !== args.fromAgentProfileId) return false
    if (args.toAgentProfileId && row.toAgentProfileId !== args.toAgentProfileId) return false
    if (args.retirementPlanId && row.retirementPlanId !== args.retirementPlanId) return false
    if (args.status && row.status !== args.status) return false
    return true
  })
}

export async function recordRunContinuity(args: {
  run: EmployeeRunRow
  agent: AgentProfileRow
  reflection: RunReflectionRow | null
  artifactValidation: ArtifactValidationRow | null
  learningEvent: LearningEventRow | null
}): Promise<{ diaryEntry: AgentDiaryEntryRow; continuationPlan: ContinuationPlanRow }> {
  const artifactType = getString(args.agent.outputContract, 'artifactType') ?? 'artifact'
  const blockers = args.run.error ? [args.run.error] : args.reflection?.whatFailed ?? []
  const nextActions = buildNextActions(args.run, artifactType, blockers)
  const tags = [
    args.run.status,
    args.agent.role,
    artifactType,
    args.run.workflowRunId ? 'workflow' : 'standalone',
  ].filter(Boolean)
  const content = [
    `Goal: ${args.run.goal}`,
    `Outcome: ${args.run.status}`,
    `Current phase: ${args.run.currentPhase}`,
    `Required artifact: ${artifactType}`,
    `Validation: ${args.artifactValidation?.status ?? 'not_recorded'}`,
    `Reflection: ${args.reflection?.id ?? 'not_recorded'}`,
    `Learning event: ${args.learningEvent?.id ?? 'not_recorded'}`,
  ].join('\n')

  const diaryEntry = await createAgentDiaryEntry({
    agentProfileId: args.agent.id,
    employeeRunId: args.run.id,
    workflowRunId: args.run.workflowRunId,
    entryType: blockers.length > 0 ? 'blocker' : 'run_summary',
    title: `${args.agent.name}: ${truncate(args.run.goal, 96)}`,
    content,
    nextActions,
    blockers,
    tags,
    importance: blockers.length > 0 ? 0.9 : 0.7,
  })

  const continuationPlan = await createContinuationPlan({
    agentProfileId: args.agent.id,
    sourceRunId: args.run.id,
    workflowRunId: args.run.workflowRunId,
    status: 'open',
    title: `Continue ${args.agent.role}: ${truncate(args.run.goal, 80)}`,
    summary: blockers.length > 0
      ? `Resolve ${blockers.length} blocker(s), then resume from the latest checkpoint.`
      : `Continue from the deterministic runtime handoff for ${artifactType}.`,
    nextSteps: nextActions,
    resumeInput: {
      goal: args.run.goal,
      previousRunId: args.run.id,
      workflowRunId: args.run.workflowRunId,
      requiredArtifact: args.agent.outputContract,
      context: args.run.output ?? {},
    },
    requiredCapabilityRefs: buildRequiredCapabilityRefs(args.agent),
  })

  return { diaryEntry, continuationPlan }
}

export async function listAgentDiaryEntries(args: {
  agentProfileId?: string
  employeeRunId?: string
  limit?: number
} = {}): Promise<AgentDiaryEntryRow[]> {
  const rows = await db.query.agentDiaryEntries.findMany({
    orderBy: [desc(schema.agentDiaryEntries.createdAt)],
    limit: args.limit ?? 100,
  })
  return rows.filter((row) => {
    if (args.agentProfileId && row.agentProfileId !== args.agentProfileId) return false
    if (args.employeeRunId && row.employeeRunId !== args.employeeRunId) return false
    return true
  })
}

export async function listContinuationPlans(args: {
  agentProfileId?: string
  sourceRunId?: string
  status?: ContinuationPlanStatus
  limit?: number
} = {}): Promise<ContinuationPlanRow[]> {
  const rows = await db.query.continuationPlans.findMany({
    orderBy: [desc(schema.continuationPlans.createdAt)],
    limit: args.limit ?? 100,
  })
  return rows.filter((row) => {
    if (args.agentProfileId && row.agentProfileId !== args.agentProfileId) return false
    if (args.sourceRunId && row.sourceRunId !== args.sourceRunId) return false
    if (args.status && row.status !== args.status) return false
    return true
  })
}

export async function getContinuationPlan(id: string): Promise<ContinuationPlanRow | null> {
  const trimmed = id.trim()
  if (!trimmed) return null
  const row = await db.query.continuationPlans.findFirst({
    where: eq(schema.continuationPlans.id, trimmed),
  })
  return row ?? null
}

export async function getRequiredContinuationPlan(id: string): Promise<ContinuationPlanRow> {
  const row = await getContinuationPlan(id)
  if (!row) throw new Error(`Continuation plan not found: ${id}`)
  return row
}

export async function updateContinuationPlanStatus(
  id: string,
  status: ContinuationPlanStatus,
): Promise<ContinuationPlanRow> {
  const now = Date.now()
  await db
    .update(schema.continuationPlans)
    .set({
      status,
      updatedAt: now,
      completedAt: status === 'completed' || status === 'canceled' ? now : null,
    })
    .where(eq(schema.continuationPlans.id, id))
  const row = await db.query.continuationPlans.findFirst({
    where: eq(schema.continuationPlans.id, id),
  })
  if (!row) throw new Error(`Continuation plan not found: ${id}`)
  return row
}

async function getRequiredAgentProfile(id: string): Promise<AgentProfileRow> {
  const row = await db.query.agentProfiles.findFirst({
    where: eq(schema.agentProfiles.id, id.trim()),
  })
  if (!row) throw new Error(`Agent profile not found: ${id}`)
  return row
}

async function getRequiredAgentRetirementPlan(id: string): Promise<AgentRetirementPlanRow> {
  const row = await db.query.agentRetirementPlans.findFirst({
    where: eq(schema.agentRetirementPlans.id, id.trim()),
  })
  if (!row) throw new Error(`Agent retirement plan not found: ${id}`)
  return row
}

async function analyzeAgentRetirement(agentProfileId: string): Promise<JsonObject> {
  const memories = await db.query.memoryItems.findMany({
    where: eq(schema.memoryItems.agentProfileId, agentProfileId),
    limit: 5000,
  })
  const playbooks = await db.query.playbooks.findMany({
    where: eq(schema.playbooks.agentProfileId, agentProfileId),
    limit: 1000,
  })
  const runs = await db.query.employeeRuns.findMany({
    where: eq(schema.employeeRuns.agentProfileId, agentProfileId),
    limit: 5000,
  })
  const continuationPlans = await db.query.continuationPlans.findMany({
    where: eq(schema.continuationPlans.agentProfileId, agentProfileId),
    limit: 1000,
  })
  const taskItems = await db.query.taskQueueItems.findMany({
    limit: 5000,
  })
  const agentTaskItems = taskItems.filter((item) => {
    const directAgentId = getString(item.payload, 'agentProfileId')
    const nestedAgentId = objectAt(item.payload, 'agent')?.id
    return directAgentId === agentProfileId || nestedAgentId === agentProfileId
  })
  const completedRuns = runs.filter((run) => run.status === 'complete').length
  const failedRuns = runs.filter((run) => run.status === 'failed' || run.status === 'aborted').length
  const runningRuns = runs.filter((run) => run.status === 'running' || run.status === 'paused').length
  const queuedRuns = runs.filter((run) => run.status === 'queued').length
  const activeContinuationPlans = continuationPlans.filter((plan) =>
    plan.status === 'open' || plan.status === 'in_progress',
  ).length
  return {
    memoryCount: memories.length,
    playbookCount: playbooks.length,
    runCount: runs.length,
    completedRuns,
    failedRuns,
    runningRuns,
    queuedRuns,
    activeContinuationPlans,
    queuedTaskItems: agentTaskItems.filter((item) => item.status === 'queued').length,
    scheduledTaskItems: agentTaskItems.length,
    topMemoryTitles: memories
      .slice()
      .sort((a, b) => b.importance - a.importance)
      .slice(0, 5)
      .map((memory) => memory.title),
    activePlaybookTitles: playbooks
      .filter((playbook) => playbook.status === 'active')
      .slice(0, 5)
      .map((playbook) => playbook.title),
    mistakeTitles: memories
      .filter((memory) => memory.type === 'mistake')
      .slice(0, 5)
      .map((memory) => memory.title),
  }
}

function buildRetirementReport(
  agent: AgentProfileRow,
  targetAgent: AgentProfileRow | null,
  analysis: JsonObject,
): JsonObject {
  const completedRuns = getNumber(analysis, 'completedRuns')
  const failedRuns = getNumber(analysis, 'failedRuns')
  const totalClosedRuns = completedRuns + failedRuns
  const successRate = totalClosedRuns === 0 ? null : Number((completedRuns / totalClosedRuns).toFixed(4))
  const serviceDays = Math.max(
    0,
    Math.ceil((Date.now() - agent.createdAt) / (24 * 60 * 60 * 1000)),
  )
  return {
    agentName: agent.name,
    role: agent.role,
    targetAgentName: targetAgent?.name ?? null,
    statistics: {
      serviceDays,
      memoryCount: getNumber(analysis, 'memoryCount'),
      playbookCount: getNumber(analysis, 'playbookCount'),
      completedRuns,
      failedRuns,
      successRate,
      activeContinuationPlans: getNumber(analysis, 'activeContinuationPlans'),
    },
    highlights: stringArray(analysis.topMemoryTitles).slice(0, 3),
    lessons: stringArray(analysis.mistakeTitles).slice(0, 3),
    recommendedNextSteps: [
      targetAgent ? `Transfer selected knowledge to ${targetAgent.name}.` : 'Choose a receiving Agent before retirement.',
      'Review open continuation plans and queued tasks.',
      'Confirm workspace, credential, and audit-log cleanup policy before destructive actions.',
    ],
  }
}

function buildFarewellMessage(
  agent: AgentProfileRow,
  targetAgent: AgentProfileRow | null,
  analysis: JsonObject,
): string {
  const completedRuns = getNumber(analysis, 'completedRuns')
  const target = targetAgent ? ` Knowledge transfer target: ${targetAgent.name}.` : ''
  return [
    `Agent ${agent.name} is ready for retirement review.`,
    `It has ${getNumber(analysis, 'memoryCount')} memories, ${getNumber(analysis, 'playbookCount')} playbooks, and ${completedRuns} completed runs.`,
    `${target} Its workspace and logs are retained until the cleanup policy is explicitly approved.`,
  ].join(' ')
}

interface NormalizedTransferItems extends JsonObject {
  allMemories: boolean
  allPlaybooks: boolean
  memoriesByType: string[]
  memoriesByProject: string[]
  memoriesByCustomer: string[]
  minimumConfidence: number
  minimumImportance: number
  excludeMistakes: boolean
  excludeLowConfidence: boolean
}

function normalizeTransferItems(value: JsonObject | undefined): NormalizedTransferItems {
  const input = normalizeObject(value)
  return {
    allMemories: booleanAt(input, 'allMemories', true),
    allPlaybooks: booleanAt(input, 'allPlaybooks', true),
    memoriesByType: stringArray(input.memoriesByType),
    memoriesByProject: stringArray(input.memoriesByProject),
    memoriesByCustomer: stringArray(input.memoriesByCustomer),
    minimumConfidence: clampNumber(numberAt(input, 'minimumConfidence', 0), 0, 1),
    minimumImportance: clampNumber(numberAt(input, 'minimumImportance', 0), 0, 1),
    excludeMistakes: booleanAt(input, 'excludeMistakes', false),
    excludeLowConfidence: booleanAt(input, 'excludeLowConfidence', false),
  }
}

async function selectTransferMemories(
  agentProfileId: string,
  items: NormalizedTransferItems,
  receiverHandling: KnowledgeTransferReceiverHandling,
): Promise<MemoryItemRow[]> {
  if (!items.allMemories && items.memoriesByType.length === 0) return []
  const minConfidence = receiverHandling === 'accept_high_confidence'
    ? Math.max(items.minimumConfidence, 0.8)
    : items.minimumConfidence
  const rows = await db.query.memoryItems.findMany({
    where: eq(schema.memoryItems.agentProfileId, agentProfileId),
    orderBy: [desc(schema.memoryItems.importance)],
    limit: 5000,
  })
  return rows.filter((memory) => {
    if (items.excludeMistakes && memory.type === 'mistake') return false
    if (items.excludeLowConfidence && memory.confidence < 0.5) return false
    if (memory.confidence < minConfidence) return false
    if (memory.importance < items.minimumImportance) return false
    if (!items.allMemories && !items.memoriesByType.includes(memory.type)) return false
    if (!matchesTerms(memory, items.memoriesByProject)) return false
    if (!matchesTerms(memory, items.memoriesByCustomer)) return false
    return true
  })
}

async function selectTransferPlaybooks(
  agentProfileId: string,
  items: NormalizedTransferItems,
): Promise<PlaybookRow[]> {
  if (!items.allPlaybooks) return []
  return db.query.playbooks.findMany({
    where: eq(schema.playbooks.agentProfileId, agentProfileId),
    orderBy: [desc(schema.playbooks.updatedAt)],
    limit: 1000,
  })
}

async function cloneMemoriesForAgent(
  memories: MemoryItemRow[],
  toAgentProfileId: string,
): Promise<string[]> {
  const now = Date.now()
  const rows = memories.map((memory) => ({
    id: newMemoryItemId(),
    agentProfileId: toAgentProfileId,
    scope: memory.scope,
    type: memory.type,
    title: memory.title,
    content: `${memory.content}\n\nTransferred from Agent ${memory.agentProfileId ?? 'unknown'} via knowledge transfer.`,
    sourceRunId: memory.sourceRunId,
    embedding: memory.embedding,
    confidence: memory.confidence,
    importance: memory.importance,
    createdAt: now,
    updatedAt: now,
    expiresAt: memory.expiresAt,
  }))
  if (rows.length) await db.insert(schema.memoryItems).values(rows)
  return rows.map((row) => row.id)
}

async function clonePlaybooksForAgent(
  playbooks: PlaybookRow[],
  toAgentProfileId: string,
): Promise<string[]> {
  const createdIds: string[] = []
  for (const playbook of playbooks) {
    const now = Date.now()
    const newPlaybook = {
      id: newPlaybookId(),
      agentProfileId: toAgentProfileId,
      title: playbook.title,
      description: `${playbook.description}\n\nTransferred from Agent ${playbook.agentProfileId ?? 'unknown'}.`.trim(),
      status: playbook.status,
      sourceLearningEventId: playbook.sourceLearningEventId,
      createdAt: now,
      updatedAt: now,
    }
    const versions = await db.query.playbookVersions.findMany({
      where: eq(schema.playbookVersions.playbookId, playbook.id),
      orderBy: [desc(schema.playbookVersions.version)],
      limit: 100,
    })
    await db.insert(schema.playbooks).values(newPlaybook)
    if (versions.length) {
      await db.insert(schema.playbookVersions).values(
        versions.map((version) => ({
          id: newPlaybookVersionId(),
          playbookId: newPlaybook.id,
          version: version.version,
          content: version.content,
          steps: version.steps,
          sourceRunId: version.sourceRunId,
          createdAt: now,
        })),
      )
    }
    createdIds.push(newPlaybook.id)
  }
  return createdIds
}

function matchesTerms(memory: MemoryItemRow, terms: string[]): boolean {
  if (terms.length === 0) return true
  const haystack = `${memory.title}\n${memory.content}`.toLowerCase()
  return terms.some((term) => haystack.includes(term.toLowerCase()))
}

function buildNextActions(run: EmployeeRunRow, artifactType: string, blockers: string[]): string[] {
  if (blockers.length > 0) {
    return [
      `Resolve blocker: ${truncate(blockers[0], 120)}`,
      'Resume from the latest runtime checkpoint.',
      `Re-run output contract verification for ${artifactType}.`,
    ]
  }
  return [
    `Hand off ${artifactType} context to the selected model/CLI executor.`,
    'Review artifact validation results before downstream delivery.',
    'Promote useful procedure updates through the learning review flow.',
  ]
}

function buildRequiredCapabilityRefs(agent: AgentProfileRow): JsonObject[] {
  return [
    ...agent.skillIds.map((id) => ({ type: 'skill', id })),
    ...agent.mcpServerIds.map((id) => ({ type: 'mcp_server', id })),
    ...agent.cliProfileIds.map((id) => ({ type: 'cli_profile', id })),
    ...agent.softwareProfileIds.map((id) => ({ type: 'software_profile', id })),
    ...(agent.modelProfileId ? [{ type: 'model_profile', id: agent.modelProfileId }] : []),
  ]
}

function getString(obj: JsonObject, key: string): string | null {
  const value = obj[key]
  return typeof value === 'string' ? value : null
}

function normalizeObject(value: JsonObject | null | undefined): JsonObject {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {}
}

function objectAt(obj: JsonObject, key: string): JsonObject | null {
  const value = obj[key]
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonObject
    : null
}

function normalizeNullable(value: string | null | undefined): string | null {
  if (value === undefined || value === null) return null
  const trimmed = value.trim()
  return trimmed.length === 0 ? null : trimmed
}

function getNumber(obj: JsonObject, key: string): number {
  const value = obj[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function numberAt(obj: JsonObject, key: string, fallback: number): number {
  const value = obj[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function booleanAt(obj: JsonObject, key: string, fallback: boolean): boolean {
  const value = obj[key]
  return typeof value === 'boolean' ? value : fallback
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

function clampImportance(value: number): number {
  return Math.max(0, Math.min(1, value))
}

function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 1)}...`
}
