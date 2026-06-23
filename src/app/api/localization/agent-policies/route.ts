import { NextRequest, NextResponse } from 'next/server'

import { errorResponse, parseJsonBody } from '@/app/api/control-plane-utils'
import { AgentLocalizationPolicyBody } from '@/server/control-plane-validators'
import {
  createAgentLocalizationPolicy,
  listAgentLocalizationPolicies,
} from '@/server/localization-service'

export async function GET() {
  try {
    return NextResponse.json({ policies: await listAgentLocalizationPolicies() })
  } catch (err) {
    return errorResponse(err, 500)
  }
}

export async function POST(req: NextRequest) {
  const parsed = await parseJsonBody(req, AgentLocalizationPolicyBody)
  if (!parsed.ok) return parsed.response
  try {
    return NextResponse.json({ policy: await createAgentLocalizationPolicy(parsed.data) }, { status: 201 })
  } catch (err) {
    return errorResponse(err)
  }
}
