import { readFile } from 'node:fs/promises'
import path from 'node:path'

export type BackendServiceCoverageStatus = 'covered' | 'missing' | 'weak'
export type BackendServiceImplementationKind = 'dedicated' | 'composite'
export type BackendServicePriority = 'critical' | 'standard'

export interface BackendServiceFileCoverage {
  path: string
  role: string
  exists: boolean
  expectedExports: string[]
  foundExports: string[]
  missingExports: string[]
}

export interface BackendServiceCoverageItem {
  key: string
  requiredName: string
  implementationKind: BackendServiceImplementationKind
  priority: BackendServicePriority
  files: BackendServiceFileCoverage[]
  apiEvidence: string[]
  status: BackendServiceCoverageStatus
  evidence: string[]
  gaps: string[]
}

export interface BackendServiceCoverageReport {
  readiness: 'ready' | 'needs_attention'
  requiredServices: number
  coveredServices: number
  weakServices: number
  missingServices: number
  dedicatedServices: number
  compositeServices: number
  criticalServices: number
  coveredCriticalServices: number
  items: BackendServiceCoverageItem[]
  gaps: string[]
  recommendations: string[]
  generatedAt: number
}

interface RequiredBackendService {
  key: string
  requiredName: string
  implementationKind: BackendServiceImplementationKind
  priority?: BackendServicePriority
  files: Array<{
    path: string
    role: string
    expectedExports: string[]
  }>
  apiEvidence: string[]
}

const REQUIRED_BACKEND_SERVICES: RequiredBackendService[] = [
  composite('ModelProfileService', 'Model profile service', [
    serviceFile('src/server/control-plane-service.ts', 'profile CRUD and structural tests', [
      'createModelProfile',
      'listModelProfiles',
      'testModelProfile',
    ]),
    serviceFile('src/server/model-gateway-service.ts', 'provider connection tests and routing previews', [
      'testModelConnection',
      'previewModelRoute',
    ]),
  ], ['/api/model-profiles', '/api/model-profiles/:id/test', '/api/model-gateway/route-preview']),
  composite('NetworkProfileService', 'Network/IP outlet service', [
    serviceFile('src/server/control-plane-service.ts', 'network profile CRUD and health tests', [
      'createNetworkProfile',
      'listNetworkProfiles',
      'testNetworkProfile',
    ]),
    serviceFile('src/server/network-egress-report-service.ts', 'egress assignment readiness report', [
      'getNetworkEgressReport',
      'getNetworkProfileEgressReport',
    ]),
    serviceFile('src/server/network-egress-live-test-service.ts', 'guarded live egress IP probe', [
      'testNetworkEgress',
      'NetworkEgressLiveTestResult',
      'NETWORK_EGRESS_ENV_GATE',
    ]),
  ], ['/api/network-profiles', '/api/network-profiles/:id/test', '/api/network-profiles/egress-report', '/api/network-profiles/:id/egress-live-test']),
  composite('AgentProfileService', 'Agent profile service', [
    serviceFile('src/server/control-plane-service.ts', 'Agent employee profile CRUD', [
      'createAgentProfile',
      'listAgentProfiles',
      'updateAgentProfile',
    ]),
    serviceFile('src/server/agent-isolation-service.ts', 'Agent workstation/isolation inspection', [
      'getAgentIsolationReport',
    ]),
    serviceFile('src/server/agent-memory-learning-report-service.ts', 'Agent memory/learning readiness inspection', [
      'getAgentMemoryLearningReport',
    ]),
  ], ['/api/agent-profiles', '/api/agent-profiles/:id/isolation-report', '/api/agent-profiles/:id/memory-learning-report']),
  dedicated('AgentEmployeeRuntime', 'Agent employee runtime', 'critical', [
    serviceFile('src/server/employee-runtime-service.ts', 'employee plan-act-verify runtime loop', [
      'startEmployeeRun',
      'executeEmployeeRun',
      'getEmployeeRunSnapshot',
      'pauseEmployeeRun',
      'resumeEmployeeRun',
      'cancelEmployeeRun',
    ]),
  ], ['/api/employee-runs', '/api/employee-runs/:id', '/api/employee-runs/:id/events']),
  dedicated('AgentMemoryService', 'Agent memory service', 'critical', [
    serviceFile('src/server/agent-memory-service.ts', 'retrieval, memory writes, reflection, and privacy checks', [
      'retrieveRelevantMemories',
      'reflectAndLearn',
      'createMemoryItem',
      'createRunReflection',
      'evaluateMemoryPrivacyAccess',
    ]),
  ], ['/api/memory-items', '/api/agent-runs/:id/memory', '/api/agent-runs/:id/reflection']),
  dedicated('LearningService', 'Learning service', 'standard', [
    serviceFile('src/server/learning-service.ts', 'learning review and Playbook promotion', [
      'proposeLearningEventFromReflection',
      'approveLearningEvent',
      'rejectLearningEvent',
      'listPlaybooks',
    ]),
  ], ['/api/learning-events', '/api/playbooks']),
  composite('CanvasWorkflowService', 'Canvas workflow service', [
    serviceFile('src/server/workflow-canvas-report-service.ts', 'Canvas graph and artifact-flow inspection', [
      'getWorkflowCanvasReport',
    ]),
    serviceFile('src/server/workflow-preflight-service.ts', 'preflight budget/risk/resource checks', [
      'runWorkflowPreflight',
      'listWorkflowPreflights',
    ]),
  ], ['/api/workflows/:id/canvas-report', '/api/workflow-preflights']),
  dedicated('WorkflowRunner', 'Workflow runner service', 'standard', [
    serviceFile('src/server/workflow-runner-service.ts', 'workflow execution and approval continuation', [
      'executeWorkflowRun',
      'resolveWorkflowApprovalRequest',
      'listWorkflowEmployeeRuns',
    ]),
  ], ['/api/workflows/:id/run', '/api/workflow-runs/:id']),
  composite('ToolConnectionService', 'Tool connection service', [
    serviceFile('src/server/control-plane-service.ts', 'Tool Connection CRUD and tests', [
      'createToolConnection',
      'listToolConnections',
      'testToolConnection',
    ]),
    serviceFile('src/server/mcp-tool-service.ts', 'MCP tool discovery and invocation records', [
      'discoverMcpTools',
      'runMcpTool',
    ]),
  ], ['/api/tool-connections', '/api/tool-connections/:id/test', '/api/mcp-tools']),
  dedicated('McpService', 'MCP service', 'standard', [
    serviceFile('src/server/mcp-tool-service.ts', 'manifest-backed tool discovery and dry-run calls', [
      'discoverMcpTools',
      'listMcpToolDefinitions',
      'runMcpTool',
      'listMcpToolCalls',
    ]),
  ], ['/api/mcp-servers', '/api/mcp-servers/:id/discover-tools', '/api/mcp-tools/:id/run']),
  dedicated('CliRunner', 'CLI runner service', 'standard', [
    serviceFile('src/server/cli-runner-service.ts', 'CLI profile rendering, dry-run records, and approval-gated execute path', [
      'runCliProfile',
      'runCliProfilesForEmployeeRun',
      'listCliRuns',
    ]),
  ], ['/api/cli-profiles', '/api/cli-runs']),
  dedicated('SoftwareAdapterService', 'Software adapter service', 'critical', [
    serviceFile('src/server/software-adapter-service.ts', 'software command adapter and dry-run records', [
      'runSoftwareCommand',
      'listSoftwareCommandRuns',
    ]),
  ], ['/api/software-profiles', '/api/software-commands', '/api/software-command-runs']),
  dedicated('ComputerSessionManager', 'Computer session manager', 'critical', [
    serviceFile('src/server/computer-session-manager.ts', 'browser/desktop action timelines and observation records', [
      'startComputerSessionForEmployeeRun',
      'recordComputerActionEvent',
      'recordComputerObservation',
      'completeComputerSession',
      'getComputerSessionTimeline',
    ]),
  ], ['/api/computer-sessions', '/api/computer-sessions/:id/actions', '/api/computer-sessions/:id/observations']),
  dedicated('ResourceLockService', 'Resource lock service', 'critical', [
    serviceFile('src/server/resource-lock-service.ts', 'conflicting resource serialization', [
      'acquireResourceLock',
      'releaseResourceLock',
      'releaseResourceLocks',
      'expireResourceLocks',
      'listResourceLocksForRun',
    ]),
  ], ['/api/resource-locks', '/api/workflow-preflights']),
  dedicated('ArtifactService', 'Artifact service', 'standard', [
    serviceFile('src/server/artifact-service.ts', 'artifact listing and version management', [
      'listArtifacts',
      'createArtifactVersion',
      'deleteArtifact',
    ]),
  ], ['/api/artifacts', '/api/artifacts/:id/versions']),
  dedicated('VerificationService', 'Verification service', 'standard', [
    serviceFile('src/server/verification-service.ts', 'output-contract and accessibility validation', [
      'validateEmployeeRunArtifactContract',
      'listArtifactValidationsForRun',
      'evaluateOutputAccessibility',
    ]),
  ], ['/api/artifact-validations', '/api/employee-runs/:id']),
  composite('ApprovalService', 'Approval service', [
    serviceFile('src/server/control-plane-service.ts', 'approval request lifecycle', [
      'createApprovalRequest',
      'listApprovalRequests',
      'respondApprovalRequest',
    ]),
    serviceFile('src/server/workflow-runner-service.ts', 'workflow approval continuation', [
      'resolveWorkflowApprovalRequest',
    ]),
  ], ['/api/approvals', '/api/approvals/:id/approve', '/api/approvals/:id/reject']),
]

export async function getBackendServiceCoverageReport(): Promise<BackendServiceCoverageReport> {
  const items = await Promise.all(REQUIRED_BACKEND_SERVICES.map(evaluateService))
  const gaps = items.flatMap((item) => item.gaps.map((gap) => `${item.key}: ${gap}`))
  const criticalServices = items.filter((item) => item.priority === 'critical')
  return {
    readiness: gaps.length === 0 ? 'ready' : 'needs_attention',
    requiredServices: items.length,
    coveredServices: items.filter((item) => item.status === 'covered').length,
    weakServices: items.filter((item) => item.status === 'weak').length,
    missingServices: items.filter((item) => item.status === 'missing').length,
    dedicatedServices: items.filter((item) => item.implementationKind === 'dedicated').length,
    compositeServices: items.filter((item) => item.implementationKind === 'composite').length,
    criticalServices: criticalServices.length,
    coveredCriticalServices: criticalServices.filter((item) => item.status === 'covered').length,
    items,
    gaps,
    recommendations: buildRecommendations(items, gaps),
    generatedAt: Date.now(),
  }
}

function dedicated(
  key: string,
  requiredName: string,
  priority: BackendServicePriority,
  files: RequiredBackendService['files'],
  apiEvidence: string[],
): RequiredBackendService {
  return {
    key,
    requiredName,
    implementationKind: 'dedicated',
    priority,
    files,
    apiEvidence,
  }
}

function composite(
  key: string,
  requiredName: string,
  files: RequiredBackendService['files'],
  apiEvidence: string[],
): RequiredBackendService {
  return {
    key,
    requiredName,
    implementationKind: 'composite',
    priority: 'standard',
    files,
    apiEvidence,
  }
}

function serviceFile(
  filePath: string,
  role: string,
  expectedExports: string[],
): RequiredBackendService['files'][number] {
  return { path: filePath, role, expectedExports }
}

async function evaluateService(required: RequiredBackendService): Promise<BackendServiceCoverageItem> {
  const files = await Promise.all(required.files.map(evaluateServiceFile))
  const gaps = files.flatMap((file) => [
    ...(file.exists ? [] : [`Source file ${file.path} is missing.`]),
    ...file.missingExports.map((name) => `${file.path} is missing export ${name}.`),
  ])
  const status = gaps.length === 0
    ? 'covered'
    : files.some((file) => file.exists && file.foundExports.length > 0)
      ? 'weak'
      : 'missing'
  return {
    key: required.key,
    requiredName: required.requiredName,
    implementationKind: required.implementationKind,
    priority: required.priority ?? 'standard',
    files,
    apiEvidence: required.apiEvidence,
    status,
    evidence: buildEvidence(required, files),
    gaps,
  }
}

async function evaluateServiceFile(
  file: RequiredBackendService['files'][number],
): Promise<BackendServiceFileCoverage> {
  const content = await readSource(file.path)
  const foundExports = file.expectedExports.filter((name) => content && hasExport(content, name))
  return {
    path: file.path,
    role: file.role,
    exists: content !== null,
    expectedExports: file.expectedExports,
    foundExports,
    missingExports: file.expectedExports.filter((name) => !foundExports.includes(name)),
  }
}

function buildEvidence(
  required: RequiredBackendService,
  files: BackendServiceFileCoverage[],
): string[] {
  return [
    `${required.requiredName} is implemented as a ${required.implementationKind} backend service.`,
    ...files.map((file) =>
      `${file.path}: ${file.exists ? 'exists' : 'missing'}; exports ${file.foundExports.length}/${file.expectedExports.length} expected symbol(s).`,
    ),
    `API evidence: ${required.apiEvidence.join(', ')}.`,
  ]
}

function buildRecommendations(items: BackendServiceCoverageItem[], gaps: string[]): string[] {
  if (gaps.length === 0) {
    return [
      'Section 19 backend service coverage is ready across required dedicated and composite service modules.',
      'Keep service coverage explicit when adding future runtime, tool, memory, workflow, or approval service responsibilities.',
    ]
  }
  return [
    ...items
      .filter((item) => item.status !== 'covered')
      .map((item) => `Add missing exports or files for ${item.key}.`),
    'Re-run backend service coverage after service refactors.',
  ]
}

function hasExport(content: string, name: string): boolean {
  return new RegExp(`export\\s+(async\\s+)?(function|const|class|interface|type)\\s+${escapeRegex(name)}\\b`).test(content)
}

async function readSource(relativePath: string): Promise<string | null> {
  try {
    return await readFile(path.resolve(process.cwd(), relativePath), 'utf8')
  } catch {
    return null
  }
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
