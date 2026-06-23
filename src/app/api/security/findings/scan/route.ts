import { NextRequest, NextResponse } from 'next/server'

import { errorResponse, parseJsonBody } from '@/app/api/control-plane-utils'
import { PromptInjectionScanBody } from '@/server/control-plane-validators'
import { scanExternalTextForPromptInjection } from '@/server/security-service'

export async function POST(req: NextRequest) {
  const parsed = await parseJsonBody(req, PromptInjectionScanBody)
  if (!parsed.ok) return parsed.response
  try {
    const securityFinding = await scanExternalTextForPromptInjection(parsed.data)
    return NextResponse.json({ securityFinding })
  } catch (err) {
    return errorResponse(err)
  }
}
