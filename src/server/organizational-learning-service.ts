import { desc, eq } from 'drizzle-orm'

import { db, schema } from '@/db/client'
import type {
  AgentProfileRow,
  MemoryItemRow,
  MemoryType,
  OrganizationalInsightStatus,
  OrganizationalInsightType,
  OrganizationalKnowledgeItemRow,
  OrganizationalKnowledgeSource,
  OrganizationalLearningReportRow,
} from '@/db/schema'
import {
  newMemoryItemId,
  newOrganizationalKnowledgeItemId,
  newOrganizationalLearningReportId,
} from '@/server/ids'
import { recordAuditLog } from '@/server/security-service'

export interface BuildOrganizationalKnowledgeArgs {
  source?: OrganizationalKnowledgeSource
  sourceRef?: string | null
  periodStartAt?: number | null
  periodEndAt?: number | null
  minFrequency?: number
  promoteCandidates?: boolean
}

export interface OrganizationalKnowledgeBuildResult {
  insights: OrganizationalKnowledgeItemRow[]
  report: OrganizationalLearningReportRow
}

type DraftInsight = Omit<
  OrganizationalKnowledgeItemRow,
  'id' | 'createdAt' | 'updatedAt' | 'promotedMemoryItemId'
> & {
  promotedMemoryItemId?: string | null
}

export async function buildOrganizationalKnowledge(
  args: BuildOrganizationalKnowledgeArgs = {},
): Promise<OrganizationalKnowledgeBuildResult> {
  const source = args.source ?? 'all_agents'
  const sourceRef = normalizeNullable(args.sourceRef)
  const minFrequency = Math.max(1, args.minFrequency ?? 1)
  const now = Date.now()
  const agents = await db.query.agentProfiles.findMany()
  const agentById = new Map(agents.map((agent) => [agent.id, agent]))
  const candidateMemories = await loadCandidateMemories({
    agents,
    source,
    sourceRef,
    periodStartAt: args.periodStartAt ?? null,
    periodEndAt: args.periodEndAt ?? null,
  })

  const drafts = [
    ...buildFailurePatternInsights(candidateMemories, agentById, source, sourceRef),
    ...buildBestPracticeInsights(candidateMemories, agentById, source, sourceRef),
    ...buildSoftwareTipInsights(candidateMemories, agentById, source, sourceRef),
    ...buildCustomerPreferenceInsights(candidateMemories, source, sourceRef),
  ]
    .filter((draft) => draft.frequency >= minFrequency)
    .slice(0, 80)

  const insights: OrganizationalKnowledgeItemRow[] = []
  for (const draft of drafts) {
    let promotedMemoryItemId = draft.promotedMemoryItemId ?? null
    let status = draft.status
    if (args.promoteCandidates && shouldPromote(draft)) {
      promotedMemoryItemId = await createPromotedMemoryFromInsight(draft)
      status = 'promoted'
    }
    const row: OrganizationalKnowledgeItemRow = {
      id: newOrganizationalKnowledgeItemId(),
      ...draft,
      status,
      promotedMemoryItemId,
      createdAt: now,
      updatedAt: now,
    }
    await db.insert(schema.organizationalKnowledgeItems).values(row)
    insights.push(row)
  }

  const report = await createOrganizationalLearningReport({
    source,
    sourceRef,
    periodStartAt: args.periodStartAt ?? null,
    periodEndAt: args.periodEndAt ?? null,
    insights,
  })

  await recordAuditLog({
    actorType: 'system',
    action: 'organizational_learning.build',
    resourceType: 'organizational_learning_report',
    resourceId: report.id,
    status: 'allowed',
    riskLevel: 'low',
    message: `Generated ${insights.length} organizational learning insight(s).`,
    metadata: {
      source,
      sourceRef,
      promoteCandidates: Boolean(args.promoteCandidates),
      insightIds: insights.map((insight) => insight.id),
    },
  })

  return { insights, report }
}

export async function promoteOrganizationalInsight(
  insightId: string,
): Promise<OrganizationalKnowledgeItemRow> {
  const insight = await getRequiredOrganizationalInsight(insightId)
  if (insight.status === 'promoted' && insight.promotedMemoryItemId) return insight
  const promotedMemoryItemId = await createPromotedMemoryFromInsight(insight)
  const now = Date.now()
  await db
    .update(schema.organizationalKnowledgeItems)
    .set({
      status: 'promoted',
      promotedMemoryItemId,
      updatedAt: now,
    })
    .where(eq(schema.organizationalKnowledgeItems.id, insight.id))
  await recordAuditLog({
    actorType: 'system',
    action: 'organizational_learning.promote',
    resourceType: 'organizational_knowledge_item',
    resourceId: insight.id,
    status: 'allowed',
    riskLevel: 'low',
    message: 'Promoted organizational insight into global memory.',
    metadata: {
      promotedMemoryItemId,
      insightType: insight.insightType,
      title: insight.title,
    },
  })
  return getRequiredOrganizationalInsight(insight.id)
}

export async function listOrganizationalKnowledgeItems(args: {
  insightType?: OrganizationalInsightType
  status?: OrganizationalInsightStatus
  source?: OrganizationalKnowledgeSource
  limit?: number
} = {}): Promise<OrganizationalKnowledgeItemRow[]> {
  const rows = await db.query.organizationalKnowledgeItems.findMany({
    orderBy: [desc(schema.organizationalKnowledgeItems.createdAt)],
    limit: args.limit ?? 100,
  })
  return rows.filter((row) => {
    if (args.insightType && row.insightType !== args.insightType) return false
    if (args.status && row.status !== args.status) return false
    if (args.source && row.source !== args.source) return false
    return true
  })
}

export async function listOrganizationalLearningReports(
  limit = 100,
): Promise<OrganizationalLearningReportRow[]> {
  return db.query.organizationalLearningReports.findMany({
    orderBy: [desc(schema.organizationalLearningReports.createdAt)],
    limit,
  })
}

async function createOrganizationalLearningReport(args: {
  source: OrganizationalKnowledgeSource
  sourceRef: string | null
  periodStartAt: number | null
  periodEndAt: number | null
  insights: OrganizationalKnowledgeItemRow[]
}): Promise<OrganizationalLearningReportRow> {
  const topInsight = args.insights
    .slice()
    .sort((a, b) => scoreInsight(b) - scoreInsight(a))[0]
  const recommendedActions = buildRecommendedActions(args.insights)
  const row: OrganizationalLearningReportRow = {
    id: newOrganizationalLearningReportId(),
    source: args.source,
    sourceRef: args.sourceRef,
    periodStartAt: args.periodStartAt,
    periodEndAt: args.periodEndAt,
    newDiscoveries: args.insights.length,
    deprecatedKnowledge: 0,
    topInsight: topInsight?.title ?? 'No organizational insight discovered yet.',
    recommendedActions,
    insightIds: args.insights.map((insight) => insight.id),
    createdAt: Date.now(),
  }
  await db.insert(schema.organizationalLearningReports).values(row)
  return row
}

async function loadCandidateMemories(args: {
  agents: AgentProfileRow[]
  source: OrganizationalKnowledgeSource
  sourceRef: string | null
  periodStartAt: number | null
  periodEndAt: number | null
}): Promise<MemoryItemRow[]> {
  const all = await db.query.memoryItems.findMany({
    orderBy: [desc(schema.memoryItems.createdAt)],
    limit: 5000,
  })
  const agentIds = new Set(
    args.source === 'specific_role' && args.sourceRef
      ? args.agents
        .filter((agent) => agent.role.toLowerCase().includes(args.sourceRef!.toLowerCase()))
        .map((agent) => agent.id)
      : args.agents.map((agent) => agent.id),
  )
  return all.filter((memory) => {
    if (args.periodStartAt && memory.createdAt < args.periodStartAt) return false
    if (args.periodEndAt && memory.createdAt > args.periodEndAt) return false
    if (args.source === 'specific_role') {
      return Boolean(memory.agentProfileId && agentIds.has(memory.agentProfileId))
    }
    if (args.source === 'specific_project' && args.sourceRef) {
      const haystack = `${memory.title}\n${memory.content}`.toLowerCase()
      return memory.scope === 'project' || haystack.includes(args.sourceRef.toLowerCase())
    }
    return true
  })
}

function buildFailurePatternInsights(
  memories: MemoryItemRow[],
  agentById: Map<string, AgentProfileRow>,
  source: OrganizationalKnowledgeSource,
  sourceRef: string | null,
): DraftInsight[] {
  return groupMemories(memories.filter((memory) => memory.type === 'mistake')).map((group) => ({
    source,
    sourceRef,
    insightType: 'failure_pattern',
    title: `Failure pattern: ${group.label}`,
    summary: `${group.items.length} memory item(s) describe a recurring failure around ${group.label}.`,
    pattern: group.label,
    frequency: group.items.length,
    effectiveness: average(group.items.map((memory) => memory.importance * memory.confidence)),
    affectedAgentIds: uniqueAgentIds(group.items),
    contributedByAgentIds: uniqueAgentIds(group.items),
    evidence: group.items.slice(0, 5).map((memory) => memory.title),
    knownFix: inferKnownFix(group.items),
    applicableTo: rolesFor(group.items, agentById),
    softwareName: null,
    status: 'candidate',
  }))
}

function buildBestPracticeInsights(
  memories: MemoryItemRow[],
  agentById: Map<string, AgentProfileRow>,
  source: OrganizationalKnowledgeSource,
  sourceRef: string | null,
): DraftInsight[] {
  return groupMemories(
    memories.filter((memory) => memory.type === 'procedural' || memory.type === 'success'),
  ).map((group) => ({
    source,
    sourceRef,
    insightType: 'best_practice',
    title: `Best practice: ${group.label}`,
    summary: `${group.items.length} Agent memory item(s) support this reusable practice.`,
    pattern: group.label,
    frequency: group.items.length,
    effectiveness: average(group.items.map((memory) => memory.importance * memory.confidence)),
    affectedAgentIds: [],
    contributedByAgentIds: uniqueAgentIds(group.items),
    evidence: group.items.slice(0, 5).map((memory) => memory.content.slice(0, 160)),
    knownFix: '',
    applicableTo: rolesFor(group.items, agentById),
    softwareName: null,
    status: 'candidate',
  }))
}

function buildSoftwareTipInsights(
  memories: MemoryItemRow[],
  agentById: Map<string, AgentProfileRow>,
  source: OrganizationalKnowledgeSource,
  sourceRef: string | null,
): DraftInsight[] {
  return groupMemories(memories.filter((memory) => memory.type === 'software')).map((group) => ({
    source,
    sourceRef,
    insightType: 'software_tip',
    title: `Software tip: ${group.label}`,
    summary: `${group.items.length} software-use tip(s) can be shared across Agents.`,
    pattern: group.label,
    frequency: group.items.length,
    effectiveness: average(group.items.map((memory) => memory.importance * memory.confidence)),
    affectedAgentIds: [],
    contributedByAgentIds: uniqueAgentIds(group.items),
    evidence: group.items.slice(0, 5).map((memory) => memory.content.slice(0, 160)),
    knownFix: '',
    applicableTo: rolesFor(group.items, agentById),
    softwareName: group.label.split(/\s+/)[0] ?? null,
    status: 'candidate',
  }))
}

function buildCustomerPreferenceInsights(
  memories: MemoryItemRow[],
  source: OrganizationalKnowledgeSource,
  sourceRef: string | null,
): DraftInsight[] {
  return groupMemories(memories.filter((memory) => memory.type === 'customer')).map((group) => ({
    source,
    sourceRef,
    insightType: 'customer_preference',
    title: `Customer preference: ${group.label}`,
    summary: `${group.items.length} memory item(s) indicate a shared customer preference.`,
    pattern: group.label,
    frequency: group.items.length,
    effectiveness: average(group.items.map((memory) => memory.importance * memory.confidence)),
    affectedAgentIds: [],
    contributedByAgentIds: uniqueAgentIds(group.items),
    evidence: group.items.slice(0, 5).map((memory) => memory.title),
    knownFix: '',
    applicableTo: [],
    softwareName: null,
    status: 'candidate',
  }))
}

function groupMemories(memories: MemoryItemRow[]): Array<{ label: string; items: MemoryItemRow[] }> {
  const groups = new Map<string, MemoryItemRow[]>()
  for (const memory of memories) {
    const label = normalizeInsightLabel(memory.title)
    const existing = groups.get(label) ?? []
    existing.push(memory)
    groups.set(label, existing)
  }
  return Array.from(groups, ([label, items]) => ({ label, items }))
    .sort((a, b) => b.items.length - a.items.length)
}

function normalizeInsightLabel(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, ' ')
    .trim()
    .split(/\s+/)
    .slice(0, 8)
    .join(' ') || 'untitled insight'
}

async function getRequiredOrganizationalInsight(id: string): Promise<OrganizationalKnowledgeItemRow> {
  const row = await db.query.organizationalKnowledgeItems.findFirst({
    where: eq(schema.organizationalKnowledgeItems.id, id.trim()),
  })
  if (!row) throw new Error(`Organizational knowledge item not found: ${id}`)
  return row
}

async function createPromotedMemoryFromInsight(
  insight: Pick<
    OrganizationalKnowledgeItemRow,
    'title' | 'summary' | 'insightType' | 'evidence' | 'knownFix' | 'effectiveness'
  >,
): Promise<string> {
  const now = Date.now()
  const row = {
    id: newMemoryItemId(),
    agentProfileId: null,
    scope: 'global' as const,
    type: memoryTypeForInsight(insight.insightType),
    title: `Organizational: ${insight.title}`,
    content: [
      insight.summary,
      insight.knownFix ? `Known fix: ${insight.knownFix}` : '',
      insight.evidence.length ? `Evidence: ${insight.evidence.join(' | ')}` : '',
    ].filter(Boolean).join('\n'),
    sourceRunId: null,
    embedding: null,
    confidence: Math.max(0.5, Math.min(1, insight.effectiveness || 0.8)),
    importance: 0.85,
    createdAt: now,
    updatedAt: now,
    expiresAt: null,
  }
  await db.insert(schema.memoryItems).values(row)
  return row.id
}

function shouldPromote(insight: DraftInsight): boolean {
  if (insight.insightType === 'failure_pattern') return insight.frequency >= 2
  return insight.frequency >= 2 || insight.effectiveness >= 0.75
}

function memoryTypeForInsight(insightType: OrganizationalInsightType): MemoryType {
  if (insightType === 'failure_pattern') return 'mistake'
  if (insightType === 'software_tip') return 'software'
  if (insightType === 'customer_preference') return 'customer'
  return 'procedural'
}

function buildRecommendedActions(insights: OrganizationalKnowledgeItemRow[]): string[] {
  const actions: string[] = []
  const failures = insights.filter((insight) => insight.insightType === 'failure_pattern')
  const practices = insights.filter((insight) => insight.insightType === 'best_practice')
  const softwareTips = insights.filter((insight) => insight.insightType === 'software_tip')
  if (failures.length) actions.push(`Review ${failures.length} recurring failure pattern(s).`)
  if (practices.length) actions.push(`Promote ${practices.length} best practice(s) into shared playbooks.`)
  if (softwareTips.length) actions.push(`Share ${softwareTips.length} software tip(s) with relevant Agents.`)
  if (actions.length === 0) actions.push('Keep collecting Agent memories before the next organization report.')
  return actions
}

function scoreInsight(insight: OrganizationalKnowledgeItemRow): number {
  return insight.frequency + insight.effectiveness
}

function inferKnownFix(memories: MemoryItemRow[]): string {
  const procedural = memories.find((memory) =>
    /fix|resolve|avoid|修复|避免|解决/i.test(memory.content),
  )
  return procedural?.content.slice(0, 180) ?? ''
}

function uniqueAgentIds(memories: MemoryItemRow[]): string[] {
  return Array.from(new Set(memories.flatMap((memory) => memory.agentProfileId ? [memory.agentProfileId] : [])))
}

function rolesFor(memories: MemoryItemRow[], agentById: Map<string, AgentProfileRow>): string[] {
  return Array.from(new Set(
    memories.flatMap((memory) => {
      if (!memory.agentProfileId) return []
      const role = agentById.get(memory.agentProfileId)?.role
      return role ? [role] : []
    }),
  ))
}

function average(values: number[]): number {
  if (values.length === 0) return 0
  return Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(4))
}

function normalizeNullable(value: string | null | undefined): string | null {
  if (value === undefined || value === null) return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}
