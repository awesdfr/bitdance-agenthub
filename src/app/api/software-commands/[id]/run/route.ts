import { NextRequest, NextResponse } from 'next/server'

import { errorResponse, getRouteId, parseJsonBody } from '@/app/api/control-plane-utils'
import { SoftwareCommandRunBody } from '@/server/control-plane-validators'
import { runSoftwareCommand } from '@/server/software-adapter-service'

interface RouteContext {
  params: Promise<{ id: string }>
}

export async function POST(req: NextRequest, ctx: RouteContext) {
  const parsed = await parseJsonBody(req, SoftwareCommandRunBody)
  if (!parsed.ok) return parsed.response
  try {
    const softwareCommandRun = await runSoftwareCommand({
      softwareCommandId: await getRouteId(ctx),
      ...parsed.data,
    })
    return NextResponse.json({ softwareCommandRun }, { status: 201 })
  } catch (err) {
    return errorResponse(err)
  }
}
