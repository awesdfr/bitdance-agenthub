import { NextRequest, NextResponse } from 'next/server'

import { errorResponse } from '@/app/api/control-plane-utils'
import { GlossaryTermCategorySchema } from '@/server/control-plane-validators'
import { listGlossaryTerms } from '@/server/glossary-service'

export async function GET(req: NextRequest) {
  try {
    const categoryParam = req.nextUrl.searchParams.get('category') ?? undefined
    const category = categoryParam ? GlossaryTermCategorySchema.parse(categoryParam) : undefined
    const term = req.nextUrl.searchParams.get('term') ?? undefined
    const status = req.nextUrl.searchParams.get('status') ?? undefined
    const limitParam = req.nextUrl.searchParams.get('limit')
    return NextResponse.json({
      terms: await listGlossaryTerms({
        category,
        term,
        status,
        limit: limitParam ? Number(limitParam) : undefined,
      }),
    })
  } catch (err) {
    return errorResponse(err)
  }
}
