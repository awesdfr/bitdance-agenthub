import { desc } from 'drizzle-orm'

import { db, schema } from '@/db/client'
import type {
  SkillInstallFlowRow,
  SkillMarketplacePublicationRow,
  SkillRow,
  SkillSdkManifestRow,
} from '@/db/schema'
import { getSkillsMarketplaceUrl } from '@/server/skills-service'

export type SkillsMapIntegrationReadiness = 'ready' | 'needs_configuration' | 'empty'

export interface SkillsMapIntegrationReport {
  readiness: SkillsMapIntegrationReadiness
  readinessScore: number
  marketplace: {
    url: string
    host: string | null
    isHttps: boolean
    isSkillsMapLike: boolean
    embedSurface: 'skillsmp_cli_api'
    iframeTitle: string
    expectedPanels: string[]
  }
  summary: {
    installedSkills: number
    enabledSkills: number
    disabledSkills: number
    skillsMapInstallFlows: number
    githubInstallFlows: number
    localInstallFlows: number
    failedInstallFlows: number
    sdkManifests: number
    validSdkManifests: number
    marketplacePublications: number
    publishedMarketplacePackages: number
  }
  localSkills: Array<Pick<SkillRow, 'id' | 'name' | 'source' | 'enabled' | 'status' | 'sourceUrl'>>
  recentInstallFlows: Array<Pick<SkillInstallFlowRow, 'id' | 'skillId' | 'source' | 'url' | 'status' | 'error' | 'createdAt'>>
  sdkManifests: Array<Pick<SkillSdkManifestRow, 'id' | 'name' | 'version' | 'validationStatus' | 'capabilities' | 'permissions'>>
  marketplacePublications: Array<Pick<SkillMarketplacePublicationRow, 'id' | 'packageName' | 'packageVersion' | 'marketplaceUrl' | 'status'>>
  gaps: string[]
  warnings: string[]
  recommendations: string[]
  generatedAt: number
}

export async function getSkillsMapIntegrationReport(): Promise<SkillsMapIntegrationReport> {
  const [skills, installFlows, sdkManifests, marketplacePublications] = await Promise.all([
    db.query.skills.findMany({ orderBy: [desc(schema.skills.createdAt)], limit: 100 }),
    db.query.skillInstallFlows.findMany({ orderBy: [desc(schema.skillInstallFlows.createdAt)], limit: 100 }),
    db.query.skillSdkManifests.findMany({ orderBy: [desc(schema.skillSdkManifests.updatedAt)], limit: 100 }),
    db.query.skillMarketplacePublications.findMany({
      orderBy: [desc(schema.skillMarketplacePublications.updatedAt)],
      limit: 100,
    }),
  ])
  const marketplaceUrl = getSkillsMarketplaceUrl()
  const marketplace = summarizeMarketplace(marketplaceUrl)
  const summary = {
    installedSkills: skills.filter((skill) => skill.status === 'installed').length,
    enabledSkills: skills.filter((skill) => skill.enabled).length,
    disabledSkills: skills.filter((skill) => !skill.enabled || skill.status === 'disabled').length,
    skillsMapInstallFlows: installFlows.filter((flow) => flow.source === 'skillsmp').length,
    githubInstallFlows: installFlows.filter((flow) => flow.source === 'github').length,
    localInstallFlows: installFlows.filter((flow) => flow.source === 'local').length,
    failedInstallFlows: installFlows.filter((flow) => flow.status === 'failed').length,
    sdkManifests: sdkManifests.length,
    validSdkManifests: sdkManifests.filter((manifest) => manifest.validationStatus === 'valid').length,
    marketplacePublications: marketplacePublications.length,
    publishedMarketplacePackages: marketplacePublications.filter((publication) => publication.status === 'published').length,
  }
  const gaps = buildGaps({ marketplace, summary })
  const warnings = buildWarnings({ marketplace, skills, installFlows, sdkManifests, marketplacePublications })
  const readiness = resolveReadiness({ gaps, summary })
  return {
    readiness,
    readinessScore: scoreReadiness(readiness, gaps, warnings, summary),
    marketplace,
    summary,
    localSkills: skills.map((skill) => ({
      id: skill.id,
      name: skill.name,
      source: skill.source,
      enabled: skill.enabled,
      status: skill.status,
      sourceUrl: skill.sourceUrl,
    })),
    recentInstallFlows: installFlows.slice(0, 10).map((flow) => ({
      id: flow.id,
      skillId: flow.skillId,
      source: flow.source,
      url: flow.url,
      status: flow.status,
      error: flow.error,
      createdAt: flow.createdAt,
    })),
    sdkManifests: sdkManifests.slice(0, 10).map((manifest) => ({
      id: manifest.id,
      name: manifest.name,
      version: manifest.version,
      validationStatus: manifest.validationStatus,
      capabilities: manifest.capabilities,
      permissions: manifest.permissions,
    })),
    marketplacePublications: marketplacePublications.slice(0, 10).map((publication) => ({
      id: publication.id,
      packageName: publication.packageName,
      packageVersion: publication.packageVersion,
      marketplaceUrl: publication.marketplaceUrl,
      status: publication.status,
    })),
    gaps,
    warnings,
    recommendations: buildRecommendations({ marketplace, summary, gaps, warnings }),
    generatedAt: Date.now(),
  }
}

function summarizeMarketplace(url: string): SkillsMapIntegrationReport['marketplace'] {
  let parsed: URL | null = null
  try {
    parsed = new URL(url)
  } catch {
    parsed = null
  }
  const host = parsed?.host ?? null
  return {
    url,
    host,
    isHttps: parsed?.protocol === 'https:',
    isSkillsMapLike: Boolean(host && /skillsm?p/i.test(host)),
    embedSurface: 'skillsmp_cli_api',
    iframeTitle: 'SkillsMP CLI search',
    expectedPanels: [
      'local_installed_skills',
      'install_flows',
      'skillsmp_cli_search',
      'developer_sdk_manifests',
      'marketplace_publications',
    ],
  }
}

function buildGaps(args: {
  marketplace: SkillsMapIntegrationReport['marketplace']
  summary: SkillsMapIntegrationReport['summary']
}): string[] {
  const gaps: string[] = []
  if (!args.marketplace.host) gaps.push('Skills marketplace URL is not a valid URL.')
  if (args.marketplace.host && !args.marketplace.isHttps) {
    gaps.push('Skills marketplace URL should use HTTPS before querying the SkillsMP API.')
  }
  if (args.summary.failedInstallFlows > 0) {
    gaps.push(`${args.summary.failedInstallFlows} Skill install flow(s) failed and need review.`)
  }
  return gaps
}

function buildWarnings(args: {
  marketplace: SkillsMapIntegrationReport['marketplace']
  skills: SkillRow[]
  installFlows: SkillInstallFlowRow[]
  sdkManifests: SkillSdkManifestRow[]
  marketplacePublications: SkillMarketplacePublicationRow[]
}): string[] {
  const warnings: string[] = []
  if (!args.marketplace.isSkillsMapLike) {
    warnings.push('Marketplace URL does not look like a SkillsMap/skillsmp host.')
  }
  if (args.skills.length === 0) warnings.push('No local Skills are installed yet.')
  if (args.installFlows.length === 0) warnings.push('No Skill install flow history exists yet.')
  if (args.sdkManifests.some((manifest) => manifest.validationStatus === 'invalid')) {
    warnings.push('At least one Skill SDK manifest is invalid.')
  }
  if (args.marketplacePublications.length === 0) {
    warnings.push('No Skill marketplace publication records exist yet.')
  }
  return warnings
}

function resolveReadiness(args: {
  gaps: string[]
  summary: SkillsMapIntegrationReport['summary']
}): SkillsMapIntegrationReadiness {
  if (args.gaps.length > 0) return 'needs_configuration'
  if (args.summary.installedSkills === 0 && args.summary.sdkManifests === 0) return 'empty'
  return 'ready'
}

function scoreReadiness(
  readiness: SkillsMapIntegrationReadiness,
  gaps: string[],
  warnings: string[],
  summary: SkillsMapIntegrationReport['summary'],
): number {
  const base = readiness === 'ready' ? 75 : readiness === 'empty' ? 45 : 55
  const skillBonus = Math.min(10, summary.enabledSkills * 2)
  const sdkBonus = Math.min(8, summary.validSdkManifests * 2)
  const publicationBonus = Math.min(7, summary.publishedMarketplacePackages * 2)
  return Math.max(0, Math.min(100, base + skillBonus + sdkBonus + publicationBonus - gaps.length * 10 - warnings.length * 2))
}

function buildRecommendations(args: {
  marketplace: SkillsMapIntegrationReport['marketplace']
  summary: SkillsMapIntegrationReport['summary']
  gaps: string[]
  warnings: string[]
}): string[] {
  const recommendations: string[] = []
  if (args.gaps.some((gap) => gap.includes('HTTPS'))) {
    recommendations.push('Use an HTTPS SkillsMap URL before enabling the SkillsMP CLI/API search surface.')
  }
  if (args.summary.installedSkills === 0) {
    recommendations.push('Install at least one Skill from SkillsMap, GitHub, or local source so Agents can select it.')
  }
  if (args.summary.failedInstallFlows > 0) {
    recommendations.push('Open failed install flows and retry after fixing the source URL or manifest.')
  }
  if (args.summary.validSdkManifests === 0) {
    recommendations.push('Scaffold and validate a Skill SDK manifest before publishing custom Skills.')
  }
  if (args.summary.marketplacePublications === 0) {
    recommendations.push('Record marketplace publication metadata when sharing Skills with other users.')
  }
  if (!recommendations.length) {
    recommendations.push('Skills Center is ready for local Skill management and SkillsMP CLI/API discovery.')
  }
  return recommendations
}
