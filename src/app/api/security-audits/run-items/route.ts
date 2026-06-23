import { NextRequest, NextResponse } from 'next/server'

import { errorResponse } from '@/app/api/control-plane-utils'
import { listSecurityAuditRunItems } from '@/server/security-audit-checklist-service'

export async function GET(req: NextRequest) {
  try {
    const runId = req.nextUrl.searchParams.get('runId') ?? undefined
    return NextResponse.json({
      items: await listSecurityAuditRunItems({ runId }),
    })
  } catch (err) {
    return errorResponse(err)
  }
}
