import { and, desc, eq, type SQL } from 'drizzle-orm'

import { db, schema } from '@/db/client'
import type {
  CustomModelRow,
  CustomModelSourceType,
  FinetuneDatasetConsentStatus,
  FinetuneDatasetExportRow,
  FinetuneDatasetSourceScope,
  JsonObject,
} from '@/db/schema'
import { newCustomModelId, newFinetuneDatasetExportId } from '@/server/ids'

export type CustomModelSource =
  | { type: 'openai_finetune'; modelId: string }
  | { type: 'huggingface'; repoId: string }
  | { type: 'local_gguf'; path: string }
  | { type: 'ollama_custom'; modelName: string }

export interface CreateCustomModelArgs {
  name: string
  source: CustomModelSource
  finetuneInfo?: {
    baseModel: string
    dataset: string
    taskSpecialization?: string[]
    finetunedAt: number
    performanceDelta?: string | null
  } | null
  usageConstraints: {
    maxContextWindow: number
    requiresSpecialPromptFormat?: boolean
    knownLimitations?: string[]
    compatibleSkills?: string[]
    incompatibleSkills?: string[]
  }
  status?: CustomModelRow['status']
}

export interface CustomModelEvaluation {
  customModelId: string
  compatible: boolean
  reasons: string[]
  warnings: string[]
  maxContextWindow: number
  usableSkills: string[]
  blockedSkills: string[]
}

export async function createCustomModel(args: CreateCustomModelArgs): Promise<CustomModelRow> {
  const now = Date.now()
  const sourceType = args.source.type
  const constraints = args.usageConstraints
  const row: CustomModelRow = {
    id: newCustomModelId(),
    name: normalizeRequired(args.name, 'name'),
    sourceType,
    sourceConfig: sourceToConfig(args.source),
    baseModel: args.finetuneInfo?.baseModel?.trim() || null,
    datasetDescription: args.finetuneInfo?.dataset?.trim() || null,
    taskSpecialization: normalizeList(args.finetuneInfo?.taskSpecialization),
    finetunedAt: args.finetuneInfo?.finetunedAt ?? null,
    performanceDelta: args.finetuneInfo?.performanceDelta?.trim() || null,
    maxContextWindow: constraints.maxContextWindow,
    requiresSpecialPromptFormat: constraints.requiresSpecialPromptFormat ?? false,
    knownLimitations: normalizeList(constraints.knownLimitations),
    compatibleSkills: normalizeList(constraints.compatibleSkills),
    incompatibleSkills: normalizeList(constraints.incompatibleSkills),
    status: args.status ?? 'available',
    createdAt: now,
    updatedAt: now,
  }
  await db.insert(schema.customModels).values(row)
  return row
}

export async function listCustomModels(args: {
  sourceType?: CustomModelSourceType
  status?: CustomModelRow['status']
  compatibleSkill?: string
  limit?: number
} = {}): Promise<CustomModelRow[]> {
  const conditions: SQL[] = []
  if (args.sourceType) conditions.push(eq(schema.customModels.sourceType, args.sourceType))
  if (args.status) conditions.push(eq(schema.customModels.status, args.status))
  const rows = await db.query.customModels.findMany({
    where: conditions.length ? and(...conditions) : undefined,
    orderBy: [desc(schema.customModels.updatedAt)],
    limit: args.limit ?? 100,
  })
  if (!args.compatibleSkill) return rows
  return rows.filter((row) => row.compatibleSkills.includes(args.compatibleSkill ?? ''))
}

export async function evaluateCustomModel(args: {
  customModelId: string
  requestedContextWindow?: number
  skillIds?: string[]
  promptFormatAcknowledged?: boolean
}): Promise<CustomModelEvaluation> {
  const model = await getRequiredCustomModel(args.customModelId)
  const requestedContextWindow = args.requestedContextWindow ?? model.maxContextWindow
  const skillIds = normalizeList(args.skillIds)
  const reasons: string[] = []
  const warnings: string[] = []
  const blockedSkills = skillIds.filter((skillId) => model.incompatibleSkills.includes(skillId))
  const usableSkills = skillIds.filter((skillId) => !blockedSkills.includes(skillId))

  if (model.status !== 'available') reasons.push(`model_status:${model.status}`)
  if (requestedContextWindow > model.maxContextWindow) {
    reasons.push(`context_window_exceeds_limit:${requestedContextWindow}>${model.maxContextWindow}`)
  }
  if (blockedSkills.length) reasons.push(`incompatible_skills:${blockedSkills.join(',')}`)
  if (model.requiresSpecialPromptFormat && !args.promptFormatAcknowledged) {
    warnings.push('special_prompt_format_required')
  }
  for (const limitation of model.knownLimitations) warnings.push(`known_limitation:${limitation}`)

  return {
    customModelId: model.id,
    compatible: reasons.length === 0,
    reasons,
    warnings,
    maxContextWindow: model.maxContextWindow,
    usableSkills,
    blockedSkills,
  }
}

export async function createFinetuneDatasetExport(args: {
  customModelId?: string | null
  sourceScope: FinetuneDatasetSourceScope
  sourceIds?: string[]
  datasetPurpose: string
  recordCount?: number
  destinationProvider?: string
  includePrivateData?: boolean
  consentStatus?: FinetuneDatasetConsentStatus
}): Promise<FinetuneDatasetExportRow> {
  if (args.customModelId) await getRequiredCustomModel(args.customModelId)
  const now = Date.now()
  const consentStatus = args.includePrivateData && args.consentStatus !== 'approved'
    ? 'pending'
    : args.consentStatus ?? 'pending'
  const row: FinetuneDatasetExportRow = {
    id: newFinetuneDatasetExportId(),
    customModelId: args.customModelId?.trim() || null,
    sourceScope: args.sourceScope,
    sourceIds: normalizeList(args.sourceIds),
    datasetPurpose: normalizeRequired(args.datasetPurpose, 'datasetPurpose'),
    recordCount: args.recordCount ?? 0,
    destinationProvider: args.destinationProvider?.trim() || 'manual',
    includePrivateData: args.includePrivateData ?? false,
    consentStatus,
    outputManifest: {
      requiresUserConsent: Boolean(args.includePrivateData),
      exportMode: 'manifest_only',
      sendsToProvider: consentStatus === 'exported',
    },
    createdAt: now,
    updatedAt: now,
  }
  await db.insert(schema.finetuneDatasetExports).values(row)
  return row
}

export async function listFinetuneDatasetExports(args: {
  customModelId?: string
  consentStatus?: FinetuneDatasetConsentStatus
  sourceScope?: FinetuneDatasetSourceScope
  limit?: number
} = {}): Promise<FinetuneDatasetExportRow[]> {
  const conditions: SQL[] = []
  if (args.customModelId) conditions.push(eq(schema.finetuneDatasetExports.customModelId, args.customModelId))
  if (args.consentStatus) conditions.push(eq(schema.finetuneDatasetExports.consentStatus, args.consentStatus))
  if (args.sourceScope) conditions.push(eq(schema.finetuneDatasetExports.sourceScope, args.sourceScope))
  return db.query.finetuneDatasetExports.findMany({
    where: conditions.length ? and(...conditions) : undefined,
    orderBy: [desc(schema.finetuneDatasetExports.createdAt)],
    limit: args.limit ?? 100,
  })
}

async function getRequiredCustomModel(id: string): Promise<CustomModelRow> {
  const model = await db.query.customModels.findFirst({
    where: eq(schema.customModels.id, id),
  })
  if (!model) throw new Error(`Custom model not found: ${id}`)
  return model
}

function sourceToConfig(source: CustomModelSource): JsonObject {
  if (source.type === 'openai_finetune') return { type: source.type, modelId: source.modelId }
  if (source.type === 'huggingface') return { type: source.type, repoId: source.repoId }
  if (source.type === 'local_gguf') return { type: source.type, path: source.path }
  return { type: source.type, modelName: source.modelName }
}

function normalizeList(values: string[] | undefined): string[] {
  return Array.from(new Set((values ?? []).map((value) => value.trim()).filter(Boolean)))
}

function normalizeRequired(value: string, field: string): string {
  const trimmed = value.trim()
  if (!trimmed) throw new Error(`${field} is required`)
  return trimmed
}
