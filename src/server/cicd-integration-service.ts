import { desc, eq } from 'drizzle-orm'

import { db, schema } from '@/db/client'
import type {
  CicdAgentConclusion,
  CicdIntegrationRow,
  CicdMode,
  CicdPlatform,
  CicdRunRow,
  JsonObject,
} from '@/db/schema'
import { newCicdIntegrationId, newCicdRunId } from '@/server/ids'
import { startEmployeeRun } from '@/server/employee-runtime-service'

const DEFAULT_EXIT_CODE_MAPPING: Record<string, number> = {
  passed: 0,
  security_issue_found: 1,
  style_issues_only: 0,
  agent_failed: 2,
}

export async function createCicdIntegration(args: {
  name: string
  platform: CicdPlatform
  mode: CicdMode
  agentProfileId?: string | null
  agentName: string
  task: string
  maxBudgetDollars?: number
  failOn?: CicdAgentConclusion
  outputArtifacts?: boolean
  postAsPrComment?: boolean
  autoFix?: boolean
  exitCodeMapping?: Record<string, number>
}): Promise<CicdIntegrationRow> {
  const mapping = { ...DEFAULT_EXIT_CODE_MAPPING, ...(args.exitCodeMapping ?? {}) }
  const row: CicdIntegrationRow = {
    id: newCicdIntegrationId(),
    name: args.name.trim(),
    platform: args.platform,
    mode: args.mode,
    agentProfileId: normalizeOptional(args.agentProfileId),
    agentName: args.agentName.trim(),
    task: args.task.trim(),
    maxBudgetDollars: args.maxBudgetDollars ?? 0.5,
    failOn: args.failOn ?? 'security_issue_found',
    outputArtifacts: args.outputArtifacts ?? true,
    postAsPrComment: args.postAsPrComment ?? true,
    autoFix: args.autoFix ?? false,
    exitCodeMapping: mapping,
    workflowTemplate: buildWorkflowTemplate({
      platform: args.platform,
      mode: args.mode,
      agentName: args.agentName.trim(),
      task: args.task.trim(),
      maxBudgetDollars: args.maxBudgetDollars ?? 0.5,
      failOn: args.failOn ?? 'security_issue_found',
    }),
    status: 'active',
    createdAt: Date.now(),
    updatedAt: Date.now(),
  }
  if (!row.name || !row.agentName || !row.task) throw new Error('CI/CD integration requires name, agentName, and task.')
  if (row.agentProfileId) {
    const agent = await db.query.agentProfiles.findFirst({ where: eq(schema.agentProfiles.id, row.agentProfileId) })
    if (!agent) throw new Error(`Agent profile not found: ${row.agentProfileId}`)
  }
  await db.insert(schema.cicdIntegrations).values(row)
  return row
}

export async function listCicdIntegrations(platform?: CicdPlatform): Promise<CicdIntegrationRow[]> {
  return db.query.cicdIntegrations.findMany({
    where: platform ? eq(schema.cicdIntegrations.platform, platform) : undefined,
    orderBy: [desc(schema.cicdIntegrations.updatedAt)],
    limit: 200,
  })
}

export async function triggerCicdRun(args: {
  integrationId: string
  triggerType?: CicdMode
  refName?: string
  commitSha?: string
  pullRequestNumber?: number | null
  agentConclusion?: CicdAgentConclusion
}): Promise<CicdRunRow> {
  const integration = await getRequiredIntegration(args.integrationId)
  if (integration.status !== 'active') throw new Error(`CI/CD integration is ${integration.status}`)
  const conclusion = args.agentConclusion ?? 'passed'
  const employeeRun = integration.agentProfileId
    ? await startEmployeeRun({
        agentProfileId: integration.agentProfileId,
        goal: integration.task,
        input: {
          source: 'cicd',
          platform: integration.platform,
          mode: args.triggerType ?? integration.mode,
          refName: args.refName ?? '',
          commitSha: args.commitSha ?? '',
          pullRequestNumber: args.pullRequestNumber ?? null,
        },
        budgetLimitCents: Math.round(integration.maxBudgetDollars * 100),
      })
    : null
  const exitCode = resolveExitCode(integration.exitCodeMapping, conclusion)
  const row: CicdRunRow = {
    id: newCicdRunId(),
    integrationId: integration.id,
    triggerType: args.triggerType ?? integration.mode,
    refName: args.refName?.trim() ?? '',
    commitSha: args.commitSha?.trim() ?? '',
    pullRequestNumber: args.pullRequestNumber ?? null,
    employeeRunId: employeeRun?.id ?? null,
    status: conclusion === 'agent_failed' ? 'failed' : 'completed',
    agentConclusion: conclusion,
    exitCode,
    artifactManifest: buildArtifactManifest(integration, employeeRun?.id ?? null),
    prComment: integration.postAsPrComment
      ? buildPrComment(integration, conclusion, exitCode, args.pullRequestNumber ?? null)
      : {},
    autoFixPlan: integration.autoFix
      ? buildAutoFixPlan(integration, conclusion, args.refName ?? '')
      : {},
    createdAt: Date.now(),
    finishedAt: Date.now(),
  }
  await db.insert(schema.cicdRuns).values(row)
  return row
}

export async function listCicdRuns(integrationId?: string): Promise<CicdRunRow[]> {
  return db.query.cicdRuns.findMany({
    where: integrationId ? eq(schema.cicdRuns.integrationId, integrationId) : undefined,
    orderBy: [desc(schema.cicdRuns.createdAt)],
    limit: 200,
  })
}

async function getRequiredIntegration(id: string): Promise<CicdIntegrationRow> {
  const row = await db.query.cicdIntegrations.findFirst({ where: eq(schema.cicdIntegrations.id, id) })
  if (!row) throw new Error(`CI/CD integration not found: ${id}`)
  return row
}

function buildWorkflowTemplate(args: {
  platform: CicdPlatform
  mode: CicdMode
  agentName: string
  task: string
  maxBudgetDollars: number
  failOn: CicdAgentConclusion
}): string {
  if (args.platform === 'github_actions') {
    if (args.mode === 'action') {
      return [
        'name: AI Agent Code Review',
        'on: [pull_request]',
        'jobs:',
        '  agent-review:',
        '    runs-on: ubuntu-latest',
        '    steps:',
        '      - uses: actions/checkout@v4',
        '      - name: Run Reasonix Agent',
        '        uses: reasonix/agent-action@v1',
        '        with:',
        `          agent-name: '${args.agentName}'`,
        `          task: '${args.task}'`,
        `          max-budget: ${args.maxBudgetDollars}`,
        `          fail-on: '${args.failOn}'`,
        '      - name: Upload Review',
        '        uses: actions/upload-artifact@v4',
        '        with:',
        '          name: agent-review',
        '          path: agent-output/',
      ].join('\n')
    }
    if (args.mode === 'cli') {
      return `reasonix task create --agent "${args.agentName}" --description "${args.task}" --max-budget ${args.maxBudgetDollars}`
    }
    if (args.mode === 'api') return 'POST /api/sdk/tasks'
    return 'POST /api/webhooks/ci-trigger'
  }
  return `${args.platform}:${args.mode}:${args.agentName}:${args.task}`
}

function resolveExitCode(mapping: Record<string, number>, conclusion: CicdAgentConclusion): number {
  return Number.isInteger(mapping[conclusion]) ? mapping[conclusion] : DEFAULT_EXIT_CODE_MAPPING[conclusion]
}

function buildArtifactManifest(integration: CicdIntegrationRow, employeeRunId: string | null): JsonObject {
  if (!integration.outputArtifacts) return {}
  return {
    enabled: true,
    path: 'agent-output/',
    uploadName: 'agent-review',
    employeeRunId,
    files: [
      'agent-output/review.md',
      'agent-output/findings.json',
      'agent-output/artifacts.json',
    ],
  }
}

function buildPrComment(
  integration: CicdIntegrationRow,
  conclusion: CicdAgentConclusion,
  exitCode: number,
  pullRequestNumber: number | null,
): JsonObject {
  return {
    planned: true,
    pullRequestNumber,
    title: `${integration.agentName} CI review`,
    body: `Agent conclusion: ${conclusion}. CI exit code: ${exitCode}.`,
  }
}

function buildAutoFixPlan(
  integration: CicdIntegrationRow,
  conclusion: CicdAgentConclusion,
  refName: string,
): JsonObject {
  return {
    planned: conclusion !== 'passed',
    branch: refName || 'agent/autofix',
    commitMessage: `${integration.agentName}: automated CI fix`,
    requiresWritePermission: true,
  }
}

function normalizeOptional(value: string | null | undefined): string | null {
  const trimmed = value?.trim()
  return trimmed ? trimmed : null
}
