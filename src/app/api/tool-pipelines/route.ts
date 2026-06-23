import { NextRequest, NextResponse } from 'next/server'

import { errorResponse, parseJsonBody } from '@/app/api/control-plane-utils'
import type { ToolPipelineStatus } from '@/db/schema'
import { ToolPipelineBody } from '@/server/control-plane-validators'
import { createToolPipeline, listToolPipelines } from '@/server/skill-synthesis-service'

export async function GET(req: NextRequest) {
  try {
    const status = req.nextUrl.searchParams.get('status') ?? undefined
    const synthesisRecordId = req.nextUrl.searchParams.get('synthesisRecordId') ?? undefined
    const limitParam = req.nextUrl.searchParams.get('limit')
    return NextResponse.json({
      pipelines: await listToolPipelines({
        status: status as ToolPipelineStatus | undefined,
        synthesisRecordId,
        limit: limitParam ? Number(limitParam) : undefined,
      }),
    })
  } catch (err) {
    return errorResponse(err)
  }
}

export async function POST(req: NextRequest) {
  try {
    const parsed = await parseJsonBody(req, ToolPipelineBody)
    if (!parsed.ok) return parsed.response
    return NextResponse.json(
      { pipeline: await createToolPipeline(parsed.data) },
      { status: 201 },
    )
  } catch (err) {
    return errorResponse(err)
  }
}
