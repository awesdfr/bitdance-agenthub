import { asc, desc, eq } from 'drizzle-orm'

import { db, schema } from '@/db/client'
import type {
  AgentProfileRow,
  JsonObject,
  MemoryItemRow,
  MigrationCompatibilityStatus,
  MigrationImportRecordRow,
  MigrationImportResult,
  MigrationImportTargetType,
  MigrationSourceTool,
  MigrationWizardSessionRow,
  WorkflowRow,
} from '@/db/schema'
import { newMigrationImportRecordId, newMigrationWizardSessionId, newWorkflowNodeId } from '@/server/ids'
import { createAgentProfile, createMemoryItem, createWorkflow } from '@/server/control-plane-service'

type MigrationMode = 'dry_run' | 'import'

interface CompatibilityCheck {
  code: string
  status: MigrationCompatibilityStatus
  message: string
}

interface CompatibilityAnalysis {
  compatibilityStatus: MigrationCompatibilityStatus
  report: JsonObject
}

export interface MigrationImportSummary {
  session: MigrationWizardSessionRow
  records: MigrationImportRecordRow[]
  createdAgentProfiles: AgentProfileRow[]
  createdMemoryItems: MemoryItemRow[]
  createdWorkflows: WorkflowRow[]
  dryRun: boolean
}

export async function checkMigrationCompatibility(args: {
  sourceTool: MigrationSourceTool
  sourceName?: string
  payload: JsonObject
}): Promise<MigrationWizardSessionRow> {
  const analysis = analyzeCompatibility(args.sourceTool, args.payload)
  const now = Date.now()
  const row = {
    id: newMigrationWizardSessionId(),
    sourceTool: args.sourceTool,
    sourceName: args.sourceName?.trim() ?? '',
    status: 'checked' as const,
    compatibilityStatus: analysis.compatibilityStatus,
    sourcePayload: args.payload,
    compatibilityReport: analysis.report,
    importedCounts: {},
    createdAt: now,
    updatedAt: now,
    importedAt: null,
  }
  await db.insert(schema.migrationWizardSessions).values(row)
  return row
}

export async function listMigrationWizardSessions(args: {
  sourceTool?: MigrationSourceTool
} = {}): Promise<MigrationWizardSessionRow[]> {
  return db.query.migrationWizardSessions.findMany({
    where: args.sourceTool ? eq(schema.migrationWizardSessions.sourceTool, args.sourceTool) : undefined,
    orderBy: [desc(schema.migrationWizardSessions.updatedAt)],
    limit: 100,
  })
}

export async function listMigrationImportRecords(args: {
  sessionId?: string
} = {}): Promise<MigrationImportRecordRow[]> {
  return db.query.migrationImportRecords.findMany({
    where: args.sessionId ? eq(schema.migrationImportRecords.sessionId, args.sessionId) : undefined,
    orderBy: [asc(schema.migrationImportRecords.createdAt)],
    limit: 200,
  })
}

export async function importMigrationSession(
  sessionId: string,
  args: { mode?: MigrationMode } = {},
): Promise<MigrationImportSummary> {
  const session = await getRequiredMigrationSession(sessionId)
  if (session.compatibilityStatus === 'blocked') {
    throw new Error('Migration compatibility check is blocked and cannot be imported.')
  }
  const mode = args.mode ?? 'import'
  const result = await importBySourceTool(session, mode)
  const importedCounts = {
    agentProfiles: result.createdAgentProfiles.length,
    memoryItems: result.createdMemoryItems.length,
    workflows: result.createdWorkflows.length,
    manualMappings: result.records.filter((record) => record.targetType === 'manual_mapping').length,
    records: result.records.length,
    dryRun: mode === 'dry_run',
  }
  const now = Date.now()
  await db
    .update(schema.migrationWizardSessions)
    .set({
      status: mode === 'dry_run' ? 'checked' : 'imported',
      importedCounts,
      updatedAt: now,
      importedAt: mode === 'dry_run' ? session.importedAt : now,
    })
    .where(eq(schema.migrationWizardSessions.id, session.id))
  const updatedSession = await getRequiredMigrationSession(session.id)
  return {
    session: updatedSession,
    ...result,
    dryRun: mode === 'dry_run',
  }
}

async function getRequiredMigrationSession(id: string): Promise<MigrationWizardSessionRow> {
  const row = await db.query.migrationWizardSessions.findFirst({
    where: eq(schema.migrationWizardSessions.id, id),
  })
  if (!row) throw new Error(`Migration wizard session not found: ${id}`)
  return row
}

async function importBySourceTool(
  session: MigrationWizardSessionRow,
  mode: MigrationMode,
): Promise<Omit<MigrationImportSummary, 'session' | 'dryRun'>> {
  if (session.sourceTool === 'autogpt') return importAutoGpt(session, mode)
  if (session.sourceTool === 'crewai') return importCrewAi(session, mode)
  if (session.sourceTool === 'langchain') return importLangChain(session, mode)
  return importCsv(session, mode)
}

async function importAutoGpt(
  session: MigrationWizardSessionRow,
  mode: MigrationMode,
): Promise<Omit<MigrationImportSummary, 'session' | 'dryRun'>> {
  const agents = objectsAt(session.sourcePayload, ['agents'])
  const memories = objectsAt(session.sourcePayload, ['memory'], ['memories'])
  const records: MigrationImportRecordRow[] = []
  const createdAgentProfiles: AgentProfileRow[] = []
  const createdMemoryItems: MemoryItemRow[] = []
  const byName = new Map<string, AgentProfileRow>()

  for (const [index, agent] of agents.entries()) {
    const sourceId = sourceIdFor(agent, index)
    if (mode === 'dry_run') {
      records.push(await recordMigration(session, sourceId, 'agent_profile', null, 'planned', agent))
      continue
    }
    const created = await createAgentProfile({
      name: stringAt(agent.name) ?? `AutoGPT Agent ${index + 1}`,
      role: stringAt(agent.role) ?? stringAt(agent.goal) ?? 'Migrated AutoGPT Agent',
      description: `Migrated from AutoGPT source ${sourceId}. ${stringAt(agent.description) ?? ''}`.trim(),
      systemPrompt: stringAt(agent.systemPrompt) ?? stringAt(agent.prompt) ?? '',
      memoryPolicy: { migratedFrom: 'autogpt', sourceId },
      outputContract: { artifactType: 'report', validationRules: ['migrated_autogpt_agent'] },
      status: 'draft',
    })
    createdAgentProfiles.push(created)
    byName.set(created.name.toLowerCase(), created)
    records.push(await recordMigration(session, sourceId, 'agent_profile', created.id, 'created', agent))
  }

  for (const [index, memory] of memories.entries()) {
    const sourceId = sourceIdFor(memory, index)
    const agentName = stringAt(memory.agentName) ?? stringAt(memory.agent)
    const matchedAgent = agentName ? byName.get(agentName.toLowerCase()) : undefined
    if (mode === 'dry_run') {
      records.push(await recordMigration(session, sourceId, 'memory_item', null, 'planned', memory))
      continue
    }
    const created = await createMemoryItem({
      agentProfileId: matchedAgent?.id ?? null,
      scope: matchedAgent ? 'agent' : 'workspace',
      type: memoryType(memory.type),
      title: `[AutoGPT] ${stringAt(memory.title) ?? stringAt(memory.key) ?? `Memory ${index + 1}`}`,
      content: `Source: AutoGPT\nSource ID: ${sourceId}\n${stringAt(memory.content) ?? stringAt(memory.value) ?? ''}`,
      confidence: numberAt(memory.confidence) ?? 0.8,
      importance: numberAt(memory.importance) ?? 0.6,
    })
    createdMemoryItems.push(created)
    records.push(await recordMigration(session, sourceId, 'memory_item', created.id, 'created', memory))
  }

  return { records, createdAgentProfiles, createdMemoryItems, createdWorkflows: [] }
}

async function importCrewAi(
  session: MigrationWizardSessionRow,
  mode: MigrationMode,
): Promise<Omit<MigrationImportSummary, 'session' | 'dryRun'>> {
  const agents = objectsAt(session.sourcePayload, ['crew', 'agents'], ['agents'])
  const tasks = objectsAt(session.sourcePayload, ['crew', 'tasks'], ['tasks'])
  const records: MigrationImportRecordRow[] = []
  const createdAgentProfiles: AgentProfileRow[] = []
  const createdWorkflows: WorkflowRow[] = []

  if (mode === 'dry_run') {
    for (const [index, agent] of agents.entries()) {
      records.push(await recordMigration(session, sourceIdFor(agent, index), 'agent_profile', null, 'planned', agent))
    }
    records.push(await recordMigration(session, 'crewai-workflow', 'workflow', null, 'planned', { agents, tasks }))
    return { records, createdAgentProfiles, createdMemoryItems: [], createdWorkflows }
  }

  for (const [index, agent] of agents.entries()) {
    const sourceId = sourceIdFor(agent, index)
    const created = await createAgentProfile({
      name: stringAt(agent.name) ?? `CrewAI Agent ${index + 1}`,
      role: stringAt(agent.role) ?? 'Migrated CrewAI role',
      description: `Migrated from CrewAI source ${sourceId}. ${stringAt(agent.backstory) ?? ''}`.trim(),
      systemPrompt: stringAt(agent.goal) ?? '',
      memoryPolicy: { migratedFrom: 'crewai', sourceId },
      outputContract: { artifactType: 'report', validationRules: ['migrated_crewai_agent'] },
      status: 'draft',
    })
    createdAgentProfiles.push(created)
    records.push(await recordMigration(session, sourceId, 'agent_profile', created.id, 'created', agent))
  }

  const agentNodeIds = createdAgentProfiles.map(() => newWorkflowNodeId())
  const taskNodeIds = tasks.map(() => newWorkflowNodeId())
  const workflow = await createWorkflow({
    name: `${session.sourceName || 'CrewAI'} migrated workflow`,
    description: 'CrewAI crew configuration mapped into a Reasonix workflow.',
    status: 'draft',
    nodes: [
      ...createdAgentProfiles.map((agent, index) => ({
        id: agentNodeIds[index],
        type: 'agent_employee',
        agentProfileId: agent.id,
        position: { x: 80, y: 80 + index * 120 },
        config: { migratedFrom: 'crewai', sourceAgentIndex: index },
        outputContract: { artifactType: 'report', validationRules: ['migrated_crewai_agent'] },
      })),
      ...tasks.map((task, index) => ({
        id: taskNodeIds[index],
        type: 'artifact_transform',
        position: { x: 420, y: 80 + index * 120 },
        config: {
          migratedFrom: 'crewai',
          description: stringAt(task.description) ?? '',
          expectedOutput: stringAt(task.expectedOutput) ?? stringAt(task.expected_output) ?? '',
        },
        outputContract: { artifactType: 'report', validationRules: ['migrated_crewai_task'] },
      })),
    ],
    edges: [
      ...taskNodeIds.map((taskNodeId, index) => ({
        sourceNodeId: agentNodeIds[index % Math.max(agentNodeIds.length, 1)],
        targetNodeId: taskNodeId,
        mapping: { migratedFrom: 'crewai', relation: 'agent_to_task' },
      })),
      ...taskNodeIds.slice(0, -1).map((taskNodeId, index) => ({
        sourceNodeId: taskNodeId,
        targetNodeId: taskNodeIds[index + 1],
        mapping: { migratedFrom: 'crewai', relation: 'task_sequence' },
      })),
    ],
  })
  createdWorkflows.push(workflow)
  records.push(await recordMigration(session, 'crewai-workflow', 'workflow', workflow.id, 'created', { agents, tasks }))
  return { records, createdAgentProfiles, createdMemoryItems: [], createdWorkflows }
}

async function importLangChain(
  session: MigrationWizardSessionRow,
  mode: MigrationMode,
): Promise<Omit<MigrationImportSummary, 'session' | 'dryRun'>> {
  const chains = objectsAt(session.sourcePayload, ['chains'])
  const tools = objectsAt(session.sourcePayload, ['tools'])
  const records: MigrationImportRecordRow[] = []
  const result: MigrationImportResult = mode === 'dry_run' ? 'planned' : 'created'
  for (const [index, chain] of chains.entries()) {
    records.push(
      await recordMigration(session, sourceIdFor(chain, index), 'manual_mapping', null, result, {
        ...chain,
        mappingMode: 'langchain_chain_manual_or_api',
      }),
    )
  }
  for (const [index, tool] of tools.entries()) {
    records.push(
      await recordMigration(session, `tool:${sourceIdFor(tool, index)}`, 'manual_mapping', null, result, {
        ...tool,
        mappingMode: 'langchain_tool_manual_or_api',
      }),
    )
  }
  return { records, createdAgentProfiles: [], createdMemoryItems: [], createdWorkflows: [] }
}

async function importCsv(
  session: MigrationWizardSessionRow,
  mode: MigrationMode,
): Promise<Omit<MigrationImportSummary, 'session' | 'dryRun'>> {
  const rows = objectsAt(session.sourcePayload, ['rows'], ['data'])
  const records: MigrationImportRecordRow[] = []
  const createdAgentProfiles: AgentProfileRow[] = []
  const createdMemoryItems: MemoryItemRow[] = []
  const byName = new Map<string, AgentProfileRow>()

  for (const [index, row] of rows.entries()) {
    const sourceId = sourceIdFor(row, index)
    const rowType = stringAt(row.type)?.toLowerCase()
    if (rowType === 'agent') {
      if (mode === 'dry_run') {
        records.push(await recordMigration(session, sourceId, 'agent_profile', null, 'planned', row))
        continue
      }
      const created = await createAgentProfile({
        name: stringAt(row.name) ?? `CSV Agent ${index + 1}`,
        role: stringAt(row.role) ?? 'Migrated CSV Agent',
        description: `Migrated from CSV source ${sourceId}. ${stringAt(row.description) ?? ''}`.trim(),
        systemPrompt: stringAt(row.systemPrompt) ?? stringAt(row.prompt) ?? '',
        memoryPolicy: { migratedFrom: 'csv', sourceId },
        outputContract: { artifactType: 'report', validationRules: ['migrated_csv_agent'] },
        status: 'draft',
      })
      createdAgentProfiles.push(created)
      byName.set(created.name.toLowerCase(), created)
      records.push(await recordMigration(session, sourceId, 'agent_profile', created.id, 'created', row))
    }
  }

  for (const [index, row] of rows.entries()) {
    const rowType = stringAt(row.type)?.toLowerCase()
    if (rowType !== 'memory') continue
    const sourceId = sourceIdFor(row, index)
    const agentName = stringAt(row.agentName) ?? stringAt(row.agent)
    const matchedAgent = agentName ? byName.get(agentName.toLowerCase()) : undefined
    if (mode === 'dry_run') {
      records.push(await recordMigration(session, sourceId, 'memory_item', null, 'planned', row))
      continue
    }
    const created = await createMemoryItem({
      agentProfileId: matchedAgent?.id ?? null,
      scope: matchedAgent ? 'agent' : 'workspace',
      type: memoryType(row.memoryType ?? row.typeHint),
      title: `[CSV] ${stringAt(row.title) ?? stringAt(row.name) ?? `Memory ${index + 1}`}`,
      content: `Source: CSV\nSource ID: ${sourceId}\n${stringAt(row.content) ?? stringAt(row.value) ?? ''}`,
      confidence: numberAt(row.confidence) ?? 0.75,
      importance: numberAt(row.importance) ?? 0.5,
    })
    createdMemoryItems.push(created)
    records.push(await recordMigration(session, sourceId, 'memory_item', created.id, 'created', row))
  }
  return { records, createdAgentProfiles, createdMemoryItems, createdWorkflows: [] }
}

async function recordMigration(
  session: MigrationWizardSessionRow,
  sourceId: string,
  targetType: MigrationImportTargetType,
  targetId: string | null,
  result: MigrationImportResult,
  payload: JsonObject,
): Promise<MigrationImportRecordRow> {
  const now = Date.now()
  const row = {
    id: newMigrationImportRecordId(),
    sessionId: session.id,
    sourceTool: session.sourceTool,
    sourceId,
    targetType,
    targetId,
    sourceTag: `${session.sourceTool}:${sourceId}`,
    result,
    payload: {
      ...payload,
      migratedFrom: session.sourceTool,
    },
    message: targetId
      ? `Mapped ${session.sourceTool} source ${sourceId} to ${targetType}:${targetId}.`
      : `Prepared ${session.sourceTool} source ${sourceId} for ${targetType} mapping.`,
    createdAt: now,
  }
  await db.insert(schema.migrationImportRecords).values(row)
  return row
}

function analyzeCompatibility(sourceTool: MigrationSourceTool, payload: JsonObject): CompatibilityAnalysis {
  if (sourceTool === 'autogpt') return analyzeAutoGpt(payload)
  if (sourceTool === 'crewai') return analyzeCrewAi(payload)
  if (sourceTool === 'langchain') return analyzeLangChain(payload)
  return analyzeCsv(payload)
}

function analyzeAutoGpt(payload: JsonObject): CompatibilityAnalysis {
  const agents = objectsAt(payload, ['agents'])
  const memories = objectsAt(payload, ['memory'], ['memories'])
  const checks: CompatibilityCheck[] = [
    check('autogpt.agents', agents.length > 0 ? 'compatible' : 'blocked', `${agents.length} AutoGPT agents detected.`),
    check('autogpt.memory', memories.length > 0 ? 'compatible' : 'warning', `${memories.length} AutoGPT memories detected.`),
  ]
  return reportFromChecks('autogpt', checks, {
    agentProfiles: agents.length,
    memoryItems: memories.length,
    sourceTags: true,
  })
}

function analyzeCrewAi(payload: JsonObject): CompatibilityAnalysis {
  const agents = objectsAt(payload, ['crew', 'agents'], ['agents'])
  const tasks = objectsAt(payload, ['crew', 'tasks'], ['tasks'])
  const process = stringAt(readPath(payload, ['crew', 'process'])) ?? stringAt(payload.process)
  const checks: CompatibilityCheck[] = [
    check('crewai.agents', agents.length > 0 ? 'compatible' : 'blocked', `${agents.length} CrewAI agents detected.`),
    check('crewai.tasks', tasks.length > 0 ? 'compatible' : 'blocked', `${tasks.length} CrewAI tasks detected.`),
    check(
      'crewai.process',
      process && !['sequential', 'hierarchical'].includes(process) ? 'warning' : 'compatible',
      process ? `CrewAI process ${process} will be mapped into workflow edges.` : 'No process mode supplied; sequential edges will be used.',
    ),
  ]
  return reportFromChecks('crewai', checks, {
    agentProfiles: agents.length,
    workflowNodes: agents.length + tasks.length,
    workflowEdges: Math.max(0, tasks.length - 1) + tasks.length,
  })
}

function analyzeLangChain(payload: JsonObject): CompatibilityAnalysis {
  const chains = objectsAt(payload, ['chains'])
  const tools = objectsAt(payload, ['tools'])
  const checks: CompatibilityCheck[] = [
    check(
      'langchain.definitions',
      chains.length + tools.length > 0 ? 'warning' : 'blocked',
      `${chains.length} chains and ${tools.length} tools detected; API connector or manual mapping review is required.`,
    ),
  ]
  return reportFromChecks('langchain', checks, {
    manualMappings: chains.length + tools.length,
    requiresApiOrManualMapping: true,
  })
}

function analyzeCsv(payload: JsonObject): CompatibilityAnalysis {
  const rows = objectsAt(payload, ['rows'], ['data'])
  const agentRows = rows.filter((row) => stringAt(row.type)?.toLowerCase() === 'agent')
  const memoryRows = rows.filter((row) => stringAt(row.type)?.toLowerCase() === 'memory')
  const invalidRows = rows.length - agentRows.length - memoryRows.length
  const checks: CompatibilityCheck[] = [
    check('csv.rows', rows.length > 0 ? 'compatible' : 'blocked', `${rows.length} CSV rows detected.`),
    check('csv.typed_rows', invalidRows === 0 ? 'compatible' : 'warning', `${invalidRows} rows have unsupported type.`),
  ]
  return reportFromChecks('csv', checks, {
    agentProfiles: agentRows.length,
    memoryItems: memoryRows.length,
    invalidRows,
  })
}

function reportFromChecks(
  sourceTool: MigrationSourceTool,
  checks: CompatibilityCheck[],
  mappingPreview: JsonObject,
): CompatibilityAnalysis {
  const compatibilityStatus = statusFromChecks(checks)
  return {
    compatibilityStatus,
    report: {
      sourceTool,
      compatibilityStatus,
      checks,
      mappingPreview,
      importPlan: buildImportPlan(sourceTool, mappingPreview),
    },
  }
}

function buildImportPlan(sourceTool: MigrationSourceTool, mappingPreview: JsonObject): JsonObject[] {
  if (sourceTool === 'autogpt') {
    return [
      { targetType: 'agent_profile', count: mappingPreview.agentProfiles ?? 0 },
      { targetType: 'memory_item', count: mappingPreview.memoryItems ?? 0, sourceTagged: true },
    ]
  }
  if (sourceTool === 'crewai') {
    return [{ targetType: 'workflow', nodeCount: mappingPreview.workflowNodes ?? 0 }]
  }
  if (sourceTool === 'langchain') {
    return [{ targetType: 'manual_mapping', count: mappingPreview.manualMappings ?? 0 }]
  }
  return [
    { targetType: 'agent_profile', count: mappingPreview.agentProfiles ?? 0 },
    { targetType: 'memory_item', count: mappingPreview.memoryItems ?? 0, sourceTagged: true },
  ]
}

function statusFromChecks(checks: CompatibilityCheck[]): MigrationCompatibilityStatus {
  if (checks.some((item) => item.status === 'blocked')) return 'blocked'
  if (checks.some((item) => item.status === 'warning')) return 'warning'
  return 'compatible'
}

function check(code: string, status: MigrationCompatibilityStatus, message: string): CompatibilityCheck {
  return { code, status, message }
}

function objectsAt(payload: JsonObject, ...paths: string[][]): JsonObject[] {
  for (const path of paths) {
    const value = readPath(payload, path)
    if (Array.isArray(value)) return value.filter(isPlainObject)
  }
  return []
}

function readPath(payload: JsonObject, path: string[]): unknown {
  let current: unknown = payload
  for (const part of path) {
    if (!isPlainObject(current)) return undefined
    current = current[part]
  }
  return current
}

function isPlainObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function stringAt(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function numberAt(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function sourceIdFor(value: JsonObject, index: number): string {
  return stringAt(value.id) ?? stringAt(value.name) ?? stringAt(value.key) ?? String(index + 1)
}

function memoryType(value: unknown): MemoryItemRow['type'] {
  const normalized = stringAt(value)?.toLowerCase()
  if (
    normalized === 'episodic' ||
    normalized === 'semantic' ||
    normalized === 'procedural' ||
    normalized === 'project' ||
    normalized === 'customer' ||
    normalized === 'software' ||
    normalized === 'mistake' ||
    normalized === 'success'
  ) {
    return normalized
  }
  return 'semantic'
}
