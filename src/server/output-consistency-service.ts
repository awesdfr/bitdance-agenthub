import path from 'node:path'

import { and, desc, eq, type SQL } from 'drizzle-orm'

import { db, schema } from '@/db/client'
import type {
  OutputConsistencyAction,
  OutputConsistencyEvaluationRow,
  OutputConsistencyInput,
  OutputConsistencyPolicy,
  OutputConsistencyPolicyRow,
  OutputConsistencyRisk,
  OutputConsistencyStatus,
  OutputLanguage,
} from '@/db/schema'
import { newOutputConsistencyEvaluationId, newOutputConsistencyPolicyId } from '@/server/ids'

export interface EvaluateOutputConsistencyArgs extends OutputConsistencyInput {
  policyId?: string
}

export interface OutputConsistencyEvaluationResult {
  policy: OutputConsistencyPolicyRow
  evaluation: OutputConsistencyEvaluationRow
  summary: {
    riskCount: number
    rejected: number
    warnings: number
    actions: OutputConsistencyAction[]
  }
}

const DEFAULT_POLICY_NAME = 'Default Agent output consistency policy'

const defaultPolicy: OutputConsistencyPolicy = {
  language: {
    outputLanguage: 'zh-CN',
    commentLanguage: 'english',
    detectMixedLanguage: true,
    enforceConsistency: true,
  },
  codeStyle: {
    formatters: {
      '.ts': 'prettier',
      '.tsx': 'prettier',
      '.js': 'prettier',
      '.jsx': 'prettier',
      '.css': 'prettier',
      '.md': 'prettier',
      '.py': 'black',
      '.go': 'gofmt',
    },
    onFormatFail: 'warn',
  },
}

export async function seedOutputConsistencyPolicy(): Promise<OutputConsistencyPolicyRow> {
  const existing = await db.query.outputConsistencyPolicies.findFirst({
    where: eq(schema.outputConsistencyPolicies.name, DEFAULT_POLICY_NAME),
  })
  if (existing) return existing
  const now = Date.now()
  const row: OutputConsistencyPolicyRow = {
    id: newOutputConsistencyPolicyId(),
    name: DEFAULT_POLICY_NAME,
    policy: defaultPolicy,
    status: 'active',
    createdAt: now,
    updatedAt: now,
  }
  await db.insert(schema.outputConsistencyPolicies).values(row)
  return row
}

export async function listOutputConsistencyPolicies(args: {
  status?: OutputConsistencyPolicyRow['status']
  limit?: number
} = {}): Promise<OutputConsistencyPolicyRow[]> {
  const filters: SQL[] = []
  if (args.status) filters.push(eq(schema.outputConsistencyPolicies.status, args.status))
  return db.query.outputConsistencyPolicies.findMany({
    where: filters.length ? and(...filters) : undefined,
    orderBy: [desc(schema.outputConsistencyPolicies.updatedAt)],
    limit: Math.min(Math.max(args.limit ?? 25, 1), 100),
  })
}

export async function evaluateOutputConsistency(
  args: EvaluateOutputConsistencyArgs,
): Promise<OutputConsistencyEvaluationResult> {
  const policy = args.policyId
    ? await getRequiredPolicy(args.policyId)
    : await seedOutputConsistencyPolicy()
  if (policy.status !== 'active') throw new Error(`Output consistency policy is ${policy.status}: ${policy.id}`)

  const input = normalizeInput(args)
  const risks = collectRisks(input, policy.policy)
  const actions = uniqueActions(risks, input, policy.policy)
  if (!actions.length) actions.push('continue')
  const status = statusFromRisks(risks)
  const evaluation: OutputConsistencyEvaluationRow = {
    id: newOutputConsistencyEvaluationId(),
    policyId: policy.id,
    input,
    risks,
    actions,
    status,
    recommendation: recommendationFor(status, risks, actions),
    createdAt: Date.now(),
  }
  await db.insert(schema.outputConsistencyEvaluations).values(evaluation)
  return {
    policy,
    evaluation,
    summary: {
      riskCount: risks.length,
      rejected: risks.filter((risk) => risk.severity === 'rejected').length,
      warnings: risks.filter((risk) => risk.severity === 'warning').length,
      actions,
    },
  }
}

export async function listOutputConsistencyEvaluations(args: {
  status?: OutputConsistencyStatus
  limit?: number
} = {}): Promise<OutputConsistencyEvaluationRow[]> {
  const filters: SQL[] = []
  if (args.status) filters.push(eq(schema.outputConsistencyEvaluations.status, args.status))
  return db.query.outputConsistencyEvaluations.findMany({
    where: filters.length ? and(...filters) : undefined,
    orderBy: [desc(schema.outputConsistencyEvaluations.createdAt)],
    limit: Math.min(Math.max(args.limit ?? 50, 1), 200),
  })
}

function normalizeInput(args: EvaluateOutputConsistencyArgs): OutputConsistencyInput {
  return {
    artifactType: args.artifactType,
    content: args.content,
    fileName: args.fileName,
    expectedLanguage: args.expectedLanguage,
    detectedLanguages: args.detectedLanguages?.length ? args.detectedLanguages : detectLanguages(args.content ?? ''),
    detectedCommentLanguages: args.detectedCommentLanguages,
    formatterResults: args.formatterResults,
  }
}

function collectRisks(
  input: OutputConsistencyInput,
  policy: OutputConsistencyPolicy,
): OutputConsistencyRisk[] {
  const risks: OutputConsistencyRisk[] = []
  const expected = input.expectedLanguage ?? policy.language.outputLanguage
  const detected = new Set((input.detectedLanguages ?? []).filter((language) => language !== 'auto'))

  if (policy.language.detectMixedLanguage && detected.size > 1) {
    risks.push({
      type: 'mixed_language',
      severity: 'warning',
      message: `Detected mixed output languages: ${Array.from(detected).join(', ')}.`,
      action: 'normalize_output_language',
    })
  }

  if (policy.language.enforceConsistency && expected !== 'auto' && detected.size && !detected.has(expected)) {
    risks.push({
      type: 'wrong_language',
      severity: 'warning',
      message: `Expected output language ${expected}, but detected ${Array.from(detected).join(', ')}.`,
      action: 'normalize_output_language',
    })
  }

  if (
    input.artifactType === 'code' &&
    policy.language.commentLanguage === 'english' &&
    input.detectedCommentLanguages?.some((language) => language !== 'en-US' && language !== 'auto')
  ) {
    risks.push({
      type: 'comment_language',
      severity: 'warning',
      message: 'Code comments should be English for cross-team maintainability.',
      action: 'use_english_code_comments',
    })
  }

  const extension = normalizeExtension(input.fileName)
  const formatter = extension ? policy.codeStyle.formatters[extension] : undefined
  const formatterResult = extension ? input.formatterResults?.[extension] : undefined
  if (input.artifactType === 'code' && extension && !formatter) {
    risks.push({
      type: 'formatter_missing',
      severity: 'warning',
      message: `No formatter configured for ${extension}.`,
      action: 'warn_manual_format',
    })
  } else if (formatterResult === 'missing') {
    risks.push({
      type: 'formatter_missing',
      severity: 'warning',
      message: `Formatter ${formatter} is configured for ${extension}, but was not available.`,
      action: 'warn_manual_format',
    })
  } else if (formatterResult === 'failed') {
    risks.push({
      type: 'formatter_failed',
      severity: policy.codeStyle.onFormatFail === 'reject_artifact' ? 'rejected' : 'warning',
      message: `Formatter ${formatter} failed for ${extension}.`,
      action: policy.codeStyle.onFormatFail === 'reject_artifact' ? 'reject_artifact' : 'warn_manual_format',
    })
  }

  return risks
}

function detectLanguages(content: string): OutputLanguage[] {
  const languages = new Set<OutputLanguage>()
  if (/[\u4E00-\u9FFF]/.test(content)) languages.add('zh-CN')
  if (/[\u3040-\u30FF]/.test(content)) languages.add('ja-JP')
  if (/[A-Za-z]{3,}/.test(content)) languages.add('en-US')
  return Array.from(languages)
}

function normalizeExtension(fileName: string | undefined): string {
  if (!fileName) return ''
  return path.extname(fileName).toLowerCase()
}

function uniqueActions(
  risks: OutputConsistencyRisk[],
  input: OutputConsistencyInput,
  policy: OutputConsistencyPolicy,
): OutputConsistencyAction[] {
  const actions = new Set<OutputConsistencyAction>(risks.map((risk) => risk.action))
  const extension = normalizeExtension(input.fileName)
  if (
    input.artifactType === 'code' &&
    extension &&
    policy.codeStyle.formatters[extension] &&
    input.formatterResults?.[extension] !== 'passed'
  ) {
    actions.add('run_formatter')
  }
  return Array.from(actions)
}

function statusFromRisks(risks: OutputConsistencyRisk[]): OutputConsistencyStatus {
  if (risks.some((risk) => risk.severity === 'rejected')) return 'rejected'
  if (risks.some((risk) => risk.severity === 'warning')) return 'warning'
  return 'passed'
}

function recommendationFor(
  status: OutputConsistencyStatus,
  risks: OutputConsistencyRisk[],
  actions: OutputConsistencyAction[],
): string {
  if (!risks.length) return 'Output consistency checks passed.'
  if (status === 'rejected') return 'Reject this artifact until language and formatting rules pass.'
  if (actions.includes('normalize_output_language')) return 'Normalize the artifact to the configured output language.'
  if (actions.includes('use_english_code_comments')) return 'Rewrite code comments in English and rerun formatting.'
  if (actions.includes('run_formatter')) return 'Run the configured formatter before publishing the artifact.'
  return 'Review the output consistency warnings before passing this artifact downstream.'
}

async function getRequiredPolicy(id: string): Promise<OutputConsistencyPolicyRow> {
  const row = await db.query.outputConsistencyPolicies.findFirst({
    where: eq(schema.outputConsistencyPolicies.id, id),
  })
  if (!row) throw new Error(`Output consistency policy not found: ${id}`)
  return row
}
