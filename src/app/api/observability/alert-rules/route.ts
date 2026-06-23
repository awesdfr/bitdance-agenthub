import { NextRequest, NextResponse } from 'next/server'

import { errorResponse, parseJsonBody } from '@/app/api/control-plane-utils'
import { AlertRuleBody } from '@/server/control-plane-validators'
import { createAlertRule, listAlertRules } from '@/server/observability-service'

export async function GET() {
  return NextResponse.json({ alertRules: await listAlertRules() })
}

export async function POST(req: NextRequest) {
  const parsed = await parseJsonBody(req, AlertRuleBody)
  if (!parsed.ok) return parsed.response
  try {
    const alertRule = await createAlertRule(parsed.data)
    return NextResponse.json({ alertRule }, { status: 201 })
  } catch (err) {
    return errorResponse(err)
  }
}
