import { NextRequest, NextResponse } from 'next/server'

import { errorResponse, parseJsonBody } from '@/app/api/control-plane-utils'
import { PromptDriftCheckBody } from '@/server/control-plane-validators'
import { runPromptDriftCheck } from '@/server/prompt-drift-service'

export async function POST(req: NextRequest) {
  const parsed = await parseJsonBody(req, PromptDriftCheckBody)
  if (!parsed.ok) return parsed.response
  try {
    return NextResponse.json({ run: await runPromptDriftCheck(parsed.data) }, { status: 201 })
  } catch (err) {
    return errorResponse(err)
  }
}
