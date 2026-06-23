import { createHash } from 'node:crypto'

import { and, desc, eq } from 'drizzle-orm'

import { db, schema } from '@/db/client'
import type {
  ConfigEntityType,
  ConfigExportFormat,
  ConfigExportRow,
  ConfigImpactAnalysisRow,
  ConfigImpactLevel,
  ConfigVersionRow,
  JsonObject,
  McpToolDefinitionInsert,
  PlaybookVersionInsert,
  PromptTemplateVersionInsert,
  RecordedMacroInsert,
  SoftwareCommandInsert,
  WorkflowEdgeInsert,
  WorkflowNodeInsert,
} from '@/db/schema'
import {
  newConfigExportId,
  newConfigImpactAnalysisId,
  newConfigVersionId,
} from '@/server/ids'

export const CONFIG_ENTITY_TYPES: ConfigEntityType[] = [
  'agent_profile',
  'model_profile',
  'network_profile',
  'cli_profile',
  'mcp_server',
  'tool_connection',
  'software_profile',
  'software_command',
  'recorded_macro',
  'workflow',
  'prompt_template',
  'playbook',
]

export interface ConfigEntityRef {
  entityType: ConfigEntityType
  entityId: string
  versionId?: string | null
}

export interface CaptureConfigVersionArgs {
  entityType: ConfigEntityType
  entityId: string
  source?: ConfigVersionRow['source']
  changeSummary?: string
  createdBy?: string | null
}

export interface CreateConfigExportArgs {
  name: string
  format?: ConfigExportFormat
  entityRefs: ConfigEntityRef[]
}

export interface AnalyzeConfigImpactArgs {
  entityType: ConfigEntityType
  entityId: string
  baseVersionId?: string | null
  proposedSnapshot?: JsonObject | null
}

export interface ApplyConfigVersionArgs {
  appliedBy?: string | null
  changeSummary?: string
}

export interface ApplyConfigVersionResult {
  appliedVersion: ConfigVersionRow
  rollbackVersion: ConfigVersionRow
  entityType: ConfigEntityType
  entityId: string
  displayName: string
  appliedHash: string
  rollbackHash: string
  changed: boolean
  summary: string
}

interface BuiltConfigSnapshot {
  displayName: string
  snapshot: JsonObject
}

export async function captureConfigVersion(
  args: CaptureConfigVersionArgs,
): Promise<ConfigVersionRow> {
  const built = await buildConfigSnapshot(args.entityType, args.entityId)
  const latest = await getLatestConfigVersion(args.entityType, args.entityId)
  const now = Date.now()
  const row = {
    id: newConfigVersionId(),
    entityType: args.entityType,
    entityId: args.entityId,
    version: (latest?.version ?? 0) + 1,
    displayName: built.displayName,
    source: args.source ?? 'manual',
    snapshot: built.snapshot,
    contentHash: hashConfig(built.snapshot),
    changeSummary: args.changeSummary?.trim() ?? '',
    createdBy: args.createdBy?.trim() || null,
    createdAt: now,
  }
  await db.insert(schema.configVersions).values(row)
  return row
}

export async function listConfigVersions(args: {
  entityType?: ConfigEntityType
  entityId?: string
  limit?: number
} = {}): Promise<ConfigVersionRow[]> {
  const rows = await db.query.configVersions.findMany({
    orderBy: [desc(schema.configVersions.createdAt)],
    limit: args.limit ?? 100,
  })
  return rows.filter((row) => {
    if (args.entityType && row.entityType !== args.entityType) return false
    if (args.entityId && row.entityId !== args.entityId) return false
    return true
  })
}

export async function applyConfigVersion(
  versionId: string,
  args: ApplyConfigVersionArgs = {},
): Promise<ApplyConfigVersionResult> {
  const version = await getRequiredConfigVersion(versionId)
  assertSnapshotMatchesVersion(version)
  const rollbackVersion = await captureConfigVersion({
    entityType: version.entityType,
    entityId: version.entityId,
    source: 'api',
    changeSummary:
      args.changeSummary?.trim() ||
      `Rollback snapshot before applying config version ${version.version}.`,
    createdBy: args.appliedBy ?? null,
  })
  await applyConfigSnapshot(version)
  return {
    appliedVersion: version,
    rollbackVersion,
    entityType: version.entityType,
    entityId: version.entityId,
    displayName: version.displayName,
    appliedHash: version.contentHash,
    rollbackHash: rollbackVersion.contentHash,
    changed: rollbackVersion.contentHash !== version.contentHash,
    summary: `Applied ${version.entityType}:${version.entityId} v${version.version}; rollback snapshot v${rollbackVersion.version} captured first.`,
  }
}

export async function createConfigExport(
  args: CreateConfigExportArgs,
): Promise<ConfigExportRow> {
  if (args.entityRefs.length === 0) throw new Error('Config export requires at least one entity.')
  const now = Date.now()
  const versions: ConfigVersionRow[] = []

  for (const ref of args.entityRefs) {
    if (ref.versionId) {
      versions.push(await getRequiredConfigVersion(ref.versionId))
      continue
    }
    versions.push(
      await captureConfigVersion({
        entityType: ref.entityType,
        entityId: ref.entityId,
        source: 'gitops_export',
        changeSummary: `Captured for export "${args.name.trim()}".`,
      }),
    )
  }

  const bundle: JsonObject = {
    schemaVersion: 1,
    product: 'bitdance-agenthub',
    exportedAt: now,
    format: args.format ?? 'gitops_bundle',
    entities: versions.map((version) => ({
      versionId: version.id,
      entityType: version.entityType,
      entityId: version.entityId,
      version: version.version,
      displayName: version.displayName,
      contentHash: version.contentHash,
      snapshot: version.snapshot,
    })),
  }
  const entityRefs = versions.map((version) => ({
    entityType: version.entityType,
    entityId: version.entityId,
    versionId: version.id,
    version: version.version,
    contentHash: version.contentHash,
  }))
  const row = {
    id: newConfigExportId(),
    name: args.name.trim(),
    format: args.format ?? 'gitops_bundle',
    entityRefs,
    bundle,
    contentHash: hashConfig(bundle),
    createdAt: now,
  }
  await db.insert(schema.configExports).values(row)
  return row
}

export async function listConfigExports(limit = 100): Promise<ConfigExportRow[]> {
  return db.query.configExports.findMany({
    orderBy: [desc(schema.configExports.createdAt)],
    limit,
  })
}

export async function analyzeConfigImpact(
  args: AnalyzeConfigImpactArgs,
): Promise<ConfigImpactAnalysisRow> {
  const built = args.proposedSnapshot
    ? { displayName: args.entityId, snapshot: args.proposedSnapshot }
    : await buildConfigSnapshot(args.entityType, args.entityId)
  const baseVersion = args.baseVersionId
    ? await getRequiredConfigVersion(args.baseVersionId)
    : await getLatestConfigVersion(args.entityType, args.entityId)
  const proposedHash = hashConfig(built.snapshot)
  const impactedRefs = await findImpactedRefs(args.entityType, args.entityId)
  const changed = baseVersion?.contentHash !== proposedHash
  const impactLevel = classifyImpact(changed, impactedRefs.length)
  const row = {
    id: newConfigImpactAnalysisId(),
    entityType: args.entityType,
    entityId: args.entityId,
    baseVersionId: baseVersion?.id ?? null,
    proposedHash,
    impactLevel,
    summary: summarizeImpact(args.entityType, args.entityId, changed, impactedRefs.length),
    impactedRefs,
    createdAt: Date.now(),
  }
  await db.insert(schema.configImpactAnalyses).values(row)
  return row
}

export async function listConfigImpactAnalyses(args: {
  entityType?: ConfigEntityType
  entityId?: string
  limit?: number
} = {}): Promise<ConfigImpactAnalysisRow[]> {
  const rows = await db.query.configImpactAnalyses.findMany({
    orderBy: [desc(schema.configImpactAnalyses.createdAt)],
    limit: args.limit ?? 100,
  })
  return rows.filter((row) => {
    if (args.entityType && row.entityType !== args.entityType) return false
    if (args.entityId && row.entityId !== args.entityId) return false
    return true
  })
}

async function buildConfigSnapshot(
  entityType: ConfigEntityType,
  entityId: string,
): Promise<BuiltConfigSnapshot> {
  switch (entityType) {
    case 'agent_profile': {
      const row = await db.query.agentProfiles.findFirst({ where: eq(schema.agentProfiles.id, entityId) })
      if (!row) throw new Error(`Agent profile not found: ${entityId}`)
      return {
        displayName: row.name,
        snapshot: {
          entityType,
          entityId,
          profile: row,
          dependencies: {
            modelProfileId: row.modelProfileId,
            fallbackModelProfileIds: row.fallbackModelProfileIds,
            skillIds: row.skillIds,
            mcpServerIds: row.mcpServerIds,
            cliProfileIds: row.cliProfileIds,
            softwareProfileIds: row.softwareProfileIds,
          },
        },
      }
    }
    case 'model_profile': {
      const row = await db.query.modelProfiles.findFirst({ where: eq(schema.modelProfiles.id, entityId) })
      if (!row) throw new Error(`Model profile not found: ${entityId}`)
      return { displayName: row.name, snapshot: { entityType, entityId, profile: row } }
    }
    case 'network_profile': {
      const row = await db.query.networkProfiles.findFirst({ where: eq(schema.networkProfiles.id, entityId) })
      if (!row) throw new Error(`Network profile not found: ${entityId}`)
      return { displayName: row.name, snapshot: { entityType, entityId, profile: row } }
    }
    case 'cli_profile': {
      const row = await db.query.cliProfiles.findFirst({ where: eq(schema.cliProfiles.id, entityId) })
      if (!row) throw new Error(`CLI profile not found: ${entityId}`)
      return { displayName: row.name, snapshot: { entityType, entityId, profile: row } }
    }
    case 'mcp_server': {
      const row = await db.query.mcpServers.findFirst({ where: eq(schema.mcpServers.id, entityId) })
      if (!row) throw new Error(`MCP server not found: ${entityId}`)
      const tools = await db.query.mcpToolDefinitions.findMany({
        where: eq(schema.mcpToolDefinitions.mcpServerId, entityId),
      })
      return {
        displayName: row.displayName,
        snapshot: { entityType, entityId, server: row, tools: sortById(tools) },
      }
    }
    case 'tool_connection': {
      const row = await db.query.toolConnections.findFirst({
        where: eq(schema.toolConnections.id, entityId),
      })
      if (!row) throw new Error(`Tool connection not found: ${entityId}`)
      return { displayName: row.displayName, snapshot: { entityType, entityId, connection: row } }
    }
    case 'software_profile': {
      const row = await db.query.softwareProfiles.findFirst({
        where: eq(schema.softwareProfiles.id, entityId),
      })
      if (!row) throw new Error(`Software profile not found: ${entityId}`)
      const commands = await db.query.softwareCommands.findMany({
        where: eq(schema.softwareCommands.softwareProfileId, entityId),
      })
      const macros = await db.query.recordedMacros.findMany({
        where: eq(schema.recordedMacros.softwareProfileId, entityId),
      })
      return {
        displayName: row.name,
        snapshot: {
          entityType,
          entityId,
          profile: row,
          commands: sortById(commands),
          macros: sortById(macros),
        },
      }
    }
    case 'software_command': {
      const row = await db.query.softwareCommands.findFirst({
        where: eq(schema.softwareCommands.id, entityId),
      })
      if (!row) throw new Error(`Software command not found: ${entityId}`)
      return { displayName: row.name, snapshot: { entityType, entityId, command: row } }
    }
    case 'recorded_macro': {
      const row = await db.query.recordedMacros.findFirst({ where: eq(schema.recordedMacros.id, entityId) })
      if (!row) throw new Error(`Recorded macro not found: ${entityId}`)
      return { displayName: row.name, snapshot: { entityType, entityId, macro: row } }
    }
    case 'workflow': {
      const row = await db.query.workflows.findFirst({ where: eq(schema.workflows.id, entityId) })
      if (!row) throw new Error(`Workflow not found: ${entityId}`)
      const nodes = await db.query.workflowNodes.findMany({
        where: eq(schema.workflowNodes.workflowId, entityId),
      })
      const edges = await db.query.workflowEdges.findMany({
        where: eq(schema.workflowEdges.workflowId, entityId),
      })
      return {
        displayName: row.name,
        snapshot: {
          entityType,
          entityId,
          workflow: row,
          nodes: sortById(nodes),
          edges: sortById(edges),
        },
      }
    }
    case 'prompt_template': {
      const row = await db.query.promptTemplates.findFirst({
        where: eq(schema.promptTemplates.id, entityId),
      })
      if (!row) throw new Error(`Prompt template not found: ${entityId}`)
      const versions = await db.query.promptTemplateVersions.findMany({
        where: eq(schema.promptTemplateVersions.promptTemplateId, entityId),
        orderBy: [desc(schema.promptTemplateVersions.version)],
      })
      return {
        displayName: row.name,
        snapshot: { entityType, entityId, template: row, versions: sortById(versions) },
      }
    }
    case 'playbook': {
      const row = await db.query.playbooks.findFirst({ where: eq(schema.playbooks.id, entityId) })
      if (!row) throw new Error(`Playbook not found: ${entityId}`)
      const versions = await db.query.playbookVersions.findMany({
        where: eq(schema.playbookVersions.playbookId, entityId),
      })
      return {
        displayName: row.title,
        snapshot: { entityType, entityId, playbook: row, versions: sortById(versions) },
      }
    }
  }
}

async function getLatestConfigVersion(
  entityType: ConfigEntityType,
  entityId: string,
): Promise<ConfigVersionRow | null> {
  return (
    (await db.query.configVersions.findFirst({
      where: and(eq(schema.configVersions.entityType, entityType), eq(schema.configVersions.entityId, entityId)),
      orderBy: [desc(schema.configVersions.version)],
    })) ?? null
  )
}

async function getRequiredConfigVersion(id: string): Promise<ConfigVersionRow> {
  const row = await db.query.configVersions.findFirst({ where: eq(schema.configVersions.id, id) })
  if (!row) throw new Error(`Config version not found: ${id}`)
  return row
}

async function applyConfigSnapshot(version: ConfigVersionRow): Promise<void> {
  const now = Date.now()
  switch (version.entityType) {
    case 'agent_profile':
      await updatePrimaryRow(schema.agentProfiles, schema.agentProfiles.id, version.entityId, version.snapshot, 'profile', now)
      return
    case 'model_profile':
      await updatePrimaryRow(schema.modelProfiles, schema.modelProfiles.id, version.entityId, version.snapshot, 'profile', now)
      return
    case 'network_profile':
      await updatePrimaryRow(schema.networkProfiles, schema.networkProfiles.id, version.entityId, version.snapshot, 'profile', now)
      return
    case 'cli_profile':
      await updatePrimaryRow(schema.cliProfiles, schema.cliProfiles.id, version.entityId, version.snapshot, 'profile', now)
      return
    case 'tool_connection':
      await updatePrimaryRow(schema.toolConnections, schema.toolConnections.id, version.entityId, version.snapshot, 'connection', now)
      return
    case 'software_command':
      await updatePrimaryRow(schema.softwareCommands, schema.softwareCommands.id, version.entityId, version.snapshot, 'command', now)
      return
    case 'recorded_macro':
      await updatePrimaryRow(schema.recordedMacros, schema.recordedMacros.id, version.entityId, version.snapshot, 'macro', now)
      return
    case 'mcp_server':
      await updatePrimaryRow(schema.mcpServers, schema.mcpServers.id, version.entityId, version.snapshot, 'server', now)
      await upsertRowsById(
        schema.mcpToolDefinitions,
        schema.mcpToolDefinitions.id,
        getSnapshotArray<McpToolDefinitionInsert>(version.snapshot, 'tools'),
        now,
      )
      return
    case 'software_profile':
      await updatePrimaryRow(schema.softwareProfiles, schema.softwareProfiles.id, version.entityId, version.snapshot, 'profile', now)
      await upsertRowsById(
        schema.softwareCommands,
        schema.softwareCommands.id,
        getSnapshotArray<SoftwareCommandInsert>(version.snapshot, 'commands'),
        now,
      )
      await upsertRowsById(
        schema.recordedMacros,
        schema.recordedMacros.id,
        getSnapshotArray<RecordedMacroInsert>(version.snapshot, 'macros'),
        now,
      )
      return
    case 'workflow':
      await updatePrimaryRow(schema.workflows, schema.workflows.id, version.entityId, version.snapshot, 'workflow', now)
      await upsertRowsById(
        schema.workflowNodes,
        schema.workflowNodes.id,
        getSnapshotArray<WorkflowNodeInsert>(version.snapshot, 'nodes'),
        now,
      )
      await upsertRowsById(
        schema.workflowEdges,
        schema.workflowEdges.id,
        getSnapshotArray<WorkflowEdgeInsert>(version.snapshot, 'edges'),
        now,
      )
      return
    case 'prompt_template':
      await updatePrimaryRow(schema.promptTemplates, schema.promptTemplates.id, version.entityId, version.snapshot, 'template', now)
      await upsertRowsById(
        schema.promptTemplateVersions,
        schema.promptTemplateVersions.id,
        getSnapshotArray<PromptTemplateVersionInsert>(version.snapshot, 'versions'),
        now,
      )
      return
    case 'playbook':
      await updatePrimaryRow(schema.playbooks, schema.playbooks.id, version.entityId, version.snapshot, 'playbook', now)
      await upsertRowsById(
        schema.playbookVersions,
        schema.playbookVersions.id,
        getSnapshotArray<PlaybookVersionInsert>(version.snapshot, 'versions'),
        now,
      )
      return
  }
}

async function updatePrimaryRow<Table, Column>(
  table: Table,
  idColumn: Column,
  entityId: string,
  snapshot: JsonObject,
  key: string,
  now: number,
): Promise<void> {
  const row = getSnapshotObject(snapshot, key)
  await db
    .update(table as never)
    .set(toRestoredUpdate(row, now))
    .where(eq(idColumn as never, entityId))
}

async function upsertRowsById<Table, Column, Row extends Record<string, unknown>>(
  table: Table,
  idColumn: Column,
  rows: Row[],
  now: number,
): Promise<void> {
  for (const row of rows) {
    const id = row.id
    if (typeof id !== 'string' || !id) continue
    await db
      .insert(table as never)
      .values(row as never)
      .onConflictDoUpdate({
        target: idColumn as never,
        set: toRestoredUpdate(row, now),
      })
  }
}

function assertSnapshotMatchesVersion(version: ConfigVersionRow): void {
  const entityType = getSnapshotString(version.snapshot, 'entityType')
  const entityId = getSnapshotString(version.snapshot, 'entityId')
  if (entityType !== version.entityType || entityId !== version.entityId) {
    throw new Error(`Config version snapshot does not match ${version.entityType}:${version.entityId}.`)
  }
}

function getSnapshotObject(snapshot: JsonObject, key: string): Record<string, unknown> {
  const value = snapshot[key]
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`Config snapshot is missing object "${key}".`)
  }
  return value as Record<string, unknown>
}

function getSnapshotArray<Row extends Record<string, unknown>>(
  snapshot: JsonObject,
  key: string,
): Row[] {
  const value = snapshot[key]
  if (!Array.isArray(value)) return []
  return value.filter((item): item is Row => Boolean(item) && typeof item === 'object' && !Array.isArray(item))
}

function getSnapshotString(snapshot: JsonObject, key: string): string | null {
  const value = snapshot[key]
  return typeof value === 'string' ? value : null
}

function toRestoredUpdate(row: Record<string, unknown>, now: number): Record<string, unknown> {
  const restored = { ...row }
  delete restored.id
  if ('updatedAt' in restored) restored.updatedAt = now
  return restored
}

async function findImpactedRefs(
  entityType: ConfigEntityType,
  entityId: string,
): Promise<JsonObject[]> {
  if (entityType === 'agent_profile') {
    const nodes = await db.query.workflowNodes.findMany()
    const workflowIds = Array.from(
      new Set(nodes.filter((node) => node.agentProfileId === entityId).map((node) => node.workflowId)),
    )
    const workflows = await db.query.workflows.findMany()
    return workflows
      .filter((workflow) => workflowIds.includes(workflow.id))
      .map((workflow) => impactedRef('workflow', workflow.id, workflow.name, 'Workflow node uses this Agent.'))
  }

  if (entityType === 'model_profile') {
    const agents = await db.query.agentProfiles.findMany()
    return agents
      .filter(
        (agent) =>
          agent.modelProfileId === entityId || agent.fallbackModelProfileIds.includes(entityId),
      )
      .map((agent) => impactedRef('agent_profile', agent.id, agent.name, 'Agent routes to this model.'))
  }

  if (entityType === 'cli_profile') {
    const agents = await db.query.agentProfiles.findMany()
    return agents
      .filter((agent) => agent.cliProfileIds.includes(entityId))
      .map((agent) => impactedRef('agent_profile', agent.id, agent.name, 'Agent can call this CLI.'))
  }

  if (entityType === 'mcp_server') {
    const agents = await db.query.agentProfiles.findMany()
    const toolDefinitions = await db.query.mcpToolDefinitions.findMany({
      where: eq(schema.mcpToolDefinitions.mcpServerId, entityId),
    })
    return [
      ...agents
        .filter((agent) => agent.mcpServerIds.includes(entityId))
        .map((agent) => impactedRef('agent_profile', agent.id, agent.name, 'Agent can use this MCP server.')),
      ...toolDefinitions.map((tool) =>
        impactedRef('mcp_server', entityId, tool.displayName, 'MCP tool catalog is derived from this server.'),
      ),
    ]
  }

  if (entityType === 'software_profile') {
    const agents = await db.query.agentProfiles.findMany()
    const commands = await db.query.softwareCommands.findMany({
      where: eq(schema.softwareCommands.softwareProfileId, entityId),
    })
    const macros = await db.query.recordedMacros.findMany({
      where: eq(schema.recordedMacros.softwareProfileId, entityId),
    })
    return [
      ...agents
        .filter((agent) => agent.softwareProfileIds.includes(entityId))
        .map((agent) =>
          impactedRef('agent_profile', agent.id, agent.name, 'Agent can operate this software profile.'),
        ),
      ...commands.map((command) =>
        impactedRef('software_command', command.id, command.name, 'Software command belongs to this profile.'),
      ),
      ...macros.map((macro) =>
        impactedRef('recorded_macro', macro.id, macro.name, 'Recorded macro belongs to this profile.'),
      ),
    ]
  }

  if (entityType === 'prompt_template') {
    const template = await db.query.promptTemplates.findFirst({
      where: eq(schema.promptTemplates.id, entityId),
    })
    if (template?.agentProfileId) {
      const agent = await db.query.agentProfiles.findFirst({
        where: eq(schema.agentProfiles.id, template.agentProfileId),
      })
      if (agent) {
        return [impactedRef('agent_profile', agent.id, agent.name, 'Agent is bound to this prompt template.')]
      }
    }
  }

  if (entityType === 'software_command' || entityType === 'recorded_macro') {
    const workflows = await db.query.workflows.findMany()
    const nodes = await db.query.workflowNodes.findMany()
    const hits = nodes.filter((node) => JSON.stringify(node.config).includes(entityId))
    return workflows
      .filter((workflow) => hits.some((node) => node.workflowId === workflow.id))
      .map((workflow) =>
        impactedRef('workflow', workflow.id, workflow.name, 'Workflow node config references this capability.'),
      )
  }

  return []
}

function classifyImpact(changed: boolean, impactedCount: number): ConfigImpactLevel {
  if (!changed && impactedCount === 0) return 'none'
  if (impactedCount >= 5) return 'high'
  if (impactedCount >= 2) return 'medium'
  return 'low'
}

function summarizeImpact(
  entityType: ConfigEntityType,
  entityId: string,
  changed: boolean,
  impactedCount: number,
): string {
  const changePart = changed ? 'differs from the base version' : 'matches the base version'
  return `${entityType}:${entityId} ${changePart}; ${impactedCount} dependent configuration references found.`
}

function impactedRef(
  entityType: ConfigEntityType,
  entityId: string,
  displayName: string,
  reason: string,
): JsonObject {
  return { entityType, entityId, displayName, reason }
}

function sortById<T extends { id: string }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => a.id.localeCompare(b.id))
}

function hashConfig(value: unknown): string {
  return `sha256:${createHash('sha256').update(stableStringify(value)).digest('hex')}`
}

function stableStringify(value: unknown): string {
  return JSON.stringify(stabilize(value))
}

function stabilize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stabilize)
  if (!value || typeof value !== 'object') return value
  const input = value as Record<string, unknown>
  return Object.keys(input)
    .sort()
    .reduce<Record<string, unknown>>((acc, key) => {
      acc[key] = stabilize(input[key])
      return acc
    }, {})
}
