import { NextRequest, NextResponse } from 'next/server'

import { errorResponse, parseJsonBody } from '@/app/api/control-plane-utils'
import { PromptGuideEvaluationBody } from '@/server/control-plane-validators'
import { evaluatePromptGuide } from '@/server/prompt-engineering-guide-service'

export async function POST(req: NextRequest) {
  const parsed = await parseJsonBody(req, PromptGuideEvaluationBody)
  if (!parsed.ok) return parsed.response
  try {
    return NextResponse.json({ evaluation: await evaluatePromptGuide(parsed.data) })
  } catch (err) {
    return errorResponse(err)
  }
}
