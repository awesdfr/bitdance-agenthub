import { readFile } from 'node:fs/promises'
import path from 'node:path'

export type ProductEffectStatus = 'available' | 'guarded' | 'reserved' | 'missing'

export interface ProductEffectEvidenceFileCoverage {
  path: string
  role: string
  expectedMarkers: string[]
  foundMarkers: string[]
  missingMarkers: string[]
  exists: boolean
}

export interface ProductEffectCoverageItem {
  key: string
  title: string
  promisedEffect: string
  status: ProductEffectStatus
  evidenceFiles: ProductEffectEvidenceFileCoverage[]
  evidence: string[]
  gaps: string[]
  warnings: string[]
}

export interface ProductEffectsCoverageReport {
  readiness: 'ready' | 'needs_attention'
  requiredEffects: number
  coveredEffects: number
  availableEffects: number
  guardedEffects: number
  reservedEffects: number
  missingEffects: number
  items: ProductEffectCoverageItem[]
  gaps: string[]
  warnings: string[]
  recommendations: string[]
  generatedAt: number
}

interface RequiredProductEffect {
  key: string
  title: string
  promisedEffect: string
  intendedStatus: Exclude<ProductEffectStatus, 'missing'>
  evidenceFiles: Array<{
    path: string
    role: string
    expectedMarkers: string[]
  }>
  warnings?: string[]
}

const REQUIRED_PRODUCT_EFFECTS: RequiredProductEffect[] = [
  effect('agent_employee_factory', 'Batch employee Agent creation', 'Users can create many different job-role Agents instead of using fixed built-in Agents.', 'available', [
    file('src/server/control-plane-service.ts', 'Agent Profile creation service', [
      'createAgentProfile',
      'modelProfileId',
      'cliProfileIds',
      'softwareProfileIds',
      'outputContract',
    ]),
    file('src/components/employee-agent-factory.tsx', 'Agent Factory UI', [
      'export function EmployeeAgentFactory',
      'createAgentProfile',
      'selectedCliIds',
      'outputArtifactType',
    ]),
  ]),
  effect('per_agent_independence', 'Independent Agent employee configuration', 'Each Agent owns role, memory, permissions, tools, workspace, and output requirements.', 'available', [
    file('src/server/control-plane-service.ts', 'Capability report and permission matrix', [
      'AgentProfileCapabilityReport',
      'declaredCapabilities',
      'permissionMatrix',
      'missingReferences',
    ]),
    file('src/server/agent-environment-service.ts', 'Agent environment projection', [
      'buildAgentEnvironment',
      'AGENTHUB_WORKSPACE',
      'mounts',
      'redactedSecretNames',
    ]),
  ]),
  effect('self_planning_runtime', 'Self-planning employee runtime', 'Agents can run through goal understanding, memory retrieval, planning, verification, and next-action selection.', 'available', [
    file('src/server/employee-runtime-service.ts', 'Employee runtime loop', [
      'executeEmployeeRun',
      'retrieveRelevantMemories',
      'create_plan',
      'nextRuntimeAction',
    ]),
    file('docs/reference/employee-runtime-loop.md', 'Runtime loop reference', [
      'understand_goal',
      'retrieve_memory',
      'create_plan',
      'nextRuntimeAction',
    ]),
  ]),
  effect('memory_learning', 'Project memory and learning', 'Agents can remember project/customer/software lessons and promote reviewed learning into reusable knowledge.', 'available', [
    file('src/server/agent-memory-service.ts', 'Memory and reflection service', [
      'retrieveRelevantMemories',
      'reflectAndLearn',
      'createMemoryItem',
      'createRunReflection',
    ]),
    file('src/server/learning-service.ts', 'Learning review service', [
      'proposeLearningEventFromReflection',
      'approveLearningEvent',
      'rejectLearningEvent',
    ]),
    file('src/components/memory-learning-center.tsx', 'Memory/Learning UI', [
      'Learning Review',
      'Promote team memory',
      'createMemoryItem',
    ]),
  ]),
  effect('cli_orchestration', 'CLI orchestration', 'Agents can use Codex CLI, Claude Code, OpenCode, or custom commands as registered CLI Profiles.', 'available', [
    file('src/server/cli-runner-service.ts', 'CLI runner service', [
      'runCliProfile',
      'renderedArgs',
      'cwdPolicy',
      'createCliExecutionApprovalRequest',
    ]),
    file('src/components/tool-control-center.tsx', 'Tool Control CLI UI', [
      'createCliProfile',
      'testCliProfile',
      'runCliProfile',
    ]),
  ]),
  effect('computer_browser_operation', 'Computer and browser operation', 'Agents can use isolated computer/browser session records, timelines, screenshots/observations, guarded desktop click/scroll/type/focus/screenshot actions with target allowlisting and emergency stop, and ADB-backed mobile tap/swipe/text/key/screenshot actions with per-device allowlisting.', 'guarded', [
    file('src/server/computer-session-manager.ts', 'Computer session manager', [
      'startComputerSessionForEmployeeRun',
      'recordComputerActionEvent',
      'recordComputerObservation',
      'getComputerSessionTimeline',
    ]),
    file('src/server/runtime-control-service.ts', 'Runtime Control adapters', [
      'executeRuntimeControlAction',
      'scroll',
      'mobile_swipe',
      'AGENTHUB_RUNTIME_CONTROL_KILL_SWITCH',
      'AGENTHUB_ALLOWED_DESKTOP_TARGETS',
      'AGENTHUB_ENABLE_REAL_MOBILE_CONTROL',
      'AGENTHUB_ALLOWED_MOBILE_DEVICE_IDS',
    ]),
    file('src/components/agent-workflow-canvas.tsx', 'Canvas computer timeline UI', [
      'ComputerSessionList',
      'recordComputerObservation',
      'Screenshot',
    ]),
  ], ['Live desktop control and mobile control remain emergency-stop, environment-gate, approval, go-live, resource-lock, desktop-target-allowlist, and mobile-device-allowlist guarded.']),
  effect('canvas_team_workflow', 'Canvas team workflow', 'Users can compose multiple Agent employees and approval/software/tool nodes into a visible workflow.', 'available', [
    file('src/server/workflow-canvas-report-service.ts', 'Workflow Canvas report service', [
      'getWorkflowCanvasReport',
      'agent_employee',
      'human_approval',
      'artifactFlow',
    ]),
    file('src/components/agent-workflow-canvas.tsx', 'Agent Canvas UI', [
      'export function AgentWorkflowCanvas',
      'createWorkflow',
      'startWorkflowRun',
      'ApprovalRequestList',
    ]),
  ]),
  effect('progress_visibility', 'Live progress visibility', 'Users can see where every Agent/node is, what it is doing, and what artifacts/logs/approvals exist.', 'available', [
    file('src/components/employee-agent-factory.tsx', 'Per-Agent run monitor', [
      'RunMonitor',
      'ArtifactValidationList',
      'ComputerSessionList',
      'LearningReflection',
    ]),
    file('src/components/agent-workflow-canvas.tsx', 'Workflow run monitor', [
      'NodeRunList',
      'EmployeeRunList',
      'ResourceLockList',
      'ApprovalRequestList',
    ]),
    file('src/server/run-event-feed-service.ts', 'Run event feed', [
      'getEmployeeRunEventFeed',
      'eventFeedToSse',
    ]),
  ]),
  effect('verifiable_artifacts', 'Deterministic verifiable artifacts', 'Each Agent output is bound to a contract and can be validated before downstream reuse.', 'available', [
    file('src/server/verification-service.ts', 'Artifact verification service', [
      'validateEmployeeRunArtifactContract',
      'requiredFiles',
      'validationRules',
      'listArtifactValidationsForRun',
    ]),
    file('src/server/workflow-preflight-service.ts', 'Workflow preflight contract checks', [
      'missing_output_contract',
      'outputContract',
      'runWorkflowPreflight',
    ]),
  ]),
  effect('multi_agent_parallel', 'Multi-Agent parallel work', 'Multiple Agents can run in isolated browser/CLI/workspace contexts while non-parallel desktop resources are detected.', 'available', [
    file('src/server/agent-isolation-service.ts', 'Agent isolation report service', [
      'getAgentIsolationReport',
      'parallelSafe',
      'workspacePerAgent',
      'browserProfilePerAgent',
    ]),
    file('src/server/resource-lock-service.ts', 'Resource lock service', [
      'acquireResourceLock',
      'releaseResourceLock',
      'expireResourceLocks',
    ]),
  ]),
  effect('workstation_resource_locks', 'Workstation and resource-lock safety', 'Desktop, files, browser profiles, software instances, mobile devices, and network profiles are protected from cross-Agent conflicts.', 'guarded', [
    file('src/server/agent-isolation-service.ts', 'Desktop conflict and v2 upgrade report', [
      'physical_mouse_keyboard',
      'resource locks',
      'v2UpgradePath',
    ]),
    file('src/server/resource-lock-service.ts', 'Conflict prevention service', [
      'Resource is already locked',
      'expiresAt',
      'ownerRunId',
    ]),
    file('src/server/runtime-control-service.ts', 'Workstation lifecycle adapter', [
      'launch_remote_session',
      'release_workstation',
      'Workstation is already busy',
    ]),
    file('src/server/production-integration-service.ts', 'Stale workstation recovery', [
      'getWorkstationLeaseRecoveryReport',
      'recoverStaleWorkstationLeases',
      'staleBusyWorkstations',
    ]),
  ], ['True simultaneous desktop control requires configured and authorized VM/RDP/VNC workstation infrastructure; built-in cloud VM provisioning is still an external customer-environment integration.']),
  effect('software_cli_ization', 'Software CLI-ization', 'Ordinary software actions can be wrapped as Software Profiles, Software Commands, and recorded macro capabilities.', 'available', [
    file('src/server/software-adapter-service.ts', 'Software command adapter', [
      'runSoftwareCommand',
      'adapterType',
      'implementationType',
      'createSoftwareCommandExecutionApprovalRequest',
    ]),
    file('src/server/recorded-macro-service.ts', 'Recorded macro adapter', [
      'createRecordedMacro',
      'replayRecordedMacro',
      'listMacroReplayRuns',
    ]),
    file('src/components/tool-control-center.tsx', 'Software CLI-ization UI', [
      'Software Profiles',
      'Software Commands',
      'Recorded Macros',
    ]),
  ]),
  effect('local_ai_employee_os', 'Local AI employee operating-system foundation', 'The product becomes a local control plane for Agent employees, tools, memory, governance, observability, configuration, workflows, guarded desktop/mobile control, and guarded VM/RDP/VNC workstations.', 'guarded', [
    file('src/components/sidebar.tsx', 'Workbench navigation shell', [
      'employee-factory',
      'agent-canvas',
      'models',
      'tools',
      'governance',
      'monitor',
      'configops',
      'production',
    ]),
    file('src/server/implementation-audit-service.ts', 'Full implementation audit', [
      'TARGET_SECTION_COUNT = 210',
      'baseline_plus',
      'implementedBaselineSections',
    ]),
    file('src/server/runtime-control-service.ts', 'Guarded local control runtime', [
      'AGENTHUB_RUNTIME_CONTROL_KILL_SWITCH',
      'AGENTHUB_ALLOWED_DESKTOP_TARGETS',
      'AGENTHUB_ALLOWED_MOBILE_DEVICE_IDS',
      'AGENTHUB_ALLOWED_WORKSTATION_TARGETS',
      'launch_remote_session',
    ]),
  ], ['The local employee OS foundation is available through guarded adapters; unrestricted live desktop, phone, account, payment, deletion, and customer infrastructure actions still require explicit authorization, allowlists, approvals, and go-live evidence.']),
]

export async function getProductEffectsCoverageReport(): Promise<ProductEffectsCoverageReport> {
  const items = await Promise.all(REQUIRED_PRODUCT_EFFECTS.map(evaluateEffect))
  const gaps = items.flatMap((item) => item.gaps.map((gap) => `${item.key}: ${gap}`))
  const warnings = items.flatMap((item) => item.warnings.map((warning) => `${item.key}: ${warning}`))
  return {
    readiness: gaps.length === 0 ? 'ready' : 'needs_attention',
    requiredEffects: items.length,
    coveredEffects: items.filter((item) => item.status !== 'missing').length,
    availableEffects: items.filter((item) => item.status === 'available').length,
    guardedEffects: items.filter((item) => item.status === 'guarded').length,
    reservedEffects: items.filter((item) => item.status === 'reserved').length,
    missingEffects: items.filter((item) => item.status === 'missing').length,
    items,
    gaps,
    warnings,
    recommendations: buildRecommendations(gaps),
    generatedAt: Date.now(),
  }
}

function effect(
  key: string,
  title: string,
  promisedEffect: string,
  intendedStatus: Exclude<ProductEffectStatus, 'missing'>,
  evidenceFiles: RequiredProductEffect['evidenceFiles'],
  warnings: string[] = [],
): RequiredProductEffect {
  return { key, title, promisedEffect, intendedStatus, evidenceFiles, warnings }
}

function file(
  filePath: string,
  role: string,
  expectedMarkers: string[],
): RequiredProductEffect['evidenceFiles'][number] {
  return { path: filePath, role, expectedMarkers }
}

async function evaluateEffect(required: RequiredProductEffect): Promise<ProductEffectCoverageItem> {
  const evidenceFiles = await Promise.all(required.evidenceFiles.map(evaluateEvidenceFile))
  const gaps = evidenceFiles.flatMap((coverage) => [
    ...(coverage.exists ? [] : [`${coverage.path} is missing.`]),
    ...coverage.missingMarkers.map((marker) => `${coverage.path} is missing marker ${marker}.`),
  ])
  const status: ProductEffectStatus = gaps.length === 0 ? required.intendedStatus : 'missing'
  return {
    key: required.key,
    title: required.title,
    promisedEffect: required.promisedEffect,
    status,
    evidenceFiles,
    evidence: [
      `${required.title} is tracked as ${status}.`,
      ...evidenceFiles.map((coverage) =>
        `${coverage.path}: ${coverage.exists ? 'exists' : 'missing'}; ${coverage.foundMarkers.length}/${coverage.expectedMarkers.length} marker(s) found.`,
      ),
    ],
    gaps,
    warnings: required.warnings ?? [],
  }
}

async function evaluateEvidenceFile(
  config: RequiredProductEffect['evidenceFiles'][number],
): Promise<ProductEffectEvidenceFileCoverage> {
  const content = await readSource(config.path)
  const foundMarkers = content
    ? config.expectedMarkers.filter((marker) => content.includes(marker))
    : []
  return {
    path: config.path,
    role: config.role,
    expectedMarkers: config.expectedMarkers,
    foundMarkers,
    missingMarkers: config.expectedMarkers.filter((marker) => !foundMarkers.includes(marker)),
    exists: content !== null,
  }
}

function buildRecommendations(gaps: string[]): string[] {
  if (gaps.length === 0) {
    return [
      'Section 24 product-effects coverage is ready: the product has an auditable Agent employee factory, runtime, memory, tools, Canvas, progress, artifact, isolation, software-adapter, and guarded local employee-OS foundation.',
      'Keep guarded effects explicit so the product does not overclaim unrestricted live desktop, mobile, account, payment, destructive file, or external VM provisioning autonomy.',
    ]
  }
  return [
    'Add missing effect evidence before marking Section 24 complete.',
    'Re-run product-effects coverage after changing Agent Factory, runtime, memory, Canvas, tools, isolation, or workstation behavior.',
  ]
}

async function readSource(relativePath: string): Promise<string | null> {
  try {
    return await readFile(path.resolve(process.cwd(), relativePath), 'utf8')
  } catch {
    return null
  }
}
