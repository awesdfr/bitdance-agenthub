import { and, desc, eq, type SQL } from 'drizzle-orm'

import { db, schema } from '@/db/client'
import type {
  AgentProfileRow,
  AgentTemplateCategory,
  AgentTemplateInstallRow,
  AgentTemplatePackageRow,
  AgentTemplatePackageType,
  AgentTemplateSource,
  AgentTemplateStatus,
  AgentTemplateVisibility,
  JsonObject,
} from '@/db/schema'
import {
  newAgentTemplateInstallId,
  newAgentTemplatePackageId,
} from '@/server/ids'
import { createAgentProfile, type CreateAgentProfileArgs } from '@/server/control-plane-service'
import { recordAuditLog } from '@/server/security-service'

export interface CreateAgentTemplatePackageArgs {
  templateKey?: string
  templateType: AgentTemplatePackageType
  category?: AgentTemplateCategory
  name: string
  description?: string
  role?: string
  payload?: JsonObject
  requiredSkillIds?: string[]
  recommendedToolIds?: string[]
  tags?: string[]
  author?: string
  source?: AgentTemplateSource
  visibility?: AgentTemplateVisibility
  marketplaceUrl?: string | null
  status?: AgentTemplateStatus
  rating?: number | null
  createdByUserId?: string | null
}

export interface ListAgentTemplatePackagesArgs {
  templateType?: AgentTemplatePackageType
  category?: AgentTemplateCategory
  source?: AgentTemplateSource
  visibility?: AgentTemplateVisibility
  status?: AgentTemplateStatus
  query?: string
  limit?: number
}

export interface InstallAgentTemplatePackageArgs {
  installedByUserId?: string | null
  targetName?: string | null
  variables?: JsonObject
}

export interface InstallAgentTemplatePackageResult {
  install: AgentTemplateInstallRow
  template: AgentTemplatePackageRow
  createdAgentProfile: AgentProfileRow | null
}

interface DefaultAgentTemplateDefinition {
  key: string
  category: AgentTemplateCategory
  name: string
  role: string
  artifactType: string
  tags: string[]
  description: string
}

const defaultTemplateRows: Array<[
  string,
  AgentTemplateCategory,
  string,
  string,
  string,
  string[],
]> = [
  ['frontend_developer', 'development', 'Frontend Developer', 'Build UI, pages, and frontend tests.', 'code', ['react', 'ui']],
  ['backend_developer', 'development', 'Backend Developer', 'Build APIs, data models, and server tests.', 'code', ['api', 'database']],
  ['fullstack_developer', 'development', 'Full-stack Developer', 'Own frontend and backend delivery.', 'code', ['fullstack']],
  ['devops_engineer', 'development', 'DevOps Engineer', 'Plan CI, deployment, and local operations.', 'report', ['ci', 'ops']],
  ['code_reviewer', 'development', 'Code Reviewer', 'Review diffs for correctness, safety, and maintainability.', 'report', ['review']],
  ['qa_tester', 'development', 'QA Tester', 'Design and run validation plans.', 'report', ['test']],
  ['ui_designer', 'design', 'UI Designer', 'Create product UI direction and interaction specs.', 'document', ['ui', 'design']],
  ['logo_designer', 'design', 'Logo Designer', 'Generate brand mark directions and critique.', 'image', ['brand']],
  ['ppt_designer', 'design', 'Presentation Designer', 'Produce slide structure and visual direction.', 'document', ['slides']],
  ['content_operator', 'operations', 'Content Operator', 'Plan, draft, and optimize content operations.', 'document', ['content']],
  ['data_analyst', 'operations', 'Data Analyst', 'Analyze datasets and produce findings.', 'spreadsheet', ['analysis']],
  ['seo_optimizer', 'operations', 'SEO Optimizer', 'Audit pages and suggest SEO improvements.', 'report', ['seo']],
  ['document_writer', 'office', 'Document Writer', 'Draft structured documents and summaries.', 'document', ['docs']],
  ['email_handler', 'office', 'Email Handler', 'Triage, draft, and summarize email work.', 'document', ['email']],
  ['calendar_manager', 'office', 'Calendar Manager', 'Plan schedules and meeting follow-ups.', 'json', ['calendar']],
  ['meeting_note_taker', 'office', 'Meeting Note Taker', 'Turn meetings into notes and action items.', 'document', ['meeting']],
  ['browser_automation_worker', 'project', 'Browser Automation Worker', 'Operate browser tasks with verification logs.', 'browser_state', ['browser']],
  ['file_processor', 'project', 'File Processor', 'Inspect, transform, and organize workspace files.', 'file_bundle', ['files']],
  ['batch_renamer', 'project', 'Batch Renamer', 'Plan and execute safe batch rename operations.', 'report', ['files']],
  ['data_crawler', 'project', 'Data Crawler', 'Collect public data with source and rate-limit notes.', 'spreadsheet', ['data']],
]

const DEFAULT_AGENT_TEMPLATE_DEFINITIONS: DefaultAgentTemplateDefinition[] = defaultTemplateRows.map(([key, category, name, role, artifactType, tags]) => ({
  key,
  category,
  name,
  role,
  artifactType,
  tags,
  description: `${name} preset for the Agent employee factory.`,
}))

export function getDefaultAgentTemplateDefinitions(): DefaultAgentTemplateDefinition[] {
  return DEFAULT_AGENT_TEMPLATE_DEFINITIONS
}

export async function seedDefaultAgentTemplates(): Promise<AgentTemplatePackageRow[]> {
  const rows: AgentTemplatePackageRow[] = []
  for (const definition of DEFAULT_AGENT_TEMPLATE_DEFINITIONS) {
    const existing = await db.query.agentTemplatePackages.findFirst({
      where: eq(schema.agentTemplatePackages.templateKey, definition.key),
    })
    if (existing) {
      rows.push(existing)
      continue
    }
    rows.push(await createAgentTemplatePackage(defaultPackageFromDefinition(definition)))
  }
  return rows
}

export async function createAgentTemplatePackage(
  args: CreateAgentTemplatePackageArgs,
): Promise<AgentTemplatePackageRow> {
  const now = Date.now()
  const templateKey = normalizeTemplateKey(args.templateKey ?? args.name)
  const existing = await db.query.agentTemplatePackages.findFirst({
    where: eq(schema.agentTemplatePackages.templateKey, templateKey),
  })
  if (existing) throw new Error(`Agent template key already exists: ${templateKey}`)
  const row: AgentTemplatePackageRow = {
    id: newAgentTemplatePackageId(),
    templateKey,
    templateType: args.templateType,
    category: args.category ?? 'custom',
    name: normalizeRequired(args.name, 'name'),
    description: args.description?.trim() ?? '',
    role: args.role?.trim() ?? '',
    payload: args.payload ?? {},
    requiredSkillIds: uniqueStrings(args.requiredSkillIds ?? []),
    recommendedToolIds: uniqueStrings(args.recommendedToolIds ?? []),
    tags: uniqueStrings(args.tags ?? []),
    author: args.author?.trim() || 'User',
    source: args.source ?? 'user',
    visibility: args.visibility ?? 'private',
    marketplaceUrl: normalizeNullable(args.marketplaceUrl),
    status: args.status ?? 'draft',
    installCount: 0,
    rating: args.rating ?? null,
    createdByUserId: normalizeNullable(args.createdByUserId),
    createdAt: now,
    updatedAt: now,
  }
  validateTemplatePayload(row)
  await db.insert(schema.agentTemplatePackages).values(row)
  await auditTemplate(row, 'agent_template.create', 'allowed')
  return row
}

export async function listAgentTemplatePackages(
  args: ListAgentTemplatePackagesArgs = {},
): Promise<AgentTemplatePackageRow[]> {
  const filters: SQL[] = []
  if (args.templateType) filters.push(eq(schema.agentTemplatePackages.templateType, args.templateType))
  if (args.category) filters.push(eq(schema.agentTemplatePackages.category, args.category))
  if (args.source) filters.push(eq(schema.agentTemplatePackages.source, args.source))
  if (args.visibility) filters.push(eq(schema.agentTemplatePackages.visibility, args.visibility))
  if (args.status) filters.push(eq(schema.agentTemplatePackages.status, args.status))
  const rows = await db.query.agentTemplatePackages.findMany({
    where: filters.length ? and(...filters) : undefined,
    orderBy: [desc(schema.agentTemplatePackages.updatedAt)],
    limit: normalizeLimit(args.limit),
  })
  const query = args.query?.trim().toLowerCase()
  if (!query) return rows
  return rows.filter((row) =>
    [row.name, row.description, row.role, row.templateKey, ...row.tags]
      .join(' ')
      .toLowerCase()
      .includes(query),
  )
}

export async function publishAgentTemplatePackage(templateId: string): Promise<AgentTemplatePackageRow> {
  const template = await getRequiredAgentTemplatePackage(templateId)
  if (template.status === 'archived') throw new Error(`Cannot publish archived template: ${templateId}`)
  await db
    .update(schema.agentTemplatePackages)
    .set({
      status: 'published',
      visibility: template.visibility === 'private' ? 'public' : template.visibility,
      updatedAt: Date.now(),
    })
    .where(eq(schema.agentTemplatePackages.id, templateId))
  const row = await getRequiredAgentTemplatePackage(templateId)
  await auditTemplate(row, 'agent_template.publish', 'allowed')
  return row
}

export async function installAgentTemplatePackage(
  templateId: string,
  args: InstallAgentTemplatePackageArgs = {},
): Promise<InstallAgentTemplatePackageResult> {
  const template = await getRequiredAgentTemplatePackage(templateId)
  if (template.status !== 'published') throw new Error(`Template must be published before install: ${templateId}`)
  const installedByUserId = normalizeNullable(args.installedByUserId)
  if (installedByUserId) {
    const user = await db.query.teamUsers.findFirst({ where: eq(schema.teamUsers.id, installedByUserId) })
    if (!user) throw new Error(`Team user not found: ${installedByUserId}`)
  }

  let createdAgentProfile: AgentProfileRow | null = null
  const materializedPayload = applyVariables(template.payload, args.variables ?? {})
  const result: JsonObject = {
    templateKey: template.templateKey,
    templateType: template.templateType,
    variables: args.variables ?? {},
    warnings: [] as string[],
  }

  if (template.templateType === 'agent_profile') {
    createdAgentProfile = await createAgentProfile(
      agentProfileArgsFromPayload(template, materializedPayload, args.targetName),
    )
    result.createdAgentProfileId = createdAgentProfile.id
  } else {
    result.recordOnly = true
    result.message = `${template.templateType} templates are registered as install records in v1.`
  }

  const install: AgentTemplateInstallRow = {
    id: newAgentTemplateInstallId(),
    templateId: template.id,
    installedByUserId,
    targetType: template.templateType,
    status: 'installed',
    createdAgentProfileId: createdAgentProfile?.id ?? null,
    createdWorkflowId: null,
    result,
    createdAt: Date.now(),
  }
  await db.insert(schema.agentTemplateInstalls).values(install)
  await db
    .update(schema.agentTemplatePackages)
    .set({ installCount: template.installCount + 1, updatedAt: Date.now() })
    .where(eq(schema.agentTemplatePackages.id, template.id))
  await auditTemplate(template, 'agent_template.install', 'allowed', install.id, {
    installId: install.id,
    createdAgentProfileId: createdAgentProfile?.id ?? null,
  })
  return {
    install,
    template: await getRequiredAgentTemplatePackage(template.id),
    createdAgentProfile,
  }
}

export async function listAgentTemplateInstalls(args: {
  templateId?: string
  installedByUserId?: string
  targetType?: AgentTemplatePackageType
  limit?: number
} = {}): Promise<AgentTemplateInstallRow[]> {
  const filters: SQL[] = []
  if (args.templateId) filters.push(eq(schema.agentTemplateInstalls.templateId, args.templateId))
  if (args.installedByUserId) filters.push(eq(schema.agentTemplateInstalls.installedByUserId, args.installedByUserId))
  if (args.targetType) filters.push(eq(schema.agentTemplateInstalls.targetType, args.targetType))
  return db.query.agentTemplateInstalls.findMany({
    where: filters.length ? and(...filters) : undefined,
    orderBy: [desc(schema.agentTemplateInstalls.createdAt)],
    limit: normalizeLimit(args.limit),
  })
}

async function getRequiredAgentTemplatePackage(templateId: string): Promise<AgentTemplatePackageRow> {
  const row = await db.query.agentTemplatePackages.findFirst({
    where: eq(schema.agentTemplatePackages.id, templateId),
  })
  if (!row) throw new Error(`Agent template package not found: ${templateId}`)
  return row
}

function defaultPackageFromDefinition(
  definition: DefaultAgentTemplateDefinition,
): CreateAgentTemplatePackageArgs {
  return {
    templateKey: definition.key,
    templateType: 'agent_profile',
    category: definition.category,
    name: definition.name,
    role: definition.role,
    description: definition.description,
    payload: {
      name: definition.name,
      role: definition.role,
      description: definition.description,
      systemPrompt: `You are a ${definition.name}. Produce concrete, verifiable work products.`,
      behaviorRules: [
        'Clarify hidden assumptions in the plan before executing.',
        'Use assigned tools conservatively and record evidence.',
        'Return a concise completion summary with artifacts.',
      ],
      successCriteria: [
        'Task goal is satisfied.',
        'Required artifact contract is present.',
        'Verification notes are included.',
      ],
      outputContract: {
        artifactType: definition.artifactType,
        validationRules: ['must_have_summary', 'must_have_artifact_reference'],
      },
      permissionPolicy: {
        canReadFiles: true,
        canWriteWorkspace: true,
        canRunCommands: definition.category === 'development',
        canUseBrowser: definition.category === 'project' || definition.category === 'operations',
      },
      autonomyPolicy: {
        autonomyLevel: 'execute_low_risk',
      },
    },
    tags: [definition.category, ...definition.tags],
    author: 'Reasonix',
    source: 'system',
    visibility: 'public',
    status: 'published',
  }
}

function validateTemplatePayload(template: AgentTemplatePackageRow): void {
  if (template.templateType === 'agent_profile') {
    const payload = template.payload
    if (!asString(payload.role) && !template.role) {
      throw new Error('Agent profile template requires role in payload or template metadata.')
    }
  }
}

function agentProfileArgsFromPayload(
  template: AgentTemplatePackageRow,
  payload: JsonObject,
  targetName?: string | null,
): CreateAgentProfileArgs {
  return {
    name: normalizeNullable(targetName) ?? asString(payload.name) ?? template.name,
    role: (asString(payload.role) ?? template.role) || template.name,
    description: asString(payload.description) ?? template.description,
    modelProfileId: asNullableString(payload.modelProfileId),
    fallbackModelProfileIds: asStringArray(payload.fallbackModelProfileIds),
    skillIds: uniqueStrings([...template.requiredSkillIds, ...asStringArray(payload.skillIds)]),
    mcpServerIds: asStringArray(payload.mcpServerIds),
    cliProfileIds: asStringArray(payload.cliProfileIds),
    softwareProfileIds: asStringArray(payload.softwareProfileIds),
    memoryPolicy: asJsonObject(payload.memoryPolicy),
    autonomyPolicy: asJsonObject(payload.autonomyPolicy),
    workstationPolicy: asJsonObject(payload.workstationPolicy),
    permissionPolicy: asJsonObject(payload.permissionPolicy),
    inputContract: asJsonObject(payload.inputContract),
    outputContract: Object.keys(asJsonObject(payload.outputContract)).length
      ? asJsonObject(payload.outputContract)
      : { artifactType: 'report', validationRules: ['must_have_summary'] },
    systemPrompt: asString(payload.systemPrompt) ?? '',
    behaviorRules: asStringArray(payload.behaviorRules),
    successCriteria: asStringArray(payload.successCriteria),
    status: 'draft',
  }
}

function applyVariables(value: unknown, variables: JsonObject): JsonObject {
  return applyVariablesValue(value, variables) as JsonObject
}

function applyVariablesValue(value: unknown, variables: JsonObject): unknown {
  if (typeof value === 'string') {
    return Object.entries(variables).reduce((current, [key, replacement]) => {
      if (typeof replacement === 'object') return current
      return current.replaceAll(`{{${key}}}`, String(replacement))
    }, value)
  }
  if (Array.isArray(value)) return value.map((item) => applyVariablesValue(item, variables))
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) => [
        key,
        applyVariablesValue(item, variables),
      ]),
    )
  }
  return value
}

async function auditTemplate(
  template: AgentTemplatePackageRow,
  action: string,
  status: 'allowed' | 'blocked' | 'warning',
  resourceId = template.id,
  metadata: JsonObject = {},
): Promise<void> {
  await recordAuditLog({
    actorType: 'system',
    action,
    resourceType: 'agent_template_package',
    resourceId,
    status,
    riskLevel: status === 'blocked' ? 'high' : 'low',
    message: `${template.name} ${action}.`,
    metadata: {
      templateId: template.id,
      templateKey: template.templateKey,
      templateType: template.templateType,
      source: template.source,
      ...metadata,
    },
  })
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function asNullableString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? uniqueStrings(value.filter((item): item is string => typeof item === 'string')) : []
}

function asJsonObject(value: unknown): JsonObject {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : {}
}

function normalizeTemplateKey(value: string): string {
  return normalizeRequired(value, 'templateKey')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
}

function normalizeRequired(value: string, field: string): string {
  const trimmed = value.trim()
  if (!trimmed) throw new Error(`${field} is required`)
  return trimmed
}

function normalizeNullable(value: string | null | undefined): string | null {
  const trimmed = value?.trim()
  return trimmed ? trimmed : null
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)))
}

function normalizeLimit(limit: number | undefined): number {
  return Math.min(Math.max(limit ?? 100, 1), 500)
}
