import { NextRequest, NextResponse } from 'next/server'

import { errorResponse, parseJsonBody } from '@/app/api/control-plane-utils'
import type { AgentCertificationExamStatus, AgentCertificationLevel } from '@/db/schema'
import { AgentCertificationExamBody } from '@/server/control-plane-validators'
import {
  createAgentCertificationExam,
  listAgentCertificationExams,
} from '@/server/agent-certification-service'

export async function GET(req: NextRequest) {
  try {
    return NextResponse.json({
      exams: await listAgentCertificationExams({
        status: (req.nextUrl.searchParams.get('status') ?? undefined) as
          | AgentCertificationExamStatus
          | undefined,
        level: (req.nextUrl.searchParams.get('level') ?? undefined) as
          | AgentCertificationLevel
          | undefined,
        limit: Number(req.nextUrl.searchParams.get('limit') ?? 100),
      }),
    })
  } catch (err) {
    return errorResponse(err)
  }
}

export async function POST(req: NextRequest) {
  try {
    const parsed = await parseJsonBody(req, AgentCertificationExamBody)
    if (!parsed.ok) return parsed.response
    return NextResponse.json({ exam: await createAgentCertificationExam(parsed.data) }, { status: 201 })
  } catch (err) {
    return errorResponse(err)
  }
}
