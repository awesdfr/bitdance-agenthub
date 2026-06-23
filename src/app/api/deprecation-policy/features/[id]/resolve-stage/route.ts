import { NextRequest, NextResponse } from 'next/server'

import { errorResponse, parseJsonBody } from '@/app/api/control-plane-utils'
import { DeprecationStageResolveBody } from '@/server/control-plane-validators'
import { resolveDeprecationStage } from '@/server/deprecation-policy-service'

interface RouteParams {
  params: Promise<{ id: string }>
}

export async function POST(req: NextRequest, { params }: RouteParams) {
  const parsed = await parseJsonBody(req, DeprecationStageResolveBody)
  if (!parsed.ok) return parsed.response
  try {
    const { id } = await params
    return NextResponse.json({ feature: await resolveDeprecationStage(id, parsed.data.at) })
  } catch (err) {
    return errorResponse(err)
  }
}
