import { and, asc, eq, type SQL } from 'drizzle-orm'

import { db, schema } from '@/db/client'
import type {
  JsonObject,
  TestStrategyItemKind,
  TestStrategyItemRow,
  TestStrategyItemStatus,
} from '@/db/schema'
import { newTestStrategyItemId } from '@/server/ids'

interface DefaultTestStrategyItem {
  itemKey: string
  kind: TestStrategyItemKind
  title: string
  description: string
  expectedCoverage: string
  evidenceRefs: string[]
  status: TestStrategyItemStatus
}

export interface TestStrategyEvaluation {
  items: TestStrategyItemRow[]
  summary: {
    total: number
    covered: number
    recordOnly: number
    planned: number
    byKind: Record<TestStrategyItemKind, number>
    byStatus: Record<TestStrategyItemStatus, number>
    pyramid: JsonObject
    chaosPolicy: 'record_only'
  }
}

const defaultItems: DefaultTestStrategyItem[] = [
  item(
    'pyramid_unit',
    'pyramid_layer',
    'Unit tests',
    'Large base for service logic, state machines, serializers, and deterministic helpers.',
    'Vitest unit tests should cover pure services and protocol/state transitions.',
    ['src/server/control-plane-service.test.ts', 'src/server/dispatch-plan.test.ts'],
  ),
  item(
    'pyramid_integration',
    'pyramid_layer',
    'Integration tests',
    'Medium layer for Agent runtime, tools, memory, workflow, approvals, and persistence.',
    'Vitest integration tests run against a real temporary SQLite database.',
    ['src/server/control-plane-service.test.ts'],
  ),
  item(
    'pyramid_e2e',
    'pyramid_layer',
    'E2E tests',
    'Small top layer for complete workflow and UI flows.',
    'Playwright is configured for release-level browser flows while service tests keep most coverage local.',
    ['package.json:e2e', '@playwright/test'],
  ),
  ...[
    ['agent_runtime_simple_task', 'Agent runtime completes a simple task end-to-end.'],
    ['agent_runtime_pause_resume', 'Agent runtime can pause/resume through approvals and recovery state.'],
    ['agent_runtime_fallback_model', 'Model errors can be classified and recovered with fallback models.'],
    ['agent_runtime_high_risk_approval', 'High-risk operations request approval instead of executing silently.'],
    ['agent_runtime_budget_limit', 'Budget limits stop runs before uncontrolled spend.'],
    ['agent_runtime_context_overflow', 'Context packing handles overflow by truncating/omitting lower-value sections.'],
    ['agent_runtime_checkpoint', 'Runtime checkpoints are created and used for recovery summaries.'],
    ['agent_runtime_workspace_isolation', 'Agent workspaces and environments stay isolated.'],
  ].map(([key, description]) =>
    item(
      key,
      'integration_case',
      titleFromKey(key),
      description,
      'AgentEmployeeRuntime integration coverage from the Section 47 checklist.',
      ['src/server/control-plane-service.test.ts', 'src/server/employee-runtime-service.ts'],
    ),
  ),
  ...[
    ['resource_lock_desktop_conflict', 'Prevent two Agents from locking the same physical desktop.'],
    ['resource_lock_timeout_release', 'Release locks after timeout expiry.'],
    ['resource_lock_crash_release', 'Auto-release stale locks after crash-like stale ownership.'],
    ['resource_lock_wait_queue', 'Queue or fail waiting lock requests predictably.'],
  ].map(([key, description]) =>
    item(
      key,
      'integration_case',
      titleFromKey(key),
      description,
      'ResourceLockService integration coverage from the Section 47 checklist.',
      ['src/server/resource-lock-service.ts', 'src/server/control-plane-service.test.ts'],
    ),
  ),
  ...[
    ['memory_relevant_retrieval', 'Retrieve relevant memories by deterministic embedding/evidence.'],
    ['memory_scope_boundaries', 'Respect memory scope, role, team, project, and user boundaries.'],
    ['memory_decay_low_importance', 'Decay low-importance memories and expose cleanup actions.'],
    ['memory_pii_detection', 'Detect and flag PII before retention/export.'],
  ].map(([key, description]) =>
    item(
      key,
      'integration_case',
      titleFromKey(key),
      description,
      'MemoryService integration coverage from the Section 47 checklist.',
      ['src/server/agent-memory-service.ts', 'src/server/memory-decay-service.ts', 'src/server/data-lifecycle-service.ts'],
    ),
  ),
  item(
    'mock_model_deterministic_output',
    'mock_model_capability',
    'Mock model deterministic output',
    'Mock model responses are deterministic so tests do not call real providers.',
    'MockAdapter scripts provide repeatable streaming text/code/tool events.',
    ['src/server/adapters/mock-adapter.ts'],
  ),
  item(
    'mock_model_error_injection',
    'mock_model_capability',
    'Mock model error injection',
    'Model/tool/network errors can be injected through local classification and recovery services.',
    'Error recovery strategy tests avoid live provider failures.',
    ['src/server/error-recovery-strategy-service.ts', 'src/server/control-plane-service.test.ts'],
  ),
  item(
    'mock_model_call_recording',
    'mock_model_capability',
    'Mock model call recording',
    'Mock and deterministic runs record events, metrics, and audit evidence for assertions.',
    'Run event feeds and observability debug packages provide call/event evidence.',
    ['src/server/run-event-feed-service.ts', 'src/server/observability-service.ts'],
  ),
  chaos(
    'chaos_kill_agent_child_process',
    'Randomly kill Agent child process',
    'Use recovery/checkpoint/idempotency tests and record-only chaos plans before live process killing.',
    ['src/server/recovery-service.ts', 'docs/reference/final-acceptance.md'],
  ),
  chaos(
    'chaos_network_disconnect',
    'Randomly disconnect network',
    'Use degradation policy tests and record-only network chaos plans before mutating real connectivity.',
    ['src/server/degradation-service.ts'],
  ),
  chaos(
    'chaos_model_error',
    'Randomly return model errors',
    'Use error classification and fallback strategy tests instead of live provider chaos.',
    ['src/server/error-recovery-strategy-service.ts'],
  ),
  chaos(
    'chaos_disk_full',
    'Randomly fill disk',
    'Use system-bootstrap disk-space warnings and record-only disk chaos plans before destructive disk filling.',
    ['src/server/system-bootstrap-service.ts'],
  ),
]

export function getDefaultTestStrategyItemCount(): number {
  return defaultItems.length
}

export async function seedTestStrategyItems(): Promise<TestStrategyItemRow[]> {
  for (const definition of defaultItems) {
    const existing = await db.query.testStrategyItems.findFirst({
      where: eq(schema.testStrategyItems.itemKey, definition.itemKey),
    })
    if (existing) continue
    const now = Date.now()
    await db.insert(schema.testStrategyItems).values({
      id: newTestStrategyItemId(),
      itemKey: definition.itemKey,
      kind: definition.kind,
      title: definition.title,
      description: definition.description,
      expectedCoverage: definition.expectedCoverage,
      evidenceRefs: definition.evidenceRefs,
      status: definition.status,
      createdAt: now,
      updatedAt: now,
    })
  }
  return listTestStrategyItems({ limit: 200 })
}

export async function listTestStrategyItems(args: {
  kind?: TestStrategyItemKind
  status?: TestStrategyItemStatus
  limit?: number
} = {}): Promise<TestStrategyItemRow[]> {
  const filters: SQL[] = []
  if (args.kind) filters.push(eq(schema.testStrategyItems.kind, args.kind))
  if (args.status) filters.push(eq(schema.testStrategyItems.status, args.status))
  return db.query.testStrategyItems.findMany({
    where: filters.length ? and(...filters) : undefined,
    orderBy: [asc(schema.testStrategyItems.kind), asc(schema.testStrategyItems.itemKey)],
    limit: Math.min(Math.max(args.limit ?? 100, 1), 300),
  })
}

export async function evaluateTestStrategy(): Promise<TestStrategyEvaluation> {
  const items = await seedTestStrategyItems()
  return {
    items,
    summary: {
      total: items.length,
      covered: items.filter((row) => row.status === 'covered').length,
      recordOnly: items.filter((row) => row.status === 'record_only').length,
      planned: items.filter((row) => row.status === 'planned').length,
      byKind: countByKind(items),
      byStatus: countByStatus(items),
      pyramid: {
        unit: 'large',
        integration: 'medium',
        e2e: 'small',
        implementation: 'Vitest-heavy with Playwright E2E hooks and deterministic local services.',
      },
      chaosPolicy: 'record_only',
    },
  }
}

function item(
  itemKey: string,
  kind: Exclude<TestStrategyItemKind, 'chaos_case'>,
  title: string,
  description: string,
  expectedCoverage: string,
  evidenceRefs: string[],
): DefaultTestStrategyItem {
  return {
    itemKey,
    kind,
    title,
    description,
    expectedCoverage,
    evidenceRefs,
    status: 'covered',
  }
}

function chaos(
  itemKey: string,
  title: string,
  description: string,
  evidenceRefs: string[],
): DefaultTestStrategyItem {
  return {
    itemKey,
    kind: 'chaos_case',
    title,
    description,
    expectedCoverage: 'Record-only chaos plan; do not mutate live OS, network, child processes, or disk in v1 tests.',
    evidenceRefs,
    status: 'record_only',
  }
}

function countByKind(items: TestStrategyItemRow[]): Record<TestStrategyItemKind, number> {
  return {
    pyramid_layer: count(items, 'kind', 'pyramid_layer'),
    integration_case: count(items, 'kind', 'integration_case'),
    mock_model_capability: count(items, 'kind', 'mock_model_capability'),
    chaos_case: count(items, 'kind', 'chaos_case'),
  }
}

function countByStatus(items: TestStrategyItemRow[]): Record<TestStrategyItemStatus, number> {
  return {
    covered: count(items, 'status', 'covered'),
    record_only: count(items, 'status', 'record_only'),
    planned: count(items, 'status', 'planned'),
  }
}

function count<T extends keyof TestStrategyItemRow>(
  items: TestStrategyItemRow[],
  key: T,
  value: TestStrategyItemRow[T],
): number {
  return items.filter((item) => item[key] === value).length
}

function titleFromKey(key: string): string {
  return key
    .split('_')
    .map((part) => part[0]?.toUpperCase() + part.slice(1))
    .join(' ')
}
