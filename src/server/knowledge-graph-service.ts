import { and, desc, eq, type SQL } from 'drizzle-orm'

import { db, schema } from '@/db/client'
import type {
  CapabilitySourceType,
  JsonObject,
  KnowledgeEdgeType,
  KnowledgeGraphEdgeRow,
  KnowledgeGraphNodeRow,
  KnowledgeNodeType,
  MemoryItemRow,
  SoftwareCommandRow,
  SoftwareCommandRunRow,
  SoftwareProfileRow,
} from '@/db/schema'
import { newKnowledgeGraphEdgeId, newKnowledgeGraphNodeId } from '@/server/ids'

export type KnowledgeGraphQueryScenario =
  | 'general'
  | 'error_solution'
  | 'customer_preference'
  | 'software_command'

export interface StructuredKnowledgeGraph {
  nodes: KnowledgeGraphNodeRow[]
  edges: KnowledgeGraphEdgeRow[]
}

export interface KnowledgeGraphRebuildResult extends StructuredKnowledgeGraph {
  summary: {
    memoryCount: number
    softwareProfileCount: number
    softwareCommandCount: number
    softwareCommandRunCount: number
    nodeCount: number
    edgeCount: number
  }
}

export interface KnowledgeGraphNodeMatch {
  node: KnowledgeGraphNodeRow
  score: number
  reason: string
  matchedTerms: string[]
}

export interface KnowledgeGraphPath {
  scenario: KnowledgeGraphQueryScenario
  fromNode: KnowledgeGraphNodeRow
  edge: KnowledgeGraphEdgeRow
  toNode: KnowledgeGraphNodeRow
  score: number
  evidence: JsonObject
  explanation: string
}

export interface KnowledgeGraphQueryResult {
  query: string
  scenario: KnowledgeGraphQueryScenario
  matches: KnowledgeGraphNodeMatch[]
  paths: KnowledgeGraphPath[]
}

interface ExtractedKnowledge {
  customers: string[]
  projects: string[]
  people: string[]
  software: string[]
  files: string[]
  errors: string[]
  solutions: string[]
  preferences: string[]
  avoidances: string[]
  concepts: string[]
}

const EMBEDDING_DIMENSIONS = 48

export async function rebuildStructuredKnowledgeGraph(args: {
  limit?: number
  includeExpired?: boolean
} = {}): Promise<KnowledgeGraphRebuildResult> {
  const limit = Math.max(1, Math.min(args.limit ?? 300, 1000))
  const now = Date.now()
  const [memoryItems, softwareProfiles, softwareCommands, softwareCommandRuns] = await Promise.all([
    db.query.memoryItems.findMany({
      orderBy: [desc(schema.memoryItems.importance), desc(schema.memoryItems.createdAt)],
      limit,
    }),
    db.query.softwareProfiles.findMany({ limit }),
    db.query.softwareCommands.findMany({ limit }),
    db.query.softwareCommandRuns.findMany({
      orderBy: [desc(schema.softwareCommandRuns.createdAt)],
      limit,
    }),
  ])

  const activeMemories = memoryItems.filter(
    (memory) => args.includeExpired || !memory.expiresAt || memory.expiresAt > now,
  )
  const softwareById = new Map(softwareProfiles.map((profile) => [profile.id, profile]))
  const runsByCommandId = groupBy(softwareCommandRuns, (run) => run.softwareCommandId)

  for (const memory of activeMemories) {
    await indexMemoryKnowledge(memory, softwareProfiles)
  }

  for (const profile of softwareProfiles) {
    await indexSoftwareProfile(profile)
  }

  for (const command of softwareCommands) {
    const profile = softwareById.get(command.softwareProfileId)
    if (!profile) continue
    await indexSoftwareCommand(profile, command, runsByCommandId.get(command.id) ?? [])
  }

  const graph = await getStructuredKnowledgeGraph()
  return {
    ...graph,
    summary: {
      memoryCount: activeMemories.length,
      softwareProfileCount: softwareProfiles.length,
      softwareCommandCount: softwareCommands.length,
      softwareCommandRunCount: softwareCommandRuns.length,
      nodeCount: graph.nodes.length,
      edgeCount: graph.edges.length,
    },
  }
}

export async function getStructuredKnowledgeGraph(args: {
  nodeType?: KnowledgeNodeType
  relation?: KnowledgeEdgeType
  limitNodes?: number
  limitEdges?: number
} = {}): Promise<StructuredKnowledgeGraph> {
  const nodeConditions: SQL[] = []
  if (args.nodeType) nodeConditions.push(eq(schema.knowledgeGraphNodes.nodeType, args.nodeType))
  const edgeConditions: SQL[] = []
  if (args.relation) edgeConditions.push(eq(schema.knowledgeGraphEdges.edgeType, args.relation))
  const [nodes, edges] = await Promise.all([
    db.query.knowledgeGraphNodes.findMany({
      where: nodeConditions.length ? and(...nodeConditions) : undefined,
      orderBy: [desc(schema.knowledgeGraphNodes.updatedAt)],
      limit: args.limitNodes ?? 1000,
    }),
    db.query.knowledgeGraphEdges.findMany({
      where: edgeConditions.length ? and(...edgeConditions) : undefined,
      orderBy: [desc(schema.knowledgeGraphEdges.createdAt)],
      limit: args.limitEdges ?? 2000,
    }),
  ])
  return { nodes, edges }
}

export async function queryStructuredKnowledgeGraph(args: {
  query: string
  scenario?: KnowledgeGraphQueryScenario
  limit?: number
}): Promise<KnowledgeGraphQueryResult> {
  const query = args.query.trim()
  if (!query) throw new Error('Knowledge graph query is required.')
  let graph = await getStructuredKnowledgeGraph()
  if (graph.nodes.length === 0) {
    graph = await rebuildStructuredKnowledgeGraph()
  }
  const scenario = args.scenario ?? 'general'
  const limit = Math.max(1, Math.min(args.limit ?? 8, 50))
  const queryEmbedding = createKnowledgeEmbedding(query)
  const queryTerms = expandTerms(tokenize(query))
  const matches = graph.nodes
    .map((node) => scoreNode(node, query, queryEmbedding, queryTerms))
    .filter((match) => match.score > 0)
    .sort((a, b) => b.score - a.score || b.node.updatedAt - a.node.updatedAt)
    .slice(0, limit)

  return {
    query,
    scenario,
    matches,
    paths: buildScenarioPaths(scenario, matches, graph, limit),
  }
}

export function createKnowledgeEmbedding(text: string): number[] {
  const vector = Array.from({ length: EMBEDDING_DIMENSIONS }, () => 0)
  for (const term of expandTerms(tokenize(text))) {
    const index = Math.abs(stableHash(term)) % EMBEDDING_DIMENSIONS
    vector[index] += 1 + Math.min(term.length, 12) / 12
  }
  const magnitude = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0))
  if (magnitude === 0) return vector
  return vector.map((value) => Math.round((value / magnitude) * 1000000) / 1000000)
}

async function indexMemoryKnowledge(
  memory: MemoryItemRow,
  softwareProfiles: SoftwareProfileRow[],
): Promise<void> {
  const extracted = extractKnowledge(memory, softwareProfiles)
  const evidence = memoryEvidence(memory)

  const customers = await Promise.all(
    extracted.customers.map((label) =>
      ensureKnowledgeNode({
        nodeType: 'customer',
        label,
        summary: `Customer extracted from memory: ${memory.title}.`,
        properties: { sourceMemoryIds: [memory.id], sourceRunId: memory.sourceRunId },
      }),
    ),
  )
  const projects = await Promise.all(
    extracted.projects.map((label) =>
      ensureKnowledgeNode({
        nodeType: 'project',
        label,
        summary: `Project extracted from memory: ${memory.title}.`,
        properties: { sourceMemoryIds: [memory.id], scope: memory.scope },
      }),
    ),
  )
  const people = await Promise.all(
    extracted.people.map((label) =>
      ensureKnowledgeNode({
        nodeType: 'person',
        label,
        summary: `Person extracted from memory: ${memory.title}.`,
        properties: { sourceMemoryIds: [memory.id] },
      }),
    ),
  )
  const software = await Promise.all(
    extracted.software.map((label) =>
      ensureKnowledgeNode({
        nodeType: 'software',
        label,
        summary: `Software extracted from memory: ${memory.title}.`,
        properties: { sourceMemoryIds: [memory.id] },
      }),
    ),
  )
  const files = await Promise.all(
    extracted.files.map((label) =>
      ensureKnowledgeNode({
        nodeType: 'file',
        label,
        summary: `File extracted from memory: ${memory.title}.`,
        properties: { sourceMemoryIds: [memory.id] },
      }),
    ),
  )
  const errors = await Promise.all(
    extracted.errors.map((label) =>
      ensureKnowledgeNode({
        nodeType: 'error',
        label,
        summary: `Error extracted from memory: ${memory.title}.`,
        properties: { sourceMemoryIds: [memory.id], memoryType: memory.type },
      }),
    ),
  )
  const solutions = await Promise.all(
    extracted.solutions.map((label) =>
      ensureKnowledgeNode({
        nodeType: 'solution',
        label,
        summary: `Solution extracted from memory: ${memory.title}.`,
        properties: { sourceMemoryIds: [memory.id], memoryType: memory.type },
      }),
    ),
  )
  const preferences = await Promise.all(
    extracted.preferences.map((label) =>
      ensureKnowledgeNode({
        nodeType: 'concept',
        label,
        summary: `Preference extracted from memory: ${memory.title}.`,
        properties: { conceptKind: 'preference', sourceMemoryIds: [memory.id] },
      }),
    ),
  )
  const avoidances = await Promise.all(
    extracted.avoidances.map((label) =>
      ensureKnowledgeNode({
        nodeType: 'concept',
        label,
        summary: `Avoidance extracted from memory: ${memory.title}.`,
        properties: { conceptKind: 'avoidance', sourceMemoryIds: [memory.id] },
      }),
    ),
  )
  const concepts = await Promise.all(
    extracted.concepts.map((label) =>
      ensureKnowledgeNode({
        nodeType: 'concept',
        label,
        summary: `Concept extracted from memory: ${memory.title}.`,
        properties: { conceptKind: 'topic', sourceMemoryIds: [memory.id] },
      }),
    ),
  )

  for (const customer of customers) {
    for (const preference of preferences) {
      await ensureKnowledgeEdge({
        fromNodeId: customer.id,
        toNodeId: preference.id,
        edgeType: 'prefers',
        weight: memory.confidence,
        evidence,
      })
    }
    for (const avoidance of avoidances) {
      await ensureKnowledgeEdge({
        fromNodeId: customer.id,
        toNodeId: avoidance.id,
        edgeType: 'avoids',
        weight: memory.confidence,
        evidence,
      })
    }
  }

  for (const person of people) {
    for (const project of projects) {
      await ensureKnowledgeEdge({
        fromNodeId: person.id,
        toNodeId: project.id,
        edgeType: 'belongs_to',
        weight: memory.confidence,
        evidence,
      })
    }
  }

  for (const project of projects) {
    for (const tool of software) {
      await ensureKnowledgeEdge({
        fromNodeId: project.id,
        toNodeId: tool.id,
        edgeType: 'uses',
        weight: memory.confidence,
        evidence,
      })
    }
    for (const file of files) {
      await ensureKnowledgeEdge({
        fromNodeId: file.id,
        toNodeId: project.id,
        edgeType: 'belongs_to',
        weight: memory.confidence,
        evidence,
      })
    }
    for (const concept of concepts) {
      await ensureKnowledgeEdge({
        fromNodeId: project.id,
        toNodeId: concept.id,
        edgeType: 'depends_on',
        weight: memory.confidence * 0.8,
        evidence,
      })
    }
  }

  for (const error of errors) {
    for (const solution of solutions) {
      await ensureKnowledgeEdge({
        fromNodeId: error.id,
        toNodeId: solution.id,
        edgeType: 'solves',
        weight: memory.confidence,
        evidence,
      })
    }
    for (const tool of software) {
      await ensureKnowledgeEdge({
        fromNodeId: tool.id,
        toNodeId: error.id,
        edgeType: 'causes',
        weight: memory.confidence * 0.7,
        evidence,
      })
    }
  }
}

async function indexSoftwareProfile(profile: SoftwareProfileRow): Promise<KnowledgeGraphNodeRow> {
  return ensureKnowledgeNode({
    nodeType: 'software',
    sourceType: 'software_profile',
    sourceId: profile.id,
    label: profile.name,
    summary: `${profile.appType} via ${profile.adapterType}.`,
    properties: {
      appType: profile.appType,
      adapterType: profile.adapterType,
      defaultWorkstationMode: profile.defaultWorkstationMode,
      launchCommand: profile.launchCommand,
      executablePath: profile.executablePath,
    },
  })
}

async function indexSoftwareCommand(
  profile: SoftwareProfileRow,
  command: SoftwareCommandRow,
  runs: SoftwareCommandRunRow[],
): Promise<void> {
  const profileNode = await indexSoftwareProfile(profile)
  const successfulRuns = runs.filter((run) => !run.error && run.status !== 'failed' && run.status !== 'blocked')
  const commandNode = await ensureKnowledgeNode({
    nodeType: 'software',
    sourceType: 'software_command',
    sourceId: command.id,
    label: command.name,
    summary: command.description || `${profile.name} command using ${command.implementation.type}.`,
    properties: {
      kind: 'software_command',
      softwareProfileId: profile.id,
      softwareName: profile.name,
      implementationType: command.implementation.type,
      riskLevel: command.riskLevel,
      requiresApproval: command.requiresApproval,
      successCaseCount: successfulRuns.length,
      lastSuccessfulInputs: successfulRuns.slice(0, 5).map((run) => run.input),
    },
  })
  const evidence: JsonObject = {
    softwareProfileId: profile.id,
    softwareCommandId: command.id,
    successfulRunIds: successfulRuns.map((run) => run.id),
    successfulInputSamples: successfulRuns.slice(0, 5).map((run) => run.input),
  }
  await ensureKnowledgeEdge({
    fromNodeId: profileNode.id,
    toNodeId: commandNode.id,
    edgeType: 'uses',
    weight: 1 + successfulRuns.length * 0.1,
    evidence,
  })
  await ensureKnowledgeEdge({
    fromNodeId: commandNode.id,
    toNodeId: profileNode.id,
    edgeType: 'belongs_to',
    weight: 1,
    evidence,
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
  const sourceType = args.sourceType ?? 'knowledge_entity'
  const sourceId = args.sourceId ?? entitySourceId(args.nodeType, args.label)
  const existing = await db.query.knowledgeGraphNodes.findFirst({
    where: and(
      eq(schema.knowledgeGraphNodes.sourceType, sourceType),
      eq(schema.knowledgeGraphNodes.sourceId, sourceId),
    ),
  })
  const now = Date.now()
  const properties = mergeProperties(existing?.properties, args.properties ?? {})
  const text = [args.nodeType, args.label, args.summary, textFromJson(properties).join(' ')].join(' ')
  const embedding = createKnowledgeEmbedding(text)
  if (existing) {
    await db
      .update(schema.knowledgeGraphNodes)
      .set({
        nodeType: args.nodeType,
        label: args.label.trim(),
        summary: args.summary?.trim() ?? existing.summary,
        properties,
        embedding,
        updatedAt: now,
      })
      .where(eq(schema.knowledgeGraphNodes.id, existing.id))
    return getRequiredKnowledgeNode(existing.id)
  }

  const row: KnowledgeGraphNodeRow = {
    id: newKnowledgeGraphNodeId(),
    nodeType: args.nodeType,
    sourceType,
    sourceId,
    label: args.label.trim(),
    summary: args.summary?.trim() ?? '',
    properties,
    embedding,
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
  if (args.fromNodeId === args.toNodeId) {
    throw new Error('Knowledge graph edge cannot point to itself.')
  }
  const existing = await db.query.knowledgeGraphEdges.findFirst({
    where: and(
      eq(schema.knowledgeGraphEdges.fromNodeId, args.fromNodeId),
      eq(schema.knowledgeGraphEdges.toNodeId, args.toNodeId),
      eq(schema.knowledgeGraphEdges.edgeType, args.edgeType),
    ),
  })
  if (existing) {
    await db
      .update(schema.knowledgeGraphEdges)
      .set({
        weight: Math.max(existing.weight, args.weight ?? existing.weight),
        evidence: mergeProperties(existing.evidence, args.evidence ?? {}),
      })
      .where(eq(schema.knowledgeGraphEdges.id, existing.id))
    return getRequiredKnowledgeEdge(existing.id)
  }
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

async function getRequiredKnowledgeNode(id: string): Promise<KnowledgeGraphNodeRow> {
  const row = await db.query.knowledgeGraphNodes.findFirst({ where: eq(schema.knowledgeGraphNodes.id, id) })
  if (!row) throw new Error(`Knowledge graph node not found: ${id}`)
  return row
}

async function getRequiredKnowledgeEdge(id: string): Promise<KnowledgeGraphEdgeRow> {
  const row = await db.query.knowledgeGraphEdges.findFirst({ where: eq(schema.knowledgeGraphEdges.id, id) })
  if (!row) throw new Error(`Knowledge graph edge not found: ${id}`)
  return row
}

function buildScenarioPaths(
  scenario: KnowledgeGraphQueryScenario,
  matches: KnowledgeGraphNodeMatch[],
  graph: StructuredKnowledgeGraph,
  limit: number,
): KnowledgeGraphPath[] {
  const nodesById = new Map(graph.nodes.map((node) => [node.id, node]))
  const matchedIds = new Set(matches.map((match) => match.node.id))
  const scoreById = new Map(matches.map((match) => [match.node.id, match.score]))
  const selectedEdges = graph.edges.filter((edge) => {
    const from = nodesById.get(edge.fromNodeId)
    const to = nodesById.get(edge.toNodeId)
    if (!from || !to) return false
    if (scenario === 'error_solution') {
      return edge.edgeType === 'solves' && (from.nodeType === 'error' || matchedIds.has(from.id))
    }
    if (scenario === 'customer_preference') {
      return (
        (edge.edgeType === 'prefers' || edge.edgeType === 'avoids') &&
        (from.nodeType === 'customer' || matchedIds.has(from.id))
      )
    }
    if (scenario === 'software_command') {
      return (
        (edge.edgeType === 'uses' || edge.edgeType === 'belongs_to') &&
        (from.nodeType === 'software' || to.nodeType === 'software') &&
        (matchedIds.has(from.id) || matchedIds.has(to.id) || hasSuccessfulRunEvidence(edge.evidence))
      )
    }
    return matchedIds.has(edge.fromNodeId) || matchedIds.has(edge.toNodeId)
  })

  return selectedEdges
    .map((edge) => {
      const fromNode = nodesById.get(edge.fromNodeId)
      const toNode = nodesById.get(edge.toNodeId)
      if (!fromNode || !toNode) return null
      const score = Math.round(
        (Math.max(scoreById.get(fromNode.id) ?? 0, scoreById.get(toNode.id) ?? 0) + edge.weight) * 100,
      ) / 100
      return {
        scenario,
        fromNode,
        edge,
        toNode,
        score,
        evidence: edge.evidence,
        explanation: explainPath(scenario, fromNode, edge, toNode),
      } satisfies KnowledgeGraphPath
    })
    .filter((path): path is KnowledgeGraphPath => Boolean(path))
    .sort((a, b) => b.score - a.score || b.edge.createdAt - a.edge.createdAt)
    .slice(0, limit)
}

function scoreNode(
  node: KnowledgeGraphNodeRow,
  rawQuery: string,
  queryEmbedding: number[],
  queryTerms: string[],
): KnowledgeGraphNodeMatch {
  const nodeText = [
    node.nodeType,
    node.label,
    node.summary,
    node.sourceType,
    node.sourceId,
    textFromJson(node.properties).join(' '),
  ].join(' ')
  const nodeTerms = new Set(expandTerms(tokenize(nodeText)))
  const matchedTerms = unique(queryTerms.filter((term) => nodeTerms.has(term)))
  const phrase = rawQuery.toLowerCase()
  const phraseBonus =
    node.label.toLowerCase().includes(phrase) || phrase.includes(node.label.toLowerCase()) ? 8 : 0
  const semanticScore = cosineSimilarity(queryEmbedding, node.embedding ?? [])
  const score = Math.round((matchedTerms.length * 8 + semanticScore * 25 + phraseBonus) * 100) / 100
  return {
    node,
    score,
    reason:
      matchedTerms.length > 0
        ? `Matched graph terms: ${matchedTerms.slice(0, 8).join(', ')}.`
        : `Semantic graph similarity ${Math.round(semanticScore * 100) / 100}.`,
    matchedTerms,
  }
}

function extractKnowledge(memory: MemoryItemRow, softwareProfiles: SoftwareProfileRow[]): ExtractedKnowledge {
  const text = memoryText(memory)
  const lower = text.toLowerCase()
  const knownSoftware = softwareProfiles
    .map((profile) => profile.name)
    .filter((name) => lower.includes(name.toLowerCase()))
  return {
    customers: cleanEntities(extractValues(text, ['customer', '客户', 'client'])),
    projects: cleanEntities(extractValues(text, ['project', '项目'])),
    people: cleanEntities(extractValues(text, ['person', 'people', 'owner', '负责人', '员工'])),
    software: cleanEntities([
      ...extractValues(text, ['software', 'app', 'tool', '软件', '工具']),
      ...knownSoftware,
      ...KNOWN_SOFTWARE.filter((name) => lower.includes(name.toLowerCase())),
    ]),
    files: cleanEntities([...extractValues(text, ['file', 'path', '文件', '路径']), ...extractFilePaths(text)]),
    errors: cleanEntities([
      ...extractValues(text, ['error', 'bug', 'failure', '问题', '错误', '失败']),
      ...linesContaining(text, ['error', 'bug', 'failed', 'timeout', '错误', '失败']),
    ]),
    solutions: cleanEntities([
      ...extractValues(text, ['solution', 'fix', 'workaround', '解决', '修复', '方案']),
      ...linesContaining(text, ['solution', 'fixed', 'workaround', '解决', '修复']),
    ]),
    preferences: cleanEntities(extractValues(text, ['preference', 'prefers', 'likes', '偏好', '喜欢'])),
    avoidances: cleanEntities(extractValues(text, ['avoid', 'avoids', 'dislikes', '不要', '避免'])),
    concepts: cleanEntities([memory.type, memory.scope, ...tokenize(memory.title).slice(0, 6)]),
  }
}

function memoryEvidence(memory: MemoryItemRow): JsonObject {
  return {
    memoryIds: [memory.id],
    sourceRunIds: memory.sourceRunId ? [memory.sourceRunId] : [],
    confidence: memory.confidence,
    importance: memory.importance,
  }
}

function explainPath(
  scenario: KnowledgeGraphQueryScenario,
  fromNode: KnowledgeGraphNodeRow,
  edge: KnowledgeGraphEdgeRow,
  toNode: KnowledgeGraphNodeRow,
): string {
  if (scenario === 'error_solution' && edge.edgeType === 'solves') {
    return `Error "${fromNode.label}" is linked to solution "${toNode.label}".`
  }
  if (scenario === 'customer_preference' && edge.edgeType === 'prefers') {
    return `Customer "${fromNode.label}" prefers "${toNode.label}".`
  }
  if (scenario === 'customer_preference' && edge.edgeType === 'avoids') {
    return `Customer "${fromNode.label}" avoids "${toNode.label}".`
  }
  if (scenario === 'software_command') {
    return `Software knowledge links "${fromNode.label}" to "${toNode.label}" through ${edge.edgeType}.`
  }
  return `"${fromNode.label}" ${edge.edgeType} "${toNode.label}".`
}

function hasSuccessfulRunEvidence(evidence: JsonObject): boolean {
  return Array.isArray(evidence.successfulRunIds) && evidence.successfulRunIds.length > 0
}

function entitySourceId(nodeType: KnowledgeNodeType, label: string): string {
  return `${nodeType}:${slug(label)}`
}

function mergeProperties(left: JsonObject | undefined, right: JsonObject): JsonObject {
  const merged: JsonObject = { ...(left ?? {}) }
  for (const [key, value] of Object.entries(right)) {
    const current = merged[key]
    if (Array.isArray(current) && Array.isArray(value)) {
      merged[key] = unique([...current, ...value])
    } else if (isPlainObject(current) && isPlainObject(value)) {
      merged[key] = mergeProperties(current, value)
    } else {
      merged[key] = value
    }
  }
  return merged
}

function isPlainObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function memoryText(memory: MemoryItemRow): string {
  return `${memory.title}\n${memory.content}\n${memory.type}\n${memory.scope}`
}

function extractValues(text: string, keys: string[]): string[] {
  const values: string[] = []
  for (const key of keys) {
    const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const regex = new RegExp(`(?:${escaped})\\s*[:：=]\\s*([^\\n.;；。]+)`, 'giu')
    for (const match of text.matchAll(regex)) values.push(match[1])
  }
  return values
}

function linesContaining(text: string, needles: string[]): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && needles.some((needle) => line.toLowerCase().includes(needle.toLowerCase())))
}

function extractFilePaths(text: string): string[] {
  return [
    ...text.matchAll(/(?:[A-Za-z]:\\[^\s]+|[\w.-]+\/[\w./-]+|\b[\w.-]+\.(?:ts|tsx|js|jsx|py|json|md|csv|xlsx|png|jpg|pdf)\b)/g),
  ].map((match) => match[0])
}

function cleanEntities(values: string[]): string[] {
  return unique(
    values
      .map((value) =>
        value
          .replace(/^[-*•\s]+/, '')
          .replace(/^(customer|client|project|software|app|tool|file|path|error|bug|failure|solution|fix|workaround|preference|prefers|avoid|avoids|客户|项目|软件|工具|文件|路径|问题|错误|失败|解决|修复|方案|偏好|喜欢|避免|不要)\s*[:：=]\s*/iu, '')
          .replace(/\s+/g, ' ')
          .trim(),
      )
      .map((value) => truncate(value, 120))
      .filter((value) => value.length >= 2),
  ).slice(0, 16)
}

function tokenize(text: string): string[] {
  return unique(
    text
      .normalize('NFKC')
      .toLowerCase()
      .match(/[\p{L}\p{N}_.-]+/gu)
      ?.map((token) => token.replace(/^[-_.]+|[-_.]+$/g, ''))
      .filter((token) => token.length >= 2) ?? [],
  )
}

function expandTerms(tokens: string[]): string[] {
  const expanded = new Set(tokens)
  for (const token of tokens) {
    for (const group of TERM_SYNONYMS) {
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

function cosineSimilarity(left: number[], right: number[]): number {
  if (left.length === 0 || right.length === 0) return 0
  const length = Math.min(left.length, right.length)
  let dot = 0
  let leftMagnitude = 0
  let rightMagnitude = 0
  for (let index = 0; index < length; index += 1) {
    dot += left[index] * right[index]
    leftMagnitude += left[index] * left[index]
    rightMagnitude += right[index] * right[index]
  }
  if (leftMagnitude === 0 || rightMagnitude === 0) return 0
  return dot / (Math.sqrt(leftMagnitude) * Math.sqrt(rightMagnitude))
}

function stableHash(value: string): number {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return hash
}

function groupBy<T>(values: T[], keyOf: (value: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>()
  for (const value of values) {
    const key = keyOf(value)
    groups.set(key, [...(groups.get(key) ?? []), value])
  }
  return groups
}

function slug(value: string): string {
  return value
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120)
}

function truncate(value: string, maxLength: number): string {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength - 3).trimEnd()}...`
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)]
}

const KNOWN_SOFTWARE = [
  'Chrome',
  'Excel',
  'Figma',
  'Photoshop',
  'VS Code',
  'Codex CLI',
  'Claude Code',
  'OpenCode',
  'Playwright',
  'GitHub',
]

const TERM_SYNONYMS = [
  ['error', 'bug', 'failure', 'failed', '错误', '问题', '失败'],
  ['solution', 'fix', 'workaround', '解决', '修复', '方案'],
  ['customer', 'client', '客户'],
  ['preference', 'prefers', 'likes', '偏好', '喜欢'],
  ['avoid', 'avoids', 'dislikes', '避免', '不要'],
  ['software', 'app', 'tool', 'command', '软件', '工具', '命令'],
  ['project', 'workspace', '项目', '工作区'],
]
