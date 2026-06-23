import { and, asc, desc, eq, isNull } from 'drizzle-orm'

import { db, schema } from '@/db/client'
import type {
  AgentProfileRow,
  ContextCompressorConfig,
  ContextCompressorPolicyRow,
  ContextCompressorPolicyStatus,
  ContextCompressionPlanRow,
  ContextCompressionPlanStatus,
  ContextCompressionSectionDecision,
  ContextPreserveItem,
  EmployeeRunRow,
  JsonObject,
  MemoryItemRow,
  ModelProfileRow,
  PromptTemplateConditionalBlock,
  PromptTemplateEngine,
  PromptTemplateRow,
  PromptTemplateScope,
  PromptTemplateStatus,
  PromptTemplateVariableBinding,
  PromptTemplateVariables,
  PromptTemplateVersionRow,
  PromptVersionAbTest,
  RuntimeContextSnapshotRow,
  TokenBudgetAllocationConfig,
  TokenBudgetAllocationResult,
} from '@/db/schema'
import { retrieveRelevantMemories, type RetrievedMemory } from '@/server/agent-memory-service'
import {
  newPromptTemplateId,
  newPromptTemplateVersionId,
  newRuntimeContextSnapshotId,
  newContextCompressorPolicyId,
  newContextCompressionPlanId,
} from '@/server/ids'
import { buildAgentEnvironment } from '@/server/agent-environment-service'
import {
  getActiveStyleGuideForAgent,
  styleGuideContext,
  type ActiveAgentStyleGuide,
} from '@/server/style-guide-service'
import {
  IRREVOCABLE_USER_COMMANDS,
  USER_SOVEREIGNTY_RULES,
} from '@/server/user-override-service'

export interface CreatePromptTemplateArgs {
  name: string
  description?: string
  scope?: PromptTemplateScope
  agentProfileId?: string | null
  engine?: PromptTemplateEngine
  template?: string
  variables?: PromptTemplateVariables
  conditionalBlocks?: PromptTemplateConditionalBlock[]
  status?: PromptTemplateStatus
  systemPrompt?: string
  content?: string
  contextRules?: string[]
  inputSchema?: JsonObject
  outputSchema?: JsonObject
  modelHints?: JsonObject
  abTest?: PromptVersionAbTest | null
  deployedAt?: number | null
  retiredAt?: number | null
}

export interface PromptTemplateCatalog {
  promptTemplates: PromptTemplateRow[]
  promptTemplateVersions: PromptTemplateVersionRow[]
}

export interface TestPromptTemplateResult {
  status: 'ok' | 'failed'
  message: string
  checkedAt: number
}

export interface RenderPromptTemplateArgs {
  templateId: string
  agentProfileId?: string | null
  taskInput?: JsonObject
  runtimeState?: JsonObject
  memory?: JsonObject
  env?: JsonObject
}

export interface RenderPromptTemplateResult {
  template: PromptTemplateRow
  version: PromptTemplateVersionRow
  rendered: string
  renderedVariables: Record<string, string>
  missingVariables: string[]
  includedConditionalBlocks: string[]
  abTest: PromptVersionAbTest | null
  tokenEstimate: number
}

export interface CreateContextCompressorPolicyArgs {
  agentProfileId?: string | null
  name: string
  config?: Partial<ContextCompressorConfig>
  tokenBudgetConfig?: Partial<TokenBudgetAllocationConfig>
  status?: ContextCompressorPolicyStatus
}

export interface PlanContextCompressionArgs {
  policyId?: string | null
  agentProfileId?: string | null
  employeeRunId?: string | null
  runtimeContextSnapshotId?: string | null
  goal: string
  input?: JsonObject
  tokenBudget?: number | null
  tokenEstimate?: number | null
  memoryLimit?: number
  sections?: Array<{
    id?: string
    title: string
    kind?: string
    priority?: number
    tokenEstimate?: number
    tokenUsed?: number
    status?: PackedContextSectionStatus
    content?: string
  }>
}

export const DEFAULT_CONTEXT_COMPRESSOR_CONFIG: ContextCompressorConfig = {
  triggerThreshold: 0.8,
  strategy: 'hierarchical',
  preserveAlways: [
    'plan',
    'current_goal',
    'error_log',
    'user_instructions',
    'important_observations',
  ],
  summarizerModel: 'cheap_local',
}

export const DEFAULT_TOKEN_BUDGET_ALLOCATION: TokenBudgetAllocationConfig = {
  totalWindow: 128000,
  systemPromptMax: 3000,
  currentPlanMax: 2000,
  relevantMemoriesMax: 3000,
  recentStepSummariesMax: 5000,
  toolDefinitionsMax: 2000,
  safetyMargin: 2000,
  fullRecentStepsCount: 3,
}

export type PackedContextSectionKind =
  | 'system_prompt'
  | 'goal'
  | 'input'
  | 'agent_profile'
  | 'prompt_template'
  | 'memory'
  | 'contract'
  | 'policy'
  | 'capability'
  | 'style_guide'
  | 'user_sovereignty'
  | 'agent_environment'

export type PackedContextSectionStatus = 'included' | 'truncated' | 'omitted'

export interface PackedContextSection {
  id: string
  kind: PackedContextSectionKind
  title: string
  sourceId: string | null
  priority: number
  tokenEstimate: number
  tokenUsed: number
  status: PackedContextSectionStatus
  content: string
  reason: string
  matchedTerms: string[]
}

export interface AgentContextPackPreview {
  agentProfile: AgentProfileRow
  promptTemplate: PromptTemplateRow | null
  promptTemplateVersion: PromptTemplateVersionRow | null
  tokenBudget: number
  tokenEstimate: number
  tokenUsed: number
  overflowTokens: number
  truncated: boolean
  memoryCount: number
  sections: PackedContextSection[]
  packedContext: JsonObject
  summary: string
}

export async function createPromptTemplate(
  args: CreatePromptTemplateArgs,
): Promise<{ template: PromptTemplateRow; version: PromptTemplateVersionRow }> {
  const now = Date.now()
  const template: PromptTemplateRow = {
    id: newPromptTemplateId(),
    name: args.name.trim(),
    description: args.description?.trim() ?? '',
    scope: args.scope ?? 'workspace',
    agentProfileId: normalizeNullable(args.agentProfileId),
    engine: args.engine ?? 'handlebars',
    template: (args.template ?? args.systemPrompt ?? '').trim(),
    variables: args.variables ?? {},
    conditionalBlocks: args.conditionalBlocks ?? [],
    status: args.status ?? 'active',
    createdAt: now,
    updatedAt: now,
  }
  if (!template.name) throw new Error('Prompt template name is required.')

  const version: PromptTemplateVersionRow = {
    id: newPromptTemplateVersionId(),
    promptTemplateId: template.id,
    version: 1,
    systemPrompt: args.systemPrompt?.trim() ?? '',
    content: (args.content ?? args.template ?? args.systemPrompt ?? '').trim(),
    contextRules: args.contextRules ?? [],
    inputSchema: args.inputSchema ?? {},
    outputSchema: args.outputSchema ?? {},
    modelHints: args.modelHints ?? {},
    abTest: args.abTest ?? null,
    deployedAt: args.deployedAt ?? (template.status === 'active' ? now : null),
    retiredAt: args.retiredAt ?? null,
    createdAt: now,
  }

  await db.insert(schema.promptTemplates).values(template)
  await db.insert(schema.promptTemplateVersions).values(version)
  return { template, version }
}

export async function listPromptTemplateCatalog(): Promise<PromptTemplateCatalog> {
  const promptTemplates = await db.query.promptTemplates.findMany({
    orderBy: [desc(schema.promptTemplates.createdAt)],
  })
  const promptTemplateVersions = await db.query.promptTemplateVersions.findMany({
    orderBy: [
      asc(schema.promptTemplateVersions.promptTemplateId),
      desc(schema.promptTemplateVersions.version),
    ],
  })
  return { promptTemplates, promptTemplateVersions }
}

export async function listPromptTemplates(): Promise<PromptTemplateRow[]> {
  return db.query.promptTemplates.findMany({
    orderBy: [desc(schema.promptTemplates.createdAt)],
  })
}

export async function listPromptTemplateVersions(
  promptTemplateId?: string,
): Promise<PromptTemplateVersionRow[]> {
  return db.query.promptTemplateVersions.findMany({
    where: promptTemplateId
      ? eq(schema.promptTemplateVersions.promptTemplateId, promptTemplateId)
      : undefined,
    orderBy: [
      asc(schema.promptTemplateVersions.promptTemplateId),
      desc(schema.promptTemplateVersions.version),
    ],
  })
}

export async function getLatestPromptTemplateVersion(
  promptTemplateId: string,
): Promise<PromptTemplateVersionRow | null> {
  return (
    (await db.query.promptTemplateVersions.findFirst({
      where: eq(schema.promptTemplateVersions.promptTemplateId, promptTemplateId),
      orderBy: [desc(schema.promptTemplateVersions.version)],
    })) ?? null
  )
}

export async function testPromptTemplate(id: string): Promise<TestPromptTemplateResult> {
  const template = await getPromptTemplate(id)
  const version = await getLatestPromptTemplateVersion(id)
  const checkedAt = Date.now()
  const ok = Boolean(template.name.trim() && version && hasUsefulTemplateContent(version))
  return {
    status: ok ? 'ok' : 'failed',
    message: ok
      ? 'Prompt template has a latest version and usable prompt/context metadata.'
      : 'Prompt template requires a name plus systemPrompt, contextRules, or schema metadata.',
    checkedAt,
  }
}

export async function renderPromptTemplate(
  args: RenderPromptTemplateArgs,
): Promise<RenderPromptTemplateResult> {
  const template = await getPromptTemplate(args.templateId)
  const version = await getLatestPromptTemplateVersion(template.id)
  if (!version) throw new Error(`Prompt template has no versions: ${template.id}`)

  const agent = args.agentProfileId ? await getAgentProfile(args.agentProfileId) : null
  const contexts = {
    agent_profile: (agent ?? {}) as unknown,
    task_input: args.taskInput ?? {},
    memory: args.memory ?? {},
    runtime_state: args.runtimeState ?? {},
    env: args.env ?? {},
    static: {},
  } satisfies Record<string, unknown>

  const renderedVariables: Record<string, string> = {}
  const missingVariables: string[] = []
  for (const [name, binding] of Object.entries(template.variables)) {
    const value = resolveVariableBinding(binding, contexts)
    if (value === null) {
      missingVariables.push(name)
      renderedVariables[name] = ''
    } else {
      renderedVariables[name] = stringifyTemplateValue(value)
    }
  }

  const source = template.template.trim() || version.content.trim() || version.systemPrompt.trim()
  let rendered = replaceTemplateVariables(source, renderedVariables, template.engine)
  const includedConditionalBlocks: string[] = []
  for (const block of template.conditionalBlocks) {
    if (!evaluateCondition(block.condition, contexts)) continue
    includedConditionalBlocks.push(block.condition)
    rendered = `${rendered.trimEnd()}\n\n${replaceTemplateVariables(block.block, renderedVariables, template.engine)}`
  }

  return {
    template,
    version,
    rendered,
    renderedVariables,
    missingVariables,
    includedConditionalBlocks,
    abTest: version.abTest ?? null,
    tokenEstimate: estimateTextTokens(rendered),
  }
}

export async function createContextCompressorPolicy(
  args: CreateContextCompressorPolicyArgs,
): Promise<ContextCompressorPolicyRow> {
  const now = Date.now()
  const name = args.name.trim()
  if (!name) throw new Error('Context compressor policy name is required.')
  const row: ContextCompressorPolicyRow = {
    id: newContextCompressorPolicyId(),
    agentProfileId: normalizeNullable(args.agentProfileId),
    name,
    config: normalizeContextCompressorConfig(args.config),
    tokenBudgetConfig: normalizeTokenBudgetAllocationConfig(args.tokenBudgetConfig),
    status: args.status ?? 'active',
    createdAt: now,
    updatedAt: now,
  }
  await db.insert(schema.contextCompressorPolicies).values(row)
  return row
}

export async function seedContextCompressorPolicies(): Promise<ContextCompressorPolicyRow[]> {
  const existing = await db.query.contextCompressorPolicies.findFirst({
    where: and(
      eq(schema.contextCompressorPolicies.name, 'Default employee Agent context compressor'),
      eq(schema.contextCompressorPolicies.status, 'active'),
    ),
  })
  if (existing) return [existing]
  return [
    await createContextCompressorPolicy({
      name: 'Default employee Agent context compressor',
      config: DEFAULT_CONTEXT_COMPRESSOR_CONFIG,
      tokenBudgetConfig: DEFAULT_TOKEN_BUDGET_ALLOCATION,
      status: 'active',
    }),
  ]
}

export async function listContextCompressorPolicies(args: {
  agentProfileId?: string
  status?: ContextCompressorPolicyStatus
  limit?: number
} = {}): Promise<ContextCompressorPolicyRow[]> {
  const conditions = [
    args.agentProfileId
      ? eq(schema.contextCompressorPolicies.agentProfileId, args.agentProfileId)
      : undefined,
    args.status ? eq(schema.contextCompressorPolicies.status, args.status) : undefined,
  ].filter(Boolean)
  return db.query.contextCompressorPolicies.findMany({
    where: conditions.length ? and(...conditions) : undefined,
    orderBy: [desc(schema.contextCompressorPolicies.createdAt)],
    limit: args.limit ?? 100,
  })
}

export async function planContextCompression(
  args: PlanContextCompressionArgs,
): Promise<ContextCompressionPlanRow> {
  const policy = await resolveContextCompressorPolicy(args.policyId, args.agentProfileId)
  const config = normalizeContextCompressorConfig(policy.config)
  const tokenBudget = resolveCompressionTokenBudget(args.tokenBudget, policy.tokenBudgetConfig)
  const preview = args.agentProfileId
    ? await previewAgentContextPack({
        agentProfileId: args.agentProfileId,
        goal: args.goal,
        input: args.input ?? {},
        tokenBudget,
        memoryLimit: args.memoryLimit ?? 8,
      })
    : null
  const sections = normalizeCompressionSections(args.sections, preview?.sections ?? [])
  const tokenEstimate =
    args.tokenEstimate ??
    preview?.tokenEstimate ??
    sections.reduce((sum, section) => sum + section.beforeTokens, 0) ??
    estimateTextTokens(JSON.stringify(args.input ?? {}))
  const threshold = normalizeTriggerThreshold(config.triggerThreshold)
  const triggerThresholdTokens = Math.floor(tokenBudget * threshold)
  const allocation = allocateModelCallTokenBudget(policy.tokenBudgetConfig, tokenBudget)
  const needsCompression = tokenEstimate > triggerThresholdTokens
  const preservedSections = sections.filter((section) =>
    shouldPreserveSection(section, config.preserveAlways),
  )
  const compressionCandidates = sections
    .filter((section) => !preservedSections.some((preserved) => preserved.id === section.id))
    .sort((a, b) => a.beforeTokens - b.beforeTokens)
  const targetSavings = Math.max(0, tokenEstimate - triggerThresholdTokens)
  const compressedSections = needsCompression
    ? chooseCompressedSections(compressionCandidates, targetSavings, config.strategy)
    : []
  const omittedSections = needsCompression
    ? compressionCandidates
        .filter((section) => section.beforeTokens === 0 || section.reason.includes('omitted'))
        .map((section) => ({ ...section, reason: `${section.reason} Kept as an omitted section record.` }))
    : []
  const status: ContextCompressionPlanStatus = !needsCompression
    ? 'not_needed'
    : compressedSections.length > 0
      ? 'compressed'
      : 'planned'
  const row: ContextCompressionPlanRow = {
    id: newContextCompressionPlanId(),
    policyId: policy.id,
    agentProfileId: normalizeNullable(args.agentProfileId),
    employeeRunId: normalizeNullable(args.employeeRunId),
    runtimeContextSnapshotId: normalizeNullable(args.runtimeContextSnapshotId),
    goal: args.goal.trim(),
    input: args.input ?? {},
    tokenBudget,
    tokenEstimate,
    triggerThresholdTokens,
    status,
    strategy: config.strategy,
    preserveAlways: config.preserveAlways,
    summarizerModel: config.summarizerModel,
    allocation,
    preservedSections,
    compressedSections,
    omittedSections,
    summary: buildCompressionSummary({
      status,
      tokenEstimate,
      tokenBudget,
      triggerThresholdTokens,
      preservedSections,
      compressedSections,
      omittedSections,
    }),
    createdAt: Date.now(),
  }
  await db.insert(schema.contextCompressionPlans).values(row)
  return row
}

export async function listContextCompressionPlans(args: {
  policyId?: string
  agentProfileId?: string
  status?: ContextCompressionPlanStatus
  limit?: number
} = {}): Promise<ContextCompressionPlanRow[]> {
  const conditions = [
    args.policyId ? eq(schema.contextCompressionPlans.policyId, args.policyId) : undefined,
    args.agentProfileId ? eq(schema.contextCompressionPlans.agentProfileId, args.agentProfileId) : undefined,
    args.status ? eq(schema.contextCompressionPlans.status, args.status) : undefined,
  ].filter(Boolean)
  return db.query.contextCompressionPlans.findMany({
    where: conditions.length ? and(...conditions) : undefined,
    orderBy: [desc(schema.contextCompressionPlans.createdAt)],
    limit: args.limit ?? 100,
  })
}

export function allocateModelCallTokenBudget(
  config: Partial<TokenBudgetAllocationConfig> = {},
  totalWindow?: number | null,
): TokenBudgetAllocationResult {
  const resolved = normalizeTokenBudgetAllocationConfig({
    ...config,
    totalWindow: totalWindow ?? config.totalWindow,
  })
  const take = (requested: number, state: { remaining: number }) => {
    const amount = Math.min(Math.max(0, requested), state.remaining)
    state.remaining -= amount
    return amount
  }
  const state = {
    remaining: Math.max(0, resolved.totalWindow - Math.max(0, resolved.safetyMargin)),
  }
  const systemPrompt = take(resolved.systemPromptMax, state)
  const currentPlan = take(resolved.currentPlanMax, state)
  const relevantMemories = take(resolved.relevantMemoriesMax, state)
  const recentStepSummaries = take(resolved.recentStepSummariesMax, state)
  const toolDefinitions = take(resolved.toolDefinitionsMax, state)
  const safetyMargin = Math.min(resolved.safetyMargin, resolved.totalWindow)
  const remainingForFullRecentSteps = state.remaining
  const totalAllocated =
    systemPrompt +
    currentPlan +
    relevantMemories +
    recentStepSummaries +
    toolDefinitions +
    safetyMargin +
    remainingForFullRecentSteps
  const requestedTotal =
    resolved.systemPromptMax +
    resolved.currentPlanMax +
    resolved.relevantMemoriesMax +
    resolved.recentStepSummariesMax +
    resolved.toolDefinitionsMax +
    resolved.safetyMargin
  return {
    totalWindow: resolved.totalWindow,
    systemPrompt,
    currentPlan,
    relevantMemories,
    recentStepSummaries,
    toolDefinitions,
    safetyMargin,
    fullRecentStepsCount: resolved.fullRecentStepsCount,
    remainingForFullRecentSteps,
    totalAllocated,
    overflowTokens: Math.max(0, requestedTotal - resolved.totalWindow),
  }
}

export async function previewAgentContextPack(args: {
  agentProfileId: string
  goal: string
  input?: JsonObject
  tokenBudget?: number | null
  memoryLimit?: number
}): Promise<AgentContextPackPreview> {
  const agent = await getAgentProfile(args.agentProfileId)
  const { template, promptTemplateVersion } = await resolvePromptTemplate(agent)
  const modelProfile = await getAgentModelProfile(agent)
  const activeStyleGuide = await getActiveStyleGuideForAgent(agent.id)
  const agentEnvironment = await buildAgentEnvironment({ agentProfileId: agent.id })
  const retrievedMemories = await retrieveRelevantMemories({
    agent,
    goal: args.goal,
    input: args.input ?? {},
    limit: args.memoryLimit ?? 8,
  })
  const tokenBudget = resolveTokenBudget(agent, modelProfile, args.tokenBudget)
  const candidates = buildContextCandidates({
    agent,
    goal: args.goal,
    input: args.input ?? {},
    template,
    promptTemplateVersion,
    activeStyleGuide,
    agentEnvironment: agentEnvironment as unknown as JsonObject,
    retrievedMemories,
  })
  const sections = packContextSections(candidates, tokenBudget)
  const tokenEstimate = candidates.reduce((sum, section) => sum + section.tokenEstimate, 0)
  const tokenUsed = sections.reduce((sum, section) => sum + section.tokenUsed, 0)
  const omitted = sections.filter((section) => section.status === 'omitted')
  const truncated = sections.some((section) => section.status !== 'included')
  const packedContext = {
    goal: args.goal,
    input: args.input ?? {},
    agent: {
      id: agent.id,
      name: agent.name,
      role: agent.role,
      modelProfileId: agent.modelProfileId,
    },
    styleGuide: activeStyleGuide ? styleGuideContext(activeStyleGuide.styleGuide) : null,
    userSovereignty: {
      irrevocableCommands: IRREVOCABLE_USER_COMMANDS,
      behaviorRules: USER_SOVEREIGNTY_RULES,
    },
    environment: agentEnvironment as unknown as JsonObject,
    tokenBudget,
    tokenUsed,
    sections: sections
      .filter((section) => section.status !== 'omitted')
      .map((section) => ({
        id: section.id,
        kind: section.kind,
        title: section.title,
        sourceId: section.sourceId,
        status: section.status,
        tokenUsed: section.tokenUsed,
        content: section.content,
      })),
    omittedSections: omitted.map((section) => ({
      id: section.id,
      kind: section.kind,
      title: section.title,
      sourceId: section.sourceId,
      tokenEstimate: section.tokenEstimate,
      reason: section.reason,
    })),
  }

  return {
    agentProfile: agent,
    promptTemplate: template,
    promptTemplateVersion,
    tokenBudget,
    tokenEstimate,
    tokenUsed,
    overflowTokens: Math.max(0, tokenEstimate - tokenBudget),
    truncated,
    memoryCount: retrievedMemories.length,
    sections,
    packedContext,
    summary: buildContextPackSummary(agent, tokenBudget, tokenUsed, tokenEstimate, sections),
  }
}

export interface CreateRuntimeContextSnapshotArgs {
  run: EmployeeRunRow
  agent: AgentProfileRow
  retrievedMemories: RetrievedMemory[]
}

export async function createRuntimeContextSnapshot(
  args: CreateRuntimeContextSnapshotArgs,
): Promise<RuntimeContextSnapshotRow> {
  const promptTemplateId = getString(args.agent.inputContract, 'promptTemplateId')
  const promptTemplateVersion = promptTemplateId
    ? await getLatestPromptTemplateVersion(promptTemplateId)
    : null
  const template = promptTemplateVersion
    ? await getPromptTemplate(promptTemplateVersion.promptTemplateId)
    : null
  const modelProfile = args.agent.modelProfileId
    ? await db.query.modelProfiles.findFirst({
        where: eq(schema.modelProfiles.id, args.agent.modelProfileId),
      })
    : null
  const activeStyleGuide = await getActiveStyleGuideForAgent(args.agent.id)
  const agentEnvironment = await buildAgentEnvironment({
    agentProfileId: args.agent.id,
    employeeRunId: args.run.id,
  })

  const visibleContext: JsonObject = {
    goal: args.run.goal,
    inputKeys: Object.keys(args.run.input),
    agent: {
      id: args.agent.id,
      name: args.agent.name,
      role: args.agent.role,
      persona: args.agent.persona,
      modelProfileId: args.agent.modelProfileId,
      skillIds: args.agent.skillIds,
      mcpServerIds: args.agent.mcpServerIds,
      cliProfileIds: args.agent.cliProfileIds,
      softwareProfileIds: args.agent.softwareProfileIds,
    },
    styleGuide: activeStyleGuide ? styleGuideContext(activeStyleGuide.styleGuide) : null,
    userSovereignty: {
      irrevocableCommands: IRREVOCABLE_USER_COMMANDS,
      behaviorRules: USER_SOVEREIGNTY_RULES,
    },
    environment: agentEnvironment as unknown as JsonObject,
    promptTemplate: template
      ? {
          id: template.id,
          name: template.name,
          scope: template.scope,
          engine: template.engine,
          variables: template.variables,
          conditionalBlocks: template.conditionalBlocks,
          status: template.status,
          versionId: promptTemplateVersion?.id ?? null,
          version: promptTemplateVersion?.version ?? null,
          content: promptTemplateVersion?.content ?? '',
          contextRules: promptTemplateVersion?.contextRules ?? [],
          abTest: promptTemplateVersion?.abTest ?? null,
        }
      : null,
    fallbackSystemPrompt: promptTemplateVersion ? null : args.agent.systemPrompt,
    behaviorRules: args.agent.behaviorRules,
    successCriteria: args.agent.successCriteria,
    inputContract: args.agent.inputContract,
    outputContract: args.agent.outputContract,
    permissions: args.agent.permissionPolicy,
    autonomy: args.agent.autonomyPolicy,
    workstation: args.agent.workstationPolicy,
    retrievedMemoryIds: args.retrievedMemories.map(({ item }) => item.id),
    retrievedMemoryTitles: args.retrievedMemories.map(({ item }) => item.title),
  }
  const tokenBudget = modelProfile?.contextWindow ?? getNumber(args.agent.inputContract, 'tokenBudget')
  const row: RuntimeContextSnapshotRow = {
    id: newRuntimeContextSnapshotId(),
    employeeRunId: args.run.id,
    agentProfileId: args.agent.id,
    promptTemplateId: template?.id ?? null,
    promptTemplateVersionId: promptTemplateVersion?.id ?? null,
    summary: buildSnapshotSummary(args.agent, args.run, template, args.retrievedMemories),
    visibleContext,
    tokenBudget,
    tokenEstimate: estimateTokens({
      systemPrompt: promptTemplateVersion?.systemPrompt ?? args.agent.systemPrompt,
      visibleContext,
      memories: args.retrievedMemories.map(({ item }) => item),
    }),
    createdAt: Date.now(),
  }
  await db.insert(schema.runtimeContextSnapshots).values(row)
  return row
}

export async function listRuntimeContextSnapshotsForRun(
  employeeRunId: string,
): Promise<RuntimeContextSnapshotRow[]> {
  return db.query.runtimeContextSnapshots.findMany({
    where: eq(schema.runtimeContextSnapshots.employeeRunId, employeeRunId),
    orderBy: [asc(schema.runtimeContextSnapshots.createdAt)],
  })
}

function resolveVariableBinding(
  binding: PromptTemplateVariableBinding,
  contexts: Record<string, unknown>,
): unknown | null {
  if (binding.source === 'static') return binding.default ?? binding.path
  const value = getPath(contexts[binding.source], binding.path)
  if (value === undefined || value === null || value === '') return binding.default ?? null
  return value
}

function replaceTemplateVariables(
  source: string,
  values: Record<string, string>,
  engine: PromptTemplateEngine,
): string {
  if (engine === 'custom') {
    return Object.entries(values).reduce(
      (text, [key, value]) => text.replaceAll(`{{${key}}}`, value).replaceAll(`\${${key}}`, value),
      source,
    )
  }
  return source.replace(/\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g, (_match, key: string) => values[key] ?? '')
}

function evaluateCondition(condition: string, contexts: Record<string, unknown>): boolean {
  const trimmed = condition.trim()
  if (!trimmed) return false
  const match = /^(.+?)\s*(==|!=|>=|<=|>|<)\s*(.+)$/.exec(trimmed)
  if (!match) return Boolean(resolveConditionPath(trimmed, contexts))
  const left = resolveConditionPath(match[1].trim(), contexts)
  const right = parseConditionLiteral(match[3].trim())
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

function resolveConditionPath(path: string, contexts: Record<string, unknown>): unknown {
  const normalized = path
    .replace(/^agent\./, 'agent_profile.')
    .replace(/^task\./, 'task_input.')
    .replace(/^input\./, 'task_input.')
    .replace(/^runtime\./, 'runtime_state.')
  const [source, ...rest] = normalized.split('.')
  if (source in contexts) return getPath(contexts[source], rest.join('.'))
  return getPath(contexts.task_input, normalized)
}

function parseConditionLiteral(raw: string): unknown {
  if (raw === 'true') return true
  if (raw === 'false') return false
  if (raw === 'null') return null
  if (/^-?\d+(\.\d+)?$/.test(raw)) return Number(raw)
  const quoted = /^["'](.*)["']$/.exec(raw)
  return quoted ? quoted[1] : raw
}

function stringifyTemplateValue(value: unknown): string {
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return JSON.stringify(value)
}

function getPath(source: unknown, path: string): unknown {
  if (!path) return source
  return path.split('.').reduce<unknown>((value, segment) => {
    if (value === null || value === undefined) return undefined
    if (typeof value !== 'object') return undefined
    return (value as Record<string, unknown>)[segment]
  }, source)
}

function normalizeContextCompressorConfig(
  config: Partial<ContextCompressorConfig> | ContextCompressorConfig | undefined,
): ContextCompressorConfig {
  return {
    ...DEFAULT_CONTEXT_COMPRESSOR_CONFIG,
    ...(config ?? {}),
    preserveAlways:
      config?.preserveAlways && config.preserveAlways.length > 0
        ? config.preserveAlways
        : DEFAULT_CONTEXT_COMPRESSOR_CONFIG.preserveAlways,
  }
}

function normalizeTokenBudgetAllocationConfig(
  config: Partial<TokenBudgetAllocationConfig> | TokenBudgetAllocationConfig | undefined,
): TokenBudgetAllocationConfig {
  return {
    ...DEFAULT_TOKEN_BUDGET_ALLOCATION,
    ...(config ?? {}),
    totalWindow: Math.max(128, Math.floor(config?.totalWindow ?? DEFAULT_TOKEN_BUDGET_ALLOCATION.totalWindow)),
    fullRecentStepsCount: Math.max(
      0,
      Math.floor(config?.fullRecentStepsCount ?? DEFAULT_TOKEN_BUDGET_ALLOCATION.fullRecentStepsCount),
    ),
  }
}

function normalizeTriggerThreshold(raw: number): number {
  if (!Number.isFinite(raw)) return DEFAULT_CONTEXT_COMPRESSOR_CONFIG.triggerThreshold
  if (raw > 1) return Math.max(0.01, Math.min(1, raw / 100))
  return Math.max(0.01, Math.min(1, raw))
}

async function resolveContextCompressorPolicy(
  policyId?: string | null,
  agentProfileId?: string | null,
): Promise<ContextCompressorPolicyRow> {
  if (policyId) {
    const policy = await db.query.contextCompressorPolicies.findFirst({
      where: eq(schema.contextCompressorPolicies.id, policyId),
    })
    if (!policy) throw new Error(`Context compressor policy not found: ${policyId}`)
    return policy
  }
  const agentPolicy = agentProfileId
    ? await db.query.contextCompressorPolicies.findFirst({
        where: and(
          eq(schema.contextCompressorPolicies.agentProfileId, agentProfileId),
          eq(schema.contextCompressorPolicies.status, 'active'),
        ),
        orderBy: [desc(schema.contextCompressorPolicies.createdAt)],
      })
    : null
  if (agentPolicy) return agentPolicy
  const globalPolicy = await db.query.contextCompressorPolicies.findFirst({
    where: and(
      isNull(schema.contextCompressorPolicies.agentProfileId),
      eq(schema.contextCompressorPolicies.status, 'active'),
    ),
    orderBy: [desc(schema.contextCompressorPolicies.createdAt)],
  })
  if (globalPolicy) return globalPolicy
  const [seeded] = await seedContextCompressorPolicies()
  return seeded
}

function resolveCompressionTokenBudget(
  explicit: number | null | undefined,
  config: TokenBudgetAllocationConfig,
): number {
  return Math.max(128, Math.min(250000, Math.floor(explicit ?? config.totalWindow)))
}

function normalizeCompressionSections(
  inputSections: PlanContextCompressionArgs['sections'] | undefined,
  previewSections: PackedContextSection[],
): ContextCompressionSectionDecision[] {
  const source = inputSections && inputSections.length > 0
    ? inputSections
    : previewSections.map((section) => ({
        id: section.id,
        title: section.title,
        kind: section.kind,
        priority: section.priority,
        tokenEstimate: section.tokenEstimate,
        tokenUsed: section.tokenUsed,
        status: section.status,
        content: section.content,
      }))
  return source.map((section, index) => {
    const beforeTokens =
      section.tokenEstimate ??
      section.tokenUsed ??
      estimateTextTokens(section.content ?? section.title)
    return {
      id: section.id ?? `section_${index + 1}`,
      title: section.title,
      kind: section.kind ?? 'other',
      beforeTokens,
      afterTokens: beforeTokens,
      savedTokens: 0,
      reason: section.status === 'omitted'
        ? 'Source section was already omitted by context packing.'
        : 'Source section is available for compression planning.',
    }
  })
}

function shouldPreserveSection(
  section: ContextCompressionSectionDecision,
  preserveAlways: ContextPreserveItem[],
): boolean {
  const haystack = `${section.id} ${section.title} ${section.kind}`.toLowerCase()
  return preserveAlways.some((item) => {
    if (item === 'current_goal') return haystack.includes('goal')
    if (item === 'plan') return haystack.includes('plan') || haystack.includes('task_input')
    if (item === 'error_log') return haystack.includes('error') || haystack.includes('failure')
    if (item === 'user_instructions') {
      return haystack.includes('system_prompt') || haystack.includes('user') || haystack.includes('instruction')
    }
    if (item === 'important_observations') {
      return haystack.includes('observation') || haystack.includes('important')
    }
    return false
  })
}

function chooseCompressedSections(
  candidates: ContextCompressionSectionDecision[],
  targetSavings: number,
  strategy: ContextCompressorConfig['strategy'],
): ContextCompressionSectionDecision[] {
  const ordered = [...candidates].sort((a, b) => {
    if (strategy === 'summarize_oldest' || strategy === 'sliding_window') return 0
    if (strategy === 'summarize_least_relevant') return b.beforeTokens - a.beforeTokens
    return a.beforeTokens - b.beforeTokens
  })
  let saved = 0
  const selected: ContextCompressionSectionDecision[] = []
  for (const section of ordered) {
    if (section.beforeTokens <= 0) continue
    const afterTokens = Math.max(16, Math.ceil(section.beforeTokens * 0.35))
    const savedTokens = Math.max(0, section.beforeTokens - afterTokens)
    selected.push({
      ...section,
      afterTokens,
      savedTokens,
      reason: `${strategy} compression reduces this lower-priority section while preserving required context.`,
    })
    saved += savedTokens
    if (saved >= targetSavings) break
  }
  return selected
}

function buildCompressionSummary(args: {
  status: ContextCompressionPlanStatus
  tokenEstimate: number
  tokenBudget: number
  triggerThresholdTokens: number
  preservedSections: ContextCompressionSectionDecision[]
  compressedSections: ContextCompressionSectionDecision[]
  omittedSections: ContextCompressionSectionDecision[]
}): string {
  if (args.status === 'not_needed') {
    return `Context estimate ${args.tokenEstimate}/${args.tokenBudget} tokens is below the compression threshold ${args.triggerThresholdTokens}; no compression is needed.`
  }
  const saved = args.compressedSections.reduce((sum, section) => sum + section.savedTokens, 0)
  return `Context estimate ${args.tokenEstimate}/${args.tokenBudget} exceeds threshold ${args.triggerThresholdTokens}; preserve ${args.preservedSections.length} sections, compress ${args.compressedSections.length} sections, omit-track ${args.omittedSections.length} sections, estimated savings ${saved} tokens.`
}

async function getPromptTemplate(id: string): Promise<PromptTemplateRow> {
  const template = await db.query.promptTemplates.findFirst({
    where: eq(schema.promptTemplates.id, id),
  })
  if (!template) throw new Error(`Prompt template not found: ${id}`)
  return template
}

async function getAgentProfile(id: string): Promise<AgentProfileRow> {
  const agent = await db.query.agentProfiles.findFirst({
    where: eq(schema.agentProfiles.id, id),
  })
  if (!agent) throw new Error(`Agent profile not found: ${id}`)
  return agent
}

async function getAgentModelProfile(agent: AgentProfileRow): Promise<ModelProfileRow | null> {
  if (!agent.modelProfileId) return null
  return (
    (await db.query.modelProfiles.findFirst({
      where: eq(schema.modelProfiles.id, agent.modelProfileId),
    })) ?? null
  )
}

async function resolvePromptTemplate(agent: AgentProfileRow): Promise<{
  template: PromptTemplateRow | null
  promptTemplateVersion: PromptTemplateVersionRow | null
}> {
  const promptTemplateId = getString(agent.inputContract, 'promptTemplateId')
  const promptTemplateVersion = promptTemplateId
    ? await getLatestPromptTemplateVersion(promptTemplateId)
    : null
  const template = promptTemplateVersion
    ? await getPromptTemplate(promptTemplateVersion.promptTemplateId)
    : null
  return { template, promptTemplateVersion }
}

function hasUsefulTemplateContent(version: PromptTemplateVersionRow): boolean {
  return (
    version.systemPrompt.trim().length > 0 ||
    version.content.trim().length > 0 ||
    version.contextRules.length > 0 ||
    Object.keys(version.inputSchema).length > 0 ||
    Object.keys(version.outputSchema).length > 0 ||
    Object.keys(version.modelHints).length > 0
  )
}

function buildSnapshotSummary(
  agent: AgentProfileRow,
  run: EmployeeRunRow,
  template: PromptTemplateRow | null,
  retrievedMemories: RetrievedMemory[],
): string {
  const templatePart = template ? `template ${template.name}` : 'agent system prompt'
  return `${agent.name} used ${templatePart} for goal "${run.goal}" with ${retrievedMemories.length} retrieved memories.`
}

function estimateTokens(args: {
  systemPrompt: string
  visibleContext: JsonObject
  memories: MemoryItemRow[]
}): number {
  const memoryText = args.memories.map((item) => `${item.title}\n${item.content}`).join('\n')
  const chars =
    args.systemPrompt.length + JSON.stringify(args.visibleContext).length + memoryText.length
  return Math.max(1, Math.ceil(chars / 4))
}

interface ContextCandidate {
  id: string
  kind: PackedContextSectionKind
  title: string
  sourceId?: string | null
  priority: number
  content: string
  reason: string
  matchedTerms?: string[]
  tokenEstimate: number
}

function buildContextCandidates(args: {
  agent: AgentProfileRow
  goal: string
  input: JsonObject
  template: PromptTemplateRow | null
  promptTemplateVersion: PromptTemplateVersionRow | null
  activeStyleGuide: ActiveAgentStyleGuide | null
  agentEnvironment: JsonObject
  retrievedMemories: RetrievedMemory[]
}): ContextCandidate[] {
  const systemPrompt = args.promptTemplateVersion?.systemPrompt.trim() || args.agent.systemPrompt.trim()
  const candidates: Omit<ContextCandidate, 'tokenEstimate'>[] = [
    {
      id: 'system_prompt',
      kind: 'system_prompt',
      title: args.promptTemplateVersion ? 'Template system prompt' : 'Agent system prompt',
      sourceId: args.promptTemplateVersion?.id ?? args.agent.id,
      priority: 100,
      content: systemPrompt,
      reason: 'Highest priority identity and behavior instructions.',
    },
    {
      id: 'goal',
      kind: 'goal',
      title: 'Current goal',
      priority: 96,
      content: args.goal,
      reason: 'The active customer objective must be visible to the Agent.',
    },
    {
      id: 'user_sovereignty',
      kind: 'user_sovereignty',
      title: 'User sovereignty and irrevocable commands',
      priority: 98,
      content: formatJson({
        irrevocableCommands: IRREVOCABLE_USER_COMMANDS,
        behaviorRules: USER_SOVEREIGNTY_RULES,
      }),
      reason: 'User authority, emergency override commands, and honesty rules outrank ordinary Agent preferences.',
    },
    {
      id: 'agent_profile',
      kind: 'agent_profile',
      title: 'Agent role and operating rules',
      sourceId: args.agent.id,
      priority: 90,
      content: formatJson({
        name: args.agent.name,
        role: args.agent.role,
        description: args.agent.description,
        persona: args.agent.persona,
        behaviorRules: args.agent.behaviorRules,
        successCriteria: args.agent.successCriteria,
      }),
      reason: 'Defines the employee role, persona, success criteria, and local behavior rules.',
    },
    {
      id: 'output_contract',
      kind: 'contract',
      title: 'Input and output contracts',
      sourceId: args.agent.id,
      priority: 86,
      content: formatJson({
        inputContract: args.agent.inputContract,
        outputContract: args.agent.outputContract,
      }),
      reason: 'Keeps required input/output artifact expectations explicit.',
    },
    {
      id: 'style_guide',
      kind: 'style_guide',
      title: args.activeStyleGuide
        ? `Style guide: ${args.activeStyleGuide.styleGuide.name}`
        : 'Style guide',
      sourceId: args.activeStyleGuide?.styleGuide.id ?? null,
      priority: 84,
      content: args.activeStyleGuide
        ? formatJson({
            styleGuide: styleGuideContext(args.activeStyleGuide.styleGuide),
            bindingId: args.activeStyleGuide.binding.id,
          })
        : '',
      reason: 'Brand, language, code, and visual constraints must shape the Agent output.',
    },
    {
      id: 'prompt_template',
      kind: 'prompt_template',
      title: args.template ? `Prompt template: ${args.template.name}` : 'Prompt template',
      sourceId: args.template?.id ?? null,
      priority: 82,
      content: args.promptTemplateVersion
        ? formatJson({
            template: args.template?.name ?? null,
            engine: args.template?.engine ?? null,
            variables: args.template?.variables ?? {},
            conditionalBlocks: args.template?.conditionalBlocks ?? [],
            version: args.promptTemplateVersion.version,
            content: args.promptTemplateVersion.content,
            contextRules: args.promptTemplateVersion.contextRules,
            inputSchema: args.promptTemplateVersion.inputSchema,
            outputSchema: args.promptTemplateVersion.outputSchema,
            modelHints: args.promptTemplateVersion.modelHints,
            abTest: args.promptTemplateVersion.abTest,
          })
        : '',
      reason: 'Template context rules and schemas guide context assembly.',
    },
    {
      id: 'task_input',
      kind: 'input',
      title: 'Task input',
      priority: 78,
      content: formatJson(args.input),
      reason: 'Runtime input values are needed for this specific task.',
    },
    {
      id: 'capabilities',
      kind: 'capability',
      title: 'Assigned capabilities',
      sourceId: args.agent.id,
      priority: 70,
      content: formatJson({
        modelProfileId: args.agent.modelProfileId,
        fallbackModelProfileIds: args.agent.fallbackModelProfileIds,
        skillIds: args.agent.skillIds,
        mcpServerIds: args.agent.mcpServerIds,
        cliProfileIds: args.agent.cliProfileIds,
        softwareProfileIds: args.agent.softwareProfileIds,
      }),
      reason: 'Lists which models, Skills, MCP servers, CLIs, and software adapters are available.',
    },
    {
      id: 'agent_environment',
      kind: 'agent_environment',
      title: 'Isolated Agent environment',
      sourceId: args.agent.id,
      priority: 68,
      content: formatJson(args.agentEnvironment),
      reason: 'Defines the Agent-visible filesystem, whitelisted environment variables, secret refs, and network bounds.',
    },
    {
      id: 'policies',
      kind: 'policy',
      title: 'Permission, autonomy, memory, and workstation policies',
      sourceId: args.agent.id,
      priority: 62,
      content: formatJson({
        memoryPolicy: args.agent.memoryPolicy,
        autonomyPolicy: args.agent.autonomyPolicy,
        permissionPolicy: args.agent.permissionPolicy,
        workstationPolicy: args.agent.workstationPolicy,
      }),
      reason: 'Policy context constrains what the Agent may do without approval.',
    },
    ...args.retrievedMemories.map(({ item, score, matchedTerms }, index) => ({
      id: `memory_${item.id}`,
      kind: 'memory' as const,
      title: `Memory: ${item.title}`,
      sourceId: item.id,
      priority: 58 - index,
      content: [
        `type: ${item.type}`,
        `scope: ${item.scope}`,
        `importance: ${item.importance}`,
        `confidence: ${item.confidence}`,
        '',
        item.content,
      ].join('\n'),
      reason: `Retrieved memory score ${score.toFixed(2)}.`,
      matchedTerms,
    })),
  ]

  return candidates
    .filter((candidate) => candidate.content.trim().length > 0)
    .map((candidate) => ({
      ...candidate,
      sourceId: candidate.sourceId ?? null,
      matchedTerms: candidate.matchedTerms ?? [],
      tokenEstimate: estimateTextTokens(candidate.content),
    }))
}

function packContextSections(
  candidates: ContextCandidate[],
  tokenBudget: number,
): PackedContextSection[] {
  const minTruncatedTokens = 16
  let used = 0
  return [...candidates]
    .sort((a, b) => b.priority - a.priority)
    .map((candidate) => {
      const remaining = Math.max(0, tokenBudget - used)
      if (candidate.tokenEstimate <= remaining) {
        used += candidate.tokenEstimate
        return toPackedSection(candidate, 'included', candidate.content, candidate.tokenEstimate)
      }
      if (remaining >= minTruncatedTokens) {
        const content = truncateToTokens(candidate.content, remaining)
        const tokenUsed = estimateTextTokens(content)
        used += tokenUsed
        return toPackedSection(
          candidate,
          'truncated',
          content,
          tokenUsed,
          `${candidate.reason} Truncated to fit the remaining context budget.`,
        )
      }
      return toPackedSection(
        candidate,
        'omitted',
        '',
        0,
        `${candidate.reason} Omitted because the context budget was exhausted.`,
      )
    })
}

function toPackedSection(
  candidate: ContextCandidate,
  status: PackedContextSectionStatus,
  content: string,
  tokenUsed: number,
  reason = candidate.reason,
): PackedContextSection {
  return {
    id: candidate.id,
    kind: candidate.kind,
    title: candidate.title,
    sourceId: candidate.sourceId ?? null,
    priority: candidate.priority,
    tokenEstimate: candidate.tokenEstimate,
    tokenUsed,
    status,
    content,
    reason,
    matchedTerms: candidate.matchedTerms ?? [],
  }
}

function resolveTokenBudget(
  agent: AgentProfileRow,
  modelProfile: ModelProfileRow | null,
  explicitBudget?: number | null,
): number {
  const raw =
    explicitBudget ??
    modelProfile?.contextWindow ??
    getNumber(agent.inputContract, 'tokenBudget') ??
    8000
  return Math.max(128, Math.min(250000, Math.floor(raw)))
}

function estimateTextTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4))
}

function truncateToTokens(text: string, tokenBudget: number): string {
  const maxChars = Math.max(0, tokenBudget * 4)
  if (text.length <= maxChars) return text
  if (maxChars <= 18) return text.slice(0, maxChars)
  return `${text.slice(0, maxChars - 15).trimEnd()}\n[truncated]`
}

function formatJson(value: unknown): string {
  return JSON.stringify(value, null, 2)
}

function buildContextPackSummary(
  agent: AgentProfileRow,
  tokenBudget: number,
  tokenUsed: number,
  tokenEstimate: number,
  sections: PackedContextSection[],
): string {
  const truncatedCount = sections.filter((section) => section.status === 'truncated').length
  const omittedCount = sections.filter((section) => section.status === 'omitted').length
  return `${agent.name} context pack uses ${tokenUsed}/${tokenBudget} tokens from an estimated ${tokenEstimate}; ${truncatedCount} sections truncated and ${omittedCount} sections omitted.`
}

function getString(obj: JsonObject, key: string): string | null {
  const value = obj[key]
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function getNumber(obj: JsonObject, key: string): number | null {
  const value = obj[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function normalizeNullable(value: string | null | undefined): string | null {
  if (value === undefined || value === null) return null
  const trimmed = value.trim()
  return trimmed.length === 0 ? null : trimmed
}
