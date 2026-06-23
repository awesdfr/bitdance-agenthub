import { NextRequest, NextResponse } from 'next/server'

import { errorResponse, parseJsonBody } from '@/app/api/control-plane-utils'
import { EnterpriseNetworkEvaluationBody } from '@/server/control-plane-validators'
import { evaluateEnterpriseNetwork } from '@/server/enterprise-network-service'

export async function POST(req: NextRequest) {
  const parsed = await parseJsonBody(req, EnterpriseNetworkEvaluationBody)
  if (!parsed.ok) return parsed.response
  try {
    return NextResponse.json({ result: await evaluateEnterpriseNetwork(parsed.data) }, { status: 201 })
  } catch (err) {
    return errorResponse(err)
  }
}
