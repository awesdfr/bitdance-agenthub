import { NextRequest, NextResponse } from 'next/server'

import { errorResponse, parseJsonBody } from '@/app/api/control-plane-utils'
import type { LegalComplianceStatus } from '@/db/schema'
import { LegalComplianceFrameworkBody } from '@/server/control-plane-validators'
import {
  createLegalComplianceFramework,
  listLegalComplianceFrameworks,
} from '@/server/legal-compliance-service'

export async function GET(req: NextRequest) {
  try {
    return NextResponse.json({
      frameworks: await listLegalComplianceFrameworks({
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
  const parsed = await parseJsonBody(req, LegalComplianceFrameworkBody)
  if (!parsed.ok) return parsed.response
  try {
    return NextResponse.json(
      { framework: await createLegalComplianceFramework(parsed.data) },
      { status: 201 },
    )
  } catch (err) {
    return errorResponse(err)
  }
}
