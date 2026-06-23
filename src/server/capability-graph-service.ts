import { and, desc, eq } from 'drizzle-orm'

import { db, schema } from '@/db/client'
import type {
  AgentProfileRow,
  CapabilityIndexEntryRow,
  CapabilityRecommendationRow,
  CapabilitySourceType,
  HealthStatus,
  JsonObject,
  KnowledgeEdgeType,
  KnowledgeGraphEdgeRow,
  KnowledgeGraphNodeRow,
  KnowledgeNodeType,
  RiskLevel,
} from '@/db/schema'
import {
  newCapabilityIndexEntryId,
  newCapabilityRecommendationId,
  newKnowledgeGraphEdgeId,
  newKnowledgeGraphNodeId,
} from '@/server/ids'

interface CapabilityInput {
  sourceType: CapabilitySourceType
  sourceId: string
  displayName: string
  description: string
  capabilityKind: string
  keywords: string[]
  signals: JsonObject
  riskLevel: RiskLevel
  enabled: boolean
  healthStatus: HealthStatus
  scoreHint: number
}

export interface CapabilitySearchResult {
  entry: CapabilityIndexEntryRow
  score: number
  reason: string
  matchedKeywords: string[]
}

export interface CapabilityRecommendationResult {
  recommendation: CapabilityRecommendationRow
  entry: CapabilityIndexEntryRow
  score: number
  reason: string
}

export interface ApplyCapabilityRecommendationResult {
  recommendation: CapabilityRecommendationRow
  agentProfile: AgentProfileRow
  entry: CapabilityIndexEntryRow
  appliedChanges: string[]
}

export interface CapabilityKnowledgeGraph {
  nodes: KnowledgeGraphNodeRow[]
  edges: KnowledgeGraphEdgeRow[]
}

const TOKEN_SYNONYMS: Record<string, string[]> = {
  agent: ['agent', 'employee', 'worker', '员工', '智能体'],
  browser: ['browser', 'chrome', 'web', '网页', '浏览器'],
  cli: ['cli', 'command', 'terminal', 'shell', '命令', '终端'],
  code: ['code', 'coding', 'codex', 'developer', '代码', '编程', '开发'],
  design: ['design', 'ui', 'figma', 'prototype', '设计', '原型'],
  file: ['file', 'filesystem', 'workspace', '文件', '目录'],
  mcp: ['mcp', 'tool', 'connection', '工具', '连接'],
  memory: ['memory', 'knowledge', 'playbook', '记忆', '知识', '经验'],
  model: ['model', 'llm', 'vision', 'json', '模型', '大模型'],
  review: ['review', 'audit', 'verify', '审查', '审核', '验证'],
  search: ['search', 'research', 'crawl', '检索', '搜索', '调研'],
  software: ['software', 'app', 'desktop', 'macro', '软件', '桌面', '应用'],
}

export async function rebuildCapabilityIndex(): Promise<CapabilityIndexEntryRow[]> {
  const inputs = await collectCapabilityInputs()
  const entries: CapabilityIndexEntryRow[] = []
  for (const input of inputs) {
    entries.push(await upsertCapabilityEntry(input))
  }
  await linkAgentAssignedCapabilities()
  return entries
}

export async function listCapabilityIndexEntries(
  sourceType?: CapabilitySourceType,
): Promise<CapabilityIndexEntryRow[]> {
  return db.query.capabilityIndexEntries.findMany({
    where: sourceType ? eq(schema.capabilityIndexEntries.sourceType, sourceType) : undefined,
    orderBy: [desc(schema.capabilityIndexEntries.updatedAt)],
    limit: 500,
  })
}

export async function searchCapabilities(
  query: string,
  limit = 10,
): Promise<CapabilitySearchResult[]> {
  let entries = await listCapabilityIndexEntries()
  if (entries.length === 0) entries = await rebuildCapabilityIndex()

  const queryTokens = expandTokens(tokenize(query))
  const scored = entries
    .map((entry) => scoreCapability(entry, queryTokens, query))
    .filter((result) => result.score > 0)
    .sort((a, b) => b.score - a.score || b.entry.updatedAt - a.entry.updatedAt)
    .slice(0, Math.max(1, Math.min(limit, 50)))

  return scored
}

export async function recommendCapabilitiesForAgent(args: {
  agentProfileId: string
  goal: string
  limit?: number
}): Promise<CapabilityRecommendationResult[]> {
  const agent = await getRequiredAgentProfile(args.agentProfileId)
  const query = buildAgentRecommendationQuery(agent, args.goal)
  const searchResults = (await searchCapabilities(query, args.limit ?? 8)).filter(
    ({ entry }) => !(entry.sourceType === 'agent_profile' && entry.sourceId === agent.id),
  )

  const agentNode = await ensureKnowledgeNode({
    nodeType: 'agent',
    sourceType: 'agent_profile',
    sourceId: agent.id,
    label: agent.name,
    summary: agent.description || agent.role,
    properties: { role: agent.role, status: agent.status },
  })

  const recommendations: CapabilityRecommendationResult[] = []
  for (const result of searchResults) {
    const row: CapabilityRecommendationRow = {
      id: newCapabilityRecommendationId(),
      agentProfileId: agent.id,
      query: args.goal.trim(),
      capabilityEntryId: result.entry.id,
      score: result.score,
      reason: result.reason,
      applied: false,
      createdAt: Date.now(),
    }
    await db.insert(schema.capabilityRecommendations).values(row)
    const capabilityNode = await ensureKnowledgeNodeForEntry(result.entry)
    await ensureKnowledgeEdge({
      fromNodeId: capabilityNode.id,
      toNodeId: agentNode.id,
      edgeType: 'recommended_for',
      weight: result.score,
      evidence: {
        recommendationId: row.id,
        matchedKeywords: result.matchedKeywords,
        query: args.goal.trim(),
      },
    })
    recommendations.push({
      recommendation: row,
      entry: result.entry,
      score: result.score,
      reason: result.reason,
    })
  }
  return recommendations
}

export async function listCapabilityRecommendations(
  agentProfileId?: string,
): Promise<CapabilityRecommendationRow[]> {
  return db.query.capabilityRecommendations.findMany({
    where: agentProfileId
      ? eq(schema.capabilityRecommendations.agentProfileId, agentProfileId)
      : undefined,
    orderBy: [desc(schema.capabilityRecommendations.createdAt)],
    limit: 200,
  })
}

export async function applyCapabilityRecommendation(
  recommendationId: string,
): Promise<ApplyCapabilityRecommendationResult> {
  const recommendation = await getRequiredCapabilityRecommendation(recommendationId)
  if (!recommendation.agentProfileId) {
    throw new Error(`Capability recommendation has no Agent profile: ${recommendationId}`)
  }
  if (!recommendation.capabilityEntryId) {
    throw new Error(`Capability recommendation has no capability entry: ${recommendationId}`)
  }

  const agent = await getRequiredAgentProfile(recommendation.agentProfileId)
  const entry = await getRequiredCapabilityIndexEntry(recommendation.capabilityEntryId)
  const { updates, changes } = buildAgentCapabilityUpdates(agent, entry)
  if (changes.length === 0) {
    throw new Error(`Capability ${entry.sourceType}:${entry.sourceId} cannot be applied to an Agent profile.`)
  }

  const now = Date.now()
  const realChanges = changes.filter((change) => !change.startsWith('already:'))
  if (realChanges.length > 0) {
    await db
      .update(schema.agentProfiles)
      .set({ ...updates, updatedAt: now })
      .where(eq(schema.agentProfiles.id, agent.id))
  }
  await db
    .update(schema.capabilityRecommendations)
    .set({ applied: true })
    .where(eq(schema.capabilityRecommendations.id, recommendation.id))

  const updatedAgent = await getRequiredAgentProfile(agent.id)
  const updatedRecommendation = await getRequiredCapabilityRecommendation(recommendation.id)
  const agentNode = await ensureKnowledgeNode({
    nodeType: 'agent',
    sourceType: 'agent_profile',
    sourceId: updatedAgent.id,
    label: updatedAgent.name,
    summary: updatedAgent.description || updatedAgent.role,
    properties: { role: updatedAgent.role, status: updatedAgent.status },
  })
  const capabilityNode = await ensureKnowledgeNodeForEntry(entry)
  await ensureKnowledgeEdge({
    fromNodeId: agentNode.id,
    toNodeId: capabilityNode.id,
    edgeType: 'uses',
    weight: 1,
    evidence: {
      recommendationId: recommendation.id,
      appliedChanges: changes,
      sourceType: entry.sourceType,
      sourceId: entry.sourceId,
    },
  })

  return {
    recommendation: updatedRecommendation,
    agentProfile: updatedAgent,
    entry,
    appliedChanges: changes,
  }
}

export async function getCapabilityKnowledgeGraph(): Promise<CapabilityKnowledgeGraph> {
  const nodes = await db.query.knowledgeGraphNodes.findMany({
    orderBy: [desc(schema.knowledgeGraphNodes.updatedAt)],
    limit: 500,
  })
  const edges = await db.query.knowledgeGraphEdges.findMany({
    orderBy: [desc(schema.knowledgeGraphEdges.createdAt)],
    limit: 1000,
  })
  return { nodes, edges }
}

async function collectCapabilityInputs(): Promise<CapabilityInput[]> {
  const [
    skills,
    mcpServers,
    mcpToolDefinitions,
    toolConnections,
    cliProfiles,
    softwareProfiles,
    softwareCommands,
    recordedMacros,
    modelProfiles,
    agentProfiles,
    playbooks,
  ] = await Promise.all([
    db.query.skills.findMany(),
    db.query.mcpServers.findMany(),
    db.query.mcpToolDefinitions.findMany(),
    db.query.toolConnections.findMany(),
    db.query.cliProfiles.findMany(),
    db.query.softwareProfiles.findMany(),
    db.query.softwareCommands.findMany(),
    db.query.recordedMacros.findMany(),
    db.query.modelProfiles.findMany(),
    db.query.agentProfiles.findMany(),
    db.query.playbooks.findMany(),
  ])

  return [
    ...skills.map(
      (skill): CapabilityInput => ({
        sourceType: 'skill',
        sourceId: skill.id,
        displayName: skill.name,
        description: skill.description,
        capabilityKind: 'skill',
        keywords: extractKeywords(skill.name, skill.description, skill.source, skill.manifest),
        signals: {
          source: skill.source,
          sourceUrl: skill.sourceUrl,
          manifest: skill.manifest,
          installPath: skill.installPath,
        },
        riskLevel: 'low',
        enabled: skill.enabled && skill.status === 'installed',
        healthStatus: skill.status === 'failed' ? 'failed' : skill.enabled ? 'ok' : 'unknown',
        scoreHint: skill.enabled ? 4 : -8,
      }),
    ),
    ...mcpServers.map(
      (server): CapabilityInput => ({
        sourceType: 'mcp_server',
        sourceId: server.id,
        displayName: server.displayName,
        description: [server.transport, server.command, server.endpoint, ...server.args]
          .filter(Boolean)
          .join(' '),
        capabilityKind: 'mcp_server',
        keywords: extractKeywords(server.displayName, server.transport, server.command, server.endpoint, server.args),
        signals: {
          transport: server.transport,
          command: server.command,
          endpoint: server.endpoint,
          args: server.args,
        },
        riskLevel: 'medium',
        enabled: server.enabled,
        healthStatus: server.healthStatus,
        scoreHint: server.enabled ? 2 : -10,
      }),
    ),
    ...mcpToolDefinitions.map(
      (tool): CapabilityInput => ({
        sourceType: 'mcp_tool',
        sourceId: tool.id,
        displayName: tool.displayName,
        description: tool.description,
        capabilityKind: 'mcp_tool',
        keywords: extractKeywords(
          tool.toolName,
          tool.displayName,
          tool.description,
          tool.inputSchema,
          tool.outputSchema,
          tool.annotations,
          tool.riskLevel,
        ),
        signals: {
          mcpServerId: tool.mcpServerId,
          toolName: tool.toolName,
          inputSchema: tool.inputSchema,
          outputSchema: tool.outputSchema,
          annotations: tool.annotations,
          requiresApproval: tool.requiresApproval,
        },
        riskLevel: tool.riskLevel,
        enabled: tool.enabled,
        healthStatus: tool.enabled ? 'ok' : 'unknown',
        scoreHint: tool.requiresApproval ? 1 : 3,
      }),
    ),
    ...toolConnections.map(
      (connection): CapabilityInput => ({
        sourceType: 'tool_connection',
        sourceId: connection.id,
        displayName: connection.displayName,
        description: `${connection.type} tool connection`,
        capabilityKind: connection.type,
        keywords: extractKeywords(connection.displayName, connection.type, connection.config),
        signals: {
          type: connection.type,
          config: connection.config,
        },
        riskLevel: connection.type === 'software' ? 'medium' : 'low',
        enabled: connection.enabled,
        healthStatus: connection.healthStatus,
        scoreHint: connection.enabled ? 2 : -10,
      }),
    ),
    ...cliProfiles.map(
      (cli): CapabilityInput => ({
        sourceType: 'cli_profile',
        sourceId: cli.id,
        displayName: cli.name,
        description: `${cli.command} ${cli.argsTemplate}`,
        capabilityKind: 'cli',
        keywords: extractKeywords(cli.name, cli.command, cli.argsTemplate, cli.inputMode, cli.outputMode),
        signals: {
          command: cli.command,
          argsTemplate: cli.argsTemplate,
          cwdPolicy: cli.cwdPolicy,
          inputMode: cli.inputMode,
          outputMode: cli.outputMode,
          requiresApproval: cli.requiresApproval,
        },
        riskLevel: cli.requiresApproval ? 'medium' : 'low',
        enabled: true,
        healthStatus: cli.healthStatus,
        scoreHint: cli.requiresApproval ? 1 : 3,
      }),
    ),
    ...softwareProfiles.map(
      (software): CapabilityInput => ({
        sourceType: 'software_profile',
        sourceId: software.id,
        displayName: software.name,
        description: `${software.appType} via ${software.adapterType}`,
        capabilityKind: 'software',
        keywords: extractKeywords(
          software.name,
          software.appType,
          software.adapterType,
          software.launchCommand,
          software.executablePath,
        ),
        signals: {
          appType: software.appType,
          adapterType: software.adapterType,
          launchCommand: software.launchCommand,
          defaultWorkstationMode: software.defaultWorkstationMode,
        },
        riskLevel: software.adapterType === 'desktop_automation' ? 'high' : 'medium',
        enabled: true,
        healthStatus: 'unknown',
        scoreHint: 2,
      }),
    ),
    ...softwareCommands.map(
      (command): CapabilityInput => ({
        sourceType: 'software_command',
        sourceId: command.id,
        displayName: command.name,
        description: command.description,
        capabilityKind: 'software_command',
        keywords: extractKeywords(
          command.name,
          command.description,
          command.inputSchema,
          command.outputSchema,
          command.implementation,
          command.riskLevel,
        ),
        signals: {
          softwareProfileId: command.softwareProfileId,
          inputSchema: command.inputSchema,
          outputSchema: command.outputSchema,
          implementation: command.implementation,
          requiresApproval: command.requiresApproval,
        },
        riskLevel: command.riskLevel,
        enabled: true,
        healthStatus: command.healthStatus,
        scoreHint: command.requiresApproval ? 1 : 3,
      }),
    ),
    ...recordedMacros.map(
      (macro): CapabilityInput => ({
        sourceType: 'recorded_macro',
        sourceId: macro.id,
        displayName: macro.name,
        description: macro.description,
        capabilityKind: 'recorded_macro',
        keywords: extractKeywords(
          macro.name,
          macro.description,
          macro.steps,
          macro.inputSchema,
          macro.outputSchema,
          macro.parameterBindings,
          macro.riskLevel,
        ),
        signals: {
          softwareProfileId: macro.softwareProfileId,
          stepCount: macro.steps.length,
          inputSchema: macro.inputSchema,
          outputSchema: macro.outputSchema,
          parameterBindings: macro.parameterBindings,
          status: macro.status,
        },
        riskLevel: macro.riskLevel,
        enabled: macro.status === 'active',
        healthStatus: macro.status === 'archived' ? 'unknown' : 'ok',
        scoreHint: macro.status === 'active' ? 4 : -5,
      }),
    ),
    ...modelProfiles.map(
      (model): CapabilityInput => ({
        sourceType: 'model_profile',
        sourceId: model.id,
        displayName: model.name,
        description: `${model.provider} ${model.model}`,
        capabilityKind: 'model',
        keywords: extractKeywords(
          model.name,
          model.provider,
          model.model,
          model.supportsVision ? 'vision image screenshot' : '',
          model.supportsToolCalling ? 'tool calling function tools' : '',
          model.supportsJsonMode ? 'json structured output' : '',
        ),
        signals: {
          provider: model.provider,
          model: model.model,
          supportsVision: model.supportsVision,
          supportsToolCalling: model.supportsToolCalling,
          supportsJsonMode: model.supportsJsonMode,
          contextWindow: model.contextWindow,
          networkProfileId: model.networkProfileId,
        },
        riskLevel: 'low',
        enabled: true,
        healthStatus: model.healthStatus,
        scoreHint:
          (model.supportsVision ? 2 : 0) +
          (model.supportsToolCalling ? 2 : 0) +
          (model.supportsJsonMode ? 1 : 0),
      }),
    ),
    ...agentProfiles.map(
      (agent): CapabilityInput => ({
        sourceType: 'agent_profile',
        sourceId: agent.id,
        displayName: agent.name,
        description: agent.description || agent.role,
        capabilityKind: 'agent_employee',
        keywords: extractKeywords(
          agent.name,
          agent.role,
          agent.description,
          agent.systemPrompt,
          agent.behaviorRules,
          agent.successCriteria,
          agent.outputContract,
        ),
        signals: {
          role: agent.role,
          modelProfileId: agent.modelProfileId,
          skillIds: agent.skillIds,
          mcpServerIds: agent.mcpServerIds,
          cliProfileIds: agent.cliProfileIds,
          softwareProfileIds: agent.softwareProfileIds,
          outputContract: agent.outputContract,
        },
        riskLevel: 'medium',
        enabled: agent.status !== 'archived',
        healthStatus: 'unknown',
        scoreHint: agent.status === 'active' ? 4 : 1,
      }),
    ),
    ...playbooks.map(
      (playbook): CapabilityInput => ({
        sourceType: 'playbook',
        sourceId: playbook.id,
        displayName: playbook.title,
        description: playbook.description,
        capabilityKind: 'playbook',
        keywords: extractKeywords(playbook.title, playbook.description, playbook.status),
        signals: {
          agentProfileId: playbook.agentProfileId,
          sourceLearningEventId: playbook.sourceLearningEventId,
          status: playbook.status,
        },
        riskLevel: 'low',
        enabled: playbook.status === 'active',
        healthStatus: playbook.status === 'archived' ? 'unknown' : 'ok',
        scoreHint: playbook.status === 'active' ? 5 : 0,
      }),
    ),
  ]
}

async function upsertCapabilityEntry(input: CapabilityInput): Promise<CapabilityIndexEntryRow> {
  const now = Date.now()
  const keywords = unique([...input.keywords, ...extractKeywords(input.displayName, input.description)])
  const existing = await db.query.capabilityIndexEntries.findFirst({
    where: and(
      eq(schema.capabilityIndexEntries.sourceType, input.sourceType),
      eq(schema.capabilityIndexEntries.sourceId, input.sourceId),
    ),
  })
  if (existing) {
    await db
      .update(schema.capabilityIndexEntries)
      .set({
        displayName: input.displayName,
        description: input.description,
        capabilityKind: input.capabilityKind,
        keywords,
        signals: input.signals,
        riskLevel: input.riskLevel,
        enabled: input.enabled,
        healthStatus: input.healthStatus,
        scoreHint: input.scoreHint,
        lastIndexedAt: now,
        updatedAt: now,
      })
      .where(eq(schema.capabilityIndexEntries.id, existing.id))
    const updated = await db.query.capabilityIndexEntries.findFirst({
      where: eq(schema.capabilityIndexEntries.id, existing.id),
    })
    if (!updated) throw new Error(`Capability index entry missing after update: ${existing.id}`)
    await ensureKnowledgeNodeForEntry(updated)
    return updated
  }

  const row: CapabilityIndexEntryRow = {
    id: newCapabilityIndexEntryId(),
    sourceType: input.sourceType,
    sourceId: input.sourceId,
    displayName: input.displayName,
    description: input.description,
    capabilityKind: input.capabilityKind,
    keywords,
    signals: input.signals,
    riskLevel: input.riskLevel,
    enabled: input.enabled,
    healthStatus: input.healthStatus,
    scoreHint: input.scoreHint,
    lastIndexedAt: now,
    createdAt: now,
    updatedAt: now,
  }
  await db.insert(schema.capabilityIndexEntries).values(row)
  await ensureKnowledgeNodeForEntry(row)
  return row
}

async function linkAgentAssignedCapabilities(): Promise<void> {
  const agents = await db.query.agentProfiles.findMany()
  const entries = await listCapabilityIndexEntries()
  for (const agent of agents) {
    const agentNode = await ensureKnowledgeNode({
      nodeType: 'agent',
      sourceType: 'agent_profile',
      sourceId: agent.id,
      label: agent.name,
      summary: agent.description || agent.role,
      properties: { role: agent.role, status: agent.status },
    })
    const assigned = entries.filter((entry) => isAssignedToAgent(agent, entry))
    for (const entry of assigned) {
      const capabilityNode = await ensureKnowledgeNodeForEntry(entry)
      await ensureKnowledgeEdge({
        fromNodeId: agentNode.id,
        toNodeId: capabilityNode.id,
        edgeType: 'uses',
        weight: 1,
        evidence: { agentProfileId: agent.id, sourceType: entry.sourceType, sourceId: entry.sourceId },
      })
    }
  }

  const softwareProfiles = entries.filter((entry) => entry.sourceType === 'software_profile')
  const softwareCommands = entries.filter((entry) => entry.sourceType === 'software_command')
  for (const commandEntry of softwareCommands) {
    const profileId = getString(commandEntry.signals, 'softwareProfileId')
    const profileEntry = softwareProfiles.find((entry) => entry.sourceId === profileId)
    if (!profileEntry) continue
    const commandNode = await ensureKnowledgeNodeForEntry(commandEntry)
    const profileNode = await ensureKnowledgeNodeForEntry(profileEntry)
    await ensureKnowledgeEdge({
      fromNodeId: commandNode.id,
      toNodeId: profileNode.id,
      edgeType: 'owned_by',
      weight: 1,
      evidence: { softwareProfileId: profileEntry.sourceId },
    })
  }
}

function isAssignedToAgent(agent: AgentProfileRow, entry: CapabilityIndexEntryRow): boolean {
  if (entry.sourceType === 'model_profile') {
    return agent.modelProfileId === entry.sourceId || agent.fallbackModelProfileIds.includes(entry.sourceId)
  }
  if (entry.sourceType === 'skill') return agent.skillIds.includes(entry.sourceId)
  if (entry.sourceType === 'mcp_server') return agent.mcpServerIds.includes(entry.sourceId)
  if (entry.sourceType === 'mcp_tool') {
    return agent.mcpServerIds.includes(getString(entry.signals, 'mcpServerId') ?? '')
  }
  if (entry.sourceType === 'cli_profile') return agent.cliProfileIds.includes(entry.sourceId)
  if (entry.sourceType === 'software_profile') return agent.softwareProfileIds.includes(entry.sourceId)
  if (entry.sourceType === 'software_command') {
    return agent.softwareProfileIds.includes(getString(entry.signals, 'softwareProfileId') ?? '')
  }
  if (entry.sourceType === 'recorded_macro') {
    return agent.softwareProfileIds.includes(getString(entry.signals, 'softwareProfileId') ?? '')
  }
  if (entry.sourceType === 'playbook') return getString(entry.signals, 'agentProfileId') === agent.id
  return false
}

async function ensureKnowledgeNodeForEntry(
  entry: CapabilityIndexEntryRow,
): Promise<KnowledgeGraphNodeRow> {
  return ensureKnowledgeNode({
    nodeType: knowledgeNodeTypeForSource(entry.sourceType),
    sourceType: entry.sourceType,
    sourceId: entry.sourceId,
    label: entry.displayName,
    summary: entry.description,
    properties: {
      capabilityEntryId: entry.id,
      capabilityKind: entry.capabilityKind,
      keywords: entry.keywords,
      riskLevel: entry.riskLevel,
      enabled: entry.enabled,
      healthStatus: entry.healthStatus,
    },
  })
}

async function ensureKnowledgeNode(args: {
  nodeType: KnowledgeNodeType
  sourceType?: CapabilitySourceType | null
  sourceId?: string | null
  label: string
  summary?: string
  properties?: JsonObject
}): Promise<KnowledgeGraphNodeRow> {
  const existing =
    args.sourceType && args.sourceId
      ? await db.query.knowledgeGraphNodes.findFirst({
          where: and(
            eq(schema.knowledgeGraphNodes.sourceType, args.sourceType),
            eq(schema.knowledgeGraphNodes.sourceId, args.sourceId),
          ),
        })
      : null
  const now = Date.now()
  if (existing) {
    await db
      .update(schema.knowledgeGraphNodes)
      .set({
        nodeType: args.nodeType,
        label: args.label,
        summary: args.summary ?? '',
        properties: args.properties ?? {},
        embedding: existing.embedding ?? [],
        updatedAt: now,
      })
      .where(eq(schema.knowledgeGraphNodes.id, existing.id))
    const updated = await db.query.knowledgeGraphNodes.findFirst({
      where: eq(schema.knowledgeGraphNodes.id, existing.id),
    })
    if (!updated) throw new Error(`Knowledge graph node missing after update: ${existing.id}`)
    return updated
  }

  const row: KnowledgeGraphNodeRow = {
    id: newKnowledgeGraphNodeId(),
    nodeType: args.nodeType,
    sourceType: args.sourceType ?? null,
    sourceId: args.sourceId ?? null,
    label: args.label,
    summary: args.summary ?? '',
    properties: args.properties ?? {},
    embedding: [],
    createdAt: now,
    updatedAt: now,
  }
  await db.insert(schema.knowledgeGraphNodes).values(row)
  return row
}

async function ensureKnowledgeEdge(args: {
  fromNodeId: string
  toNodeId: string
  edgeType: KnowledgeEdgeType
  weight?: number
  evidence?: JsonObject
}): Promise<KnowledgeGraphEdgeRow> {
  const existing = await db.query.knowledgeGraphEdges.findFirst({
    where: and(
      eq(schema.knowledgeGraphEdges.fromNodeId, args.fromNodeId),
      eq(schema.knowledgeGraphEdges.toNodeId, args.toNodeId),
      eq(schema.knowledgeGraphEdges.edgeType, args.edgeType),
    ),
  })
  if (existing) return existing
  const row: KnowledgeGraphEdgeRow = {
    id: newKnowledgeGraphEdgeId(),
    fromNodeId: args.fromNodeId,
    toNodeId: args.toNodeId,
    edgeType: args.edgeType,
    weight: args.weight ?? 1,
    evidence: args.evidence ?? {},
    createdAt: Date.now(),
  }
  await db.insert(schema.knowledgeGraphEdges).values(row)
  return row
}

function scoreCapability(
  entry: CapabilityIndexEntryRow,
  queryTokens: string[],
  rawQuery: string,
): CapabilitySearchResult {
  const entryTokens = new Set(
    expandTokens(
      tokenize(
        [
          entry.displayName,
          entry.description,
          entry.capabilityKind,
          entry.keywords.join(' '),
          textFromJson(entry.signals).join(' '),
        ].join(' '),
      ),
    ),
  )
  const matchedKeywords = unique(queryTokens.filter((token) => entryTokens.has(token)))
  const phrase = rawQuery.toLowerCase()
  const nameTokens = tokenize(entry.displayName)
  const nameMatch = nameTokens.filter((token) => queryTokens.includes(token)).length
  const enabledPenalty = entry.enabled ? 0 : -25
  const healthBonus = entry.healthStatus === 'ok' ? 2 : entry.healthStatus === 'failed' ? -8 : 0
  const kindBonus = queryTokens.includes(entry.capabilityKind.toLowerCase()) ? 3 : 0
  const phraseBonus =
    phrase.includes(entry.displayName.toLowerCase()) || entry.displayName.toLowerCase().includes(phrase)
      ? 4
      : 0
  const score =
    matchedKeywords.length * 8 +
    nameMatch * 3 +
    kindBonus +
    phraseBonus +
    healthBonus +
    entry.scoreHint +
    enabledPenalty
  return {
    entry,
    score: Math.round(score * 100) / 100,
    reason:
      matchedKeywords.length > 0
        ? `Matched ${matchedKeywords.slice(0, 6).join(', ')}.`
        : `Matched capability hint ${entry.capabilityKind}.`,
    matchedKeywords,
  }
}

function buildAgentRecommendationQuery(agent: AgentProfileRow, goal: string): string {
  return [
    goal,
    agent.name,
    agent.role,
    agent.description,
    agent.systemPrompt,
    agent.behaviorRules.join(' '),
    agent.successCriteria.join(' '),
    JSON.stringify(agent.inputContract),
    JSON.stringify(agent.outputContract),
  ]
    .filter(Boolean)
    .join(' ')
}

function knowledgeNodeTypeForSource(sourceType: CapabilitySourceType): KnowledgeNodeType {
  if (sourceType === 'agent_profile') return 'agent'
  if (sourceType === 'skill') return 'skill'
  if (sourceType === 'model_profile') return 'model'
  if (sourceType === 'playbook') return 'playbook'
  return 'tool'
}

async function getRequiredAgentProfile(id: string): Promise<AgentProfileRow> {
  const row = await db.query.agentProfiles.findFirst({ where: eq(schema.agentProfiles.id, id) })
  if (!row) throw new Error(`Agent profile not found: ${id}`)
  return row
}

async function getRequiredCapabilityRecommendation(id: string): Promise<CapabilityRecommendationRow> {
  const row = await db.query.capabilityRecommendations.findFirst({
    where: eq(schema.capabilityRecommendations.id, id),
  })
  if (!row) throw new Error(`Capability recommendation not found: ${id}`)
  return row
}

async function getRequiredCapabilityIndexEntry(id: string): Promise<CapabilityIndexEntryRow> {
  const row = await db.query.capabilityIndexEntries.findFirst({
    where: eq(schema.capabilityIndexEntries.id, id),
  })
  if (!row) throw new Error(`Capability index entry not found: ${id}`)
  return row
}

function buildAgentCapabilityUpdates(
  agent: AgentProfileRow,
  entry: CapabilityIndexEntryRow,
): {
  updates: Partial<Pick<
    AgentProfileRow,
    | 'modelProfileId'
    | 'fallbackModelProfileIds'
    | 'skillIds'
    | 'mcpServerIds'
    | 'cliProfileIds'
    | 'softwareProfileIds'
  >>
  changes: string[]
} {
  if (entry.sourceType === 'model_profile') {
    if (!agent.modelProfileId) {
      return { updates: { modelProfileId: entry.sourceId }, changes: ['modelProfileId'] }
    }
    if (agent.modelProfileId === entry.sourceId) {
      return { updates: {}, changes: ['already:modelProfileId'] }
    }
    const nextFallbacks = appendUnique(agent.fallbackModelProfileIds, entry.sourceId)
    return {
      updates: nextFallbacks === agent.fallbackModelProfileIds ? {} : { fallbackModelProfileIds: nextFallbacks },
      changes:
        nextFallbacks === agent.fallbackModelProfileIds
          ? ['already:fallbackModelProfileIds']
          : ['fallbackModelProfileIds'],
    }
  }

  if (entry.sourceType === 'skill') {
    return appendCapabilityId(agent.skillIds, entry.sourceId, 'skillIds')
  }
  if (entry.sourceType === 'mcp_server') {
    return appendCapabilityId(agent.mcpServerIds, entry.sourceId, 'mcpServerIds')
  }
  if (entry.sourceType === 'mcp_tool') {
    const mcpServerId = getString(entry.signals, 'mcpServerId')
    return mcpServerId ? appendCapabilityId(agent.mcpServerIds, mcpServerId, 'mcpServerIds') : emptyCapabilityUpdate()
  }
  if (entry.sourceType === 'cli_profile') {
    return appendCapabilityId(agent.cliProfileIds, entry.sourceId, 'cliProfileIds')
  }
  if (entry.sourceType === 'software_profile') {
    return appendCapabilityId(agent.softwareProfileIds, entry.sourceId, 'softwareProfileIds')
  }
  if (entry.sourceType === 'software_command' || entry.sourceType === 'recorded_macro') {
    const softwareProfileId = getString(entry.signals, 'softwareProfileId')
    return softwareProfileId
      ? appendCapabilityId(agent.softwareProfileIds, softwareProfileId, 'softwareProfileIds')
      : emptyCapabilityUpdate()
  }
  return emptyCapabilityUpdate()
}

function appendCapabilityId<
  Key extends 'skillIds' | 'mcpServerIds' | 'cliProfileIds' | 'softwareProfileIds',
>(
  current: string[],
  id: string,
  key: Key,
): {
  updates: Partial<Pick<AgentProfileRow, Key>>
  changes: string[]
} {
  const next = appendUnique(current, id)
  if (next === current) return { updates: {}, changes: [`already:${key}`] }
  return { updates: { [key]: next } as Partial<Pick<AgentProfileRow, Key>>, changes: [key] }
}

function emptyCapabilityUpdate() {
  return { updates: {}, changes: [] }
}

function extractKeywords(...values: unknown[]): string[] {
  return unique(expandTokens(values.flatMap((value) => tokenizeValue(value)))).slice(0, 80)
}

function tokenizeValue(value: unknown): string[] {
  if (value === null || value === undefined) return []
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return tokenize(String(value))
  }
  if (Array.isArray(value)) return value.flatMap((item) => tokenizeValue(item))
  if (typeof value === 'object') return textFromJson(value).flatMap((text) => tokenize(text))
  return []
}

function tokenize(text: string): string[] {
  return unique(
    text
      .normalize('NFKC')
      .toLowerCase()
      .match(/[\p{L}\p{N}_-]+/gu)
      ?.map((token) => token.replace(/^[-_]+|[-_]+$/g, ''))
      .filter((token) => token.length >= 2) ?? [],
  )
}

function expandTokens(tokens: string[]): string[] {
  const expanded = new Set(tokens)
  for (const token of tokens) {
    for (const group of Object.values(TOKEN_SYNONYMS)) {
      if (group.some((word) => token.includes(word) || word.includes(token))) {
        group.forEach((word) => expanded.add(word))
      }
    }
  }
  return [...expanded]
}

function textFromJson(value: unknown, depth = 0): string[] {
  if (depth > 4 || value === null || value === undefined) return []
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return [String(value)]
  }
  if (Array.isArray(value)) return value.flatMap((item) => textFromJson(item, depth + 1))
  if (typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>).flatMap(([key, nested]) => [
      key,
      ...textFromJson(nested, depth + 1),
    ])
  }
  return []
}

function getString(value: JsonObject, key: string): string | null {
  const next = value[key]
  return typeof next === 'string' && next.trim() ? next.trim() : null
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)]
}

function appendUnique(values: string[], value: string): string[] {
  return values.includes(value) ? values : [...values, value]
}
