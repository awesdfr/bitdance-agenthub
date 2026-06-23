import { NextRequest, NextResponse } from 'next/server'

import { errorResponse } from '@/app/api/control-plane-utils'
import { SecurityAuditCadenceSchema } from '@/server/control-plane-validators'
import { listSecurityAuditChecklistItems } from '@/server/security-audit-checklist-service'

export async function GET(req: NextRequest) {
  try {
    const cadence = req.nextUrl.searchParams.get('cadence')
    return NextResponse.json({
      items: await listSecurityAuditChecklistItems({
        cadence: cadence ? SecurityAuditCadenceSchema.parse(cadence) : undefined,
      }),
    })
  } catch (err) {
    return errorResponse(err)
  }
}
