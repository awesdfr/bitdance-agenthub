import { asc, desc, eq } from 'drizzle-orm'

import { db, schema } from '@/db/client'
import type {
  AgentProfileRow,
  JsonObject,
  LearningEventRow,
  PlaybookRow,
  PlaybookVersionRow,
  RunReflectionRow,
} from '@/db/schema'
import {
  newLearningEventId,
  newPlaybookId,
  newPlaybookVersionId,
} from '@/server/ids'

export interface RuntimeLearningProposal {
  learningEvent: LearningEventRow | null
}

export async function proposeLearningEventFromReflection(args: {
  reflection: RunReflectionRow | null
  agent: AgentProfileRow
}): Promise<RuntimeLearningProposal> {
  if (!args.reflection) return { learningEvent: null }
  const procedure = args.reflection.reusableProcedure[0]
  if (!procedure) return { learningEvent: null }

  const now = Date.now()
  const title = `${args.agent.role} playbook proposal`
  const proposedPlaybook: JsonObject = {
    title,
    description: `Reusable procedure learned from run ${args.reflection.runId}.`,
    steps: args.reflection.reusableProcedure,
    sourceRunId: args.reflection.runId,
    whatWorked: args.reflection.whatWorked,
    futureWarnings: args.reflection.futureWarnings,
  }
  const row = {
    id: newLearningEventId(),
    runId: args.reflection.runId,
    agentProfileId: args.agent.id,
    reflectionId: args.reflection.id,
    type: 'playbook_proposal',
    title,
    summary: procedure,
    proposedPlaybook,
    status: 'pending_review' as const,
    reviewerNote: null,
    createdAt: now,
    reviewedAt: null,
  }

  await db.insert(schema.learningEvents).values(row)
  return { learningEvent: row }
}

export async function listLearningEvents(status?: LearningEventRow['status']): Promise<LearningEventRow[]> {
  return db.query.learningEvents.findMany({
    where: status ? eq(schema.learningEvents.status, status) : undefined,
    orderBy: [desc(schema.learningEvents.createdAt)],
    limit: 100,
  })
}

export async function listLearningEventsForRun(runId: string): Promise<LearningEventRow[]> {
  return db.query.learningEvents.findMany({
    where: eq(schema.learningEvents.runId, runId),
    orderBy: [asc(schema.learningEvents.createdAt)],
  })
}

export async function approveLearningEvent(
  learningEventId: string,
  reviewerNote = '',
): Promise<{
  learningEvent: LearningEventRow
  playbook: PlaybookRow
  playbookVersion: PlaybookVersionRow
}> {
  const event = await getRequiredLearningEvent(learningEventId)
  if (event.status !== 'pending_review') {
    throw new Error(`Only pending learning events can be approved; current status is ${event.status}.`)
  }
  const now = Date.now()
  const title = getString(event.proposedPlaybook, 'title') ?? event.title
  const description = getString(event.proposedPlaybook, 'description') ?? event.summary
  const steps = getStringArray(event.proposedPlaybook, 'steps')
  const playbook = {
    id: newPlaybookId(),
    agentProfileId: event.agentProfileId,
    title,
    description,
    status: 'active' as const,
    sourceLearningEventId: event.id,
    createdAt: now,
    updatedAt: now,
  }
  const version = {
    id: newPlaybookVersionId(),
    playbookId: playbook.id,
    version: 1,
    content: buildPlaybookContent(event, steps),
    steps,
    sourceRunId: event.runId,
    createdAt: now,
  }

  await db.insert(schema.playbooks).values(playbook)
  await db.insert(schema.playbookVersions).values(version)
  await db
    .update(schema.learningEvents)
    .set({
      status: 'approved',
      reviewerNote: reviewerNote.trim() || null,
      reviewedAt: now,
    })
    .where(eq(schema.learningEvents.id, event.id))
  return {
    learningEvent: await getRequiredLearningEvent(event.id),
    playbook,
    playbookVersion: version,
  }
}

export async function rejectLearningEvent(
  learningEventId: string,
  reviewerNote = '',
): Promise<LearningEventRow> {
  const event = await getRequiredLearningEvent(learningEventId)
  if (event.status !== 'pending_review') {
    throw new Error(`Only pending learning events can be rejected; current status is ${event.status}.`)
  }
  await db
    .update(schema.learningEvents)
    .set({
      status: 'rejected',
      reviewerNote: reviewerNote.trim() || null,
      reviewedAt: Date.now(),
    })
    .where(eq(schema.learningEvents.id, learningEventId))
  return getRequiredLearningEvent(learningEventId)
}

export async function listPlaybooks(agentProfileId?: string): Promise<PlaybookRow[]> {
  return db.query.playbooks.findMany({
    where: agentProfileId ? eq(schema.playbooks.agentProfileId, agentProfileId) : undefined,
    orderBy: [desc(schema.playbooks.updatedAt)],
    limit: 100,
  })
}

export async function listPlaybookVersions(playbookId: string): Promise<PlaybookVersionRow[]> {
  return db.query.playbookVersions.findMany({
    where: eq(schema.playbookVersions.playbookId, playbookId),
    orderBy: [desc(schema.playbookVersions.version)],
  })
}

async function getRequiredLearningEvent(id: string): Promise<LearningEventRow> {
  const row = await db.query.learningEvents.findFirst({
    where: eq(schema.learningEvents.id, id),
  })
  if (!row) throw new Error(`Learning event not found: ${id}`)
  return row
}

function buildPlaybookContent(event: LearningEventRow, steps: string[]): string {
  return [
    `# ${getString(event.proposedPlaybook, 'title') ?? event.title}`,
    '',
    getString(event.proposedPlaybook, 'description') ?? event.summary,
    '',
    ...steps.map((step, index) => `${index + 1}. ${step}`),
  ].join('\n')
}

function getString(obj: JsonObject, key: string): string | null {
  const value = obj[key]
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function getStringArray(obj: JsonObject, key: string): string[] {
  const value = obj[key]
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}
