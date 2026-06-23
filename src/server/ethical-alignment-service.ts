import { and, desc, eq, type SQL } from 'drizzle-orm'

import { db, schema } from '@/db/client'
import type {
  EthicalAlignmentDecision,
  EthicalAlignmentEvaluationRow,
  EthicalAlignmentPolicyRow,
  EthicalAlignmentPolicyStatus,
  EthicalOnRefuse,
  JsonObject,
} from '@/db/schema'
import { newEthicalAlignmentEvaluationId, newEthicalAlignmentPolicyId } from '@/server/ids'

export interface CreateEthicalAlignmentPolicyArgs {
  name?: string
  refuseCategories?: string[]
  warnCategories?: string[]
  onRefuse?: EthicalOnRefuse
  userValues?: JsonObject
  preTaskAlignment?: JsonObject
  status?: EthicalAlignmentPolicyStatus
}

export interface EvaluateEthicalAlignmentArgs {
  policyId?: string
  taskSummary: string
  detectedCategories?: string[]
  uncertain?: boolean
}

export const defaultRefuseCategories = [
  'generate_misinformation',
  'impersonate_real_person',
  'generate_hate_speech',
  'generate_adult_content',
  'manipulate_or_deceive',
  'invade_privacy',
  'generate_malicious_code',
  'plagiarize',
  'circumvent_security',
  'self_replicate_unsafely',
  'access_unauthorized_systems',
]

export const defaultWarnCategories = [
  'generate_persuasive_content',
  'scrape_public_data',
  'automate_social_media',
  'generate_opinion_content',
  'analyze_competitor',
  'use_open_source_code',
]

const defaultUserValues: JsonObject = {
  privacyFirst: true,
  securityOverConvenience: true,
  transparencyPreference: true,
  sustainabilityAware: false,
}

const defaultPreTaskAlignment: JsonObject = {
  checkUserValues: true,
  checkPotentialHarm: true,
  onUncertainty: 'ask_user',
}

export function getDefaultRefuseCategoryCount(): number {
  return defaultRefuseCategories.length
}

export function getDefaultWarnCategoryCount(): number {
  return defaultWarnCategories.length
}

export async function seedEthicalAlignmentPolicy(): Promise<EthicalAlignmentPolicyRow> {
  const existing = await db.query.ethicalAlignmentPolicies.findFirst({
    where: eq(schema.ethicalAlignmentPolicies.name, 'Default Agent Ethics and Alignment Policy'),
  })
  if (existing) return existing
  return createEthicalAlignmentPolicy({
    name: 'Default Agent Ethics and Alignment Policy',
    refuseCategories: defaultRefuseCategories,
    warnCategories: defaultWarnCategories,
    onRefuse: 'explain_why',
    userValues: defaultUserValues,
    preTaskAlignment: defaultPreTaskAlignment,
    status: 'active',
  })
}

export async function createEthicalAlignmentPolicy(
  args: CreateEthicalAlignmentPolicyArgs = {},
): Promise<EthicalAlignmentPolicyRow> {
  const now = Date.now()
  const row = {
    id: newEthicalAlignmentPolicyId(),
    name: args.name?.trim() || 'Agent Ethics and Alignment Policy',
    refuseCategories: args.refuseCategories?.length ? args.refuseCategories : defaultRefuseCategories,
    warnCategories: args.warnCategories?.length ? args.warnCategories : defaultWarnCategories,
    onRefuse: args.onRefuse ?? 'explain_why',
    userValues: args.userValues ?? defaultUserValues,
    preTaskAlignment: args.preTaskAlignment ?? defaultPreTaskAlignment,
    status: args.status ?? 'active',
    createdAt: now,
    updatedAt: now,
  }
  await db.insert(schema.ethicalAlignmentPolicies).values(row)
  return row
}

export async function listEthicalAlignmentPolicies(args: {
  status?: EthicalAlignmentPolicyStatus
  limit?: number
} = {}): Promise<EthicalAlignmentPolicyRow[]> {
  const conditions: SQL[] = []
  if (args.status) conditions.push(eq(schema.ethicalAlignmentPolicies.status, args.status))
  return db.query.ethicalAlignmentPolicies.findMany({
    where: conditions.length ? and(...conditions) : undefined,
    orderBy: [desc(schema.ethicalAlignmentPolicies.updatedAt)],
    limit: args.limit ?? 50,
  })
}

export async function evaluateEthicalAlignment(
  args: EvaluateEthicalAlignmentArgs,
): Promise<EthicalAlignmentEvaluationRow> {
  const policy = args.policyId
    ? await db.query.ethicalAlignmentPolicies.findFirst({
        where: eq(schema.ethicalAlignmentPolicies.id, args.policyId),
      })
    : await seedEthicalAlignmentPolicy()
  if (!policy) throw new Error(`Ethical alignment policy not found: ${args.policyId}`)

  const detectedCategories = Array.from(new Set(args.detectedCategories ?? []))
  const refuseHits = detectedCategories.filter((category) => policy.refuseCategories.includes(category))
  const warnHits = detectedCategories.filter((category) => policy.warnCategories.includes(category))
  const preTask = policy.preTaskAlignment as JsonObject

  let decision: EthicalAlignmentDecision = 'allowed'
  const reasons: string[] = []
  if (refuseHits.length > 0) {
    decision = 'refused'
    reasons.push(`refuse_categories:${refuseHits.join(',')}`)
    reasons.push(`on_refuse:${policy.onRefuse}`)
  } else if (warnHits.length > 0) {
    decision = 'warn'
    reasons.push(`warn_categories:${warnHits.join(',')}`)
  } else if (args.uncertain) {
    const onUncertainty = String(preTask.onUncertainty ?? 'ask_user')
    if (onUncertainty === 'refuse') {
      decision = 'refused'
    } else if (onUncertainty === 'proceed_with_caution') {
      decision = 'warn'
    } else {
      decision = 'ask_user'
    }
    reasons.push(`uncertain:${onUncertainty}`)
  } else {
    reasons.push('no_ethics_or_alignment_risk_detected')
  }

  const row = {
    id: newEthicalAlignmentEvaluationId(),
    policyId: policy.id,
    taskSummary: args.taskSummary.trim(),
    detectedCategories,
    decision,
    reasons,
    userValuesSnapshot: policy.userValues,
    preTaskAlignmentSnapshot: policy.preTaskAlignment,
    createdAt: Date.now(),
  }
  await db.insert(schema.ethicalAlignmentEvaluations).values(row)
  return row
}

export async function listEthicalAlignmentEvaluations(args: {
  policyId?: string
  decision?: EthicalAlignmentDecision
  limit?: number
} = {}): Promise<EthicalAlignmentEvaluationRow[]> {
  const conditions: SQL[] = []
  if (args.policyId) conditions.push(eq(schema.ethicalAlignmentEvaluations.policyId, args.policyId))
  if (args.decision) conditions.push(eq(schema.ethicalAlignmentEvaluations.decision, args.decision))
  return db.query.ethicalAlignmentEvaluations.findMany({
    where: conditions.length ? and(...conditions) : undefined,
    orderBy: [desc(schema.ethicalAlignmentEvaluations.createdAt)],
    limit: args.limit ?? 50,
  })
}
