import { and, desc, eq, type SQL } from 'drizzle-orm'

import { db, schema } from '@/db/client'
import type {
  JsonObject,
  NfrCategory,
  NfrEvaluationRow,
  NfrEvaluationStatus,
  NfrMetricOperator,
  NfrRequirementRow,
  NfrRequirementStatus,
} from '@/db/schema'
import { newNfrEvaluationId, newNfrRequirementId } from '@/server/ids'

export interface NfrRequirementDefinition {
  requirementKey: string
  category: NfrCategory
  title: string
  target: string
  metricName: string
  operator: NfrMetricOperator
  targetValue: unknown
  severity: 'low' | 'medium' | 'high' | 'critical'
  evidenceRefs: string[]
}

export interface EvaluateNfrRequirementsArgs {
  observed?: JsonObject
}

const definitions: NfrRequirementDefinition[] = [
  req('reliability_24x7_no_leak', 'reliability', '7x24 continuous running', 'Memory and handles do not leak during continuous operation.', 'reliability.memoryGrowthPercent24h', 'lte', 5, 'critical', ['observability metrics', 'soak test']),
  req('single_agent_8h_stability', 'reliability', 'Single Agent 8 hour stability', 'One Agent task can run for 8 hours without crashing.', 'reliability.singleAgentHoursWithoutCrash', 'gte', 8, 'high', ['runtime checkpoints', 'long-run test']),
  req('model_1000_calls_memory_growth', 'reliability', '1000 model calls memory growth', '1000 model calls grow memory by less than 5%.', 'reliability.modelCallMemoryGrowthPercent', 'lte', 5, 'high', ['model gateway metrics']),
  req('ui_response_under_200ms', 'usability', 'UI response latency', 'Interactive UI operations respond within 200ms.', 'usability.uiResponseMsP95', 'lte', 200, 'high', ['frontend performance trace']),
  req('agent_status_update_under_500ms', 'usability', 'Agent status update latency', 'Agent status updates appear within 500ms.', 'usability.agentStatusUpdateMsP95', 'lte', 500, 'high', ['run event feed']),
  req('actionable_errors_no_stack_trace', 'usability', 'Actionable user errors', 'User-facing errors are actionable and do not show stack traces unless advanced mode is enabled.', 'usability.stackTraceShownToNormalUsers', 'eq', false, 'high', ['error boundary review']),
  req('windows_10_21h2_plus', 'compatibility', 'Windows 10 21H2 plus', 'Desktop app supports Windows 10 21H2+ and Windows 11.', 'compatibility.windows10_21h2Plus', 'eq', true, 'critical', ['packaging matrix']),
  req('macos_13_plus', 'compatibility', 'macOS 13 plus', 'Core product supports macOS 13+ where desktop automation is not required.', 'compatibility.macos13Plus', 'eq', true, 'medium', ['platform matrix']),
  req('minimum_ram_8gb', 'compatibility', 'Minimum 8GB RAM', 'The product can start on machines with at least 8GB RAM.', 'compatibility.minRamGb', 'gte', 8, 'high', ['system bootstrap']),
  req('minimum_disk_2gb', 'compatibility', 'Minimum 2GB disk', 'The product warns before available disk drops below 2GB.', 'compatibility.minFreeDiskGb', 'gte', 2, 'high', ['resource governor']),
  req('secret_minimal_residency', 'security', 'Minimal secret residency', 'Secrets are referenced by env/vault refs and minimized in process memory.', 'security.secretResidencyMinimized', 'eq', true, 'critical', ['secret vault']),
  req('memory_dump_no_plaintext_secrets', 'security', 'Memory dump secret redaction', 'Memory dumps should not contain plaintext secrets.', 'security.memoryDumpPlaintextSecrets', 'eq', false, 'critical', ['security audit']),
  req('core_dump_no_plaintext_secrets', 'security', 'Core dump secret redaction', 'Crash dumps should not contain plaintext secrets.', 'security.coreDumpPlaintextSecrets', 'eq', false, 'critical', ['security audit']),
  req('dependency_security_scan', 'security', 'Dependency security scan', 'Third-party dependencies are scanned regularly.', 'security.dependencyScanFreshDays', 'lte', 7, 'high', ['security checklist']),
  req('service_unit_tests', 'maintainability', 'Service unit tests', 'All core service interfaces have tests.', 'maintainability.serviceUnitTestCoveragePercent', 'gte', 80, 'high', ['test suite']),
  req('critical_path_integration_tests', 'maintainability', 'Critical path integration tests', 'Critical runtime, workflow, memory, approval, and tool paths have integration tests.', 'maintainability.criticalPathIntegrationCoverage', 'eq', true, 'critical', ['control-plane tests']),
  req('no_swallowed_exceptions', 'maintainability', 'No swallowed exceptions', 'Error handling avoids swallowed exceptions on critical paths.', 'maintainability.swallowedExceptionFindings', 'lte', 0, 'high', ['lint/static review']),
  req('module_readmes', 'maintainability', 'Module documentation', 'Each major module has a README or reference page.', 'maintainability.moduleReadmeCoveragePercent', 'gte', 80, 'medium', ['docs/reference']),
]

export async function seedNfrRequirements(): Promise<NfrRequirementRow[]> {
  const rows: NfrRequirementRow[] = []
  for (const definition of definitions) {
    const existing = await db.query.nfrRequirements.findFirst({
      where: eq(schema.nfrRequirements.requirementKey, definition.requirementKey),
    })
    if (existing) {
      rows.push(existing)
      continue
    }
    const now = Date.now()
    const row = {
      id: newNfrRequirementId(),
      ...definition,
      status: 'active' as const,
      createdAt: now,
      updatedAt: now,
    }
    await db.insert(schema.nfrRequirements).values(row)
    rows.push(row)
  }
  return rows
}

export async function listNfrRequirements(args: {
  category?: NfrCategory
  status?: NfrRequirementStatus
  limit?: number
} = {}): Promise<NfrRequirementRow[]> {
  const filters: SQL[] = []
  if (args.category) filters.push(eq(schema.nfrRequirements.category, args.category))
  if (args.status) filters.push(eq(schema.nfrRequirements.status, args.status))
  return db.query.nfrRequirements.findMany({
    where: filters.length ? and(...filters) : undefined,
    orderBy: [desc(schema.nfrRequirements.updatedAt)],
    limit: Math.min(Math.max(args.limit ?? 100, 1), 300),
  })
}

export async function evaluateNfrRequirements(
  args: EvaluateNfrRequirementsArgs = {},
): Promise<{
  evaluations: NfrEvaluationRow[]
  summary: { passed: number; failed: number; warnings: number; unknown: number; total: number }
}> {
  const requirements = await seedNfrRequirements()
  const evaluations: NfrEvaluationRow[] = []
  for (const requirement of requirements) {
    const observedValue = readPath(args.observed ?? {}, requirement.metricName)
    const status = evaluateRequirement(requirement, observedValue)
    const row = {
      id: newNfrEvaluationId(),
      requirementId: requirement.id,
      status,
      observedValue: observedValue ?? null,
      details: {
        requirementKey: requirement.requirementKey,
        category: requirement.category,
        metricName: requirement.metricName,
        operator: requirement.operator,
        targetValue: requirement.targetValue,
        evidenceRefs: requirement.evidenceRefs,
      },
      createdAt: Date.now(),
    }
    await db.insert(schema.nfrEvaluations).values(row)
    evaluations.push(row)
  }
  return {
    evaluations,
    summary: {
      passed: evaluations.filter((row) => row.status === 'passed').length,
      failed: evaluations.filter((row) => row.status === 'failed').length,
      warnings: evaluations.filter((row) => row.status === 'warning').length,
      unknown: evaluations.filter((row) => row.status === 'unknown').length,
      total: evaluations.length,
    },
  }
}

export async function listNfrEvaluations(args: {
  status?: NfrEvaluationStatus
  requirementId?: string
  limit?: number
} = {}): Promise<NfrEvaluationRow[]> {
  const filters: SQL[] = []
  if (args.status) filters.push(eq(schema.nfrEvaluations.status, args.status))
  if (args.requirementId) filters.push(eq(schema.nfrEvaluations.requirementId, args.requirementId))
  return db.query.nfrEvaluations.findMany({
    where: filters.length ? and(...filters) : undefined,
    orderBy: [desc(schema.nfrEvaluations.createdAt)],
    limit: Math.min(Math.max(args.limit ?? 100, 1), 300),
  })
}

function req(
  requirementKey: string,
  category: NfrCategory,
  title: string,
  target: string,
  metricName: string,
  operator: NfrMetricOperator,
  targetValue: unknown,
  severity: NfrRequirementDefinition['severity'],
  evidenceRefs: string[],
): NfrRequirementDefinition {
  return { requirementKey, category, title, target, metricName, operator, targetValue, severity, evidenceRefs }
}

function evaluateRequirement(requirement: NfrRequirementRow, observedValue: unknown): NfrEvaluationStatus {
  if (observedValue === undefined || observedValue === null) return 'unknown'
  const target = requirement.targetValue
  if (requirement.operator === 'exists') return observedValue ? 'passed' : 'failed'
  if (requirement.operator === 'eq') return observedValue === target ? 'passed' : 'failed'
  if (requirement.operator === 'contains') {
    return Array.isArray(observedValue) && observedValue.includes(target) ? 'passed' : 'failed'
  }
  if (typeof observedValue !== 'number' || typeof target !== 'number') return 'unknown'
  if (requirement.operator === 'lte') return observedValue <= target ? 'passed' : 'failed'
  if (requirement.operator === 'gte') return observedValue >= target ? 'passed' : 'failed'
  return 'unknown'
}

function readPath(obj: JsonObject, path: string): unknown {
  return path.split('.').reduce<unknown>((current, key) => {
    if (!current || typeof current !== 'object' || Array.isArray(current)) return undefined
    return (current as Record<string, unknown>)[key]
  }, obj)
}
