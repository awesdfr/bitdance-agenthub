import { and, desc, eq, inArray } from 'drizzle-orm'

import { db, schema } from '@/db/client'
import type {
  AgentDiversityProfileRow,
  AgentPersonality,
  AgentProfileRow,
  DiversityAnalysisRow,
  DiversityScopeType,
} from '@/db/schema'
import {
  newAgentDiversityProfileId,
  newDiversityAnalysisId,
} from '@/server/ids'
import { recordAuditLog } from '@/server/security-service'

const REQUIRED_TEAM_PERSPECTIVES: AgentPersonality[] = [
  'creative',
  'cautious',
  'user_advocate',
  'security',
]

export interface UpsertAgentDiversityProfileArgs {
  agentProfileId: string
  personality?: AgentDiversityProfileRow['personality']
  perspective?: string
  temperature?: number
  riskPosture?: AgentDiversityProfileRow['riskPosture']
  collaborationRole?: string
  status?: AgentDiversityProfileRow['status']
}

export interface AnalyzeDiversityArgs {
  scopeType?: DiversityScopeType
  scopeId?: string | null
  agentProfileIds?: string[]
}

export async function upsertAgentDiversityProfile(
  args: UpsertAgentDiversityProfileArgs,
): Promise<AgentDiversityProfileRow> {
  const agent = await getRequiredAgentProfile(args.agentProfileId)
  const now = Date.now()
  const existing = await db.query.agentDiversityProfiles.findFirst({
    where: and(
      eq(schema.agentDiversityProfiles.agentProfileId, agent.id),
      eq(schema.agentDiversityProfiles.status, 'active'),
    ),
    orderBy: [desc(schema.agentDiversityProfiles.updatedAt)],
  })
  const patch = {
    personality: args.personality ?? existing?.personality ?? 'cautious',
    perspective: args.perspective?.trim() || existing?.perspective || agent.role,
    temperature: clampTemperature(args.temperature ?? existing?.temperature ?? defaultTemperature(args.personality)),
    riskPosture: args.riskPosture ?? existing?.riskPosture ?? 'balanced',
    collaborationRole: args.collaborationRole?.trim() || existing?.collaborationRole || 'contributor',
    status: args.status ?? existing?.status ?? 'active',
    updatedAt: now,
  }

  if (existing) {
    await db
      .update(schema.agentDiversityProfiles)
      .set(patch)
      .where(eq(schema.agentDiversityProfiles.id, existing.id))
    await recordAuditLog({
      actorType: 'user',
      action: 'agent_diversity.update',
      resourceType: 'agent_diversity_profile',
      resourceId: existing.id,
      status: 'allowed',
      riskLevel: 'low',
      message: `Agent diversity profile for "${agent.name}" was updated.`,
      metadata: patch,
    })
    return getRequiredAgentDiversityProfile(existing.id)
  }

  const row: AgentDiversityProfileRow = {
    id: newAgentDiversityProfileId(),
    agentProfileId: agent.id,
    personality: patch.personality,
    perspective: patch.perspective,
    temperature: patch.temperature,
    riskPosture: patch.riskPosture,
    collaborationRole: patch.collaborationRole,
    status: patch.status,
    createdAt: now,
    updatedAt: now,
  }
  await db.insert(schema.agentDiversityProfiles).values(row)
  await recordAuditLog({
    actorType: 'user',
    action: 'agent_diversity.create',
    resourceType: 'agent_diversity_profile',
    resourceId: row.id,
    status: 'allowed',
    riskLevel: 'low',
    message: `Agent diversity profile for "${agent.name}" was created.`,
    metadata: {
      agentProfileId: agent.id,
      personality: row.personality,
      perspective: row.perspective,
      temperature: row.temperature,
    },
  })
  return row
}

export async function listAgentDiversityProfiles(args: {
  agentProfileId?: string | null
} = {}): Promise<AgentDiversityProfileRow[]> {
  const agentProfileId = normalizeNullable(args.agentProfileId)
  return db.query.agentDiversityProfiles.findMany({
    where: agentProfileId
      ? eq(schema.agentDiversityProfiles.agentProfileId, agentProfileId)
      : undefined,
    orderBy: [desc(schema.agentDiversityProfiles.updatedAt)],
  })
}

export async function getDiversityProfileForAgent(
  agentProfileId: string,
): Promise<AgentDiversityProfileRow | null> {
  return (
    (await db.query.agentDiversityProfiles.findFirst({
      where: and(
        eq(schema.agentDiversityProfiles.agentProfileId, agentProfileId),
        eq(schema.agentDiversityProfiles.status, 'active'),
      ),
      orderBy: [desc(schema.agentDiversityProfiles.updatedAt)],
    })) ?? null
  )
}

export async function analyzeAgentDiversity(
  args: AnalyzeDiversityArgs = {},
): Promise<DiversityAnalysisRow> {
  const requestedAgentIds = args.agentProfileIds?.filter(Boolean) ?? []
  const agents = await listAgentsForDiversity(requestedAgentIds)
  const profiles = await listAgentDiversityProfiles()
  const profileByAgent = new Map(
    profiles.filter((profile) => profile.status === 'active').map((profile) => [profile.agentProfileId, profile]),
  )
  const modelDiversity = uniqueStrings(
    agents.map((agent) => agent.modelProfileId ?? 'unassigned_model'),
  )
  const skillDiversity = uniqueStrings(agents.flatMap((agent) => agent.skillIds)).length
  const personalities = agents.map(
    (agent) => profileByAgent.get(agent.id)?.personality ?? inferPersonality(agent),
  )
  const perspectives = agents.map(
    (agent) => profileByAgent.get(agent.id)?.perspective ?? agent.role,
  )
  const missingPerspectives = REQUIRED_TEAM_PERSPECTIVES.filter(
    (personality) => !personalities.includes(personality),
  )
  const recommendation = buildRecommendation(agents, missingPerspectives, modelDiversity, skillDiversity)
  const row: DiversityAnalysisRow = {
    id: newDiversityAnalysisId(),
    scopeType: args.scopeType ?? 'team',
    scopeId: normalizeNullable(args.scopeId),
    agentProfileIds: agents.map((agent) => agent.id),
    modelDiversity,
    skillDiversity,
    perspectiveDiversity: diversityRatio(perspectives, agents.length),
    personalityDiversity: diversityRatio(personalities, agents.length),
    missingPerspectives,
    recommendation,
    createdAt: Date.now(),
  }
  await db.insert(schema.diversityAnalyses).values(row)
  await recordAuditLog({
    actorType: 'system',
    action: 'agent_diversity.analyze',
    resourceType: 'diversity_analysis',
    resourceId: row.id,
    status: row.missingPerspectives.length ? 'warning' : 'allowed',
    riskLevel: row.missingPerspectives.length ? 'medium' : 'low',
    message: row.recommendation,
    metadata: {
      scopeType: row.scopeType,
      scopeId: row.scopeId,
      agentProfileIds: row.agentProfileIds,
      modelDiversity: row.modelDiversity,
      skillDiversity: row.skillDiversity,
      perspectiveDiversity: row.perspectiveDiversity,
      personalityDiversity: row.personalityDiversity,
      missingPerspectives: row.missingPerspectives,
    },
  })
  return row
}

export async function listDiversityAnalyses(args: {
  scopeType?: DiversityScopeType | null
  scopeId?: string | null
  limit?: number
} = {}): Promise<DiversityAnalysisRow[]> {
  const scopeType = args.scopeType ?? null
  const scopeId = normalizeNullable(args.scopeId)
  const where = scopeType && scopeId
    ? and(eq(schema.diversityAnalyses.scopeType, scopeType), eq(schema.diversityAnalyses.scopeId, scopeId))
    : scopeType
      ? eq(schema.diversityAnalyses.scopeType, scopeType)
      : undefined
  return db.query.diversityAnalyses.findMany({
    where,
    orderBy: [desc(schema.diversityAnalyses.createdAt)],
    limit: Math.min(Math.max(args.limit ?? 50, 1), 200),
  })
}

async function listAgentsForDiversity(agentProfileIds: string[]): Promise<AgentProfileRow[]> {
  if (agentProfileIds.length > 0) {
    return db.query.agentProfiles.findMany({
      where: inArray(schema.agentProfiles.id, agentProfileIds),
      orderBy: [desc(schema.agentProfiles.createdAt)],
    })
  }
  return db.query.agentProfiles.findMany({
    where: eq(schema.agentProfiles.status, 'active'),
    orderBy: [desc(schema.agentProfiles.createdAt)],
    limit: 50,
  })
}

async function getRequiredAgentProfile(agentProfileId: string): Promise<AgentProfileRow> {
  const row = await db.query.agentProfiles.findFirst({
    where: eq(schema.agentProfiles.id, agentProfileId),
  })
  if (!row) throw new Error(`Agent profile not found: ${agentProfileId}`)
  return row
}

async function getRequiredAgentDiversityProfile(id: string): Promise<AgentDiversityProfileRow> {
  const row = await db.query.agentDiversityProfiles.findFirst({
    where: eq(schema.agentDiversityProfiles.id, id),
  })
  if (!row) throw new Error(`Agent diversity profile not found: ${id}`)
  return row
}

function defaultTemperature(personality?: AgentPersonality): number {
  if (personality === 'creative') return 0.8
  if (personality === 'cautious' || personality === 'security') return 0.3
  if (personality === 'user_advocate') return 0.5
  return 0.4
}

function clampTemperature(value: number): number {
  return Math.min(2, Math.max(0, Number.isFinite(value) ? value : 0.4))
}

function inferPersonality(agent: AgentProfileRow): AgentPersonality {
  const text = `${agent.name} ${agent.role} ${agent.description}`.toLowerCase()
  if (text.includes('security') || text.includes('risk')) return 'security'
  if (text.includes('user') || text.includes('ux') || text.includes('customer')) return 'user_advocate'
  if (text.includes('creative') || text.includes('design')) return 'creative'
  if (text.includes('ops') || text.includes('operate')) return 'operator'
  return 'cautious'
}

function diversityRatio(values: string[], denominator: number): number {
  if (denominator <= 0) return 0
  return Number((uniqueStrings(values).length / denominator).toFixed(3))
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))]
}

function buildRecommendation(
  agents: AgentProfileRow[],
  missingPerspectives: AgentPersonality[],
  modelDiversity: string[],
  skillDiversity: number,
): string {
  if (agents.length === 0) return 'No active Agents were available for diversity analysis.'
  if (missingPerspectives.length > 0) {
    return `Your team is missing ${missingPerspectives.join(', ')} perspectives; add or retune Agents to avoid groupthink.`
  }
  if (modelDiversity.length <= 1 && agents.length > 1) {
    return 'Your team has perspective diversity but low model diversity; consider adding a second model family.'
  }
  if (skillDiversity < agents.length) {
    return 'Your team has personality diversity but narrow skill coverage; assign more complementary Skills.'
  }
  return 'Your Agent team has healthy model, skill, personality, and perspective diversity.'
}

function normalizeNullable(value: string | null | undefined): string | null {
  const trimmed = value?.trim()
  return trimmed ? trimmed : null
}
