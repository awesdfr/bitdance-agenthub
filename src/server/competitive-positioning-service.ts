import { and, desc, eq, type SQL } from 'drizzle-orm'

import { db, schema } from '@/db/client'
import type {
  CompetitivePositioningReportRow,
  CompetitivePositioningStatus,
  JsonObject,
} from '@/db/schema'
import { newCompetitivePositioningReportId } from '@/server/ids'

export interface CreateCompetitivePositioningReportArgs {
  name?: string
  competitors?: JsonObject[]
  differentiators?: JsonObject[]
  strategicImplications?: JsonObject[]
  summary?: string
  status?: CompetitivePositioningStatus
}

const defaultCompetitors: JsonObject[] = [
  {
    name: 'AutoGPT / BabyAGI',
    category: 'single_agent_loop',
    limitation: '单 Agent，无编排，无记忆系统，无桌面操作',
    designResponse: 'Position Reasonix as a multi-Agent employee factory with orchestration, memory, and computer operation.',
  },
  {
    name: 'LangChain / CrewAI',
    category: 'developer_framework',
    limitation: '开发框架，需要写代码，非产品',
    designResponse: 'Expose product UI, templates, approvals, and local control plane instead of requiring users to code workflows.',
  },
  {
    name: 'Microsoft Copilot',
    category: 'embedded_assistant',
    limitation: '嵌入 Office，不能创建自定义 Agent',
    designResponse: 'Let users create configurable employee Agents across models, Skills, MCP, CLI, software, memory, and permissions.',
  },
  {
    name: 'Claude Code / Codex CLI',
    category: 'code_agent_cli',
    limitation: '代码专用，不能操作桌面软件',
    designResponse: 'Treat coding CLIs as one callable capability inside a broader software and workflow orchestration system.',
  },
  {
    name: 'Browser-use / Playwright',
    category: 'browser_automation',
    limitation: '浏览器专用，不能编排多 Agent',
    designResponse: 'Use browser automation as one workstation adapter while preserving multi-Agent Canvas orchestration.',
  },
]

const defaultDifferentiators: JsonObject[] = [
  {
    key: 'multi_agent_orchestration',
    title: '多 Agent 编排',
    explanation: 'The product is not a single Agent loop; it coordinates multiple employee Agents through Workflow and Canvas.',
  },
  {
    key: 'local_first',
    title: '本地优先',
    explanation: 'The default architecture keeps data, runs, memories, and approvals local instead of starting as SaaS.',
  },
  {
    key: 'employee_model',
    title: '完整的员工模型',
    explanation: 'An Agent is a profile with model, Skills, tools, memory, permissions, workstation, and output contracts.',
  },
  {
    key: 'software_cli_ization',
    title: '软件 CLI 化',
    explanation: 'Desktop, browser, CLI, API, MCP, and macro adapters can be wrapped into selectable software abilities.',
  },
  {
    key: 'isolated_workstations',
    title: '隔离工作站',
    explanation: 'Agents can work in separate browser contexts, workspaces, CLI environments, and future virtual desktops.',
  },
  {
    key: 'long_term_memory_learning',
    title: '长期记忆和学习',
    explanation: 'Runs produce memories, reflections, Playbooks, organizational learning, and knowledge transfer records.',
  },
  {
    key: 'visual_canvas',
    title: 'Canvas 可视化编排',
    explanation: 'Users compose and monitor Agent teams visually instead of only writing code or prompts.',
  },
]

const defaultStrategicImplications: JsonObject[] = [
  {
    area: 'product_design',
    implication: 'Prefer control-plane pages, Agent Factory, Canvas, approvals, and run observability over chat-only UX.',
  },
  {
    area: 'go_to_market',
    implication: 'Lead with local AI employee operating system positioning rather than generic agent framework messaging.',
  },
  {
    area: 'roadmap',
    implication: 'Prioritize software adapters, workstation isolation, memory learning, and template ecosystems.',
  },
]

export function getDefaultCompetitorCount(): number {
  return defaultCompetitors.length
}

export function getDefaultDifferentiatorCount(): number {
  return defaultDifferentiators.length
}

export async function seedCompetitivePositioningReport(): Promise<CompetitivePositioningReportRow> {
  const existing = await db.query.competitivePositioningReports.findFirst({
    where: eq(schema.competitivePositioningReports.name, 'Default Competitive Positioning'),
  })
  if (existing) return existing
  return createCompetitivePositioningReport({
    name: 'Default Competitive Positioning',
    competitors: defaultCompetitors,
    differentiators: defaultDifferentiators,
    strategicImplications: defaultStrategicImplications,
    summary:
      'Reasonix differentiates as a local-first AI employee operating system: multi-Agent orchestration, employee profiles, software adapters, isolated workstations, memory learning, and visual Canvas workflows.',
    status: 'active',
  })
}

export async function createCompetitivePositioningReport(
  args: CreateCompetitivePositioningReportArgs = {},
): Promise<CompetitivePositioningReportRow> {
  const now = Date.now()
  const row = {
    id: newCompetitivePositioningReportId(),
    name: args.name?.trim() || 'Competitive Positioning Report',
    competitors: args.competitors?.length ? args.competitors : defaultCompetitors,
    differentiators: args.differentiators?.length ? args.differentiators : defaultDifferentiators,
    strategicImplications: args.strategicImplications?.length
      ? args.strategicImplications
      : defaultStrategicImplications,
    summary: args.summary?.trim() || 'Competitive positioning report for Agent orchestration design.',
    status: args.status ?? 'active',
    createdAt: now,
    updatedAt: now,
  }
  await db.insert(schema.competitivePositioningReports).values(row)
  return row
}

export async function listCompetitivePositioningReports(args: {
  status?: CompetitivePositioningStatus
  limit?: number
} = {}): Promise<CompetitivePositioningReportRow[]> {
  const conditions: SQL[] = []
  if (args.status) conditions.push(eq(schema.competitivePositioningReports.status, args.status))
  return db.query.competitivePositioningReports.findMany({
    where: conditions.length ? and(...conditions) : undefined,
    orderBy: [desc(schema.competitivePositioningReports.updatedAt)],
    limit: args.limit ?? 50,
  })
}
