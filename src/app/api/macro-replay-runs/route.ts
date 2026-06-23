import { NextRequest, NextResponse } from 'next/server'

import { listMacroReplayRuns } from '@/server/recorded-macro-service'

export async function GET(req: NextRequest) {
  return NextResponse.json({
    macroReplayRuns: await listMacroReplayRuns({
      recordedMacroId: req.nextUrl.searchParams.get('recordedMacroId') ?? undefined,
      agentProfileId: req.nextUrl.searchParams.get('agentProfileId') ?? undefined,
    }),
  })
}
