import { NextRequest, NextResponse } from 'next/server'

import { errorResponse } from '@/app/api/control-plane-utils'
import type { ErrorTaxonomyCategory, RecoveryStrategyType } from '@/db/schema'
import { listRecoveryStrategyStats } from '@/server/error-recovery-strategy-service'

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

export async function GET(req: NextRequest) {
  try {
    return NextResponse.json({
      recoveryStrategyStats: await listRecoveryStrategyStats({
        agentProfileId: req.nextUrl.searchParams.get('agentProfileId') ?? undefined,
        category: parseCategory(req.nextUrl.searchParams.get('category')),
        strategyType: parseStrategy(req.nextUrl.searchParams.get('strategyType')),
        limit: parseLimit(req.nextUrl.searchParams.get('limit')),
      }),
    })
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

function parseLimit(value: string | null): number | undefined {
  return value ? Number(value) : undefined
}
