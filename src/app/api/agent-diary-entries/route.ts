import { NextRequest, NextResponse } from 'next/server'

import { errorResponse, parseJsonBody } from '@/app/api/control-plane-utils'
import { AgentDiaryEntryBody } from '@/server/control-plane-validators'
import {
  createAgentDiaryEntry,
  listAgentDiaryEntries,
} from '@/server/agent-continuity-service'

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const limit = Number(searchParams.get('limit') ?? 100)
  return NextResponse.json({
    agentDiaryEntries: await listAgentDiaryEntries({
      agentProfileId: searchParams.get('agentProfileId') ?? undefined,
      employeeRunId: searchParams.get('employeeRunId') ?? undefined,
      limit: Number.isFinite(limit) ? limit : 100,
    }),
  })
}

export async function POST(req: NextRequest) {
  try {
    const parsed = await parseJsonBody(req, AgentDiaryEntryBody)
    if (!parsed.ok) return parsed.response
    const agentDiaryEntry = await createAgentDiaryEntry(parsed.data)
    return NextResponse.json({ agentDiaryEntry }, { status: 201 })
  } catch (err) {
    return errorResponse(err)
  }
}
