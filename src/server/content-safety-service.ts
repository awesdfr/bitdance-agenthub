import { createHash } from 'node:crypto'

import { and, desc, eq, type SQL } from 'drizzle-orm'

import { db, schema } from '@/db/client'
import type {
  ContentSafetyAction,
  ContentSafetyCategory,
  ContentSafetyDecision,
  ContentSafetyLayers,
  ContentSafetyPolicyRow,
  ContentSafetyPolicyStatus,
  ContentSafetyScanRow,
  ContentSafetyScanStatus,
  CopyrightCheckConfig,
  CopyrightCheckRow,
  CopyrightCheckStatus,
  CopyrightOnMatch,
  JsonObject,
  SafetyReviewedContentType,
} from '@/db/schema'
import {
  newContentSafetyPolicyId,
  newContentSafetyScanId,
  newCopyrightCheckId,
} from '@/server/ids'

const DEFAULT_LAYERS: ContentSafetyLayers = {
  keywordFilter: {
    blockedPatterns: [
      'password\\s*=',
      'api[_-]?key\\s*=',
      'secret\\s*=',
      'malware payload',
      'credential dump',
    ],
    piiPatterns: [
      '\\b[\\w.%+-]+@[\\w.-]+\\.[A-Za-z]{2,}\\b',
      '\\b1[3-9]\\d{9}\\b',
      '\\b\\d{17}[0-9Xx]\\b',
      '\\b(?:\\d[ -]*?){13,19}\\b',
    ],
  },
  localClassifier: {
    categories: ['hate', 'adult', 'violence', 'spam', 'self_harm'],
    threshold: 0.55,
  },
  cloudSafetyAPI: {
    provider: 'openai_moderation',
    requiresUserConsent: true,
  },
}

const DEFAULT_COPYRIGHT_CONFIG: CopyrightCheckConfig = {
  codePlagiarism: {
    similarityThreshold: 0.65,
    minMatchLength: 120,
    onMatch: 'warn_with_attribution',
  },
  imageCopyright: {
    checkMetadata: true,
    reverseImageSearch: false,
  },
}

const CLASSIFIER_KEYWORDS: Record<Exclude<ContentSafetyCategory, 'safe' | 'pii' | 'blocked_pattern' | 'cloud_review'>, string[]> = {
  hate: ['hate speech', 'racial slur', 'dehumanize', '仇恨', '歧视'],
  adult: ['porn', 'explicit sexual', 'nude', '色情', '成人视频'],
  violence: ['kill', 'weapon', 'bomb', 'violence', '爆炸', '枪支', '伤害'],
  spam: ['buy now', 'click here', 'limited offer', '加微信', '刷单', '群发'],
  self_harm: ['suicide', 'self harm', 'cut myself', '自杀', '自残', '轻生'],
}

export interface ContentSafetyPolicyArgs {
  name?: string
  layers?: ContentSafetyLayersInput
  onFlag?: ContentSafetyAction
  status?: ContentSafetyPolicyStatus
}

export interface ContentSafetyLayersInput {
  keywordFilter?: Partial<ContentSafetyLayers['keywordFilter']>
  localClassifier?: Partial<ContentSafetyLayers['localClassifier']>
  cloudSafetyAPI?: ContentSafetyLayers['cloudSafetyAPI']
}

export interface ContentSafetyScanArgs {
  policyId?: string | null
  agentProfileId?: string | null
  employeeRunId?: string | null
  artifactId?: string | null
  contentType?: SafetyReviewedContentType
  content: string
  userConsentedToCloudSafety?: boolean
}

export interface CopyrightSourceInput {
  sourceRef: string
  content: string
  license?: string | null
  attribution?: string | null
}

export interface CopyrightCheckArgs {
  scanId?: string | null
  agentProfileId?: string | null
  artifactId?: string | null
  contentType?: SafetyReviewedContentType
  config?: CopyrightCheckConfigInput
  content?: string
  knownSources?: CopyrightSourceInput[]
  imageMetadata?: JsonObject
}

export interface CopyrightCheckConfigInput {
  codePlagiarism?: Partial<CopyrightCheckConfig['codePlagiarism']>
  imageCopyright?: Partial<CopyrightCheckConfig['imageCopyright']>
}

export async function seedContentSafetyPolicies(): Promise<ContentSafetyPolicyRow[]> {
  const existing = await db.query.contentSafetyPolicies.findFirst({
    where: eq(schema.contentSafetyPolicies.name, 'Default local output safety review'),
  })
  if (existing) return [existing]
  return [await createContentSafetyPolicy({
    name: 'Default local output safety review',
    layers: DEFAULT_LAYERS,
    onFlag: 'warn',
    status: 'active',
  })]
}

export async function createContentSafetyPolicy(
  args: ContentSafetyPolicyArgs,
): Promise<ContentSafetyPolicyRow> {
  const now = Date.now()
  const row = {
    id: newContentSafetyPolicyId(),
    name: args.name?.trim() || 'Content safety policy',
    layers: mergeLayers(args.layers),
    onFlag: args.onFlag ?? 'warn',
    status: args.status ?? 'active',
    createdAt: now,
    updatedAt: now,
  } satisfies ContentSafetyPolicyRow
  await db.insert(schema.contentSafetyPolicies).values(row)
  return row
}

export async function listContentSafetyPolicies(args: {
  status?: ContentSafetyPolicyStatus
  onFlag?: ContentSafetyAction
  limit?: number
} = {}): Promise<ContentSafetyPolicyRow[]> {
  const conditions: SQL[] = []
  if (args.status) conditions.push(eq(schema.contentSafetyPolicies.status, args.status))
  if (args.onFlag) conditions.push(eq(schema.contentSafetyPolicies.onFlag, args.onFlag))
  return db.query.contentSafetyPolicies.findMany({
    where: conditions.length ? and(...conditions) : undefined,
    orderBy: [desc(schema.contentSafetyPolicies.updatedAt)],
    limit: args.limit ?? 100,
  })
}

export async function scanContentSafetyOutput(
  args: ContentSafetyScanArgs,
): Promise<ContentSafetyScanRow> {
  const policy = await resolvePolicy(args.policyId)
  const content = args.content ?? ''
  const keywordFindings = scanKeywordLayer(content, policy.layers)
  const classifierFindings = scanLocalClassifier(content, policy.layers)
  const cloudReviewRequired = Boolean(
    policy.layers.cloudSafetyAPI?.requiresUserConsent && !args.userConsentedToCloudSafety,
  )
  const cloudFindings = cloudReviewRequired
    ? [{
        layer: 'cloud_safety_api',
        category: 'cloud_review',
        severity: 'medium',
        message: `${policy.layers.cloudSafetyAPI?.provider ?? 'cloud'} review requires user consent before content leaves the device.`,
      }]
    : []
  const findings = [...keywordFindings, ...classifierFindings, ...cloudFindings]
  const categories = uniqueCategories(findings)
  const decision = decideSafetyAction(policy.onFlag, findings.length, cloudReviewRequired)
  const status = safetyStatusForDecision(decision)
  const row = {
    id: newContentSafetyScanId(),
    policyId: policy.id,
    agentProfileId: normalizeNullable(args.agentProfileId),
    employeeRunId: normalizeNullable(args.employeeRunId),
    artifactId: normalizeNullable(args.artifactId),
    contentType: args.contentType ?? 'text',
    contentHash: hashContent(content),
    inputPreview: preview(content),
    redactedPreview: decision === 'redact'
      ? preview(redactContent(content, policy.layers))
      : '',
    categories,
    findings: findings as JsonObject[],
    cloudReviewRequired,
    decision,
    status,
    createdAt: Date.now(),
  }
  await db.insert(schema.contentSafetyScans).values(row)
  return row
}

export async function listContentSafetyScans(args: {
  policyId?: string
  agentProfileId?: string
  status?: ContentSafetyScanStatus
  limit?: number
} = {}): Promise<ContentSafetyScanRow[]> {
  const conditions: SQL[] = []
  if (args.policyId) conditions.push(eq(schema.contentSafetyScans.policyId, args.policyId))
  if (args.agentProfileId) conditions.push(eq(schema.contentSafetyScans.agentProfileId, args.agentProfileId))
  if (args.status) conditions.push(eq(schema.contentSafetyScans.status, args.status))
  return db.query.contentSafetyScans.findMany({
    where: conditions.length ? and(...conditions) : undefined,
    orderBy: [desc(schema.contentSafetyScans.createdAt)],
    limit: args.limit ?? 100,
  })
}

export async function createCopyrightCheck(
  args: CopyrightCheckArgs,
): Promise<CopyrightCheckRow> {
  const config = mergeCopyrightConfig(args.config)
  const contentType = args.contentType ?? 'code'
  const codeResult = contentType === 'code'
    ? evaluateCodeSimilarity(args.content ?? '', args.knownSources ?? [], config)
    : { similarityScore: 0, matchedSourceRefs: [] as JsonObject[] }
  const imageResult = contentType === 'image'
    ? evaluateImageCopyright(args.imageMetadata ?? {}, config)
    : { metadataFlags: [] as string[], externalSearchRequired: false }
  const status = copyrightStatus({
    hasCodeMatch: codeResult.matchedSourceRefs.length > 0,
    hasMetadataFlags: imageResult.metadataFlags.length > 0,
    externalSearchRequired: imageResult.externalSearchRequired,
    onMatch: config.codePlagiarism.onMatch,
  })
  const decision = copyrightDecision(status, config.codePlagiarism.onMatch)
  const row = {
    id: newCopyrightCheckId(),
    scanId: normalizeNullable(args.scanId),
    agentProfileId: normalizeNullable(args.agentProfileId),
    artifactId: normalizeNullable(args.artifactId),
    contentType,
    config,
    similarityScore: codeResult.similarityScore,
    matchedSourceRefs: codeResult.matchedSourceRefs,
    metadataFlags: imageResult.metadataFlags,
    externalSearchRequired: imageResult.externalSearchRequired,
    decision,
    status,
    createdAt: Date.now(),
  }
  await db.insert(schema.copyrightChecks).values(row)
  return row
}

export async function listCopyrightChecks(args: {
  scanId?: string
  agentProfileId?: string
  status?: CopyrightCheckStatus
  limit?: number
} = {}): Promise<CopyrightCheckRow[]> {
  const conditions: SQL[] = []
  if (args.scanId) conditions.push(eq(schema.copyrightChecks.scanId, args.scanId))
  if (args.agentProfileId) conditions.push(eq(schema.copyrightChecks.agentProfileId, args.agentProfileId))
  if (args.status) conditions.push(eq(schema.copyrightChecks.status, args.status))
  return db.query.copyrightChecks.findMany({
    where: conditions.length ? and(...conditions) : undefined,
    orderBy: [desc(schema.copyrightChecks.createdAt)],
    limit: args.limit ?? 100,
  })
}

async function resolvePolicy(policyId?: string | null): Promise<ContentSafetyPolicyRow> {
  const id = normalizeNullable(policyId)
  if (id) {
    const policy = await db.query.contentSafetyPolicies.findFirst({
      where: eq(schema.contentSafetyPolicies.id, id),
    })
    if (!policy) throw new Error(`Content safety policy not found: ${id}`)
    return policy
  }
  const existing = await db.query.contentSafetyPolicies.findFirst({
    where: eq(schema.contentSafetyPolicies.status, 'active'),
    orderBy: [desc(schema.contentSafetyPolicies.updatedAt)],
  })
  if (existing) return existing
  const [seeded] = await seedContentSafetyPolicies()
  return seeded
}

function scanKeywordLayer(content: string, layers: ContentSafetyLayers): JsonObject[] {
  const findings: JsonObject[] = []
  for (const pattern of layers.keywordFilter.blockedPatterns) {
    for (const match of findMatches(content, pattern)) {
      findings.push({
        layer: 'keyword_filter',
        category: 'blocked_pattern',
        severity: 'high',
        pattern,
        match,
      })
    }
  }
  for (const pattern of layers.keywordFilter.piiPatterns) {
    for (const match of findMatches(content, pattern)) {
      findings.push({
        layer: 'keyword_filter',
        category: 'pii',
        severity: 'medium',
        pattern,
        match,
      })
    }
  }
  return findings
}

function scanLocalClassifier(content: string, layers: ContentSafetyLayers): JsonObject[] {
  const text = content.toLowerCase()
  return layers.localClassifier.categories.flatMap((category) => {
    if (category === 'safe' || category === 'pii' || category === 'blocked_pattern' || category === 'cloud_review') {
      return []
    }
    const matches = CLASSIFIER_KEYWORDS[category].filter((keyword) => text.includes(keyword.toLowerCase()))
    const score = round(Math.min(1, matches.length * 0.45 + (matches.length ? 0.2 : 0)))
    if (score < layers.localClassifier.threshold) return []
    return [{
      layer: 'local_classifier',
      category,
      severity: score > 0.8 ? 'high' : 'medium',
      score,
      matches,
    }]
  })
}

function evaluateCodeSimilarity(
  content: string,
  knownSources: CopyrightSourceInput[],
  config: CopyrightCheckConfig,
): { similarityScore: number; matchedSourceRefs: JsonObject[] } {
  const left = normalizeForSimilarity(content).slice(0, 12000)
  const matches = knownSources.flatMap((source) => {
    const right = normalizeForSimilarity(source.content).slice(0, 12000)
    const match = longestCommonSubstring(left, right)
    const denominator = Math.max(Math.min(left.length, right.length), 1)
    const similarity = round(match.length / denominator)
    if (
      match.length < config.codePlagiarism.minMatchLength ||
      similarity < config.codePlagiarism.similarityThreshold
    ) {
      return []
    }
    return [{
      sourceRef: source.sourceRef,
      license: source.license ?? null,
      attribution: source.attribution ?? null,
      similarity,
      matchedLength: match.length,
      sample: match.sample,
    }]
  }) as JsonObject[]
  const similarityScore = matches.reduce((max, match) => {
    const value = typeof match.similarity === 'number' ? match.similarity : 0
    return Math.max(max, value)
  }, 0)
  return { similarityScore, matchedSourceRefs: matches }
}

function evaluateImageCopyright(
  metadata: JsonObject,
  config: CopyrightCheckConfig,
): { metadataFlags: string[]; externalSearchRequired: boolean } {
  const flags: string[] = []
  if (config.imageCopyright.checkMetadata) {
    const keys = Object.keys(metadata).map((key) => key.toLowerCase())
    const hasCopyright = keys.some((key) => key.includes('copyright') || key.includes('rights'))
    const hasLicense = keys.some((key) => key.includes('license') || key.includes('licence'))
    if (hasCopyright) flags.push('copyright_notice_present')
    if (!hasLicense) flags.push('missing_license_metadata')
    if (!Object.keys(metadata).length) flags.push('metadata_missing')
  }
  return {
    metadataFlags: flags,
    externalSearchRequired: config.imageCopyright.reverseImageSearch,
  }
}

function copyrightStatus(args: {
  hasCodeMatch: boolean
  hasMetadataFlags: boolean
  externalSearchRequired: boolean
  onMatch: CopyrightOnMatch
}): CopyrightCheckStatus {
  if (args.hasCodeMatch) {
    if (args.onMatch === 'block') return 'blocked'
    if (args.onMatch === 'ask_user') return 'needs_user'
    return 'needs_attribution'
  }
  if (args.hasMetadataFlags) return 'needs_attribution'
  if (args.externalSearchRequired) return 'needs_user'
  return 'clear'
}

function copyrightDecision(
  status: CopyrightCheckStatus,
  onMatch: CopyrightOnMatch,
): CopyrightOnMatch | 'allow' {
  if (status === 'clear') return 'allow'
  if (status === 'needs_attribution') return 'warn_with_attribution'
  if (status === 'blocked') return 'block'
  return onMatch === 'ask_user' ? 'ask_user' : 'ask_user'
}

function decideSafetyAction(
  onFlag: ContentSafetyAction,
  findingCount: number,
  cloudReviewRequired: boolean,
): ContentSafetyDecision {
  if (!findingCount) return 'allow'
  if (cloudReviewRequired && onFlag === 'warn') return 'ask_user'
  return onFlag
}

function safetyStatusForDecision(decision: ContentSafetyDecision): ContentSafetyScanStatus {
  if (decision === 'allow') return 'passed'
  if (decision === 'block') return 'blocked'
  if (decision === 'quarantine') return 'quarantined'
  if (decision === 'ask_user') return 'needs_user'
  return 'flagged'
}

function mergeLayers(layers?: ContentSafetyLayersInput): ContentSafetyLayers {
  return {
    keywordFilter: {
      blockedPatterns: layers?.keywordFilter?.blockedPatterns ?? DEFAULT_LAYERS.keywordFilter.blockedPatterns,
      piiPatterns: layers?.keywordFilter?.piiPatterns ?? DEFAULT_LAYERS.keywordFilter.piiPatterns,
    },
    localClassifier: {
      categories: layers?.localClassifier?.categories ?? DEFAULT_LAYERS.localClassifier.categories,
      threshold: layers?.localClassifier?.threshold ?? DEFAULT_LAYERS.localClassifier.threshold,
    },
    cloudSafetyAPI: layers?.cloudSafetyAPI
      ? {
          provider: layers.cloudSafetyAPI.provider,
          requiresUserConsent: true,
        }
      : DEFAULT_LAYERS.cloudSafetyAPI,
  }
}

function mergeCopyrightConfig(config?: CopyrightCheckConfigInput): CopyrightCheckConfig {
  return {
    codePlagiarism: {
      similarityThreshold:
        config?.codePlagiarism?.similarityThreshold ?? DEFAULT_COPYRIGHT_CONFIG.codePlagiarism.similarityThreshold,
      minMatchLength:
        config?.codePlagiarism?.minMatchLength ?? DEFAULT_COPYRIGHT_CONFIG.codePlagiarism.minMatchLength,
      onMatch: config?.codePlagiarism?.onMatch ?? DEFAULT_COPYRIGHT_CONFIG.codePlagiarism.onMatch,
    },
    imageCopyright: {
      checkMetadata:
        config?.imageCopyright?.checkMetadata ?? DEFAULT_COPYRIGHT_CONFIG.imageCopyright.checkMetadata,
      reverseImageSearch:
        config?.imageCopyright?.reverseImageSearch ?? DEFAULT_COPYRIGHT_CONFIG.imageCopyright.reverseImageSearch,
    },
  }
}

function findMatches(content: string, pattern: string): string[] {
  const regex = compilePattern(pattern)
  const matches: string[] = []
  let match: RegExpExecArray | null
  while ((match = regex.exec(content)) && matches.length < 20) {
    matches.push(match[0].slice(0, 120))
    if (match[0].length === 0) regex.lastIndex += 1
  }
  return matches
}

function compilePattern(pattern: string): RegExp {
  try {
    return new RegExp(pattern, 'gi')
  } catch {
    return new RegExp(escapeRegExp(pattern), 'gi')
  }
}

function redactContent(content: string, layers: ContentSafetyLayers): string {
  return [...layers.keywordFilter.blockedPatterns, ...layers.keywordFilter.piiPatterns].reduce(
    (next, pattern) => next.replace(compilePattern(pattern), '[REDACTED]'),
    content,
  )
}

function uniqueCategories(findings: JsonObject[]): ContentSafetyCategory[] {
  const categories = findings
    .map((finding) => finding.category)
    .filter((category): category is ContentSafetyCategory => typeof category === 'string')
  return [...new Set(categories)]
}

function longestCommonSubstring(left: string, right: string): { length: number; sample: string } {
  const previous = new Array(right.length + 1).fill(0)
  const current = new Array(right.length + 1).fill(0)
  let bestLength = 0
  let bestEnd = 0
  for (let i = 1; i <= left.length; i += 1) {
    for (let j = 1; j <= right.length; j += 1) {
      current[j] = left[i - 1] === right[j - 1] ? previous[j - 1] + 1 : 0
      if (current[j] > bestLength) {
        bestLength = current[j]
        bestEnd = i
      }
    }
    previous.splice(0, previous.length, ...current)
    current.fill(0)
  }
  return {
    length: bestLength,
    sample: left.slice(Math.max(0, bestEnd - bestLength), bestEnd).slice(0, 240),
  }
}

function normalizeForSimilarity(value: string): string {
  return value.replace(/\s+/g, ' ').trim().toLowerCase()
}

function normalizeNullable(value: string | null | undefined): string | null {
  const normalized = value?.trim()
  return normalized ? normalized : null
}

function preview(content: string): string {
  return content.slice(0, 500)
}

function hashContent(content: string): string {
  return createHash('sha256').update(content).digest('hex')
}

function escapeRegExp(pattern: string): string {
  return pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000
}
