import { asc, desc, eq } from 'drizzle-orm'

import { db, schema } from '@/db/client'
import type {
  CapacityEvaluationStatus,
  CapacityPlanningEvaluationRow,
  CapacityPlanningProfileRow,
  JsonObject,
} from '@/db/schema'
import { newCapacityPlanningEvaluationId, newCapacityPlanningProfileId } from '@/server/ids'

interface DefaultCapacityProfile {
  tierKey: string
  memoryGb: number
  cpuCores: number
  gpuRequired: boolean
  maxAgents: number
  maxBrowsers: number
  persona: string
}

const databaseGuidance = '100 Agents × 1000 memories ~= 1-2GB; 1000 tasks ~= 50MB events; SQLite WAL supports ~1TB.'
const storageGuidance = 'Base install ~= 500MB; workspace recommended 20GB+; browser profile ~= 100-300MB each.'

const defaultCapacityProfiles: DefaultCapacityProfile[] = [
  profile('8gb_4core_personal_light', 8, 4, false, 2, 1, '个人轻度'),
  profile('16gb_8core_personal_heavy', 16, 8, false, 5, 3, '个人重度'),
  profile('32gb_12core_professional', 32, 12, false, 10, 6, '专业用户'),
  profile('64gb_16core_small_server', 64, 16, false, 20, 12, '小型服务器'),
  profile('128gb_32core_gpu_team', 128, 32, true, 40, 20, '中大型团队'),
]

export function getDefaultCapacityProfileCount(): number {
  return defaultCapacityProfiles.length
}

export async function seedCapacityPlanningProfiles(): Promise<CapacityPlanningProfileRow[]> {
  const now = Date.now()
  for (const item of defaultCapacityProfiles) {
    const existing = await db.query.capacityPlanningProfiles.findFirst({
      where: eq(schema.capacityPlanningProfiles.tierKey, item.tierKey),
    })
    if (existing) continue
    await db.insert(schema.capacityPlanningProfiles).values({
      id: newCapacityPlanningProfileId(),
      tierKey: item.tierKey,
      memoryGb: item.memoryGb,
      cpuCores: item.cpuCores,
      gpuRequired: item.gpuRequired,
      maxAgents: item.maxAgents,
      maxBrowsers: item.maxBrowsers,
      persona: item.persona,
      databaseGuidance,
      storageGuidance,
      status: 'active',
      createdAt: now,
      updatedAt: now,
    })
  }
  return listCapacityPlanningProfiles()
}

export async function listCapacityPlanningProfiles(): Promise<CapacityPlanningProfileRow[]> {
  return db.query.capacityPlanningProfiles.findMany({
    orderBy: [asc(schema.capacityPlanningProfiles.memoryGb)],
    limit: 20,
  })
}

export async function evaluateCapacityPlan(args: {
  memoryGb: number
  cpuCores: number
  hasGpu?: boolean
  desiredAgents?: number
  desiredBrowsers?: number
  agentCount?: number
  memoriesPerAgent?: number
  taskCount?: number
}): Promise<CapacityPlanningEvaluationRow> {
  const profiles = await seedCapacityPlanningProfiles()
  const matchedProfile = selectProfile(profiles, args.memoryGb, args.cpuCores, args.hasGpu ?? false)
  const desiredAgents = args.desiredAgents ?? 0
  const desiredBrowsers = args.desiredBrowsers ?? 0
  const warnings: string[] = []
  if (!matchedProfile) warnings.push('No matching capacity tier for the supplied hardware.')
  if (matchedProfile && desiredAgents > matchedProfile.maxAgents) {
    warnings.push(`Desired Agents ${desiredAgents} exceeds tier limit ${matchedProfile.maxAgents}.`)
  }
  if (matchedProfile && desiredBrowsers > matchedProfile.maxBrowsers) {
    warnings.push(`Desired browsers ${desiredBrowsers} exceeds tier limit ${matchedProfile.maxBrowsers}.`)
  }
  if (args.memoryGb >= 128 && !(args.hasGpu ?? false)) {
    warnings.push('128GB team tier expects GPU availability for the documented recommendation.')
  }
  const status = resolveStatus(matchedProfile, warnings)
  const estimate = buildEstimate({
    matchedProfile,
    agentCount: args.agentCount ?? desiredAgents,
    memoriesPerAgent: args.memoriesPerAgent ?? 0,
    taskCount: args.taskCount ?? 0,
    desiredBrowsers,
  })
  const row = {
    id: newCapacityPlanningEvaluationId(),
    memoryGb: args.memoryGb,
    cpuCores: args.cpuCores,
    hasGpu: args.hasGpu ?? false,
    desiredAgents,
    desiredBrowsers,
    agentCount: args.agentCount ?? desiredAgents,
    memoriesPerAgent: args.memoriesPerAgent ?? 0,
    taskCount: args.taskCount ?? 0,
    matchedProfileId: matchedProfile?.id ?? null,
    status,
    estimate,
    warnings,
    createdAt: Date.now(),
  }
  await db.insert(schema.capacityPlanningEvaluations).values(row)
  return row
}

export async function listCapacityPlanningEvaluations(): Promise<CapacityPlanningEvaluationRow[]> {
  return db.query.capacityPlanningEvaluations.findMany({
    orderBy: [desc(schema.capacityPlanningEvaluations.createdAt)],
    limit: 100,
  })
}

function selectProfile(
  profiles: CapacityPlanningProfileRow[],
  memoryGb: number,
  cpuCores: number,
  hasGpu: boolean,
): CapacityPlanningProfileRow | null {
  const candidates = profiles.filter(
    (profile) =>
      profile.memoryGb <= memoryGb &&
      profile.cpuCores <= cpuCores &&
      (!profile.gpuRequired || hasGpu),
  )
  return candidates.sort((a, b) => b.memoryGb - a.memoryGb || b.cpuCores - a.cpuCores)[0] ?? null
}

function resolveStatus(
  matchedProfile: CapacityPlanningProfileRow | null,
  warnings: string[],
): CapacityEvaluationStatus {
  if (!matchedProfile) return 'over_capacity'
  if (warnings.some((warning) => warning.includes('exceeds'))) return 'over_capacity'
  if (warnings.length) return 'warning'
  return 'ok'
}

function buildEstimate(args: {
  matchedProfile: CapacityPlanningProfileRow | null
  agentCount: number
  memoriesPerAgent: number
  taskCount: number
  desiredBrowsers: number
}): JsonObject {
  const memoryRecords = args.agentCount * args.memoriesPerAgent
  const databaseEstimateGb = round((memoryRecords / 100_000) * 1.5, 2)
  const eventsEstimateMb = round((args.taskCount / 1000) * 50, 2)
  const browserProfileMinMb = args.desiredBrowsers * 100
  const browserProfileMaxMb = args.desiredBrowsers * 300
  return {
    matchedTier: args.matchedProfile?.tierKey ?? null,
    persona: args.matchedProfile?.persona ?? null,
    maxAgents: args.matchedProfile?.maxAgents ?? 0,
    maxBrowsers: args.matchedProfile?.maxBrowsers ?? 0,
    databaseEstimateGb,
    eventsEstimateMb,
    sqliteWalLimitGb: 1024,
    baseInstallMb: 500,
    workspaceRecommendedGb: 20,
    browserProfileStorageMbRange: [browserProfileMinMb, browserProfileMaxMb],
    databaseGuidance,
    storageGuidance,
  }
}

function profile(
  tierKey: string,
  memoryGb: number,
  cpuCores: number,
  gpuRequired: boolean,
  maxAgents: number,
  maxBrowsers: number,
  persona: string,
): DefaultCapacityProfile {
  return { tierKey, memoryGb, cpuCores, gpuRequired, maxAgents, maxBrowsers, persona }
}

function round(value: number, precision: number): number {
  const factor = 10 ** precision
  return Math.round(value * factor) / factor
}
