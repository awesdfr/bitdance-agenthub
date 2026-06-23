import { asc, desc, eq } from 'drizzle-orm'

import { db, schema } from '@/db/client'
import type {
  BenchmarkCaseResultRow,
  BenchmarkCaseRow,
  BenchmarkDimension,
  BenchmarkRegressionStatus,
  BenchmarkRunRow,
  BenchmarkSuiteRow,
  JsonObject,
} from '@/db/schema'
import {
  newBenchmarkCaseId,
  newBenchmarkCaseResultId,
  newBenchmarkRunId,
  newBenchmarkSuiteId,
} from '@/server/ids'

const DEFAULT_SUITE_NAME = 'Agent Employee Benchmark Suite'
const dimensions: BenchmarkDimension[] = [
  'accuracy',
  'efficiency',
  'robustness',
  'safety',
  'consistency',
]

interface DefaultBenchmarkCase {
  dimension: BenchmarkDimension
  name: string
  input: JsonObject
  expectedOutput: JsonObject
  validationFn: string
  maxBudgetCents: number
  maxSteps: number
  tags: string[]
}

const defaultCases: DefaultBenchmarkCase[] = dimensions.flatMap((dimension) => [
  {
    dimension,
    name: `${dimension}-case-1`,
    input: { task: `${dimension} primary task`, difficulty: 'normal' },
    expectedOutput: { status: 'complete', dimension },
    validationFn: `${dimension}.validation.primary`,
    maxBudgetCents: dimension === 'efficiency' ? 3 : 8,
    maxSteps: dimension === 'efficiency' ? 3 : 6,
    tags: [dimension, 'ci', 'default'],
  },
  {
    dimension,
    name: `${dimension}-case-2`,
    input: { task: `${dimension} edge task`, difficulty: 'edge' },
    expectedOutput: { status: 'complete', dimension, edgeHandled: true },
    validationFn: `${dimension}.validation.edge`,
    maxBudgetCents: dimension === 'safety' ? 10 : 6,
    maxSteps: dimension === 'robustness' ? 8 : 5,
    tags: [dimension, 'regression'],
  },
  {
    dimension,
    name: `${dimension}-case-3`,
    input: { task: `${dimension} repeat task`, difficulty: 'repeat' },
    expectedOutput: { status: 'complete', dimension, stable: true },
    validationFn: `${dimension}.validation.repeatable`,
    maxBudgetCents: 7,
    maxSteps: 6,
    tags: [dimension, 'drift-check'],
  },
])

export function getDefaultBenchmarkCaseCount(): number {
  return defaultCases.length
}

export async function seedBenchmarkSuite(): Promise<{
  suite: BenchmarkSuiteRow
  cases: BenchmarkCaseRow[]
}> {
  const now = Date.now()
  let suite = await db.query.benchmarkSuites.findFirst({
    where: eq(schema.benchmarkSuites.name, DEFAULT_SUITE_NAME),
  })
  if (!suite) {
    suite = {
      id: newBenchmarkSuiteId(),
      name: DEFAULT_SUITE_NAME,
      description: 'Default local benchmark suite for Agent accuracy, efficiency, robustness, safety, and consistency.',
      schedule: 'nightly_or_ci',
      ciEnabled: true,
      createdAt: now,
      updatedAt: now,
    }
    await db.insert(schema.benchmarkSuites).values(suite)
  }
  for (const item of defaultCases) {
    const existing = await db.query.benchmarkCases.findFirst({
      where: eq(schema.benchmarkCases.name, item.name),
    })
    if (existing) continue
    await db.insert(schema.benchmarkCases).values({
      id: newBenchmarkCaseId(),
      suiteId: suite.id,
      dimension: item.dimension,
      name: item.name,
      input: item.input,
      expectedOutput: item.expectedOutput,
      validationFn: item.validationFn,
      maxBudgetCents: item.maxBudgetCents,
      maxSteps: item.maxSteps,
      tags: item.tags,
      createdAt: now,
      updatedAt: now,
    })
  }
  return {
    suite,
    cases: await listBenchmarkCases({ suiteId: suite.id }),
  }
}

export async function listBenchmarkSuites(): Promise<BenchmarkSuiteRow[]> {
  return db.query.benchmarkSuites.findMany({
    orderBy: [asc(schema.benchmarkSuites.name)],
    limit: 50,
  })
}

export async function listBenchmarkCases(args: {
  suiteId?: string
  dimension?: BenchmarkDimension
} = {}): Promise<BenchmarkCaseRow[]> {
  const cases = await db.query.benchmarkCases.findMany({
    where: args.suiteId ? eq(schema.benchmarkCases.suiteId, args.suiteId) : undefined,
    orderBy: [asc(schema.benchmarkCases.dimension), asc(schema.benchmarkCases.name)],
    limit: 100,
  })
  return args.dimension ? cases.filter((item) => item.dimension === args.dimension) : cases
}

export async function listBenchmarkRuns(): Promise<BenchmarkRunRow[]> {
  return db.query.benchmarkRuns.findMany({
    orderBy: [desc(schema.benchmarkRuns.createdAt)],
    limit: 50,
  })
}

export async function listBenchmarkCaseResults(args: {
  runId?: string
} = {}): Promise<BenchmarkCaseResultRow[]> {
  const rows = await db.query.benchmarkCaseResults.findMany({
    where: args.runId ? eq(schema.benchmarkCaseResults.runId, args.runId) : undefined,
    orderBy: [asc(schema.benchmarkCaseResults.modelProfileId)],
    limit: 500,
  })
  return rows
}

export async function runBenchmarkSuite(args: {
  suiteId?: string | null
  modelProfileIds?: string[]
  promptVersion?: string
  baselinePromptVersion?: string
  ciMode?: boolean
} = {}): Promise<{
  run: BenchmarkRunRow
  results: BenchmarkCaseResultRow[]
}> {
  const seeded = args.suiteId ? null : await seedBenchmarkSuite()
  const suiteId = args.suiteId ?? seeded?.suite.id
  if (!suiteId) throw new Error('Benchmark suite id is required.')
  const suite = await db.query.benchmarkSuites.findFirst({
    where: eq(schema.benchmarkSuites.id, suiteId),
  })
  if (!suite) throw new Error(`Benchmark suite not found: ${suiteId}`)
  const cases = await listBenchmarkCases({ suiteId })
  if (cases.length === 0) throw new Error(`Benchmark suite has no cases: ${suiteId}`)

  const modelProfileIds = args.modelProfileIds?.length ? args.modelProfileIds : ['default-model']
  const promptVersion = args.promptVersion ?? 'baseline'
  const baselinePromptVersion = args.baselinePromptVersion ?? 'baseline'
  const promptDriftDetected = promptVersion !== baselinePromptVersion
  const now = Date.now()
  const runId = newBenchmarkRunId()
  const results = cases.flatMap((benchmarkCase) =>
    modelProfileIds.map((modelProfileId) =>
      evaluateCase({
        runId,
        benchmarkCase,
        modelProfileId,
        promptDriftDetected,
        now,
      }),
    ),
  )
  const summary = buildRunSummary({ cases, results, modelProfileIds, promptDriftDetected })
  const ciRegressionStatus = deriveCiStatus(results, promptDriftDetected, args.ciMode ?? true)
  const run: BenchmarkRunRow = {
    id: runId,
    suiteId,
    promptVersion,
    baselinePromptVersion,
    modelProfileIds,
    status: 'completed',
    promptDriftDetected,
    ciRegressionStatus,
    summary,
    createdAt: now,
    completedAt: now,
  }
  await db.insert(schema.benchmarkRuns).values(run)
  await db.insert(schema.benchmarkCaseResults).values(results)
  return { run, results }
}

function evaluateCase(args: {
  runId: string
  benchmarkCase: BenchmarkCaseRow
  modelProfileId: string
  promptDriftDetected: boolean
  now: number
}): BenchmarkCaseResultRow {
  const score = scoreFor(args.modelProfileId, args.benchmarkCase.dimension, args.promptDriftDetected)
  const budgetCents = Math.max(1, Math.floor(args.benchmarkCase.maxBudgetCents * (score > 0.9 ? 0.55 : 0.8)))
  const steps = Math.max(1, Math.floor(args.benchmarkCase.maxSteps * (score > 0.9 ? 0.55 : 0.8)))
  const passed = score >= 0.75 && budgetCents <= args.benchmarkCase.maxBudgetCents && steps <= args.benchmarkCase.maxSteps
  return {
    id: newBenchmarkCaseResultId(),
    runId: args.runId,
    caseId: args.benchmarkCase.id,
    modelProfileId: args.modelProfileId,
    passed,
    score,
    budgetCents,
    steps,
    observedOutput: {
      status: passed ? 'complete' : 'failed',
      dimension: args.benchmarkCase.dimension,
      validationFn: args.benchmarkCase.validationFn,
      deterministic: true,
    },
    createdAt: args.now,
  }
}

function scoreFor(modelProfileId: string, dimension: BenchmarkDimension, drift: boolean): number {
  const model = modelProfileId.toLowerCase()
  let score = 0.91
  if (model.includes('weak')) score = 0.68
  if (model.includes('fast') && dimension === 'efficiency') score = 0.97
  if (model.includes('safe') && dimension === 'safety') score = 0.98
  if (model.includes('robust') && dimension === 'robustness') score = 0.97
  if (drift) score -= 0.04
  return Math.max(0, Number(score.toFixed(2)))
}

function buildRunSummary(args: {
  cases: BenchmarkCaseRow[]
  results: BenchmarkCaseResultRow[]
  modelProfileIds: string[]
  promptDriftDetected: boolean
}): JsonObject {
  const byDimension: JsonObject = {}
  for (const dimension of dimensions) {
    const caseIds = new Set(args.cases.filter((item) => item.dimension === dimension).map((item) => item.id))
    const results = args.results.filter((result) => caseIds.has(result.caseId))
    byDimension[dimension] = summarizeResults(results)
  }
  return {
    dimensions: byDimension,
    modelComparison: args.modelProfileIds.map((modelProfileId) => ({
      modelProfileId,
      ...summarizeResults(args.results.filter((result) => result.modelProfileId === modelProfileId)),
    })),
    promptDriftDetected: args.promptDriftDetected,
    caseCount: args.cases.length,
    resultCount: args.results.length,
  }
}

function summarizeResults(results: BenchmarkCaseResultRow[]): JsonObject {
  const passed = results.filter((result) => result.passed).length
  const averageScore = results.length
    ? Number((results.reduce((sum, result) => sum + result.score, 0) / results.length).toFixed(3))
    : 0
  return {
    total: results.length,
    passed,
    passRate: results.length ? Number((passed / results.length).toFixed(3)) : 0,
    averageScore,
  }
}

function deriveCiStatus(
  results: BenchmarkCaseResultRow[],
  promptDriftDetected: boolean,
  ciMode: boolean,
): BenchmarkRegressionStatus {
  if (!ciMode) return 'passed'
  if (results.some((result) => !result.passed)) return 'failed'
  return promptDriftDetected ? 'warn' : 'passed'
}
