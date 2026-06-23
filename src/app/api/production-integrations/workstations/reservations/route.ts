import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

import { errorResponse, parseJsonBody } from '@/app/api/control-plane-utils'
import { createWorkstationReservation } from '@/server/production-integration-service'

const WorkstationReservationBody = z.object({
  agentProfileId: z.string().min(1),
  mode: z.enum(['virtual_desktop', 'vm', 'remote_session']),
  workspacePath: z.string().optional().nullable(),
  browserProfilePath: z.string().optional().nullable(),
  tempPath: z.string().optional().nullable(),
  displayId: z.string().optional().nullable(),
  vncUrl: z.string().optional().nullable(),
  rdpConfig: z.string().optional().nullable(),
})

export async function POST(req: NextRequest) {
  const parsed = await parseJsonBody(req, WorkstationReservationBody)
  if (!parsed.ok) return parsed.response
  try {
    return NextResponse.json(
      { workstation: await createWorkstationReservation(parsed.data) },
      { status: 201 },
    )
  } catch (err) {
    return errorResponse(err)
  }
}
