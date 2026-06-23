import { and, asc, eq, type SQL } from 'drizzle-orm'

import { db, schema } from '@/db/client'
import type { ReadinessChecklistCategory, ReadinessChecklistItemRow } from '@/db/schema'
import { newReadinessChecklistItemId } from '@/server/ids'

interface DefaultReadinessItem {
  itemKey: string
  title: string
  category: ReadinessChecklistCategory
  acceptanceCriteria: string
}

const defaultItems: DefaultReadinessItem[] = [
  { itemKey: 'technical_stack', title: '技术选型', category: 'technical', acceptanceCriteria: 'Runtime, database, UI, automation, and packaging choices are documented.' },
  { itemKey: 'core_types', title: '核心类型定义', category: 'technical', acceptanceCriteria: 'Core Agent, workflow, memory, tool, artifact, and permission types are present.' },
  { itemKey: 'security_foundation', title: '安全基础', category: 'security', acceptanceCriteria: 'Secrets, permissions, approvals, sandbox, audit, and abuse boundaries exist.' },
  { itemKey: 'phase_0_scope', title: 'Phase 0范围', category: 'planning', acceptanceCriteria: 'The first build scope is explicit and excludes deferred live/unsafe integrations.' },
  { itemKey: 'development_environment', title: '开发环境', category: 'environment', acceptanceCriteria: 'Required Node, Python, Rust, Git, Chrome, and local commands are known.' },
  { itemKey: 'team', title: '团队', category: 'team', acceptanceCriteria: 'Roles for product, engineering, design, security, docs, and support are assigned or acknowledged.' },
  { itemKey: 'documentation', title: '文档', category: 'documentation', acceptanceCriteria: 'Documentation architecture, glossary, FAQ, troubleshooting, and reference cards exist.' },
  { itemKey: 'legal', title: '法律', category: 'legal', acceptanceCriteria: 'License, forbidden uses, data policy, and release obligations are reviewed.' },
]

export function getDefaultReadinessChecklistItemCount(): number {
  return defaultItems.length
}

export async function seedReadinessChecklistItems(): Promise<ReadinessChecklistItemRow[]> {
  const now = Date.now()
  for (const item of defaultItems) {
    const existing = await db.query.readinessChecklistItems.findFirst({
      where: eq(schema.readinessChecklistItems.itemKey, item.itemKey),
    })
    if (existing) continue
    await db.insert(schema.readinessChecklistItems).values({
      id: newReadinessChecklistItemId(),
      itemKey: item.itemKey,
      title: item.title,
      category: item.category,
      acceptanceCriteria: item.acceptanceCriteria,
      required: true,
      status: 'pending',
      createdAt: now,
      updatedAt: now,
    })
  }
  return listReadinessChecklistItems()
}

export async function listReadinessChecklistItems(args: {
  category?: ReadinessChecklistCategory
  status?: string
  limit?: number
} = {}): Promise<ReadinessChecklistItemRow[]> {
  const conditions: SQL[] = []
  if (args.category) conditions.push(eq(schema.readinessChecklistItems.category, args.category))
  if (args.status) conditions.push(eq(schema.readinessChecklistItems.status, args.status))
  return db.query.readinessChecklistItems.findMany({
    where: conditions.length ? and(...conditions) : undefined,
    orderBy: [asc(schema.readinessChecklistItems.category), asc(schema.readinessChecklistItems.itemKey)],
    limit: args.limit ?? 100,
  })
}
