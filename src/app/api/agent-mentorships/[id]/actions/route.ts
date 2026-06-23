import { NextRequest, NextResponse } from 'next/server'

import { errorResponse, parseJsonBody } from '@/app/api/control-plane-utils'
import { AgentMentoringActionBody } from '@/server/control-plane-validators'
import { recordMentoringAction } from '@/server/agent-mentorship-service'

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params
    const parsed = await parseJsonBody(req, AgentMentoringActionBody)
    if (!parsed.ok) return parsed.response
    return NextResponse.json({ result: await recordMentoringAction(id, parsed.data) }, { status: 201 })
  } catch (err) {
    return errorResponse(err)
  }
}
