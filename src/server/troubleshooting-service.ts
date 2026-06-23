import { and, asc, eq, like, or, type SQL } from 'drizzle-orm'

import { db, schema } from '@/db/client'
import type { TroubleshootingCategory, TroubleshootingEntryRow } from '@/db/schema'
import { newTroubleshootingEntryId } from '@/server/ids'

interface DefaultTroubleshootingEntry {
  symptom: string
  cause: string
  solution: string
  category: TroubleshootingCategory
  relatedFeature: string
}

const defaultEntries: DefaultTroubleshootingEntry[] = [
  {
    symptom: '一直思考中',
    cause: 'API超时',
    solution: '检查连接',
    category: 'model',
    relatedFeature: 'model_connection_tests',
  },
  {
    symptom: '反复做一件事',
    cause: '循环',
    solution: '查看计划手动调整',
    category: 'runtime',
    relatedFeature: 'employee_runs',
  },
  {
    symptom: '说完成但不对',
    cause: '误解任务',
    solution: '更多上下文',
    category: 'runtime',
    relatedFeature: 'context_summaries',
  },
  {
    symptom: '浏览器失败',
    cause: '页面结构变',
    solution: '更新策略',
    category: 'browser',
    relatedFeature: 'computer_sessions',
  },
  {
    symptom: 'Skill安装失败',
    cause: '依赖缺失',
    solution: '手动安装',
    category: 'skills',
    relatedFeature: 'skill_install_flows',
  },
  {
    symptom: '内存高',
    cause: '上下文大',
    solution: '启用压缩',
    category: 'memory',
    relatedFeature: 'runtime_context_snapshots',
  },
  {
    symptom: '跑得慢',
    cause: '模型响应慢',
    solution: '换模型',
    category: 'model',
    relatedFeature: 'performance_analysis_runs',
  },
  {
    symptom: '创建后不能跑',
    cause: '试用期',
    solution: '转正',
    category: 'runtime',
    relatedFeature: 'agent_profiles',
  },
  {
    symptom: 'Canvas红色',
    cause: '上游失败',
    solution: '查错误日志',
    category: 'workflow',
    relatedFeature: 'workflow_node_runs',
  },
  {
    symptom: '审批多',
    cause: '自主低',
    solution: '提升级别',
    category: 'approval',
    relatedFeature: 'autonomy_decisions',
  },
  {
    symptom: '密钥错误',
    cause: '配置问题',
    solution: '检查Vault和Scope',
    category: 'security',
    relatedFeature: 'credential_scopes',
  },
]

export function getDefaultTroubleshootingEntryCount(): number {
  return defaultEntries.length
}

export async function seedTroubleshootingEntries(): Promise<TroubleshootingEntryRow[]> {
  const now = Date.now()
  for (const entry of defaultEntries) {
    const existing = await db.query.troubleshootingEntries.findFirst({
      where: eq(schema.troubleshootingEntries.symptom, entry.symptom),
    })
    if (existing) continue
    await db.insert(schema.troubleshootingEntries).values({
      id: newTroubleshootingEntryId(),
      symptom: entry.symptom,
      cause: entry.cause,
      solution: entry.solution,
      category: entry.category,
      relatedFeature: entry.relatedFeature,
      status: 'active',
      createdAt: now,
      updatedAt: now,
    })
  }
  return listTroubleshootingEntries()
}

export async function listTroubleshootingEntries(args: {
  category?: TroubleshootingCategory
  query?: string
  status?: string
  limit?: number
} = {}): Promise<TroubleshootingEntryRow[]> {
  const conditions: SQL[] = []
  if (args.category) conditions.push(eq(schema.troubleshootingEntries.category, args.category))
  if (args.status) conditions.push(eq(schema.troubleshootingEntries.status, args.status))
  if (args.query) {
    const pattern = `%${args.query.trim()}%`
    const queryCondition = or(
      like(schema.troubleshootingEntries.symptom, pattern),
      like(schema.troubleshootingEntries.cause, pattern),
      like(schema.troubleshootingEntries.solution, pattern),
    )
    if (queryCondition) conditions.push(queryCondition)
  }
  return db.query.troubleshootingEntries.findMany({
    where: conditions.length ? and(...conditions) : undefined,
    orderBy: [asc(schema.troubleshootingEntries.category), asc(schema.troubleshootingEntries.symptom)],
    limit: args.limit ?? 100,
  })
}
