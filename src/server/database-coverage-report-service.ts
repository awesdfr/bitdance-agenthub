import { readFile } from 'node:fs/promises'
import path from 'node:path'

import { schema, sqlite } from '@/db/client'

export type DatabaseCoverageStatus = 'covered' | 'missing' | 'weak'
export type DatabaseStorageKind = 'table' | 'embedded_json_policy'

export interface DatabaseCoverageItem {
  key: string
  requiredName: string
  category: string
  storageKind: DatabaseStorageKind
  schemaExport: string
  physicalTable: string
  embeddedColumns: string[]
  schemaDefined: boolean
  bootstrapDefined: boolean
  currentDatabaseDefined: boolean
  status: DatabaseCoverageStatus
  evidence: string[]
  gaps: string[]
}

export interface DatabaseCoverageReport {
  readiness: 'ready' | 'needs_attention'
  requiredItems: number
  coveredItems: number
  weakItems: number
  missingItems: number
  physicalTables: number
  embeddedPolicyItems: number
  categories: Record<string, {
    requiredItems: number
    coveredItems: number
    weakItems: number
    missingItems: number
  }>
  items: DatabaseCoverageItem[]
  currentTableCount: number
  currentTables: string[]
  gaps: string[]
  recommendations: string[]
  generatedAt: number
}

interface RequiredDatabaseItem {
  key: string
  requiredName: string
  category: string
  storageKind: DatabaseStorageKind
  schemaExport: string
  physicalTable: string
  embeddedColumns?: string[]
}

const REQUIRED_DATABASE_ITEMS: RequiredDatabaseItem[] = [
  item('model_profiles', 'Model profiles', 'control_plane', 'modelProfiles', 'model_profiles'),
  item('network_profiles', 'Network/IP outlet profiles', 'control_plane', 'networkProfiles', 'network_profiles'),
  item('agent_profiles', 'Agent employee profiles', 'agent_profile', 'agentProfiles', 'agent_profiles'),
  embedded('agent_permissions', 'Agent permission policies', 'agent_profile', 'agentProfiles', 'agent_profiles', ['permissionPolicy', 'permission_policy']),
  embedded('agent_memory_policies', 'Agent memory policies', 'agent_profile', 'agentProfiles', 'agent_profiles', ['memoryPolicy', 'memory_policy']),
  item('agent_workstations', 'Agent workstations', 'agent_profile', 'agentWorkstations', 'agent_workstations'),
  item('memory_items', 'Memory items', 'memory_learning', 'memoryItems', 'memory_items'),
  item('learning_events', 'Learning events', 'memory_learning', 'learningEvents', 'learning_events'),
  item('run_reflections', 'Run reflections', 'memory_learning', 'runReflections', 'run_reflections'),
  item('playbooks', 'Playbooks', 'memory_learning', 'playbooks', 'playbooks'),
  item('playbook_versions', 'Playbook versions', 'memory_learning', 'playbookVersions', 'playbook_versions'),
  item('tool_connections', 'Tool connections', 'tools', 'toolConnections', 'tool_connections'),
  item('mcp_servers', 'MCP servers', 'tools', 'mcpServers', 'mcp_servers'),
  item('cli_profiles', 'CLI profiles', 'tools', 'cliProfiles', 'cli_profiles'),
  item('software_profiles', 'Software profiles', 'tools', 'softwareProfiles', 'software_profiles'),
  item('software_commands', 'Software commands', 'tools', 'softwareCommands', 'software_commands'),
  item('recorded_macros', 'Recorded macros', 'tools', 'recordedMacros', 'recorded_macros'),
  item('workflows', 'Workflows', 'workflow', 'workflows', 'workflows'),
  item('workflow_nodes', 'Workflow nodes', 'workflow', 'workflowNodes', 'workflow_nodes'),
  item('workflow_edges', 'Workflow edges', 'workflow', 'workflowEdges', 'workflow_edges'),
  item('workflow_runs', 'Workflow runs', 'workflow', 'workflowRuns', 'workflow_runs'),
  item('workflow_node_runs', 'Workflow node runs', 'workflow', 'workflowNodeRuns', 'workflow_node_runs'),
  item('resource_locks', 'Resource locks', 'safety_runtime', 'resourceLocks', 'resource_locks'),
  item('approval_requests', 'Approval requests', 'safety_runtime', 'approvalRequests', 'approval_requests'),
  item('artifacts', 'Artifacts', 'artifact_verification', 'artifacts', 'artifacts'),
  item('artifact_validations', 'Artifact validations', 'artifact_verification', 'artifactValidations', 'artifact_validations'),
]

export async function getDatabaseCoverageReport(): Promise<DatabaseCoverageReport> {
  const [schemaSource, bootstrapSource] = await Promise.all([
    readSourceFile('src/db/schema.ts'),
    readSourceFile('src/db/bootstrap.ts'),
  ])
  const currentTables = listCurrentSqliteTables()
  const items = REQUIRED_DATABASE_ITEMS.map((required) =>
    evaluateRequiredItem(required, {
      schemaSource,
      bootstrapSource,
      currentTables,
    }),
  )
  const gaps = items.flatMap((item) => item.gaps.map((gap) => `${item.key}: ${gap}`))
  return {
    readiness: gaps.length === 0 ? 'ready' : 'needs_attention',
    requiredItems: items.length,
    coveredItems: items.filter((item) => item.status === 'covered').length,
    weakItems: items.filter((item) => item.status === 'weak').length,
    missingItems: items.filter((item) => item.status === 'missing').length,
    physicalTables: items.filter((item) => item.storageKind === 'table').length,
    embeddedPolicyItems: items.filter((item) => item.storageKind === 'embedded_json_policy').length,
    categories: summarizeCategories(items),
    items,
    currentTableCount: currentTables.length,
    currentTables,
    gaps,
    recommendations: buildRecommendations(items, gaps),
    generatedAt: Date.now(),
  }
}

function item(
  key: string,
  requiredName: string,
  category: string,
  schemaExport: string,
  physicalTable: string,
): RequiredDatabaseItem {
  return {
    key,
    requiredName,
    category,
    storageKind: 'table',
    schemaExport,
    physicalTable,
  }
}

function embedded(
  key: string,
  requiredName: string,
  category: string,
  schemaExport: string,
  physicalTable: string,
  embeddedColumns: string[],
): RequiredDatabaseItem {
  return {
    key,
    requiredName,
    category,
    storageKind: 'embedded_json_policy',
    schemaExport,
    physicalTable,
    embeddedColumns,
  }
}

function evaluateRequiredItem(
  required: RequiredDatabaseItem,
  context: {
    schemaSource: string
    bootstrapSource: string
    currentTables: string[]
  },
): DatabaseCoverageItem {
  const schemaDefined =
    hasSchemaExport(required.schemaExport) &&
    context.schemaSource.includes(`export const ${required.schemaExport}`) &&
    context.schemaSource.includes(`'${required.physicalTable}'`)
  const bootstrapDefined = context.bootstrapSource.includes(`CREATE TABLE IF NOT EXISTS ${required.physicalTable}`)
  const currentDatabaseDefined = context.currentTables.includes(required.physicalTable)
  const embeddedColumns = required.embeddedColumns ?? []
  const embeddedColumnEvidence = embeddedColumns.every(
    (column) => context.schemaSource.includes(column) || context.bootstrapSource.includes(column),
  )
  const gaps: string[] = []
  if (!schemaDefined) gaps.push(`Schema export ${required.schemaExport} is missing.`)
  if (!bootstrapDefined) gaps.push(`Bootstrap DDL for ${required.physicalTable} is missing.`)
  if (!currentDatabaseDefined) gaps.push(`Current SQLite table ${required.physicalTable} is missing.`)
  if (required.storageKind === 'embedded_json_policy' && !embeddedColumnEvidence) {
    gaps.push(`Embedded policy columns are missing: ${embeddedColumns.join(', ')}.`)
  }
  const status = resolveStatus({
    storageKind: required.storageKind,
    schemaDefined,
    bootstrapDefined,
    currentDatabaseDefined,
    embeddedColumnEvidence,
  })
  return {
    key: required.key,
    requiredName: required.requiredName,
    category: required.category,
    storageKind: required.storageKind,
    schemaExport: required.schemaExport,
    physicalTable: required.physicalTable,
    embeddedColumns,
    schemaDefined,
    bootstrapDefined,
    currentDatabaseDefined,
    status,
    evidence: buildEvidence(required, {
      schemaDefined,
      bootstrapDefined,
      currentDatabaseDefined,
      embeddedColumnEvidence,
    }),
    gaps,
  }
}

function resolveStatus(args: {
  storageKind: DatabaseStorageKind
  schemaDefined: boolean
  bootstrapDefined: boolean
  currentDatabaseDefined: boolean
  embeddedColumnEvidence: boolean
}): DatabaseCoverageStatus {
  const baseCovered = args.schemaDefined && args.bootstrapDefined && args.currentDatabaseDefined
  if (!baseCovered) return 'missing'
  if (args.storageKind === 'embedded_json_policy' && !args.embeddedColumnEvidence) return 'weak'
  return 'covered'
}

function buildEvidence(
  required: RequiredDatabaseItem,
  args: {
    schemaDefined: boolean
    bootstrapDefined: boolean
    currentDatabaseDefined: boolean
    embeddedColumnEvidence: boolean
  },
): string[] {
  return [
    args.schemaDefined ? `schema.ts exports ${required.schemaExport}.` : `schema.ts does not export ${required.schemaExport}.`,
    args.bootstrapDefined ? `bootstrap.ts creates ${required.physicalTable}.` : `bootstrap.ts does not create ${required.physicalTable}.`,
    args.currentDatabaseDefined ? `SQLite currently has ${required.physicalTable}.` : `SQLite does not currently have ${required.physicalTable}.`,
    required.storageKind === 'embedded_json_policy'
      ? args.embeddedColumnEvidence
        ? `Logical ${required.key} is persisted as embedded policy columns on ${required.physicalTable}.`
        : `Logical ${required.key} embedded policy columns are incomplete.`
      : `Logical ${required.key} is persisted as a physical table.`,
  ]
}

function summarizeCategories(items: DatabaseCoverageItem[]): DatabaseCoverageReport['categories'] {
  return items.reduce<DatabaseCoverageReport['categories']>((acc, item) => {
    const current = acc[item.category] ?? {
      requiredItems: 0,
      coveredItems: 0,
      weakItems: 0,
      missingItems: 0,
    }
    current.requiredItems += 1
    if (item.status === 'covered') current.coveredItems += 1
    if (item.status === 'weak') current.weakItems += 1
    if (item.status === 'missing') current.missingItems += 1
    acc[item.category] = current
    return acc
  }, {})
}

function buildRecommendations(items: DatabaseCoverageItem[], gaps: string[]): string[] {
  if (gaps.length === 0) {
    return [
      'Section 18 required persistence is covered by physical tables or documented embedded JSON policy storage.',
      'Keep schema.ts, bootstrap.ts, and the live SQLite bootstrap path in sync whenever adding future plan tables.',
    ]
  }
  return [
    ...items
      .filter((item) => item.status !== 'covered')
      .map((item) => `Add or repair persistence for ${item.key}.`),
    'Re-run the database coverage report after schema/bootstrap changes.',
  ]
}

function hasSchemaExport(name: string): boolean {
  return Object.prototype.hasOwnProperty.call(schema, name)
}

function listCurrentSqliteTables(): string[] {
  const rows = sqlite
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
    .all() as Array<{ name: string }>
  return rows.map((row) => row.name)
}

async function readSourceFile(relativePath: string): Promise<string> {
  return readFile(path.resolve(process.cwd(), relativePath), 'utf8')
}
