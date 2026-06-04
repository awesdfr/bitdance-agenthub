import type { DispatchPlanItem } from '@/shared/types'

/**
 * Orchestrator 派发计划的解析 + 校验 + 环检测。
 *
 * 从 agent-runner 抽出为纯模块（只 type-only 依赖，不牵入 DB / native），便于单测。
 * agent-runner 反向 import `parseDispatchPlanToolArgs` / `validateDispatchPlan`；
 * 真正的执行调度（executeDag，有副作用）仍留在 agent-runner。
 */

export function parseDispatchPlanToolArgs(args: unknown): DispatchPlanItem[] {
  if (!isRecord(args) || !Array.isArray(args.tasks)) {
    throw new Error('Invalid dispatch plan: plan_tasks args must include a tasks array')
  }

  return args.tasks.map((raw, index) => {
    if (!isRecord(raw)) {
      throw new Error(`Invalid dispatch plan: task at index ${index} must be an object`)
    }
    const id = readNonEmptyString(raw.id, `task at index ${index} id`)
    const agentId = readNonEmptyString(raw.agentId, `task "${id}" agentId`)
    const task = readNonEmptyString(raw.task, `task "${id}" instruction`)

    let dependsOn: string[] | undefined
    if (raw.dependsOn !== undefined) {
      if (!Array.isArray(raw.dependsOn)) {
        throw new Error(`Invalid dispatch plan: task "${id}" dependsOn must be an array`)
      }
      dependsOn = raw.dependsOn.map((dep, depIndex) =>
        readNonEmptyString(dep, `task "${id}" dependsOn[${depIndex}]`),
      )
    }

    const item: DispatchPlanItem = { id, agentId, task }
    if (dependsOn && dependsOn.length > 0) item.dependsOn = dependsOn
    return item
  })
}

export function validateDispatchPlan(
  plan: DispatchPlanItem[],
  availableAgents: readonly { id: string }[],
  orchestratorAgentId: string,
): void {
  if (plan.length === 0) {
    throw new Error('Invalid dispatch plan: tasks must not be empty')
  }

  const availableAgentIds = new Set(availableAgents.map((a) => a.id))
  const taskIds = new Set<string>()
  const duplicateTaskIds = new Set<string>()

  for (const task of plan) {
    if (taskIds.has(task.id)) duplicateTaskIds.add(task.id)
    taskIds.add(task.id)
  }
  if (duplicateTaskIds.size > 0) {
    throw new Error(
      `Invalid dispatch plan: duplicate task id(s): ${[...duplicateTaskIds].join(', ')}`,
    )
  }

  for (const task of plan) {
    if (task.agentId === orchestratorAgentId) {
      throw new Error(
        `Invalid dispatch plan: task "${task.id}" dispatches to the orchestrator itself, which would recurse`,
      )
    }
    if (!availableAgentIds.has(task.agentId)) {
      throw new Error(
        `Invalid dispatch plan: task "${task.id}" references unavailable agentId "${task.agentId}"`,
      )
    }

    const depIds = new Set<string>()
    for (const dep of task.dependsOn ?? []) {
      if (dep === task.id) {
        throw new Error(`Invalid dispatch plan: task "${task.id}" cannot depend on itself`)
      }
      if (depIds.has(dep)) {
        throw new Error(
          `Invalid dispatch plan: task "${task.id}" lists duplicate dependency "${dep}"`,
        )
      }
      depIds.add(dep)
      if (!taskIds.has(dep)) {
        throw new Error(
          `Invalid dispatch plan: task "${task.id}" depends on unknown task "${dep}"`,
        )
      }
    }
  }

  assertAcyclicDispatchPlan(plan)
}

export function assertAcyclicDispatchPlan(plan: DispatchPlanItem[]): void {
  const byId = new Map(plan.map((task) => [task.id, task]))
  const visiting = new Set<string>()
  const visited = new Set<string>()
  const stack: string[] = []

  const visit = (taskId: string) => {
    if (visited.has(taskId)) return
    if (visiting.has(taskId)) {
      const cycleStart = stack.indexOf(taskId)
      const cycle = [...stack.slice(cycleStart), taskId]
      throw new Error(`Invalid dispatch plan: circular dependency ${cycle.join(' -> ')}`)
    }

    const task = byId.get(taskId)
    if (!task) return

    visiting.add(taskId)
    stack.push(taskId)
    for (const dep of task.dependsOn ?? []) visit(dep)
    stack.pop()
    visiting.delete(taskId)
    visited.add(taskId)
  }

  for (const task of plan) visit(task.id)
}

function readNonEmptyString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`Invalid dispatch plan: ${label} must be a non-empty string`)
  }
  return value
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
