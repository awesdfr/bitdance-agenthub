import { NextRequest, NextResponse } from 'next/server'

import { errorResponse } from '@/app/api/control-plane-utils'
import { QuickReferenceCategorySchema } from '@/server/control-plane-validators'
import { listQuickReferenceItems } from '@/server/quick-reference-service'

export async function GET(req: NextRequest) {
  try {
    const categoryParam = req.nextUrl.searchParams.get('category') ?? undefined
    const category = categoryParam ? QuickReferenceCategorySchema.parse(categoryParam) : undefined
    const query = req.nextUrl.searchParams.get('query') ?? undefined
    const status = req.nextUrl.searchParams.get('status') ?? undefined
    const limitParam = req.nextUrl.searchParams.get('limit')
    return NextResponse.json({
      items: await listQuickReferenceItems({
        category,
        query,
        status,
        limit: limitParam ? Number(limitParam) : undefined,
      }),
    })
  } catch (err) {
    return errorResponse(err)
  }
}
