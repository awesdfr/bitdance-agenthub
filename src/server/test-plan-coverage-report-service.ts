import { readFile } from 'node:fs/promises'
import path from 'node:path'

export type TestPlanEvidenceKind =
  | 'service'
  | 'integration_test'
  | 'api_smoke'
  | 'source_smoke'
  | 'documentation'

export type TestPlanCoverageStatus = 'covered' | 'missing'

export interface TestPlanEvidenceFileCoverage {
  path: string
  kind: TestPlanEvidenceKind
  role: string
  expectedMarkers: string[]
  foundMarkers: string[]
  missingMarkers: string[]
  exists: boolean
}

export interface TestPlanCoverageItem {
  key: string
  title: string
  category: string
  requiredAssertion: string
  status: TestPlanCoverageStatus
  evidenceFiles: TestPlanEvidenceFileCoverage[]
  evidence: string[]
  gaps: string[]
  warnings: string[]
}

export interface TestPlanCategorySummary {
  requiredItems: number
  coveredItems: number
  missingItems: number
}

export interface TestPlanCoverageReport {
  readiness: 'ready' | 'needs_attention'
  requiredItems: number
  coveredItems: number
  missingItems: number
  categories: Record<string, TestPlanCategorySummary>
  items: TestPlanCoverageItem[]
  gaps: string[]
  warnings: string[]
  recommendations: string[]
  generatedAt: number
}

interface RequiredTestPlanItem {
  key: string
  title: string
  category: string
  requiredAssertion: string
  evidenceFiles: Array<{
    path: string
    kind: TestPlanEvidenceKind
    role: string
    expectedMarkers: string[]
  }>
  warnings?: string[]
}

const REQUIRED_TEST_PLAN_ITEMS: RequiredTestPlanItem[] = [
  item('model_connection', 'Model connection success and failure', 'model_control', 'Model profiles can be tested and routed with fallback/capability evidence.', [
    evidence('src/server/control-plane-service.test.ts', 'integration_test', 'Model connection and fallback route integration test', [
      'records model connection tests and previews model routing with fallbacks',
      'testModelProfile',
      'previewModelRoute',
    ]),
    evidence('src/server/control-plane-service.ts', 'service', 'Model test service entrypoint', [
      'export async function testModelProfile',
    ]),
  ]),
  item('network_egress', 'Proxy/IP outlet testing', 'model_control', 'Network profiles and model/Agent/CLI egress routes have health and mapping coverage.', [
    evidence('src/server/control-plane-service.test.ts', 'integration_test', 'Network egress integration test', [
      'builds Network/IP egress reports across model, Agent, and CLI routes',
      'testNetworkProfile',
      'networkProfileId',
    ]),
    evidence('src/server/network-egress-report-service.ts', 'service', 'Network egress report service', [
      'getNetworkEgressReport',
      'modelRouteCount',
      'cliRouteCount',
    ]),
    evidence('src/server/network-egress-live-test-service.ts', 'service', 'Guarded live egress IP probe service', [
      'testNetworkEgress',
      'AGENTHUB_ENABLE_REAL_NETWORK_EGRESS_TEST',
      'observedIp',
    ]),
    evidence('scripts/smoke-network-egress-report-api.ts', 'api_smoke', 'Network egress API smoke', [
      'getNetworkEgressReport',
      'Expected model route through network profile',
      'Expected CLI route through network profile',
      'Expected live egress probe to return observed proxy IP',
    ]),
  ]),
  item('agent_permission_interception', 'Agent permission interception', 'permissions', 'High-risk Agent actions are blocked or routed through approval instead of silently executing.', [
    evidence('src/server/control-plane-service.test.ts', 'integration_test', 'CLI/MCP/software approval-gating tests', [
      'waiting for approval',
      'requires_approval',
      'permissionPolicy',
    ]),
    evidence('src/server/autonomy-policy-service.ts', 'service', 'Autonomy decision service', [
      'evaluateAutonomyAction',
      'requiresApproval',
      'blocked',
    ]),
  ]),
  item('cli_profile_execution', 'CLI Profile execution', 'tools', 'CLI profiles can be tested, rendered, dry-run, and approval-gated for live execution.', [
    evidence('src/server/control-plane-service.test.ts', 'integration_test', 'CLI profile run integration test', [
      'runCliProfile',
      'testCliProfile',
      'error: expect.stringContaining(\'waiting for approval\')',
    ]),
    evidence('src/server/cli-runner-service.ts', 'service', 'CLI runner service', [
      'export async function runCliProfile',
      'renderedArgs',
      'createCliExecutionApprovalRequest',
    ]),
  ]),
  item('mcp_tool_invocation', 'MCP tool invocation', 'tools', 'MCP tools can be discovered, dry-run, approval-gated for live invocation, bound to a guarded MCP server runtime lifecycle, and executed through local stdio or remote HTTP JSON-RPC when live gates, endpoint allowlists, and approvals are satisfied.', [
    evidence('src/server/control-plane-service.test.ts', 'integration_test', 'MCP discovery, dry-run, and runtime lifecycle integration test', [
      'discovers MCP tool manifests and records safe tool-call dry-runs',
      'planMcpServerRuntime',
      'startMcpServerRuntime',
      'getMcpServerRuntimeStatus',
      'runMcpTool',
      'error: expect.stringContaining(\'waiting for approval\')',
    ]),
    evidence('src/server/mcp-tool-service.ts', 'service', 'MCP tool service', [
      'discoverMcpTools',
      'runMcpTool',
      'createMcpToolApprovalRequest',
      'executeMcpStdioTool',
      'executeMcpHttpTool',
      'MCP JSON-RPC',
    ]),
    evidence('src/server/mcp-runtime-service.ts', 'service', 'Guarded MCP runtime lifecycle service', [
      'MCP_PROCESS_ENABLE_ENV',
      'MCP_COMMAND_ALLOWLIST_ENV',
      'MCP_ENDPOINT_HOST_ALLOWLIST_ENV',
      'planMcpServerRuntime',
      'startMcpServerRuntime',
      'stopMcpServerRuntime',
      'getMcpServerRuntimeStatus',
    ]),
    evidence('src/app/api/mcp-servers/[id]/runtime/route.ts', 'api_smoke', 'MCP runtime lifecycle API route', [
      'getMcpServerRuntimeStatus',
      'startMcpServerRuntime',
      'stopMcpServerRuntime',
    ]),
    evidence('scripts/smoke-mcp-runtime-api.ts', 'api_smoke', 'MCP runtime lifecycle API smoke', [
      'MCP_PROCESS_ENABLE_ENV',
      'action: \'start\'',
      'liveExecuted === false',
    ]),
    evidence('scripts/smoke-mcp-jsonrpc-tool-api.ts', 'api_smoke', 'MCP JSON-RPC tool API smoke', [
      'liveStatus',
      'complete',
      'mcp.tool.call.live',
    ]),
    evidence('scripts/smoke-mcp-remote-http-tool-api.ts', 'api_smoke', 'Remote HTTP MCP JSON-RPC tool API smoke', [
      'MCP_ENDPOINT_HOST_ALLOWLIST_ENV',
      'remote.echo',
      'requestCount',
      'liveStatus',
      'complete',
    ]),
    evidence('scripts/fixtures/smoke-mcp-jsonrpc-server.mjs', 'api_smoke', 'Local MCP JSON-RPC fixture', [
      'tools/list',
      'tools/call',
      'smoke.echo',
    ]),
  ]),
  item('skills_install_enable', 'Skills install and enable', 'tools', 'Skills can be installed, enabled, listed, and checked through SkillsMap readiness.', [
    evidence('src/server/control-plane-service.test.ts', 'integration_test', 'Skills and SkillsMap integration tests', [
      'reports SkillsMap embedding, local Skills, install flows, and marketplace readiness',
      'installSkill',
      'setSkillEnabled',
    ]),
    evidence('scripts/smoke-skillsmap-integration-api.ts', 'api_smoke', 'SkillsMap API smoke', [
      'getSkillsMapReport',
      'skillsMapInstallFlows',
      'Expected embedded SkillsMap browser panel',
    ]),
  ]),
  item('agent_runtime_loop', 'Agent employee runtime loop', 'runtime', 'Employee runs emit understand/retrieve/plan/verify/checkpoint traces.', [
    evidence('src/server/employee-runtime-service.ts', 'service', 'Employee runtime loop service', [
      'executeEmployeeRun',
      'retrieveRelevantMemories',
      'checkpoint_ready_state',
    ]),
    evidence('scripts/smoke-employee-runtime-loop-api.ts', 'api_smoke', 'Employee runtime loop API smoke', [
      'Verify the runtime employee loop trace',
      'verify_output_contract',
      'retrieve_memory',
    ]),
  ]),
  item('artifact_validation', 'Agent output artifact validation', 'runtime', 'Required output artifacts are validated against contract and accessibility rules.', [
    evidence('src/server/verification-service.ts', 'service', 'Artifact verification service', [
      'validateEmployeeRunArtifactContract',
      'listArtifactValidationsForRun',
      'evaluateOutputAccessibility',
    ]),
    evidence('src/server/control-plane-service.test.ts', 'integration_test', 'Output contract and accessibility tests', [
      'validates accessible Agent output contracts for HTML, documents, and images',
      'verify output contracts',
      'validateEmployeeRunArtifactContract',
    ]),
  ]),
  item('multi_agent_parallel', 'Multi-Agent parallel execution', 'isolation', 'Parallel-safe Agent work is distinguished from real desktop work that needs locks.', [
    evidence('src/server/control-plane-service.test.ts', 'integration_test', 'Multi-Agent isolation integration test', [
      'reports multi-Agent isolation, required locks, and desktop conflicts',
      'parallelSafe',
      'browserProfilePerAgent',
    ]),
    evidence('src/server/agent-isolation-service.ts', 'service', 'Agent isolation report service', [
      'getAgentIsolationReport',
      'parallelSafe',
      'v2UpgradePath',
    ]),
  ]),
  item('resource_lock_conflict', 'Resource lock conflicts', 'isolation', 'Conflicting writes, desktops, browser profiles, and device resources are locked or rejected.', [
    evidence('src/server/control-plane-service.test.ts', 'integration_test', 'Resource lock conflict tests', [
      'enforces resource locks and resolves approvals',
      'already locked',
      'releaseResourceLock',
    ]),
    evidence('src/server/resource-lock-service.ts', 'service', 'Resource lock service', [
      'acquireResourceLock',
      'releaseResourceLock',
      'expireResourceLocks',
    ]),
    evidence('src/server/runtime-control-service.ts', 'service', 'Mobile device allowlist gate', [
      'AGENTHUB_RUNTIME_CONTROL_KILL_SWITCH',
      'AGENTHUB_ADB_PATH',
      'AGENTHUB_ADB_ARGS_PREFIX_JSON',
      'AGENTHUB_ALLOWED_DESKTOP_TARGETS',
      'AGENTHUB_ALLOWED_MOBILE_DEVICE_IDS',
      'resolveAdbCommand',
      'runAdbCommand',
      'runtimeControlKillSwitchActive',
      'desktopTargetAllowed',
      'mobileDeviceAllowed',
      'evaluateDesktopTargetAllowlist',
      'evaluateMobileDeviceAllowlist',
    ]),
    evidence('scripts/smoke-production-integrations-api.ts', 'api_smoke', 'Desktop and mobile allowlist smoke', [
      'Expected global runtime-control kill switch to block high-risk live control',
      'Expected desktop control to reject targets outside the live allowlist',
      'Expected mobile control to reject devices outside the live allowlist',
      'runtimeControlKillSwitchStatus',
      'allowed-smoke-window',
      'allowed-smoke-device',
      'desktopTargetAllowlistPassed',
      'mobileDeviceAllowlistPassed',
    ]),
    evidence('scripts/smoke-runtime-adb-execution-api.ts', 'api_smoke', 'Configured ADB runtime smoke', [
      'AGENTHUB_ADB_PATH',
      'AGENTHUB_ADB_ARGS_PREFIX_JSON',
      'Expected mobile discovery evidence to mention configured',
      'Expected runtime-control list_devices to complete',
      'runtimeLiveExecuted',
    ]),
  ]),
  item('browser_session_isolation', 'Browser session isolation', 'isolation', 'Browser sessions preserve encrypted state references and Agent-scoped access boundaries.', [
    evidence('src/server/control-plane-service.test.ts', 'integration_test', 'Browser session isolation tests', [
      'persists browser sessions with encrypted state refs isolation keep-alive and export policy',
      'evaluateBrowserSessionAccess',
      'blockedDomains',
    ]),
    evidence('src/server/browser-session-service.ts', 'service', 'Browser session service', [
      'ownerAgentProfileId',
      'cookieJarRef',
      'encrypted',
      'blockedDomains',
    ]),
  ]),
  item('file_write_isolation', 'File write isolation', 'isolation', 'Agent file writes stay inside workspace boundaries and are represented by resource locks/environment previews.', [
    evidence('src/server/control-plane-service.test.ts', 'integration_test', 'File boundary and workspace isolation tests', [
      'workspace_path',
      'targetPath',
      'private',
    ]),
    evidence('src/server/agent-environment-service.ts', 'service', 'Agent environment projection service', [
      'buildAgentEnvironment',
      'workspace',
      'mounts',
    ]),
    evidence('src/server/file-system-boundary-service.ts', 'service', 'File-system boundary service', [
      'evaluateFileSystemBoundary',
      'requestedPath',
      'workspace',
    ]),
  ]),
  item('memory_write_retrieval', 'Memory write and retrieval', 'memory_learning', 'Agent memory creation, reflection, and relevant retrieval are tested.', [
    evidence('src/server/control-plane-service.test.ts', 'integration_test', 'Memory write/retrieval integration tests', [
      'createMemoryItem',
      'retrieveRelevantMemories',
      'createRunReflection',
    ]),
    evidence('src/server/agent-memory-service.ts', 'service', 'Agent memory service', [
      'retrieveRelevantMemories',
      'createMemoryItem',
      'createRunReflection',
    ]),
    evidence('scripts/smoke-agent-memory-learning-report-api.ts', 'api_smoke', 'Memory/learning report API smoke', [
      'createMemoryItem',
      'approveLearningEvent',
      'Expected ready memory report',
    ]),
  ]),
  item('learning_review', 'Learning result review', 'memory_learning', 'Learning proposals require review before becoming durable Playbooks/global knowledge.', [
    evidence('src/server/control-plane-service.test.ts', 'integration_test', 'Learning review tests', [
      'approveLearningEvent',
      'Review pending learning events',
    ]),
    evidence('src/server/learning-service.ts', 'service', 'Learning service', [
      'proposeLearningEventFromReflection',
      'approveLearningEvent',
      'rejectLearningEvent',
    ]),
  ]),
  item('software_macro_record_replay', 'Software command record and replay', 'tools', 'Recorded macros can be created, dry-run replayed, and approval-gated for live replay.', [
    evidence('src/server/control-plane-service.test.ts', 'integration_test', 'Recorded macro replay tests', [
      'records software macros and gates live macro replay behind approval',
      'createRecordedMacro',
      'replayRecordedMacro',
    ]),
    evidence('src/server/recorded-macro-service.ts', 'service', 'Recorded macro service', [
      'createRecordedMacro',
      'replayRecordedMacro',
      'listMacroReplayRuns',
    ]),
  ]),
  item('canvas_node_status', 'Canvas node status updates', 'canvas', 'Workflow Canvas reports latest node progress, graph order, output contracts, and visual status.', [
    evidence('src/server/control-plane-service.test.ts', 'integration_test', 'Canvas node status integration test', [
      'builds Canvas orchestration reports with contracts, graph order, and latest node status',
      'progressStatus',
      'waiting_for_approval',
    ]),
    evidence('src/server/workflow-canvas-report-service.ts', 'service', 'Workflow Canvas report service', [
      'getWorkflowCanvasReport',
      'latestProgressStatus',
      'progressStatus',
    ]),
    evidence('scripts/smoke-workflow-canvas-report-api.ts', 'api_smoke', 'Workflow Canvas report API smoke', [
      'getCanvasReport',
      'summary.agentNodeCount',
      'summary.approvalNodeCount',
      'artifactFlow',
    ]),
  ]),
  item('approval_pause_resume', 'Human approval pause and resume', 'runtime', 'Approval points pause work and approved runs can resume through runtime/workflow services.', [
    evidence('src/server/control-plane-service.test.ts', 'integration_test', 'Approval pause/resume tests', [
      'pauseEmployeeRun',
      'resumeEmployeeRun',
      'approval_approved',
    ]),
    evidence('src/server/employee-runtime-service.ts', 'service', 'Employee run controls', [
      'pauseEmployeeRun',
      'resumeEmployeeRun',
      'cancelEmployeeRun',
    ]),
    evidence('src/server/workflow-runner-service.ts', 'service', 'Workflow approval resume service', [
      'resolveWorkflowApprovalRequest',
      'Human approval approved',
      'executeWorkflowRun',
    ]),
  ]),
  item('failure_recovery_retry', 'Failure recovery and retry', 'resilience', 'Runtime errors are classified and retry/fallback strategies are learned from outcomes.', [
    evidence('src/server/control-plane-service.test.ts', 'integration_test', 'Recovery strategy integration tests', [
      'classifies runtime errors and learns higher-success recovery strategies',
      'retry_with_different_approach',
      'retry_with_fallback_model',
    ]),
    evidence('src/server/error-recovery-strategy-service.ts', 'service', 'Error recovery strategy service', [
      'classifyRuntimeError',
      'recordRecoveryStrategyAttempt',
      'rankRecoveryStrategies',
    ]),
  ]),
]

export async function getTestPlanCoverageReport(): Promise<TestPlanCoverageReport> {
  const items = await Promise.all(REQUIRED_TEST_PLAN_ITEMS.map(evaluateItem))
  const gaps = items.flatMap((item) => item.gaps.map((gap) => `${item.key}: ${gap}`))
  const warnings = items.flatMap((item) => item.warnings.map((warning) => `${item.key}: ${warning}`))
  const missingItems = items.filter((item) => item.status === 'missing').length
  return {
    readiness: missingItems === 0 ? 'ready' : 'needs_attention',
    requiredItems: items.length,
    coveredItems: items.length - missingItems,
    missingItems,
    categories: summarizeCategories(items),
    items,
    gaps,
    warnings,
    recommendations: buildRecommendations(missingItems),
    generatedAt: Date.now(),
  }
}

function item(
  key: string,
  title: string,
  category: string,
  requiredAssertion: string,
  evidenceFiles: RequiredTestPlanItem['evidenceFiles'],
  warnings: string[] = [],
): RequiredTestPlanItem {
  return { key, title, category, requiredAssertion, evidenceFiles, warnings }
}

function evidence(
  filePath: string,
  kind: TestPlanEvidenceKind,
  role: string,
  expectedMarkers: string[],
): RequiredTestPlanItem['evidenceFiles'][number] {
  return { path: filePath, kind, role, expectedMarkers }
}

async function evaluateItem(required: RequiredTestPlanItem): Promise<TestPlanCoverageItem> {
  const evidenceFiles = await Promise.all(required.evidenceFiles.map(evaluateEvidenceFile))
  const gaps = evidenceFiles.flatMap((coverage) => [
    ...(coverage.exists ? [] : [`${coverage.path} is missing.`]),
    ...coverage.missingMarkers.map((marker) => `${coverage.path} is missing marker ${marker}.`),
  ])
  return {
    key: required.key,
    title: required.title,
    category: required.category,
    requiredAssertion: required.requiredAssertion,
    status: gaps.length === 0 ? 'covered' : 'missing',
    evidenceFiles,
    evidence: [
      `${required.title} is tracked through ${evidenceFiles.length} evidence file(s).`,
      ...evidenceFiles.map((coverage) =>
        `${coverage.path}: ${coverage.exists ? 'exists' : 'missing'}; ${coverage.foundMarkers.length}/${coverage.expectedMarkers.length} marker(s) found.`,
      ),
    ],
    gaps,
    warnings: required.warnings ?? [],
  }
}

async function evaluateEvidenceFile(
  config: RequiredTestPlanItem['evidenceFiles'][number],
): Promise<TestPlanEvidenceFileCoverage> {
  const content = await readSource(config.path)
  const foundMarkers = content
    ? config.expectedMarkers.filter((marker) => content.includes(marker))
    : []
  return {
    path: config.path,
    kind: config.kind,
    role: config.role,
    expectedMarkers: config.expectedMarkers,
    foundMarkers,
    missingMarkers: config.expectedMarkers.filter((marker) => !foundMarkers.includes(marker)),
    exists: content !== null,
  }
}

function summarizeCategories(items: TestPlanCoverageItem[]): Record<string, TestPlanCategorySummary> {
  return items.reduce<Record<string, TestPlanCategorySummary>>((acc, item) => {
    const summary = acc[item.category] ?? { requiredItems: 0, coveredItems: 0, missingItems: 0 }
    summary.requiredItems += 1
    if (item.status === 'covered') summary.coveredItems += 1
    else summary.missingItems += 1
    acc[item.category] = summary
    return acc
  }, {})
}

function buildRecommendations(missingItems: number): string[] {
  if (missingItems === 0) {
    return [
      'Section 23 testing coverage is ready across model/network, permissions, tools, runtime, isolation, memory/learning, Canvas, approvals, and recovery.',
      'Keep API smokes and marker-based coverage reports updated whenever a capability is promoted in the implementation audit.',
    ]
  }
  return [
    'Add or update tests, API smokes, or service evidence for missing Section 23 checklist items.',
    'Re-run test-plan coverage after changing runtime, tool, isolation, memory, or Canvas behavior.',
  ]
}

async function readSource(relativePath: string): Promise<string | null> {
  try {
    return await readFile(path.resolve(process.cwd(), relativePath), 'utf8')
  } catch {
    return null
  }
}
