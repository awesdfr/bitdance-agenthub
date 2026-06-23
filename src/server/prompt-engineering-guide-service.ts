import { and, asc, eq } from 'drizzle-orm'

import { db, schema } from '@/db/client'
import type {
  JsonObject,
  OpenSourceGovernanceStatus,
  PromptAntiPatternRuleKey,
  PromptAntiPatternRuleRow,
  PromptEngineeringGuideRow,
  RiskLevel,
} from '@/db/schema'
import {
  newPromptAntiPatternRuleId,
  newPromptEngineeringGuideId,
} from '@/server/ids'
import { recordAuditLog } from '@/server/security-service'

export interface CreatePromptEngineeringGuideArgs {
  name: string
  description?: string
  recommendedSections: string[]
  requiredPlaceholders?: string[]
  maxTokens?: number
  examplePolicy?: string
  mustRulePhrase?: string
  status?: OpenSourceGovernanceStatus
}

export interface CreatePromptAntiPatternRuleArgs {
  guideId: string
  ruleKey: PromptAntiPatternRuleKey
  description?: string
  severity?: RiskLevel
  detectorHint?: string
  status?: OpenSourceGovernanceStatus
}

export interface PromptGuideEvaluation {
  guide: PromptEngineeringGuideRow
  tokenEstimate: number
  passed: boolean
  findings: Array<{
    ruleKey: PromptAntiPatternRuleKey | 'missing_section' | 'missing_placeholder'
    severity: RiskLevel
    message: string
  }>
}

const recommendedSections = [
  'role_definition',
  'behavior_rules',
  'capabilities',
  'workflow',
  'output_spec',
  '{{MEMORY_CONTEXT}}',
  '{{TASK_DESCRIPTION}}',
]

const antiPatternRules: Array<Omit<CreatePromptAntiPatternRuleArgs, 'guideId'>> = [
  {
    ruleKey: 'too_long',
    description: 'System prompt should stay below 3000 estimated tokens.',
    severity: 'high',
    detectorHint: 'maxTokens',
  },
  {
    ruleKey: 'contradictory_instruction',
    description: 'Avoid contradictory instructions such as always/never on the same action.',
    severity: 'high',
    detectorHint: 'always_never_conflict',
  },
  {
    ruleKey: 'vague_language',
    description: 'Avoid vague terms such as try, maybe, roughly, and as needed.',
    severity: 'medium',
    detectorHint: 'vague_words',
  },
  {
    ruleKey: 'internal_jargon',
    description: 'Avoid leaking internal implementation jargon into Agent-facing prompts.',
    severity: 'medium',
    detectorHint: 'internal_terms',
  },
  {
    ruleKey: 'missing_examples',
    description: 'Prefer specific examples plus positive/negative contrast.',
    severity: 'medium',
    detectorHint: 'examples',
  },
  {
    ruleKey: 'missing_must_rules',
    description: 'Use explicit must-rules such as "你必须" for hard requirements.',
    severity: 'low',
    detectorHint: 'must_phrase',
  },
]

export async function createPromptEngineeringGuide(
  args: CreatePromptEngineeringGuideArgs,
): Promise<PromptEngineeringGuideRow> {
  const now = Date.now()
  const row: PromptEngineeringGuideRow = {
    id: newPromptEngineeringGuideId(),
    name: args.name.trim(),
    description: args.description?.trim() ?? '',
    recommendedSections: args.recommendedSections.map((item) => item.trim()).filter(Boolean),
    requiredPlaceholders: args.requiredPlaceholders ?? [],
    maxTokens: args.maxTokens ?? 3000,
    examplePolicy: args.examplePolicy?.trim() ?? 'specific_examples_with_positive_negative_pairs',
    mustRulePhrase: args.mustRulePhrase?.trim() || '你必须',
    status: args.status ?? 'active',
    createdAt: now,
    updatedAt: now,
  }
  await db.insert(schema.promptEngineeringGuides).values(row)
  await recordAuditLog({
    actorType: 'system',
    action: 'prompt_guide.create',
    resourceType: 'prompt_engineering_guide',
    resourceId: row.id,
    status: 'allowed',
    riskLevel: 'low',
    message: `${row.name} prompt engineering guide created.`,
    metadata: guideSnapshot(row),
  })
  return row
}

export async function createPromptAntiPatternRule(
  args: CreatePromptAntiPatternRuleArgs,
): Promise<PromptAntiPatternRuleRow> {
  const now = Date.now()
  const row: PromptAntiPatternRuleRow = {
    id: newPromptAntiPatternRuleId(),
    guideId: args.guideId,
    ruleKey: args.ruleKey,
    description: args.description?.trim() ?? '',
    severity: args.severity ?? 'medium',
    detectorHint: args.detectorHint?.trim() ?? '',
    status: args.status ?? 'active',
    createdAt: now,
    updatedAt: now,
  }
  await db.insert(schema.promptAntiPatternRules).values(row)
  return row
}

export async function listPromptEngineeringGuides(args: {
  status?: OpenSourceGovernanceStatus
  limit?: number
} = {}): Promise<PromptEngineeringGuideRow[]> {
  return db.query.promptEngineeringGuides.findMany({
    where: args.status ? eq(schema.promptEngineeringGuides.status, args.status) : undefined,
    orderBy: [asc(schema.promptEngineeringGuides.name)],
    limit: Math.min(Math.max(args.limit ?? 50, 1), 200),
  })
}

export async function listPromptAntiPatternRules(args: {
  guideId?: string
  status?: OpenSourceGovernanceStatus
  limit?: number
} = {}): Promise<PromptAntiPatternRuleRow[]> {
  const filters = [
    args.guideId ? eq(schema.promptAntiPatternRules.guideId, args.guideId) : undefined,
    args.status ? eq(schema.promptAntiPatternRules.status, args.status) : undefined,
  ].filter(Boolean)
  return db.query.promptAntiPatternRules.findMany({
    where: filters.length > 0 ? and(...filters) : undefined,
    orderBy: [asc(schema.promptAntiPatternRules.ruleKey)],
    limit: Math.min(Math.max(args.limit ?? 50, 1), 200),
  })
}

export async function seedPromptEngineeringGuide(): Promise<{
  guide: PromptEngineeringGuideRow
  rules: PromptAntiPatternRuleRow[]
}> {
  let guide = await db.query.promptEngineeringGuides.findFirst({
    where: eq(schema.promptEngineeringGuides.name, 'System Prompt Engineering Guide'),
  })
  if (!guide) {
    guide = await createPromptEngineeringGuide({
      name: 'System Prompt Engineering Guide',
      description: 'Recommended structure and anti-pattern checks for employee Agent system prompts.',
      recommendedSections,
      requiredPlaceholders: ['{{MEMORY_CONTEXT}}', '{{TASK_DESCRIPTION}}'],
      maxTokens: 3000,
      examplePolicy: 'specific_examples_with_positive_negative_pairs',
      mustRulePhrase: '你必须',
    })
  }
  for (const rule of antiPatternRules) {
    const existing = await db.query.promptAntiPatternRules.findFirst({
      where: and(
        eq(schema.promptAntiPatternRules.guideId, guide.id),
        eq(schema.promptAntiPatternRules.ruleKey, rule.ruleKey),
      ),
    })
    if (!existing) await createPromptAntiPatternRule({ ...rule, guideId: guide.id })
  }
  return {
    guide,
    rules: await listPromptAntiPatternRules({ guideId: guide.id }),
  }
}

export async function evaluatePromptGuide(args: {
  guideId?: string
  prompt: string
}): Promise<PromptGuideEvaluation> {
  const guide = args.guideId
    ? await db.query.promptEngineeringGuides.findFirst({
        where: eq(schema.promptEngineeringGuides.id, args.guideId),
      })
    : (await seedPromptEngineeringGuide()).guide
  if (!guide) throw new Error('Prompt engineering guide was not found.')
  const rules = await listPromptAntiPatternRules({ guideId: guide.id, status: 'active' })
  const prompt = args.prompt
  const lower = prompt.toLowerCase()
  const tokenEstimate = Math.ceil(prompt.length / 4)
  const findings: PromptGuideEvaluation['findings'] = []

  if (tokenEstimate > guide.maxTokens) {
    findings.push({
      ruleKey: 'too_long',
      severity: ruleSeverity(rules, 'too_long'),
      message: `Prompt estimate ${tokenEstimate} tokens exceeds ${guide.maxTokens}.`,
    })
  }
  if (/\balways\b[\s\S]{0,160}\bnever\b|\bnever\b[\s\S]{0,160}\balways\b/i.test(prompt)) {
    findings.push({
      ruleKey: 'contradictory_instruction',
      severity: ruleSeverity(rules, 'contradictory_instruction'),
      message: 'Prompt appears to contain nearby always/never contradictions.',
    })
  }
  if (/\b(try|maybe|roughly|as needed|etc)\b/i.test(prompt)) {
    findings.push({
      ruleKey: 'vague_language',
      severity: ruleSeverity(rules, 'vague_language'),
      message: 'Prompt uses vague language that should be made explicit.',
    })
  }
  if (/\b(stack trace|internal api|implementation detail|private schema)\b/i.test(prompt)) {
    findings.push({
      ruleKey: 'internal_jargon',
      severity: ruleSeverity(rules, 'internal_jargon'),
      message: 'Prompt appears to expose internal implementation jargon.',
    })
  }
  if (!lower.includes('example') && !prompt.includes('示例')) {
    findings.push({
      ruleKey: 'missing_examples',
      severity: ruleSeverity(rules, 'missing_examples'),
      message: 'Prompt should include concrete examples and positive/negative contrast.',
    })
  }
  if (!prompt.includes(guide.mustRulePhrase)) {
    findings.push({
      ruleKey: 'missing_must_rules',
      severity: ruleSeverity(rules, 'missing_must_rules'),
      message: `Prompt should include hard rules using "${guide.mustRulePhrase}".`,
    })
  }
  for (const section of guide.recommendedSections) {
    if (!prompt.includes(section) && !prompt.includes(section.replaceAll('_', ' '))) {
      findings.push({
        ruleKey: 'missing_section',
        severity: 'medium',
        message: `Missing recommended section ${section}.`,
      })
    }
  }
  for (const placeholder of guide.requiredPlaceholders) {
    if (!prompt.includes(placeholder)) {
      findings.push({
        ruleKey: 'missing_placeholder',
        severity: 'high',
        message: `Missing required placeholder ${placeholder}.`,
      })
    }
  }

  return {
    guide,
    tokenEstimate,
    passed: findings.length === 0,
    findings,
  }
}

function ruleSeverity(
  rules: PromptAntiPatternRuleRow[],
  ruleKey: PromptAntiPatternRuleKey,
): RiskLevel {
  return rules.find((rule) => rule.ruleKey === ruleKey)?.severity ?? 'medium'
}

function guideSnapshot(row: PromptEngineeringGuideRow): JsonObject {
  return {
    recommendedSections: row.recommendedSections,
    requiredPlaceholders: row.requiredPlaceholders,
    maxTokens: row.maxTokens,
    examplePolicy: row.examplePolicy,
    mustRulePhrase: row.mustRulePhrase,
  }
}
