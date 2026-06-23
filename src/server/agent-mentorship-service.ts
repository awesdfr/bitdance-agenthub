import { and, desc, eq, type SQL } from 'drizzle-orm'

import { db, schema } from '@/db/client'
import type {
  AgentMentoringEventRow,
  AgentMentoringEventType,
  AgentMentorshipRow,
  AgentMentorshipScope,
  AgentMentorshipStatus,
  AgentMentorshipStyle,
  JsonObject,
} from '@/db/schema'
import { newAgentMentoringEventId, newAgentMentorshipId } from '@/server/ids'

export async function createAgentMentorship(args: {
  mentorAgentProfileId: string
  menteeAgentProfileId: string
  scope?: AgentMentorshipScope
  scopeTaskTypes?: string[]
  style?: AgentMentorshipStyle
  mentoringActions?: {
    reviewOutputs?: boolean
    interveneWhenStuck?: boolean
    shareRelevantMemories?: boolean
    generatePracticeTasks?: boolean
  }
  progress?: {
    initialProficiency?: number
    currentProficiency?: number
    targetProficiency?: number
    tasksUntilGraduation?: number
    fastestImprovingAreas?: string[]
    needsImprovement?: string[]
  }
}): Promise<AgentMentorshipRow> {
  if (args.mentorAgentProfileId === args.menteeAgentProfileId) {
    throw new Error('mentor and mentee must be different Agents')
  }
  await Promise.all([
    getRequiredAgentProfile(args.mentorAgentProfileId),
    getRequiredAgentProfile(args.menteeAgentProfileId),
  ])
  const now = Date.now()
  const initialProficiency = clamp01(args.progress?.initialProficiency ?? 0.2)
  const row: AgentMentorshipRow = {
    id: newAgentMentorshipId(),
    mentorAgentProfileId: args.mentorAgentProfileId,
    menteeAgentProfileId: args.menteeAgentProfileId,
    scope: args.scope ?? 'until_proficiency',
    scopeTaskTypes: normalizeList(args.scopeTaskTypes),
    style: args.style ?? 'review_and_feedback',
    reviewOutputs: args.mentoringActions?.reviewOutputs ?? true,
    interveneWhenStuck: args.mentoringActions?.interveneWhenStuck ?? true,
    shareRelevantMemories: args.mentoringActions?.shareRelevantMemories ?? true,
    generatePracticeTasks: args.mentoringActions?.generatePracticeTasks ?? true,
    initialProficiency,
    currentProficiency: clamp01(args.progress?.currentProficiency ?? initialProficiency),
    targetProficiency: clamp01(args.progress?.targetProficiency ?? 0.8),
    tasksUntilGraduation: Math.max(0, args.progress?.tasksUntilGraduation ?? 5),
    fastestImprovingAreas: normalizeList(args.progress?.fastestImprovingAreas),
    needsImprovement: normalizeList(args.progress?.needsImprovement),
    status: 'active',
    startedAt: now,
    updatedAt: now,
    graduatedAt: null,
  }
  await db.insert(schema.agentMentorships).values(row)
  return row
}

export async function recordMentoringAction(
  mentorshipId: string,
  args: {
    eventType: AgentMentoringEventType
    employeeRunId?: string | null
    artifactId?: string | null
    summary?: string
    feedback?: string
    sharedMemoryIds?: string[]
    practiceTask?: JsonObject
    proficiencyDelta?: number
    successfulTask?: boolean
    areasImproved?: string[]
    needsImprovement?: string[]
  },
): Promise<{ event: AgentMentoringEventRow; mentorship: AgentMentorshipRow }> {
  const mentorship = await getRequiredMentorship(mentorshipId)
  if (mentorship.status !== 'active') throw new Error(`Mentorship is ${mentorship.status}`)
  assertActionEnabled(mentorship, args.eventType)
  const now = Date.now()
  const event: AgentMentoringEventRow = {
    id: newAgentMentoringEventId(),
    mentorshipId,
    eventType: args.eventType,
    employeeRunId: normalizeOptional(args.employeeRunId),
    artifactId: normalizeOptional(args.artifactId),
    summary: args.summary?.trim() ?? '',
    feedback: args.feedback?.trim() ?? '',
    sharedMemoryIds: normalizeList(args.sharedMemoryIds),
    practiceTask: args.practiceTask ?? {},
    proficiencyDelta: args.proficiencyDelta ?? 0,
    successfulTask: args.successfulTask ?? false,
    areasImproved: normalizeList(args.areasImproved),
    needsImprovement: normalizeList(args.needsImprovement),
    createdAt: now,
  }
  await db.insert(schema.agentMentoringEvents).values(event)

  const currentProficiency = clamp01(mentorship.currentProficiency + event.proficiencyDelta)
  const tasksUntilGraduation = Math.max(
    0,
    mentorship.tasksUntilGraduation - (event.successfulTask ? 1 : 0),
  )
  const fastestImprovingAreas = mergeUnique(mentorship.fastestImprovingAreas, event.areasImproved)
  const needsImprovement = event.needsImprovement.length
    ? mergeUnique([], event.needsImprovement)
    : mentorship.needsImprovement
  const graduated = currentProficiency >= mentorship.targetProficiency || tasksUntilGraduation === 0
  await db
    .update(schema.agentMentorships)
    .set({
      currentProficiency,
      tasksUntilGraduation,
      fastestImprovingAreas,
      needsImprovement,
      status: graduated ? 'graduated' : 'active',
      updatedAt: now,
      graduatedAt: graduated ? now : mentorship.graduatedAt,
    })
    .where(eq(schema.agentMentorships.id, mentorship.id))
  return { event, mentorship: await getRequiredMentorship(mentorship.id) }
}

export async function listAgentMentorships(args: {
  mentorAgentProfileId?: string
  menteeAgentProfileId?: string
  status?: AgentMentorshipStatus
  limit?: number
} = {}): Promise<AgentMentorshipRow[]> {
  const conditions: SQL[] = []
  if (args.mentorAgentProfileId) {
    conditions.push(eq(schema.agentMentorships.mentorAgentProfileId, args.mentorAgentProfileId))
  }
  if (args.menteeAgentProfileId) {
    conditions.push(eq(schema.agentMentorships.menteeAgentProfileId, args.menteeAgentProfileId))
  }
  if (args.status) conditions.push(eq(schema.agentMentorships.status, args.status))
  return db.query.agentMentorships.findMany({
    where: conditions.length ? and(...conditions) : undefined,
    orderBy: [desc(schema.agentMentorships.updatedAt)],
    limit: args.limit ?? 100,
  })
}

export async function listAgentMentoringEvents(args: {
  mentorshipId?: string
  eventType?: AgentMentoringEventType
  limit?: number
} = {}): Promise<AgentMentoringEventRow[]> {
  const conditions: SQL[] = []
  if (args.mentorshipId) conditions.push(eq(schema.agentMentoringEvents.mentorshipId, args.mentorshipId))
  if (args.eventType) conditions.push(eq(schema.agentMentoringEvents.eventType, args.eventType))
  return db.query.agentMentoringEvents.findMany({
    where: conditions.length ? and(...conditions) : undefined,
    orderBy: [desc(schema.agentMentoringEvents.createdAt)],
    limit: args.limit ?? 100,
  })
}

async function getRequiredMentorship(id: string): Promise<AgentMentorshipRow> {
  const row = await db.query.agentMentorships.findFirst({ where: eq(schema.agentMentorships.id, id) })
  if (!row) throw new Error(`Agent mentorship not found: ${id}`)
  return row
}

async function getRequiredAgentProfile(id: string): Promise<void> {
  const row = await db.query.agentProfiles.findFirst({ where: eq(schema.agentProfiles.id, id) })
  if (!row) throw new Error(`Agent profile not found: ${id}`)
}

function assertActionEnabled(mentorship: AgentMentorshipRow, eventType: AgentMentoringEventType): void {
  if (eventType === 'review_output' && !mentorship.reviewOutputs) throw new Error('review_outputs_disabled')
  if (eventType === 'intervene_when_stuck' && !mentorship.interveneWhenStuck) {
    throw new Error('intervention_disabled')
  }
  if (eventType === 'share_memory' && !mentorship.shareRelevantMemories) {
    throw new Error('memory_sharing_disabled')
  }
  if (eventType === 'generate_practice_task' && !mentorship.generatePracticeTasks) {
    throw new Error('practice_task_generation_disabled')
  }
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value))
}

function mergeUnique(a: string[], b: string[]): string[] {
  return Array.from(new Set([...a, ...b].map((value) => value.trim()).filter(Boolean)))
}

function normalizeList(values: string[] | undefined): string[] {
  return Array.from(new Set((values ?? []).map((value) => value.trim()).filter(Boolean)))
}

function normalizeOptional(value: string | null | undefined): string | null {
  const trimmed = value?.trim()
  return trimmed ? trimmed : null
}
