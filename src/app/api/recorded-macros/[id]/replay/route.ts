import { NextRequest, NextResponse } from 'next/server'

import { errorResponse, getRouteId, parseJsonBody } from '@/app/api/control-plane-utils'
import { MacroReplayBody } from '@/server/control-plane-validators'
import { replayRecordedMacro } from '@/server/recorded-macro-service'

interface RouteContext {
  params: Promise<{ id: string }>
}

export async function POST(req: NextRequest, ctx: RouteContext) {
  const parsed = await parseJsonBody(req, MacroReplayBody)
  if (!parsed.ok) return parsed.response
  try {
    const macroReplayRun = await replayRecordedMacro({
      recordedMacroId: await getRouteId(ctx),
      ...parsed.data,
    })
    return NextResponse.json({ macroReplayRun }, { status: 201 })
  } catch (err) {
    return errorResponse(err)
  }
}
