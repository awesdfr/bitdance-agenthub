import { NextRequest, NextResponse } from 'next/server'

import { errorResponse } from '@/app/api/control-plane-utils'
import { FaqEntryCategorySchema } from '@/server/control-plane-validators'
import { listFaqEntries } from '@/server/faq-service'

export async function GET(req: NextRequest) {
  try {
    const categoryParam = req.nextUrl.searchParams.get('category') ?? undefined
    const category = categoryParam ? FaqEntryCategorySchema.parse(categoryParam) : undefined
    const query = req.nextUrl.searchParams.get('query') ?? undefined
    const status = req.nextUrl.searchParams.get('status') ?? undefined
    const limitParam = req.nextUrl.searchParams.get('limit')
    return NextResponse.json({
      entries: await listFaqEntries({
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
