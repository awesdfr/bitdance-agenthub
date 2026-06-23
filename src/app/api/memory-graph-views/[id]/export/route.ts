import { NextRequest, NextResponse } from 'next/server'

import { errorResponse, getRouteId, parseJsonBody } from '@/app/api/control-plane-utils'
import { MemoryGraphExportBody } from '@/server/control-plane-validators'
import { exportMemoryGraphView } from '@/server/memory-graph-service'

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    const parsed = await parseJsonBody(req, MemoryGraphExportBody)
    if (!parsed.ok) return parsed.response
    return NextResponse.json({
      view: await exportMemoryGraphView(await getRouteId(ctx), parsed.data.format),
    })
  } catch (err) {
    return errorResponse(err)
  }
}
