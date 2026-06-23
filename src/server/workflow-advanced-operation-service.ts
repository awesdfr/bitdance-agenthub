import { and, asc, desc, eq, inArray, type SQL } from 'drizzle-orm'

import { db, schema } from '@/db/client'
import type {
  CanvasPosition,
  JsonObject,
  TaskMergeSuggestionRow,
  TaskMergeSuggestionStatus,
  WorkflowEdgeRow,
  WorkflowNodeRow,
  WorkflowPartialRerunPlanRow,
  WorkflowPartialRerunStatus,
  WorkflowRow,
  WorkflowTemplateInstantiationRow,
  WorkflowTemplateInstantiationStatus,
  WorkflowTemplateParameterDefinition,
  WorkflowTemplateParameterSchema,
} from '@/db/schema'
import {
  newTaskMergeSuggestionId,
  newWorkflowEdgeId,
  newWorkflowId,
  newWorkflowNodeId,
  newWorkflowPartialRerunPlanId,
  newWorkflowTemplateInstantiationId,
} from '@/server/ids'

export interface PlanPartialWorkflowRerunArgs {
  workflowRunId: string
  fromNodeId: string
  inputPatch?: JsonObject
}

export interface SuggestTaskMergeTask {
  id: string
  title: string
  taskType?: string
  agentProfileId?: string | null
  payload?: JsonObject
}

export interface SuggestTaskMergeArgs {
  agentProfileId?: string | null
  taskType?: string
  tasks: SuggestTaskMergeTask[]
}

export interface InstantiateWorkflowTemplateArgs {
  sourceWorkflowId: string
  name?: string
  parameters: JsonObject
  parameterSchema: WorkflowTemplateParameterSchema
}

export async function planPartialWorkflowRerun(
  args: PlanPartialWorkflowRerunArgs,
): Promise<WorkflowPartialRerunPlanRow> {
  const run = await getRequiredWorkflowRun(args.workflowRunId)
  const [nodes, edges, nodeRuns] = await Promise.all([
    listWorkflowNodes(run.workflowId),
    listWorkflowEdges(run.workflowId),
    db.query.workflowNodeRuns.findMany({
      where: eq(schema.workflowNodeRuns.workflowRunId, run.id),
      orderBy: [asc(schema.workflowNodeRuns.startedAt)],
    }),
  ])
  if (!nodes.some((node) => node.id === args.fromNodeId)) {
    throw new Error(`Workflow node not found in run ${run.id}: ${args.fromNodeId}`)
  }

  const rerunNodeIds = downstreamNodeIds(args.fromNodeId, edges)
  const rerunSet = new Set(rerunNodeIds)
  const cachedNodeRunIds = nodeRuns
    .filter((row) => row.status === 'complete' && !rerunSet.has(row.nodeId))
    .map((row) => row.id)
  const invalidatedNodeRunIds = nodeRuns
    .filter((row) => rerunSet.has(row.nodeId))
    .map((row) => row.id)
  const now = Date.now()
  const row: WorkflowPartialRerunPlanRow = {
    id: newWorkflowPartialRerunPlanId(),
    workflowRunId: run.id,
    fromNodeId: args.fromNodeId,
    rerunNodeIds,
    cachedNodeRunIds,
    invalidatedNodeRunIds,
    inputPatch: args.inputPatch ?? {},
    costScope: {
      rerunNodeCount: rerunNodeIds.length,
      cachedNodeCount: cachedNodeRunIds.length,
      preservedUpstreamNodeRunIds: cachedNodeRunIds,
      chargedNodeIds: rerunNodeIds,
      message: 'Only the selected node and downstream nodes are queued again; completed upstream outputs stay cached.',
    },
    status: invalidatedNodeRunIds.length > 0 ? 'planned' : 'skipped',
    createdAt: now,
    appliedAt: null,
  }
  await db.insert(schema.workflowPartialRerunPlans).values(row)
  return row
}

export async function applyPartialWorkflowRerun(planId: string): Promise<WorkflowPartialRerunPlanRow> {
  const plan = await getRequiredPartialRerunPlan(planId)
  if (plan.status === 'applied' || plan.status === 'skipped') return plan
  const now = Date.now()
  const run = await getRequiredWorkflowRun(plan.workflowRunId)
  if (plan.invalidatedNodeRunIds.length > 0) {
    await db
      .update(schema.workflowNodeRuns)
      .set({
        status: 'queued',
        progressStatus: 'queued_for_partial_rerun',
        currentStep: `Queued for partial rerun from ${plan.fromNodeId}.`,
        output: null,
        error: null,
        startedAt: now,
        finishedAt: null,
      })
      .where(inArray(schema.workflowNodeRuns.id, plan.invalidatedNodeRunIds))
  }
  await db
    .update(schema.workflowRuns)
    .set({
      status: 'queued',
      input: mergeJsonObjects(run.input, plan.inputPatch),
      output: {
        ...(run.output ?? {}),
        partialRerun: {
          planId: plan.id,
          fromNodeId: plan.fromNodeId,
          cachedNodeRunIds: plan.cachedNodeRunIds,
          rerunNodeIds: plan.rerunNodeIds,
        },
      },
      error: null,
      finishedAt: null,
    })
    .where(eq(schema.workflowRuns.id, run.id))
  await db
    .update(schema.workflowPartialRerunPlans)
    .set({ status: 'applied', appliedAt: now })
    .where(eq(schema.workflowPartialRerunPlans.id, plan.id))
  return getRequiredPartialRerunPlan(plan.id)
}

export async function listPartialWorkflowReruns(args: {
  workflowRunId?: string
  status?: WorkflowPartialRerunStatus
  limit?: number
} = {}): Promise<WorkflowPartialRerunPlanRow[]> {
  const filters: SQL[] = []
  if (args.workflowRunId) filters.push(eq(schema.workflowPartialRerunPlans.workflowRunId, args.workflowRunId))
  if (args.status) filters.push(eq(schema.workflowPartialRerunPlans.status, args.status))
  return db.query.workflowPartialRerunPlans.findMany({
    where: filters.length ? and(...filters) : undefined,
    orderBy: [desc(schema.workflowPartialRerunPlans.createdAt)],
    limit: Math.min(Math.max(args.limit ?? 50, 1), 200),
  })
}

export async function suggestTaskMerge(args: SuggestTaskMergeArgs): Promise<TaskMergeSuggestionRow> {
  if (args.tasks.length < 2) throw new Error('At least two tasks are required for a merge suggestion.')
  const sourceTaskIds = args.tasks.map((task) => task.id)
  const taskType = args.taskType ?? commonTaskType(args.tasks)
  const agentProfileId = args.agentProfileId ?? commonAgentProfileId(args.tasks)
  const now = Date.now()
  const row: TaskMergeSuggestionRow = {
    id: newTaskMergeSuggestionId(),
    agentProfileId,
    sourceTaskIds,
    taskType,
    mergedTitle: mergedTaskTitle(args.tasks),
    mergedPayload: {
      taskType,
      sourceTasks: args.tasks.map((task) => ({
        id: task.id,
        title: task.title,
        payload: task.payload ?? {},
      })),
      outputRequirement: 'Return one artifact that contains a clearly separated result for every source task.',
    },
    benefits: {
      sourceTaskCount: args.tasks.length,
      savedModelCalls: Math.max(args.tasks.length - 1, 0),
      userMayReject: true,
      reason: 'Similar tasks share task type and Agent, so they can be reviewed as one merged task.',
    },
    requiresUserApproval: true,
    userDecision: null,
    status: 'suggested',
    createdAt: now,
    decidedAt: null,
  }
  await db.insert(schema.taskMergeSuggestions).values(row)
  return row
}

export async function decideTaskMergeSuggestion(
  suggestionId: string,
  decision: Extract<TaskMergeSuggestionStatus, 'approved' | 'rejected'>,
  note = '',
): Promise<TaskMergeSuggestionRow> {
  const suggestion = await getRequiredTaskMergeSuggestion(suggestionId)
  if (suggestion.status === 'applied') return suggestion
  const now = Date.now()
  await db
    .update(schema.taskMergeSuggestions)
    .set({ status: decision, userDecision: note || decision, decidedAt: now })
    .where(eq(schema.taskMergeSuggestions.id, suggestion.id))
  return getRequiredTaskMergeSuggestion(suggestion.id)
}

export async function applyTaskMergeSuggestion(suggestionId: string): Promise<TaskMergeSuggestionRow> {
  const suggestion = await getRequiredTaskMergeSuggestion(suggestionId)
  if (suggestion.status === 'rejected') throw new Error(`Task merge suggestion was rejected: ${suggestion.id}`)
  if (suggestion.requiresUserApproval && suggestion.status !== 'approved' && suggestion.status !== 'applied') {
    throw new Error(`Task merge suggestion requires approval before apply: ${suggestion.id}`)
  }
  if (suggestion.status === 'applied') return suggestion
  await db
    .update(schema.taskMergeSuggestions)
    .set({
      status: 'applied',
      mergedPayload: {
        ...suggestion.mergedPayload,
        appliedAt: Date.now(),
        separateExecutionFallback: false,
      },
    })
    .where(eq(schema.taskMergeSuggestions.id, suggestion.id))
  return getRequiredTaskMergeSuggestion(suggestion.id)
}

export async function listTaskMergeSuggestions(args: {
  agentProfileId?: string
  status?: TaskMergeSuggestionStatus
  limit?: number
} = {}): Promise<TaskMergeSuggestionRow[]> {
  const filters: SQL[] = []
  if (args.agentProfileId) filters.push(eq(schema.taskMergeSuggestions.agentProfileId, args.agentProfileId))
  if (args.status) filters.push(eq(schema.taskMergeSuggestions.status, args.status))
  return db.query.taskMergeSuggestions.findMany({
    where: filters.length ? and(...filters) : undefined,
    orderBy: [desc(schema.taskMergeSuggestions.createdAt)],
    limit: Math.min(Math.max(args.limit ?? 50, 1), 200),
  })
}

export async function instantiateWorkflowTemplate(
  args: InstantiateWorkflowTemplateArgs,
): Promise<WorkflowTemplateInstantiationRow> {
  const sourceWorkflow = await getRequiredWorkflow(args.sourceWorkflowId)
  const [nodes, edges] = await Promise.all([
    listWorkflowNodes(sourceWorkflow.id),
    listWorkflowEdges(sourceWorkflow.id),
  ])
  const parameters = resolveParameters(args.parameterSchema, args.parameters)
  const now = Date.now()
  const instantiatedWorkflow = await createRenderedWorkflow({
    sourceWorkflow,
    nodes,
    edges,
    name: renderString(args.name ?? `${sourceWorkflow.name} instance`, parameters),
    parameters,
  })
  const renderedWorkflow = {
    sourceWorkflowId: sourceWorkflow.id,
    instantiatedWorkflowId: instantiatedWorkflow.id,
    parameters,
    nodeCount: nodes.length,
    edgeCount: edges.length,
  }
  const row: WorkflowTemplateInstantiationRow = {
    id: newWorkflowTemplateInstantiationId(),
    sourceWorkflowId: sourceWorkflow.id,
    instantiatedWorkflowId: instantiatedWorkflow.id,
    name: instantiatedWorkflow.name,
    parameterSchema: args.parameterSchema,
    parameters,
    renderedWorkflow,
    status: 'instantiated',
    createdAt: now,
    instantiatedAt: now,
  }
  await db.insert(schema.workflowTemplateInstantiations).values(row)
  return row
}

export async function listWorkflowTemplateInstantiations(args: {
  sourceWorkflowId?: string
  status?: WorkflowTemplateInstantiationStatus
  limit?: number
} = {}): Promise<WorkflowTemplateInstantiationRow[]> {
  const filters: SQL[] = []
  if (args.sourceWorkflowId) {
    filters.push(eq(schema.workflowTemplateInstantiations.sourceWorkflowId, args.sourceWorkflowId))
  }
  if (args.status) filters.push(eq(schema.workflowTemplateInstantiations.status, args.status))
  return db.query.workflowTemplateInstantiations.findMany({
    where: filters.length ? and(...filters) : undefined,
    orderBy: [desc(schema.workflowTemplateInstantiations.createdAt)],
    limit: Math.min(Math.max(args.limit ?? 50, 1), 200),
  })
}

async function getRequiredWorkflow(id: string): Promise<WorkflowRow> {
  const workflow = await db.query.workflows.findFirst({ where: eq(schema.workflows.id, id) })
  if (!workflow) throw new Error(`Workflow not found: ${id}`)
  return workflow
}

async function getRequiredWorkflowRun(id: string) {
  const run = await db.query.workflowRuns.findFirst({ where: eq(schema.workflowRuns.id, id) })
  if (!run) throw new Error(`Workflow run not found: ${id}`)
  return run
}

async function getRequiredPartialRerunPlan(id: string): Promise<WorkflowPartialRerunPlanRow> {
  const row = await db.query.workflowPartialRerunPlans.findFirst({
    where: eq(schema.workflowPartialRerunPlans.id, id),
  })
  if (!row) throw new Error(`Workflow partial rerun plan not found: ${id}`)
  return row
}

async function getRequiredTaskMergeSuggestion(id: string): Promise<TaskMergeSuggestionRow> {
  const row = await db.query.taskMergeSuggestions.findFirst({
    where: eq(schema.taskMergeSuggestions.id, id),
  })
  if (!row) throw new Error(`Task merge suggestion not found: ${id}`)
  return row
}

function listWorkflowNodes(workflowId: string): Promise<WorkflowNodeRow[]> {
  return db.query.workflowNodes.findMany({
    where: eq(schema.workflowNodes.workflowId, workflowId),
    orderBy: [asc(schema.workflowNodes.createdAt)],
  })
}

function listWorkflowEdges(workflowId: string): Promise<WorkflowEdgeRow[]> {
  return db.query.workflowEdges.findMany({
    where: eq(schema.workflowEdges.workflowId, workflowId),
    orderBy: [asc(schema.workflowEdges.createdAt)],
  })
}

function downstreamNodeIds(fromNodeId: string, edges: WorkflowEdgeRow[]): string[] {
  const adjacency = new Map<string, string[]>()
  for (const edge of edges) {
    adjacency.set(edge.sourceNodeId, [...(adjacency.get(edge.sourceNodeId) ?? []), edge.targetNodeId])
  }
  const visited = new Set<string>()
  const queue = [fromNodeId]
  while (queue.length > 0) {
    const current = queue.shift()
    if (!current || visited.has(current)) continue
    visited.add(current)
    for (const next of adjacency.get(current) ?? []) queue.push(next)
  }
  return Array.from(visited)
}

function commonTaskType(tasks: SuggestTaskMergeTask[]): string {
  const first = tasks[0]?.taskType ?? 'general'
  return tasks.every((task) => (task.taskType ?? 'general') === first) ? first : 'mixed'
}

function commonAgentProfileId(tasks: SuggestTaskMergeTask[]): string | null {
  const first = tasks[0]?.agentProfileId ?? null
  return tasks.every((task) => (task.agentProfileId ?? null) === first) ? first : null
}

function mergedTaskTitle(tasks: SuggestTaskMergeTask[]): string {
  const titles = tasks.map((task) => task.title.trim()).filter(Boolean)
  if (titles.length <= 2) return titles.join(' and ')
  return `${titles.slice(0, -1).join(', ')} and ${titles[titles.length - 1]}`
}

function resolveParameters(
  parameterSchema: WorkflowTemplateParameterSchema,
  input: JsonObject,
): JsonObject {
  const result: JsonObject = {}
  for (const [key, definition] of Object.entries(parameterSchema)) {
    const raw = input[key] ?? definition.default
    if (raw === undefined || raw === null || raw === '') {
      if (definition.required) throw new Error(`Workflow template parameter is required: ${key}`)
      continue
    }
    validateParameterValue(key, raw, definition)
    result[key] = raw
  }
  for (const [key, value] of Object.entries(input)) {
    if (!(key in result) && parameterSchema[key] === undefined) result[key] = value
  }
  return result
}

function validateParameterValue(
  key: string,
  value: unknown,
  definition: WorkflowTemplateParameterDefinition,
): void {
  if (definition.type === 'number' && typeof value !== 'number') {
    throw new Error(`Workflow template parameter ${key} must be a number.`)
  }
  if (definition.type === 'boolean' && typeof value !== 'boolean') {
    throw new Error(`Workflow template parameter ${key} must be a boolean.`)
  }
  if (['string', 'file', 'url'].includes(definition.type) && typeof value !== 'string') {
    throw new Error(`Workflow template parameter ${key} must be a string.`)
  }
  if (definition.type === 'select' && definition.options?.length) {
    const allowed = definition.options.map((option) => JSON.stringify(option.value))
    if (!allowed.includes(JSON.stringify(value))) {
      throw new Error(`Workflow template parameter ${key} must match one of the declared options.`)
    }
  }
}

async function createRenderedWorkflow(args: {
  sourceWorkflow: WorkflowRow
  nodes: WorkflowNodeRow[]
  edges: WorkflowEdgeRow[]
  name: string
  parameters: JsonObject
}): Promise<WorkflowRow> {
  const now = Date.now()
  const workflow: WorkflowRow = {
    id: newWorkflowId(),
    name: args.name,
    description: renderString(args.sourceWorkflow.description, args.parameters),
    status: 'draft',
    version: 1,
    createdAt: now,
    updatedAt: now,
  }
  await db.insert(schema.workflows).values(workflow)
  const nodeIdMap = new Map(args.nodes.map((node) => [node.id, newWorkflowNodeId()]))
  for (const node of args.nodes) {
    await db.insert(schema.workflowNodes).values({
      id: nodeIdMap.get(node.id) ?? newWorkflowNodeId(),
      workflowId: workflow.id,
      type: node.type,
      agentProfileId: node.agentProfileId,
      position: node.position as CanvasPosition,
      config: renderJsonObject(node.config, args.parameters),
      inputMapping: renderJsonObject(node.inputMapping, args.parameters),
      outputContract: renderJsonObject(node.outputContract, args.parameters),
      retryPolicy: renderJsonObject(node.retryPolicy, args.parameters),
      approvalPolicy: renderJsonObject(node.approvalPolicy, args.parameters),
      createdAt: now,
      updatedAt: now,
    })
  }
  for (const edge of args.edges) {
    await db.insert(schema.workflowEdges).values({
      id: newWorkflowEdgeId(),
      workflowId: workflow.id,
      sourceNodeId: nodeIdMap.get(edge.sourceNodeId) ?? edge.sourceNodeId,
      targetNodeId: nodeIdMap.get(edge.targetNodeId) ?? edge.targetNodeId,
      sourceHandle: edge.sourceHandle,
      targetHandle: edge.targetHandle,
      mapping: renderJsonObject(edge.mapping, args.parameters),
      createdAt: now,
    })
  }
  return workflow
}

function renderJsonObject(value: JsonObject, parameters: JsonObject): JsonObject {
  const rendered = renderValue(value, parameters)
  return isJsonObject(rendered) ? rendered : {}
}

function renderValue(value: unknown, parameters: JsonObject): unknown {
  if (typeof value === 'string') return renderString(value, parameters)
  if (Array.isArray(value)) return value.map((item) => renderValue(item, parameters))
  if (isJsonObject(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, nested]) => [key, renderValue(nested, parameters)]),
    )
  }
  return value
}

function renderString(value: string, parameters: JsonObject): string {
  return value.replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (_match, key: string) => {
    const replacement = parameters[key]
    if (replacement === undefined || replacement === null) return ''
    return typeof replacement === 'string' ? replacement : JSON.stringify(replacement)
  })
}

function mergeJsonObjects(left: JsonObject | null, right: JsonObject): JsonObject {
  return { ...(left ?? {}), ...right }
}

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
