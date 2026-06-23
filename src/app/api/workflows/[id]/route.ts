import { NextRequest, NextResponse } from 'next/server'

import { errorResponse, getRouteId, parseJsonBody } from '@/app/api/control-plane-utils'
import { getWorkflowGraph, updateWorkflow } from '@/server/control-plane-service'
import { WorkflowBody } from '@/server/control-plane-validators'

interface RouteContext {
  params: Promise<{ id: string }>
}

export async function GET(_req: Request, ctx: RouteContext) {
  try {
    const graph = await getWorkflowGraph(await getRouteId(ctx))
    return NextResponse.json(graph)
  } catch (err) {
    return errorResponse(err, 404)
  }
}

export async function PATCH(req: NextRequest, ctx: RouteContext) {
  const parsed = await parseJsonBody(req, WorkflowBody)
  if (!parsed.ok) return parsed.response
  try {
    const workflow = await updateWorkflow(await getRouteId(ctx), parsed.data)
    return NextResponse.json({ workflow })
  } catch (err) {
    return errorResponse(err, 404)
  }
}
