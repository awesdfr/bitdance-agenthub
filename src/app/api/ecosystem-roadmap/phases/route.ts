import { NextRequest, NextResponse } from 'next/server'

import { errorResponse, parseJsonBody } from '@/app/api/control-plane-utils'
import type { EcosystemRoadmapStage, EcosystemRoadmapStatus } from '@/db/schema'
import { EcosystemRoadmapPhaseBody } from '@/server/control-plane-validators'
import {
  createEcosystemRoadmapPhase,
  listEcosystemRoadmapPhases,
} from '@/server/ecosystem-roadmap-service'

export async function GET(req: NextRequest) {
  try {
    return NextResponse.json({
      phases: await listEcosystemRoadmapPhases({
        stage: (req.nextUrl.searchParams.get('stage') ?? undefined) as
          | EcosystemRoadmapStage
          | undefined,
        status: (req.nextUrl.searchParams.get('status') ?? undefined) as
          | EcosystemRoadmapStatus
          | undefined,
        limit: Number(req.nextUrl.searchParams.get('limit') ?? 50),
      }),
    })
  } catch (err) {
    return errorResponse(err)
  }
}

export async function POST(req: NextRequest) {
  const parsed = await parseJsonBody(req, EcosystemRoadmapPhaseBody)
  if (!parsed.ok) return parsed.response
  try {
    return NextResponse.json(
      { phase: await createEcosystemRoadmapPhase(parsed.data) },
      { status: 201 },
    )
  } catch (err) {
    return errorResponse(err)
  }
}
