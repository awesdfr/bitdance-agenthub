import { and, asc, eq, like, or, type SQL } from 'drizzle-orm'

import { db, schema } from '@/db/client'
import type { GlossaryTermCategory, GlossaryTermRow } from '@/db/schema'
import { newGlossaryTermId } from '@/server/ids'

interface DefaultGlossaryTerm {
  userTerm: string
  internalTerm: string
  category: GlossaryTermCategory
  definition: string
  relatedEntity: string
}

const defaultTerms: DefaultGlossaryTerm[] = [
  {
    userTerm: '员工 / Agent',
    internalTerm: 'agent_profile',
    category: 'operations',
    definition: 'A virtual employee configured through an Agent Profile.',
    relatedEntity: 'agent_profiles',
  },
  {
    userTerm: '技能',
    internalTerm: 'skill',
    category: 'operations',
    definition: 'An Agent professional capability package.',
    relatedEntity: 'skills',
  },
  {
    userTerm: '工具连接',
    internalTerm: 'tool_connection_mcp',
    category: 'operations',
    definition: 'An external tool or service connection, including MCP-backed tools.',
    relatedEntity: 'tool_connections',
  },
  {
    userTerm: '命令行工具',
    internalTerm: 'cli_profile',
    category: 'operations',
    definition: 'A registered command-line tool profile that Agents can call.',
    relatedEntity: 'cli_profiles',
  },
  {
    userTerm: '软件能力',
    internalTerm: 'software_profile',
    category: 'operations',
    definition: 'A callable software capability exposed through CLI, MCP, API, browser, desktop, or macro adapters.',
    relatedEntity: 'software_profiles',
  },
  {
    userTerm: '工作站',
    internalTerm: 'workstation',
    category: 'runtime',
    definition: 'An isolated working environment assigned to an Agent.',
    relatedEntity: 'agent_workstations',
  },
  {
    userTerm: '画布',
    internalTerm: 'canvas',
    category: 'collaboration',
    definition: 'The visual interface for orchestrating multiple Agents.',
    relatedEntity: 'workflows',
  },
  {
    userTerm: '流程',
    internalTerm: 'workflow',
    category: 'runtime',
    definition: 'An automation flow made of connected Agent, tool, approval, condition, or artifact nodes.',
    relatedEntity: 'workflows',
  },
  {
    userTerm: '任务',
    internalTerm: 'task_run',
    category: 'runtime',
    definition: 'A single Agent or Workflow execution.',
    relatedEntity: 'employee_runs',
  },
  {
    userTerm: '记忆',
    internalTerm: 'memory',
    category: 'learning',
    definition: 'Knowledge learned or retained by an Agent.',
    relatedEntity: 'memory_items',
  },
  {
    userTerm: '经验',
    internalTerm: 'reflection',
    category: 'learning',
    definition: 'A post-run learning summary about what worked, failed, and should be reused.',
    relatedEntity: 'run_reflections',
  },
  {
    userTerm: '手册',
    internalTerm: 'playbook',
    category: 'learning',
    definition: 'A solidified reusable working procedure.',
    relatedEntity: 'playbooks',
  },
  {
    userTerm: '产物',
    internalTerm: 'artifact',
    category: 'quality',
    definition: 'A concrete output produced by an Agent or Workflow.',
    relatedEntity: 'artifacts',
  },
  {
    userTerm: '审批',
    internalTerm: 'approval',
    category: 'safety',
    definition: 'A user confirmation gate required before sensitive or risky actions proceed.',
    relatedEntity: 'approval_requests',
  },
  {
    userTerm: '黑板',
    internalTerm: 'blackboard',
    category: 'collaboration',
    definition: 'A shared information space where multiple Agents can coordinate.',
    relatedEntity: 'blackboard_entries',
  },
  {
    userTerm: '回滚',
    internalTerm: 'rollback',
    category: 'safety',
    definition: 'A controlled plan for undoing or recovering from Agent decisions or operations.',
    relatedEntity: 'decision_rollbacks',
  },
  {
    userTerm: '休眠',
    internalTerm: 'hibernate',
    category: 'lifecycle',
    definition: 'An Agent state where memory is released without losing durable task state.',
    relatedEntity: 'runtime_checkpoints',
  },
  {
    userTerm: '试用期',
    internalTerm: 'probation',
    category: 'lifecycle',
    definition: 'A guarded period where a new Agent must prove reliability before broader autonomy.',
    relatedEntity: 'agent_profiles',
  },
  {
    userTerm: '预热',
    internalTerm: 'warmup',
    category: 'lifecycle',
    definition: 'A preparation run that loads context, validates tools, and reduces first-task risk.',
    relatedEntity: 'employee_runs',
  },
  {
    userTerm: '降级',
    internalTerm: 'degradation',
    category: 'runtime',
    definition: 'A fallback mode used when a model, tool, network, browser, or queue dependency is unhealthy.',
    relatedEntity: 'degradation_events',
  },
  {
    userTerm: '对话式协作',
    internalTerm: 'conversational_collaboration',
    category: 'collaboration',
    definition: 'A workflow where humans and Agents coordinate through messages, approvals, and shared context.',
    relatedEntity: 'inter_agent_messages',
  },
  {
    userTerm: '信心评分',
    internalTerm: 'confidence_score',
    category: 'quality',
    definition: 'A score indicating how confident an Agent or validation system is in a decision or artifact.',
    relatedEntity: 'artifact_validations',
  },
  {
    userTerm: '组织学习',
    internalTerm: 'organizational_learning',
    category: 'learning',
    definition: 'Cross-Agent learning that promotes reusable team knowledge from individual memories.',
    relatedEntity: 'organizational_knowledge_items',
  },
  {
    userTerm: '元Agent',
    internalTerm: 'meta_agent',
    category: 'operations',
    definition: 'A restricted steward Agent that summarizes system health and recommends improvements.',
    relatedEntity: 'meta_agent_profiles',
  },
  {
    userTerm: '红队',
    internalTerm: 'red_team',
    category: 'safety',
    definition: 'A safety review mode that probes prompt injection, abuse, permission bypass, and failure paths.',
    relatedEntity: 'security_findings',
  },
  {
    userTerm: '面试',
    internalTerm: 'interview',
    category: 'quality',
    definition: 'A structured Agent onboarding or evaluation conversation with scoring rubrics.',
    relatedEntity: 'agent_interviews',
  },
  {
    userTerm: '退役',
    internalTerm: 'retirement',
    category: 'lifecycle',
    definition: 'The controlled process for disabling an Agent and transferring useful knowledge.',
    relatedEntity: 'agent_retirement_plans',
  },
  {
    userTerm: '反模式',
    internalTerm: 'anti_pattern',
    category: 'quality',
    definition: 'A known harmful pattern that should be detected, explained, and avoided.',
    relatedEntity: 'prompt_anti_pattern_rules',
  },
  {
    userTerm: '死信',
    internalTerm: 'dead_letter',
    category: 'runtime',
    definition: 'A task or event that cannot be processed safely and must be isolated for review.',
    relatedEntity: 'task_queue_items',
  },
  {
    userTerm: '接管',
    internalTerm: 'takeover',
    category: 'operations',
    definition: 'A user temporarily takes control from an Agent to inspect, correct, or complete work.',
    relatedEntity: 'user_overrides',
  },
  {
    userTerm: '插话',
    internalTerm: 'interruption',
    category: 'collaboration',
    definition: 'A user or Agent interrupts an active plan with a higher-priority instruction or correction.',
    relatedEntity: 'user_overrides',
  },
  {
    userTerm: '熔断',
    internalTerm: 'circuit_breaker',
    category: 'safety',
    definition: 'A stop or pause mechanism triggered by repeated failures, unsafe behavior, or cost risk.',
    relatedEntity: 'abuse_detection_events',
  },
  {
    userTerm: '漂移',
    internalTerm: 'drift',
    category: 'quality',
    definition: 'A detected deviation in prompt behavior, model results, cost, latency, or output quality.',
    relatedEntity: 'benchmark_runs',
  },
]

export function getDefaultGlossaryTermCount(): number {
  return defaultTerms.length
}

export async function seedGlossaryTerms(): Promise<GlossaryTermRow[]> {
  const now = Date.now()
  for (const term of defaultTerms) {
    const existing = await db.query.glossaryTerms.findFirst({
      where: eq(schema.glossaryTerms.internalTerm, term.internalTerm),
    })
    if (existing) continue
    await db.insert(schema.glossaryTerms).values({
      id: newGlossaryTermId(),
      userTerm: term.userTerm,
      internalTerm: term.internalTerm,
      category: term.category,
      definition: term.definition,
      relatedEntity: term.relatedEntity,
      status: 'active',
      createdAt: now,
      updatedAt: now,
    })
  }
  return listGlossaryTerms()
}

export async function listGlossaryTerms(args: {
  category?: GlossaryTermCategory
  term?: string
  status?: string
  limit?: number
} = {}): Promise<GlossaryTermRow[]> {
  const conditions: SQL[] = []
  if (args.category) conditions.push(eq(schema.glossaryTerms.category, args.category))
  if (args.status) conditions.push(eq(schema.glossaryTerms.status, args.status))
  if (args.term) {
    const pattern = `%${args.term.trim()}%`
    const termCondition = or(
      like(schema.glossaryTerms.userTerm, pattern),
      like(schema.glossaryTerms.internalTerm, pattern),
    )
    if (termCondition) conditions.push(termCondition)
  }
  return db.query.glossaryTerms.findMany({
    where: conditions.length ? and(...conditions) : undefined,
    orderBy: [asc(schema.glossaryTerms.category), asc(schema.glossaryTerms.internalTerm)],
    limit: args.limit ?? 100,
  })
}
