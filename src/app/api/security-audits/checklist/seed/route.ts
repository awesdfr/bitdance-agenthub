import { NextResponse } from 'next/server'

import { errorResponse } from '@/app/api/control-plane-utils'
import { seedSecurityAuditChecklist } from '@/server/security-audit-checklist-service'

export async function POST() {
  try {
    return NextResponse.json({ items: await seedSecurityAuditChecklist() }, { status: 201 })
  } catch (err) {
    return errorResponse(err)
  }
}
