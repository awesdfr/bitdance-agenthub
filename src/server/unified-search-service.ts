import { and, desc, eq, gte, lte, type SQL } from 'drizzle-orm'

import { db, schema } from '@/db/client'
import type { UnifiedSearchEntityType, UnifiedSearchIndexRow } from '@/db/schema'
import { newUnifiedSearchIndexId } from '@/server/ids'

export interface UnifiedSearchScope {
  agents?: boolean
  tasks?: boolean
  memories?: boolean
  artifacts?: boolean
  workflows?: boolean
  events?: boolean
  knowledgeGraph?: boolean
  documents?: boolean
}

export interface UnifiedSearchModes {
  keyword?: boolean
  semantic?: boolean
  hybrid?: boolean
  filtered?: boolean
}

export interface UnifiedSearchResult {
  id: string
  title: string
  snippet: string
  relevanceScore: number
  source: {
    agentName?: string
    taskName?: string
    projectName?: string
    timestamp: number
  }
}

export type UnifiedSearchResults = Record<string, UnifiedSearchResult[]>

export async function upsertUnifiedSearchEntry(args: {
  entityType: UnifiedSearchEntityType
  entityId: string
  title: string
  content: string
  snippet?: string
  keywords?: string[]
  agentName?: string | null
  taskName?: string | null
  projectName?: string | null
  timestamp?: number
}): Promise<UnifiedSearchIndexRow> {
  const now = Date.now()
  const tokens = tokenize(`${args.title} ${args.content} ${(args.keywords ?? []).join(' ')}`)
  const existing = await db.query.unifiedSearchIndex.findFirst({
    where: and(
      eq(schema.unifiedSearchIndex.entityType, args.entityType),
      eq(schema.unifiedSearchIndex.entityId, args.entityId),
    ),
  })
  const values = {
    entityType: args.entityType,
    entityId: normalizeRequired(args.entityId, 'entityId'),
    title: normalizeRequired(args.title, 'title'),
    content: normalizeRequired(args.content, 'content'),
    snippet: args.snippet?.trim() || makeSnippet(args.content),
    keywords: normalizeList(args.keywords),
    embedding: vectorize(tokens),
    agentName: args.agentName?.trim() || null,
    taskName: args.taskName?.trim() || null,
    projectName: args.projectName?.trim() || null,
    timestamp: args.timestamp ?? now,
    updatedAt: now,
  }
  if (existing) {
    await db
      .update(schema.unifiedSearchIndex)
      .set(values)
      .where(eq(schema.unifiedSearchIndex.id, existing.id))
    return getRequiredUnifiedSearchEntry(existing.id)
  }
  const row: UnifiedSearchIndexRow = {
    id: newUnifiedSearchIndexId(),
    ...values,
    createdAt: now,
  }
  await db.insert(schema.unifiedSearchIndex).values(row)
  return row
}

export async function listUnifiedSearchEntries(args: {
  entityType?: UnifiedSearchEntityType
  projectName?: string
  limit?: number
} = {}): Promise<UnifiedSearchIndexRow[]> {
  const conditions: SQL[] = []
  if (args.entityType) conditions.push(eq(schema.unifiedSearchIndex.entityType, args.entityType))
  if (args.projectName) conditions.push(eq(schema.unifiedSearchIndex.projectName, args.projectName))
  return db.query.unifiedSearchIndex.findMany({
    where: conditions.length ? and(...conditions) : undefined,
    orderBy: [desc(schema.unifiedSearchIndex.timestamp)],
    limit: args.limit ?? 100,
  })
}

export async function searchUnifiedIndex(args: {
  query: string
  scope?: UnifiedSearchScope
  modes?: UnifiedSearchModes
  filters?: {
    entityTypes?: UnifiedSearchEntityType[]
    agentName?: string
    projectName?: string
    dateFrom?: number
    dateTo?: number
  }
  nlQuery?: boolean
  limit?: number
}): Promise<UnifiedSearchResults> {
  const query = normalizeRequired(args.query, 'query')
  const queryTokens = tokenize(query)
  const queryVector = vectorize(queryTokens)
  const conditions: SQL[] = []
  if (args.filters?.projectName) {
    conditions.push(eq(schema.unifiedSearchIndex.projectName, args.filters.projectName))
  }
  if (args.filters?.agentName) {
    conditions.push(eq(schema.unifiedSearchIndex.agentName, args.filters.agentName))
  }
  if (args.filters?.dateFrom) conditions.push(gte(schema.unifiedSearchIndex.timestamp, args.filters.dateFrom))
  if (args.filters?.dateTo) conditions.push(lte(schema.unifiedSearchIndex.timestamp, args.filters.dateTo))
  const rows = await db.query.unifiedSearchIndex.findMany({
    where: conditions.length ? and(...conditions) : undefined,
    orderBy: [desc(schema.unifiedSearchIndex.timestamp)],
    limit: 1000,
  })
  const allowedTypes = new Set(args.filters?.entityTypes ?? scopeToEntityTypes(args.scope))
  const limit = Math.max(1, Math.min(args.limit ?? 20, 100))
  const modes = args.modes ?? { keyword: true, hybrid: true }
  const scored = rows
    .filter((row) => allowedTypes.has(row.entityType))
    .map((row) => ({
      row,
      score: scoreRow(row, queryTokens, queryVector, modes, Boolean(args.nlQuery)),
    }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || b.row.timestamp - a.row.timestamp)
    .slice(0, limit)

  return scored.reduce<UnifiedSearchResults>((acc, item) => {
    const key = item.row.entityType
    acc[key] ??= []
    acc[key].push({
      id: item.row.entityId,
      title: item.row.title,
      snippet: highlightSnippet(item.row, queryTokens),
      relevanceScore: Number(item.score.toFixed(4)),
      source: {
        agentName: item.row.agentName ?? undefined,
        taskName: item.row.taskName ?? undefined,
        projectName: item.row.projectName ?? undefined,
        timestamp: item.row.timestamp,
      },
    })
    return acc
  }, {})
}

async function getRequiredUnifiedSearchEntry(id: string): Promise<UnifiedSearchIndexRow> {
  const row = await db.query.unifiedSearchIndex.findFirst({
    where: eq(schema.unifiedSearchIndex.id, id),
  })
  if (!row) throw new Error(`Unified search entry not found: ${id}`)
  return row
}

function scoreRow(
  row: UnifiedSearchIndexRow,
  queryTokens: string[],
  queryVector: number[],
  modes: UnifiedSearchModes,
  nlQuery: boolean,
): number {
  const haystackTokens = tokenize(`${row.title} ${row.content} ${row.keywords.join(' ')}`)
  const keywordScore = modes.keyword || modes.hybrid ? overlapScore(queryTokens, haystackTokens) : 0
  const semanticScore =
    modes.semantic || modes.hybrid ? cosineSimilarity(queryVector, row.embedding) : 0
  const naturalLanguageBoost = nlQuery && queryTokens.length >= 3 ? 0.05 : 0
  if (modes.hybrid) return (keywordScore + semanticScore) / 2 + naturalLanguageBoost
  return Math.max(keywordScore, semanticScore) + naturalLanguageBoost
}

function scopeToEntityTypes(scope: UnifiedSearchScope | undefined): UnifiedSearchEntityType[] {
  const resolved = {
    agents: scope?.agents ?? true,
    tasks: scope?.tasks ?? true,
    memories: scope?.memories ?? true,
    artifacts: scope?.artifacts ?? true,
    workflows: scope?.workflows ?? true,
    events: scope?.events ?? true,
    knowledgeGraph: scope?.knowledgeGraph ?? true,
    documents: scope?.documents ?? true,
  }
  return [
    resolved.agents ? 'agent' : null,
    resolved.tasks ? 'task' : null,
    resolved.memories ? 'memory' : null,
    resolved.artifacts ? 'artifact' : null,
    resolved.workflows ? 'workflow' : null,
    resolved.events ? 'event' : null,
    resolved.knowledgeGraph ? 'knowledge_graph' : null,
    resolved.documents ? 'document' : null,
  ].filter(Boolean) as UnifiedSearchEntityType[]
}

function highlightSnippet(row: UnifiedSearchIndexRow, queryTokens: string[]): string {
  const base = row.snippet || makeSnippet(row.content)
  return queryTokens.reduce(
    (snippet, token) => snippet.replace(new RegExp(escapeRegExp(token), 'ig'), (match) => `**${match}**`),
    base,
  )
}

function makeSnippet(content: string): string {
  return content.trim().slice(0, 240)
}

function tokenize(value: string): string[] {
  return Array.from(new Set(value.toLowerCase().match(/[\p{L}\p{N}_-]+/gu) ?? []))
}

function vectorize(tokens: string[]): number[] {
  const vector = Array.from({ length: 16 }, () => 0)
  for (const token of tokens) vector[hashToken(token) % vector.length] += 1
  return vector
}

function hashToken(token: string): number {
  let hash = 0
  for (const char of token) hash = (hash * 31 + char.charCodeAt(0)) >>> 0
  return hash
}

function overlapScore(queryTokens: string[], haystackTokens: string[]): number {
  if (!queryTokens.length) return 0
  const haystack = new Set(haystackTokens)
  const matches = queryTokens.filter((token) => haystack.has(token)).length
  return matches / queryTokens.length
}

function cosineSimilarity(a: number[], b: number[]): number {
  const length = Math.max(a.length, b.length)
  let dot = 0
  let aNorm = 0
  let bNorm = 0
  for (let index = 0; index < length; index += 1) {
    const av = a[index] ?? 0
    const bv = b[index] ?? 0
    dot += av * bv
    aNorm += av * av
    bNorm += bv * bv
  }
  if (!aNorm || !bNorm) return 0
  return dot / (Math.sqrt(aNorm) * Math.sqrt(bNorm))
}

function normalizeList(values: string[] | undefined): string[] {
  return Array.from(new Set((values ?? []).map((value) => value.trim()).filter(Boolean)))
}

function normalizeRequired(value: string, field: string): string {
  const trimmed = value.trim()
  if (!trimmed) throw new Error(`${field} is required`)
  return trimmed
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
