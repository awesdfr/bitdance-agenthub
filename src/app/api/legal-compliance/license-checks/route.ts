import { NextRequest, NextResponse } from 'next/server'

import { errorResponse, parseJsonBody } from '@/app/api/control-plane-utils'
import type { LicenseRiskLevel } from '@/db/schema'
import { LicenseComplianceCheckBody } from '@/server/control-plane-validators'
import {
  detectLicenseCompliance,
  listLicenseComplianceChecks,
} from '@/server/legal-compliance-service'

export async function GET(req: NextRequest) {
  try {
    return NextResponse.json({
      checks: await listLicenseComplianceChecks({
        license: req.nextUrl.searchParams.get('license') ?? undefined,
        riskLevel: (req.nextUrl.searchParams.get('riskLevel') ?? undefined) as
          | LicenseRiskLevel
          | undefined,
        limit: Number(req.nextUrl.searchParams.get('limit') ?? 50),
      }),
    })
  } catch (err) {
    return errorResponse(err)
  }
}

export async function POST(req: NextRequest) {
  const parsed = await parseJsonBody(req, LicenseComplianceCheckBody)
  if (!parsed.ok) return parsed.response
  try {
    return NextResponse.json(
      { check: await detectLicenseCompliance(parsed.data) },
      { status: 201 },
    )
  } catch (err) {
    return errorResponse(err)
  }
}
