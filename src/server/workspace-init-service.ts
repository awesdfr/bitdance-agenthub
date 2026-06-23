import { and, asc, desc, eq, type SQL } from 'drizzle-orm'

import { db, schema } from '@/db/client'
import type {
  JsonObject,
  WorkspaceInitRunRow,
  WorkspaceInitRunStatus,
  WorkspaceSetupFailPolicy,
  WorkspaceStructure,
  WorkspaceTemplateRow,
} from '@/db/schema'
import { newWorkspaceInitRunId, newWorkspaceTemplateId } from '@/server/ids'

export type WorkspaceInitSource =
  | { type: 'git'; url: string; branch?: string | null; depth?: number | null }
  | { type: 'local'; path: string }
  | { type: 'template'; templateId: string }
  | { type: 'empty'; structure: WorkspaceStructure }

export interface WorkspaceSetupConfig {
  installDeps?: boolean
  runMigrations?: boolean
  seedData?: string | null
  linkSharedModules?: boolean
}

export interface WorkspaceVerifyConfig {
  runTests?: boolean
  checkTypes?: boolean
  lintCheck?: boolean
  buildCheck?: boolean
}

export interface CreateWorkspaceTemplateArgs {
  name: string
  structure: WorkspaceStructure
  description?: string
  fileTree?: JsonObject[]
  setupDefaults?: JsonObject
  verifyDefaults?: JsonObject
}

export interface PlanWorkspaceInitArgs {
  agentProfileId?: string | null
  employeeRunId?: string | null
  source: WorkspaceInitSource
  setup?: WorkspaceSetupConfig
  verify?: WorkspaceVerifyConfig
  onSetupFail?: WorkspaceSetupFailPolicy
  workspacePath?: string | null
}

export interface WorkspaceFailureDecision {
  policy: WorkspaceSetupFailPolicy
  status: WorkspaceInitRunStatus
  nextAction: 'abort_run' | 'retry_setup' | 'continue_with_warning' | 'ask_user'
  message: string
}

export async function createWorkspaceTemplate(
  args: CreateWorkspaceTemplateArgs,
): Promise<WorkspaceTemplateRow> {
  const now = Date.now()
  const row: WorkspaceTemplateRow = {
    id: newWorkspaceTemplateId(),
    name: normalizeRequired(args.name, 'name'),
    structure: args.structure,
    description: args.description?.trim() || '',
    fileTree: args.fileTree ?? [],
    setupDefaults: args.setupDefaults ?? {},
    verifyDefaults: args.verifyDefaults ?? {},
    status: 'active',
    createdAt: now,
    updatedAt: now,
  }
  await db.insert(schema.workspaceTemplates).values(row)
  return row
}

export async function listWorkspaceTemplates(args: {
  structure?: WorkspaceStructure
  status?: string
  limit?: number
} = {}): Promise<WorkspaceTemplateRow[]> {
  const conditions: SQL[] = []
  if (args.structure) conditions.push(eq(schema.workspaceTemplates.structure, args.structure))
  if (args.status) conditions.push(eq(schema.workspaceTemplates.status, args.status))
  return db.query.workspaceTemplates.findMany({
    where: conditions.length ? and(...conditions) : undefined,
    orderBy: [asc(schema.workspaceTemplates.structure), asc(schema.workspaceTemplates.name)],
    limit: args.limit ?? 100,
  })
}

export async function planWorkspaceInit(args: PlanWorkspaceInitArgs): Promise<WorkspaceInitRunRow> {
  const template =
    args.source.type === 'template'
      ? await getRequiredWorkspaceTemplate(args.source.templateId)
      : null
  const setup = normalizeSetup(args.setup)
  const verify = normalizeVerify(args.verify)
  const now = Date.now()
  const structure = resolveStructure(args.source, template)
  const row: WorkspaceInitRunRow = {
    id: newWorkspaceInitRunId(),
    agentProfileId: args.agentProfileId?.trim() || null,
    employeeRunId: args.employeeRunId?.trim() || null,
    sourceType: args.source.type,
    sourceConfig: sourceToConfig(args.source),
    structure,
    installDeps: setup.installDeps,
    runMigrations: setup.runMigrations,
    seedData: setup.seedData,
    linkSharedModules: setup.linkSharedModules,
    runTests: verify.runTests,
    checkTypes: verify.checkTypes,
    lintCheck: verify.lintCheck,
    buildCheck: verify.buildCheck,
    onSetupFail: args.onSetupFail ?? 'ask_user',
    status: 'planned',
    workspacePath: args.workspacePath?.trim() || null,
    actionPlan: buildActionPlan(args.source, setup, template),
    verificationPlan: buildVerificationPlan(verify),
    failureMessage: null,
    createdAt: now,
    updatedAt: now,
  }
  await db.insert(schema.workspaceInitRuns).values(row)
  return row
}

export async function listWorkspaceInitRuns(args: {
  sourceType?: WorkspaceInitRunRow['sourceType']
  status?: WorkspaceInitRunStatus
  agentProfileId?: string
  limit?: number
} = {}): Promise<WorkspaceInitRunRow[]> {
  const conditions: SQL[] = []
  if (args.sourceType) conditions.push(eq(schema.workspaceInitRuns.sourceType, args.sourceType))
  if (args.status) conditions.push(eq(schema.workspaceInitRuns.status, args.status))
  if (args.agentProfileId) conditions.push(eq(schema.workspaceInitRuns.agentProfileId, args.agentProfileId))
  return db.query.workspaceInitRuns.findMany({
    where: conditions.length ? and(...conditions) : undefined,
    orderBy: [desc(schema.workspaceInitRuns.createdAt)],
    limit: args.limit ?? 100,
  })
}

export async function resolveWorkspaceInitFailure(args: {
  workspaceInitRunId: string
  failureMessage: string
}): Promise<{ run: WorkspaceInitRunRow; decision: WorkspaceFailureDecision }> {
  const run = await getRequiredWorkspaceInitRun(args.workspaceInitRunId)
  const decision = failureDecision(run.onSetupFail, normalizeRequired(args.failureMessage, 'failureMessage'))
  await db
    .update(schema.workspaceInitRuns)
    .set({
      status: decision.status,
      failureMessage: decision.message,
      updatedAt: Date.now(),
    })
    .where(eq(schema.workspaceInitRuns.id, run.id))
  return {
    run: await getRequiredWorkspaceInitRun(run.id),
    decision,
  }
}

async function getRequiredWorkspaceTemplate(id: string): Promise<WorkspaceTemplateRow> {
  const template = await db.query.workspaceTemplates.findFirst({
    where: eq(schema.workspaceTemplates.id, id),
  })
  if (!template) throw new Error(`Workspace template not found: ${id}`)
  return template
}

async function getRequiredWorkspaceInitRun(id: string): Promise<WorkspaceInitRunRow> {
  const run = await db.query.workspaceInitRuns.findFirst({
    where: eq(schema.workspaceInitRuns.id, id),
  })
  if (!run) throw new Error(`Workspace init run not found: ${id}`)
  return run
}

function normalizeSetup(setup: WorkspaceSetupConfig | undefined): Required<WorkspaceSetupConfig> {
  return {
    installDeps: setup?.installDeps ?? false,
    runMigrations: setup?.runMigrations ?? false,
    seedData: setup?.seedData?.trim() || null,
    linkSharedModules: setup?.linkSharedModules ?? false,
  }
}

function normalizeVerify(verify: WorkspaceVerifyConfig | undefined): Required<WorkspaceVerifyConfig> {
  return {
    runTests: verify?.runTests ?? false,
    checkTypes: verify?.checkTypes ?? false,
    lintCheck: verify?.lintCheck ?? false,
    buildCheck: verify?.buildCheck ?? false,
  }
}

function resolveStructure(
  source: WorkspaceInitSource,
  template: WorkspaceTemplateRow | null,
): WorkspaceStructure | null {
  if (source.type === 'empty') return source.structure
  if (source.type === 'template') return template?.structure ?? null
  return null
}

function sourceToConfig(source: WorkspaceInitSource): JsonObject {
  if (source.type === 'git') {
    return {
      type: 'git',
      url: source.url,
      branch: source.branch ?? null,
      depth: source.depth ?? null,
    }
  }
  if (source.type === 'local') return { type: 'local', path: source.path }
  if (source.type === 'template') return { type: 'template', templateId: source.templateId }
  return { type: 'empty', structure: source.structure }
}

function buildActionPlan(
  source: WorkspaceInitSource,
  setup: Required<WorkspaceSetupConfig>,
  template: WorkspaceTemplateRow | null,
): JsonObject[] {
  const actions: JsonObject[] = [sourceAction(source, template)]
  if (setup.installDeps) {
    actions.push({ step: 'install_dependencies', execution: 'requires_cli_approval' })
  }
  if (setup.runMigrations) {
    actions.push({ step: 'run_migrations', execution: 'requires_cli_approval' })
  }
  if (setup.seedData) {
    actions.push({ step: 'seed_data', script: setup.seedData, execution: 'requires_cli_approval' })
  }
  if (setup.linkSharedModules) {
    actions.push({ step: 'link_shared_modules', execution: 'workspace_local' })
  }
  return actions
}

function sourceAction(source: WorkspaceInitSource, template: WorkspaceTemplateRow | null): JsonObject {
  if (source.type === 'git') {
    return {
      step: 'fetch_source',
      mode: 'git',
      url: source.url,
      branch: source.branch ?? null,
      depth: source.depth ?? null,
      execution: 'requires_network_and_cli_approval',
    }
  }
  if (source.type === 'local') {
    return {
      step: 'validate_local_source',
      mode: 'local',
      path: source.path,
      execution: 'read_only_preflight',
    }
  }
  if (source.type === 'template') {
    return {
      step: 'apply_template',
      mode: 'template',
      templateId: source.templateId,
      templateName: template?.name ?? null,
      execution: 'workspace_local',
    }
  }
  return {
    step: 'create_empty_structure',
    mode: 'empty',
    structure: source.structure,
    execution: 'workspace_local',
  }
}

function buildVerificationPlan(verify: Required<WorkspaceVerifyConfig>): JsonObject[] {
  const checks: JsonObject[] = []
  if (verify.runTests) checks.push({ check: 'run_tests', execution: 'requires_cli_approval' })
  if (verify.checkTypes) checks.push({ check: 'check_types', execution: 'requires_cli_approval' })
  if (verify.lintCheck) checks.push({ check: 'lint_check', execution: 'requires_cli_approval' })
  if (verify.buildCheck) checks.push({ check: 'build_check', execution: 'requires_cli_approval' })
  return checks
}

function failureDecision(
  policy: WorkspaceSetupFailPolicy,
  message: string,
): WorkspaceFailureDecision {
  if (policy === 'abort') {
    return { policy, status: 'failed', nextAction: 'abort_run', message }
  }
  if (policy === 'retry') {
    return { policy, status: 'planned', nextAction: 'retry_setup', message }
  }
  if (policy === 'skip_and_warn') {
    return { policy, status: 'warning', nextAction: 'continue_with_warning', message }
  }
  return { policy, status: 'awaiting_user', nextAction: 'ask_user', message }
}

function normalizeRequired(value: string, field: string): string {
  const trimmed = value.trim()
  if (!trimmed) throw new Error(`${field} is required`)
  return trimmed
}
