import { NextRequest, NextResponse } from 'next/server'

import { errorResponse, getRouteId, parseJsonBody } from '@/app/api/control-plane-utils'
import { createSoftwareCommand } from '@/server/control-plane-service'
import { SoftwareCommandBody } from '@/server/control-plane-validators'

interface RouteContext {
  params: Promise<{ id: string }>
}

export async function POST(req: NextRequest, ctx: RouteContext) {
  const parsed = await parseJsonBody(req, SoftwareCommandBody)
  if (!parsed.ok) return parsed.response
  try {
    const softwareCommand = await createSoftwareCommand({
      ...parsed.data,
      softwareProfileId: await getRouteId(ctx),
    })
    return NextResponse.json({ softwareCommand }, { status: 201 })
  } catch (err) {
    return errorResponse(err)
  }
}
