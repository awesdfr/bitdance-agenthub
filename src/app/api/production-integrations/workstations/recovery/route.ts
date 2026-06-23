import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

import { errorResponse, parseJsonBody } from '@/app/api/control-plane-utils'
import {
  getWorkstationLeaseRecoveryReport,
  recoverStaleWorkstationLeases,
} from '@/server/production-integration-service'

const WorkstationRecoveryBody = z.object({
  maxBusyAgeMs: z.number().int().positive().optional(),
  apply: z.boolean().optional(),
  confirmRecovery: z.boolean().optional(),
})

export async function GET(req: NextRequest) {
  try {
    const rawMaxBusyAgeMs = req.nextUrl.searchParams.get('maxBusyAgeMs')
    const maxBusyAgeMs = rawMaxBusyAgeMs ? Number(rawMaxBusyAgeMs) : undefined
    return NextResponse.json({
      recovery: await getWorkstationLeaseRecoveryReport({ maxBusyAgeMs }),
    })
  } catch (err) {
    return errorResponse(err)
  }
}

export async function POST(req: NextRequest) {
  const parsed = await parseJsonBody(req, WorkstationRecoveryBody)
  if (!parsed.ok) return parsed.response
  try {
    return NextResponse.json({
      recovery: await recoverStaleWorkstationLeases(parsed.data),
    })
  } catch (err) {
    return errorResponse(err)
  }
}
