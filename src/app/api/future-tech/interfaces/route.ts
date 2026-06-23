import { NextRequest, NextResponse } from 'next/server'

import { errorResponse, parseJsonBody } from '@/app/api/control-plane-utils'
import type { FutureTechCapabilityKind, FutureTechReadiness } from '@/db/schema'
import { FutureTechInterfaceBody } from '@/server/control-plane-validators'
import {
  createFutureTechInterface,
  listFutureTechInterfaces,
} from '@/server/future-tech-adapter-service'

export async function GET(req: NextRequest) {
  return NextResponse.json({
    futureTechInterfaces: await listFutureTechInterfaces({
      capabilityKind: (req.nextUrl.searchParams.get('capabilityKind') ?? undefined) as
        | FutureTechCapabilityKind
        | undefined,
      readiness: (req.nextUrl.searchParams.get('readiness') ?? undefined) as
        | FutureTechReadiness
        | undefined,
      limit: Number(req.nextUrl.searchParams.get('limit') ?? 50),
    }),
  })
}

export async function POST(req: NextRequest) {
  const parsed = await parseJsonBody(req, FutureTechInterfaceBody)
  if (!parsed.ok) return parsed.response
  try {
    const futureTechInterface = await createFutureTechInterface(parsed.data)
    return NextResponse.json({ futureTechInterface }, { status: 201 })
  } catch (err) {
    return errorResponse(err)
  }
}
