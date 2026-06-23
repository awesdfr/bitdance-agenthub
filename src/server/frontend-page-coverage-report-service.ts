import { readFile } from 'node:fs/promises'
import path from 'node:path'

export type FrontendPageCoverageStatus = 'covered' | 'partial' | 'missing'
export type FrontendPageSurfaceKind = 'dedicated' | 'composite'

export interface FrontendPageComponentCoverage {
  path: string
  role: string
  exists: boolean
  expectedMarkers: string[]
  foundMarkers: string[]
  missingMarkers: string[]
}

export interface FrontendPageSidebarCoverage {
  mode: string
  label: string
  componentName: string
  expectedMarkers: string[]
  foundMarkers: string[]
  missingMarkers: string[]
}

export interface FrontendPageCoverageItem {
  key: string
  title: string
  surfaceKind: FrontendPageSurfaceKind
  sidebar: FrontendPageSidebarCoverage
  components: FrontendPageComponentCoverage[]
  status: FrontendPageCoverageStatus
  evidence: string[]
  gaps: string[]
  warnings: string[]
}

export interface FrontendPageCoverageReport {
  readiness: 'ready' | 'needs_attention'
  requiredPages: number
  coveredPages: number
  partialPages: number
  missingPages: number
  dedicatedPages: number
  compositePages: number
  items: FrontendPageCoverageItem[]
  gaps: string[]
  warnings: string[]
  recommendations: string[]
  generatedAt: number
}

interface RequiredFrontendPage {
  key: string
  title: string
  surfaceKind: FrontendPageSurfaceKind
  sidebar: {
    mode: string
    label: string
    componentName: string
  }
  components: Array<{
    path: string
    role: string
    expectedMarkers: string[]
  }>
}

const SIDEBAR_PATH = 'src/components/sidebar.tsx'
const APP_SHELL_PATH = 'src/components/app-shell.tsx'

const REQUIRED_FRONTEND_PAGES: RequiredFrontendPage[] = [
  page('agent_factory', 'Agent factory', 'dedicated', {
    mode: 'employee-factory',
    label: '智能体工厂',
    componentName: 'EmployeeAgentFactory',
  }, [
    component('src/components/employee-agent-factory.tsx', 'Agent creation, capability selection, run monitor, and output contract controls', [
      'export function EmployeeAgentFactory',
      'createAgentProfile',
      'modelProfileId',
      'skillsText',
      'selectedCliIds',
      'selectedMcpIds',
      'selectedSoftwareIds',
      'workstationMode',
      'outputArtifactType',
      'RunMonitor',
    ]),
  ]),
  page('model_management', 'Model management', 'dedicated', {
    mode: 'models',
    label: '模型管理',
    componentName: 'ModelControlCenter',
  }, [
    component('src/components/model-control-center.tsx', 'Model profile, network outlet, connection test, and route preview UI', [
      'export function ModelControlCenter',
      'createModelProfile',
      'createNetworkProfile',
      'testModelConnection',
      'testModelProfile',
      'testNetworkProfile',
      'previewModelRoute',
      '连接与推理测试',
      '路由预览',
    ]),
  ]),
  page('tool_connections', 'Tool connections', 'dedicated', {
    mode: 'tools',
    label: '工具连接',
    componentName: 'ToolControlCenter',
  }, [
    component('src/components/tool-control-center.tsx', 'MCP, CLI, Tool Connection, SDK, Webhook, and tool run-history UI', [
      'export function ToolControlCenter',
      'createToolConnection',
      'createCliProfile',
      'createMcpServer',
      'testToolConnection',
      'testCliProfile',
      'testMcpServer',
      'runCliProfile',
      'runMcpTool',
    ]),
  ]),
  page('software_cli_ization', 'Software CLI-ization', 'composite', {
    mode: 'tools',
    label: '工具连接',
    componentName: 'ToolControlCenter',
  }, [
    component('src/components/tool-control-center.tsx', 'Software Profile, Software Command, and macro-to-command UI inside Tool Control', [
      'createSoftwareProfile',
      'createSoftwareCommand',
      'createRecordedMacro',
      'replayRecordedMacro',
      'Software Profiles',
      'Software Commands',
      'Recorded Macros',
      'Macro replays',
    ]),
  ]),
  page('skills_center', 'Skills center', 'dedicated', {
    mode: 'skills',
    label: '技能中心',
    componentName: 'SkillsCenter',
  }, [
    component('src/components/skills-center.tsx', 'Installed Skills, install flow, Skills marketplace iframe, SDK, and publication UI', [
      'export function SkillsCenter',
      'fetchSkillsCenterData',
      'installSkill',
      'setSkillEnabled',
      'marketplaceUrl',
      '<iframe',
      '安装记录',
      'SDK 清单',
    ]),
  ]),
  page('agent_canvas', 'Agent canvas', 'dedicated', {
    mode: 'agent-canvas',
    label: '编排画布',
    componentName: 'AgentWorkflowCanvas',
  }, [
    component('src/components/agent-workflow-canvas.tsx', 'Canvas workflow authoring, workflow execution, status, preflight, and approval UI', [
      'export function AgentWorkflowCanvas',
      'createWorkflow',
      'startWorkflowRun',
      'fetchWorkflowRunSnapshot',
      'runWorkflowPreflight',
      'NodeRunList',
      'ComputerSessionList',
      'ArtifactValidationList',
      'ApprovalRequestList',
    ]),
  ]),
  page('run_monitoring', 'Run monitoring', 'composite', {
    mode: 'monitor',
    label: '运行监控',
    componentName: 'ObservabilityCenter',
  }, [
    component('src/components/employee-agent-factory.tsx', 'Per-Agent employee run monitor with controls, events, CLI, computer, artifacts, memory, and learning', [
      'RunMonitor',
      'pauseEmployeeRun',
      'resumeEmployeeRun',
      'cancelEmployeeRun',
      'CliRunList',
      'ComputerSessionList',
      'ArtifactValidationList',
      'LearningReflection',
      'MemoryWriteList',
    ]),
    component('src/components/agent-workflow-canvas.tsx', 'Workflow run monitor with node runs, employee runs, software runs, locks, and approvals', [
      'RunStatusList',
      'NodeRunList',
      'EmployeeRunList',
      'SoftwareCommandRunList',
      'ResourceLockList',
      'ApprovalRequestList',
    ]),
    component('src/components/observability-center.tsx', 'System monitor with metrics, debug replay, debug package, Agent health, and run selection', [
      'export function ObservabilityCenter',
      'fetchEmployeeRuns',
      'createEmployeeRunDebugReplay',
      'employeeRunDebugPackageUrl',
      'Metric Timeline',
      'Agent Health',
    ]),
  ]),
  page('memory_learning', 'Memory and learning', 'dedicated', {
    mode: 'memory',
    label: '记忆学习',
    componentName: 'MemoryLearningCenter',
  }, [
    component('src/components/memory-learning-center.tsx', 'Memory authoring, privacy controls, learning review, playbooks, and knowledge transfer UI', [
      'export function MemoryLearningCenter',
      'createMemoryItem',
      'approveLearningEvent',
      'rejectLearningEvent',
      'Save Memory',
      'Learning Review',
      'playbooks',
      'Promote team memory',
      'memoryPrivacySummary',
    ]),
  ]),
]

export async function getFrontendPageCoverageReport(): Promise<FrontendPageCoverageReport> {
  const sidebarContent = await readSource(SIDEBAR_PATH)
  const appShellContent = await readSource(APP_SHELL_PATH)
  const items = await Promise.all(
    REQUIRED_FRONTEND_PAGES.map((required) => evaluatePage(required, sidebarContent, appShellContent)),
  )
  const gaps = items.flatMap((item) => item.gaps.map((gap) => `${item.key}: ${gap}`))
  const warnings = items.flatMap((item) => item.warnings.map((warning) => `${item.key}: ${warning}`))
  return {
    readiness: gaps.length === 0 ? 'ready' : 'needs_attention',
    requiredPages: items.length,
    coveredPages: items.filter((item) => item.status === 'covered').length,
    partialPages: items.filter((item) => item.status === 'partial').length,
    missingPages: items.filter((item) => item.status === 'missing').length,
    dedicatedPages: items.filter((item) => item.surfaceKind === 'dedicated').length,
    compositePages: items.filter((item) => item.surfaceKind === 'composite').length,
    items,
    gaps,
    warnings,
    recommendations: buildRecommendations(gaps),
    generatedAt: Date.now(),
  }
}

function page(
  key: string,
  title: string,
  surfaceKind: FrontendPageSurfaceKind,
  sidebar: RequiredFrontendPage['sidebar'],
  components: RequiredFrontendPage['components'],
): RequiredFrontendPage {
  return { key, title, surfaceKind, sidebar, components }
}

function component(
  filePath: string,
  role: string,
  expectedMarkers: string[],
): RequiredFrontendPage['components'][number] {
  return { path: filePath, role, expectedMarkers }
}

async function evaluatePage(
  required: RequiredFrontendPage,
  sidebarContent: string | null,
  appShellContent: string | null,
): Promise<FrontendPageCoverageItem> {
  const sidebar = evaluateSidebar(required, sidebarContent, appShellContent)
  const components = await Promise.all(required.components.map(evaluateComponent))
  const gaps = [
    ...sidebar.missingMarkers,
    ...components.flatMap((coverage) => [
      ...(coverage.exists ? [] : [`${coverage.path} is missing.`]),
      ...coverage.missingMarkers.map((marker) => `${coverage.path} is missing marker ${marker}.`),
    ]),
  ]
  const hasAnyEvidence = sidebar.foundMarkers.length > 0 ||
    components.some((coverage) => coverage.exists && coverage.foundMarkers.length > 0)
  const status: FrontendPageCoverageStatus = gaps.length === 0
    ? 'covered'
    : hasAnyEvidence
      ? 'partial'
      : 'missing'
  return {
    key: required.key,
    title: required.title,
    surfaceKind: required.surfaceKind,
    sidebar,
    components,
    status,
    evidence: buildEvidence(required, sidebar, components),
    gaps,
    warnings: required.surfaceKind === 'composite'
      ? [`${required.title} is implemented as a composite surface rather than a standalone page.`]
      : [],
  }
}

function evaluateSidebar(
  required: RequiredFrontendPage,
  sidebarContent: string | null,
  appShellContent: string | null,
): FrontendPageSidebarCoverage {
  const checks = [
    {
      marker: `mode: '${required.sidebar.mode}'`,
      content: sidebarContent,
      missing: `${SIDEBAR_PATH} is missing sidebar marker mode: '${required.sidebar.mode}'.`,
    },
    {
      marker: `label: '${required.sidebar.label}'`,
      content: sidebarContent,
      missing: `${SIDEBAR_PATH} is missing sidebar marker label: '${required.sidebar.label}'.`,
    },
    {
      marker: `import { ${required.sidebar.componentName} }`,
      content: appShellContent,
      missing: `${APP_SHELL_PATH} is missing workspace marker import { ${required.sidebar.componentName} }.`,
    },
    {
      marker: `<${required.sidebar.componentName} />`,
      content: appShellContent,
      missing: `${APP_SHELL_PATH} is missing workspace marker <${required.sidebar.componentName} />.`,
    },
  ]
  const foundMarkers = checks
    .filter((check) => check.content?.includes(check.marker))
    .map((check) => check.marker)
  return {
    mode: required.sidebar.mode,
    label: required.sidebar.label,
    componentName: required.sidebar.componentName,
    expectedMarkers: checks.map((check) => check.marker),
    foundMarkers,
    missingMarkers: checks
      .filter((check) => !foundMarkers.includes(check.marker))
      .map((check) => check.missing),
  }
}

async function evaluateComponent(
  componentConfig: RequiredFrontendPage['components'][number],
): Promise<FrontendPageComponentCoverage> {
  const content = await readSource(componentConfig.path)
  const foundMarkers = content
    ? componentConfig.expectedMarkers.filter((marker) => content.includes(marker))
    : []
  return {
    path: componentConfig.path,
    role: componentConfig.role,
    exists: content !== null,
    expectedMarkers: componentConfig.expectedMarkers,
    foundMarkers,
    missingMarkers: componentConfig.expectedMarkers.filter((marker) => !foundMarkers.includes(marker)),
  }
}

function buildEvidence(
  required: RequiredFrontendPage,
  sidebar: FrontendPageSidebarCoverage,
  components: FrontendPageComponentCoverage[],
): string[] {
  return [
    `${required.title} is tracked as a ${required.surfaceKind} frontend surface.`,
    `${SIDEBAR_PATH} + ${APP_SHELL_PATH}: ${sidebar.foundMarkers.length}/${sidebar.expectedMarkers.length} navigation/workspace markers found for ${required.sidebar.componentName}.`,
    ...components.map((coverage) =>
      `${coverage.path}: ${coverage.exists ? 'exists' : 'missing'}; ${coverage.foundMarkers.length}/${coverage.expectedMarkers.length} required UI marker(s) found.`,
    ),
  ]
}

function buildRecommendations(gaps: string[]): string[] {
  if (gaps.length === 0) {
    return [
      'Section 21 frontend page coverage is ready across the required Agent factory, model, tool, software, Skills, Canvas, run-monitoring, and memory/learning surfaces.',
      'Keep composite surfaces explicit when one page intentionally covers multiple plan pages.',
    ]
  }
  return [
    'Add missing sidebar entries, component exports, or UI capability markers for Section 21 pages.',
    'Re-run frontend page coverage after UI surface changes.',
  ]
}

async function readSource(relativePath: string): Promise<string | null> {
  try {
    return await readFile(path.resolve(process.cwd(), relativePath), 'utf8')
  } catch {
    return null
  }
}
