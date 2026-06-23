import { NextRequest, NextResponse } from 'next/server'

import { errorResponse, parseJsonBody } from '@/app/api/control-plane-utils'
import { SecurityAuditCadenceSchema, SecurityAuditRunBody } from '@/server/control-plane-validators'
import { listSecurityAuditRuns, runSecurityAudit } from '@/server/security-audit-checklist-service'

export async function GET(req: NextRequest) {
  try {
    const cadence = req.nextUrl.searchParams.get('cadence')
    return NextResponse.json({
      runs: await listSecurityAuditRuns({
        cadence: cadence ? SecurityAuditCadenceSchema.parse(cadence) : undefined,
      }),
    })
  } catch (err) {
    return errorResponse(err)
  }
}

export async function POST(req: NextRequest) {
  const parsed = await parseJsonBody(req, SecurityAuditRunBody)
  if (!parsed.ok) return parsed.response
  try {
    return NextResponse.json(await runSecurityAudit(parsed.data), { status: 201 })
  } catch (err) {
    return errorResponse(err)
  }
}
