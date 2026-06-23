import { and, asc, desc, eq, type SQL } from 'drizzle-orm'

import { db, schema } from '@/db/client'
import type {
  SuccessMetricCategory,
  SuccessMetricDefinitionRow,
  SuccessMetricSnapshotRow,
  SuccessMetricSnapshotStatus,
  SuccessMetricTargetOperator,
} from '@/db/schema'
import { newSuccessMetricDefinitionId, newSuccessMetricSnapshotId } from '@/server/ids'

interface DefaultSuccessMetric {
  metricKey: string
  category: SuccessMetricCategory
  name: string
  targetOperator: SuccessMetricTargetOperator
  targetValue: number | null
  unit: string
  description: string
}

const defaultMetrics: DefaultSuccessMetric[] = [
  { metricKey: 'mau', category: 'product', name: 'MAU', targetOperator: 'track', targetValue: null, unit: 'users', description: 'Monthly active users.' },
  { metricKey: 'weekly_retention', category: 'product', name: 'Weekly retention', targetOperator: 'gte', targetValue: 40, unit: 'percent', description: 'Weekly retention should be above 40%.' },
  { metricKey: 'agents_per_user', category: 'product', name: 'Agents per user', targetOperator: 'track', targetValue: null, unit: 'count', description: 'Average Agent count per user.' },
  { metricKey: 'daily_tasks_per_user', category: 'product', name: 'Daily tasks per user', targetOperator: 'track', targetValue: null, unit: 'count', description: 'Average completed tasks per user per day.' },
  { metricKey: 'nps', category: 'product', name: 'NPS', targetOperator: 'gte', targetValue: 40, unit: 'score', description: 'Net promoter score should be above 40.' },
  { metricKey: 'crash_rate', category: 'quality', name: 'Crash rate', targetOperator: 'lte', targetValue: 0.5, unit: 'percent', description: 'Crash rate should stay under 0.5%.' },
  { metricKey: 'task_success_rate', category: 'quality', name: 'Task success rate', targetOperator: 'gte', targetValue: 85, unit: 'percent', description: 'Task success rate should stay above 85%.' },
  { metricKey: 'critical_bug_fix_hours', category: 'quality', name: 'Critical bug fix time', targetOperator: 'lte', targetValue: 48, unit: 'hours', description: 'Critical bugs should be fixed within 48 hours.' },
  { metricKey: 'first_response_hours', category: 'quality', name: 'First response time', targetOperator: 'lte', targetValue: 4, unit: 'hours', description: 'First response should happen within 4 hours.' },
  { metricKey: 'github_stars', category: 'community', name: 'Stars', targetOperator: 'track', targetValue: null, unit: 'count', description: 'GitHub stars or equivalent community interest.' },
  { metricKey: 'contributors', category: 'community', name: 'Contributors', targetOperator: 'track', targetValue: null, unit: 'count', description: 'Number of contributors.' },
  { metricKey: 'third_party_skills', category: 'community', name: 'Third-party Skills', targetOperator: 'track', targetValue: null, unit: 'count', description: 'Number of third-party Skills.' },
  { metricKey: 'discord_members', category: 'community', name: 'Discord members', targetOperator: 'track', targetValue: null, unit: 'count', description: 'Community chat members.' },
  { metricKey: 'docs_visits', category: 'community', name: 'Docs visits', targetOperator: 'track', targetValue: null, unit: 'visits', description: 'Documentation traffic.' },
  { metricKey: 'conversion_rate', category: 'business', name: 'Conversion rate', targetOperator: 'track', targetValue: null, unit: 'percent', description: 'Free-to-paid or trial-to-paid conversion.' },
  { metricKey: 'mrr', category: 'business', name: 'MRR', targetOperator: 'track', targetValue: null, unit: 'currency', description: 'Monthly recurring revenue.' },
  { metricKey: 'churn_rate', category: 'business', name: 'Churn rate', targetOperator: 'track', targetValue: null, unit: 'percent', description: 'Customer churn rate.' },
]

export function getDefaultSuccessMetricCount(): number {
  return defaultMetrics.length
}

export async function seedSuccessMetricDefinitions(): Promise<SuccessMetricDefinitionRow[]> {
  const now = Date.now()
  for (const metric of defaultMetrics) {
    const existing = await db.query.successMetricDefinitions.findFirst({
      where: eq(schema.successMetricDefinitions.metricKey, metric.metricKey),
    })
    if (existing) continue
    await db.insert(schema.successMetricDefinitions).values({
      id: newSuccessMetricDefinitionId(),
      metricKey: metric.metricKey,
      category: metric.category,
      name: metric.name,
      targetOperator: metric.targetOperator,
      targetValue: metric.targetValue,
      unit: metric.unit,
      description: metric.description,
      status: 'active',
      createdAt: now,
      updatedAt: now,
    })
  }
  return listSuccessMetricDefinitions()
}

export async function listSuccessMetricDefinitions(args: {
  category?: SuccessMetricCategory
  status?: string
  limit?: number
} = {}): Promise<SuccessMetricDefinitionRow[]> {
  const conditions: SQL[] = []
  if (args.category) conditions.push(eq(schema.successMetricDefinitions.category, args.category))
  if (args.status) conditions.push(eq(schema.successMetricDefinitions.status, args.status))
  return db.query.successMetricDefinitions.findMany({
    where: conditions.length ? and(...conditions) : undefined,
    orderBy: [asc(schema.successMetricDefinitions.category), asc(schema.successMetricDefinitions.metricKey)],
    limit: args.limit ?? 100,
  })
}

export async function recordSuccessMetricSnapshot(args: {
  metricKey: string
  value: number
  measuredAt?: number
  notes?: string
}): Promise<SuccessMetricSnapshotRow> {
  await seedSuccessMetricDefinitions()
  const definition = await db.query.successMetricDefinitions.findFirst({
    where: eq(schema.successMetricDefinitions.metricKey, args.metricKey),
  })
  if (!definition) throw new Error(`Success metric not found: ${args.metricKey}`)
  const now = Date.now()
  const status = evaluateSnapshotStatus(definition, args.value)
  const row = {
    id: newSuccessMetricSnapshotId(),
    metricDefinitionId: definition.id,
    metricKey: definition.metricKey,
    value: args.value,
    status,
    measuredAt: args.measuredAt ?? now,
    notes: args.notes ?? '',
    createdAt: now,
  }
  await db.insert(schema.successMetricSnapshots).values(row)
  return row
}

export async function listSuccessMetricSnapshots(args: {
  metricKey?: string
  status?: SuccessMetricSnapshotStatus
  limit?: number
} = {}): Promise<SuccessMetricSnapshotRow[]> {
  const conditions: SQL[] = []
  if (args.metricKey) conditions.push(eq(schema.successMetricSnapshots.metricKey, args.metricKey))
  if (args.status) conditions.push(eq(schema.successMetricSnapshots.status, args.status))
  return db.query.successMetricSnapshots.findMany({
    where: conditions.length ? and(...conditions) : undefined,
    orderBy: [desc(schema.successMetricSnapshots.measuredAt)],
    limit: args.limit ?? 100,
  })
}

function evaluateSnapshotStatus(
  definition: SuccessMetricDefinitionRow,
  value: number,
): SuccessMetricSnapshotStatus {
  if (definition.targetOperator === 'track' || definition.targetValue == null) return 'observed'
  if (definition.targetOperator === 'gte') return value >= definition.targetValue ? 'met' : 'missed'
  return value <= definition.targetValue ? 'met' : 'missed'
}
