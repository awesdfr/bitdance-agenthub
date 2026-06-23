import { NextRequest, NextResponse } from 'next/server'

import { errorResponse, parseJsonBody } from '@/app/api/control-plane-utils'
import type { EntityStateMachineType, OpenSourceGovernanceStatus } from '@/db/schema'
import { EntityStateMachineBody } from '@/server/control-plane-validators'
import {
  createEntityStateMachine,
  listEntityStateMachines,
} from '@/server/entity-state-machine-service'

export async function GET(req: NextRequest) {
  return NextResponse.json({
    stateMachines: await listEntityStateMachines({
      entityType: (req.nextUrl.searchParams.get('entityType') ?? undefined) as
        | EntityStateMachineType
        | undefined,
      status: (req.nextUrl.searchParams.get('status') ?? undefined) as
        | OpenSourceGovernanceStatus
        | undefined,
      limit: Number(req.nextUrl.searchParams.get('limit') ?? 50),
    }),
  })
}

export async function POST(req: NextRequest) {
  const parsed = await parseJsonBody(req, EntityStateMachineBody)
  if (!parsed.ok) return parsed.response
  try {
    const stateMachine = await createEntityStateMachine(parsed.data)
    return NextResponse.json({ stateMachine }, { status: 201 })
  } catch (err) {
    return errorResponse(err)
  }
}
