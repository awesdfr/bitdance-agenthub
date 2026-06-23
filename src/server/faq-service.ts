import { and, asc, eq, like, or, type SQL } from 'drizzle-orm'

import { db, schema } from '@/db/client'
import type { FaqEntryCategory, FaqEntryRow } from '@/db/schema'
import { newFaqEntryId } from '@/server/ids'

interface DefaultFaqEntry {
  questionKey: string
  question: string
  answer: string
  category: FaqEntryCategory
  relatedFeature: string
}

const defaultFaqEntries: DefaultFaqEntry[] = [
  {
    questionKey: 'data_security',
    question: '数据安全吗?',
    answer: 'v1 defaults to local storage, secret references, and key encryption policies so sensitive data does not need to leave the user machine.',
    category: 'security',
    relatedFeature: 'secret_vault',
  },
  {
    questionKey: 'wrong_file_delete',
    question: '删错文件怎么办?',
    answer: 'File operations should run inside scoped workspaces with sandbox checks and approval gates for destructive actions.',
    category: 'recovery',
    relatedFeature: 'sandbox_policies',
  },
  {
    questionKey: 'local_models',
    question: '支持本地模型吗?',
    answer: 'Ollama-style local model profiles are reserved through the model control plane and can be selected by Agents when configured.',
    category: 'models',
    relatedFeature: 'model_profiles',
  },
  {
    questionKey: 'cost',
    question: '费用怎么算?',
    answer: 'Local-first usage can be free at the app layer; users bring their own API keys for paid model providers and can review cost estimates.',
    category: 'cost',
    relatedFeature: 'model_route_decisions',
  },
  {
    questionKey: 'offline',
    question: '能离线使用吗?',
    answer: 'Offline mode depends on local models and local tools; with Ollama and local-only capabilities, core tasks can run without external providers.',
    category: 'offline',
    relatedFeature: 'degradation_policies',
  },
  {
    questionKey: 'mac_linux',
    question: 'Mac/Linux 支持吗?',
    answer: 'v1 is Windows-first; Mac and Linux support should follow after the local desktop/runtime assumptions are stable.',
    category: 'platform',
    relatedFeature: 'contributor_prerequisites',
  },
  {
    questionKey: 'agent_rebellion',
    question: 'Agent 叛变怎么办?',
    answer: 'Agents are bounded by sandbox policy, permissions, approvals, circuit breakers, user overrides, and explicit ethical boundaries.',
    category: 'safety',
    relatedFeature: 'user_overrides',
  },
]

export function getDefaultFaqEntryCount(): number {
  return defaultFaqEntries.length
}

export async function seedFaqEntries(): Promise<FaqEntryRow[]> {
  const now = Date.now()
  for (const entry of defaultFaqEntries) {
    const existing = await db.query.faqEntries.findFirst({
      where: eq(schema.faqEntries.questionKey, entry.questionKey),
    })
    if (existing) continue
    await db.insert(schema.faqEntries).values({
      id: newFaqEntryId(),
      questionKey: entry.questionKey,
      question: entry.question,
      answer: entry.answer,
      category: entry.category,
      relatedFeature: entry.relatedFeature,
      status: 'active',
      createdAt: now,
      updatedAt: now,
    })
  }
  return listFaqEntries()
}

export async function listFaqEntries(args: {
  category?: FaqEntryCategory
  query?: string
  status?: string
  limit?: number
} = {}): Promise<FaqEntryRow[]> {
  const conditions: SQL[] = []
  if (args.category) conditions.push(eq(schema.faqEntries.category, args.category))
  if (args.status) conditions.push(eq(schema.faqEntries.status, args.status))
  if (args.query) {
    const pattern = `%${args.query.trim()}%`
    const queryCondition = or(
      like(schema.faqEntries.question, pattern),
      like(schema.faqEntries.answer, pattern),
      like(schema.faqEntries.questionKey, pattern),
    )
    if (queryCondition) conditions.push(queryCondition)
  }
  return db.query.faqEntries.findMany({
    where: conditions.length ? and(...conditions) : undefined,
    orderBy: [asc(schema.faqEntries.category), asc(schema.faqEntries.questionKey)],
    limit: args.limit ?? 100,
  })
}
