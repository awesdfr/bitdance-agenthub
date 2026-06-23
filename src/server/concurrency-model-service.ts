import os from 'node:os'

import { and, desc, eq } from 'drizzle-orm'

import { db, schema } from '@/db/client'
import type {
  ConcurrencyEvaluationRow,
  ConcurrencyEvaluationStatus,
  ConcurrencyMemoryTier,
  ConcurrencyProfileRow,
  ConcurrencyProfileStatus,
} from '@/db/schema'
import { newConcurrencyEvaluationId, newConcurrencyProfileId } from '@/server/ids'
import { recordAuditLog } from '@/server/security-service'

export interface CreateConcurrencyProfileArgs {
  name: string
  theoreticalMax?: {
    maxProcesses?: number
    maxFileDescriptors?: number
    maxMemoryBytes?: number
    maxBrowserInstances?: number
    maxModelConnections?: number
  }
  recommended?: {
    lowMemory?: { maxAgents: number; maxBrowsers: number }
    midMemory?: { maxAgents: number; maxBrowsers: number }
    highMemory?: { maxAgents: number; maxBrowsers: number }
    workstation?: { maxAgents: number; maxBrowsers: number }
  }
  adaptiveLimit?: boolean
  status?: ConcurrencyProfileStatus
}

export interface EvaluateConcurrencyArgs {
  concurrencyProfileId: string
  currentAgents?: number
  currentBrowsers?: number
  currentModelConnections?: number
  totalMemoryBytes?: number
  usedMemoryBytes?: number
}

export async function createConcurrencyProfile(
  args: CreateConcurrencyProfileArgs,
): Promise<ConcurrencyProfileRow> {
  const now = Date.now()
  const row: ConcurrencyProfileRow = {
    id: newConcurrencyProfileId(),
    name: args.name.trim(),
    maxProcesses: args.theoreticalMax?.maxProcesses ?? 64,
    maxFileDescriptors: args.theoreticalMax?.maxFileDescriptors ?? 1024,
    maxMemoryBytes: args.theoreticalMax?.maxMemoryBytes ?? 8 * 1024 * 1024 * 1024,
    maxBrowserInstances: args.theoreticalMax?.maxBrowserInstances ?? 3,
    maxModelConnections: args.theoreticalMax?.maxModelConnections ?? 8,
    lowMemoryMaxAgents: args.recommended?.lowMemory?.maxAgents ?? 2,
    lowMemoryMaxBrowsers: args.recommended?.lowMemory?.maxBrowsers ?? 1,
    midMemoryMaxAgents: args.recommended?.midMemory?.maxAgents ?? 5,
    midMemoryMaxBrowsers: args.recommended?.midMemory?.maxBrowsers ?? 3,
    highMemoryMaxAgents: args.recommended?.highMemory?.maxAgents ?? 10,
    highMemoryMaxBrowsers: args.recommended?.highMemory?.maxBrowsers ?? 6,
    workstationMaxAgents: args.recommended?.workstation?.maxAgents ?? 20,
    workstationMaxBrowsers: args.recommended?.workstation?.maxBrowsers ?? 12,
    adaptiveLimit: args.adaptiveLimit ?? true,
    status: args.status ?? 'active',
    createdAt: now,
    updatedAt: now,
  }
  await db.insert(schema.concurrencyProfiles).values(row)
  await recordAuditLog({
    actorType: 'system',
    action: 'concurrency.profile.create',
    resourceType: 'concurrency_profile',
    resourceId: row.id,
    status: 'allowed',
    riskLevel: 'low',
    message: 'Agent concurrency model profile created.',
    metadata: {
      maxProcesses: row.maxProcesses,
      maxBrowserInstances: row.maxBrowserInstances,
      adaptiveLimit: row.adaptiveLimit,
    },
  })
  return row
}

export async function listConcurrencyProfiles(args: {
  status?: ConcurrencyProfileStatus
  limit?: number
} = {}): Promise<ConcurrencyProfileRow[]> {
  return db.query.concurrencyProfiles.findMany({
    where: args.status ? eq(schema.concurrencyProfiles.status, args.status) : undefined,
    orderBy: [desc(schema.concurrencyProfiles.createdAt)],
    limit: Math.min(Math.max(args.limit ?? 50, 1), 200),
  })
}

export async function evaluateConcurrency(
  args: EvaluateConcurrencyArgs,
): Promise<ConcurrencyEvaluationRow> {
  const profile = await getRequiredConcurrencyProfile(args.concurrencyProfileId)
  const totalMemoryBytes = args.totalMemoryBytes ?? os.totalmem()
  const usedMemoryBytes = args.usedMemoryBytes ?? Math.max(0, os.totalmem() - os.freemem())
  const memoryTier = tierForMemory(totalMemoryBytes)
  const recommended = recommendedForTier(profile, memoryTier)
  const currentAgents = args.currentAgents ?? 0
  const currentBrowsers = args.currentBrowsers ?? 0
  const currentModelConnections = args.currentModelConnections ?? 0
  const { status, reason } = concurrencyStatus({
    profile,
    currentAgents,
    currentBrowsers,
    currentModelConnections,
    usedMemoryBytes,
    totalMemoryBytes,
    recommendedMaxAgents: recommended.maxAgents,
    recommendedMaxBrowsers: recommended.maxBrowsers,
  })
  const row: ConcurrencyEvaluationRow = {
    id: newConcurrencyEvaluationId(),
    concurrencyProfileId: profile.id,
    memoryTier,
    currentAgents,
    currentBrowsers,
    currentModelConnections,
    totalMemoryBytes,
    usedMemoryBytes,
    recommendedMaxAgents: recommended.maxAgents,
    recommendedMaxBrowsers: recommended.maxBrowsers,
    status,
    reason,
    createdAt: Date.now(),
  }
  await db.insert(schema.concurrencyEvaluations).values(row)
  await recordAuditLog({
    actorType: 'system',
    action: 'concurrency.evaluate',
    resourceType: 'concurrency_profile',
    resourceId: profile.id,
    status: status === 'blocked' ? 'blocked' : status === 'throttled' ? 'warning' : 'allowed',
    riskLevel: status === 'blocked' ? 'high' : status === 'throttled' ? 'medium' : 'low',
    message: reason,
    metadata: {
      concurrencyEvaluationId: row.id,
      memoryTier,
      currentAgents,
      currentBrowsers,
      recommended,
    },
  })
  return row
}

export async function listConcurrencyEvaluations(args: {
  concurrencyProfileId?: string
  status?: ConcurrencyEvaluationStatus
  limit?: number
} = {}): Promise<ConcurrencyEvaluationRow[]> {
  const filters = [
    args.concurrencyProfileId
      ? eq(schema.concurrencyEvaluations.concurrencyProfileId, args.concurrencyProfileId)
      : undefined,
    args.status ? eq(schema.concurrencyEvaluations.status, args.status) : undefined,
  ].filter(Boolean)
  return db.query.concurrencyEvaluations.findMany({
    where: filters.length > 0 ? and(...filters) : undefined,
    orderBy: [desc(schema.concurrencyEvaluations.createdAt)],
    limit: Math.min(Math.max(args.limit ?? 50, 1), 200),
  })
}

async function getRequiredConcurrencyProfile(id: string): Promise<ConcurrencyProfileRow> {
  const row = await db.query.concurrencyProfiles.findFirst({
    where: eq(schema.concurrencyProfiles.id, id),
  })
  if (!row) throw new Error(`Concurrency profile not found: ${id}`)
  return row
}

function tierForMemory(totalMemoryBytes: number): ConcurrencyMemoryTier {
  const gib = totalMemoryBytes / (1024 * 1024 * 1024)
  if (gib < 12) return 'low_memory'
  if (gib < 24) return 'mid_memory'
  if (gib < 48) return 'high_memory'
  return 'workstation'
}

function recommendedForTier(
  profile: ConcurrencyProfileRow,
  tier: ConcurrencyMemoryTier,
): { maxAgents: number; maxBrowsers: number } {
  if (tier === 'low_memory') {
    return { maxAgents: profile.lowMemoryMaxAgents, maxBrowsers: profile.lowMemoryMaxBrowsers }
  }
  if (tier === 'mid_memory') {
    return { maxAgents: profile.midMemoryMaxAgents, maxBrowsers: profile.midMemoryMaxBrowsers }
  }
  if (tier === 'high_memory') {
    return { maxAgents: profile.highMemoryMaxAgents, maxBrowsers: profile.highMemoryMaxBrowsers }
  }
  return { maxAgents: profile.workstationMaxAgents, maxBrowsers: profile.workstationMaxBrowsers }
}

function concurrencyStatus(args: {
  profile: ConcurrencyProfileRow
  currentAgents: number
  currentBrowsers: number
  currentModelConnections: number
  usedMemoryBytes: number
  totalMemoryBytes: number
  recommendedMaxAgents: number
  recommendedMaxBrowsers: number
}): { status: ConcurrencyEvaluationStatus; reason: string } {
  if (args.currentAgents > args.profile.maxProcesses) {
    return { status: 'blocked', reason: 'Current Agent process count exceeds theoretical process limit.' }
  }
  if (args.currentBrowsers > args.profile.maxBrowserInstances) {
    return { status: 'blocked', reason: 'Current browser instance count exceeds theoretical browser limit.' }
  }
  if (args.currentModelConnections > args.profile.maxModelConnections) {
    return { status: 'blocked', reason: 'Current model connections exceed configured API limit.' }
  }
  const memoryPressure = args.totalMemoryBytes > 0 ? args.usedMemoryBytes / args.totalMemoryBytes : 0
  if (
    args.profile.adaptiveLimit &&
    (args.currentAgents > args.recommendedMaxAgents ||
      args.currentBrowsers > args.recommendedMaxBrowsers ||
      memoryPressure > 0.85)
  ) {
    return { status: 'throttled', reason: 'Adaptive concurrency limit recommends throttling new Agent starts.' }
  }
  return { status: 'ok', reason: 'Current Agent concurrency is within configured limits.' }
}
