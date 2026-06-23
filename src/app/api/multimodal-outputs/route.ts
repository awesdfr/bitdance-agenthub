import { NextRequest, NextResponse } from 'next/server'

import { errorResponse, parseJsonBody } from '@/app/api/control-plane-utils'
import { MultimodalOutputBody } from '@/server/control-plane-validators'
import { listMultimodalOutputs, registerMultimodalOutput } from '@/server/multimodal-io-service'

export async function GET(req: NextRequest) {
  const employeeRunId = req.nextUrl.searchParams.get('employeeRunId') ?? undefined
  const agentProfileId = req.nextUrl.searchParams.get('agentProfileId') ?? undefined
  return NextResponse.json({ multimodalOutputs: await listMultimodalOutputs({ employeeRunId, agentProfileId }) })
}

export async function POST(req: NextRequest) {
  try {
    const parsed = await parseJsonBody(req, MultimodalOutputBody)
    if (!parsed.ok) return parsed.response
    const multimodalOutput = await registerMultimodalOutput(parsed.data)
    return NextResponse.json({ multimodalOutput }, { status: 201 })
  } catch (err) {
    return errorResponse(err)
  }
}
