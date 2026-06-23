import { NextRequest, NextResponse } from 'next/server'

import { errorResponse, parseJsonBody } from '@/app/api/control-plane-utils'
import type { OpenSourceGovernanceStatus } from '@/db/schema'
import { ArchitectureInterfaceBody } from '@/server/control-plane-validators'
import {
  createArchitectureInterface,
  listArchitectureInterfaces,
} from '@/server/architecture-pattern-service'

export async function GET(req: NextRequest) {
  return NextResponse.json({
    architectureInterfaces: await listArchitectureInterfaces({
      interfaceName: req.nextUrl.searchParams.get('interfaceName') ?? undefined,
      status: (req.nextUrl.searchParams.get('status') ?? undefined) as
        | OpenSourceGovernanceStatus
        | undefined,
      limit: Number(req.nextUrl.searchParams.get('limit') ?? 50),
    }),
  })
}

export async function POST(req: NextRequest) {
  const parsed = await parseJsonBody(req, ArchitectureInterfaceBody)
  if (!parsed.ok) return parsed.response
  try {
    const architectureInterface = await createArchitectureInterface(parsed.data)
    return NextResponse.json({ architectureInterface }, { status: 201 })
  } catch (err) {
    return errorResponse(err)
  }
}
