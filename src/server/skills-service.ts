import path from 'node:path'

import { desc, eq } from 'drizzle-orm'

import { db, schema } from '@/db/client'
import type {
  JsonObject,
  SkillInstallFlowRow,
  SkillMarketplacePublicationRow,
  SkillRow,
  SkillSdkManifestRow,
  SkillSdkValidationStatus,
  SkillSource,
} from '@/db/schema'
import {
  newSkillId,
  newSkillInstallFlowId,
  newSkillMarketplacePublicationId,
  newSkillSdkManifestId,
} from '@/server/ids'

const DEFAULT_SKILLS_MARKETPLACE_URL = 'https://skillsmp.com/'
const REQUIRED_SKILL_SDK_PATHS = [
  'skill.json',
  'src/',
  'tests/',
  'prompts/system-addon.md',
  'examples/',
  'README.md',
]
const SKILL_SDK_DEPENDENCY_KEYS = ['python_packages', 'node_packages', 'system_tools'] as const

export interface InstallSkillArgs {
  source: SkillSource
  url: string
  name?: string
  description?: string
  manifest?: JsonObject
}

export interface CreateSkillSdkManifestArgs {
  skillId?: string | null
  manifest: JsonObject
  files?: string[]
}

export interface ScaffoldSkillSdkProjectArgs {
  name: string
  version?: string
  capabilities: string[]
  dependencies?: SkillSdkDependencies
  permissions?: string[]
}

export interface PublishSkillMarketplaceArgs {
  manifestId: string
  marketplaceUrl?: string
}

export type SkillSdkDependencies = Record<(typeof SKILL_SDK_DEPENDENCY_KEYS)[number], string[]>

export interface SkillSdkValidationResult {
  status: SkillSdkValidationStatus
  findings: string[]
  name: string
  version: string
  capabilities: string[]
  dependencies: SkillSdkDependencies
  permissions: string[]
  requiredFiles: string[]
  scaffoldFiles: string[]
  normalizedManifest: JsonObject
}

export function getSkillsMarketplaceUrl(): string {
  return process.env.AGENTHUB_SKILLS_MARKETPLACE_URL ?? DEFAULT_SKILLS_MARKETPLACE_URL
}

export async function listSkills(): Promise<SkillRow[]> {
  return db.query.skills.findMany({ orderBy: [desc(schema.skills.createdAt)] })
}

export async function listSkillInstallFlows(): Promise<SkillInstallFlowRow[]> {
  return db.query.skillInstallFlows.findMany({
    orderBy: [desc(schema.skillInstallFlows.createdAt)],
    limit: 50,
  })
}

export async function listSkillSdkManifests(): Promise<SkillSdkManifestRow[]> {
  return db.query.skillSdkManifests.findMany({
    orderBy: [desc(schema.skillSdkManifests.updatedAt)],
    limit: 50,
  })
}

export async function listSkillMarketplacePublications(): Promise<SkillMarketplacePublicationRow[]> {
  return db.query.skillMarketplacePublications.findMany({
    orderBy: [desc(schema.skillMarketplacePublications.updatedAt)],
    limit: 50,
  })
}

export async function installSkill(args: InstallSkillArgs): Promise<{
  skill: SkillRow
  installFlow: SkillInstallFlowRow
}> {
  const now = Date.now()
  const id = newSkillId()
  const manifest = args.manifest ?? {}
  const name = normalizeName(args.name) ?? getManifestString(manifest, 'name') ?? deriveNameFromUrl(args.url)
  const installPath = path.join(getSkillsInstallRoot(), safeSegment(id))
  const skill = {
    id,
    name,
    description: args.description?.trim() ?? getManifestString(manifest, 'description') ?? '',
    source: args.source,
    sourceUrl: args.url.trim(),
    manifest,
    installPath,
    enabled: true,
    status: 'installed' as const,
    createdAt: now,
    updatedAt: now,
  }
  const installFlow = {
    id: newSkillInstallFlowId(),
    skillId: id,
    source: args.source,
    url: args.url.trim(),
    manifest,
    installPath,
    status: 'installed' as const,
    error: null,
    createdAt: now,
    updatedAt: now,
  }

  await db.insert(schema.skills).values(skill)
  await db.insert(schema.skillInstallFlows).values(installFlow)
  return { skill, installFlow }
}

export async function setSkillEnabled(id: string, enabled: boolean): Promise<SkillRow> {
  await db
    .update(schema.skills)
    .set({
      enabled,
      status: enabled ? 'installed' : 'disabled',
      updatedAt: Date.now(),
    })
    .where(eq(schema.skills.id, id))
  const skill = await db.query.skills.findFirst({ where: eq(schema.skills.id, id) })
  if (!skill) throw new Error(`Skill not found: ${id}`)
  return skill
}

export function validateSkillSdkManifest(args: CreateSkillSdkManifestArgs): SkillSdkValidationResult {
  const files = args.files ?? []
  const manifest = args.manifest
  const findings: string[] = []
  const name = readManifestString(manifest, 'name')
  const version = readManifestString(manifest, 'version')
  const capabilities = readStringArray(manifest.capabilities)
  const dependencies = normalizeDependencies(manifest.dependencies)
  const permissions = readStringArray(manifest.permissions)
  const normalizedFiles = files.map(normalizeSkillPath).filter(Boolean)

  if (!name) findings.push('skill.json must include a non-empty name.')
  if (!version) findings.push('skill.json must include a non-empty version.')
  if (capabilities.length === 0) findings.push('skill.json capabilities must contain at least one capability.')
  if (!Array.isArray(manifest.permissions)) findings.push('skill.json permissions must be an array.')
  if (!isDependencyObject(manifest.dependencies)) {
    findings.push('skill.json dependencies must declare python_packages, node_packages, and system_tools arrays.')
  }
  for (const key of SKILL_SDK_DEPENDENCY_KEYS) {
    if (!Array.isArray((manifest.dependencies as Record<string, unknown> | undefined)?.[key])) {
      findings.push(`dependencies.${key} must be an array.`)
    }
  }
  for (const required of REQUIRED_SKILL_SDK_PATHS) {
    if (!hasRequiredPath(normalizedFiles, required)) findings.push(`Missing required Skill SDK path: ${required}`)
  }

  const normalizedManifest: JsonObject = {
    ...manifest,
    name: name || 'untitled-skill',
    version: version || '0.0.0',
    capabilities,
    dependencies,
    permissions,
  }

  return {
    status: findings.length === 0 ? 'valid' : 'invalid',
    findings,
    name: name || 'untitled-skill',
    version: version || '0.0.0',
    capabilities,
    dependencies,
    permissions,
    requiredFiles: [...REQUIRED_SKILL_SDK_PATHS],
    scaffoldFiles: normalizedFiles,
    normalizedManifest,
  }
}

export async function createSkillSdkManifest(
  args: CreateSkillSdkManifestArgs,
): Promise<SkillSdkManifestRow> {
  const validation = validateSkillSdkManifest(args)
  const now = Date.now()
  const row: SkillSdkManifestRow = {
    id: newSkillSdkManifestId(),
    skillId: args.skillId ?? null,
    name: validation.name,
    version: validation.version,
    capabilities: validation.capabilities,
    dependencies: validation.dependencies,
    permissions: validation.permissions,
    requiredFiles: validation.requiredFiles,
    scaffoldFiles: validation.scaffoldFiles,
    manifest: validation.normalizedManifest,
    validationStatus: validation.status,
    validationFindings: validation.findings,
    createdAt: now,
    updatedAt: now,
  }
  await db.insert(schema.skillSdkManifests).values(row)
  return row
}

export async function scaffoldSkillSdkProject(
  args: ScaffoldSkillSdkProjectArgs,
): Promise<{
  manifest: SkillSdkManifestRow
  files: Record<string, string>
  requiredFiles: string[]
}> {
  const dependencies = normalizeDependencies(args.dependencies)
  const permissions = args.permissions?.map((item) => item.trim()).filter(Boolean) ?? []
  const capabilities = args.capabilities.map((item) => item.trim()).filter(Boolean)
  const name = args.name.trim()
  const version = args.version?.trim() || '0.1.0'
  const manifest: JsonObject = {
    name,
    version,
    capabilities,
    dependencies,
    permissions,
  }
  const files = buildSkillSdkScaffoldFiles({
    name,
    version,
    capabilities,
    dependencies,
    permissions,
    manifest,
  })
  const row = await createSkillSdkManifest({
    manifest,
    files: Object.keys(files),
  })
  return { manifest: row, files, requiredFiles: [...REQUIRED_SKILL_SDK_PATHS] }
}

export async function publishSkillToMarketplace(
  args: PublishSkillMarketplaceArgs,
): Promise<SkillMarketplacePublicationRow> {
  const manifest = await db.query.skillSdkManifests.findFirst({
    where: eq(schema.skillSdkManifests.id, args.manifestId),
  })
  if (!manifest) throw new Error(`Skill SDK manifest not found: ${args.manifestId}`)
  if (manifest.validationStatus !== 'valid') {
    throw new Error(`Skill SDK manifest must be valid before marketplace publishing: ${args.manifestId}`)
  }
  const now = Date.now()
  const marketplaceUrl = args.marketplaceUrl?.trim() || getSkillsMarketplaceUrl()
  const row: SkillMarketplacePublicationRow = {
    id: newSkillMarketplacePublicationId(),
    manifestId: manifest.id,
    marketplaceUrl,
    packageName: manifest.name,
    packageVersion: manifest.version,
    status: 'published',
    submissionPayload: {
      marketplaceUrl,
      skillJson: manifest.manifest,
      requiredFiles: manifest.requiredFiles,
      scaffoldFiles: manifest.scaffoldFiles,
      dependencies: manifest.dependencies,
      permissions: manifest.permissions,
      recordOnly: true,
    },
    validationSnapshot: {
      validationStatus: manifest.validationStatus,
      validationFindings: manifest.validationFindings,
      requiredFiles: manifest.requiredFiles,
      capabilities: manifest.capabilities,
    },
    publishedAt: now,
    createdAt: now,
    updatedAt: now,
  }
  await db.insert(schema.skillMarketplacePublications).values(row)
  return row
}

function getSkillsInstallRoot(): string {
  const dataDir = process.env.AGENTHUB_DATA_DIR ?? path.resolve(process.cwd(), '.agenthub-data')
  return path.join(dataDir, 'skills')
}

function normalizeName(value: string | undefined): string | null {
  const trimmed = value?.trim()
  return trimmed ? trimmed : null
}

function getManifestString(manifest: JsonObject, key: string): string | null {
  const value = manifest[key]
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function deriveNameFromUrl(url: string): string {
  const trimmed = url.trim()
  if (!trimmed) return 'Untitled skill'
  const last = trimmed.split(/[\\/]/).filter(Boolean).at(-1)
  return last?.replace(/\.git$/i, '') || 'Untitled skill'
}

function safeSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9_.-]/g, '_')
}

function readManifestString(manifest: JsonObject, key: string): string {
  const value = manifest[key]
  return typeof value === 'string' ? value.trim() : ''
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.map((item) => (typeof item === 'string' ? item.trim() : '')).filter(Boolean)
}

function normalizeDependencies(value: unknown): SkillSdkDependencies {
  const source = isJsonRecord(value) ? value : {}
  return {
    python_packages: readStringArray(source.python_packages),
    node_packages: readStringArray(source.node_packages),
    system_tools: readStringArray(source.system_tools),
  }
}

function isDependencyObject(value: unknown): value is Record<string, unknown> {
  return isJsonRecord(value) && SKILL_SDK_DEPENDENCY_KEYS.every((key) => key in value)
}

function isJsonRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function normalizeSkillPath(value: string): string {
  return value.trim().replaceAll('\\', '/').replace(/^\.?\//, '')
}

function hasRequiredPath(files: string[], required: string): boolean {
  const normalized = normalizeSkillPath(required)
  if (normalized.endsWith('/')) {
    return files.some((file) => file === normalized || file.startsWith(normalized))
  }
  return files.includes(normalized)
}

function buildSkillSdkScaffoldFiles(args: {
  name: string
  version: string
  capabilities: string[]
  dependencies: SkillSdkDependencies
  permissions: string[]
  manifest: JsonObject
}): Record<string, string> {
  return {
    'skill.json': `${JSON.stringify(args.manifest, null, 2)}\n`,
    'src/index.ts': [
      `export const skillName = '${escapeSingleQuoted(args.name)}'`,
      '',
      'export async function run(input: unknown): Promise<unknown> {',
      '  return { skill: skillName, input }',
      '}',
      '',
    ].join('\n'),
    'tests/skill.test.ts': [
      "import { describe, expect, it } from 'vitest'",
      "import { run, skillName } from '../src/index'",
      '',
      "describe('skill', () => {",
      "  it('runs the scaffolded skill', async () => {",
      `    expect(skillName).toBe('${escapeSingleQuoted(args.name)}')`,
      "    await expect(run({ ok: true })).resolves.toMatchObject({ skill: skillName })",
      '  })',
      '})',
      '',
    ].join('\n'),
    'prompts/system-addon.md': `# ${args.name} system addon\n\nUse this Skill when the task needs: ${args.capabilities.join(', ')}.\n`,
    'examples/example-input.json': `${JSON.stringify({ capability: args.capabilities[0] ?? 'example' }, null, 2)}\n`,
    'README.md': [
      `# ${args.name}`,
      '',
      `Version: ${args.version}`,
      '',
      '## Capabilities',
      ...args.capabilities.map((capability) => `- ${capability}`),
      '',
      '## Dependencies',
      `- python_packages: ${args.dependencies.python_packages.join(', ') || 'none'}`,
      `- node_packages: ${args.dependencies.node_packages.join(', ') || 'none'}`,
      `- system_tools: ${args.dependencies.system_tools.join(', ') || 'none'}`,
      '',
      '## Permissions',
      ...(args.permissions.length ? args.permissions.map((permission) => `- ${permission}`) : ['- none']),
      '',
    ].join('\n'),
  }
}

function escapeSingleQuoted(value: string): string {
  return value.replaceAll('\\', '\\\\').replaceAll("'", "\\'")
}
