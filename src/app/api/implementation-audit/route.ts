import { NextResponse } from 'next/server'

import { errorResponse } from '@/app/api/control-plane-utils'
import { getImplementationAuditReport } from '@/server/implementation-audit-service'

export async function GET() {
  try {
    return NextResponse.json(await getImplementationAuditReport())
  } catch (err) {
    return errorResponse(err, 500)
  }
}
