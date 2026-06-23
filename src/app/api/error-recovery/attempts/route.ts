import { NextRequest, NextResponse } from 'next/server'

import { errorResponse, parseJsonBody } from '@/app/api/control-plane-utils'
import type {
  ErrorTaxonomyCategory,
  RecoveryStrategyOutcome,
  RecoveryStrategyType,
} from '@/db/schema'
import { RecoveryStrategyAttemptBody } from '@/server/control-plane-validators'
import {
  listRecoveryStrategyAttempts,
  recordRecoveryStrategyAttempt,
} from '@/server/error-recovery-strategy-service'

const CATEGORIES: ErrorTaxonomyCategory[] = [
  'model_error',
  'tool_error',
  'network_error',
  'permission_error',
  'resource_error',
  'input_error',
  'environment_error',
  'rate_limit_error',
  'timeout_error',
]

const STRATEGIES: RecoveryStrategyType[] = [
  'retry',
  'retry_with_fallback_model',
  'retry_with_different_approach',
  'skip_step',
  'replan_from_scratch',
  'ask_user',
  'rollback',
  'delegate_to_agent',
]

const OUTCOMES: RecoveryStrategyOutcome[] = ['succeeded', 'failed', 'skipped', 'needs_user']

export async function GET(req: NextRequest) {
  try {
    return NextResponse.json({
      recoveryStrategyAttempts: await listRecoveryStrategyAttempts({
        classificationId: req.nextUrl.searchParams.get('classificationId') ?? undefined,
        agentProfileId: req.nextUrl.searchParams.get('agentProfileId') ?? undefined,
        category: parseCategory(req.nextUrl.searchParams.get('category')),
        strategyType: parseStrategy(req.nextUrl.searchParams.get('strategyType')),
        outcome: parseOutcome(req.nextUrl.searchParams.get('outcome')),
        limit: parseLimit(req.nextUrl.searchParams.get('limit')),
      }),
    })
  } catch (err) {
    return errorResponse(err)
  }
}

export async function POST(req: NextRequest) {
  try {
    const parsed = await parseJsonBody(req, RecoveryStrategyAttemptBody)
    if (!parsed.ok) return parsed.response
    return NextResponse.json(
      await recordRecoveryStrategyAttempt(parsed.data),
      { status: 201 },
    )
  } catch (err) {
    return errorResponse(err)
  }
}

function parseCategory(value: string | null): ErrorTaxonomyCategory | undefined {
  return CATEGORIES.includes(value as ErrorTaxonomyCategory)
    ? value as ErrorTaxonomyCategory
    : undefined
}

function parseStrategy(value: string | null): RecoveryStrategyType | undefined {
  return STRATEGIES.includes(value as RecoveryStrategyType)
    ? value as RecoveryStrategyType
    : undefined
}

function parseOutcome(value: string | null): RecoveryStrategyOutcome | undefined {
  return OUTCOMES.includes(value as RecoveryStrategyOutcome)
    ? value as RecoveryStrategyOutcome
    : undefined
}

function parseLimit(value: string | null): number | undefined {
  return value ? Number(value) : undefined
}
