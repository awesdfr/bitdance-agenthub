import { NextRequest, NextResponse } from 'next/server'

import { errorResponse, parseJsonBody } from '@/app/api/control-plane-utils'
import type { EntityStateMachineType, OpenSourceGovernanceStatus } from '@/db/schema'
import { EntityStateTransitionBody } from '@/server/control-plane-validators'
import {
  createEntityStateTransition,
  listEntityStateTransitions,
} from '@/server/entity-state-machine-service'

export async function GET(req: NextRequest) {
  return NextResponse.json({
    stateTransitions: await listEntityStateTransitions({
      machineId: req.nextUrl.searchParams.get('machineId') ?? undefined,
      entityType: (req.nextUrl.searchParams.get('entityType') ?? undefined) as
        | EntityStateMachineType
        | undefined,
      fromState: req.nextUrl.searchParams.get('fromState') ?? undefined,
      status: (req.nextUrl.searchParams.get('status') ?? undefined) as
        | OpenSourceGovernanceStatus
        | undefined,
      limit: Number(req.nextUrl.searchParams.get('limit') ?? 100),
    }),
  })
}

export async function POST(req: NextRequest) {
  const parsed = await parseJsonBody(req, EntityStateTransitionBody)
  if (!parsed.ok) return parsed.response
  try {
    const stateTransition = await createEntityStateTransition(parsed.data)
    return NextResponse.json({ stateTransition }, { status: 201 })
  } catch (err) {
    return errorResponse(err)
  }
}
