import { NextRequest, NextResponse } from 'next/server'

import { errorResponse, getRouteId, parseJsonBody } from '@/app/api/control-plane-utils'
import { AgentCertificationRunBody } from '@/server/control-plane-validators'
import { runAgentCertificationExam } from '@/server/agent-certification-service'

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    const parsed = await parseJsonBody(req, AgentCertificationRunBody)
    if (!parsed.ok) return parsed.response
    return NextResponse.json({
      certificationRun: await runAgentCertificationExam({
        examId: await getRouteId(ctx),
        ...parsed.data,
      }),
    })
  } catch (err) {
    return errorResponse(err)
  }
}
