import { and, desc, eq, type SQL } from 'drizzle-orm'

import { db, schema } from '@/db/client'
import type {
  JsonObject,
  SkillSynthesisRecordRow,
  SkillSynthesisStatus,
  ToolPipelineFailurePolicy,
  ToolPipelineRow,
  ToolPipelineStatus,
} from '@/db/schema'
import { newSkillSynthesisRecordId, newToolPipelineId } from '@/server/ids'

export async function discoverSkillSynthesis(args: {
  skillIds: string[]
  detectComplementaryPairs?: boolean
  suggestNewCompositeSkill?: boolean
}): Promise<SkillSynthesisRecordRow> {
  const skillIds = normalizeList(args.skillIds)
  if (skillIds.length < 2) throw new Error('At least two skills are required.')
  const pattern = detectPattern(skillIds, args.detectComplementaryPairs ?? true)
  const now = Date.now()
  const row: SkillSynthesisRecordRow = {
    id: newSkillSynthesisRecordId(),
    sourceSkillIds: skillIds,
    detectedPattern: pattern.detectedPattern,
    suggestedCompositeName:
      args.suggestNewCompositeSkill === false ? 'Composite Skill Disabled' : pattern.name,
    compositeDescription: pattern.description,
    confidence: pattern.confidence,
    publishable: args.suggestNewCompositeSkill !== false,
    status: 'suggested',
    createdAt: now,
    updatedAt: now,
  }
  await db.insert(schema.skillSynthesisRecords).values(row)
  return row
}

export async function listSkillSynthesisRecords(args: {
  status?: SkillSynthesisStatus
  limit?: number
} = {}): Promise<SkillSynthesisRecordRow[]> {
  const conditions: SQL[] = []
  if (args.status) conditions.push(eq(schema.skillSynthesisRecords.status, args.status))
  return db.query.skillSynthesisRecords.findMany({
    where: conditions.length ? and(...conditions) : undefined,
    orderBy: [desc(schema.skillSynthesisRecords.createdAt)],
    limit: args.limit ?? 100,
  })
}

export async function createToolPipeline(args: {
  synthesisRecordId?: string | null
  name: string
  composedOf: string[]
  chain: JsonObject[]
  inputOutputMapping?: JsonObject
  onStepFailure?: ToolPipelineFailurePolicy
  publishable?: boolean
}): Promise<ToolPipelineRow> {
  if (args.synthesisRecordId) await getRequiredSynthesisRecord(args.synthesisRecordId)
  const now = Date.now()
  const row: ToolPipelineRow = {
    id: newToolPipelineId(),
    synthesisRecordId: args.synthesisRecordId?.trim() || null,
    name: normalizeRequired(args.name, 'name'),
    composedOf: normalizeList(args.composedOf),
    chain: args.chain,
    inputOutputMapping: args.inputOutputMapping ?? {},
    onStepFailure: args.onStepFailure ?? 'abort',
    publishable: args.publishable ?? false,
    status: 'draft',
    createdAt: now,
    updatedAt: now,
  }
  await db.insert(schema.toolPipelines).values(row)
  return row
}

export async function listToolPipelines(args: {
  status?: ToolPipelineStatus
  synthesisRecordId?: string
  limit?: number
} = {}): Promise<ToolPipelineRow[]> {
  const conditions: SQL[] = []
  if (args.status) conditions.push(eq(schema.toolPipelines.status, args.status))
  if (args.synthesisRecordId) {
    conditions.push(eq(schema.toolPipelines.synthesisRecordId, args.synthesisRecordId))
  }
  return db.query.toolPipelines.findMany({
    where: conditions.length ? and(...conditions) : undefined,
    orderBy: [desc(schema.toolPipelines.updatedAt)],
    limit: args.limit ?? 100,
  })
}

export async function publishToolPipeline(toolPipelineId: string): Promise<ToolPipelineRow> {
  const pipeline = await getRequiredToolPipeline(toolPipelineId)
  if (!pipeline.publishable) throw new Error('Tool pipeline is not publishable.')
  const now = Date.now()
  await db
    .update(schema.toolPipelines)
    .set({ status: 'published', updatedAt: now })
    .where(eq(schema.toolPipelines.id, toolPipelineId))
  if (pipeline.synthesisRecordId) {
    await db
      .update(schema.skillSynthesisRecords)
      .set({ status: 'published', updatedAt: now })
      .where(eq(schema.skillSynthesisRecords.id, pipeline.synthesisRecordId))
  }
  return getRequiredToolPipeline(toolPipelineId)
}

async function getRequiredSynthesisRecord(id: string): Promise<SkillSynthesisRecordRow> {
  const record = await db.query.skillSynthesisRecords.findFirst({
    where: eq(schema.skillSynthesisRecords.id, id),
  })
  if (!record) throw new Error(`Skill synthesis record not found: ${id}`)
  return record
}

async function getRequiredToolPipeline(id: string): Promise<ToolPipelineRow> {
  const pipeline = await db.query.toolPipelines.findFirst({
    where: eq(schema.toolPipelines.id, id),
  })
  if (!pipeline) throw new Error(`Tool pipeline not found: ${id}`)
  return pipeline
}

function detectPattern(
  skillIds: string[],
  detectComplementaryPairs: boolean,
): { detectedPattern: string; name: string; description: string; confidence: number } {
  const key = skillIds.map((skill) => skill.toLowerCase()).join(' ')
  if (detectComplementaryPairs && /excel|sheet|csv/.test(key) && /chart|graph|visual/.test(key)) {
    return {
      detectedPattern: 'tabular_data_to_chart',
      name: 'Data Analysis Composite Skill',
      description: 'Read tabular data, analyze it, and generate charts.',
      confidence: 0.92,
    }
  }
  if (detectComplementaryPairs && /web|scrape|browser/.test(key) && /pdf|document/.test(key)) {
    return {
      detectedPattern: 'web_to_pdf',
      name: 'Web To PDF Composite Skill',
      description: 'Scrape a web page, extract content, and produce a PDF document.',
      confidence: 0.9,
    }
  }
  return {
    detectedPattern: 'generic_composite',
    name: `${skillIds.slice(0, 2).join(' + ')} Composite Skill`,
    description: 'Combine multiple Skills into a reusable tool pipeline.',
    confidence: detectComplementaryPairs ? 0.65 : 0.4,
  }
}

function normalizeList(values: string[] | undefined): string[] {
  return Array.from(new Set((values ?? []).map((value) => value.trim()).filter(Boolean)))
}

function normalizeRequired(value: string, field: string): string {
  const trimmed = value.trim()
  if (!trimmed) throw new Error(`${field} is required`)
  return trimmed
}
