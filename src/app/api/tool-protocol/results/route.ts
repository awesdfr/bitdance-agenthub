import { NextRequest, NextResponse } from 'next/server'

import { errorResponse, parseJsonBody } from '@/app/api/control-plane-utils'
import { ToolProtocolResultBody } from '@/server/control-plane-validators'
import {
  createToolProtocolResult,
  listToolProtocolResults,
} from '@/server/tool-invocation-protocol-service'

export async function GET(req: NextRequest) {
  return NextResponse.json({
    toolProtocolResults: await listToolProtocolResults({
      invocationId: req.nextUrl.searchParams.get('invocationId') ?? undefined,
      callId: req.nextUrl.searchParams.get('callId') ?? undefined,
      limit: Number(req.nextUrl.searchParams.get('limit') ?? 100),
    }),
  })
}

export async function POST(req: NextRequest) {
  const parsed = await parseJsonBody(req, ToolProtocolResultBody)
  if (!parsed.ok) return parsed.response
  try {
    const result = await createToolProtocolResult({
      ...parsed.data,
      data: parsed.data.data ?? null,
      error: parsed.data.error ?? null,
    })
    return NextResponse.json({ result }, { status: 201 })
  } catch (err) {
    return errorResponse(err)
  }
}
