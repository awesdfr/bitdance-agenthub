import { and, asc, eq, like, type SQL } from 'drizzle-orm'

import { db, schema } from '@/db/client'
import type { QuickReferenceCategory, QuickReferenceItemRow } from '@/db/schema'
import { newQuickReferenceItemId } from '@/server/ids'

interface DefaultQuickReferenceItem {
  actionLabel: string
  shortcut?: string | null
  sequenceSteps: string[]
  category: QuickReferenceCategory
  targetSurface: string
}

const defaultItems: DefaultQuickReferenceItem[] = [
  {
    actionLabel: '创建Agent',
    shortcut: 'Ctrl+Shift+N',
    sequenceSteps: ['模板', '配置', '测试', '启用'],
    category: 'agent',
    targetSurface: 'agent_factory',
  },
  {
    actionLabel: '提交任务',
    shortcut: 'Enter',
    sequenceSteps: ['选Agent', '描述', '回车'],
    category: 'task',
    targetSurface: 'agent_factory',
  },
  {
    actionLabel: '暂停',
    shortcut: 'Pause',
    sequenceSteps: ['暂停当前运行'],
    category: 'runtime',
    targetSurface: 'run_monitor',
  },
  {
    actionLabel: '紧急停止',
    shortcut: 'Ctrl+Shift+X',
    sequenceSteps: ['立即停止危险或失控运行'],
    category: 'safety',
    targetSurface: 'global',
  },
  {
    actionLabel: '审批',
    shortcut: null,
    sequenceSteps: ['通知面板', '详情', '批准/拒绝'],
    category: 'approval',
    targetSurface: 'notifications',
  },
  {
    actionLabel: '接管',
    shortcut: null,
    sequenceSteps: ['监控', '接管', '操作', '交还'],
    category: 'monitoring',
    targetSurface: 'observability_center',
  },
  {
    actionLabel: '调试',
    shortcut: 'Ctrl+Shift+D',
    sequenceSteps: ['打开调试视图'],
    category: 'debug',
    targetSurface: 'observability_center',
  },
]

export function getDefaultQuickReferenceItemCount(): number {
  return defaultItems.length
}

export async function seedQuickReferenceItems(): Promise<QuickReferenceItemRow[]> {
  const now = Date.now()
  for (const item of defaultItems) {
    const existing = await db.query.quickReferenceItems.findFirst({
      where: eq(schema.quickReferenceItems.actionLabel, item.actionLabel),
    })
    if (existing) continue
    await db.insert(schema.quickReferenceItems).values({
      id: newQuickReferenceItemId(),
      actionLabel: item.actionLabel,
      shortcut: item.shortcut ?? null,
      sequenceSteps: item.sequenceSteps,
      category: item.category,
      targetSurface: item.targetSurface,
      status: 'active',
      createdAt: now,
      updatedAt: now,
    })
  }
  return listQuickReferenceItems()
}

export async function listQuickReferenceItems(args: {
  category?: QuickReferenceCategory
  query?: string
  status?: string
  limit?: number
} = {}): Promise<QuickReferenceItemRow[]> {
  const conditions: SQL[] = []
  if (args.category) conditions.push(eq(schema.quickReferenceItems.category, args.category))
  if (args.status) conditions.push(eq(schema.quickReferenceItems.status, args.status))
  if (args.query) {
    conditions.push(like(schema.quickReferenceItems.actionLabel, `%${args.query.trim()}%`))
  }
  return db.query.quickReferenceItems.findMany({
    where: conditions.length ? and(...conditions) : undefined,
    orderBy: [asc(schema.quickReferenceItems.category), asc(schema.quickReferenceItems.actionLabel)],
    limit: args.limit ?? 100,
  })
}
