import { and, asc, desc, eq, type SQL } from 'drizzle-orm'

import { db, schema } from '@/db/client'
import type { BrandCandidateLanguage, BrandCandidateRow, BrandGuidelineRow } from '@/db/schema'
import { newBrandCandidateId, newBrandGuidelineId } from '@/server/ids'

const defaultCandidates: Array<{
  language: BrandCandidateLanguage
  name: string
  rationale: string
}> = [
  { language: 'zh', name: '灵工', rationale: 'Lightweight local AI worker team feeling.' },
  { language: 'zh', name: '智员', rationale: 'Emphasizes intelligent employee roles.' },
  { language: 'zh', name: '数员', rationale: 'Signals digital staff and local operation.' },
  { language: 'zh', name: '码工', rationale: 'Developer-friendly name with practical tool feel.' },
  { language: 'en', name: 'Reasonix', rationale: 'Reasoning system identity with product extensibility.' },
  { language: 'en', name: 'AgentOS', rationale: 'Operating-system metaphor for local Agent employees.' },
  { language: 'en', name: 'CrewBase', rationale: 'Team/workbase naming for orchestrated Agents.' },
  { language: 'en', name: 'DeskMind', rationale: 'Desktop-local AI worker positioning.' },
]

const defaultGuideline = {
  slogan: '你的AI员工团队，本地运行',
  toneKeywords: ['professional', 'modern', 'tool_control'],
  avoidKeywords: ['over_personification'],
  positioning: 'Local AI employee team and control plane for orchestrating Agents, tools, memory, and workflows.',
}

export function getDefaultBrandCandidateCount(): number {
  return defaultCandidates.length
}

export async function seedBrandIdentity(): Promise<{
  candidates: BrandCandidateRow[]
  guideline: BrandGuidelineRow
}> {
  const now = Date.now()
  for (const candidate of defaultCandidates) {
    const existing = await db.query.brandCandidates.findFirst({
      where: eq(schema.brandCandidates.name, candidate.name),
    })
    if (existing) continue
    await db.insert(schema.brandCandidates).values({
      id: newBrandCandidateId(),
      language: candidate.language,
      name: candidate.name,
      rationale: candidate.rationale,
      status: 'candidate',
      createdAt: now,
      updatedAt: now,
    })
  }
  let guideline = await db.query.brandGuidelines.findFirst({
    where: eq(schema.brandGuidelines.slogan, defaultGuideline.slogan),
  })
  if (!guideline) {
    const row = {
      id: newBrandGuidelineId(),
      slogan: defaultGuideline.slogan,
      toneKeywords: defaultGuideline.toneKeywords,
      avoidKeywords: defaultGuideline.avoidKeywords,
      positioning: defaultGuideline.positioning,
      status: 'active',
      createdAt: now,
      updatedAt: now,
    }
    await db.insert(schema.brandGuidelines).values(row)
    guideline = row
  }
  return {
    candidates: await listBrandCandidates(),
    guideline,
  }
}

export async function listBrandCandidates(args: {
  language?: BrandCandidateLanguage
  status?: string
  limit?: number
} = {}): Promise<BrandCandidateRow[]> {
  const conditions: SQL[] = []
  if (args.language) conditions.push(eq(schema.brandCandidates.language, args.language))
  if (args.status) conditions.push(eq(schema.brandCandidates.status, args.status))
  return db.query.brandCandidates.findMany({
    where: conditions.length ? and(...conditions) : undefined,
    orderBy: [asc(schema.brandCandidates.language), asc(schema.brandCandidates.name)],
    limit: args.limit ?? 100,
  })
}

export async function listBrandGuidelines(args: {
  status?: string
  limit?: number
} = {}): Promise<BrandGuidelineRow[]> {
  const conditions: SQL[] = []
  if (args.status) conditions.push(eq(schema.brandGuidelines.status, args.status))
  return db.query.brandGuidelines.findMany({
    where: conditions.length ? and(...conditions) : undefined,
    orderBy: [desc(schema.brandGuidelines.updatedAt)],
    limit: args.limit ?? 20,
  })
}
