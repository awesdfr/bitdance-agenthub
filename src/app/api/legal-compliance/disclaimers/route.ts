import { NextRequest, NextResponse } from 'next/server'

import { errorResponse, parseJsonBody } from '@/app/api/control-plane-utils'
import type { LegalComplianceStatus, LegalDisclaimerPlacement } from '@/db/schema'
import { LegalDisclaimerNoticeBody } from '@/server/control-plane-validators'
import {
  createLegalDisclaimerNotice,
  listLegalDisclaimerNotices,
} from '@/server/legal-compliance-service'

export async function GET(req: NextRequest) {
  try {
    return NextResponse.json({
      notices: await listLegalDisclaimerNotices({
        placement: (req.nextUrl.searchParams.get('placement') ?? undefined) as
          | LegalDisclaimerPlacement
          | undefined,
        status: (req.nextUrl.searchParams.get('status') ?? undefined) as
          | LegalComplianceStatus
          | undefined,
        limit: Number(req.nextUrl.searchParams.get('limit') ?? 50),
      }),
    })
  } catch (err) {
    return errorResponse(err)
  }
}

export async function POST(req: NextRequest) {
  const parsed = await parseJsonBody(req, LegalDisclaimerNoticeBody)
  if (!parsed.ok) return parsed.response
  try {
    return NextResponse.json(
      { notice: await createLegalDisclaimerNotice(parsed.data) },
      { status: 201 },
    )
  } catch (err) {
    return errorResponse(err)
  }
}
