import { NextRequest, NextResponse } from 'next/server'

import { errorResponse, getRouteId, parseJsonBody } from '@/app/api/control-plane-utils'
import { WorkflowPresetInstallBody } from '@/server/control-plane-validators'
import { installWorkflowPreset } from '@/server/workflow-preset-service'

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const parsed = await parseJsonBody(req, WorkflowPresetInstallBody)
  if (!parsed.ok) return parsed.response
  try {
    const workflowGraph = await installWorkflowPreset(await getRouteId(ctx), parsed.data)
    return NextResponse.json({ workflowGraph }, { status: 201 })
  } catch (err) {
    return errorResponse(err, 404)
  }
}
