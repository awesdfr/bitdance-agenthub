import { and, asc, desc, eq, inArray } from 'drizzle-orm'

import { db, schema } from '@/db/client'
import type {
  JsonObject,
  RiskLevel,
  WorkflowCostOptimization,
  WorkflowEdgeRow,
  WorkflowNodeRow,
  WorkflowOptimizationAnalysis,
  WorkflowOptimizationAppliedChange,
  WorkflowOptimizationAutoApply,
  WorkflowOptimizationBottleneck,
  WorkflowOptimizationRedundancy,
  WorkflowOptimizationRow,
  WorkflowParallelizationOpportunity,
} from '@/db/schema'
import { newWorkflowOptimizationId } from '@/server/ids'
import { recordAuditLog } from '@/server/security-service'

export interface AnalyzeWorkflowOptimizationArgs {
  workflowId: string
  autoApply?: WorkflowOptimizationAutoApply
}

const DEFAULT_AUTO_APPLY: WorkflowOptimizationAutoApply = {
  enabled: false,
  riskThreshold: 'low',
  requireApprovalFor: 'medium',
}

export async function analyzeWorkflowOptimization(
  args: AnalyzeWorkflowOptimizationArgs,
): Promise<WorkflowOptimizationRow> {
  const workflow = await db.query.workflows.findFirst({ where: eq(schema.workflows.id, args.workflowId) })
  if (!workflow) throw new Error(`Workflow not found: ${args.workflowId}`)
  const [nodes, edges, runs] = await Promise.all([
    db.query.workflowNodes.findMany({
      where: eq(schema.workflowNodes.workflowId, workflow.id),
      orderBy: [asc(schema.workflowNodes.createdAt)],
    }),
    db.query.workflowEdges.findMany({
      where: eq(schema.workflowEdges.workflowId, workflow.id),
      orderBy: [asc(schema.workflowEdges.createdAt)],
    }),
    db.query.workflowRuns.findMany({
      where: eq(schema.workflowRuns.workflowId, workflow.id),
      orderBy: [desc(schema.workflowRuns.startedAt)],
      limit: 200,
    }),
  ])
  const runIds = runs.map((run) => run.id)
  const nodeRuns = runIds.length
    ? await db.query.workflowNodeRuns.findMany({
        where: inArray(schema.workflowNodeRuns.workflowRunId, runIds),
        limit: 2000,
      })
    : []
  const durationsByNode = new Map<string, number[]>()
  for (const nodeRun of nodeRuns) {
    const duration = durationMs(nodeRun.startedAt, nodeRun.finishedAt)
    if (duration <= 0) continue
    durationsByNode.set(nodeRun.nodeId, [...(durationsByNode.get(nodeRun.nodeId) ?? []), duration])
  }
  const analysis: WorkflowOptimizationAnalysis = {
    bottlenecks: findBottlenecks(nodes, durationsByNode),
    redundancies: findRedundancies(nodes),
    parallelizationOpportunities: findParallelizationOpportunities(nodes, edges, durationsByNode),
    costOptimizations: findCostOptimizations(nodes),
  }
  const autoApply = { ...DEFAULT_AUTO_APPLY, ...(args.autoApply ?? {}) }
  const appliedChanges = autoApply.enabled
    ? buildAppliedChanges(analysis, autoApply.riskThreshold)
    : []
  const now = Date.now()
  const row: WorkflowOptimizationRow = {
    id: newWorkflowOptimizationId(),
    workflowId: workflow.id,
    runCount: runs.length,
    analysis,
    autoApply,
    appliedChanges,
    summary: summarizeAnalysis(analysis, appliedChanges),
    status: appliedChanges.length > 0 ? 'applied' : 'analyzed',
    createdAt: now,
    appliedAt: appliedChanges.length > 0 ? now : null,
  }
  await db.insert(schema.workflowOptimizations).values(row)
  await recordAuditLog({
    actorType: 'system',
    action: 'workflow_optimization.analyze',
    resourceType: 'workflow_optimization',
    resourceId: row.id,
    status: 'allowed',
    riskLevel: appliedChanges.some((change) => change.riskLevel === 'medium') ? 'medium' : 'low',
    message: row.summary,
    metadata: workflowOptimizationSnapshot(row),
  })
  return row
}

export async function applyWorkflowOptimization(
  optimizationId: string,
  riskThreshold: 'low' | 'medium' = 'low',
): Promise<WorkflowOptimizationRow> {
  const optimization = await getRequiredWorkflowOptimization(optimizationId)
  const appliedChanges = buildAppliedChanges(optimization.analysis, riskThreshold)
  const now = Date.now()
  await db
    .update(schema.workflowOptimizations)
    .set({
      status: appliedChanges.length > 0 ? 'applied' : 'analyzed',
      appliedChanges,
      appliedAt: appliedChanges.length > 0 ? now : null,
      summary: summarizeAnalysis(optimization.analysis, appliedChanges),
    })
    .where(eq(schema.workflowOptimizations.id, optimization.id))
  const updated = await getRequiredWorkflowOptimization(optimization.id)
  await recordAuditLog({
    actorType: 'system',
    action: 'workflow_optimization.apply',
    resourceType: 'workflow_optimization',
    resourceId: updated.id,
    status: 'allowed',
    riskLevel: riskThreshold,
    message: `Workflow optimization ${updated.id} applied ${appliedChanges.length} record-only change(s).`,
    metadata: workflowOptimizationSnapshot(updated),
  })
  return updated
}

export async function listWorkflowOptimizations(args: {
  workflowId?: string
  status?: WorkflowOptimizationRow['status']
  limit?: number
} = {}): Promise<WorkflowOptimizationRow[]> {
  const filters = [
    args.workflowId ? eq(schema.workflowOptimizations.workflowId, args.workflowId) : undefined,
    args.status ? eq(schema.workflowOptimizations.status, args.status) : undefined,
  ].filter(Boolean)
  return db.query.workflowOptimizations.findMany({
    where: filters.length > 0 ? and(...filters) : undefined,
    orderBy: [desc(schema.workflowOptimizations.createdAt)],
    limit: Math.min(Math.max(args.limit ?? 100, 1), 300),
  })
}

async function getRequiredWorkflowOptimization(id: string): Promise<WorkflowOptimizationRow> {
  const row = await db.query.workflowOptimizations.findFirst({
    where: eq(schema.workflowOptimizations.id, id),
  })
  if (!row) throw new Error(`Workflow optimization not found: ${id}`)
  return row
}

function findBottlenecks(
  nodes: WorkflowNodeRow[],
  durationsByNode: Map<string, number[]>,
): WorkflowOptimizationBottleneck[] {
  const avgByNode = new Map(nodes.map((node) => [node.id, average(durationsByNode.get(node.id) ?? [])]))
  const totalAvg = Array.from(avgByNode.values()).reduce((sum, value) => sum + value, 0) || 1
  return nodes
    .map((node) => {
      const avgDurationMs = Math.round(avgByNode.get(node.id) ?? 0)
      const percentOfTotalTime = Math.round((avgDurationMs / totalAvg) * 1000) / 10
      return {
        nodeId: node.id,
        avgDurationMs,
        avgDuration: formatDuration(avgDurationMs),
        percentOfTotalTime,
        suggestion:
          percentOfTotalTime >= 40
            ? 'Split this node, cache its context, or move independent work into parallel branches.'
            : 'Review node prompt/tool latency and reduce unnecessary steps.',
      }
    })
    .filter((item) => item.avgDurationMs > 0 && item.percentOfTotalTime >= 25)
    .sort((a, b) => b.percentOfTotalTime - a.percentOfTotalTime)
    .slice(0, 10)
}

function findRedundancies(nodes: WorkflowNodeRow[]): WorkflowOptimizationRedundancy[] {
  const groups = new Map<string, WorkflowNodeRow[]>()
  for (const node of nodes) {
    const key = [
      node.type,
      node.agentProfileId ?? '',
      JSON.stringify(node.outputContract ?? {}),
      readString(node.config, 'purpose') ?? readString(node.config, 'task') ?? '',
    ].join('|')
    groups.set(key, [...(groups.get(key) ?? []), node])
  }
  return Array.from(groups.values())
    .filter((group) => group.length > 1)
    .map((group) => ({
      nodes: group.map((node) => node.id),
      description: `Nodes ${group.map((node) => node.id).join(', ')} share the same type, Agent, and output contract.`,
      suggestion: 'Merge the duplicate validation/work step or reuse one node output downstream.',
    }))
}

function findParallelizationOpportunities(
  nodes: WorkflowNodeRow[],
  edges: WorkflowEdgeRow[],
  durationsByNode: Map<string, number[]>,
): WorkflowParallelizationOpportunity[] {
  const opportunities: WorkflowParallelizationOpportunity[] = []
  for (let i = 0; i < nodes.length; i += 1) {
    for (let j = i + 1; j < nodes.length; j += 1) {
      const left = nodes[i]
      const right = nodes[j]
      if (hasPath(left.id, right.id, edges) || hasPath(right.id, left.id, edges)) continue
      const savingMs = Math.round(
        Math.min(average(durationsByNode.get(left.id) ?? []), average(durationsByNode.get(right.id) ?? [])),
      )
      if (savingMs <= 0) continue
      opportunities.push({
        nodes: [left.id, right.id],
        reason: 'These nodes have no dependency path between them.',
        estimatedTimeSavingMs: savingMs,
        estimatedTimeSaving: formatDuration(savingMs),
      })
    }
  }
  return opportunities.sort((a, b) => b.estimatedTimeSavingMs - a.estimatedTimeSavingMs).slice(0, 10)
}

function findCostOptimizations(nodes: WorkflowNodeRow[]): WorkflowCostOptimization[] {
  return nodes
    .map((node) => {
      const currentCostCents =
        readNumber(node.config, 'estimatedCostCents') ??
        Math.round((readNumber(node.config, 'estimatedCost') ?? 0) * 100)
      return {
        nodeId: node.id,
        currentCostCents,
        currentCost: currentCostCents / 100,
        suggestedChange:
          node.type === 'agent_employee'
            ? 'Switch this node to a cheaper model profile or lower autonomy for routine work.'
            : 'Replace this command with a cheaper cached/preflighted variant.',
        estimatedSavingCents: Math.round(currentCostCents * 0.3),
        estimatedSaving: Math.round(currentCostCents * 0.3) / 100,
      }
    })
    .filter((item) => item.currentCostCents >= 100 && item.estimatedSavingCents > 0)
    .sort((a, b) => b.estimatedSavingCents - a.estimatedSavingCents)
}

function buildAppliedChanges(
  analysis: WorkflowOptimizationAnalysis,
  riskThreshold: 'low' | 'medium',
): WorkflowOptimizationAppliedChange[] {
  const changes: WorkflowOptimizationAppliedChange[] = [
    ...analysis.costOptimizations.map((item) => ({
      kind: 'cost_optimization' as const,
      riskLevel: 'low' as RiskLevel,
      description: item.suggestedChange,
      nodeIds: [item.nodeId],
      applied: true,
    })),
  ]
  if (riskThreshold === 'medium') {
    changes.push(
      ...analysis.parallelizationOpportunities.map((item) => ({
        kind: 'parallelization' as const,
        riskLevel: 'medium' as RiskLevel,
        description: item.reason,
        nodeIds: item.nodes,
        applied: true,
      })),
    )
  }
  return changes
}

function summarizeAnalysis(
  analysis: WorkflowOptimizationAnalysis,
  appliedChanges: WorkflowOptimizationAppliedChange[],
): string {
  return [
    `${analysis.bottlenecks.length} bottleneck(s)`,
    `${analysis.redundancies.length} redundanc${analysis.redundancies.length === 1 ? 'y' : 'ies'}`,
    `${analysis.parallelizationOpportunities.length} parallel opportunity(s)`,
    `${analysis.costOptimizations.length} cost optimization(s)`,
    `${appliedChanges.length} applied record-only change(s)`,
  ].join('; ')
}

function hasPath(sourceNodeId: string, targetNodeId: string, edges: WorkflowEdgeRow[]): boolean {
  const outgoing = new Map<string, string[]>()
  for (const edge of edges) {
    outgoing.set(edge.sourceNodeId, [...(outgoing.get(edge.sourceNodeId) ?? []), edge.targetNodeId])
  }
  const seen = new Set<string>()
  const queue = [sourceNodeId]
  while (queue.length) {
    const current = queue.shift()
    if (!current || seen.has(current)) continue
    if (current === targetNodeId) return true
    seen.add(current)
    queue.push(...(outgoing.get(current) ?? []))
  }
  return false
}

function durationMs(startedAt: number, finishedAt: number | null): number {
  return finishedAt && finishedAt > startedAt ? finishedAt - startedAt : 0
}

function average(values: number[]): number {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0
}

function formatDuration(ms: number): string {
  if (ms >= 60000) return `${Math.round((ms / 60000) * 10) / 10}min`
  if (ms >= 1000) return `${Math.round((ms / 1000) * 10) / 10}s`
  return `${ms}ms`
}

function readNumber(value: JsonObject, key: string): number | null {
  const raw = value[key]
  return typeof raw === 'number' && Number.isFinite(raw) ? raw : null
}

function readString(value: JsonObject, key: string): string | null {
  const raw = value[key]
  return typeof raw === 'string' && raw.trim() ? raw.trim() : null
}

function workflowOptimizationSnapshot(row: WorkflowOptimizationRow): JsonObject {
  return {
    workflowId: row.workflowId,
    runCount: row.runCount,
    status: row.status,
    bottlenecks: row.analysis.bottlenecks.length,
    redundancies: row.analysis.redundancies.length,
    parallelizationOpportunities: row.analysis.parallelizationOpportunities.length,
    costOptimizations: row.analysis.costOptimizations.length,
    appliedChanges: row.appliedChanges.length,
  }
}
