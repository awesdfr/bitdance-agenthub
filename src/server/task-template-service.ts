import { and, desc, eq, like, type SQL } from 'drizzle-orm'

import { db, schema } from '@/db/client'
import type {
  JsonObject,
  TaskTemplateParameterType,
  TaskTemplateRow,
  TaskTemplateRunRow,
  TaskTemplateStatus,
} from '@/db/schema'
import { newTaskTemplateId, newTaskTemplateRunId } from '@/server/ids'

export interface TaskTemplateParameterDefinition {
  type: TaskTemplateParameterType
  label: string
  description?: string
  default?: unknown
  required?: boolean
  options?: Array<{ label: string; value: unknown }>
}

export type TaskTemplateParameterMap = Record<string, TaskTemplateParameterDefinition>

const DEFAULT_TASK_TEMPLATES: Array<Parameters<typeof createTaskTemplate>[0]> = [
  taskTemplatePreset('PR Review', 'code_review', 'Code Reviewer', 'Review {{prUrl}} and produce actionable findings.', {
    prUrl: { type: 'url', label: 'PR URL', required: true },
  }, ['pr-review', 'code']),
  taskTemplatePreset('Bug Fix', 'engineering', 'Bug Fix Agent', 'Fix bug: {{bugSummary}}.', {
    bugSummary: { type: 'string', label: 'Bug summary', required: true },
  }, ['bugfix']),
  taskTemplatePreset('Feature Development', 'engineering', 'Feature Builder Agent', 'Build feature: {{featureName}}.', {
    featureName: { type: 'string', label: 'Feature name', required: true },
  }, ['feature']),
  taskTemplatePreset('Data Report', 'data', 'Data Analyst Agent', 'Create a {{period}} data report for {{dataset}}.', {
    dataset: { type: 'string', label: 'Dataset', required: true },
    period: { type: 'select', label: 'Period', required: true, options: [
      { label: 'Daily', value: 'daily' },
      { label: 'Weekly', value: 'weekly' },
      { label: 'Monthly', value: 'monthly' },
    ] },
  }, ['report', 'data']),
  taskTemplatePreset('Meeting Notes', 'operations', 'Meeting Notes Agent', 'Turn {{sourceFile}} into meeting notes and tasks.', {
    sourceFile: { type: 'file', label: 'Source file', required: true },
  }, ['meeting']),
  taskTemplatePreset('Competitor Research', 'research', 'Research Agent', 'Research competitor {{competitor}}.', {
    competitor: { type: 'string', label: 'Competitor', required: true },
  }, ['research']),
  taskTemplatePreset('Code Refactor', 'engineering', 'Refactor Agent', 'Refactor {{targetArea}} with no behavior regressions.', {
    targetArea: { type: 'string', label: 'Target area', required: true },
  }, ['refactor']),
  taskTemplatePreset('Dependency Upgrade', 'engineering', 'Dependency Agent', 'Upgrade {{packageName}} safely.', {
    packageName: { type: 'string', label: 'Package name', required: true },
  }, ['dependency']),
  taskTemplatePreset('File Organizer', 'file_ops', 'File Ops Agent', 'Organize files under {{folderPath}}.', {
    folderPath: { type: 'file', label: 'Folder path', required: true },
  }, ['files']),
  taskTemplatePreset('Email Handling', 'operations', 'Email Ops Agent', 'Handle email batch: {{mailboxLabel}}.', {
    mailboxLabel: { type: 'string', label: 'Mailbox label', required: true },
  }, ['email']),
]

export async function createTaskTemplate(args: {
  name: string
  description?: string
  category: string
  parameters?: TaskTemplateParameterMap
  agentRole: string
  workflowId?: string | null
  descriptionTemplate: string
  inputTemplate?: JsonObject
  estimatedDuration?: string
  estimatedCost?: number
  tags?: string[]
  relatedMemories?: string[]
  requiredSkills?: string[]
  sampleOutputs?: string[]
  status?: TaskTemplateStatus
}): Promise<TaskTemplateRow> {
  const now = Date.now()
  const row: TaskTemplateRow = {
    id: newTaskTemplateId(),
    name: normalizeRequired(args.name, 'name'),
    description: args.description?.trim() ?? '',
    category: normalizeRequired(args.category, 'category'),
    parameters: (args.parameters ?? {}) as unknown as JsonObject,
    agentRole: normalizeRequired(args.agentRole, 'agentRole'),
    workflowId: normalizeOptional(args.workflowId),
    descriptionTemplate: normalizeRequired(args.descriptionTemplate, 'descriptionTemplate'),
    inputTemplate: args.inputTemplate ?? {},
    estimatedDuration: args.estimatedDuration?.trim() ?? '',
    estimatedCost: args.estimatedCost ?? 0,
    tags: normalizeList(args.tags),
    timesUsed: 0,
    avgSuccessRate: 0,
    avgDuration: '',
    avgCost: 0,
    lastUsed: null,
    relatedMemories: normalizeList(args.relatedMemories),
    requiredSkills: normalizeList(args.requiredSkills),
    sampleOutputs: normalizeList(args.sampleOutputs),
    status: args.status ?? 'active',
    createdAt: now,
    updatedAt: now,
  }
  await db.insert(schema.taskTemplates).values(row)
  return row
}

export async function seedDefaultTaskTemplates(): Promise<TaskTemplateRow[]> {
  const rows: TaskTemplateRow[] = []
  for (const preset of DEFAULT_TASK_TEMPLATES) {
    const existing = await db.query.taskTemplates.findFirst({
      where: and(eq(schema.taskTemplates.name, preset.name), eq(schema.taskTemplates.category, preset.category)),
    })
    rows.push(existing ?? await createTaskTemplate(preset))
  }
  return rows
}

export async function listTaskTemplates(args: {
  category?: string
  status?: TaskTemplateStatus
  query?: string
  limit?: number
} = {}): Promise<TaskTemplateRow[]> {
  const conditions: SQL[] = []
  if (args.category) conditions.push(eq(schema.taskTemplates.category, args.category))
  if (args.status) conditions.push(eq(schema.taskTemplates.status, args.status))
  if (args.query) conditions.push(like(schema.taskTemplates.name, `%${args.query}%`))
  return db.query.taskTemplates.findMany({
    where: conditions.length ? and(...conditions) : undefined,
    orderBy: [desc(schema.taskTemplates.updatedAt)],
    limit: args.limit ?? 100,
  })
}

export async function instantiateTaskTemplate(
  taskTemplateId: string,
  args: {
    parameters?: JsonObject
    agentProfileId?: string | null
    workflowId?: string | null
    status?: 'planned' | 'queued'
  } = {},
): Promise<TaskTemplateRunRow> {
  const template = await getRequiredTaskTemplate(taskTemplateId)
  if (template.status !== 'active') throw new Error(`Task template is ${template.status}`)
  const now = Date.now()
  const parameters = resolveParameters(template.parameters as unknown as TaskTemplateParameterMap, args.parameters ?? {})
  const renderedDescription = renderString(template.descriptionTemplate, parameters)
  const renderedInput = renderValue(template.inputTemplate, parameters) as JsonObject
  const row: TaskTemplateRunRow = {
    id: newTaskTemplateRunId(),
    taskTemplateId: template.id,
    agentProfileId: normalizeOptional(args.agentProfileId),
    workflowId: normalizeOptional(args.workflowId) ?? template.workflowId,
    parameters,
    renderedDescription,
    renderedInput,
    estimatedDuration: template.estimatedDuration,
    estimatedCost: template.estimatedCost,
    status: args.status ?? 'planned',
    success: null,
    actualDuration: null,
    actualCost: null,
    createdAt: now,
    completedAt: null,
  }
  await db.insert(schema.taskTemplateRuns).values(row)
  await db
    .update(schema.taskTemplates)
    .set({
      timesUsed: template.timesUsed + 1,
      lastUsed: now,
      updatedAt: now,
    })
    .where(eq(schema.taskTemplates.id, template.id))
  return row
}

export async function completeTaskTemplateRun(
  taskTemplateRunId: string,
  args: {
    success: boolean
    actualDuration?: string
    actualCost?: number
  },
): Promise<TaskTemplateRunRow> {
  const run = await getRequiredTaskTemplateRun(taskTemplateRunId)
  const now = Date.now()
  await db
    .update(schema.taskTemplateRuns)
    .set({
      status: args.success ? 'completed' : 'failed',
      success: args.success,
      actualDuration: args.actualDuration?.trim() ?? '',
      actualCost: args.actualCost ?? 0,
      completedAt: now,
    })
    .where(eq(schema.taskTemplateRuns.id, run.id))
  await refreshTaskTemplateStats(run.taskTemplateId, args.actualDuration?.trim() ?? '', args.actualCost ?? 0)
  return getRequiredTaskTemplateRun(run.id)
}

export async function listTaskTemplateRuns(args: {
  taskTemplateId?: string
  status?: TaskTemplateRunRow['status']
  limit?: number
} = {}): Promise<TaskTemplateRunRow[]> {
  const conditions: SQL[] = []
  if (args.taskTemplateId) conditions.push(eq(schema.taskTemplateRuns.taskTemplateId, args.taskTemplateId))
  if (args.status) conditions.push(eq(schema.taskTemplateRuns.status, args.status))
  return db.query.taskTemplateRuns.findMany({
    where: conditions.length ? and(...conditions) : undefined,
    orderBy: [desc(schema.taskTemplateRuns.createdAt)],
    limit: args.limit ?? 100,
  })
}

async function refreshTaskTemplateStats(
  taskTemplateId: string,
  latestDuration: string,
  latestCost: number,
): Promise<void> {
  const runs = await db.query.taskTemplateRuns.findMany({
    where: eq(schema.taskTemplateRuns.taskTemplateId, taskTemplateId),
  })
  const completed = runs.filter((run) => run.success !== null)
  const successCount = completed.filter((run) => run.success).length
  const avgSuccessRate = completed.length ? successCount / completed.length : 0
  const costValues = completed.map((run) => run.actualCost ?? 0)
  const avgCost = costValues.length
    ? costValues.reduce((sum, value) => sum + value, 0) / costValues.length
    : latestCost
  await db
    .update(schema.taskTemplates)
    .set({
      avgSuccessRate,
      avgDuration: latestDuration,
      avgCost,
      updatedAt: Date.now(),
    })
    .where(eq(schema.taskTemplates.id, taskTemplateId))
}

async function getRequiredTaskTemplate(id: string): Promise<TaskTemplateRow> {
  const row = await db.query.taskTemplates.findFirst({ where: eq(schema.taskTemplates.id, id) })
  if (!row) throw new Error(`Task template not found: ${id}`)
  return row
}

async function getRequiredTaskTemplateRun(id: string): Promise<TaskTemplateRunRow> {
  const row = await db.query.taskTemplateRuns.findFirst({ where: eq(schema.taskTemplateRuns.id, id) })
  if (!row) throw new Error(`Task template run not found: ${id}`)
  return row
}

function resolveParameters(
  definitions: TaskTemplateParameterMap,
  provided: JsonObject,
): JsonObject {
  const resolved: JsonObject = {}
  for (const [name, definition] of Object.entries(definitions)) {
    const value = provided[name] ?? definition.default
    if (value === undefined || value === null || value === '') {
      if (definition.required) throw new Error(`Missing required template parameter: ${name}`)
      continue
    }
    validateParameter(name, definition, value)
    resolved[name] = value
  }
  return resolved
}

function validateParameter(name: string, definition: TaskTemplateParameterDefinition, value: unknown): void {
  if (definition.type === 'number' && typeof value !== 'number') throw new Error(`Parameter ${name} must be number`)
  if (definition.type === 'boolean' && typeof value !== 'boolean') throw new Error(`Parameter ${name} must be boolean`)
  if (['string', 'file', 'url'].includes(definition.type) && typeof value !== 'string') {
    throw new Error(`Parameter ${name} must be string`)
  }
  if (definition.type === 'url') {
    try {
      new URL(value as string)
    } catch {
      throw new Error(`Parameter ${name} must be url`)
    }
  }
  if (definition.type === 'select' && definition.options?.length) {
    const allowed = definition.options.some((option) => JSON.stringify(option.value) === JSON.stringify(value))
    if (!allowed) throw new Error(`Parameter ${name} must match one of the select options`)
  }
}

function renderValue(value: unknown, parameters: JsonObject): unknown {
  if (typeof value === 'string') return renderString(value, parameters)
  if (Array.isArray(value)) return value.map((item) => renderValue(item, parameters))
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, child]) => [key, renderValue(child, parameters)]),
    )
  }
  return value
}

function renderString(value: string, parameters: JsonObject): string {
  return value.replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (_match, key: string) => {
    const replacement = parameters[key]
    return replacement === undefined || replacement === null ? '' : String(replacement)
  })
}

function taskTemplatePreset(
  name: string,
  category: string,
  agentRole: string,
  descriptionTemplate: string,
  parameters: TaskTemplateParameterMap,
  tags: string[],
): Parameters<typeof createTaskTemplate>[0] {
  return {
    name,
    description: `${name} reusable task template.`,
    category,
    parameters,
    agentRole,
    descriptionTemplate,
    inputTemplate: {
      task: descriptionTemplate,
      parameters: Object.fromEntries(Object.keys(parameters).map((key) => [key, `{{${key}}}`])),
    },
    estimatedDuration: '30m',
    estimatedCost: 1,
    tags,
  }
}

function normalizeList(values: string[] | undefined): string[] {
  return Array.from(new Set((values ?? []).map((value) => value.trim()).filter(Boolean)))
}

function normalizeOptional(value: string | null | undefined): string | null {
  const trimmed = value?.trim()
  return trimmed ? trimmed : null
}

function normalizeRequired(value: string, field: string): string {
  const trimmed = value.trim()
  if (!trimmed) throw new Error(`${field} is required`)
  return trimmed
}
