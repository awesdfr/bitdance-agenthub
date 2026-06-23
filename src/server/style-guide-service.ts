import { and, desc, eq } from 'drizzle-orm'

import { db, schema } from '@/db/client'
import type {
  AgentStyleGuideBindingRow,
  JsonObject,
  StyleGuideRow,
} from '@/db/schema'
import {
  newAgentStyleGuideBindingId,
  newStyleGuideId,
} from '@/server/ids'
import { recordAuditLog } from '@/server/security-service'

export interface CreateStyleGuideArgs {
  name: string
  language?: JsonObject
  code?: JsonObject
  visual?: JsonObject
  outputRules?: JsonObject
  status?: StyleGuideRow['status']
}

export interface BindStyleGuideToAgentArgs {
  agentProfileId: string
  styleGuideId: string
  status?: AgentStyleGuideBindingRow['status']
}

export interface ActiveAgentStyleGuide {
  styleGuide: StyleGuideRow
  binding: AgentStyleGuideBindingRow
}

export interface StyleGuideEvaluationCheck {
  key: string
  label: string
  status: 'passed' | 'failed' | 'skipped'
  details: string
}

export interface StyleGuideEvaluationResult {
  styleGuideId: string | null
  styleGuideName: string | null
  passed: boolean
  checks: StyleGuideEvaluationCheck[]
  violations: string[]
  suggestions: string[]
}

export async function createStyleGuide(args: CreateStyleGuideArgs): Promise<StyleGuideRow> {
  const now = Date.now()
  const row: StyleGuideRow = {
    id: newStyleGuideId(),
    name: args.name.trim(),
    language: args.language ?? {},
    code: args.code ?? {},
    visual: args.visual ?? {},
    outputRules: args.outputRules ?? {},
    status: args.status ?? 'active',
    createdAt: now,
    updatedAt: now,
  }
  if (!row.name) throw new Error('Style guide name is required.')
  await db.insert(schema.styleGuides).values(row)
  await recordAuditLog({
    actorType: 'user',
    action: 'style_guide.create',
    resourceType: 'style_guide',
    resourceId: row.id,
    status: 'allowed',
    riskLevel: 'low',
    message: `Style guide "${row.name}" was created.`,
    metadata: styleGuideContext(row),
  })
  return row
}

export async function listStyleGuides(): Promise<StyleGuideRow[]> {
  return db.query.styleGuides.findMany({
    orderBy: [desc(schema.styleGuides.updatedAt)],
  })
}

export async function getStyleGuide(id: string): Promise<StyleGuideRow | null> {
  return (
    (await db.query.styleGuides.findFirst({
      where: eq(schema.styleGuides.id, id),
    })) ?? null
  )
}

export async function bindStyleGuideToAgent(
  args: BindStyleGuideToAgentArgs,
): Promise<AgentStyleGuideBindingRow> {
  const [agent, styleGuide] = await Promise.all([
    db.query.agentProfiles.findFirst({
      where: eq(schema.agentProfiles.id, args.agentProfileId),
    }),
    getStyleGuide(args.styleGuideId),
  ])
  if (!agent) throw new Error(`Agent profile not found: ${args.agentProfileId}`)
  if (!styleGuide) throw new Error(`Style guide not found: ${args.styleGuideId}`)
  const now = Date.now()
  await db
    .update(schema.agentStyleGuideBindings)
    .set({ status: 'superseded', updatedAt: now })
    .where(
      and(
        eq(schema.agentStyleGuideBindings.agentProfileId, agent.id),
        eq(schema.agentStyleGuideBindings.status, 'active'),
      ),
    )

  const row: AgentStyleGuideBindingRow = {
    id: newAgentStyleGuideBindingId(),
    agentProfileId: agent.id,
    styleGuideId: styleGuide.id,
    status: args.status ?? 'active',
    createdAt: now,
    updatedAt: now,
  }
  await db.insert(schema.agentStyleGuideBindings).values(row)
  await recordAuditLog({
    actorType: 'user',
    action: 'style_guide.bind_agent',
    resourceType: 'agent_style_guide_binding',
    resourceId: row.id,
    status: 'allowed',
    riskLevel: 'low',
    message: `Agent "${agent.name}" now uses style guide "${styleGuide.name}".`,
    metadata: {
      agentProfileId: agent.id,
      styleGuideId: styleGuide.id,
      bindingStatus: row.status,
    },
  })
  return row
}

export async function listAgentStyleGuideBindings(args: {
  agentProfileId?: string | null
  styleGuideId?: string | null
} = {}): Promise<AgentStyleGuideBindingRow[]> {
  const agentProfileId = normalizeNullable(args.agentProfileId)
  const styleGuideId = normalizeNullable(args.styleGuideId)
  const where =
    agentProfileId && styleGuideId
      ? and(
          eq(schema.agentStyleGuideBindings.agentProfileId, agentProfileId),
          eq(schema.agentStyleGuideBindings.styleGuideId, styleGuideId),
        )
      : agentProfileId
        ? eq(schema.agentStyleGuideBindings.agentProfileId, agentProfileId)
        : styleGuideId
          ? eq(schema.agentStyleGuideBindings.styleGuideId, styleGuideId)
          : undefined

  return db.query.agentStyleGuideBindings.findMany({
    where,
    orderBy: [desc(schema.agentStyleGuideBindings.updatedAt)],
  })
}

export async function getActiveStyleGuideForAgent(
  agentProfileId: string,
): Promise<ActiveAgentStyleGuide | null> {
  const binding = await db.query.agentStyleGuideBindings.findFirst({
    where: and(
      eq(schema.agentStyleGuideBindings.agentProfileId, agentProfileId),
      eq(schema.agentStyleGuideBindings.status, 'active'),
    ),
    orderBy: [desc(schema.agentStyleGuideBindings.updatedAt)],
  })
  if (!binding) return null
  const styleGuide = await getStyleGuide(binding.styleGuideId)
  if (!styleGuide || styleGuide.status !== 'active') return null
  return { styleGuide, binding }
}

export async function evaluateStyleGuideCompliance(args: {
  agentProfileId?: string | null
  styleGuideId?: string | null
  sample: string | JsonObject
}): Promise<StyleGuideEvaluationResult> {
  const styleGuide = await resolveStyleGuide(args)
  if (!styleGuide) {
    return {
      styleGuideId: null,
      styleGuideName: null,
      passed: true,
      checks: [
        {
          key: 'style_guide',
          label: 'Style guide binding',
          status: 'skipped',
          details: 'No active style guide was configured for this Agent or request.',
        },
      ],
      violations: [],
      suggestions: [],
    }
  }

  const sampleText = stringifySample(args.sample)
  const checks = [
    ...evaluateLanguage(styleGuide, sampleText),
    ...evaluateCode(styleGuide, sampleText),
    ...evaluateVisual(styleGuide, sampleText),
    ...evaluateOutputRules(styleGuide, args.sample, sampleText),
  ]
  const violations = checks
    .filter((check) => check.status === 'failed')
    .map((check) => `${check.label}: ${check.details}`)
  const suggestions = buildSuggestions(styleGuide, violations)
  return {
    styleGuideId: styleGuide.id,
    styleGuideName: styleGuide.name,
    passed: violations.length === 0,
    checks,
    violations,
    suggestions,
  }
}

export function styleGuideContext(styleGuide: StyleGuideRow): JsonObject {
  return {
    id: styleGuide.id,
    name: styleGuide.name,
    language: styleGuide.language,
    code: styleGuide.code,
    visual: styleGuide.visual,
    outputRules: styleGuide.outputRules,
  }
}

async function resolveStyleGuide(args: {
  agentProfileId?: string | null
  styleGuideId?: string | null
}): Promise<StyleGuideRow | null> {
  const explicitStyleGuideId = normalizeNullable(args.styleGuideId)
  if (explicitStyleGuideId) {
    const styleGuide = await getStyleGuide(explicitStyleGuideId)
    return styleGuide?.status === 'active' ? styleGuide : null
  }
  const agentProfileId = normalizeNullable(args.agentProfileId)
  if (!agentProfileId) return null
  return (await getActiveStyleGuideForAgent(agentProfileId))?.styleGuide ?? null
}

function evaluateLanguage(styleGuide: StyleGuideRow, sampleText: string): StyleGuideEvaluationCheck[] {
  const language = styleGuide.language
  const tone = getString(language, 'tone')
  const forbiddenWords = getStringArray(language, 'forbiddenWords')
  const preferredTerms = getStringRecord(language, 'preferredTerms')
  const sentenceLength = getString(language, 'sentenceLength') ?? 'varied'
  const lower = sampleText.toLowerCase()
  const forbiddenHits = forbiddenWords.filter((word) => lower.includes(word.toLowerCase()))
  const preferredViolations = Object.entries(preferredTerms)
    .filter(([from, to]) => from.trim() && to.trim() && from !== to)
    .filter(([from]) => lower.includes(from.toLowerCase()))
    .map(([from, to]) => `${from} -> ${to}`)
  const sentenceStats = analyzeSentences(sampleText)
  const sentenceLengthFailed =
    sentenceLength === 'short'
      ? sentenceStats.averageWords > 18 || sentenceStats.averageChars > 110
      : sentenceLength === 'medium'
        ? sentenceStats.averageWords > 32 || sentenceStats.averageChars > 180
        : false

  return [
    {
      key: 'language.tone',
      label: 'Tone',
      status: tone ? 'passed' : 'skipped',
      details: tone ? `Expected tone is ${tone}.` : 'No tone rule configured.',
    },
    {
      key: 'language.forbiddenWords',
      label: 'Forbidden words',
      status: forbiddenHits.length ? 'failed' : forbiddenWords.length ? 'passed' : 'skipped',
      details: forbiddenHits.length
        ? `Found forbidden terms: ${forbiddenHits.join(', ')}.`
        : forbiddenWords.length
          ? 'No forbidden terms were found.'
          : 'No forbidden terms configured.',
    },
    {
      key: 'language.preferredTerms',
      label: 'Preferred terms',
      status: preferredViolations.length ? 'failed' : Object.keys(preferredTerms).length ? 'passed' : 'skipped',
      details: preferredViolations.length
        ? `Use preferred terms: ${preferredViolations.join(', ')}.`
        : Object.keys(preferredTerms).length
          ? 'Preferred terminology is respected.'
          : 'No preferred terms configured.',
    },
    {
      key: 'language.sentenceLength',
      label: 'Sentence length',
      status: sentenceLengthFailed ? 'failed' : sentenceStats.count ? 'passed' : 'skipped',
      details: sentenceStats.count
        ? `${sentenceStats.count} sentences average ${sentenceStats.averageWords.toFixed(1)} words and ${sentenceStats.averageChars.toFixed(1)} chars.`
        : 'No natural-language sentence was detected.',
    },
  ]
}

function evaluateCode(styleGuide: StyleGuideRow, sampleText: string): StyleGuideEvaluationCheck[] {
  const code = styleGuide.code
  if (!looksLikeCode(sampleText)) {
    return [
      {
        key: 'code.detected',
        label: 'Code style',
        status: 'skipped',
        details: 'No code-like output was detected.',
      },
    ]
  }

  const indentStyle = getString(code, 'indentStyle') ?? 'space'
  const indentSize = getNumber(code, 'indentSize') ?? 2
  const quotes = getString(code, 'quotes') ?? 'single'
  const semicolons = getBoolean(code, 'semicolons') ?? false
  const maxLineLength = getNumber(code, 'maxLineLength') ?? 100
  const namingConvention = getString(code, 'namingConvention') ?? 'camelCase'
  const lines = sampleText.split(/\r?\n/)
  const indentedLines = lines.filter((line) => /^\s+\S/.test(line))
  const badIndentLines = indentedLines.filter((line) => {
    const leading = line.match(/^\s+/)?.[0] ?? ''
    if (indentStyle === 'tab') return leading.includes(' ')
    return leading.includes('\t') || leading.length % indentSize !== 0
  })
  const tooLongLines = lines.filter((line) => line.length > maxLineLength)
  const singleQuotes = countMatches(sampleText, /'/g)
  const doubleQuotes = countMatches(sampleText, /"/g)
  const quoteFailed = quotes === 'single' ? doubleQuotes > singleQuotes : singleQuotes > doubleQuotes
  const codeLines = lines.filter((line) => /\b(const|let|return|import|export|type|interface)\b/.test(line))
  const semicolonLines = codeLines.filter((line) => line.trim().endsWith(';'))
  const semicolonFailed =
    codeLines.length > 0 && (semicolons ? semicolonLines.length < Math.ceil(codeLines.length / 2) : semicolonLines.length > Math.ceil(codeLines.length / 2))
  const namingViolations = extractDeclaredNames(sampleText).filter((name) =>
    !matchesNamingConvention(name, namingConvention),
  )

  return [
    {
      key: 'code.indent',
      label: 'Indentation',
      status: badIndentLines.length ? 'failed' : 'passed',
      details: badIndentLines.length
        ? `${badIndentLines.length} indented lines do not match ${indentStyle} indentation.`
        : `${indentStyle} indentation with size ${indentSize} is respected.`,
    },
    {
      key: 'code.quotes',
      label: 'Quotes',
      status: quoteFailed ? 'failed' : 'passed',
      details: quoteFailed
        ? `Expected ${quotes} quotes but detected more ${quotes === 'single' ? 'double' : 'single'} quote usage.`
        : `Quote style is compatible with ${quotes}.`,
    },
    {
      key: 'code.semicolons',
      label: 'Semicolons',
      status: semicolonFailed ? 'failed' : 'passed',
      details: semicolonFailed
        ? `Semicolon usage does not match semicolons=${semicolons}.`
        : `Semicolon usage matches semicolons=${semicolons}.`,
    },
    {
      key: 'code.maxLineLength',
      label: 'Line length',
      status: tooLongLines.length ? 'failed' : 'passed',
      details: tooLongLines.length
        ? `${tooLongLines.length} lines exceed ${maxLineLength} characters.`
        : `All lines are within ${maxLineLength} characters.`,
    },
    {
      key: 'code.naming',
      label: 'Naming convention',
      status: namingViolations.length ? 'failed' : 'passed',
      details: namingViolations.length
        ? `Names do not match ${namingConvention}: ${namingViolations.slice(0, 5).join(', ')}.`
        : `Declared names match ${namingConvention}.`,
    },
  ]
}

function evaluateVisual(styleGuide: StyleGuideRow, sampleText: string): StyleGuideEvaluationCheck[] {
  const visual = styleGuide.visual
  const palette = getStringArray(visual, 'colorPalette').map((color) => color.toLowerCase())
  const fontFamily = getString(visual, 'fontFamily')
  const detectedColors = [...new Set((sampleText.match(/#[0-9a-fA-F]{3,8}\b/g) ?? []).map((color) => color.toLowerCase()))]
  const offPaletteColors = detectedColors.filter((color) => !palette.includes(color))
  const declaresFont = /font-family/i.test(sampleText)
  const hasExpectedFont = fontFamily ? sampleText.toLowerCase().includes(fontFamily.toLowerCase()) : false

  return [
    {
      key: 'visual.colorPalette',
      label: 'Visual palette',
      status: offPaletteColors.length ? 'failed' : detectedColors.length && palette.length ? 'passed' : 'skipped',
      details: offPaletteColors.length
        ? `Detected colors outside palette: ${offPaletteColors.join(', ')}.`
        : detectedColors.length && palette.length
          ? 'Detected colors match the configured palette.'
          : 'No color palette comparison was needed.',
    },
    {
      key: 'visual.fontFamily',
      label: 'Font family',
      status: declaresFont && fontFamily && !hasExpectedFont ? 'failed' : fontFamily ? 'passed' : 'skipped',
      details: declaresFont && fontFamily && !hasExpectedFont
        ? `Expected font family ${fontFamily}.`
        : fontFamily
          ? `Font family rule is ${fontFamily}.`
          : 'No font family rule configured.',
    },
  ]
}

function evaluateOutputRules(
  styleGuide: StyleGuideRow,
  sample: string | JsonObject,
  sampleText: string,
): StyleGuideEvaluationCheck[] {
  const rules = styleGuide.outputRules
  const requiredSections = getStringArray(rules, 'requiredSections')
  const bannedPatterns = getStringArray(rules, 'bannedPatterns')
  const requiredMetadataKeys = getStringArray(rules, 'requiredMetadataKeys')
  const missingSections = requiredSections.filter((section) => !sampleText.includes(section))
  const bannedHits = bannedPatterns.filter((pattern) => sampleText.includes(pattern))
  const sampleObject = typeof sample === 'string' ? null : sample
  const missingMetadataKeys = sampleObject
    ? requiredMetadataKeys.filter((key) => !(key in sampleObject))
    : requiredMetadataKeys

  return [
    {
      key: 'output.requiredSections',
      label: 'Required sections',
      status: missingSections.length ? 'failed' : requiredSections.length ? 'passed' : 'skipped',
      details: missingSections.length
        ? `Missing sections: ${missingSections.join(', ')}.`
        : requiredSections.length
          ? 'All required sections are present.'
          : 'No required sections configured.',
    },
    {
      key: 'output.bannedPatterns',
      label: 'Banned patterns',
      status: bannedHits.length ? 'failed' : bannedPatterns.length ? 'passed' : 'skipped',
      details: bannedHits.length
        ? `Found banned patterns: ${bannedHits.join(', ')}.`
        : bannedPatterns.length
          ? 'No banned patterns were found.'
          : 'No banned patterns configured.',
    },
    {
      key: 'output.requiredMetadataKeys',
      label: 'Required metadata keys',
      status: missingMetadataKeys.length ? 'failed' : requiredMetadataKeys.length ? 'passed' : 'skipped',
      details: missingMetadataKeys.length
        ? `Missing metadata keys: ${missingMetadataKeys.join(', ')}.`
        : requiredMetadataKeys.length
          ? 'All required metadata keys are present.'
          : 'No required metadata keys configured.',
    },
  ]
}

function buildSuggestions(styleGuide: StyleGuideRow, violations: string[]): string[] {
  if (violations.length === 0) return ['Output matches the active Agent style guide.']
  const preferredTerms = getStringRecord(styleGuide.language, 'preferredTerms')
  return [
    'Revise the output before handing it to downstream artifact executors.',
    ...Object.entries(preferredTerms).map(([from, to]) => `Replace "${from}" with "${to}".`),
  ].slice(0, 8)
}

function stringifySample(sample: string | JsonObject): string {
  return typeof sample === 'string' ? sample : JSON.stringify(sample, null, 2)
}

function analyzeSentences(sampleText: string): { count: number; averageWords: number; averageChars: number } {
  const sentences = sampleText
    .split(/[.!?。！？]+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 0)
  if (sentences.length === 0) return { count: 0, averageWords: 0, averageChars: 0 }
  const words = sentences.map((sentence) => {
    const tokens = sentence.split(/\s+/).filter(Boolean)
    return tokens.length > 1 ? tokens.length : Math.max(1, Math.ceil(sentence.length / 6))
  })
  const chars = sentences.map((sentence) => sentence.length)
  return {
    count: sentences.length,
    averageWords: average(words),
    averageChars: average(chars),
  }
}

function looksLikeCode(sampleText: string): boolean {
  return /\b(function|const|let|class|interface|type|import|export|return)\b/.test(sampleText) ||
    /(?:;|=>)\s*$/.test(sampleText)
}

function countMatches(value: string, pattern: RegExp): number {
  return value.match(pattern)?.length ?? 0
}

function extractDeclaredNames(sampleText: string): string[] {
  const names = new Set<string>()
  for (const match of sampleText.matchAll(/\b(?:const|let|var|function|class|interface|type)\s+([A-Za-z_][A-Za-z0-9_]*)/g)) {
    names.add(match[1])
  }
  return [...names]
}

function matchesNamingConvention(name: string, convention: string): boolean {
  if (convention === 'PascalCase') return /^[A-Z][A-Za-z0-9]*$/.test(name)
  if (convention === 'snake_case') return /^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/.test(name)
  return /^[a-z][A-Za-z0-9]*$/.test(name)
}

function average(values: number[]): number {
  if (values.length === 0) return 0
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

function getString(obj: JsonObject, key: string): string | null {
  const value = obj[key]
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function getStringArray(obj: JsonObject, key: string): string[] {
  const value = obj[key]
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    : []
}

function getStringRecord(obj: JsonObject, key: string): Record<string, string> {
  const value = obj[key]
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string',
    ),
  )
}

function getNumber(obj: JsonObject, key: string): number | null {
  const value = obj[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function getBoolean(obj: JsonObject, key: string): boolean | null {
  const value = obj[key]
  return typeof value === 'boolean' ? value : null
}

function normalizeNullable(value: string | null | undefined): string | null {
  const trimmed = value?.trim()
  return trimmed ? trimmed : null
}
