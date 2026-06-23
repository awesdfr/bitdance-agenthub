import { and, desc, eq, type SQL } from 'drizzle-orm'

import { db, schema } from '@/db/client'
import type {
  ContextCacheRow,
  ContextCacheStatus,
  ContextPreloadTaskType,
  JsonObject,
} from '@/db/schema'
import { newContextCacheId } from '@/server/ids'

export interface ContextPreloadFlags {
  relevantMemories: boolean
  projectStructure: boolean
  recentChanges: boolean
  activeGuidelines: boolean
  peerAgentStatus: boolean
  recentErrors: boolean
}

export interface ContextCachePolicy {
  projectStructureTTL: string
  semanticCacheTTL: number
  memorySearchCacheTTL: number
}

const DEFAULT_PRELOAD_FLAGS: ContextPreloadFlags = {
  relevantMemories: true,
  projectStructure: true,
  recentChanges: true,
  activeGuidelines: true,
  peerAgentStatus: false,
  recentErrors: true,
}

const DEFAULT_CACHE_POLICY: ContextCachePolicy = {
  projectStructureTTL: 'until_file_change',
  semanticCacheTTL: 300,
  memorySearchCacheTTL: 600,
}

const PREDICTORS: Record<ContextPreloadTaskType, string[]> = {
  code: ['project_structure', 'dependencies', 'recent_git_log'],
  data: ['data_schema', 'historical_analysis_results'],
  doc: ['style_guides', 'glossary', 'historical_documents'],
  general: ['relevant_memories', 'recent_errors'],
}

const SECTION_BY_FLAG: Record<keyof ContextPreloadFlags, string> = {
  relevantMemories: 'relevant_memories',
  projectStructure: 'project_structure',
  recentChanges: 'recent_changes',
  activeGuidelines: 'active_guidelines',
  peerAgentStatus: 'peer_agent_status',
  recentErrors: 'recent_errors',
}

export async function planContextPreload(args: {
  agentProfileId?: string | null
  projectId?: string | null
  taskType?: ContextPreloadTaskType
  goal: string
  preload?: Partial<ContextPreloadFlags>
  cache?: Partial<ContextCachePolicy>
  now?: number
}): Promise<ContextCacheRow> {
  const now = args.now ?? Date.now()
  const taskType = args.taskType ?? 'general'
  const goal = normalizeRequired(args.goal, 'goal')
  const preloadFlags = { ...DEFAULT_PRELOAD_FLAGS, ...(args.preload ?? {}) }
  const cachePolicy = {
    ...DEFAULT_CACHE_POLICY,
    ...(args.cache ?? {}),
  }
  const ttlSeconds = Math.min(cachePolicy.semanticCacheTTL, cachePolicy.memorySearchCacheTTL)
  const expiresAt = ttlSeconds > 0 ? now + ttlSeconds * 1000 : null
  const row: ContextCacheRow = {
    id: newContextCacheId(),
    agentProfileId: normalizeOptional(args.agentProfileId),
    projectId: normalizeOptional(args.projectId),
    taskType,
    goal,
    cacheKey: makeCacheKey({
      agentProfileId: args.agentProfileId,
      projectId: args.projectId,
      taskType,
      goal,
    }),
    predictors: [...PREDICTORS[taskType]],
    preloadFlags: preloadFlags as unknown as JsonObject,
    cachedSections: enabledSections(preloadFlags),
    projectStructureTTL: cachePolicy.projectStructureTTL,
    semanticCacheTTL: cachePolicy.semanticCacheTTL,
    memorySearchCacheTTL: cachePolicy.memorySearchCacheTTL,
    expiresAt,
    invalidationSignal: null,
    status: 'fresh',
    createdAt: now,
    updatedAt: now,
  }
  await db.insert(schema.contextCaches).values(row)
  return row
}

export async function listContextCaches(args: {
  agentProfileId?: string
  projectId?: string
  taskType?: ContextPreloadTaskType
  status?: ContextCacheStatus
  limit?: number
} = {}): Promise<ContextCacheRow[]> {
  const conditions: SQL[] = []
  if (args.agentProfileId) conditions.push(eq(schema.contextCaches.agentProfileId, args.agentProfileId))
  if (args.projectId) conditions.push(eq(schema.contextCaches.projectId, args.projectId))
  if (args.taskType) conditions.push(eq(schema.contextCaches.taskType, args.taskType))
  if (args.status) conditions.push(eq(schema.contextCaches.status, args.status))
  return db.query.contextCaches.findMany({
    where: conditions.length ? and(...conditions) : undefined,
    orderBy: [desc(schema.contextCaches.updatedAt)],
    limit: args.limit ?? 100,
  })
}

export async function resolveContextCache(args: {
  contextCacheId?: string | null
  cacheKey?: string | null
  invalidationSignal?: string | null
  now?: number
}): Promise<ContextCacheRow> {
  const row = await findContextCache(args)
  const now = args.now ?? Date.now()
  const invalidationSignal = normalizeOptional(args.invalidationSignal)

  if (invalidationSignal) {
    return updateContextCacheStatus(row.id, 'invalidated', now, invalidationSignal)
  }
  if (row.status === 'invalidated') return row
  if (row.expiresAt !== null && row.expiresAt <= now) {
    return updateContextCacheStatus(row.id, 'stale', now, row.invalidationSignal)
  }
  if (row.status !== 'fresh') return updateContextCacheStatus(row.id, 'fresh', now, row.invalidationSignal)
  return row
}

async function findContextCache(args: {
  contextCacheId?: string | null
  cacheKey?: string | null
}): Promise<ContextCacheRow> {
  const contextCacheId = normalizeOptional(args.contextCacheId)
  if (contextCacheId) {
    const row = await db.query.contextCaches.findFirst({
      where: eq(schema.contextCaches.id, contextCacheId),
    })
    if (!row) throw new Error(`Context cache not found: ${contextCacheId}`)
    return row
  }
  const cacheKey = normalizeOptional(args.cacheKey)
  if (!cacheKey) throw new Error('contextCacheId or cacheKey is required')
  const row = await db.query.contextCaches.findFirst({
    where: eq(schema.contextCaches.cacheKey, cacheKey),
    orderBy: [desc(schema.contextCaches.updatedAt)],
  })
  if (!row) throw new Error(`Context cache not found for key: ${cacheKey}`)
  return row
}

async function updateContextCacheStatus(
  id: string,
  status: ContextCacheStatus,
  now: number,
  invalidationSignal: string | null,
): Promise<ContextCacheRow> {
  await db
    .update(schema.contextCaches)
    .set({
      status,
      invalidationSignal,
      updatedAt: now,
    })
    .where(eq(schema.contextCaches.id, id))
  const row = await db.query.contextCaches.findFirst({ where: eq(schema.contextCaches.id, id) })
  if (!row) throw new Error(`Context cache not found after update: ${id}`)
  return row
}

function enabledSections(flags: ContextPreloadFlags): string[] {
  return (Object.entries(flags) as [keyof ContextPreloadFlags, boolean][])
    .filter(([, enabled]) => enabled)
    .map(([key]) => SECTION_BY_FLAG[key])
}

function makeCacheKey(args: {
  agentProfileId?: string | null
  projectId?: string | null
  taskType: ContextPreloadTaskType
  goal: string
}): string {
  return [
    normalizeOptional(args.agentProfileId) ?? 'agent:any',
    normalizeOptional(args.projectId) ?? 'project:any',
    args.taskType,
    normalizeRequired(args.goal, 'goal').toLowerCase().replace(/\s+/g, ' '),
  ].join('|')
}

function normalizeOptional(value: string | null | undefined): string | null {
  const trimmed = value?.trim()
  return trimmed ? trimmed : null
}

function normalizeRequired(value: string, field: string): string {
  const trimmed = value.trim()
  if (!trimmed) throw new Error(`${field} is required`)
  return trimmed
}
