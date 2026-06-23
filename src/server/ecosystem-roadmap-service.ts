import { and, asc, eq, type SQL } from 'drizzle-orm'

import { db, schema } from '@/db/client'
import type {
  EcosystemRoadmapPhaseRow,
  EcosystemRoadmapStage,
  EcosystemRoadmapStatus,
  JsonObject,
} from '@/db/schema'
import { newEcosystemRoadmapPhaseId } from '@/server/ids'

export interface CreateEcosystemRoadmapPhaseArgs {
  phaseNumber: number
  phaseKey: string
  stage: EcosystemRoadmapStage
  title: string
  initiatives?: JsonObject[]
  requiredAssets?: JsonObject
  communityChannels?: string[]
  revenueModel?: string
  enterpriseReadiness?: JsonObject
  status?: EcosystemRoadmapStatus
}

const defaultPhases: CreateEcosystemRoadmapPhaseArgs[] = [
  {
    phaseNumber: 1,
    phaseKey: 'internal_beta',
    stage: 'internal_beta',
    title: 'Phase 1 Internal Beta',
    initiatives: [
      { key: 'preset_agent_templates', targetCount: 20, description: 'Preload 20 common Agent templates.' },
      { key: 'preset_workflow_templates', targetCount: 10, description: 'Preload 10 common Workflow templates.' },
      { key: 'preset_skills', targetCount: 50, description: 'Preload 50 useful Skills.' },
    ],
    requiredAssets: {
      agentTemplates: 20,
      workflowTemplates: 10,
      skills: 50,
      evidenceRefs: ['agent_templates', 'workflow_presets', 'skills'],
    },
    communityChannels: [],
    revenueModel: 'none_internal_beta',
    enterpriseReadiness: { sla: false, sso: false, auditCompliance: false },
    status: 'active',
  },
  {
    phaseNumber: 2,
    phaseKey: 'open',
    stage: 'open',
    title: 'Phase 2 Open Community',
    initiatives: [
      { key: 'share_agent_templates', description: 'Users can share Agent templates.' },
      { key: 'share_workflow_templates', description: 'Users can share Workflow templates.' },
      { key: 'template_ratings_rankings', description: 'Template rating and ranking metadata.' },
      { key: 'official_curated_templates', description: 'Official review and curated template collections.' },
    ],
    requiredAssets: {
      shareableTypes: ['agent_template', 'workflow_template'],
      moderation: 'official_review',
      rankingInputs: ['rating', 'install_count', 'compatibility'],
    },
    communityChannels: ['template_marketplace'],
    revenueModel: 'free_community_sharing',
    enterpriseReadiness: { sla: false, sso: false, auditCompliance: false },
    status: 'planned',
  },
  {
    phaseNumber: 3,
    phaseKey: 'ecosystem',
    stage: 'ecosystem',
    title: 'Phase 3 Ecosystem',
    initiatives: [
      { key: 'plugin_marketplace', description: 'Plugin marketplace for third-party extensions.' },
      { key: 'developer_sdk', description: 'Developer SDK for Skills, plugins, and integrations.' },
      { key: 'developer_docs_tutorials', description: 'Developer documentation and tutorials.' },
      { key: 'third_party_revenue_share', description: 'Revenue sharing for third-party plugins.' },
      { key: 'community_forum_discord', description: 'Community forum and Discord-style community channel.' },
    ],
    requiredAssets: {
      pluginMarketplace: true,
      sdk: true,
      docs: ['developer_guide', 'tutorials', 'api_reference'],
      revenueShare: true,
    },
    communityChannels: ['forum', 'discord', 'developer_docs'],
    revenueModel: 'third_party_plugin_revenue_share',
    enterpriseReadiness: { sla: false, sso: false, auditCompliance: 'community_audit_logs' },
    status: 'planned',
  },
  {
    phaseNumber: 4,
    phaseKey: 'platform',
    stage: 'platform',
    title: 'Phase 4 Platform',
    initiatives: [
      { key: 'enterprise_edition', description: 'Enterprise edition with SLA, SSO, and audit compliance.' },
      { key: 'cloud_hosted_edition', description: 'Optional cloud-hosted deployment.' },
      { key: 'training_certification', description: 'Training and certification program.' },
      {
        key: 'industry_solutions',
        description: 'Vertical solutions for finance, healthcare, legal, and other regulated industries.',
      },
    ],
    requiredAssets: {
      enterprise: ['sla', 'sso', 'audit_compliance'],
      cloudHosted: true,
      certification: true,
      verticals: ['finance', 'healthcare', 'legal'],
    },
    communityChannels: ['enterprise_support', 'training_portal', 'solution_partner_network'],
    revenueModel: 'enterprise_cloud_training_vertical_solutions',
    enterpriseReadiness: { sla: true, sso: true, auditCompliance: true, industrySolutions: true },
    status: 'planned',
  },
]

export function getDefaultEcosystemRoadmapPhaseCount(): number {
  return defaultPhases.length
}

export async function seedEcosystemRoadmapPhases(): Promise<EcosystemRoadmapPhaseRow[]> {
  const rows: EcosystemRoadmapPhaseRow[] = []
  for (const phase of defaultPhases) {
    const existing = await db.query.ecosystemRoadmapPhases.findFirst({
      where: eq(schema.ecosystemRoadmapPhases.phaseKey, phase.phaseKey),
    })
    if (existing) {
      rows.push(existing)
      continue
    }
    rows.push(await createEcosystemRoadmapPhase(phase))
  }
  return rows.sort((a, b) => a.phaseNumber - b.phaseNumber)
}

export async function createEcosystemRoadmapPhase(
  args: CreateEcosystemRoadmapPhaseArgs,
): Promise<EcosystemRoadmapPhaseRow> {
  const now = Date.now()
  const row = {
    id: newEcosystemRoadmapPhaseId(),
    phaseNumber: args.phaseNumber,
    phaseKey: args.phaseKey.trim(),
    stage: args.stage,
    title: args.title.trim(),
    initiatives: args.initiatives ?? [],
    requiredAssets: args.requiredAssets ?? {},
    communityChannels: args.communityChannels ?? [],
    revenueModel: args.revenueModel?.trim() ?? '',
    enterpriseReadiness: args.enterpriseReadiness ?? {},
    status: args.status ?? 'planned',
    createdAt: now,
    updatedAt: now,
  }
  await db.insert(schema.ecosystemRoadmapPhases).values(row)
  return row
}

export async function listEcosystemRoadmapPhases(args: {
  stage?: EcosystemRoadmapStage
  status?: EcosystemRoadmapStatus
  limit?: number
} = {}): Promise<EcosystemRoadmapPhaseRow[]> {
  const conditions: SQL[] = []
  if (args.stage) conditions.push(eq(schema.ecosystemRoadmapPhases.stage, args.stage))
  if (args.status) conditions.push(eq(schema.ecosystemRoadmapPhases.status, args.status))
  return db.query.ecosystemRoadmapPhases.findMany({
    where: conditions.length ? and(...conditions) : undefined,
    orderBy: [asc(schema.ecosystemRoadmapPhases.phaseNumber)],
    limit: args.limit ?? 50,
  })
}
