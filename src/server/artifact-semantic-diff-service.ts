import { desc, eq, or } from 'drizzle-orm'

import { db, schema } from '@/db/client'
import type {
  ArtifactRow,
  ArtifactSemanticDiffRow,
  JsonObject,
  SemanticDiffSemanticChange,
  SemanticDiffStructuralChange,
} from '@/db/schema'
import { newArtifactSemanticDiffId } from '@/server/ids'
import { recordAuditLog } from '@/server/security-service'

export interface CompareArtifactSemanticDiffArgs {
  artifactV1Id: string
  artifactV2Id: string
}

export async function compareArtifactSemanticDiff(
  args: CompareArtifactSemanticDiffArgs,
): Promise<ArtifactSemanticDiffRow> {
  if (args.artifactV1Id === args.artifactV2Id) {
    throw new Error('Semantic diff requires two different artifact versions.')
  }
  const [artifactV1, artifactV2] = await Promise.all([
    getRequiredArtifact(args.artifactV1Id),
    getRequiredArtifact(args.artifactV2Id),
  ])
  const structuralChange = buildStructuralChange(artifactV1, artifactV2)
  const semanticChanges = buildSemanticChanges(artifactV1, artifactV2, structuralChange)
  const risks = buildRisks(artifactV1, artifactV2, structuralChange, semanticChanges)
  const row: ArtifactSemanticDiffRow = {
    id: newArtifactSemanticDiffId(),
    artifactV1Id: artifactV1.id,
    artifactV2Id: artifactV2.id,
    structuralChanges: [structuralChange],
    semanticChanges,
    summary: summarizeDiff(artifactV1, artifactV2, structuralChange, semanticChanges),
    risks,
    createdAt: Date.now(),
  }
  await db.insert(schema.artifactSemanticDiffs).values(row)
  await recordAuditLog({
    actorType: 'system',
    action: 'artifact_semantic_diff.compare',
    resourceType: 'artifact_semantic_diff',
    resourceId: row.id,
    status: risks.some((risk) => /security|permission|deletion/i.test(risk)) ? 'blocked' : 'allowed',
    riskLevel: semanticChanges.some((change) => change.impact === 'high') ? 'high' : 'low',
    message: row.summary,
    metadata: semanticDiffSnapshot(row),
  })
  return row
}

export async function listArtifactSemanticDiffs(args: {
  artifactId?: string
  limit?: number
} = {}): Promise<ArtifactSemanticDiffRow[]> {
  return db.query.artifactSemanticDiffs.findMany({
    where: args.artifactId
      ? or(
          eq(schema.artifactSemanticDiffs.artifactV1Id, args.artifactId),
          eq(schema.artifactSemanticDiffs.artifactV2Id, args.artifactId),
        )
      : undefined,
    orderBy: [desc(schema.artifactSemanticDiffs.createdAt)],
    limit: Math.min(Math.max(args.limit ?? 100, 1), 300),
  })
}

async function getRequiredArtifact(id: string): Promise<ArtifactRow> {
  const row = await db.query.artifacts.findFirst({ where: eq(schema.artifacts.id, id) })
  if (!row) throw new Error(`Artifact not found: ${id}`)
  return row
}

function buildStructuralChange(
  artifactV1: ArtifactRow,
  artifactV2: ArtifactRow,
): SemanticDiffStructuralChange {
  const oldSections = extractSections(artifactV1)
  const newSections = extractSections(artifactV2)
  const oldKeys = new Set(oldSections.keys())
  const newKeys = new Set(newSections.keys())
  const added = Array.from(newKeys).filter((key) => !oldKeys.has(key)).sort()
  const removed = Array.from(oldKeys).filter((key) => !newKeys.has(key)).sort()
  const modified = Array.from(newKeys)
    .filter((key) => oldKeys.has(key) && oldSections.get(key) !== newSections.get(key))
    .sort()
  const moved = detectMovedSections(oldSections, newSections, added, removed)
  return { added, removed, modified, moved }
}

function extractSections(artifact: ArtifactRow): Map<string, string> {
  const content = artifact.content as Record<string, unknown> & { type?: string }
  if (content.type === 'document') {
    return documentSections(readString(content, 'content') ?? '')
  }
  if (content.type === 'web_app') {
    const files = isObject(content.files) ? content.files : {}
    return new Map(Object.entries(files).map(([path, value]) => [`file:${path}`, String(value)]))
  }
  if (content.type === 'diagram') {
    return new Map([['diagram:source', readString(content, 'source') ?? '']])
  }
  if (content.type === 'ppt') {
    const slides = Array.isArray(content.slides) ? content.slides : []
    return new Map(slides.map((slide: unknown, index: number) => [`slide:${index + 1}`, stableStringify(slide)]))
  }
  if (content.type === 'code_file') {
    return new Map([
      ['code_file:workspacePath', readString(content, 'workspacePath') ?? ''],
      ['code_file:language', readString(content, 'language') ?? ''],
      ['code_file:checksum', readString(content, 'checksum') ?? ''],
    ])
  }
  return new Map([['artifact:content', stableStringify(content)]])
}

function documentSections(markdown: string): Map<string, string> {
  const sections = new Map<string, string>()
  let current = 'document:introduction'
  let buffer: string[] = []
  const flush = () => {
    sections.set(current, buffer.join('\n').trim())
    buffer = []
  }
  for (const line of markdown.split(/\r?\n/)) {
    const heading = /^(#{1,6})\s+(.+?)\s*$/.exec(line)
    if (heading) {
      flush()
      current = `heading:${heading[2].trim()}`
      continue
    }
    buffer.push(line)
  }
  flush()
  return new Map(Array.from(sections.entries()).filter(([, value]) => value.length > 0))
}

function detectMovedSections(
  oldSections: Map<string, string>,
  newSections: Map<string, string>,
  added: string[],
  removed: string[],
): string[] {
  const moved: string[] = []
  for (const oldKey of removed) {
    const oldValue = oldSections.get(oldKey)
    if (!oldValue) continue
    const newKey = added.find((candidate) => newSections.get(candidate) === oldValue)
    if (newKey) moved.push(`${oldKey} -> ${newKey}`)
  }
  return moved.sort()
}

function buildSemanticChanges(
  artifactV1: ArtifactRow,
  artifactV2: ArtifactRow,
  structuralChange: SemanticDiffStructuralChange,
): SemanticDiffSemanticChange[] {
  const oldSections = extractSections(artifactV1)
  const newSections = extractSections(artifactV2)
  const changes: SemanticDiffSemanticChange[] = []
  for (const key of structuralChange.added) {
    changes.push(describeSectionChange('added', key, '', newSections.get(key) ?? ''))
  }
  for (const key of structuralChange.removed) {
    changes.push(describeSectionChange('removed', key, oldSections.get(key) ?? '', ''))
  }
  for (const key of structuralChange.modified) {
    changes.push(describeSectionChange('modified', key, oldSections.get(key) ?? '', newSections.get(key) ?? ''))
  }
  if (artifactV1.type !== artifactV2.type) {
    changes.unshift({
      description: `Artifact type changed from ${artifactV1.type} to ${artifactV2.type}.`,
      impact: 'high',
      relatedSections: ['artifact:type'],
    })
  }
  return dedupeSemanticChanges(changes).slice(0, 25)
}

function describeSectionChange(
  kind: 'added' | 'removed' | 'modified',
  section: string,
  before: string,
  after: string,
): SemanticDiffSemanticChange {
  const text = `${before}\n${after}`
  const category = classifyText(text)
  const verb = kind === 'added' ? 'Added' : kind === 'removed' ? 'Removed' : 'Changed'
  return {
    description: `${verb} ${category.description} in ${section}.`,
    impact: kind === 'removed' && category.impact !== 'low' ? 'high' : category.impact,
    relatedSections: [section],
  }
}

function classifyText(text: string): { description: string; impact: 'low' | 'medium' | 'high' } {
  if (/xss|csrf|sanitize|escape|permission|auth|login|role|secret|token/i.test(text)) {
    return { description: 'security, permission, or validation behavior', impact: 'high' }
  }
  if (/query|cache|index|performance|latency|timeout|retry/i.test(text)) {
    return { description: 'performance or reliability behavior', impact: 'medium' }
  }
  if (/api|schema|contract|field|input|output/i.test(text)) {
    return { description: 'interface or data-contract behavior', impact: 'medium' }
  }
  return { description: 'content or presentation details', impact: 'low' }
}

function buildRisks(
  artifactV1: ArtifactRow,
  artifactV2: ArtifactRow,
  structuralChange: SemanticDiffStructuralChange,
  semanticChanges: SemanticDiffSemanticChange[],
): string[] {
  const risks = new Set<string>()
  if (artifactV1.type !== artifactV2.type) risks.add('Artifact type changed; downstream consumers may break.')
  if (structuralChange.removed.length > 0) risks.add('Deleted sections should be reviewed for lost functionality.')
  if (semanticChanges.some((change) => change.impact === 'high')) {
    risks.add('High-impact semantic changes affect security, permission, validation, or compatibility.')
  }
  if (structuralChange.modified.length > 5) risks.add('Many modified sections increase review surface area.')
  return Array.from(risks)
}

function summarizeDiff(
  artifactV1: ArtifactRow,
  artifactV2: ArtifactRow,
  structuralChange: SemanticDiffStructuralChange,
  semanticChanges: SemanticDiffSemanticChange[],
): string {
  const high = semanticChanges.filter((change) => change.impact === 'high').length
  return [
    `Compared ${artifactV1.title} v${artifactV1.version} to ${artifactV2.title} v${artifactV2.version}.`,
    `Structural changes: ${structuralChange.added.length} added, ${structuralChange.removed.length} removed, ${structuralChange.modified.length} modified, ${structuralChange.moved.length} moved.`,
    high > 0 ? `${high} high-impact semantic change(s) need review.` : 'No high-impact semantic change detected.',
  ].join(' ')
}

function dedupeSemanticChanges(changes: SemanticDiffSemanticChange[]): SemanticDiffSemanticChange[] {
  const seen = new Set<string>()
  return changes.filter((change) => {
    const key = `${change.description}|${change.relatedSections.join(',')}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function readString(obj: Record<string, unknown>, key: string): string | null {
  const value = obj[key]
  return typeof value === 'string' ? value : null
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function stableStringify(value: unknown): string {
  if (!isObject(value)) return JSON.stringify(value) ?? 'undefined'
  const sorted = Object.keys(value)
    .sort()
    .reduce<Record<string, unknown>>((acc, key) => {
      acc[key] = value[key]
      return acc
    }, {})
  return JSON.stringify(sorted)
}

function semanticDiffSnapshot(row: ArtifactSemanticDiffRow): JsonObject {
  return {
    artifactV1Id: row.artifactV1Id,
    artifactV2Id: row.artifactV2Id,
    structuralChanges: row.structuralChanges,
    semanticChanges: row.semanticChanges,
    risks: row.risks,
  }
}
