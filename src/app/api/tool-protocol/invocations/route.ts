import { NextRequest, NextResponse } from 'next/server'

import { errorResponse, parseJsonBody } from '@/app/api/control-plane-utils'
import type { ToolProtocolInvocationStatus } from '@/db/schema'
import { ToolProtocolInvocationBody } from '@/server/control-plane-validators'
import {
  createToolProtocolInvocation,
  listToolProtocolInvocations,
} from '@/server/tool-invocation-protocol-service'

export async function GET(req: NextRequest) {
  return NextResponse.json({
    toolProtocolInvocations: await listToolProtocolInvocations({
      manifestId: req.nextUrl.searchParams.get('manifestId') ?? undefined,
      toolName: req.nextUrl.searchParams.get('toolName') ?? undefined,
      status: (req.nextUrl.searchParams.get('status') ?? undefined) as
        | ToolProtocolInvocationStatus
        | undefined,
      limit: Number(req.nextUrl.searchParams.get('limit') ?? 100),
    }),
  })
}

export async function POST(req: NextRequest) {
  const parsed = await parseJsonBody(req, ToolProtocolInvocationBody)
  if (!parsed.ok) return parsed.response
  try {
    const invocation = await createToolProtocolInvocation(parsed.data)
    return NextResponse.json({ invocation }, { status: 201 })
  } catch (err) {
    return errorResponse(err)
  }
}
