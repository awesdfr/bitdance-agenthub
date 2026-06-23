import { NextRequest, NextResponse } from 'next/server'

import { errorResponse, parseJsonBody } from '@/app/api/control-plane-utils'
import type { VoiceProfileStatus } from '@/db/schema'
import { VoiceInterfaceProfileBody } from '@/server/control-plane-validators'
import {
  createVoiceInterfaceProfile,
  listVoiceInterfaceProfiles,
} from '@/server/voice-interface-service'

export async function GET(req: NextRequest) {
  return NextResponse.json({
    voiceInterfaceProfiles: await listVoiceInterfaceProfiles({
      agentProfileId: req.nextUrl.searchParams.get('agentProfileId') ?? undefined,
      status: (req.nextUrl.searchParams.get('status') ?? undefined) as VoiceProfileStatus | undefined,
      limit: Number(req.nextUrl.searchParams.get('limit') ?? 50),
    }),
  })
}

export async function POST(req: NextRequest) {
  const parsed = await parseJsonBody(req, VoiceInterfaceProfileBody)
  if (!parsed.ok) return parsed.response
  try {
    const voiceInterfaceProfile = await createVoiceInterfaceProfile(parsed.data)
    return NextResponse.json({ voiceInterfaceProfile }, { status: 201 })
  } catch (err) {
    return errorResponse(err)
  }
}
