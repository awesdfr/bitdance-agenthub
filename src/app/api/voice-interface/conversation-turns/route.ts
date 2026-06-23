import { NextRequest, NextResponse } from 'next/server'

import { errorResponse, parseJsonBody } from '@/app/api/control-plane-utils'
import { VoiceConversationTurnBody } from '@/server/control-plane-validators'
import {
  getVoiceConversationContext,
  listVoiceConversationTurns,
  recordVoiceConversationTurn,
} from '@/server/voice-interface-service'

export async function GET(req: NextRequest) {
  const voiceInterfaceProfileId = req.nextUrl.searchParams.get('voiceInterfaceProfileId') ?? undefined
  const agentProfileId = req.nextUrl.searchParams.get('agentProfileId') ?? undefined
  const limit = Number(req.nextUrl.searchParams.get('limit') ?? 50)
  return NextResponse.json({
    voiceConversationTurns: await listVoiceConversationTurns({
      voiceInterfaceProfileId,
      agentProfileId,
      limit,
    }),
    context: await getVoiceConversationContext({
      voiceInterfaceProfileId,
      agentProfileId,
      limit: Math.min(limit, 20),
    }),
  })
}

export async function POST(req: NextRequest) {
  const parsed = await parseJsonBody(req, VoiceConversationTurnBody)
  if (!parsed.ok) return parsed.response
  try {
    const voiceConversationTurn = await recordVoiceConversationTurn(parsed.data)
    return NextResponse.json({ voiceConversationTurn }, { status: 201 })
  } catch (err) {
    return errorResponse(err)
  }
}
