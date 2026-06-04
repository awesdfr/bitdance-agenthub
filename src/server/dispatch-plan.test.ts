import { describe, expect, it } from 'vitest'

import type { DispatchPlanItem } from '@/shared/types'

import {
  assertAcyclicDispatchPlan,
  parseDispatchPlanToolArgs,
  validateDispatchPlan,
} from './dispatch-plan'

const agents = [{ id: 'ag_pm' }, { id: 'ag_frontend' }, { id: 'ag_reviewer' }]

function task(
  id: string,
  agentId: string,
  dependsOn?: string[],
): DispatchPlanItem {
  const item: DispatchPlanItem = { id, agentId, task: `Do ${id}` }
  if (dependsOn) item.dependsOn = dependsOn
  return item
}

describe('parseDispatchPlanToolArgs', () => {
  it('parses valid plan_tasks args', () => {
    expect(
      parseDispatchPlanToolArgs({
        tasks: [
          { id: 't1', agentId: 'ag_pm', task: 'Write PRD' },
          { id: 't2', agentId: 'ag_frontend', task: 'Build UI', dependsOn: ['t1'] },
        ],
      }),
    ).toEqual([
      { id: 't1', agentId: 'ag_pm', task: 'Write PRD' },
      { id: 't2', agentId: 'ag_frontend', task: 'Build UI', dependsOn: ['t1'] },
    ])
  })

  it('rejects malformed tool args', () => {
    expect(() => parseDispatchPlanToolArgs(null)).toThrow('tasks array')
    expect(() => parseDispatchPlanToolArgs({ tasks: ['bad'] })).toThrow(
      'task at index 0 must be an object',
    )
    expect(() => parseDispatchPlanToolArgs({ tasks: [{ id: '', agentId: 'ag_pm', task: 'x' }] }))
      .toThrow('task at index 0 id must be a non-empty string')
    expect(() =>
      parseDispatchPlanToolArgs({ tasks: [{ id: 't1', agentId: 'ag_pm', task: 'x', dependsOn: 't0' }] }),
    ).toThrow('dependsOn must be an array')
    expect(() =>
      parseDispatchPlanToolArgs({ tasks: [{ id: 't1', agentId: 'ag_pm', task: 'x', dependsOn: [1] }] }),
    ).toThrow('dependsOn[0] must be a non-empty string')
  })
})

describe('validateDispatchPlan', () => {
  it('accepts a valid acyclic plan', () => {
    const plan = [
      task('t1', 'ag_pm'),
      task('t2', 'ag_frontend', ['t1']),
      task('t3', 'ag_reviewer', ['t2']),
    ]

    expect(() => validateDispatchPlan(plan, agents, 'ag_orchestrator')).not.toThrow()
  })

  it('rejects empty plans and duplicate task ids', () => {
    expect(() => validateDispatchPlan([], agents, 'ag_orchestrator')).toThrow(
      'tasks must not be empty',
    )
    expect(() =>
      validateDispatchPlan([task('t1', 'ag_pm'), task('t1', 'ag_frontend')], agents, 'ag_orchestrator'),
    ).toThrow('duplicate task id(s): t1')
  })

  it('rejects unavailable or recursive agent targets', () => {
    expect(() => validateDispatchPlan([task('t1', 'ag_orchestrator')], agents, 'ag_orchestrator'))
      .toThrow('dispatches to the orchestrator itself')
    expect(() => validateDispatchPlan([task('t1', 'ag_missing')], agents, 'ag_orchestrator'))
      .toThrow('references unavailable agentId "ag_missing"')
  })

  it('rejects invalid dependencies', () => {
    expect(() => validateDispatchPlan([task('t1', 'ag_pm', ['t1'])], agents, 'ag_orchestrator'))
      .toThrow('cannot depend on itself')
    expect(() => validateDispatchPlan([task('t1', 'ag_pm', ['t0'])], agents, 'ag_orchestrator'))
      .toThrow('depends on unknown task "t0"')
    expect(() =>
      validateDispatchPlan([task('t1', 'ag_pm'), task('t2', 'ag_frontend', ['t1', 't1'])], agents, 'ag_orchestrator'),
    ).toThrow('lists duplicate dependency "t1"')
  })

  it('rejects circular dependencies', () => {
    const plan = [task('t1', 'ag_pm', ['t2']), task('t2', 'ag_frontend', ['t1'])]

    expect(() => validateDispatchPlan(plan, agents, 'ag_orchestrator')).toThrow(
      'circular dependency t1 -> t2 -> t1',
    )
  })
})

describe('assertAcyclicDispatchPlan', () => {
  it('accepts linear DAGs', () => {
    expect(() =>
      assertAcyclicDispatchPlan([task('t1', 'ag_pm'), task('t2', 'ag_frontend', ['t1'])]),
    ).not.toThrow()
  })

  it('detects self and multi-node cycles', () => {
    expect(() => assertAcyclicDispatchPlan([task('t1', 'ag_pm', ['t1'])])).toThrow(
      'circular dependency t1 -> t1',
    )
    expect(() =>
      assertAcyclicDispatchPlan([task('t1', 'ag_pm', ['t2']), task('t2', 'ag_frontend', ['t1'])]),
    ).toThrow('circular dependency t1 -> t2 -> t1')
  })
})
