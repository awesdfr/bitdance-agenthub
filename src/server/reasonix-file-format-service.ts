import { asc, desc, eq } from 'drizzle-orm'

import { db, schema } from '@/db/client'
import type {
  JsonObject,
  ReasonixFileFormatKind,
  ReasonixFileFormatSpecRow,
  ReasonixFileValidationRow,
} from '@/db/schema'
import { newReasonixFileFormatSpecId, newReasonixFileValidationId } from '@/server/ids'

interface DefaultReasonixFileFormat {
  formatKind: ReasonixFileFormatKind
  extension: string
  displayName: string
  schemaVersion: string
  metadataSchema: JsonObject
}

const requiredFields = ['schema_version', 'metadata', 'checksum']

const defaultFileFormats: DefaultReasonixFileFormat[] = [
  format('agent', '.reasonix-agent.json', 'Reasonix Agent profile file', {
    required: ['name', 'role', 'exportedAt'],
    properties: ['name', 'role', 'modelProfileId', 'skillIds', 'outputContract'],
  }),
  format('workflow', '.reasonix-workflow.json', 'Reasonix workflow canvas file', {
    required: ['name', 'exportedAt'],
    properties: ['name', 'nodes', 'edges', 'contracts'],
  }),
  format('skill', '.reasonix-skill.rxskill', 'Reasonix packaged Skill file', {
    required: ['name', 'version', 'exportedAt'],
    properties: ['name', 'version', 'capabilities', 'permissions', 'dependencies'],
  }),
  format('macro', '.reasonix-macro.rxmacro', 'Reasonix recorded macro file', {
    required: ['name', 'softwareProfile', 'exportedAt'],
    properties: ['name', 'steps', 'inputSchema', 'outputSchema'],
  }),
  format('package', '.reasonix-pkg.rxpkg', 'Reasonix portable package file', {
    required: ['name', 'exportedAt'],
    properties: ['name', 'entries', 'compatibility', 'manifest'],
  }),
  format('debug', '.reasonix-debug.rxdbg', 'Reasonix debug bundle file', {
    required: ['runId', 'exportedAt'],
    properties: ['runId', 'events', 'artifacts', 'redactions'],
  }),
]

export function getDefaultReasonixFileFormatCount(): number {
  return defaultFileFormats.length
}

export async function seedReasonixFileFormats(): Promise<ReasonixFileFormatSpecRow[]> {
  const now = Date.now()
  for (const item of defaultFileFormats) {
    const existing = await db.query.reasonixFileFormatSpecs.findFirst({
      where: eq(schema.reasonixFileFormatSpecs.formatKind, item.formatKind),
    })
    if (existing) continue
    await db.insert(schema.reasonixFileFormatSpecs).values({
      id: newReasonixFileFormatSpecId(),
      formatKind: item.formatKind,
      extension: item.extension,
      displayName: item.displayName,
      schemaVersion: item.schemaVersion,
      requiredFields,
      metadataSchema: item.metadataSchema,
      checksumAlgorithm: 'sha256',
      signatureOptional: true,
      secretRefsForbidden: true,
      status: 'active',
      createdAt: now,
      updatedAt: now,
    })
  }
  return listReasonixFileFormatSpecs()
}

export async function listReasonixFileFormatSpecs(args: {
  formatKind?: ReasonixFileFormatKind
} = {}): Promise<ReasonixFileFormatSpecRow[]> {
  return db.query.reasonixFileFormatSpecs.findMany({
    where: args.formatKind ? eq(schema.reasonixFileFormatSpecs.formatKind, args.formatKind) : undefined,
    orderBy: [asc(schema.reasonixFileFormatSpecs.formatKind)],
    limit: 100,
  })
}

export async function listReasonixFileValidations(args: {
  formatKind?: ReasonixFileFormatKind
} = {}): Promise<ReasonixFileValidationRow[]> {
  return db.query.reasonixFileValidations.findMany({
    where: args.formatKind ? eq(schema.reasonixFileValidations.formatKind, args.formatKind) : undefined,
    orderBy: [desc(schema.reasonixFileValidations.createdAt)],
    limit: 100,
  })
}

export async function validateReasonixFile(args: {
  formatKind: ReasonixFileFormatKind
  payload: JsonObject
  signature?: string | null
}): Promise<ReasonixFileValidationRow> {
  await seedReasonixFileFormats()
  const spec = await db.query.reasonixFileFormatSpecs.findFirst({
    where: eq(schema.reasonixFileFormatSpecs.formatKind, args.formatKind),
  })
  if (!spec) throw new Error(`Reasonix file format spec not found: ${args.formatKind}`)

  const findings: string[] = []
  for (const field of spec.requiredFields) {
    if (!Object.prototype.hasOwnProperty.call(args.payload, field)) {
      findings.push(`Missing required Reasonix field: ${field}.`)
    }
  }

  const schemaVersion = getString(args.payload.schema_version)
  if (!schemaVersion) {
    findings.push('schema_version must be a non-empty string.')
  } else if (schemaVersion !== spec.schemaVersion) {
    findings.push(`schema_version must be ${spec.schemaVersion} for ${spec.extension}.`)
  }

  const metadata = getJsonObject(args.payload.metadata)
  if (!metadata) findings.push('metadata must be a JSON object.')

  const checksum = getString(args.payload.checksum)
  if (!checksum) {
    findings.push('checksum must be a non-empty string.')
  } else if (!checksum.toLowerCase().startsWith(`${spec.checksumAlgorithm}:`)) {
    findings.push(`checksum must use ${spec.checksumAlgorithm}: prefix.`)
  }

  if (spec.secretRefsForbidden) {
    for (const secretPath of findForbiddenSecretReferences(args.payload)) {
      findings.push(`Reasonix files must not contain key or secret references: ${secretPath}.`)
    }
  }

  const signaturePresent = hasSignature(args.payload, args.signature)
  const status = findings.length ? 'invalid' : 'valid'
  const now = Date.now()
  const id = newReasonixFileValidationId()
  await db.insert(schema.reasonixFileValidations).values({
    id,
    formatKind: spec.formatKind,
    extension: spec.extension,
    schemaVersion: schemaVersion ?? null,
    checksum: checksum ?? null,
    signaturePresent,
    status,
    findings,
    metadata: metadata ?? {},
    payloadSummary: summarizePayload(args.payload, {
      extension: spec.extension,
      signaturePresent,
      secretRefsForbidden: spec.secretRefsForbidden,
    }),
    createdAt: now,
  })
  const row = await db.query.reasonixFileValidations.findFirst({
    where: eq(schema.reasonixFileValidations.id, id),
  })
  if (!row) throw new Error('Reasonix file validation was not recorded.')
  return row
}

function format(
  formatKind: ReasonixFileFormatKind,
  extension: string,
  displayName: string,
  metadataSchema: JsonObject,
): DefaultReasonixFileFormat {
  return {
    formatKind,
    extension,
    displayName,
    schemaVersion: '1.0.0',
    metadataSchema: {
      type: 'object',
      ...metadataSchema,
    },
  }
}

function getString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function getJsonObject(value: unknown): JsonObject | null {
  return isPlainObject(value) ? value : null
}

function isPlainObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hasSignature(payload: JsonObject, explicitSignature: string | null | undefined): boolean {
  if (typeof explicitSignature === 'string' && explicitSignature.trim()) return true
  const payloadSignature = payload.signature
  return typeof payloadSignature === 'string' && payloadSignature.trim().length > 0
}

function summarizePayload(
  payload: JsonObject,
  options: {
    extension: string
    signaturePresent: boolean
    secretRefsForbidden: boolean
  },
): JsonObject {
  const metadata = getJsonObject(payload.metadata) ?? {}
  return {
    formatBasis: 'json',
    extension: options.extension,
    topLevelKeys: Object.keys(payload).sort(),
    requiredFields,
    metadataKeys: Object.keys(metadata).sort(),
    checksumAlgorithm: 'sha256',
    signaturePresent: options.signaturePresent,
    secretRefsForbidden: options.secretRefsForbidden,
  }
}

function findForbiddenSecretReferences(value: unknown, path = '$'): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => findForbiddenSecretReferences(item, `${path}[${index}]`))
  }
  if (!isPlainObject(value)) {
    return typeof value === 'string' && looksLikeSecretReference(value) ? [path] : []
  }

  const findings: string[] = []
  for (const [key, child] of Object.entries(value)) {
    const childPath = `${path}.${key}`
    if (key === 'signature') continue
    if (isForbiddenSecretKey(key)) findings.push(childPath)
    findings.push(...findForbiddenSecretReferences(child, childPath))
  }
  return [...new Set(findings)]
}

function isForbiddenSecretKey(key: string): boolean {
  const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, '')
  return ['secret', 'secretref', 'secretrefs', 'apikey', 'apikeyref', 'credential', 'credentials'].some(
    (token) => normalized.includes(token),
  )
}

function looksLikeSecretReference(value: string): boolean {
  const trimmed = value.trim()
  return (
    /^env:/i.test(trimmed) ||
    /^secret:/i.test(trimmed) ||
    /^vault:/i.test(trimmed) ||
    /^sec_[a-z0-9]/i.test(trimmed) ||
    /\$\{[^}]*(SECRET|API_KEY|CREDENTIAL)[^}]*\}/i.test(trimmed)
  )
}
