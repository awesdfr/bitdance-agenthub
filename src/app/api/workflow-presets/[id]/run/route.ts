import { NextRequest, NextResponse } from 'next/server'

import { errorResponse, getRouteId, parseJsonBody } from '@/app/api/control-plane-utils'
import { WorkflowPresetRunBody } from '@/server/control-plane-validators'
import { runWorkflowPreset } from '@/server/workflow-preset-service'

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const parsed = await parseJsonBody(req, WorkflowPresetRunBody)
  if (!parsed.ok) return parsed.response
  try {
    return NextResponse.json(await runWorkflowPreset(await getRouteId(ctx), parsed.data.input), {
      status: 201,
    })
  } catch (err) {
    return errorResponse(err, 404)
  }
}
