import { and, desc, eq, type SQL } from 'drizzle-orm'

import { db, schema } from '@/db/client'
import type {
  AgentProfileRow,
  JsonObject,
  MemoryGraphEdge,
  MemoryGraphEdgeType,
  MemoryGraphExportFormat,
  MemoryGraphLayout,
  MemoryGraphNode,
  MemoryGraphNodeType,
  MemoryGraphViewRow,
  MemoryItemRow,
} from '@/db/schema'
import { newMemoryGraphViewId } from '@/server/ids'

export async function createMemoryGraphView(args: {
  name?: string
  agentProfileId?: string | null
  focusAgentProfileId?: string | null
  projectId?: string | null
  layout?: MemoryGraphLayout
  includeExpired?: boolean
  filters?: {
    scope?: MemoryItemRow['scope']
    type?: MemoryItemRow['type']
    query?: string
    limit?: number
  }
}): Promise<MemoryGraphViewRow> {
  const now = Date.now()
  const [agentProfiles, allMemories] = await Promise.all([
    db.query.agentProfiles.findMany(),
    db.query.memoryItems.findMany({
      orderBy: [desc(schema.memoryItems.importance), desc(schema.memoryItems.createdAt)],
      limit: 500,
    }),
  ])
  const agentsById = new Map(agentProfiles.map((agent) => [agent.id, agent]))
  const memories = selectMemories(allMemories, args, now)
  const graph = buildMemoryGraph(memories, agentsById, now, args.focusAgentProfileId ?? args.agentProfileId ?? null)
  const row: MemoryGraphViewRow = {
    id: newMemoryGraphViewId(),
    name: args.name?.trim() || 'Memory Graph',
    agentProfileId: normalizeOptional(args.agentProfileId),
    focusAgentProfileId: normalizeOptional(args.focusAgentProfileId) ?? normalizeOptional(args.agentProfileId),
    projectId: normalizeOptional(args.projectId),
    layout: args.layout ?? 'force',
    includeExpired: args.includeExpired ?? false,
    filters: sanitizeFilters(args.filters ?? {}),
    nodes: graph.nodes,
    edges: graph.edges,
    nodeCount: graph.nodes.length,
    edgeCount: graph.edges.length,
    status: 'generated',
    exportManifest: {},
    createdAt: now,
    updatedAt: now,
  }
  await db.insert(schema.memoryGraphViews).values(row)
  return row
}

export async function listMemoryGraphViews(args: {
  agentProfileId?: string
  focusAgentProfileId?: string
  limit?: number
} = {}): Promise<MemoryGraphViewRow[]> {
  const conditions: SQL[] = []
  if (args.agentProfileId) conditions.push(eq(schema.memoryGraphViews.agentProfileId, args.agentProfileId))
  if (args.focusAgentProfileId) {
    conditions.push(eq(schema.memoryGraphViews.focusAgentProfileId, args.focusAgentProfileId))
  }
  return db.query.memoryGraphViews.findMany({
    where: conditions.length ? and(...conditions) : undefined,
    orderBy: [desc(schema.memoryGraphViews.updatedAt)],
    limit: args.limit ?? 100,
  })
}

export async function exportMemoryGraphView(
  id: string,
  format: MemoryGraphExportFormat = 'json',
): Promise<MemoryGraphViewRow> {
  const view = await getRequiredMemoryGraphView(id)
  const manifest: JsonObject = {
    format,
    exportedAt: Date.now(),
    viewId: view.id,
    name: view.name,
    nodeCount: view.nodeCount,
    edgeCount: view.edgeCount,
    files: [
      {
        path: format === 'json' ? 'memory-graph.json' : 'memory-graph.graphml.manifest.json',
        contentType: 'application/json',
        containsRawMemoryContent: false,
        nodeCount: view.nodeCount,
        edgeCount: view.edgeCount,
      },
    ],
  }
  await db
    .update(schema.memoryGraphViews)
    .set({ status: 'exported', exportManifest: manifest, updatedAt: Date.now() })
    .where(eq(schema.memoryGraphViews.id, id))
  return getRequiredMemoryGraphView(id)
}

async function getRequiredMemoryGraphView(id: string): Promise<MemoryGraphViewRow> {
  const row = await db.query.memoryGraphViews.findFirst({ where: eq(schema.memoryGraphViews.id, id) })
  if (!row) throw new Error(`Memory graph view not found: ${id}`)
  return row
}

function selectMemories(
  memories: MemoryItemRow[],
  args: Parameters<typeof createMemoryGraphView>[0],
  now: number,
): MemoryItemRow[] {
  const query = args.filters?.query?.trim().toLowerCase()
  const projectId = args.projectId?.trim().toLowerCase()
  const limit = Math.max(1, Math.min(args.filters?.limit ?? 120, 300))
  return memories
    .filter((memory) => {
      if (!args.includeExpired && memory.expiresAt && memory.expiresAt <= now) return false
      if (args.agentProfileId && memory.agentProfileId && memory.agentProfileId !== args.agentProfileId) {
        return false
      }
      if (args.filters?.scope && memory.scope !== args.filters.scope) return false
      if (args.filters?.type && memory.type !== args.filters.type) return false
      const text = memoryText(memory).toLowerCase()
      if (projectId && !text.includes(projectId)) return false
      if (query && !text.includes(query)) return false
      return true
    })
    .slice(0, limit)
}

function buildMemoryGraph(
  memories: MemoryItemRow[],
  agentsById: Map<string, AgentProfileRow>,
  now: number,
  focusAgentProfileId: string | null,
): { nodes: MemoryGraphNode[]; edges: MemoryGraphEdge[] } {
  const nodes = new Map<string, MemoryGraphNode>()
  const edges = new Map<string, MemoryGraphEdge>()

  const addNode = (node: MemoryGraphNode) => {
    if (!nodes.has(node.id)) nodes.set(node.id, node)
  }
  const addEdge = (edge: Omit<MemoryGraphEdge, 'id' | 'width'>) => {
    if (edge.source === edge.target) return
    const id = `${edge.source}->${edge.type}->${edge.target}`
    const existing = edges.get(id)
    if (existing) {
      existing.confidence = Math.max(existing.confidence, edge.confidence)
      existing.weight = Math.max(existing.weight, edge.weight)
      existing.width = edgeWidth(existing.confidence)
      existing.evidenceMemoryIds = unique([...existing.evidenceMemoryIds, ...edge.evidenceMemoryIds])
      return
    }
    edges.set(id, { id, ...edge, width: edgeWidth(edge.confidence) })
  }

  for (const memory of memories) {
    const expired = Boolean(memory.expiresAt && memory.expiresAt <= now)
    const memoryNodeId = `memory:${memory.id}`
    addNode({
      id: memoryNodeId,
      type: 'memory',
      label: memory.title,
      summary: truncate(memory.content, 180),
      sourceMemoryId: memory.id,
      agentProfileId: memory.agentProfileId,
      importance: memory.importance,
      confidence: memory.confidence,
      size: nodeSize(memory.importance, memory.agentProfileId === focusAgentProfileId),
      expired,
      properties: {
        scope: memory.scope,
        type: memory.type,
        sourceRunId: memory.sourceRunId,
        createdAt: memory.createdAt,
        expiresAt: memory.expiresAt,
      },
    })

    if (memory.agentProfileId) {
      const agent = agentsById.get(memory.agentProfileId)
      const agentNodeId = `agent:${memory.agentProfileId}`
      addNode({
        id: agentNodeId,
        type: 'agent',
        label: agent?.name ?? memory.agentProfileId,
        summary: agent?.role ?? 'Agent profile',
        agentProfileId: memory.agentProfileId,
        importance: memory.agentProfileId === focusAgentProfileId ? 1 : 0.65,
        confidence: 1,
        size: nodeSize(memory.agentProfileId === focusAgentProfileId ? 1 : 0.65, true),
        expired: false,
        properties: { role: agent?.role ?? null, focused: memory.agentProfileId === focusAgentProfileId },
      })
      addEdge(edge(agentNodeId, memoryNodeId, 'learned_by', memory, 'learned by Agent'))
    }

    const entities = extractEntities(memory)
    for (const item of entities.customers) {
      addEntityNode(addNode, 'customer', item, memory, now)
      addEdge(edge(memoryNodeId, entityId('customer', item), 'mentions', memory, 'mentions customer'))
    }
    for (const item of entities.projects) {
      addEntityNode(addNode, 'project', item, memory, now)
      addEdge(edge(memoryNodeId, entityId('project', item), 'belongs_to', memory, 'belongs to project'))
    }
    for (const item of entities.preferences) {
      addEntityNode(addNode, 'preference', item, memory, now)
      addEdge(edge(memoryNodeId, entityId('preference', item), 'mentions', memory, 'mentions preference'))
      for (const customer of entities.customers) {
        addEdge(edge(entityId('customer', customer), entityId('preference', item), 'prefers', memory, 'prefers'))
      }
    }
    for (const item of entities.technologies) {
      addEntityNode(addNode, 'technology', item, memory, now)
      addEdge(edge(memoryNodeId, entityId('technology', item), 'used_in', memory, 'uses technology'))
      for (const project of entities.projects) {
        addEdge(edge(entityId('project', project), entityId('technology', item), 'depends_on', memory, 'depends on'))
      }
    }
    for (const item of entities.errors) {
      addEntityNode(addNode, 'error', item, memory, now)
      addEdge(edge(memoryNodeId, entityId('error', item), 'has_error', memory, 'has error'))
      for (const project of entities.projects) {
        addEdge(edge(entityId('project', project), entityId('error', item), 'has_error', memory, 'has error'))
      }
    }
    for (const item of entities.solutions) {
      addEntityNode(addNode, 'solution', item, memory, now)
      addEdge(edge(memoryNodeId, entityId('solution', item), 'solves', memory, 'mentions solution'))
      for (const error of entities.errors) {
        addEdge(edge(entityId('error', error), entityId('solution', item), 'solves', memory, 'solved by'))
      }
    }
    for (const item of entities.topics) {
      addEntityNode(addNode, 'topic', item, memory, now)
      addEdge(edge(memoryNodeId, entityId('topic', item), 'mentions', memory, 'mentions topic'))
    }
  }

  addSimilarityEdges(memories, addEdge)
  return { nodes: Array.from(nodes.values()), edges: Array.from(edges.values()) }
}

function addEntityNode(
  addNode: (node: MemoryGraphNode) => void,
  type: Exclude<MemoryGraphNodeType, 'memory' | 'agent'>,
  label: string,
  memory: MemoryItemRow,
  now: number,
): void {
  addNode({
    id: entityId(type, label),
    type,
    label,
    summary: `${type} extracted from memory ${memory.title}.`,
    sourceMemoryId: memory.id,
    agentProfileId: memory.agentProfileId,
    importance: memory.importance,
    confidence: memory.confidence,
    size: nodeSize(memory.importance),
    expired: Boolean(memory.expiresAt && memory.expiresAt <= now),
    properties: { extractedFrom: memory.id, memoryType: memory.type, memoryScope: memory.scope },
  })
}

function edge(
  source: string,
  target: string,
  type: MemoryGraphEdgeType,
  memory: MemoryItemRow,
  label: string,
): Omit<MemoryGraphEdge, 'id' | 'width'> {
  return {
    source,
    target,
    type,
    label,
    confidence: memory.confidence,
    weight: memory.confidence,
    evidenceMemoryIds: [memory.id],
  }
}

function addSimilarityEdges(
  memories: MemoryItemRow[],
  addEdge: (edge: Omit<MemoryGraphEdge, 'id' | 'width'>) => void,
): void {
  for (let i = 0; i < memories.length; i += 1) {
    for (let j = i + 1; j < memories.length; j += 1) {
      const left = memories[i]
      const right = memories[j]
      const score = similarityScore(left, right)
      if (score < 0.18) continue
      const confidence = Math.round(((left.confidence + right.confidence) / 2) * score * 100) / 100
      addEdge({
        source: `memory:${left.id}`,
        target: `memory:${right.id}`,
        type: 'similar_to',
        label: 'similar to',
        confidence,
        weight: score,
        evidenceMemoryIds: [left.id, right.id],
      })
    }
  }
}

function extractEntities(memory: MemoryItemRow): {
  customers: string[]
  projects: string[]
  preferences: string[]
  technologies: string[]
  errors: string[]
  solutions: string[]
  topics: string[]
} {
  const text = memoryText(memory)
  const customers = extractValues(text, ['customer', '客户'])
  const projects = extractValues(text, ['project', '项目'])
  const preferences = extractValues(text, ['prefers', 'preference', '喜欢', '偏好'])
  const technologies = unique([
    ...extractValues(text, ['technology', 'tech', '技术']),
    ...KNOWN_TECHNOLOGIES.filter((tech) => text.toLowerCase().includes(tech.toLowerCase())),
  ])
  const errors = unique([
    ...extractValues(text, ['error', 'bug', '错误', '问题']),
    ...linesContaining(text, ['error', 'bug', '错误', 'hydration', 'SSR']),
  ]).map((value) => truncate(value, 80))
  const solutions = unique([
    ...extractValues(text, ['solution', 'solves', 'solved_by', 'fix', '解决', '修复']),
    ...linesContaining(text, ['solution', 'solves', 'fixed', '解决', '修复', 'useClient']),
  ]).map((value) => truncate(value, 80))
  const topics = unique([memory.type, memory.scope, ...tokenize(memory.title).slice(0, 4)])
  return {
    customers: cleanEntityList(customers),
    projects: cleanEntityList(projects),
    preferences: cleanEntityList(preferences),
    technologies: cleanEntityList(technologies),
    errors: cleanEntityList(errors),
    solutions: cleanEntityList(solutions),
    topics: cleanEntityList(topics),
  }
}

const KNOWN_TECHNOLOGIES = [
  'React 18',
  'React',
  'Next.js',
  'TypeScript',
  'Python',
  'SQLite',
  'Playwright',
  'Docker',
  'Figma',
  'Chrome',
  'useClient',
]

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

function cleanEntityList(values: string[]): string[] {
  return unique(
    values
      .map((value) => value.replace(/^[-*\s]+/, '').replace(/\s+/g, ' ').trim())
      .map((value) => truncate(value, 80))
      .filter((value) => value.length >= 2),
  ).slice(0, 12)
}

function similarityScore(left: MemoryItemRow, right: MemoryItemRow): number {
  const leftTokens = new Set(tokenize(memoryText(left)))
  const rightTokens = new Set(tokenize(memoryText(right)))
  const intersection = [...leftTokens].filter((token) => rightTokens.has(token))
  if (intersection.length < 3) return 0
  const union = new Set([...leftTokens, ...rightTokens])
  return Math.round((intersection.length / Math.max(1, union.size)) * 100) / 100
}

function tokenize(text: string): string[] {
  return unique(
    text
      .normalize('NFKC')
      .toLowerCase()
      .match(/[\p{L}\p{N}_.-]+/gu)
      ?.filter((token) => token.length >= 2) ?? [],
  )
}

function nodeSize(importance: number, focused = false): number {
  return Math.round((12 + Math.max(0, Math.min(1, importance)) * 34 + (focused ? 8 : 0)) * 100) / 100
}

function edgeWidth(confidence: number): number {
  return Math.round((1 + Math.max(0, Math.min(1, confidence)) * 5) * 100) / 100
}

function entityId(type: MemoryGraphNodeType, label: string): string {
  return `${type}:${slug(label)}`
}

function slug(value: string): string {
  return value
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
}

function memoryText(memory: MemoryItemRow): string {
  return `${memory.title}\n${memory.content}\n${memory.type}\n${memory.scope}`
}

function sanitizeFilters(filters: NonNullable<Parameters<typeof createMemoryGraphView>[0]['filters']>): JsonObject {
  return {
    ...(filters.scope ? { scope: filters.scope } : {}),
    ...(filters.type ? { type: filters.type } : {}),
    ...(filters.query?.trim() ? { query: filters.query.trim() } : {}),
    ...(filters.limit ? { limit: filters.limit } : {}),
  }
}

function normalizeOptional(value: string | null | undefined): string | null {
  const trimmed = value?.trim()
  return trimmed ? trimmed : null
}

function truncate(value: string, maxLength: number): string {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength - 3).trimEnd()}...`
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)]
}
