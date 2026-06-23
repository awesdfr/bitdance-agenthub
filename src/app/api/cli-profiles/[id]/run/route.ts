import { NextRequest, NextResponse } from 'next/server'

import { errorResponse, getRouteId, parseJsonBody } from '@/app/api/control-plane-utils'
import { runCliProfile } from '@/server/cli-runner-service'
import { CliRunBody } from '@/server/control-plane-validators'

interface RouteContext {
  params: Promise<{ id: string }>
}

export async function POST(req: NextRequest, ctx: RouteContext) {
  const parsed = await parseJsonBody(req, CliRunBody)
  if (!parsed.ok) return parsed.response
  try {
    const cliRun = await runCliProfile({
      cliProfileId: await getRouteId(ctx),
      ...parsed.data,
    })
    return NextResponse.json({ cliRun }, { status: 201 })
  } catch (err) {
    return errorResponse(err)
  }
}
