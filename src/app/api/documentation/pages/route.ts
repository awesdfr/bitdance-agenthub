import { NextRequest, NextResponse } from 'next/server'

import { errorResponse } from '@/app/api/control-plane-utils'
import { DocumentationSectionCategorySchema } from '@/server/control-plane-validators'
import { listDocumentationPages } from '@/server/documentation-architecture-service'

export async function GET(req: NextRequest) {
  try {
    const categoryParam = req.nextUrl.searchParams.get('category') ?? undefined
    const category = categoryParam ? DocumentationSectionCategorySchema.parse(categoryParam) : undefined
    const sectionId = req.nextUrl.searchParams.get('sectionId') ?? undefined
    const status = req.nextUrl.searchParams.get('status') ?? undefined
    const limitParam = req.nextUrl.searchParams.get('limit')
    return NextResponse.json({
      pages: await listDocumentationPages({
        category,
        sectionId,
        status: status === 'planned' || status === 'draft' || status === 'published' || status === 'missing'
          ? status
          : undefined,
        limit: limitParam ? Number(limitParam) : undefined,
      }),
    })
  } catch (err) {
    return errorResponse(err)
  }
}
