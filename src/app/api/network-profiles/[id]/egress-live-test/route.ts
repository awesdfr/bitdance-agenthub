import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

import { errorResponse, getRouteId, parseJsonBody } from '@/app/api/control-plane-utils'
import { testNetworkEgress } from '@/server/network-egress-live-test-service'

interface RouteContext {
  params: Promise<{ id: string }>
}

const NetworkEgressLiveTestBody = z.object({
  live: z.boolean().optional(),
  confirmExternalCall: z.boolean().optional(),
  probeUrl: z.string().url().optional().nullable(),
})

export async function POST(req: NextRequest, ctx: RouteContext) {
  const parsed = await parseJsonBody(req, NetworkEgressLiveTestBody)
  if (!parsed.ok) return parsed.response
  try {
    return NextResponse.json({
      result: await testNetworkEgress({
        networkProfileId: await getRouteId(ctx),
        ...parsed.data,
      }),
    })
  } catch (err) {
    return errorResponse(err)
  }
}
