import { NextRequest, NextResponse } from 'next/server'

import { errorResponse } from '@/app/api/control-plane-utils'
import { BrandCandidateLanguageSchema } from '@/server/control-plane-validators'
import { listBrandCandidates } from '@/server/brand-service'

export async function GET(req: NextRequest) {
  try {
    const languageParam = req.nextUrl.searchParams.get('language') ?? undefined
    const language = languageParam ? BrandCandidateLanguageSchema.parse(languageParam) : undefined
    const status = req.nextUrl.searchParams.get('status') ?? undefined
    const limitParam = req.nextUrl.searchParams.get('limit')
    return NextResponse.json({
      candidates: await listBrandCandidates({
        language,
        status,
        limit: limitParam ? Number(limitParam) : undefined,
      }),
    })
  } catch (err) {
    return errorResponse(err)
  }
}
