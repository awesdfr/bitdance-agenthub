import { NextRequest, NextResponse } from 'next/server'

import { errorResponse, parseJsonBody } from '@/app/api/control-plane-utils'
import type { EmotionalUxGuidelineType, EmotionalUxStatus } from '@/db/schema'
import { EmotionalUxGuidelineBody } from '@/server/control-plane-validators'
import {
  createEmotionalUxGuideline,
  listEmotionalUxGuidelines,
} from '@/server/emotional-ux-service'

export async function GET(req: NextRequest) {
  try {
    return NextResponse.json({
      guidelines: await listEmotionalUxGuidelines({
        guidelineType: (req.nextUrl.searchParams.get('guidelineType') ?? undefined) as
          | EmotionalUxGuidelineType
          | undefined,
        status: (req.nextUrl.searchParams.get('status') ?? undefined) as
          | EmotionalUxStatus
          | undefined,
        limit: Number(req.nextUrl.searchParams.get('limit') ?? 100),
      }),
    })
  } catch (err) {
    return errorResponse(err)
  }
}

export async function POST(req: NextRequest) {
  const parsed = await parseJsonBody(req, EmotionalUxGuidelineBody)
  if (!parsed.ok) return parsed.response
  try {
    return NextResponse.json(
      { guideline: await createEmotionalUxGuideline(parsed.data) },
      { status: 201 },
    )
  } catch (err) {
    return errorResponse(err)
  }
}
