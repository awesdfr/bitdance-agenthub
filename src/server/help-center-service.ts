import { and, asc, eq, type SQL } from 'drizzle-orm'

import { db, schema } from '@/db/client'
import type {
  HelpCenterItemRow,
  HelpCenterItemType,
  HelpCenterSurfaceRow,
  HelpCenterSurfaceStatus,
  HelpOnboardingFlowRow,
  HelpOnboardingFlowStatus,
  JsonObject,
} from '@/db/schema'
import {
  newHelpCenterItemId,
  newHelpCenterSurfaceId,
  newHelpOnboardingFlowId,
} from '@/server/ids'
import { recordAuditLog } from '@/server/security-service'

export interface CreateHelpCenterSurfaceArgs {
  surfaceKey: string
  route: string
  title: string
  description?: string
  documentationPageId?: string | null
  docHref?: string
  questionButtonLabel?: string
  status?: HelpCenterSurfaceStatus
}

export interface CreateHelpCenterItemArgs {
  surfaceId: string
  itemKey: string
  itemType: HelpCenterItemType
  label: string
  body?: string
  selector?: string | null
  docHref?: string
  exampleValue?: JsonObject
  orderIndex?: number
  status?: string
}

export interface CreateHelpOnboardingFlowArgs {
  flowKey: string
  title: string
  description?: string
  startSurfaceKey?: string
  steps: JsonObject[]
  status?: HelpOnboardingFlowStatus
}

interface DefaultHelpSurface {
  surfaceKey: string
  route: string
  title: string
  description: string
  docHref: string
  items: Omit<CreateHelpCenterItemArgs, 'surfaceId'>[]
}

const DEFAULT_HELP_SURFACES: DefaultHelpSurface[] = [
  makeSurface('agent_factory', '/factory', 'Agent Factory', 'Create Agent employees and configure their model, tools, memory, permissions, and output contract.', '/docs/user-guide/agent-factory.md', 'Agent profile name', 'Launch research assistant'),
  makeSurface('model_control', '/models', 'Model Control', 'Configure providers, base URLs, fallback models, and network outlets.', '/docs/user-guide/models.md', 'OpenAI compatible endpoint', 'https://api.openai.com/v1'),
  makeSurface('tool_control', '/tools', 'Tool Control', 'Register CLI, MCP, API, software, macro, SDK, and webhook capabilities.', '/docs/user-guide/tools.md', 'Codex CLI profile', 'codex --approval never'),
  makeSurface('skills_center', '/skills', 'Skills Center', 'Install local Skills, open SkillsMap, and assign Skills to Agents.', '/docs/user-guide/skills.md', 'Skill source URL', 'https://github.com/example/skill-pack'),
  makeSurface('agent_canvas', '/canvas', 'Agent Canvas', 'Compose multiple Agent employees, approvals, conditions, software commands, and artifact contracts.', '/docs/user-guide/canvas.md', 'Workflow name', 'Launch review workflow'),
  makeSurface('memory_center', '/memory', 'Memory Center', 'Review memories, learning events, playbooks, privacy boundaries, and knowledge transfer.', '/docs/user-guide/memory.md', 'Memory title', 'Customer prefers concise launch briefs'),
  makeSurface('governance_center', '/governance', 'Governance Center', 'Review approvals, autonomy, sandboxing, data lifecycle, feature flags, and implementation audit.', '/docs/advanced/safety.md', 'Sandbox policy name', 'Workspace write guard'),
  makeSurface('observability_center', '/observability', 'Observability Center', 'Inspect metrics, alerts, debug packages, Agent reputation, and Meta Agent digests.', '/docs/user-guide/monitoring.md', 'Metric name', 'agenthub.task.duration'),
  makeSurface('config_ops_center', '/config', 'ConfigOps Center', 'Version, restore, export, import-check, and conflict-resolve configuration records.', '/docs/advanced/workflows.md', 'Config entity', 'agent_profile:ap_123'),
  makeSurface('task_scheduler', '/scheduler', 'Task Scheduler', 'Create queues, recurring schedules, due continuation scans, and safe queue ticks.', '/docs/advanced/workflows.md', 'Queue name', 'Daily follow-up queue'),
]

const DEFAULT_ONBOARDING_FLOW: CreateHelpOnboardingFlowArgs = {
  flowKey: 'first_agent_success_path',
  title: 'First Agent Success Path',
  description: 'Create the first Agent, run the first task, and inspect the first artifact.',
  startSurfaceKey: 'agent_factory',
  steps: [
    {
      stepKey: 'create_first_agent',
      surfaceKey: 'agent_factory',
      title: 'Create the first Agent',
      action: 'Fill role, model, skills, permissions, and output contract.',
      docHref: '/docs/getting-started/first-agent.md',
    },
    {
      stepKey: 'run_first_task',
      surfaceKey: 'agent_factory',
      title: 'Run the first task',
      action: 'Submit a low-risk task and watch the employee run timeline.',
      docHref: '/docs/getting-started/quick-start.md',
    },
    {
      stepKey: 'inspect_first_artifact',
      surfaceKey: 'observability_center',
      title: 'Inspect the first artifact',
      action: 'Open the run output, validation result, logs, and next-step notes.',
      docHref: '/docs/user-guide/monitoring.md',
    },
  ],
}

export function getDefaultHelpSurfaceCount(): number {
  return DEFAULT_HELP_SURFACES.length
}

export function getDefaultHelpItemCount(): number {
  return DEFAULT_HELP_SURFACES.reduce((count, surface) => count + surface.items.length, 0)
}

export function getDefaultHelpOnboardingFlowCount(): number {
  return 1
}

export async function seedHelpCenter(): Promise<{
  surfaces: HelpCenterSurfaceRow[]
  items: HelpCenterItemRow[]
  onboardingFlows: HelpOnboardingFlowRow[]
}> {
  const surfaces: HelpCenterSurfaceRow[] = []
  const items: HelpCenterItemRow[] = []
  for (const definition of DEFAULT_HELP_SURFACES) {
    let surface = await db.query.helpCenterSurfaces.findFirst({
      where: eq(schema.helpCenterSurfaces.surfaceKey, definition.surfaceKey),
    })
    if (!surface) {
      surface = await createHelpCenterSurface({
        surfaceKey: definition.surfaceKey,
        route: definition.route,
        title: definition.title,
        description: definition.description,
        docHref: definition.docHref,
      })
    }
    surfaces.push(surface)
    for (const itemDefinition of definition.items) {
      const existingItem = await db.query.helpCenterItems.findFirst({
        where: and(
          eq(schema.helpCenterItems.surfaceId, surface.id),
          eq(schema.helpCenterItems.itemKey, itemDefinition.itemKey),
        ),
      })
      items.push(existingItem ?? await createHelpCenterItem({
        surfaceId: surface.id,
        ...itemDefinition,
      }))
    }
  }
  let flow = await db.query.helpOnboardingFlows.findFirst({
    where: eq(schema.helpOnboardingFlows.flowKey, DEFAULT_ONBOARDING_FLOW.flowKey),
  })
  if (!flow) flow = await createHelpOnboardingFlow(DEFAULT_ONBOARDING_FLOW)
  return {
    surfaces,
    items,
    onboardingFlows: [flow],
  }
}

export async function createHelpCenterSurface(
  args: CreateHelpCenterSurfaceArgs,
): Promise<HelpCenterSurfaceRow> {
  const now = Date.now()
  const row: HelpCenterSurfaceRow = {
    id: newHelpCenterSurfaceId(),
    surfaceKey: normalizeKey(args.surfaceKey, 'surfaceKey'),
    route: normalizeRequired(args.route, 'route'),
    title: normalizeRequired(args.title, 'title'),
    description: args.description?.trim() ?? '',
    documentationPageId: normalizeNullable(args.documentationPageId),
    docHref: args.docHref?.trim() ?? '',
    questionButtonLabel: args.questionButtonLabel?.trim() || '?',
    status: args.status ?? 'active',
    createdAt: now,
    updatedAt: now,
  }
  await db.insert(schema.helpCenterSurfaces).values(row)
  await auditHelp('help_center.surface.create', 'help_center_surface', row.id, {
    surfaceKey: row.surfaceKey,
    route: row.route,
  })
  return row
}

export async function createHelpCenterItem(args: CreateHelpCenterItemArgs): Promise<HelpCenterItemRow> {
  await requireHelpCenterSurface(args.surfaceId)
  const now = Date.now()
  const row: HelpCenterItemRow = {
    id: newHelpCenterItemId(),
    surfaceId: args.surfaceId,
    itemKey: normalizeKey(args.itemKey, 'itemKey'),
    itemType: args.itemType,
    label: normalizeRequired(args.label, 'label'),
    body: args.body?.trim() ?? '',
    selector: normalizeNullable(args.selector),
    docHref: args.docHref?.trim() ?? '',
    exampleValue: args.exampleValue ?? {},
    orderIndex: args.orderIndex ?? 0,
    status: args.status ?? 'active',
    createdAt: now,
    updatedAt: now,
  }
  await db.insert(schema.helpCenterItems).values(row)
  await auditHelp('help_center.item.create', 'help_center_item', row.id, {
    surfaceId: row.surfaceId,
    itemKey: row.itemKey,
    itemType: row.itemType,
  })
  return row
}

export async function createHelpOnboardingFlow(
  args: CreateHelpOnboardingFlowArgs,
): Promise<HelpOnboardingFlowRow> {
  const now = Date.now()
  const row: HelpOnboardingFlowRow = {
    id: newHelpOnboardingFlowId(),
    flowKey: normalizeKey(args.flowKey, 'flowKey'),
    title: normalizeRequired(args.title, 'title'),
    description: args.description?.trim() ?? '',
    startSurfaceKey: normalizeKey(args.startSurfaceKey ?? 'agent_factory', 'startSurfaceKey'),
    steps: args.steps,
    status: args.status ?? 'active',
    createdAt: now,
    updatedAt: now,
  }
  await db.insert(schema.helpOnboardingFlows).values(row)
  await auditHelp('help_center.onboarding_flow.create', 'help_onboarding_flow', row.id, {
    flowKey: row.flowKey,
    stepCount: row.steps.length,
  })
  return row
}

export async function listHelpCenterSurfaces(args: {
  surfaceKey?: string
  status?: HelpCenterSurfaceStatus
  limit?: number
} = {}): Promise<HelpCenterSurfaceRow[]> {
  const filters: SQL[] = []
  if (args.surfaceKey) filters.push(eq(schema.helpCenterSurfaces.surfaceKey, args.surfaceKey))
  if (args.status) filters.push(eq(schema.helpCenterSurfaces.status, args.status))
  return db.query.helpCenterSurfaces.findMany({
    where: filters.length ? and(...filters) : undefined,
    orderBy: [asc(schema.helpCenterSurfaces.surfaceKey)],
    limit: normalizeLimit(args.limit),
  })
}

export async function listHelpCenterItems(args: {
  surfaceId?: string
  surfaceKey?: string
  itemType?: HelpCenterItemType
  query?: string
  limit?: number
} = {}): Promise<HelpCenterItemRow[]> {
  const filters: SQL[] = []
  if (args.surfaceKey) {
    const surfaces = await listHelpCenterSurfaces({ surfaceKey: args.surfaceKey, limit: 1 })
    const surfaceId = surfaces[0]?.id
    if (!surfaceId || (args.surfaceId && args.surfaceId !== surfaceId)) return []
    filters.push(eq(schema.helpCenterItems.surfaceId, surfaceId))
  } else if (args.surfaceId) {
    filters.push(eq(schema.helpCenterItems.surfaceId, args.surfaceId))
  }
  if (args.itemType) filters.push(eq(schema.helpCenterItems.itemType, args.itemType))
  let rows = await db.query.helpCenterItems.findMany({
    where: filters.length ? and(...filters) : undefined,
    orderBy: [asc(schema.helpCenterItems.orderIndex), asc(schema.helpCenterItems.itemKey)],
    limit: normalizeLimit(args.limit),
  })
  const query = args.query?.trim().toLowerCase()
  if (query) {
    rows = rows.filter((row) =>
      [row.itemKey, row.label, row.body, row.docHref].join(' ').toLowerCase().includes(query),
    )
  }
  return rows
}

export async function listHelpOnboardingFlows(args: {
  status?: HelpOnboardingFlowStatus
  flowKey?: string
  limit?: number
} = {}): Promise<HelpOnboardingFlowRow[]> {
  const filters: SQL[] = []
  if (args.status) filters.push(eq(schema.helpOnboardingFlows.status, args.status))
  if (args.flowKey) filters.push(eq(schema.helpOnboardingFlows.flowKey, args.flowKey))
  return db.query.helpOnboardingFlows.findMany({
    where: filters.length ? and(...filters) : undefined,
    orderBy: [asc(schema.helpOnboardingFlows.flowKey)],
    limit: normalizeLimit(args.limit),
  })
}

async function requireHelpCenterSurface(surfaceId: string): Promise<HelpCenterSurfaceRow> {
  const row = await db.query.helpCenterSurfaces.findFirst({
    where: eq(schema.helpCenterSurfaces.id, surfaceId),
  })
  if (!row) throw new Error(`Help center surface not found: ${surfaceId}`)
  return row
}

function makeSurface(
  surfaceKey: string,
  route: string,
  title: string,
  description: string,
  docHref: string,
  exampleLabel: string,
  exampleText: string,
): DefaultHelpSurface {
  return {
    surfaceKey,
    route,
    title,
    description,
    docHref,
    items: [
      {
        itemKey: `${surfaceKey}_question`,
        itemType: 'question_button',
        label: `Open ${title} help`,
        body: description,
        selector: '[data-help="question"]',
        docHref,
        orderIndex: 0,
      },
      {
        itemKey: `${surfaceKey}_primary_tooltip`,
        itemType: 'tooltip',
        label: `${title} tooltip`,
        body: `Use this page to configure ${title.toLowerCase()} safely before running Agents.`,
        selector: `[data-help="${surfaceKey}"]`,
        docHref,
        orderIndex: 1,
      },
      {
        itemKey: `${surfaceKey}_example`,
        itemType: 'example_value',
        label: exampleLabel,
        body: 'Example value shown beside the configuration field.',
        selector: `[data-example="${surfaceKey}"]`,
        docHref,
        exampleValue: { value: exampleText },
        orderIndex: 2,
      },
      {
        itemKey: `${surfaceKey}_error_link`,
        itemType: 'error_doc_link',
        label: `${title} error help`,
        body: 'Show this link when validation fails or a run blocks on this surface.',
        selector: `[data-error="${surfaceKey}"]`,
        docHref: '/docs/troubleshooting/common-issues.md',
        orderIndex: 3,
      },
    ],
  }
}

async function auditHelp(
  action: string,
  resourceType: string,
  resourceId: string,
  metadata: JsonObject,
): Promise<void> {
  await recordAuditLog({
    actorType: 'system',
    action,
    resourceType,
    resourceId,
    riskLevel: 'low',
    message: `${action} recorded for ${resourceType}.`,
    metadata,
  })
}

function normalizeRequired(value: string, field: string): string {
  const trimmed = value.trim()
  if (!trimmed) throw new Error(`${field} is required`)
  return trimmed
}

function normalizeKey(value: string, field: string): string {
  return normalizeRequired(value, field)
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '')
}

function normalizeNullable(value: string | null | undefined): string | null {
  const trimmed = value?.trim()
  return trimmed ? trimmed : null
}

function normalizeLimit(limit: number | undefined): number {
  return Math.min(Math.max(limit ?? 200, 1), 500)
}
