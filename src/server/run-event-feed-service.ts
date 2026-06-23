import { asc, eq } from 'drizzle-orm'

import { db, schema } from '@/db/client'
import type { JsonObject, RunStatus } from '@/db/schema'

export type RunEventFeedSource =
  | 'workflow_run'
  | 'workflow_node_run'
  | 'employee_run'
  | 'employee_run_event'

export interface RunEventFeedItem {
  id: string
  source: RunEventFeedSource
  runId: string
  employeeRunId: string | null
  workflowNodeRunId: string | null
  phase: string
  status: RunStatus | string
  message: string
  payload: JsonObject
  createdAt: number
}

export async function getEmployeeRunEventFeed(employeeRunId: string): Promise<RunEventFeedItem[]> {
  const run = await db.query.employeeRuns.findFirst({
    where: eq(schema.employeeRuns.id, employeeRunId),
  })
  if (!run) throw new Error(`Employee run not found: ${employeeRunId}`)
  const events = await db.query.employeeRunEvents.findMany({
    where: eq(schema.employeeRunEvents.employeeRunId, employeeRunId),
    orderBy: [asc(schema.employeeRunEvents.createdAt)],
  })
  const summary: RunEventFeedItem = {
    id: `${run.id}:summary`,
    source: 'employee_run',
    runId: run.id,
    employeeRunId: run.id,
    workflowNodeRunId: null,
    phase: run.currentPhase,
    status: run.status,
    message: run.currentStep ?? `Employee run is ${run.status}.`,
    payload: {
      agentProfileId: run.agentProfileId,
      workflowRunId: run.workflowRunId,
      goal: run.goal,
    },
    createdAt: run.updatedAt,
  }
  return [
    summary,
    ...events.map(
      (event): RunEventFeedItem => ({
        id: event.id,
        source: 'employee_run_event',
        runId: run.id,
        employeeRunId: run.id,
        workflowNodeRunId: null,
        phase: event.phase,
        status: event.type,
        message: event.message,
        payload: event.payload,
        createdAt: event.createdAt,
      }),
    ),
  ].sort((a, b) => a.createdAt - b.createdAt)
}

export async function getWorkflowRunEventFeed(workflowRunId: string): Promise<RunEventFeedItem[]> {
  const run = await db.query.workflowRuns.findFirst({
    where: eq(schema.workflowRuns.id, workflowRunId),
  })
  if (!run) throw new Error(`Workflow run not found: ${workflowRunId}`)
  const [nodeRuns, employeeRuns] = await Promise.all([
    db.query.workflowNodeRuns.findMany({
      where: eq(schema.workflowNodeRuns.workflowRunId, workflowRunId),
      orderBy: [asc(schema.workflowNodeRuns.startedAt)],
    }),
    db.query.employeeRuns.findMany({
      where: eq(schema.employeeRuns.workflowRunId, workflowRunId),
      orderBy: [asc(schema.employeeRuns.createdAt)],
    }),
  ])
  const feed: RunEventFeedItem[] = [
    {
      id: `${run.id}:summary`,
      source: 'workflow_run',
      runId: run.id,
      employeeRunId: null,
      workflowNodeRunId: null,
      phase: run.status,
      status: run.status,
      message: run.error ?? `Workflow run is ${run.status}.`,
      payload: {
        workflowId: run.workflowId,
        input: run.input,
        output: run.output ?? null,
      },
      createdAt: run.finishedAt ?? run.startedAt,
    },
    ...nodeRuns.map(
      (nodeRun): RunEventFeedItem => ({
        id: nodeRun.id,
        source: 'workflow_node_run',
        runId: run.id,
        employeeRunId: null,
        workflowNodeRunId: nodeRun.id,
        phase: nodeRun.progressStatus,
        status: nodeRun.status,
        message: nodeRun.currentStep ?? `Node ${nodeRun.nodeId} is ${nodeRun.status}.`,
        payload: {
          nodeId: nodeRun.nodeId,
          output: nodeRun.output ?? null,
          error: nodeRun.error,
        },
        createdAt: nodeRun.finishedAt ?? nodeRun.startedAt,
      }),
    ),
  ]
  for (const employeeRun of employeeRuns) {
    feed.push(...(await getEmployeeRunEventFeed(employeeRun.id)))
  }
  return feed.sort((a, b) => a.createdAt - b.createdAt)
}

export function eventFeedToSse(feed: RunEventFeedItem[]): string {
  return `${feed
    .map((item) => {
      const data = JSON.stringify(item)
      return `id: ${item.id}\nevent: run_event\ndata: ${data}\n`
    })
    .join('\n')}\nevent: end\ndata: {}\n\n`
}

export function eventFeedSseHeaders(): HeadersInit {
  return {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
  }
}
