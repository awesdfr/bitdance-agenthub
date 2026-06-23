import { asc, desc, eq } from 'drizzle-orm'

import { db, schema } from '@/db/client'
import type {
  DeprecationMigrationMode,
  DeprecationMigrationRunRow,
  DeprecationPolicyStageRow,
  DeprecationStage,
  FeatureDeprecationRow,
} from '@/db/schema'
import {
  newDeprecationMigrationRunId,
  newDeprecationPolicyStageId,
  newFeatureDeprecationId,
} from '@/server/ids'

const monthMs = 30 * 24 * 60 * 60 * 1000

const defaultStages: Array<{
  stage: DeprecationStage
  sequenceIndex: number
  monthsFromNotice: number
  runtimeBehavior: string
  description: string
}> = [
  {
    stage: 'notice',
    sequenceIndex: 0,
    monthsFromNotice: 0,
    runtimeBehavior: 'mark_deprecated_soon',
    description: 'Mark the feature as scheduled for deprecation.',
  },
  {
    stage: 'warning',
    sequenceIndex: 1,
    monthsFromNotice: 3,
    runtimeBehavior: 'runtime_warning',
    description: 'Show runtime warnings while keeping existing usage active.',
  },
  {
    stage: 'disabled_new',
    sequenceIndex: 2,
    monthsFromNotice: 6,
    runtimeBehavior: 'block_new_agent_usage',
    description: 'Existing users can continue; new Agents cannot select the feature.',
  },
  {
    stage: 'removed',
    sequenceIndex: 3,
    monthsFromNotice: 9,
    runtimeBehavior: 'remove_feature',
    description: 'Remove the feature after a minimum 9-month cycle.',
  },
]

export function getDefaultDeprecationStageCount(): number {
  return defaultStages.length
}

export async function seedDeprecationPolicyStages(): Promise<DeprecationPolicyStageRow[]> {
  const now = Date.now()
  for (const stage of defaultStages) {
    const existing = await db.query.deprecationPolicyStages.findFirst({
      where: eq(schema.deprecationPolicyStages.stage, stage.stage),
    })
    if (existing) continue
    await db.insert(schema.deprecationPolicyStages).values({
      id: newDeprecationPolicyStageId(),
      stage: stage.stage,
      sequenceIndex: stage.sequenceIndex,
      monthsFromNotice: stage.monthsFromNotice,
      runtimeBehavior: stage.runtimeBehavior,
      description: stage.description,
      createdAt: now,
      updatedAt: now,
    })
  }
  return listDeprecationPolicyStages()
}

export async function listDeprecationPolicyStages(): Promise<DeprecationPolicyStageRow[]> {
  return db.query.deprecationPolicyStages.findMany({
    orderBy: [asc(schema.deprecationPolicyStages.sequenceIndex)],
    limit: 20,
  })
}

export async function createFeatureDeprecation(args: {
  featureKey: string
  featureName: string
  replacementFeature?: string | null
  migrationGuide: string
  autoMigrateAvailable?: boolean
  noticeAt?: number
}): Promise<FeatureDeprecationRow> {
  await seedDeprecationPolicyStages()
  const now = Date.now()
  const noticeAt = args.noticeAt ?? now
  const row = {
    id: newFeatureDeprecationId(),
    featureKey: args.featureKey.trim(),
    featureName: args.featureName.trim(),
    currentStage: 'notice' as const,
    replacementFeature: args.replacementFeature?.trim() || null,
    migrationGuide: args.migrationGuide.trim(),
    autoMigrateAvailable: args.autoMigrateAvailable ?? false,
    noticeAt,
    warningAt: noticeAt + 3 * monthMs,
    disabledNewAt: noticeAt + 6 * monthMs,
    removedAt: noticeAt + 9 * monthMs,
    status: 'active',
    createdAt: now,
    updatedAt: now,
  }
  await db.insert(schema.featureDeprecations).values(row)
  return row
}

export async function listFeatureDeprecations(): Promise<FeatureDeprecationRow[]> {
  return db.query.featureDeprecations.findMany({
    orderBy: [desc(schema.featureDeprecations.createdAt)],
    limit: 100,
  })
}

export async function resolveDeprecationStage(
  featureDeprecationId: string,
  at = Date.now(),
): Promise<FeatureDeprecationRow> {
  const row = await getRequiredFeatureDeprecation(featureDeprecationId)
  const currentStage = stageAt(row, at)
  await db
    .update(schema.featureDeprecations)
    .set({ currentStage, updatedAt: Date.now() })
    .where(eq(schema.featureDeprecations.id, row.id))
  return getRequiredFeatureDeprecation(row.id)
}

export async function runDeprecationMigration(args: {
  featureDeprecationId: string
  mode?: DeprecationMigrationMode
  itemCount?: number
}): Promise<DeprecationMigrationRunRow> {
  const feature = await getRequiredFeatureDeprecation(args.featureDeprecationId)
  if (!feature.autoMigrateAvailable) throw new Error('autoMigrate is not available for this deprecation.')
  const now = Date.now()
  const mode = args.mode ?? 'dry_run'
  const row = {
    id: newDeprecationMigrationRunId(),
    featureDeprecationId: feature.id,
    mode,
    status: 'completed' as const,
    migratedCount: args.itemCount ?? 0,
    report: {
      featureKey: feature.featureKey,
      mode,
      migrationGuide: feature.migrationGuide,
      replacementFeature: feature.replacementFeature,
      autoMigrate: true,
    },
    createdAt: now,
    completedAt: now,
  }
  await db.insert(schema.deprecationMigrationRuns).values(row)
  return row
}

export async function listDeprecationMigrationRuns(args: {
  featureDeprecationId?: string
} = {}): Promise<DeprecationMigrationRunRow[]> {
  return db.query.deprecationMigrationRuns.findMany({
    where: args.featureDeprecationId
      ? eq(schema.deprecationMigrationRuns.featureDeprecationId, args.featureDeprecationId)
      : undefined,
    orderBy: [desc(schema.deprecationMigrationRuns.createdAt)],
    limit: 100,
  })
}

async function getRequiredFeatureDeprecation(id: string): Promise<FeatureDeprecationRow> {
  const row = await db.query.featureDeprecations.findFirst({
    where: eq(schema.featureDeprecations.id, id),
  })
  if (!row) throw new Error(`Feature deprecation not found: ${id}`)
  return row
}

function stageAt(feature: FeatureDeprecationRow, at: number): DeprecationStage {
  if (at >= feature.removedAt) return 'removed'
  if (at >= feature.disabledNewAt) return 'disabled_new'
  if (at >= feature.warningAt) return 'warning'
  return 'notice'
}
