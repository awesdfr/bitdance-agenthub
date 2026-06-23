import { and, desc, eq, type SQL } from 'drizzle-orm'

import { db, schema } from '@/db/client'
import type {
  ProjectAgentRoleRow,
  ProjectContextRow,
  ProjectSwitchEventRow,
  ProjectSwitchMode,
} from '@/db/schema'
import {
  newProjectAgentRoleId,
  newProjectContextId,
  newProjectSwitchEventId,
} from '@/server/ids'

export interface CreateProjectContextArgs {
  projectName: string
  overrides?: {
    modelProfileId?: string | null
    maxBudget?: number | null
    allowedSkills?: string[]
    requiredApprovalFor?: string[]
    networkProfileId?: string | null
  }
  switchBehavior?: {
    pauseCurrentTasks?: boolean
    isolateMemories?: boolean
    checkpointBeforeSwitch?: boolean
    mode?: ProjectSwitchMode
  }
}

export interface ProjectContextDetail {
  project: ProjectContextRow
  agentRoles: ProjectAgentRoleRow[]
}

export async function createProjectContext(
  args: CreateProjectContextArgs,
): Promise<ProjectContextRow> {
  const now = Date.now()
  const row: ProjectContextRow = {
    id: newProjectContextId(),
    projectName: normalizeRequired(args.projectName, 'projectName'),
    modelProfileId: args.overrides?.modelProfileId?.trim() || null,
    maxBudget: args.overrides?.maxBudget ?? null,
    allowedSkills: normalizeList(args.overrides?.allowedSkills),
    requiredApprovalFor: normalizeList(args.overrides?.requiredApprovalFor),
    networkProfileId: args.overrides?.networkProfileId?.trim() || null,
    pauseCurrentTasks: args.switchBehavior?.pauseCurrentTasks ?? true,
    isolateMemories: args.switchBehavior?.isolateMemories ?? true,
    checkpointBeforeSwitch: args.switchBehavior?.checkpointBeforeSwitch ?? true,
    switchMode: args.switchBehavior?.mode ?? 'sequential',
    status: 'active',
    createdAt: now,
    updatedAt: now,
  }
  await db.insert(schema.projectContexts).values(row)
  return row
}

export async function listProjectContexts(args: {
  status?: ProjectContextRow['status']
  limit?: number
} = {}): Promise<ProjectContextRow[]> {
  const conditions: SQL[] = []
  if (args.status) conditions.push(eq(schema.projectContexts.status, args.status))
  return db.query.projectContexts.findMany({
    where: conditions.length ? and(...conditions) : undefined,
    orderBy: [desc(schema.projectContexts.updatedAt)],
    limit: args.limit ?? 100,
  })
}

export async function getProjectContextDetail(projectContextId: string): Promise<ProjectContextDetail> {
  return {
    project: await getRequiredProjectContext(projectContextId),
    agentRoles: await listProjectAgentRoles({ projectContextId }),
  }
}

export async function addProjectAgentRole(args: {
  projectContextId: string
  agentId: string
  role: string
  joinedAt?: number
  activeWorkflows?: string[]
  contributedArtifacts?: string[]
  projectSpecificMemories?: string[]
}): Promise<ProjectAgentRoleRow> {
  await getRequiredProjectContext(args.projectContextId)
  const now = Date.now()
  const row: ProjectAgentRoleRow = {
    id: newProjectAgentRoleId(),
    projectContextId: args.projectContextId,
    agentId: normalizeRequired(args.agentId, 'agentId'),
    role: normalizeRequired(args.role, 'role'),
    joinedAt: args.joinedAt ?? now,
    activeWorkflows: normalizeList(args.activeWorkflows),
    contributedArtifacts: normalizeList(args.contributedArtifacts),
    projectSpecificMemories: normalizeList(args.projectSpecificMemories),
    status: 'active',
    createdAt: now,
    updatedAt: now,
  }
  await db.insert(schema.projectAgentRoles).values(row)
  return row
}

export async function listProjectAgentRoles(args: {
  projectContextId?: string
  agentId?: string
  status?: string
  limit?: number
} = {}): Promise<ProjectAgentRoleRow[]> {
  const conditions: SQL[] = []
  if (args.projectContextId) conditions.push(eq(schema.projectAgentRoles.projectContextId, args.projectContextId))
  if (args.agentId) conditions.push(eq(schema.projectAgentRoles.agentId, args.agentId))
  if (args.status) conditions.push(eq(schema.projectAgentRoles.status, args.status))
  return db.query.projectAgentRoles.findMany({
    where: conditions.length ? and(...conditions) : undefined,
    orderBy: [desc(schema.projectAgentRoles.updatedAt)],
    limit: args.limit ?? 100,
  })
}

export async function planProjectSwitch(args: {
  agentId: string
  fromProjectContextId?: string | null
  toProjectContextId: string
  behavior?: {
    pauseCurrentTasks?: boolean
    isolateMemories?: boolean
    checkpointBeforeSwitch?: boolean
    mode?: ProjectSwitchMode
  }
}): Promise<ProjectSwitchEventRow> {
  if (args.fromProjectContextId) await getRequiredProjectContext(args.fromProjectContextId)
  const toProject = await getRequiredProjectContext(args.toProjectContextId)
  const now = Date.now()
  const id = newProjectSwitchEventId()
  const checkpointBeforeSwitch =
    args.behavior?.checkpointBeforeSwitch ?? toProject.checkpointBeforeSwitch
  const row: ProjectSwitchEventRow = {
    id,
    agentId: normalizeRequired(args.agentId, 'agentId'),
    fromProjectContextId: args.fromProjectContextId?.trim() || null,
    toProjectContextId: toProject.id,
    pauseCurrentTasks: args.behavior?.pauseCurrentTasks ?? toProject.pauseCurrentTasks,
    isolateMemories: args.behavior?.isolateMemories ?? toProject.isolateMemories,
    checkpointBeforeSwitch,
    mode: args.behavior?.mode ?? toProject.switchMode,
    checkpointId: checkpointBeforeSwitch ? `project_switch_checkpoint:${id}` : null,
    status: 'planned',
    createdAt: now,
    updatedAt: now,
  }
  await db.insert(schema.projectSwitchEvents).values(row)
  return row
}

export async function listProjectSwitchEvents(args: {
  agentId?: string
  toProjectContextId?: string
  status?: ProjectSwitchEventRow['status']
  limit?: number
} = {}): Promise<ProjectSwitchEventRow[]> {
  const conditions: SQL[] = []
  if (args.agentId) conditions.push(eq(schema.projectSwitchEvents.agentId, args.agentId))
  if (args.toProjectContextId) {
    conditions.push(eq(schema.projectSwitchEvents.toProjectContextId, args.toProjectContextId))
  }
  if (args.status) conditions.push(eq(schema.projectSwitchEvents.status, args.status))
  return db.query.projectSwitchEvents.findMany({
    where: conditions.length ? and(...conditions) : undefined,
    orderBy: [desc(schema.projectSwitchEvents.createdAt)],
    limit: args.limit ?? 100,
  })
}

async function getRequiredProjectContext(id: string): Promise<ProjectContextRow> {
  const project = await db.query.projectContexts.findFirst({
    where: eq(schema.projectContexts.id, id),
  })
  if (!project) throw new Error(`Project context not found: ${id}`)
  return project
}

function normalizeList(values: string[] | undefined): string[] {
  return Array.from(new Set((values ?? []).map((value) => value.trim()).filter(Boolean)))
}

function normalizeRequired(value: string, field: string): string {
  const trimmed = value.trim()
  if (!trimmed) throw new Error(`${field} is required`)
  return trimmed
}
