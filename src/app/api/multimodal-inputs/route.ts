import { NextRequest, NextResponse } from 'next/server'

import { errorResponse, parseJsonBody } from '@/app/api/control-plane-utils'
import { MultimodalInputBody } from '@/server/control-plane-validators'
import { listMultimodalInputs, registerMultimodalInput } from '@/server/multimodal-io-service'

export async function GET(req: NextRequest) {
  const employeeRunId = req.nextUrl.searchParams.get('employeeRunId') ?? undefined
  const agentProfileId = req.nextUrl.searchParams.get('agentProfileId') ?? undefined
  return NextResponse.json({ multimodalInputs: await listMultimodalInputs({ employeeRunId, agentProfileId }) })
}

export async function POST(req: NextRequest) {
  try {
    const parsed = await parseJsonBody(req, MultimodalInputBody)
    if (!parsed.ok) return parsed.response
    const multimodalInput = await registerMultimodalInput(parsed.data)
    return NextResponse.json({ multimodalInput }, { status: 201 })
  } catch (err) {
    return errorResponse(err)
  }
}
