import { asc, desc, eq } from 'drizzle-orm'

import { db, schema } from '@/db/client'
import type {
  AgentProfileRow,
  JsonObject,
  ResourceType,
  WorkflowEdgeRow,
  WorkflowNodeRow,
  WorkflowPreflightRow,
  WorkflowPreflightStatus,
} from '@/db/schema'
import { newWorkflowPreflightId } from '@/server/ids'

export interface RunWorkflowPreflightArgs {
  workflowId: string
  input?: JsonObject
  budgetLimitCents?: number | null
}

interface PreflightIssue extends JsonObject {
  level: 'warning' | 'blocked'
  code: string
  message: string
  nodeId?: string
}

interface ResourceRequirement extends JsonObject {
  resourceType: ResourceType
  resourceId: string
  nodeId: string
  reason: string
}

export async function runWorkflowPreflight(
  args: RunWorkflowPreflightArgs,
): Promise<WorkflowPreflightRow> {
  const workflow = await db.query.workflows.findFirst({
    where: eq(schema.workflows.id, args.workflowId),
  })
  if (!workflow) throw new Error(`Workflow not found: ${args.workflowId}`)

  const [nodes, edges] = await Promise.all([
    db.query.workflowNodes.findMany({
      where: eq(schema.workflowNodes.workflowId, args.workflowId),
      orderBy: [asc(schema.workflowNodes.createdAt)],
    }),
    db.query.workflowEdges.findMany({
      where: eq(schema.workflowEdges.workflowId, args.workflowId),
      orderBy: [asc(schema.workflowEdges.createdAt)],
    }),
  ])

  const issues: PreflightIssue[] = []
  const resourceRequirements: ResourceRequirement[] = []
  let agentCount = 0
  let softwareCommandCount = 0
  let approvalCount = 0
  let highRiskCount = 0

  validateGraph(nodes, edges, issues)

  for (const node of nodes) {
    if (node.type === 'agent_employee') {
      agentCount += 1
      await inspectAgentNode(node, issues, resourceRequirements)
      continue
    }

    if (node.type === 'human_approval') {
      approvalCount += 1
      issues.push({
        level: 'warning',
        code: 'human_approval_required',
        message: 'Workflow contains a human approval pause point.',
        nodeId: node.id,
      })
      continue
    }

    if (node.type === 'software_command') {
      softwareCommandCount += 1
      const commandRisk = await inspectSoftwareCommandNode(node, issues)
      if (commandRisk === 'high') highRiskCount += 1
    }
  }

  await inspectResourceConflicts(resourceRequirements, issues)

  const estimatedCostCents = estimateWorkflowCostCents({
    agentCount,
    softwareCommandCount,
    approvalCount,
    highRiskCount,
  })
  const estimatedDurationMs = estimateWorkflowDurationMs({
    agentCount,
    softwareCommandCount,
    approvalCount,
  })

  if (
    args.budgetLimitCents !== undefined &&
    args.budgetLimitCents !== null &&
    estimatedCostCents > args.budgetLimitCents
  ) {
    issues.push({
      level: 'blocked',
      code: 'budget_limit_exceeded',
      message: `Estimated workflow cost ${estimatedCostCents}c exceeds budget ${args.budgetLimitCents}c.`,
    })
  }

  const status = preflightStatusFromIssues(issues)
  const row = {
    id: newWorkflowPreflightId(),
    workflowId: workflow.id,
    status,
    input: args.input ?? {},
    budgetLimitCents: args.budgetLimitCents ?? null,
    nodeCount: nodes.length,
    edgeCount: edges.length,
    agentCount,
    softwareCommandCount,
    approvalCount,
    estimatedCostCents,
    estimatedDurationMs,
    resourceRequirements: dedupeResourceRequirements(resourceRequirements),
    issues,
    riskSummary: {
      highRiskCount,
      warningCount: issues.filter((issue) => issue.level === 'warning').length,
      blockedCount: issues.filter((issue) => issue.level === 'blocked').length,
      requiresApproval: approvalCount > 0 || highRiskCount > 0,
    },
    createdAt: Date.now(),
  }
  await db.insert(schema.workflowPreflights).values(row)
  return row
}

export async function listWorkflowPreflights(
  workflowId?: string,
): Promise<WorkflowPreflightRow[]> {
  return db.query.workflowPreflights.findMany({
    where: workflowId ? eq(schema.workflowPreflights.workflowId, workflowId) : undefined,
    orderBy: [desc(schema.workflowPreflights.createdAt)],
    limit: 100,
  })
}

async function inspectAgentNode(
  node: WorkflowNodeRow,
  issues: PreflightIssue[],
  resourceRequirements: ResourceRequirement[],
): Promise<void> {
  if (!node.agentProfileId) {
    issues.push({
      level: 'blocked',
      code: 'missing_agent_profile',
      message: 'Agent employee node requires agentProfileId.',
      nodeId: node.id,
    })
    return
  }

  const agent = await db.query.agentProfiles.findFirst({
    where: eq(schema.agentProfiles.id, node.agentProfileId),
  })
  if (!agent) {
    issues.push({
      level: 'blocked',
      code: 'agent_profile_not_found',
      message: `Agent profile not found: ${node.agentProfileId}.`,
      nodeId: node.id,
    })
    return
  }

  if (agent.status !== 'active') {
    issues.push({
      level: 'warning',
      code: 'agent_not_active',
      message: `Agent profile "${agent.name}" is ${agent.status}.`,
      nodeId: node.id,
    })
  }

  if (Object.keys(agent.outputContract ?? {}).length === 0) {
    issues.push({
      level: 'blocked',
      code: 'missing_output_contract',
      message: `Agent profile "${agent.name}" has no output contract.`,
      nodeId: node.id,
    })
  }

  if (!agent.modelProfileId) {
    issues.push({
      level: 'warning',
      code: 'missing_model_profile',
      message: `Agent profile "${agent.name}" has no primary model profile.`,
      nodeId: node.id,
    })
  }

  for (const requirement of requiredLocksForAgent(agent)) {
    resourceRequirements.push({
      ...requirement,
      nodeId: node.id,
      reason: `Agent "${agent.name}" may require ${requirement.resourceType}.`,
    })
  }
}

async function inspectSoftwareCommandNode(
  node: WorkflowNodeRow,
  issues: PreflightIssue[],
): Promise<'low' | 'medium' | 'high' | null> {
  const softwareCommandId = getString(node.config, 'softwareCommandId')
  if (!softwareCommandId) {
    issues.push({
      level: 'blocked',
      code: 'missing_software_command',
      message: 'Software command node requires config.softwareCommandId.',
      nodeId: node.id,
    })
    return null
  }

  const command = await db.query.softwareCommands.findFirst({
    where: eq(schema.softwareCommands.id, softwareCommandId),
  })
  if (!command) {
    issues.push({
      level: 'blocked',
      code: 'software_command_not_found',
      message: `Software command not found: ${softwareCommandId}.`,
      nodeId: node.id,
    })
    return null
  }

  if (command.requiresApproval || command.riskLevel === 'high') {
    issues.push({
      level: 'warning',
      code: 'software_command_requires_approval',
      message: `Software command "${command.name}" is ${command.riskLevel} risk or requires approval.`,
      nodeId: node.id,
    })
  }

  return command.riskLevel
}

async function inspectResourceConflicts(
  requirements: ResourceRequirement[],
  issues: PreflightIssue[],
): Promise<void> {
  const heldLocks = await db.query.resourceLocks.findMany({
    where: eq(schema.resourceLocks.status, 'held'),
  })
  for (const requirement of requirements) {
    const conflict = heldLocks.find(
      (lock) =>
        lock.resourceType === requirement.resourceType &&
        lock.resourceId === requirement.resourceId,
    )
    if (!conflict) continue
    issues.push({
      level: 'blocked',
      code: 'resource_lock_conflict',
      message: `${requirement.resourceType}:${requirement.resourceId} is already held by ${conflict.ownerRunId}.`,
      nodeId: requirement.nodeId,
    })
  }
}

function validateGraph(
  nodes: WorkflowNodeRow[],
  edges: WorkflowEdgeRow[],
  issues: PreflightIssue[],
): void {
  if (nodes.length === 0) {
    issues.push({
      level: 'blocked',
      code: 'empty_workflow',
      message: 'Workflow has no nodes.',
    })
    return
  }

  const nodeIds = new Set(nodes.map((node) => node.id))
  for (const edge of edges) {
    if (!nodeIds.has(edge.sourceNodeId) || !nodeIds.has(edge.targetNodeId)) {
      issues.push({
        level: 'blocked',
        code: 'dangling_edge',
        message: `Workflow edge ${edge.id} references a missing node.`,
      })
    }
  }

  if (hasCycle(nodes, edges)) {
    issues.push({
      level: 'warning',
      code: 'workflow_cycle',
      message: 'Workflow graph contains a cycle; execution will fall back to creation order.',
    })
  }
}

function hasCycle(nodes: WorkflowNodeRow[], edges: WorkflowEdgeRow[]): boolean {
  const nodeIds = new Set(nodes.map((node) => node.id))
  const indegree = new Map(nodes.map((node) => [node.id, 0]))
  const outgoing = new Map<string, string[]>()
  for (const edge of edges) {
    if (!nodeIds.has(edge.sourceNodeId) || !nodeIds.has(edge.targetNodeId)) continue
    outgoing.set(edge.sourceNodeId, [...(outgoing.get(edge.sourceNodeId) ?? []), edge.targetNodeId])
    indegree.set(edge.targetNodeId, (indegree.get(edge.targetNodeId) ?? 0) + 1)
  }
  const queue = nodes.filter((node) => (indegree.get(node.id) ?? 0) === 0).map((node) => node.id)
  let visited = 0
  while (queue.length > 0) {
    const id = queue.shift()
    if (!id) continue
    visited += 1
    for (const targetId of outgoing.get(id) ?? []) {
      const next = (indegree.get(targetId) ?? 0) - 1
      indegree.set(targetId, next)
      if (next === 0) queue.push(targetId)
    }
  }
  return visited < nodes.length
}

function requiredLocksForAgent(agent: AgentProfileRow): Array<{
  resourceType: ResourceType
  resourceId: string
}> {
  const locks: Array<{ resourceType: ResourceType; resourceId: string }> = [
    {
      resourceType: 'workspace_path',
      resourceId: `agent:${agent.id}:workspace`,
    },
  ]

  const workstationMode = getString(agent.workstationPolicy, 'mode')
  const canUseBrowser =
    getBooleanPath(agent.permissionPolicy, ['browser', 'operate']) ??
    getBooleanPath(agent.permissionPolicy, ['canUseBrowser'])
  const canUseDesktop =
    getBooleanPath(agent.permissionPolicy, ['desktop', 'operate']) ??
    getBooleanPath(agent.permissionPolicy, ['canUseDesktop'])

  if (workstationMode === 'browser_context' || canUseBrowser) {
    locks.push({
      resourceType: 'browser_profile',
      resourceId: `agent:${agent.id}:browser`,
    })
  }

  if (workstationMode === 'physical_desktop' || canUseDesktop) {
    locks.push({
      resourceType: 'physical_mouse_keyboard',
      resourceId: 'default',
    })
  }

  for (const softwareProfileId of agent.softwareProfileIds) {
    locks.push({
      resourceType: 'software_instance',
      resourceId: `software:${softwareProfileId}`,
    })
  }

  return dedupeResourceRequirements(locks)
}

function dedupeResourceRequirements<T extends { resourceType: ResourceType; resourceId: string }>(
  requirements: T[],
): T[] {
  const seen = new Set<string>()
  const unique: T[] = []
  for (const requirement of requirements) {
    const key = `${requirement.resourceType}:${requirement.resourceId}`
    if (seen.has(key)) continue
    seen.add(key)
    unique.push(requirement)
  }
  return unique
}

function estimateWorkflowCostCents(args: {
  agentCount: number
  softwareCommandCount: number
  approvalCount: number
  highRiskCount: number
}): number {
  return Math.max(1, args.agentCount * 6 + args.softwareCommandCount + args.approvalCount + args.highRiskCount)
}

function estimateWorkflowDurationMs(args: {
  agentCount: number
  softwareCommandCount: number
  approvalCount: number
}): number {
  return args.agentCount * 30000 + args.softwareCommandCount * 5000 + args.approvalCount * 60000
}

function preflightStatusFromIssues(issues: PreflightIssue[]): WorkflowPreflightStatus {
  if (issues.some((issue) => issue.level === 'blocked')) return 'blocked'
  if (issues.some((issue) => issue.level === 'warning')) return 'warning'
  return 'ok'
}

function getString(obj: JsonObject, key: string): string | null {
  const value = obj[key]
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function getBooleanPath(obj: JsonObject, path: string[]): boolean | null {
  let current: unknown = obj
  for (const key of path) {
    if (!current || typeof current !== 'object' || Array.isArray(current)) return null
    current = (current as Record<string, unknown>)[key]
  }
  return typeof current === 'boolean' ? current : null
}
