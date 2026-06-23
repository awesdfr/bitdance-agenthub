import { readFile } from 'node:fs/promises'
import path from 'node:path'

export type ApiDesignEndpointStatus = 'implemented' | 'compatible' | 'missing'

export interface ApiRouteFileCheck {
  path: string
  method: string
  exists: boolean
  exportsMethod: boolean
}

export interface ApiDesignAlternativeEndpoint {
  method: string
  path: string
  routeFile: string
  rationale: string
}

export interface ApiDesignCoverageItem {
  id: string
  category: string
  description: string
  method: string
  path: string
  routeFile: string
  exactRoute: ApiRouteFileCheck
  alternativeRoute?: ApiRouteFileCheck & {
    apiPath: string
    rationale: string
  }
  status: ApiDesignEndpointStatus
  evidence: string[]
  gaps: string[]
  warnings: string[]
}

export interface ApiDesignCoverageCategorySummary {
  requiredEndpoints: number
  coveredEndpoints: number
  exactEndpoints: number
  compatibleEndpoints: number
  missingEndpoints: number
}

export interface ApiDesignCoverageReport {
  readiness: 'ready' | 'needs_attention'
  requiredEndpoints: number
  coveredEndpoints: number
  exactEndpoints: number
  compatibleEndpoints: number
  missingEndpoints: number
  categories: Record<string, ApiDesignCoverageCategorySummary>
  items: ApiDesignCoverageItem[]
  gaps: string[]
  warnings: string[]
  recommendations: string[]
  generatedAt: number
}

interface RequiredApiEndpoint {
  id: string
  category: string
  description: string
  method: string
  path: string
  routeFile: string
  alternative?: ApiDesignAlternativeEndpoint
}

const SECTION_20_ENDPOINTS: RequiredApiEndpoint[] = [
  endpoint('model_profiles_list', 'model_control', 'List model profiles', 'GET', '/api/model-profiles', 'src/app/api/model-profiles/route.ts'),
  endpoint('model_profiles_create', 'model_control', 'Create model profile', 'POST', '/api/model-profiles', 'src/app/api/model-profiles/route.ts'),
  endpoint('model_profiles_test', 'model_control', 'Test model profile connection', 'POST', '/api/model-profiles/:id/test', 'src/app/api/model-profiles/[id]/test/route.ts'),

  endpoint('network_profiles_list', 'network_control', 'List network profiles', 'GET', '/api/network-profiles', 'src/app/api/network-profiles/route.ts'),
  endpoint('network_profiles_create', 'network_control', 'Create network profile', 'POST', '/api/network-profiles', 'src/app/api/network-profiles/route.ts'),
  endpoint('network_profiles_test', 'network_control', 'Test network profile', 'POST', '/api/network-profiles/:id/test', 'src/app/api/network-profiles/[id]/test/route.ts'),
  endpoint('network_profiles_egress_live_test', 'network_control', 'Live egress IP test', 'POST', '/api/network-profiles/:id/egress-live-test', 'src/app/api/network-profiles/[id]/egress-live-test/route.ts'),

  endpoint('agent_profiles_list', 'agent_factory', 'List Agent profiles', 'GET', '/api/agent-profiles', 'src/app/api/agent-profiles/route.ts'),
  endpoint('agent_profiles_create', 'agent_factory', 'Create Agent profile', 'POST', '/api/agent-profiles', 'src/app/api/agent-profiles/route.ts'),
  endpoint('agent_profiles_patch', 'agent_factory', 'Patch Agent profile', 'PATCH', '/api/agent-profiles/:id', 'src/app/api/agent-profiles/[id]/route.ts'),
  endpoint('agent_profiles_test', 'agent_factory', 'Test Agent profile', 'POST', '/api/agent-profiles/:id/test', 'src/app/api/agent-profiles/[id]/test/route.ts'),

  endpoint('skills_list', 'skills', 'List local Skills and SkillsMap settings', 'GET', '/api/skills', 'src/app/api/skills/route.ts'),
  endpoint('skills_install', 'skills', 'Install Skill', 'POST', '/api/skills/install', 'src/app/api/skills/install/route.ts'),
  endpoint('skills_enable', 'skills', 'Enable Skill', 'POST', '/api/skills/:id/enable', 'src/app/api/skills/[id]/enable/route.ts'),

  endpoint('tool_connections_list', 'tool_connections', 'List tool connections', 'GET', '/api/tool-connections', 'src/app/api/tool-connections/route.ts'),
  endpoint('tool_connections_create', 'tool_connections', 'Create tool connection', 'POST', '/api/tool-connections', 'src/app/api/tool-connections/route.ts'),
  endpoint('tool_connections_test', 'tool_connections', 'Test tool connection', 'POST', '/api/tool-connections/:id/test', 'src/app/api/tool-connections/[id]/test/route.ts'),

  endpoint('cli_profiles_list', 'cli_profiles', 'List CLI profiles', 'GET', '/api/cli-profiles', 'src/app/api/cli-profiles/route.ts'),
  endpoint('cli_profiles_create', 'cli_profiles', 'Create CLI profile', 'POST', '/api/cli-profiles', 'src/app/api/cli-profiles/route.ts'),
  endpoint('cli_profiles_test', 'cli_profiles', 'Test CLI profile', 'POST', '/api/cli-profiles/:id/test', 'src/app/api/cli-profiles/[id]/test/route.ts'),

  endpoint('software_profiles_list', 'software_profiles', 'List software profiles', 'GET', '/api/software-profiles', 'src/app/api/software-profiles/route.ts'),
  endpoint('software_profiles_create', 'software_profiles', 'Create software profile', 'POST', '/api/software-profiles', 'src/app/api/software-profiles/route.ts'),
  endpoint('software_profiles_record_command', 'software_profiles', 'Record software command', 'POST', '/api/software-profiles/:id/record-command', 'src/app/api/software-profiles/[id]/record-command/route.ts'),
  endpoint('software_commands_test', 'software_profiles', 'Test software command', 'POST', '/api/software-commands/:id/test', 'src/app/api/software-commands/[id]/test/route.ts'),

  endpoint('workflows_list', 'workflows', 'List workflows', 'GET', '/api/workflows', 'src/app/api/workflows/route.ts'),
  endpoint('workflows_create', 'workflows', 'Create workflow', 'POST', '/api/workflows', 'src/app/api/workflows/route.ts'),
  endpoint('workflows_run', 'workflows', 'Run workflow', 'POST', '/api/workflows/:id/run', 'src/app/api/workflows/[id]/run/route.ts'),

  endpoint('workflow_runs_get', 'workflow_runs', 'Get workflow run snapshot', 'GET', '/api/workflow-runs/:id', 'src/app/api/workflow-runs/[id]/route.ts'),
  endpoint('workflow_runs_events', 'workflow_runs', 'Get workflow run events', 'GET', '/api/workflow-runs/:id/events', 'src/app/api/workflow-runs/[id]/events/route.ts'),
  endpoint(
    'workflow_runs_pause',
    'workflow_runs',
    'Pause a running workflow employee task',
    'POST',
    '/api/workflow-runs/:id/pause',
    'src/app/api/workflow-runs/[id]/pause/route.ts',
    {
      method: 'POST',
      path: '/api/employee-runs/:id/pause',
      routeFile: 'src/app/api/employee-runs/[id]/pause/route.ts',
      rationale: 'v1 pauses the employee run that performs the workflow node; a direct workflow-run wrapper can be added later.',
    },
  ),
  endpoint(
    'workflow_runs_resume',
    'workflow_runs',
    'Resume a paused workflow employee task',
    'POST',
    '/api/workflow-runs/:id/resume',
    'src/app/api/workflow-runs/[id]/resume/route.ts',
    {
      method: 'POST',
      path: '/api/employee-runs/:id/resume',
      routeFile: 'src/app/api/employee-runs/[id]/resume/route.ts',
      rationale: 'v1 resumes the employee run that performs the workflow node; a direct workflow-run wrapper can be added later.',
    },
  ),
  endpoint(
    'workflow_runs_cancel',
    'workflow_runs',
    'Cancel a running workflow employee task',
    'POST',
    '/api/workflow-runs/:id/cancel',
    'src/app/api/workflow-runs/[id]/cancel/route.ts',
    {
      method: 'POST',
      path: '/api/employee-runs/:id/cancel',
      routeFile: 'src/app/api/employee-runs/[id]/cancel/route.ts',
      rationale: 'v1 cancels the employee run that performs the workflow node; a direct workflow-run wrapper can be added later.',
    },
  ),

  endpoint('agent_runs_memory', 'agent_runs', 'List Agent run memory', 'GET', '/api/agent-runs/:id/memory', 'src/app/api/agent-runs/[id]/memory/route.ts'),
  endpoint('agent_runs_reflection', 'agent_runs', 'Get Agent run reflection', 'GET', '/api/agent-runs/:id/reflection', 'src/app/api/agent-runs/[id]/reflection/route.ts'),

  endpoint('approvals_approve', 'approvals', 'Approve approval request', 'POST', '/api/approvals/:id/approve', 'src/app/api/approvals/[id]/approve/route.ts'),
  endpoint('approvals_reject', 'approvals', 'Reject approval request', 'POST', '/api/approvals/:id/reject', 'src/app/api/approvals/[id]/reject/route.ts'),
]

export async function getApiDesignCoverageReport(): Promise<ApiDesignCoverageReport> {
  const items = await Promise.all(SECTION_20_ENDPOINTS.map(evaluateEndpoint))
  const exactEndpoints = items.filter((item) => item.status === 'implemented').length
  const compatibleEndpoints = items.filter((item) => item.status === 'compatible').length
  const missingEndpoints = items.filter((item) => item.status === 'missing').length
  const gaps = items.flatMap((item) => item.gaps.map((gap) => `${item.path}: ${gap}`))
  const warnings = items.flatMap((item) => item.warnings.map((warning) => `${item.path}: ${warning}`))
  return {
    readiness: missingEndpoints === 0 ? 'ready' : 'needs_attention',
    requiredEndpoints: items.length,
    coveredEndpoints: exactEndpoints + compatibleEndpoints,
    exactEndpoints,
    compatibleEndpoints,
    missingEndpoints,
    categories: summarizeCategories(items),
    items,
    gaps,
    warnings,
    recommendations: buildRecommendations(missingEndpoints, compatibleEndpoints),
    generatedAt: Date.now(),
  }
}

function endpoint(
  id: string,
  category: string,
  description: string,
  method: string,
  apiPath: string,
  routeFile: string,
  alternative?: ApiDesignAlternativeEndpoint,
): RequiredApiEndpoint {
  return { id, category, description, method, path: apiPath, routeFile, alternative }
}

async function evaluateEndpoint(required: RequiredApiEndpoint): Promise<ApiDesignCoverageItem> {
  const exactRoute = await inspectRoute(required.routeFile, required.method)
  const exactImplemented = exactRoute.exists && exactRoute.exportsMethod
  const alternativeRoute = required.alternative
    ? await inspectAlternativeRoute(required.alternative)
    : undefined
  const compatibleImplemented = Boolean(
    alternativeRoute?.exists && alternativeRoute.exportsMethod,
  )
  const status: ApiDesignEndpointStatus = exactImplemented
    ? 'implemented'
    : compatibleImplemented
      ? 'compatible'
      : 'missing'
  const gaps = status === 'missing'
    ? [
      exactRoute.exists
        ? `${required.routeFile} exists but does not export ${required.method}.`
        : `${required.routeFile} is missing.`,
    ]
    : []
  const warnings = status === 'compatible' && alternativeRoute
    ? [`Canonical route is not present; compatible v1 route ${alternativeRoute.apiPath} is used. ${alternativeRoute.rationale}`]
    : []
  return {
    id: required.id,
    category: required.category,
    description: required.description,
    method: required.method,
    path: required.path,
    routeFile: required.routeFile,
    exactRoute,
    alternativeRoute,
    status,
    evidence: buildEvidence(required, exactRoute, alternativeRoute, status),
    gaps,
    warnings,
  }
}

async function inspectAlternativeRoute(
  alternative: ApiDesignAlternativeEndpoint,
): Promise<ApiDesignCoverageItem['alternativeRoute']> {
  const route = await inspectRoute(alternative.routeFile, alternative.method)
  return {
    ...route,
    apiPath: alternative.path,
    rationale: alternative.rationale,
  }
}

async function inspectRoute(routeFile: string, method: string): Promise<ApiRouteFileCheck> {
  const content = await readSource(routeFile)
  return {
    path: routeFile,
    method,
    exists: content !== null,
    exportsMethod: content ? hasRouteMethod(content, method) : false,
  }
}

function summarizeCategories(
  items: ApiDesignCoverageItem[],
): Record<string, ApiDesignCoverageCategorySummary> {
  return items.reduce<Record<string, ApiDesignCoverageCategorySummary>>((acc, item) => {
    const summary = acc[item.category] ?? {
      requiredEndpoints: 0,
      coveredEndpoints: 0,
      exactEndpoints: 0,
      compatibleEndpoints: 0,
      missingEndpoints: 0,
    }
    summary.requiredEndpoints += 1
    if (item.status !== 'missing') summary.coveredEndpoints += 1
    if (item.status === 'implemented') summary.exactEndpoints += 1
    if (item.status === 'compatible') summary.compatibleEndpoints += 1
    if (item.status === 'missing') summary.missingEndpoints += 1
    acc[item.category] = summary
    return acc
  }, {})
}

function buildEvidence(
  required: RequiredApiEndpoint,
  exactRoute: ApiRouteFileCheck,
  alternativeRoute: ApiDesignCoverageItem['alternativeRoute'],
  status: ApiDesignEndpointStatus,
): string[] {
  const evidence = [
    `${required.method} ${required.path} is ${status}.`,
    `${required.routeFile}: ${exactRoute.exists ? 'exists' : 'missing'}; ${required.method} export ${exactRoute.exportsMethod ? 'found' : 'missing'}.`,
  ]
  if (alternativeRoute) {
    evidence.push(
      `Alternative ${alternativeRoute.method} ${alternativeRoute.apiPath} maps to ${alternativeRoute.path}; method export ${alternativeRoute.exportsMethod ? 'found' : 'missing'}.`,
    )
  }
  return evidence
}

function buildRecommendations(missingEndpoints: number, compatibleEndpoints: number): string[] {
  if (missingEndpoints === 0) {
    return [
      'Section 20 API design coverage is ready for the documented v1 control-plane endpoints.',
      compatibleEndpoints > 0
        ? 'Consider adding direct workflow-run pause/resume/cancel wrapper routes if the product needs workflow-level controls instead of employee-run controls.'
        : 'Keep route coverage explicit when adding new control-plane APIs.',
    ]
  }
  return [
    'Add missing route files or method exports for Section 20 endpoints.',
    'Re-run the API design coverage report after route changes.',
  ]
}

function hasRouteMethod(content: string, method: string): boolean {
  return new RegExp(`export\\s+(async\\s+)?function\\s+${method}\\b`).test(content)
}

async function readSource(relativePath: string): Promise<string | null> {
  try {
    return await readFile(path.resolve(process.cwd(), relativePath), 'utf8')
  } catch {
    return null
  }
}
