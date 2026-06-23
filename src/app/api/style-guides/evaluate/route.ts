import { NextRequest, NextResponse } from 'next/server'

import { errorResponse, parseJsonBody } from '@/app/api/control-plane-utils'
import { StyleGuideEvaluationBody } from '@/server/control-plane-validators'
import { evaluateStyleGuideCompliance } from '@/server/style-guide-service'

export async function POST(req: NextRequest) {
  const parsed = await parseJsonBody(req, StyleGuideEvaluationBody)
  if (!parsed.ok) return parsed.response
  try {
    const result = await evaluateStyleGuideCompliance(parsed.data)
    return NextResponse.json({ result })
  } catch (err) {
    return errorResponse(err)
  }
}
