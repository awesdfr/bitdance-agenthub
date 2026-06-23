import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

import { and, desc, eq, type SQL } from 'drizzle-orm'

import { db, schema, sqlite } from '@/db/client'
import type {
  TechnicalArchitectureArea,
  TechnicalArchitectureCheck,
  TechnicalArchitectureEvaluationRow,
  TechnicalArchitectureEvaluationStatus,
  TechnicalArchitectureManifest,
  TechnicalArchitectureSummary,
} from '@/db/schema'
import { newTechnicalArchitectureEvaluationId } from '@/server/ids'

interface PackageJson {
  version?: string
  main?: string
  scripts?: Record<string, string>
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
}

const repoRoot = process.cwd()

export async function evaluateTechnicalArchitecture(): Promise<TechnicalArchitectureEvaluationRow> {
  const manifest = buildTechnicalArchitectureManifest()
  const checks = buildTechnicalArchitectureChecks(manifest)
  const summary = summarizeChecks(checks)
  const now = Date.now()
  const row: TechnicalArchitectureEvaluationRow = {
    id: newTechnicalArchitectureEvaluationId(),
    version: manifest.version,
    status: summary.status,
    manifest,
    checks,
    summary,
    createdAt: now,
    updatedAt: now,
  }
  await db.insert(schema.technicalArchitectureEvaluations).values(row)
  return row
}

export async function listTechnicalArchitectureEvaluations(args: {
  status?: TechnicalArchitectureEvaluationStatus
  limit?: number
} = {}): Promise<TechnicalArchitectureEvaluationRow[]> {
  const filters: SQL[] = []
  if (args.status) filters.push(eq(schema.technicalArchitectureEvaluations.status, args.status))
  return db.query.technicalArchitectureEvaluations.findMany({
    where: filters.length ? and(...filters) : undefined,
    orderBy: [desc(schema.technicalArchitectureEvaluations.createdAt)],
    limit: Math.min(Math.max(args.limit ?? 25, 1), 100),
  })
}

export function buildTechnicalArchitectureManifest(): TechnicalArchitectureManifest {
  const packageJson = readPackageJson()
  const dependencies = {
    ...(packageJson.dependencies ?? {}),
    ...(packageJson.devDependencies ?? {}),
  }
  const supplementalTables = buildSupplementalTableMapping()
  return {
    version: packageJson.version ?? '0.0.0',
    selectedDesktopShell: hasDependency(dependencies, 'electron') ? 'electron_node' : 'web_only',
    frontendStack: {
      framework: dependencyVersion(dependencies, 'next') ?? 'unknown Next.js',
      language: dependencyVersion(dependencies, 'typescript') ?? 'TypeScript not detected',
      state: dependencyVersion(dependencies, 'zustand') ?? 'Zustand not detected',
      styling: dependencyVersion(dependencies, 'tailwindcss') ?? 'TailwindCSS not detected',
      canvas: existsAt('src/components/agent-workflow-canvas.tsx')
        ? 'Custom React/SVG Agent Workflow Canvas'
        : 'Canvas implementation not detected',
      editor: hasDependency(dependencies, '@uiw/react-codemirror')
        ? 'CodeMirror 6'
        : 'Monaco/CodeMirror editor not detected',
    },
    backendStack: {
      runtime: hasDependency(dependencies, 'electron') ? 'Electron main process + Node.js' : 'Node.js web runtime',
      embeddedServer: hasDependency(dependencies, 'next') ? 'Next.js route handlers' : 'Embedded HTTP server not detected',
      database: hasDependency(dependencies, 'better-sqlite3') ? 'SQLite WAL via better-sqlite3 + Drizzle' : 'SQLite not detected',
      vectorStore: tableExists('knowledge_graph_nodes')
        ? 'Lightweight in-DB vectors for knowledge graph and memory evidence'
        : 'Vector storage not detected',
      eventBus: existsAt('src/server/event-bus.ts') ? 'In-process EventEmitter + persisted run events' : 'Event bus not detected',
      childProcess: existsAt('src/server/tools/bash.ts') ? 'Node child_process spawn + Windows taskkill tree cleanup' : 'Child process runner not detected',
      encryption: existsAt('src/server/security-service.ts') ? 'node:crypto AES-256-GCM secret vault' : 'Encryption service not detected',
      browserEngine: hasDependency(dependencies, '@playwright/test')
        ? 'Playwright-compatible browser automation with per-Agent browser-session records'
        : 'Browser automation engine not detected',
    },
    processArchitecture: {
      mainProcess: [
        'Electron main process boots desktop shell and packaged Next.js app.',
        'Next.js API routes expose the local HTTP control plane.',
        'SQLite bootstrap creates local-first persistence at startup.',
      ],
      rendererProcess: [
        'React app renders Agent Factory, model/tool control plane, Canvas, monitor, memory, governance, and configuration surfaces.',
        'Agent Workflow Canvas composes Agent, approval, condition, software, CLI, and artifact-flow nodes.',
      ],
      runtimeManagers: [
        'AgentEmployeeRuntime',
        'WorkflowRunner',
        'ComputerSessionManager',
        'CliRunner',
        'SchedulerService',
        'RunEventFeed',
      ],
    },
    supplementalTables,
    dataFlow: [
      'User configures Model/Network/Agent/Skill/MCP/CLI/Software profiles.',
      'Canvas maps typed node inputs into Agent or tool execution contracts.',
      'Agent runtime packs visible context, retrieves memory, plans, acts, observes, verifies, and emits run events.',
      'Resource locks, approvals, sandbox checks, and secret references gate risky actions.',
      'Artifacts, validations, checkpoints, reflections, and learning events persist after each run.',
      'Run feeds, dashboards, metrics, notifications, and audit logs make progress observable.',
    ],
  }
}

function buildTechnicalArchitectureChecks(
  manifest: TechnicalArchitectureManifest,
): TechnicalArchitectureCheck[] {
  const packageJson = readPackageJson()
  const dependencies = {
    ...(packageJson.dependencies ?? {}),
    ...(packageJson.devDependencies ?? {}),
  }
  return [
    check({
      area: 'stack',
      key: 'desktop_shell',
      title: 'Desktop shell is Electron + Node.js',
      expected: 'Plan allows Tauri/Rust or Electron/Node; v1 selected desktop-first local runtime.',
      actual: `${manifest.selectedDesktopShell}; main=${packageJson.main ?? 'unset'}`,
      passed: manifest.selectedDesktopShell === 'electron_node',
      evidence: ['package.json includes electron, electron-builder, electron:dev, electron:build, and dist-electron/main.js.'],
    }),
    check({
      area: 'stack',
      key: 'frontend_stack',
      title: 'Frontend stack is React, TypeScript, Zustand, and Tailwind',
      expected: 'React + TypeScript frontend with state management and responsive styling.',
      actual: [
        dependencyVersion(dependencies, 'react'),
        dependencyVersion(dependencies, 'typescript'),
        dependencyVersion(dependencies, 'zustand'),
        dependencyVersion(dependencies, 'tailwindcss'),
      ].filter(Boolean).join(', '),
      passed: hasAllDependencies(dependencies, ['react', 'typescript', 'zustand', 'tailwindcss']),
      evidence: ['package.json dependency/devDependency set is the source of truth.'],
    }),
    check({
      area: 'stack',
      key: 'canvas_editor',
      title: 'Canvas and code editor surfaces exist',
      expected: 'Plan recommends React Flow/xyflow and Monaco; repository may use equivalent local components.',
      actual: `${manifest.frontendStack.canvas}; ${manifest.frontendStack.editor}`,
      passed: existsAt('src/components/agent-workflow-canvas.tsx') && hasDependency(dependencies, '@uiw/react-codemirror'),
      warning: !hasAnyDependency(dependencies, ['@xyflow/react', 'reactflow', 'monaco-editor']),
      required: false,
      evidence: [
        'src/components/agent-workflow-canvas.tsx implements the visual Agent canvas.',
        'src/components/artifact-code-editor.tsx uses CodeMirror 6 for artifact editing.',
        'React Flow/Monaco remain optional replacements, not blockers for the current implementation.',
      ],
    }),
    check({
      area: 'stack',
      key: 'sqlite_wal',
      title: 'SQLite WAL local-first database is configured',
      expected: 'SQLite WAL storage for the desktop-first v1 control plane.',
      actual: manifest.backendStack.database,
      passed: hasDependency(dependencies, 'better-sqlite3') && fileContains('src/db/client.ts', 'journal_mode = WAL'),
      evidence: ['src/db/client.ts enables WAL and foreign keys before bootstrap.'],
    }),
    check({
      area: 'process',
      key: 'process_managers',
      title: 'Main process owns runtime, browser, CLI, scheduler, and event managers',
      expected: 'Agent Runtime Manager, Browser Manager, CLI Runner Pool, Scheduler, and Event Bus are separated services.',
      actual: manifest.processArchitecture.runtimeManagers.join(', '),
      passed: [
        'src/server/employee-runtime-service.ts',
        'src/server/workflow-runner-service.ts',
        'src/server/computer-session-manager.ts',
        'src/server/cli-runner-service.ts',
        'src/server/scheduler-service.ts',
        'src/server/run-event-feed-service.ts',
      ].every(existsAt),
      evidence: manifest.processArchitecture.runtimeManagers,
    }),
    check({
      area: 'process',
      key: 'event_bus',
      title: 'In-process event bus and persisted run event feeds exist',
      expected: 'EventEmitter/RxJS/custom EventBus with replayable run events.',
      actual: manifest.backendStack.eventBus,
      passed: existsAt('src/server/event-bus.ts') &&
        tableExists('employee_run_events') &&
        existsAt('src/server/run-event-feed-service.ts'),
      evidence: ['src/server/event-bus.ts', 'employee_run_events', 'src/server/run-event-feed-service.ts'],
    }),
    check({
      area: 'process',
      key: 'child_process_pool',
      title: 'CLI and command execution are isolated behind services',
      expected: 'Child process management through Node child_process with timeout/tree cleanup.',
      actual: manifest.backendStack.childProcess,
      passed: existsAt('src/server/tools/bash.ts') &&
        fileContains('src/server/tools/bash.ts', 'spawn') &&
        fileContains('src/server/tools/bash.ts', 'taskkill') &&
        existsAt('src/server/cli-runner-service.ts'),
      evidence: ['src/server/tools/bash.ts uses spawn and Windows taskkill /T cleanup.', 'src/server/cli-runner-service.ts records CLI Profile runs.'],
    }),
    check({
      area: 'process',
      key: 'browser_and_computer_sessions',
      title: 'Browser/computer operation managers are present',
      expected: 'Per-Agent browser contexts, computer sessions, and future desktop adapters stay behind manager services.',
      actual: manifest.backendStack.browserEngine,
      passed: tableExists('browser_sessions') &&
        tableExists('computer_sessions') &&
        existsAt('src/server/browser-session-service.ts') &&
        existsAt('src/server/computer-session-manager.ts'),
      evidence: ['browser_sessions', 'computer_sessions', 'browser-session-service', 'computer-session-manager'],
    }),
    check({
      area: 'process',
      key: 'secret_encryption',
      title: 'Secrets and encrypted exports are routed through crypto-backed services',
      expected: 'node:crypto or OS keychain backed vault with no plaintext secret leakage.',
      actual: manifest.backendStack.encryption,
      passed: tableExists('secret_vault') &&
        existsAt('src/server/security-service.ts') &&
        fileContains('src/server/security-service.ts', 'aes-256-gcm'),
      evidence: ['secret_vault table', 'src/server/security-service.ts AES-256-GCM', 'credential_scopes table'],
    }),
    check({
      area: 'database',
      key: 'supplemental_tables',
      title: 'Section 46 supplemental database groups map to existing tables',
      expected: 'Users, roles, API keys, vault, credentials, budgets, checkpoints, events, audit, prompts, notifications, plugins, graph, templates, queues, collaboration, compatibility, health, and metrics tables are represented.',
      actual: summarizeSupplementalTables(manifest.supplementalTables),
      passed: Object.values(manifest.supplementalTables).every((tables) =>
        tables.some((table) => tableExists(table)),
      ),
      evidence: Object.entries(manifest.supplementalTables).map(([key, tables]) => `${key}: ${tables.join(', ')}`),
    }),
    check({
      area: 'data_flow',
      key: 'runtime_data_flow',
      title: 'Config -> Canvas -> Runtime -> Verification -> Learning data flow is represented',
      expected: 'The plan data flow should be implemented as services, tables, events, artifacts, and learning records.',
      actual: manifest.dataFlow.join(' -> '),
      passed: [
        'agent_profiles',
        'workflow_nodes',
        'employee_runs',
        'employee_run_events',
        'resource_locks',
        'approval_requests',
        'artifacts',
        'artifact_validations',
        'run_reflections',
        'learning_events',
      ].every(tableExists),
      evidence: manifest.dataFlow,
    }),
  ]
}

function buildSupplementalTableMapping(): Record<string, string[]> {
  return {
    users: ['team_users'],
    user_roles: ['team_memberships', 'community_governance_roles'],
    api_keys: ['programmatic_api_keys'],
    secret_vault: ['secret_vault'],
    credential_scopes: ['credential_scopes'],
    budget_policies: ['workflow_preflights', 'budget_events', 'project_contexts'],
    cost_records: ['budget_events', 'metric_points'],
    run_checkpoints: ['runtime_checkpoints'],
    run_events: ['employee_run_events', 'stream_protocol_events'],
    audit_logs: ['audit_logs', 'decision_audit_trails'],
    prompt_templates: ['prompt_templates', 'prompt_template_versions'],
    notifications: ['notifications', 'notification_preferences'],
    plugins: ['plugin_packages', 'plugin_lifecycle_events'],
    knowledge_graph: ['knowledge_graph_nodes', 'knowledge_graph_edges'],
    agent_templates: ['agent_template_packages', 'agent_template_installs'],
    workflow_templates: ['workflows', 'workflow_nodes', 'workflow_edges'],
    scheduled_tasks: ['task_schedules'],
    task_queue: ['task_queues', 'task_queue_items'],
    takeover_sessions: ['user_overrides'],
    inter_agent_messages: ['inter_agent_messages'],
    blackboard_entries: ['blackboard_entries'],
    conflict_resolutions: ['conflict_resolutions'],
    error_taxonomy: ['error_classifications', 'recovery_strategy_stats'],
    compatibility_reports: ['package_import_checks', 'migration_wizard_sessions'],
    export_history: ['data_export_manifests', 'config_exports', 'export_packages'],
    system_health_checks: ['system_bootstrap_checks'],
    metrics_snapshots: ['metric_points', 'success_metric_snapshots'],
  }
}

function summarizeChecks(checks: TechnicalArchitectureCheck[]): TechnicalArchitectureSummary {
  const failed = checks.filter((item) => item.status === 'failed').length
  const warnings = checks.filter((item) => item.status === 'warning').length
  const requiredFailed = checks.filter((item) => item.required && item.status === 'failed').length
  const status: TechnicalArchitectureEvaluationStatus =
    requiredFailed > 0 ? 'failed' : warnings > 0 ? 'warning' : 'passed'
  return {
    totalChecks: checks.length,
    passed: checks.filter((item) => item.status === 'passed').length,
    warnings,
    failed,
    requiredFailed,
    status,
  }
}

function check(args: {
  area: TechnicalArchitectureArea
  key: string
  title: string
  expected: string
  actual: string
  passed: boolean
  warning?: boolean
  required?: boolean
  evidence: string[]
}): TechnicalArchitectureCheck {
  const required = args.required ?? true
  const status: TechnicalArchitectureEvaluationStatus = args.passed
    ? args.warning
      ? 'warning'
      : 'passed'
    : 'failed'
  return {
    key: args.key,
    area: args.area,
    title: args.title,
    expected: args.expected,
    actual: args.actual || 'not detected',
    status,
    required,
    evidence: args.evidence,
  }
}

function summarizeSupplementalTables(mapping: Record<string, string[]>): string {
  const covered = Object.entries(mapping).filter(([, tables]) => tables.some(tableExists)).length
  return `${covered}/${Object.keys(mapping).length} supplemental groups covered`
}

function readPackageJson(): PackageJson {
  const raw = readRootText('package.json')
  if (!raw) return {}
  try {
    return JSON.parse(raw) as PackageJson
  } catch {
    return {}
  }
}

function readRootText(relativePath: string): string | null {
  const target = path.resolve(repoRoot, relativePath)
  if (!target.startsWith(repoRoot) || !existsSync(target)) return null
  return readFileSync(target, 'utf8')
}

function existsAt(relativePath: string): boolean {
  const target = path.resolve(repoRoot, relativePath)
  return target.startsWith(repoRoot) && existsSync(target)
}

function fileContains(relativePath: string, needle: string): boolean {
  return readRootText(relativePath)?.includes(needle) ?? false
}

function dependencyVersion(dependencies: Record<string, string>, name: string): string | null {
  const version = dependencies[name]
  return version ? `${name}@${version}` : null
}

function hasDependency(dependencies: Record<string, string>, name: string): boolean {
  return Boolean(dependencies[name])
}

function hasAnyDependency(dependencies: Record<string, string>, names: string[]): boolean {
  return names.some((name) => hasDependency(dependencies, name))
}

function hasAllDependencies(dependencies: Record<string, string>, names: string[]): boolean {
  return names.every((name) => hasDependency(dependencies, name))
}

function tableExists(tableName: string): boolean {
  const row = sqlite
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(tableName) as { name: string } | undefined
  return Boolean(row)
}
