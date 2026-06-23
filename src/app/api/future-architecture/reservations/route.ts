import { NextRequest, NextResponse } from 'next/server'

import { errorResponse, parseJsonBody } from '@/app/api/control-plane-utils'
import {
  ArchitectureAbstractionKindSchema,
  ArchitectureEvolutionReservationBody,
  ArchitectureEvolutionTrackSchema,
} from '@/server/control-plane-validators'
import {
  createArchitectureEvolutionReservation,
  listArchitectureEvolutionReservations,
} from '@/server/architecture-evolution-service'

export async function GET(req: NextRequest) {
  try {
    const track = req.nextUrl.searchParams.get('track')
    const abstractionKind = req.nextUrl.searchParams.get('abstractionKind')
    const status = req.nextUrl.searchParams.get('status')
    const limit = req.nextUrl.searchParams.get('limit')
    return NextResponse.json({
      reservations: await listArchitectureEvolutionReservations({
        track: track ? ArchitectureEvolutionTrackSchema.parse(track) : undefined,
        abstractionKind: abstractionKind
          ? ArchitectureAbstractionKindSchema.parse(abstractionKind)
          : undefined,
        status:
          status === 'reserved' || status === 'planned' || status === 'blocked' || status === 'implemented'
            ? status
            : undefined,
        limit: limit ? Number(limit) : undefined,
      }),
    })
  } catch (err) {
    return errorResponse(err)
  }
}

export async function POST(req: NextRequest) {
  const parsed = await parseJsonBody(req, ArchitectureEvolutionReservationBody)
  if (!parsed.ok) return parsed.response
  try {
    return NextResponse.json(
      { reservation: await createArchitectureEvolutionReservation(parsed.data) },
      { status: 201 },
    )
  } catch (err) {
    return errorResponse(err)
  }
}
