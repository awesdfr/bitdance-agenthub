import { NextRequest, NextResponse } from 'next/server'

import { errorResponse } from '@/app/api/control-plane-utils'
import type { ErrorSeverity, ErrorTaxonomyCategory } from '@/db/schema'
import { listErrorClassifications } from '@/server/error-recovery-strategy-service'

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

const SEVERITIES: ErrorSeverity[] = ['recoverable', 'recoverable_with_help', 'fatal']

export async function GET(req: NextRequest) {
  try {
    return NextResponse.json({
      errorClassifications: await listErrorClassifications({
        agentProfileId: req.nextUrl.searchParams.get('agentProfileId') ?? undefined,
        resourceType: req.nextUrl.searchParams.get('resourceType') ?? undefined,
        resourceId: req.nextUrl.searchParams.get('resourceId') ?? undefined,
        category: parseCategory(req.nextUrl.searchParams.get('category')),
        severity: parseSeverity(req.nextUrl.searchParams.get('severity')),
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

function parseSeverity(value: string | null): ErrorSeverity | undefined {
  return SEVERITIES.includes(value as ErrorSeverity) ? value as ErrorSeverity : undefined
}

function parseLimit(value: string | null): number | undefined {
  return value ? Number(value) : undefined
}
