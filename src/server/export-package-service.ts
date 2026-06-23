import { createHash } from 'node:crypto'

import { desc, eq } from 'drizzle-orm'

import { db, schema } from '@/db/client'
import type {
  ConfigEntityType,
  ExportPackageRow,
  ExportPackageType,
  JsonObject,
  PackageCompatibilityStatus,
  PackageImportCheckRow,
} from '@/db/schema'
import { captureConfigVersion } from '@/server/config-version-service'
import { newExportPackageId, newPackageImportCheckId } from '@/server/ids'
import { recordAuditLog } from '@/server/security-service'

export interface CreateExportPackageArgs {
  packageType: ExportPackageType
  sourceEntityId: string
  name?: string
  author?: string | null
  description?: string
  packageVersion?: string
  tags?: string[]
  includes?: {
    memories?: boolean
    sampleArtifacts?: boolean
    benchmarkResults?: boolean
  }
}

export interface RunPackageImportCheckArgs {
  packageId: string
}

interface PackageDependencies extends JsonObject {
  skills: Array<{ name: string; version: string }>
  models: Array<{ provider: string; recommendedModel: string }>
  software: string[]
  systemRequirements: {
    os: string[]
    minMemory: string
    minDisk: string
    requiredSoftware: string[]
  }
}

export async function createExportPackage(
  args: CreateExportPackageArgs,
): Promise<ExportPackageRow> {
  const source = await buildPackageSource(args)
  const payload = sanitizeSecrets(source.snapshot)
  const dependencies = await deriveDependencies(args.packageType, payload)
  const name = (args.name?.trim() || source.displayName).trim()
  const packageVersion = args.packageVersion?.trim() || '1.0.0'
  const includes = {
    memories: args.includes?.memories ?? false,
    sampleArtifacts: args.includes?.sampleArtifacts ?? false,
    benchmarkResults: args.includes?.benchmarkResults ?? false,
  }
  const packageDocument: JsonObject = {
    format_version: '1.0',
    type: args.packageType,
    metadata: {
      name,
      author: args.author?.trim() || 'local-user',
      description: args.description?.trim() || '',
      version: packageVersion,
      createdAt: new Date(source.createdAt).toISOString(),
      tags: normalizeStringArray(args.tags),
    },
    payload,
    includes,
    dependencies,
  }
  const contentHash = `sha256:${hashJson(packageDocument)}`
  const row: ExportPackageRow = {
    id: newExportPackageId(),
    packageType: args.packageType,
    sourceEntityType: args.packageType,
    sourceEntityId: args.sourceEntityId,
    sourceConfigVersionId: source.sourceConfigVersionId,
    formatVersion: '1.0',
    name,
    author: args.author?.trim() || 'local-user',
    description: args.description?.trim() || '',
    packageVersion,
    tags: normalizeStringArray(args.tags),
    includes,
    dependencies,
    payload,
    fileName: `${slugify(name)}-${packageVersion}.reasonix-pkg`,
    contentHash,
    signature: contentHash,
    status: 'ready',
    createdAt: Date.now(),
  }
  await db.insert(schema.exportPackages).values(row)
  await recordAuditLog({
    actorType: 'system',
    action: 'export_package.create',
    resourceType: 'export_package',
    resourceId: row.id,
    riskLevel: 'low',
    message: `Share package ${row.fileName} was created.`,
    metadata: {
      packageType: row.packageType,
      sourceEntityType: row.sourceEntityType,
      sourceEntityId: row.sourceEntityId,
      sourceConfigVersionId: row.sourceConfigVersionId,
      contentHash: row.contentHash,
    },
  })
  return row
}

export async function listExportPackages(limit = 100): Promise<ExportPackageRow[]> {
  return db.query.exportPackages.findMany({
    orderBy: [desc(schema.exportPackages.createdAt)],
    limit: Math.min(Math.max(limit, 1), 500),
  })
}

export async function runPackageImportCheck(
  args: RunPackageImportCheckArgs,
): Promise<PackageImportCheckRow> {
  const pkg = await db.query.exportPackages.findFirst({
    where: eq(schema.exportPackages.id, args.packageId),
  })
  if (!pkg) throw new Error(`Export package not found: ${args.packageId}`)

  const dependencies = pkg.dependencies as PackageDependencies
  const missingSkills = await missingSkillNames(dependencies.skills ?? [])
  const missingModels = await missingModelRefs(dependencies.models ?? [])
  const requiredSoftware = dependencies.systemRequirements?.requiredSoftware ?? dependencies.software ?? []
  const missingSoftware = await missingSoftwareNames(requiredSoftware)
  const sanitizedSecrets = !containsSensitiveKey(pkg.payload)
  const compatibilityStatus = classifyCompatibility({
    sanitizedSecrets,
    missingSkills,
    missingModels,
    missingSoftware,
  })
  const row: PackageImportCheckRow = {
    id: newPackageImportCheckId(),
    exportPackageId: pkg.id,
    sourceFileName: pkg.fileName,
    compatibilityStatus,
    missingSkills,
    missingModels,
    missingSoftware,
    sanitizedSecrets,
    summary: summarizeCompatibility(compatibilityStatus, missingSkills, missingModels, missingSoftware),
    createdAt: Date.now(),
  }
  await db.insert(schema.packageImportChecks).values(row)
  await recordAuditLog({
    actorType: 'system',
    action: 'export_package.import_check',
    resourceType: 'export_package',
    resourceId: pkg.id,
    status: compatibilityStatus === 'blocked' ? 'blocked' : 'warning',
    riskLevel: compatibilityStatus === 'blocked' ? 'high' : 'low',
    message: row.summary,
    metadata: {
      importCheckId: row.id,
      compatibilityStatus,
      missingSkills,
      missingModels,
      missingSoftware,
      sanitizedSecrets,
    },
  })
  return row
}

export async function listPackageImportChecks(limit = 100): Promise<PackageImportCheckRow[]> {
  return db.query.packageImportChecks.findMany({
    orderBy: [desc(schema.packageImportChecks.createdAt)],
    limit: Math.min(Math.max(limit, 1), 500),
  })
}

async function buildPackageSource(args: CreateExportPackageArgs): Promise<{
  displayName: string
  snapshot: JsonObject
  createdAt: number
  sourceConfigVersionId: string | null
}> {
  if (args.packageType === 'skill') {
    const skill = await db.query.skills.findFirst({
      where: eq(schema.skills.id, args.sourceEntityId),
    })
    if (!skill) throw new Error(`Skill not found: ${args.sourceEntityId}`)
    return {
      displayName: skill.name,
      snapshot: {
        entityType: 'skill',
        entityId: skill.id,
        skill,
      },
      createdAt: Date.now(),
      sourceConfigVersionId: null,
    }
  }

  const entityType = packageTypeToConfigEntityType(args.packageType)
  const version = await captureConfigVersion({
    entityType,
    entityId: args.sourceEntityId,
    source: 'gitops_export',
    changeSummary: 'Captured for standalone share package.',
    createdBy: args.author ?? null,
  })
  return {
    displayName: version.displayName,
    snapshot: version.snapshot,
    createdAt: version.createdAt,
    sourceConfigVersionId: version.id,
  }
}

function packageTypeToConfigEntityType(packageType: Exclude<ExportPackageType, 'skill'>): ConfigEntityType {
  if (packageType === 'recorded_macro') return 'recorded_macro'
  return packageType
}

async function deriveDependencies(
  packageType: ExportPackageType,
  payload: JsonObject,
): Promise<PackageDependencies> {
  const profile = objectAt(payload, 'profile')
  const command = objectAt(payload, 'command')
  const skillIds = stringArray(profile.skillIds)
  const softwareProfileIds = stringArray(profile.softwareProfileIds)
  const modelProfileId = stringOrNull(profile.modelProfileId)
  const skills = await skillDependencies(skillIds)
  const models = await modelDependencies(modelProfileId ? [modelProfileId] : [])
  const software = await softwareDependencies(softwareProfileIds)
  const commandSoftware = stringOrNull(command.softwareProfileId)
    ? await softwareDependencies([stringOrNull(command.softwareProfileId)!])
    : []

  return {
    skills,
    models,
    software: Array.from(new Set([...software, ...commandSoftware])),
    systemRequirements: {
      os: ['windows'],
      minMemory: '4GB',
      minDisk: '1GB',
      requiredSoftware: Array.from(new Set([...software, ...commandSoftware])),
    },
    packageType,
  }
}

async function skillDependencies(skillIds: string[]): Promise<Array<{ name: string; version: string }>> {
  const rows = await db.query.skills.findMany()
  return skillIds.map((id) => {
    const row = rows.find((skill) => skill.id === id)
    return { name: row?.name ?? id, version: 'any' }
  })
}

async function modelDependencies(modelProfileIds: string[]): Promise<Array<{ provider: string; recommendedModel: string }>> {
  const rows = await db.query.modelProfiles.findMany()
  return modelProfileIds.map((id) => {
    const row = rows.find((model) => model.id === id)
    return {
      provider: row?.provider ?? 'custom',
      recommendedModel: row?.model ?? id,
    }
  })
}

async function softwareDependencies(softwareProfileIds: string[]): Promise<string[]> {
  const rows = await db.query.softwareProfiles.findMany()
  return softwareProfileIds.map((id) => rows.find((software) => software.id === id)?.name ?? id)
}

async function missingSkillNames(skills: Array<{ name: string; version: string }>): Promise<string[]> {
  const rows = await db.query.skills.findMany()
  const names = new Set(rows.map((skill) => skill.name))
  return skills.map((skill) => skill.name).filter((name) => !names.has(name))
}

async function missingModelRefs(
  models: Array<{ provider: string; recommendedModel: string }>,
): Promise<JsonObject[]> {
  const rows = await db.query.modelProfiles.findMany()
  return models
    .filter((model) =>
      !rows.some((row) => row.provider === model.provider && row.model === model.recommendedModel),
    )
    .map((model) => ({ provider: model.provider, recommendedModel: model.recommendedModel }))
}

async function missingSoftwareNames(names: string[]): Promise<string[]> {
  const rows = await db.query.softwareProfiles.findMany()
  const available = new Set(rows.map((software) => software.name))
  return names.filter((name) => !available.has(name))
}

function sanitizeSecrets(value: unknown): JsonObject {
  const sanitized = sanitizeValue(value)
  return sanitized && typeof sanitized === 'object' && !Array.isArray(sanitized)
    ? (sanitized as JsonObject)
    : {}
}

function sanitizeValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitizeValue)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, item]) => [
      key,
      isSensitiveKey(key) ? '[REDACTED]' : sanitizeValue(item),
    ]),
  )
}

function containsSensitiveKey(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(containsSensitiveKey)
  if (!value || typeof value !== 'object') return false
  return Object.entries(value as Record<string, unknown>).some(
    ([key, item]) => isSensitiveKey(key) && item !== '[REDACTED]' || containsSensitiveKey(item),
  )
}

function isSensitiveKey(key: string): boolean {
  return /(api.?key|secret|token|password|credential|encrypted|nonce|valueRef)/i.test(key)
}

function classifyCompatibility(args: {
  sanitizedSecrets: boolean
  missingSkills: string[]
  missingModels: JsonObject[]
  missingSoftware: string[]
}): PackageCompatibilityStatus {
  if (!args.sanitizedSecrets) return 'blocked'
  if (args.missingSkills.length || args.missingModels.length || args.missingSoftware.length) {
    return 'warning'
  }
  return 'compatible'
}

function summarizeCompatibility(
  status: PackageCompatibilityStatus,
  missingSkills: string[],
  missingModels: JsonObject[],
  missingSoftware: string[],
): string {
  if (status === 'compatible') return 'Package is compatible with the current workspace.'
  if (status === 'blocked') return 'Package contains unsanitized secret material and cannot be imported.'
  return `Package can be imported after reviewing missing dependencies: ${[
    missingSkills.length ? `${missingSkills.length} skills` : '',
    missingModels.length ? `${missingModels.length} models` : '',
    missingSoftware.length ? `${missingSoftware.length} software profiles` : '',
  ].filter(Boolean).join(', ')}.`
}

function objectAt(value: JsonObject, key: string): Record<string, unknown> {
  const item = value[key]
  return item && typeof item === 'object' && !Array.isArray(item) ? item as Record<string, unknown> : {}
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function normalizeStringArray(value: string[] | undefined): string[] {
  return Array.from(new Set((value ?? []).map((item) => item.trim()).filter(Boolean)))
}

function slugify(value: string): string {
  const slug = value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
  return slug || 'agenthub-package'
}

function hashJson(value: unknown): string {
  return createHash('sha256').update(stableStringify(value)).digest('hex')
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>
    return `{${Object.keys(obj)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(obj[key])}`)
      .join(',')}}`
  }
  return value === undefined ? 'undefined' : (JSON.stringify(value) ?? 'null')
}
