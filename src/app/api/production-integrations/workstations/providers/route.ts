import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

import { errorResponse, parseJsonBody } from '@/app/api/control-plane-utils'
import { discoverWorkstationProviders } from '@/server/production-integration-service'

const WorkstationProvidersBody = z.object({
  live: z.boolean().optional(),
})

export async function POST(req: NextRequest) {
  const parsed = await parseJsonBody(req, WorkstationProvidersBody)
  if (!parsed.ok) return parsed.response
  try {
    return NextResponse.json(
      { workstations: await discoverWorkstationProviders(parsed.data) },
      { status: 201 },
    )
  } catch (err) {
    return errorResponse(err)
  }
}
