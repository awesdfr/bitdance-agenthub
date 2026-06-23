import { readFile } from 'node:fs/promises'
import path from 'node:path'

export type PhasePlanStatus = 'baseline_ready' | 'reserved' | 'missing'

export interface PhasePlanFileCoverage {
  path: string
  role: string
  expectedMarkers: string[]
  foundMarkers: string[]
  missingMarkers: string[]
  exists: boolean
}

export interface PhasePlanCoverageItem {
  phase: number
  title: string
  targetOutcome: string
  status: PhasePlanStatus
  files: PhasePlanFileCoverage[]
  evidence: string[]
  gaps: string[]
  warnings: string[]
}

export interface PhasePlanCoverageReport {
  readiness: 'ready' | 'needs_attention'
  requiredPhases: number
  coveredPhases: number
  baselineReadyPhases: number
  reservedPhases: number
  missingPhases: number
  items: PhasePlanCoverageItem[]
  gaps: string[]
  warnings: string[]
  recommendations: string[]
  generatedAt: number
}

interface RequiredPhasePlan {
  phase: number
  title: string
  targetOutcome: string
  intendedStatus: Exclude<PhasePlanStatus, 'missing'>
  files: Array<{
    path: string
    role: string
    expectedMarkers: string[]
  }>
}

const REQUIRED_PHASES: RequiredPhasePlan[] = [
  phase(1, 'Control plane foundation', 'Users can configure models, network outlets, Agents, CLI, Skills, MCP, tools, software, and permissions.', 'baseline_ready', [
    file('src/server/control-plane-service.ts', 'control-plane profile services', [
      'createModelProfile',
      'createNetworkProfile',
      'createAgentProfile',
      'createCliProfile',
      'createToolConnection',
      'createSoftwareProfile',
    ]),
    file('src/components/employee-agent-factory.tsx', 'Agent Factory surface', [
      'createAgentProfile',
      'selectedCliIds',
      'selectedMcpIds',
      'selectedSoftwareIds',
      'outputArtifactType',
    ]),
    file('src/components/model-control-center.tsx', 'Model Control surface', [
      'createModelProfile',
      'createNetworkProfile',
      'testModelConnection',
      'previewModelRoute',
    ]),
    file('src/components/tool-control-center.tsx', 'Tool Control surface', [
      'createCliProfile',
      'createMcpServer',
      'createToolConnection',
      'createSoftwareProfile',
    ]),
    file('src/components/skills-center.tsx', 'Skills surface', [
      'fetchSkillsCenterData',
      'installSkill',
      'setSkillEnabled',
    ]),
  ]),
  phase(2, 'Agent employee runtime', 'Agents execute a plan-observe-act-verify loop, emit events, recover from blockers, and produce verified artifacts.', 'baseline_ready', [
    file('src/server/employee-runtime-service.ts', 'employee runtime loop', [
      'startEmployeeRun',
      'executeEmployeeRun',
      'getEmployeeRunSnapshot',
      'pauseEmployeeRun',
      'resumeEmployeeRun',
      'cancelEmployeeRun',
    ]),
    file('src/server/verification-service.ts', 'artifact and contract validation', [
      'validateEmployeeRunArtifactContract',
      'evaluateOutputAccessibility',
      'listArtifactValidationsForRun',
    ]),
    file('src/server/run-event-feed-service.ts', 'runtime event feeds', [
      'getEmployeeRunEventFeed',
      'eventFeedToSse',
    ]),
    file('src/components/employee-agent-factory.tsx', 'runtime monitor UI', [
      'RunMonitor',
      'pauseEmployeeRun',
      'resumeEmployeeRun',
      'cancelEmployeeRun',
      'ArtifactValidationList',
    ]),
  ]),
  phase(3, 'Canvas orchestration', 'Users can compose Agent, approval, software, condition, and artifact nodes and watch workflow state.', 'baseline_ready', [
    file('src/server/workflow-runner-service.ts', 'workflow execution engine', [
      'executeWorkflowRun',
      'resolveWorkflowApprovalRequest',
      'listWorkflowEmployeeRuns',
    ]),
    file('src/server/workflow-preflight-service.ts', 'workflow preflight checks', [
      'runWorkflowPreflight',
      'listWorkflowPreflights',
    ]),
    file('src/components/agent-workflow-canvas.tsx', 'Canvas UI', [
      'export function AgentWorkflowCanvas',
      'createWorkflow',
      'startWorkflowRun',
      'runWorkflowPreflight',
      'NodeRunList',
      'ApprovalRequestList',
    ]),
    file('src/server/workflow-canvas-report-service.ts', 'Canvas report', [
      'getWorkflowCanvasReport',
    ]),
  ]),
  phase(4, 'Memory and learning', 'Agents retrieve memories, write reflections, review learning events, and promote playbooks.', 'baseline_ready', [
    file('src/server/agent-memory-service.ts', 'memory retrieval and reflection', [
      'retrieveRelevantMemories',
      'reflectAndLearn',
      'createMemoryItem',
      'createRunReflection',
    ]),
    file('src/server/learning-service.ts', 'learning review and Playbook promotion', [
      'proposeLearningEventFromReflection',
      'approveLearningEvent',
      'rejectLearningEvent',
      'listPlaybooks',
    ]),
    file('src/components/memory-learning-center.tsx', 'Memory Center UI', [
      'createMemoryItem',
      'approveLearningEvent',
      'rejectLearningEvent',
      'Learning Review',
      'Promote team memory',
    ]),
    file('src/server/memory-graph-service.ts', 'memory graph and knowledge visualization', [
      'createMemoryGraphView',
      'exportMemoryGraphView',
    ]),
  ]),
  phase(5, 'Computer and browser operation', 'Each Agent can use isolated browser/workspace/session metadata, timelines, approvals, and resource locks for computer work.', 'baseline_ready', [
    file('src/server/computer-session-manager.ts', 'computer session and timeline manager', [
      'startComputerSessionForEmployeeRun',
      'recordComputerActionEvent',
      'recordComputerObservation',
      'getComputerSessionTimeline',
    ]),
    file('src/server/resource-lock-service.ts', 'resource lock service', [
      'acquireResourceLock',
      'releaseResourceLock',
      'expireResourceLocks',
      'listResourceLocksForRun',
    ]),
    file('src/server/agent-isolation-service.ts', 'multi-Agent isolation report', [
      'getAgentIsolationReport',
      'physical desktop',
      'resource locks',
      'v2UpgradePath',
    ]),
    file('src/components/agent-workflow-canvas.tsx', 'computer timeline UI', [
      'ComputerSessionList',
      'recordComputerObservation',
      'Screenshot',
      'ResourceLockList',
    ]),
  ]),
  phase(6, 'Software CLI-ization', 'Users can register software, expose commands, record macros, test/dry-run them, and assign them to Agents.', 'baseline_ready', [
    file('src/server/software-adapter-service.ts', 'software command adapter', [
      'runSoftwareCommand',
      'listSoftwareCommandRuns',
    ]),
    file('src/server/recorded-macro-service.ts', 'recorded macro adapter', [
      'createRecordedMacro',
      'replayRecordedMacro',
      'listRecordedMacros',
    ]),
    file('src/components/tool-control-center.tsx', 'software CLI-ization UI', [
      'createSoftwareProfile',
      'createSoftwareCommand',
      'createRecordedMacro',
      'Software Profiles',
      'Recorded Macros',
    ]),
    file('src/server/capability-graph-service.ts', 'Agent-callable capability indexing', [
      'softwareCommands',
      'defaultWorkstationMode',
    ]),
  ]),
  phase(7, 'Virtual workstations', 'Agents can use guarded VM, virtual desktop, RDP, VNC, and remote-session workstations when the customer has configured and authorized the target infrastructure.', 'baseline_ready', [
    file('src/db/schema.ts', 'workstation schema and mode reservation', [
      'agent_workstations',
      'virtual_desktop',
      'vm',
      'remote_session',
    ]),
    file('src/server/agent-isolation-service.ts', 'parallel workstation isolation report', [
      'v2UpgradePath',
      'virtual_desktop',
      'vm',
      'remote_session',
    ]),
    file('src/server/runtime-control-service.ts', 'guarded workstation validation, launch, and release runtime', [
      'validate_workstation',
      'launch_remote_session',
      'release_workstation',
      'buildWorkstationLaunchPlan',
      'WorkstationLaunchPlan',
      'rdp_file',
      'vnc_url',
      'hyperv',
      'virtualbox',
      'vmware',
    ]),
    file('src/server/production-integration-service.ts', 'workstation provider discovery and recovery evidence', [
      'discoverWorkstationProviders',
      'getWorkstationLeaseRecoveryReport',
      'recoverStaleWorkstationLeases',
      'workstation_target_allowlist',
    ]),
  ]),
]

export async function getPhasePlanCoverageReport(): Promise<PhasePlanCoverageReport> {
  const items = await Promise.all(REQUIRED_PHASES.map(evaluatePhase))
  const gaps = items.flatMap((item) => item.gaps.map((gap) => `Phase ${item.phase}: ${gap}`))
  const warnings = items.flatMap((item) => item.warnings.map((warning) => `Phase ${item.phase}: ${warning}`))
  return {
    readiness: gaps.length === 0 ? 'ready' : 'needs_attention',
    requiredPhases: items.length,
    coveredPhases: items.filter((item) => item.status !== 'missing').length,
    baselineReadyPhases: items.filter((item) => item.status === 'baseline_ready').length,
    reservedPhases: items.filter((item) => item.status === 'reserved').length,
    missingPhases: items.filter((item) => item.status === 'missing').length,
    items,
    gaps,
    warnings,
    recommendations: buildRecommendations(gaps),
    generatedAt: Date.now(),
  }
}

function phase(
  phaseNumber: number,
  title: string,
  targetOutcome: string,
  intendedStatus: Exclude<PhasePlanStatus, 'missing'>,
  files: RequiredPhasePlan['files'],
): RequiredPhasePlan {
  return { phase: phaseNumber, title, targetOutcome, intendedStatus, files }
}

function file(
  filePath: string,
  role: string,
  expectedMarkers: string[],
): RequiredPhasePlan['files'][number] {
  return { path: filePath, role, expectedMarkers }
}

async function evaluatePhase(required: RequiredPhasePlan): Promise<PhasePlanCoverageItem> {
  const files = await Promise.all(required.files.map(evaluateFile))
  const gaps = files.flatMap((coverage) => [
    ...(coverage.exists ? [] : [`${coverage.path} is missing.`]),
    ...coverage.missingMarkers.map((marker) => `${coverage.path} is missing marker ${marker}.`),
  ])
  const status: PhasePlanStatus = gaps.length === 0 ? required.intendedStatus : 'missing'
  return {
    phase: required.phase,
    title: required.title,
    targetOutcome: required.targetOutcome,
    status,
    files,
    evidence: [
      `${required.title} is tracked as ${status}.`,
      ...files.map((coverage) =>
        `${coverage.path}: ${coverage.exists ? 'exists' : 'missing'}; ${coverage.foundMarkers.length}/${coverage.expectedMarkers.length} marker(s) found.`,
      ),
    ],
    gaps,
    warnings: required.intendedStatus === 'reserved'
      ? ['This phase is intentionally reserved for v2/vm/remote-session implementation, with schema and architecture hooks present.']
      : [],
  }
}

async function evaluateFile(
  config: RequiredPhasePlan['files'][number],
): Promise<PhasePlanFileCoverage> {
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
      'Section 22 phase-plan coverage is ready: Phases 1-7 have baseline implementation evidence, including guarded VM/RDP/VNC workstation validation, launch, release, allowlisting, and recovery paths.',
      'Treat Phase 7 as guarded infrastructure integration: customer-provided VM/RDP/VNC targets are supported, while external cloud VM provisioning still requires an authorized customer environment.',
    ]
  }
  return [
    'Add missing phase evidence markers before promoting the phase plan.',
    'Re-run phase-plan coverage after runtime, workstation, or software-adapter changes.',
  ]
}

async function readSource(relativePath: string): Promise<string | null> {
  try {
    return await readFile(path.resolve(process.cwd(), relativePath), 'utf8')
  } catch {
    return null
  }
}
