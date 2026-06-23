import { and, desc, eq } from 'drizzle-orm'

import { db, schema } from '@/db/client'
import type {
  JsonObject,
  VoiceConversationSpeaker,
  VoiceConversationTurnRow,
  VoiceConversationTurnStatus,
  VoiceInputMode,
  VoiceInterfaceProfileRow,
  VoiceProfileStatus,
  VoiceSpeakOn,
  TtsEngine,
} from '@/db/schema'
import { newVoiceConversationTurnId, newVoiceInterfaceProfileId } from '@/server/ids'
import { recordAuditLog } from '@/server/security-service'

export interface CreateVoiceInterfaceProfileArgs {
  agentProfileId?: string | null
  input?: {
    mode?: VoiceInputMode
    wakeWord?: string | null
    language?: string
    speakerIdentification?: boolean
  }
  output?: {
    ttsEngine?: TtsEngine
    voice?: string
    speed?: number
    speakOn?: VoiceSpeakOn[]
  }
  conversationPolicy?: JsonObject
  status?: VoiceProfileStatus
}

export interface RecordVoiceConversationTurnArgs {
  voiceInterfaceProfileId?: string | null
  agentProfileId?: string | null
  speaker: VoiceConversationSpeaker
  speakerLabel?: string
  text: string
  language?: string
  source?: string
  status?: VoiceConversationTurnStatus
  metadata?: JsonObject
}

export async function createVoiceInterfaceProfile(
  args: CreateVoiceInterfaceProfileArgs,
): Promise<VoiceInterfaceProfileRow> {
  const now = Date.now()
  const row: VoiceInterfaceProfileRow = {
    id: newVoiceInterfaceProfileId(),
    agentProfileId: normalizeNullable(args.agentProfileId),
    inputMode: args.input?.mode ?? 'push_to_talk',
    wakeWord: normalizeNullable(args.input?.wakeWord),
    language: args.input?.language?.trim() || 'en-US',
    speakerIdentification: args.input?.speakerIdentification ?? false,
    ttsEngine: args.output?.ttsEngine ?? 'system',
    voice: args.output?.voice?.trim() || 'default',
    speed: clampSpeed(args.output?.speed ?? 1),
    speakOn: args.output?.speakOn?.length
      ? [...new Set(args.output.speakOn)]
      : ['approval_needed', 'task_complete'],
    conversationPolicy: {
      ...(args.conversationPolicy ?? {}),
      v2Reserved: true,
      liveAudioCapture: false,
      liveTtsPlayback: false,
    },
    status: args.status ?? 'active',
    createdAt: now,
    updatedAt: now,
  }
  await db.insert(schema.voiceInterfaceProfiles).values(row)
  await recordAuditLog({
    actorType: row.agentProfileId ? 'agent' : 'system',
    actorId: row.agentProfileId,
    action: 'voice_interface.profile.create',
    resourceType: 'voice_interface_profile',
    resourceId: row.id,
    status: 'allowed',
    riskLevel: 'low',
    message: 'Voice interface profile reserved without live audio capture.',
    metadata: {
      inputMode: row.inputMode,
      ttsEngine: row.ttsEngine,
      speakOn: row.speakOn,
      liveAudioCapture: false,
    },
  })
  return row
}

export async function listVoiceInterfaceProfiles(args: {
  agentProfileId?: string
  status?: VoiceProfileStatus
  limit?: number
} = {}): Promise<VoiceInterfaceProfileRow[]> {
  const filters = [
    args.agentProfileId ? eq(schema.voiceInterfaceProfiles.agentProfileId, args.agentProfileId) : undefined,
    args.status ? eq(schema.voiceInterfaceProfiles.status, args.status) : undefined,
  ].filter(Boolean)
  return db.query.voiceInterfaceProfiles.findMany({
    where: filters.length > 0 ? and(...filters) : undefined,
    orderBy: [desc(schema.voiceInterfaceProfiles.createdAt)],
    limit: Math.min(Math.max(args.limit ?? 50, 1), 200),
  })
}

export async function recordVoiceConversationTurn(
  args: RecordVoiceConversationTurnArgs,
): Promise<VoiceConversationTurnRow> {
  const profile = args.voiceInterfaceProfileId
    ? await getOptionalVoiceProfile(args.voiceInterfaceProfileId)
    : null
  const row: VoiceConversationTurnRow = {
    id: newVoiceConversationTurnId(),
    voiceInterfaceProfileId: profile?.id ?? normalizeNullable(args.voiceInterfaceProfileId),
    agentProfileId: normalizeNullable(args.agentProfileId) ?? profile?.agentProfileId ?? null,
    speaker: args.speaker,
    speakerLabel: args.speakerLabel?.trim() ?? '',
    text: args.text.trim(),
    language: args.language?.trim() || profile?.language || 'en-US',
    source: args.source?.trim() || 'text_placeholder',
    status: args.status ?? 'captured',
    metadata: {
      ...(args.metadata ?? {}),
      liveAudioCapture: false,
    },
    createdAt: Date.now(),
  }
  await db.insert(schema.voiceConversationTurns).values(row)
  await recordAuditLog({
    actorType: row.speaker === 'agent' ? 'agent' : 'user',
    actorId: row.speaker === 'agent' ? row.agentProfileId : null,
    action: 'voice_interface.turn.record',
    resourceType: 'voice_conversation_turn',
    resourceId: row.id,
    status: 'allowed',
    riskLevel: 'low',
    message: 'Voice conversation turn stored as text placeholder.',
    metadata: {
      speaker: row.speaker,
      source: row.source,
      liveAudioCapture: false,
    },
  })
  return row
}

export async function listVoiceConversationTurns(args: {
  voiceInterfaceProfileId?: string
  agentProfileId?: string
  limit?: number
} = {}): Promise<VoiceConversationTurnRow[]> {
  const filters = [
    args.voiceInterfaceProfileId
      ? eq(schema.voiceConversationTurns.voiceInterfaceProfileId, args.voiceInterfaceProfileId)
      : undefined,
    args.agentProfileId ? eq(schema.voiceConversationTurns.agentProfileId, args.agentProfileId) : undefined,
  ].filter(Boolean)
  return db.query.voiceConversationTurns.findMany({
    where: filters.length > 0 ? and(...filters) : undefined,
    orderBy: [desc(schema.voiceConversationTurns.createdAt)],
    limit: Math.min(Math.max(args.limit ?? 50, 1), 200),
  })
}

export async function getVoiceConversationContext(args: {
  voiceInterfaceProfileId?: string
  agentProfileId?: string
  limit?: number
}): Promise<JsonObject> {
  const profiles = await listVoiceInterfaceProfiles({
    agentProfileId: args.agentProfileId,
    limit: 5,
  })
  const activeProfile = args.voiceInterfaceProfileId
    ? await getOptionalVoiceProfile(args.voiceInterfaceProfileId)
    : profiles[0] ?? null
  const turns = await listVoiceConversationTurns({
    voiceInterfaceProfileId: activeProfile?.id,
    agentProfileId: args.agentProfileId,
    limit: args.limit ?? 10,
  })
  return {
    profileId: activeProfile?.id ?? null,
    inputMode: activeProfile?.inputMode ?? 'push_to_talk',
    language: activeProfile?.language ?? 'en-US',
    speakOn: activeProfile?.speakOn ?? [],
    liveAudioCapture: false,
    liveTtsPlayback: false,
    turns: turns
      .slice()
      .reverse()
      .map((turn) => ({
        speaker: turn.speaker,
        speakerLabel: turn.speakerLabel,
        text: turn.text,
        status: turn.status,
        createdAt: turn.createdAt,
      })),
  }
}

async function getOptionalVoiceProfile(id: string): Promise<VoiceInterfaceProfileRow | null> {
  return (
    (await db.query.voiceInterfaceProfiles.findFirst({
      where: eq(schema.voiceInterfaceProfiles.id, id),
    })) ?? null
  )
}

function clampSpeed(value: number): number {
  if (!Number.isFinite(value)) return 1
  return Math.min(Math.max(value, 0.25), 3)
}

function normalizeNullable(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? ''
  return trimmed ? trimmed : null
}
