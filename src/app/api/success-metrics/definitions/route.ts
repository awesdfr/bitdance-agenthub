import { NextRequest, NextResponse } from 'next/server'

import { errorResponse } from '@/app/api/control-plane-utils'
import { SuccessMetricCategorySchema } from '@/server/control-plane-validators'
import { listSuccessMetricDefinitions } from '@/server/success-metrics-service'

export async function GET(req: NextRequest) {
  try {
    const categoryParam = req.nextUrl.searchParams.get('category') ?? undefined
    const category = categoryParam ? SuccessMetricCategorySchema.parse(categoryParam) : undefined
    const status = req.nextUrl.searchParams.get('status') ?? undefined
    const limitParam = req.nextUrl.searchParams.get('limit')
    return NextResponse.json({
      definitions: await listSuccessMetricDefinitions({
        category,
        status,
        limit: limitParam ? Number(limitParam) : undefined,
      }),
    })
  } catch (err) {
    return errorResponse(err)
  }
}
