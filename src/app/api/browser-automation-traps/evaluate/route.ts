import { NextRequest, NextResponse } from 'next/server'

import { errorResponse, parseJsonBody } from '@/app/api/control-plane-utils'
import { BrowserAutomationTrapEvaluationBody } from '@/server/control-plane-validators'
import { evaluateBrowserAutomationTraps } from '@/server/browser-automation-trap-service'

export async function POST(req: NextRequest) {
  const parsed = await parseJsonBody(req, BrowserAutomationTrapEvaluationBody)
  if (!parsed.ok) return parsed.response
  try {
    return NextResponse.json({ result: await evaluateBrowserAutomationTraps(parsed.data) }, { status: 201 })
  } catch (err) {
    return errorResponse(err)
  }
}
