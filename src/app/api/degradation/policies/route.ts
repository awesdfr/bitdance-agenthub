import { NextRequest, NextResponse } from 'next/server'

import { errorResponse, parseJsonBody } from '@/app/api/control-plane-utils'
import { DegradationPolicyBody } from '@/server/control-plane-validators'
import { createDegradationPolicy, listDegradationPolicies } from '@/server/degradation-service'

export async function GET() {
  try {
    return NextResponse.json({ degradationPolicies: await listDegradationPolicies() })
  } catch (err) {
    return errorResponse(err)
  }
}

export async function POST(req: NextRequest) {
  try {
    const parsed = await parseJsonBody(req, DegradationPolicyBody)
    if (!parsed.ok) return parsed.response
    const degradationPolicy = await createDegradationPolicy(parsed.data)
    return NextResponse.json({ degradationPolicy }, { status: 201 })
  } catch (err) {
    return errorResponse(err)
  }
}
