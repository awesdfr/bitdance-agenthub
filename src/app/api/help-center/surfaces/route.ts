import { NextRequest, NextResponse } from 'next/server'

import { errorResponse } from '@/app/api/control-plane-utils'
import { HelpCenterSurfaceBody } from '@/server/control-plane-validators'
import { createHelpCenterSurface, listHelpCenterSurfaces } from '@/server/help-center-service'

export async function GET(req: NextRequest) {
  try {
    const surfaceKey = req.nextUrl.searchParams.get('surfaceKey') ?? undefined
    const statusParam = req.nextUrl.searchParams.get('status')
    const limitParam = req.nextUrl.searchParams.get('limit')
    return NextResponse.json({
      surfaces: await listHelpCenterSurfaces({
        surfaceKey,
        status: statusParam === 'active' || statusParam === 'disabled' ? statusParam : undefined,
        limit: limitParam ? Number(limitParam) : undefined,
      }),
    })
  } catch (err) {
    return errorResponse(err)
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = HelpCenterSurfaceBody.parse(await req.json())
    const surface = await createHelpCenterSurface(body)
    return NextResponse.json({ surface }, { status: 201 })
  } catch (err) {
    return errorResponse(err)
  }
}
