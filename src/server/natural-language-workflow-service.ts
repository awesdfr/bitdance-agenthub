import { desc, eq } from 'drizzle-orm'

import { db, schema } from '@/db/client'
import type {
  AgentProfileRow,
  JsonObject,
  NaturalLanguageWorkflowDraftRow,
  NaturalLanguageWorkflowIntentType,
  WorkflowRow,
} from '@/db/schema'
import {
  createWorkflow,
  getWorkflowGraph,
  type WorkflowGraph,
} from '@/server/control-plane-service'
import {
  newNaturalLanguageWorkflowDraftId,
  newWorkflowEdgeId,
  newWorkflowNodeId,
} from '@/server/ids'

export interface CreateNaturalLanguageWorkflowDraftArgs {
  prompt: string
  name?: string
  agentProfileIds?: string[]
  preferredAgentRoles?: string[]
}

export interface ReviseNaturalLanguageWorkflowDraftArgs {
  modificationPrompt: string
  name?: string
  agentProfileIds?: string[]
}

export interface ConfirmNaturalLanguageWorkflowDraftArgs {
  name?: string
  status?: WorkflowRow['status']
  modifications?: JsonObject
}

export interface NaturalLanguageWorkflowConfirmResult {
  draft: NaturalLanguageWorkflowDraftRow
  workflowGraph: WorkflowGraph
}

interface PreviewNode {
  id: string
  type: string
  label: string
  agentProfileId: string | null
  position: { x: number; y: number }
  config: JsonObject
  inputMapping: JsonObject
  outputContract: JsonObject
  retryPolicy: JsonObject
  approvalPolicy: JsonObject
}

interface PreviewEdge {
  id: string
  sourceNodeId: string
  targetNodeId: string
  sourceHandle?: string | null
  targetHandle?: string | null
  mapping: JsonObject
}

interface WorkflowPreview {
  name: string
  summary: string
  confirmationText: string
  nodes: PreviewNode[]
  edges: PreviewEdge[]
}

interface ParsedDraft {
  name: string
  intentType: NaturalLanguageWorkflowIntentType
  parsedIntent: JsonObject
  workflowPreview: WorkflowPreview
  agentMatches: JsonObject
  confidence: number
}

const GITHUB_ISSUE_TOKENS = ['github', 'issue', 'bug', 'feature', '修复', '计划', '问题']
const ANALYSIS_TOKENS = ['code', 'review', 'analy', 'triage', '代码', '分析', '审查', '问题']
const FIX_TOKENS = ['bug', 'fix', 'debug', 'repair', '修复', '缺陷', '故障']

export async function createNaturalLanguageWorkflowDraft(
  args: CreateNaturalLanguageWorkflowDraftArgs,
): Promise<NaturalLanguageWorkflowDraftRow> {
  const agents = await selectCandidateAgents(args.agentProfileIds)
  const parsed = parsePromptToDraft(args.prompt, agents, {
    name: args.name,
    preferredAgentRoles: args.preferredAgentRoles ?? [],
  })
  const now = Date.now()
  const row = {
    id: newNaturalLanguageWorkflowDraftId(),
    prompt: args.prompt.trim(),
    name: parsed.name,
    intentType: parsed.intentType,
    parsedIntent: parsed.parsedIntent,
    workflowPreview: parsed.workflowPreview as unknown as JsonObject,
    agentMatches: parsed.agentMatches,
    confidence: parsed.confidence,
    status: 'preview' as const,
    createdWorkflowId: null,
    createdAt: now,
    updatedAt: now,
  }
  await db.insert(schema.naturalLanguageWorkflowDrafts).values(row)
  return row
}

export async function listNaturalLanguageWorkflowDrafts(args: {
  status?: NaturalLanguageWorkflowDraftRow['status']
  limit?: number
} = {}): Promise<NaturalLanguageWorkflowDraftRow[]> {
  return db.query.naturalLanguageWorkflowDrafts.findMany({
    where: args.status ? eq(schema.naturalLanguageWorkflowDrafts.status, args.status) : undefined,
    orderBy: [desc(schema.naturalLanguageWorkflowDrafts.createdAt)],
    limit: clampInt(args.limit ?? 50, 1, 200),
  })
}

export async function getNaturalLanguageWorkflowDraft(
  id: string,
): Promise<NaturalLanguageWorkflowDraftRow> {
  const draft = await db.query.naturalLanguageWorkflowDrafts.findFirst({
    where: eq(schema.naturalLanguageWorkflowDrafts.id, id),
  })
  if (!draft) throw new Error(`Natural language workflow draft not found: ${id}`)
  return draft
}

export async function reviseNaturalLanguageWorkflowDraft(
  id: string,
  args: ReviseNaturalLanguageWorkflowDraftArgs,
): Promise<NaturalLanguageWorkflowDraftRow> {
  const existing = await getNaturalLanguageWorkflowDraft(id)
  const agents = await selectCandidateAgents(args.agentProfileIds)
  const revisedPrompt = `${existing.prompt}\n\n修改要求: ${args.modificationPrompt.trim()}`
  const parsed = parsePromptToDraft(revisedPrompt, agents, {
    name: args.name ?? existing.name,
    preferredAgentRoles: [],
  })
  const now = Date.now()
  await db.update(schema.naturalLanguageWorkflowDrafts).set({
    prompt: revisedPrompt,
    name: parsed.name,
    intentType: parsed.intentType,
    parsedIntent: parsed.parsedIntent,
    workflowPreview: parsed.workflowPreview as unknown as JsonObject,
    agentMatches: parsed.agentMatches,
    confidence: Math.max(0, parsed.confidence - 0.03),
    status: 'modified',
    createdWorkflowId: null,
    updatedAt: now,
  }).where(eq(schema.naturalLanguageWorkflowDrafts.id, id))
  return getNaturalLanguageWorkflowDraft(id)
}

export async function confirmNaturalLanguageWorkflowDraft(
  id: string,
  args: ConfirmNaturalLanguageWorkflowDraftArgs = {},
): Promise<NaturalLanguageWorkflowConfirmResult> {
  const draft = await getNaturalLanguageWorkflowDraft(id)
  if (draft.createdWorkflowId && draft.status === 'confirmed') {
    return { draft, workflowGraph: await getWorkflowGraph(draft.createdWorkflowId) }
  }
  const preview = toWorkflowPreview(draft.workflowPreview)
  const modifications = args.modifications ?? {}
  const workflow = await createWorkflow({
    name: args.name?.trim() || preview.name || draft.name,
    description: buildWorkflowDescription(draft, preview, modifications),
    status: args.status ?? 'draft',
    nodes: preview.nodes.map((node) => ({
      id: node.id,
      type: node.type,
      agentProfileId: node.agentProfileId,
      position: node.position,
      config: {
        ...node.config,
        label: node.label,
        generatedBy: 'natural_language_workflow',
      },
      inputMapping: node.inputMapping,
      outputContract: node.outputContract,
      retryPolicy: node.retryPolicy,
      approvalPolicy: node.approvalPolicy,
    })),
    edges: preview.edges.map((edge) => ({
      id: edge.id,
      sourceNodeId: edge.sourceNodeId,
      targetNodeId: edge.targetNodeId,
      sourceHandle: edge.sourceHandle ?? null,
      targetHandle: edge.targetHandle ?? null,
      mapping: edge.mapping,
    })),
  })
  const now = Date.now()
  await db.update(schema.naturalLanguageWorkflowDrafts).set({
    status: 'confirmed',
    createdWorkflowId: workflow.id,
    updatedAt: now,
  }).where(eq(schema.naturalLanguageWorkflowDrafts.id, id))
  return {
    draft: await getNaturalLanguageWorkflowDraft(id),
    workflowGraph: await getWorkflowGraph(workflow.id),
  }
}

function parsePromptToDraft(
  prompt: string,
  agents: AgentProfileRow[],
  options: { name?: string; preferredAgentRoles: string[] },
): ParsedDraft {
  if (looksLikeGithubIssueTriage(prompt)) {
    return buildGithubIssueTriageDraft(prompt, agents, options)
  }
  return buildGenericSequentialDraft(prompt, agents, options)
}

function buildGithubIssueTriageDraft(
  prompt: string,
  agents: AgentProfileRow[],
  options: { name?: string; preferredAgentRoles: string[] },
): ParsedDraft {
  const analysisAgent = matchAgent(agents, [...ANALYSIS_TOKENS, ...options.preferredAgentRoles])
  const fixAgent = matchAgent(
    agents.filter((agent) => agent.id !== analysisAgent?.id),
    [...FIX_TOKENS, ...options.preferredAgentRoles],
  ) ?? matchAgent(agents, FIX_TOKENS)
  const nodeIds = {
    trigger: newWorkflowNodeId(),
    analysis: newWorkflowNodeId(),
    condition: newWorkflowNodeId(),
    fix: newWorkflowNodeId(),
    plan: newWorkflowNodeId(),
  }
  const preview: WorkflowPreview = {
    name: options.name?.trim() || 'GitHub Issue Triage Workflow',
    summary: 'Webhook Trigger -> 代码分析 Agent -> 条件判断 -> 修复 Agent / 添加到计划文档',
    confirmationText: '这个 Workflow 看起来对吗？',
    nodes: [
      {
        id: nodeIds.trigger,
        type: 'webhook_trigger',
        label: 'Webhook Trigger',
        agentProfileId: null,
        position: { x: 24, y: 120 },
        config: {
          provider: 'github',
          event: 'issues.opened',
          triggerCondition: 'GitHub Issue created webhook',
          dryRunOnly: true,
        },
        inputMapping: { event: '$webhook.payload' },
        outputContract: {
          artifactType: 'json',
          schema: {
            issueTitle: 'string',
            issueBody: 'string',
            issueUrl: 'string',
          },
          validationRules: ['github_issue_payload_must_include_title_body_url'],
        },
        retryPolicy: { maxAttempts: 1 },
        approvalPolicy: {},
      },
      {
        id: nodeIds.analysis,
        type: 'agent_employee',
        label: '代码分析 Agent',
        agentProfileId: analysisAgent?.id ?? null,
        position: { x: 232, y: 120 },
        config: {
          role: 'issue_analysis',
          instruction: '分析 GitHub Issue，判断它是 bug、feature 还是 question，并给出理由。',
        },
        inputMapping: { issue: `$node.${nodeIds.trigger}.output` },
        outputContract: {
          artifactType: 'json',
          schema: {
            issueType: 'bug | feature | question',
            reasoning: 'string',
            recommendedAction: 'string',
          },
          validationRules: ['issue_type_must_be_bug_feature_or_question'],
        },
        retryPolicy: { maxAttempts: 2 },
        approvalPolicy: {},
      },
      {
        id: nodeIds.condition,
        type: 'condition',
        label: '条件判断',
        agentProfileId: null,
        position: { x: 440, y: 120 },
        config: {
          classifier: 'issue_type',
          branches: ['bug', 'feature', 'question'],
          source: `$node.${nodeIds.analysis}.output.issueType`,
        },
        inputMapping: { classification: `$node.${nodeIds.analysis}.output.issueType` },
        outputContract: {
          artifactType: 'json',
          validationRules: ['condition_branch_must_match_known_issue_type'],
        },
        retryPolicy: { maxAttempts: 1 },
        approvalPolicy: {},
      },
      {
        id: nodeIds.fix,
        type: 'agent_employee',
        label: '修复 Agent',
        agentProfileId: fixAgent?.id ?? analysisAgent?.id ?? null,
        position: { x: 648, y: 60 },
        config: {
          branch: 'bug',
          instruction: '当 Issue 被分类为 bug 时，定位问题并准备修复方案或代码变更。',
        },
        inputMapping: {
          issue: `$node.${nodeIds.trigger}.output`,
          analysis: `$node.${nodeIds.analysis}.output`,
        },
        outputContract: {
          artifactType: 'code',
          validationRules: ['bug_fix_must_include_patch_or_investigation_report'],
        },
        retryPolicy: { maxAttempts: 2 },
        approvalPolicy: { riskLevel: 'medium' },
      },
      {
        id: nodeIds.plan,
        type: 'artifact_transform',
        label: '添加到计划文档',
        agentProfileId: null,
        position: { x: 648, y: 184 },
        config: {
          branch: 'feature',
          targetArtifactType: 'document',
          instruction: '当 Issue 被分类为 feature 时，把需求写入计划文档并保留来源链接。',
        },
        inputMapping: {
          issue: `$node.${nodeIds.trigger}.output`,
          analysis: `$node.${nodeIds.analysis}.output`,
        },
        outputContract: {
          artifactType: 'document',
          requiredFiles: ['feature-plan.md'],
          validationRules: ['feature_plan_must_include_source_issue_and_priority'],
        },
        retryPolicy: { maxAttempts: 1 },
        approvalPolicy: {},
      },
    ],
    edges: [
      {
        id: newWorkflowEdgeId(),
        sourceNodeId: nodeIds.trigger,
        targetNodeId: nodeIds.analysis,
        mapping: { event: 'github_issue_created' },
      },
      {
        id: newWorkflowEdgeId(),
        sourceNodeId: nodeIds.analysis,
        targetNodeId: nodeIds.condition,
        mapping: { classification: 'issue_type' },
      },
      {
        id: newWorkflowEdgeId(),
        sourceNodeId: nodeIds.condition,
        targetNodeId: nodeIds.fix,
        sourceHandle: 'bug',
        mapping: { condition: 'bug', action: 'activate_fix_agent' },
      },
      {
        id: newWorkflowEdgeId(),
        sourceNodeId: nodeIds.condition,
        targetNodeId: nodeIds.plan,
        sourceHandle: 'feature',
        mapping: { condition: 'feature', action: 'append_to_plan_document' },
      },
    ],
  }
  const parsedIntent: JsonObject = {
    trigger: {
      type: 'github_issue_created_webhook',
      label: 'GitHub Issue created webhook',
      provider: 'github',
      event: 'issues.opened',
    },
    conditions: [
      {
        classifier: 'issue_type',
        branches: ['bug', 'feature', 'question'],
      },
    ],
    actions: [
      {
        branch: 'bug',
        type: 'activate_agent',
        label: '激活修复 Agent',
        agentProfileId: fixAgent?.id ?? analysisAgent?.id ?? null,
      },
      {
        branch: 'feature',
        type: 'append_to_plan_document',
        label: '写入计划文档',
        artifactType: 'document',
      },
    ],
    agents: {
      analysisAgentProfileId: analysisAgent?.id ?? null,
      fixAgentProfileId: fixAgent?.id ?? analysisAgent?.id ?? null,
    },
    originalPrompt: prompt.trim(),
  }
  const agentMatches: JsonObject = {
    analysisAgentProfileId: analysisAgent?.id ?? null,
    fixAgentProfileId: fixAgent?.id ?? analysisAgent?.id ?? null,
    matchedAgents: [
      buildAgentMatch('代码分析 Agent', analysisAgent, ANALYSIS_TOKENS),
      buildAgentMatch('修复 Agent', fixAgent ?? analysisAgent, FIX_TOKENS),
    ],
    availableAgentProfileIds: agents.map((agent) => agent.id),
  }
  const matchedCount = [analysisAgent, fixAgent ?? analysisAgent].filter(Boolean).length
  return {
    name: preview.name,
    intentType: 'github_issue_triage',
    parsedIntent,
    workflowPreview: preview,
    agentMatches,
    confidence: matchedCount >= 2 ? 0.92 : matchedCount === 1 ? 0.84 : 0.76,
  }
}

function buildGenericSequentialDraft(
  prompt: string,
  agents: AgentProfileRow[],
  options: { name?: string; preferredAgentRoles: string[] },
): ParsedDraft {
  const steps = splitPromptIntoSteps(prompt)
  const nodeIds = steps.map(() => newWorkflowNodeId())
  const preview: WorkflowPreview = {
    name: options.name?.trim() || 'Generated Agent Workflow',
    summary: steps.join(' -> '),
    confirmationText: '这个 Workflow 看起来对吗？',
    nodes: steps.map((step, index) => {
      const agent = matchAgent(agents, tokenize(`${step} ${options.preferredAgentRoles.join(' ')}`))
      return {
        id: nodeIds[index],
        type: agent ? 'agent_employee' : 'artifact_transform',
        label: step,
        agentProfileId: agent?.id ?? null,
        position: { x: 48 + index * 208, y: index % 2 === 0 ? 112 : 208 },
        config: {
          instruction: step,
          generatedBy: 'natural_language_workflow',
        },
        inputMapping: index === 0 ? { input: '$workflow.input' } : { input: `$node.${nodeIds[index - 1]}.output` },
        outputContract: {
          artifactType: index === steps.length - 1 ? 'report' : 'json',
          validationRules: ['generated_step_must_emit_artifact'],
        },
        retryPolicy: { maxAttempts: 1 },
        approvalPolicy: {},
      } satisfies PreviewNode
    }),
    edges: nodeIds.slice(0, -1).map((sourceNodeId, index) => ({
      id: newWorkflowEdgeId(),
      sourceNodeId,
      targetNodeId: nodeIds[index + 1],
      mapping: { artifact: 'previous_output' },
    })),
  }
  return {
    name: preview.name,
    intentType: 'generic_sequential',
    parsedIntent: {
      trigger: { type: 'manual_run', label: 'Manual workflow run' },
      steps,
      actions: steps.map((step, index) => ({
        order: index + 1,
        label: step,
        type: 'agent_or_transform_step',
      })),
      originalPrompt: prompt.trim(),
    },
    workflowPreview: preview,
    agentMatches: {
      matchedAgents: preview.nodes.map((node) => ({
        label: node.label,
        agentProfileId: node.agentProfileId,
      })),
      availableAgentProfileIds: agents.map((agent) => agent.id),
    },
    confidence: agents.length > 0 ? 0.74 : 0.66,
  }
}

async function selectCandidateAgents(agentProfileIds?: string[]): Promise<AgentProfileRow[]> {
  const allAgents = await db.query.agentProfiles.findMany({
    orderBy: [desc(schema.agentProfiles.createdAt)],
  })
  const ids = new Set((agentProfileIds ?? []).filter(Boolean))
  if (!ids.size) return allAgents
  return allAgents.filter((agent) => ids.has(agent.id))
}

function looksLikeGithubIssueTriage(prompt: string): boolean {
  const normalized = prompt.toLowerCase()
  const hits = GITHUB_ISSUE_TOKENS.filter((token) => normalized.includes(token.toLowerCase())).length
  return hits >= 3 && normalized.includes('github') && normalized.includes('issue')
}

function matchAgent(agents: AgentProfileRow[], tokens: string[]): AgentProfileRow | null {
  let best: { agent: AgentProfileRow; score: number } | null = null
  for (const agent of agents) {
    const haystack = `${agent.name} ${agent.role} ${agent.description} ${agent.systemPrompt}`.toLowerCase()
    const score = tokens.reduce((total, token) => {
      const normalizedToken = token.toLowerCase().trim()
      return normalizedToken && haystack.includes(normalizedToken) ? total + 1 : total
    }, 0)
    if (!best || score > best.score) best = { agent, score }
  }
  if (best && best.score > 0) return best.agent
  return agents[0] ?? null
}

function buildAgentMatch(label: string, agent: AgentProfileRow | null | undefined, tokens: string[]): JsonObject {
  return {
    label,
    agentProfileId: agent?.id ?? null,
    agentName: agent?.name ?? null,
    matchedBy: tokens,
    reason: agent
      ? `${label} matched against Agent name, role, description, and system prompt.`
      : `${label} has no available Agent match yet.`,
  }
}

function splitPromptIntoSteps(prompt: string): string[] {
  const cleaned = prompt.trim().replace(/\s+/g, ' ')
  const parts = cleaned
    .split(/(?:然后|接着|再|最后|,|，|。|;|；|\bthen\b|\band then\b)/i)
    .map((part) => part.trim())
    .filter(Boolean)
    .slice(0, 5)
  if (parts.length >= 2) return parts
  return [cleaned || '理解任务', '执行任务', '验证并输出结果']
}

function tokenize(value: string): string[] {
  return value
    .split(/[\s,，。;；/|]+/)
    .map((token) => token.trim())
    .filter(Boolean)
}

function toWorkflowPreview(value: JsonObject): WorkflowPreview {
  const nodes = Array.isArray(value.nodes) ? value.nodes : []
  const edges = Array.isArray(value.edges) ? value.edges : []
  return {
    name: typeof value.name === 'string' ? value.name : 'Generated Agent Workflow',
    summary: typeof value.summary === 'string' ? value.summary : '',
    confirmationText:
      typeof value.confirmationText === 'string' ? value.confirmationText : '这个 Workflow 看起来对吗？',
    nodes: nodes.map(toPreviewNode),
    edges: edges.map(toPreviewEdge),
  }
}

function toPreviewNode(value: unknown): PreviewNode {
  const obj = asObject(value)
  const id = stringOr(obj.id, newWorkflowNodeId())
  return {
    id,
    type: stringOr(obj.type, 'artifact_transform'),
    label: stringOr(obj.label, id),
    agentProfileId: typeof obj.agentProfileId === 'string' ? obj.agentProfileId : null,
    position: toPosition(obj.position),
    config: asJsonObject(obj.config),
    inputMapping: asJsonObject(obj.inputMapping),
    outputContract: asJsonObject(obj.outputContract),
    retryPolicy: asJsonObject(obj.retryPolicy),
    approvalPolicy: asJsonObject(obj.approvalPolicy),
  }
}

function toPreviewEdge(value: unknown): PreviewEdge {
  const obj = asObject(value)
  return {
    id: stringOr(obj.id, newWorkflowEdgeId()),
    sourceNodeId: stringOr(obj.sourceNodeId, ''),
    targetNodeId: stringOr(obj.targetNodeId, ''),
    sourceHandle: typeof obj.sourceHandle === 'string' ? obj.sourceHandle : null,
    targetHandle: typeof obj.targetHandle === 'string' ? obj.targetHandle : null,
    mapping: asJsonObject(obj.mapping),
  }
}

function toPosition(value: unknown): { x: number; y: number } {
  const obj = asObject(value)
  return {
    x: numberOr(obj.x, 0),
    y: numberOr(obj.y, 0),
  }
}

function buildWorkflowDescription(
  draft: NaturalLanguageWorkflowDraftRow,
  preview: WorkflowPreview,
  modifications: JsonObject,
): string {
  const modificationKeys = Object.keys(modifications)
  const modificationSummary = modificationKeys.length
    ? ` Confirmation modifications: ${JSON.stringify(modifications)}`
    : ''
  return `Generated from natural language prompt. Intent: ${draft.intentType}. Preview: ${preview.summary}. Prompt: ${draft.prompt}.${modificationSummary}`
}

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function asJsonObject(value: unknown): JsonObject {
  return asObject(value) as JsonObject
}

function stringOr(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() ? value : fallback
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function clampInt(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.round(value)))
}
