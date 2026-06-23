import { mkdirSync } from 'node:fs'
import path from 'node:path'

import { and, asc, eq } from 'drizzle-orm'

import { db, schema } from '@/db/client'
import type {
  AgentProfileRow,
  ComputerActionEventRow,
  ComputerActionStatus,
  ComputerSessionRow,
  EmployeeRunRow,
  JsonObject,
  WorkstationMode,
} from '@/db/schema'
import { newComputerActionEventId, newComputerSessionId } from '@/server/ids'

export async function startComputerSessionForEmployeeRun(args: {
  run: EmployeeRunRow
  agent: AgentProfileRow
}): Promise<ComputerSessionRow> {
  const mode = resolveWorkstationMode(args.agent)
  const paths = resolveSessionPaths(args.agent.id, args.run.id)
  const now = Date.now()
  const session = {
    id: newComputerSessionId(),
    agentProfileId: args.agent.id,
    employeeRunId: args.run.id,
    workflowRunId: args.run.workflowRunId,
    workstationId: null,
    mode,
    workspacePath: paths.workspacePath,
    browserProfilePath: paths.browserProfilePath,
    tempPath: paths.tempPath,
    status: 'active' as const,
    createdAt: now,
    updatedAt: now,
    finishedAt: null,
  }

  mkdirSync(paths.workspacePath, { recursive: true })
  mkdirSync(paths.browserProfilePath, { recursive: true })
  mkdirSync(paths.tempPath, { recursive: true })
  await db.insert(schema.computerSessions).values(session)
  await recordComputerActionEvent({
    session,
    actionType: 'observe_environment',
    target: mode,
    input: { dryRun: true, reason: 'runtime_start' },
    output: {
      workspacePath: paths.workspacePath,
      browserProfilePath: paths.browserProfilePath,
      tempPath: paths.tempPath,
    },
    status: 'complete',
  })
  return session
}

export async function recordComputerActionEvent(args: {
  session: ComputerSessionRow
  actionType: string
  target?: string | null
  input?: JsonObject
  output?: JsonObject
  status?: ComputerActionStatus
}): Promise<ComputerActionEventRow> {
  const now = Date.now()
  const event = {
    id: newComputerActionEventId(),
    computerSessionId: args.session.id,
    employeeRunId: args.session.employeeRunId,
    workflowRunId: args.session.workflowRunId,
    actionType: args.actionType,
    target: args.target ?? null,
    input: args.input ?? {},
    output: args.output ?? {},
    status: args.status ?? 'planned',
    createdAt: now,
  }
  await db.insert(schema.computerActionEvents).values(event)
  await db
    .update(schema.computerSessions)
    .set({ updatedAt: now })
    .where(eq(schema.computerSessions.id, args.session.id))
  return event
}

export async function recordComputerSessionAction(
  sessionId: string,
  args: {
    actionType: string
    target?: string | null
    input?: JsonObject
    output?: JsonObject
    status?: ComputerActionStatus
  },
): Promise<ComputerActionEventRow> {
  const session = await getRequiredComputerSession(sessionId)
  if (session.status === 'failed') {
    throw new Error(`Computer session ${sessionId} is failed; append a recovery event instead of a new computer action.`)
  }
  return recordComputerActionEvent({
    session,
    actionType: args.actionType,
    target: args.target,
    input: args.input,
    output: args.output,
    status: args.status,
  })
}

export async function recordComputerObservation(
  sessionId: string,
  args: {
    summary: string
    viewport?: JsonObject
    screenshotPath?: string | null
    pageUrl?: string | null
  },
): Promise<ComputerActionEventRow> {
  const output: JsonObject = {
    summary: args.summary,
    captureMode: args.screenshotPath ? 'external_screenshot_reference' : 'metadata_only',
  }
  if (args.viewport) output.viewport = args.viewport
  if (args.screenshotPath) output.screenshotPath = args.screenshotPath
  if (args.pageUrl) output.pageUrl = args.pageUrl
  return recordComputerSessionAction(sessionId, {
    actionType: 'observe_screen',
    target: args.pageUrl ?? 'workstation',
    input: { dryRun: true },
    output,
    status: 'complete',
  })
}

export async function completeComputerSession(
  sessionId: string,
  status: Extract<ComputerSessionRow['status'], 'complete' | 'failed'> = 'complete',
): Promise<ComputerSessionRow> {
  const now = Date.now()
  await db
    .update(schema.computerSessions)
    .set({
      status,
      updatedAt: now,
      finishedAt: now,
    })
    .where(eq(schema.computerSessions.id, sessionId))
  const session = await getRequiredComputerSession(sessionId)
  await recordComputerActionEvent({
    session,
    actionType: 'session_complete',
    target: session.mode,
    input: { dryRun: true },
    output: { status },
    status: 'complete',
  })
  return getRequiredComputerSession(sessionId)
}

export async function listComputerSessionsForEmployeeRun(
  employeeRunId: string,
): Promise<ComputerSessionRow[]> {
  return db.query.computerSessions.findMany({
    where: eq(schema.computerSessions.employeeRunId, employeeRunId),
    orderBy: [asc(schema.computerSessions.createdAt)],
  })
}

export async function listComputerSessions(args: {
  employeeRunId?: string
  workflowRunId?: string
  agentProfileId?: string
} = {}): Promise<ComputerSessionRow[]> {
  const filters = [
    args.employeeRunId ? eq(schema.computerSessions.employeeRunId, args.employeeRunId) : null,
    args.workflowRunId ? eq(schema.computerSessions.workflowRunId, args.workflowRunId) : null,
    args.agentProfileId ? eq(schema.computerSessions.agentProfileId, args.agentProfileId) : null,
  ].filter((filter) => filter !== null)
  return db.query.computerSessions.findMany({
    where: filters.length > 0 ? and(...filters) : undefined,
    orderBy: [asc(schema.computerSessions.createdAt)],
  })
}

export async function listComputerActionEventsForEmployeeRun(
  employeeRunId: string,
): Promise<ComputerActionEventRow[]> {
  return db.query.computerActionEvents.findMany({
    where: eq(schema.computerActionEvents.employeeRunId, employeeRunId),
    orderBy: [asc(schema.computerActionEvents.createdAt)],
  })
}

export async function getComputerSessionTimeline(
  sessionId: string,
): Promise<{ session: ComputerSessionRow; actions: ComputerActionEventRow[] }> {
  const session = await getRequiredComputerSession(sessionId)
  const actions = await listComputerActionEventsForSession(sessionId)
  return { session, actions }
}

export async function listComputerActionEventsForSession(
  sessionId: string,
): Promise<ComputerActionEventRow[]> {
  return db.query.computerActionEvents.findMany({
    where: eq(schema.computerActionEvents.computerSessionId, sessionId),
    orderBy: [asc(schema.computerActionEvents.createdAt)],
  })
}

export async function listComputerSessionsForWorkflowRun(
  workflowRunId: string,
): Promise<ComputerSessionRow[]> {
  return db.query.computerSessions.findMany({
    where: eq(schema.computerSessions.workflowRunId, workflowRunId),
    orderBy: [asc(schema.computerSessions.createdAt)],
  })
}

export async function listComputerActionEventsForWorkflowRun(
  workflowRunId: string,
): Promise<ComputerActionEventRow[]> {
  return db.query.computerActionEvents.findMany({
    where: eq(schema.computerActionEvents.workflowRunId, workflowRunId),
    orderBy: [asc(schema.computerActionEvents.createdAt)],
  })
}

export async function getRequiredComputerSession(id: string): Promise<ComputerSessionRow> {
  const row = await db.query.computerSessions.findFirst({
    where: eq(schema.computerSessions.id, id),
  })
  if (!row) throw new Error(`Computer session not found: ${id}`)
  return row
}

function resolveWorkstationMode(agent: AgentProfileRow): WorkstationMode {
  const configured = agent.workstationPolicy.mode
  if (isWorkstationMode(configured)) return configured
  if (getBooleanPath(agent.permissionPolicy, ['desktop', 'operate'])) return 'physical_desktop'
  if (getBooleanPath(agent.permissionPolicy, ['browser', 'operate'])) return 'browser_context'
  return 'browser_context'
}

function resolveSessionPaths(agentProfileId: string, employeeRunId: string) {
  const dataDir = process.env.AGENTHUB_DATA_DIR ?? path.resolve(process.cwd(), '.agenthub-data')
  const root = path.join(dataDir, 'computer-sessions', safeSegment(agentProfileId), safeSegment(employeeRunId))
  return {
    workspacePath: path.join(root, 'workspace'),
    browserProfilePath: path.join(root, 'browser-profile'),
    tempPath: path.join(root, 'tmp'),
  }
}

function isWorkstationMode(value: unknown): value is WorkstationMode {
  return (
    value === 'browser_context' ||
    value === 'physical_desktop' ||
    value === 'virtual_desktop' ||
    value === 'vm' ||
    value === 'remote_session'
  )
}

function getBooleanPath(obj: JsonObject, pathParts: string[]): boolean {
  let current: unknown = obj
  for (const key of pathParts) {
    if (!current || typeof current !== 'object' || Array.isArray(current)) return false
    current = (current as Record<string, unknown>)[key]
  }
  return current === true
}

function safeSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9_.-]/g, '_')
}
