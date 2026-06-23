import { and, asc, desc, eq, inArray } from 'drizzle-orm'

import { db, schema } from '@/db/client'
import type {
  AgentMessageType,
  BlackboardEntryRow,
  ConflictEscalationAction,
  ConflictEscalationRow,
  BlackboardScopeType,
  ConflictResolutionRow,
  InterAgentMessageRow,
  JsonObject,
  RealtimeCollabProtocol,
  RealtimeCollabResolution,
  RealtimeCollabSessionRow,
  RealtimeEditOperationKind,
  RealtimeEditOperationRow,
  RealtimeParticipantType,
  RealtimeSegmentLockRow,
} from '@/db/schema'
import {
  newBlackboardEntryId,
  newConflictEscalationId,
  newConflictResolutionId,
  newInterAgentMessageId,
  newRealtimeCollabSessionId,
  newRealtimeEditOperationId,
  newRealtimeSegmentLockId,
} from '@/server/ids'
import { createNotification } from '@/server/notification-service'
import { recordAuditLog } from '@/server/security-service'

export interface SendAgentMessageArgs {
  senderAgentProfileId?: string | null
  recipientAgentProfileId?: string | null
  workflowRunId?: string | null
  employeeRunId?: string | null
  channel?: string
  messageType?: AgentMessageType
  content: JsonObject
}

export async function sendAgentMessage(
  args: SendAgentMessageArgs,
): Promise<InterAgentMessageRow> {
  const row: InterAgentMessageRow = {
    id: newInterAgentMessageId(),
    senderAgentProfileId: normalizeNullable(args.senderAgentProfileId),
    recipientAgentProfileId: normalizeNullable(args.recipientAgentProfileId),
    workflowRunId: normalizeNullable(args.workflowRunId),
    employeeRunId: normalizeNullable(args.employeeRunId),
    channel: args.channel?.trim() || 'default',
    messageType: args.messageType ?? 'status',
    content: args.content,
    status: 'sent',
    createdAt: Date.now(),
    readAt: null,
  }
  await db.insert(schema.interAgentMessages).values(row)
  await recordAuditLog({
    actorType: row.senderAgentProfileId ? 'agent' : 'system',
    actorId: row.senderAgentProfileId,
    action: 'collaboration.message.send',
    resourceType: 'inter_agent_message',
    resourceId: row.id,
    message: `Inter-agent message sent on ${row.channel}.`,
    metadata: {
      recipientAgentProfileId: row.recipientAgentProfileId,
      workflowRunId: row.workflowRunId,
      employeeRunId: row.employeeRunId,
      messageType: row.messageType,
    },
  })
  return row
}

export async function listAgentMessages(args: {
  channel?: string
  recipientAgentProfileId?: string
} = {}): Promise<InterAgentMessageRow[]> {
  const where =
    args.channel && args.recipientAgentProfileId
      ? and(
          eq(schema.interAgentMessages.channel, args.channel),
          eq(schema.interAgentMessages.recipientAgentProfileId, args.recipientAgentProfileId),
        )
      : args.channel
        ? eq(schema.interAgentMessages.channel, args.channel)
        : args.recipientAgentProfileId
          ? eq(schema.interAgentMessages.recipientAgentProfileId, args.recipientAgentProfileId)
          : undefined
  return db.query.interAgentMessages.findMany({
    where,
    orderBy: [asc(schema.interAgentMessages.createdAt)],
    limit: 100,
  })
}

export interface WriteBlackboardEntryArgs {
  scopeType: BlackboardScopeType
  scopeId: string
  key: string
  value: JsonObject
  authorAgentProfileId?: string | null
}

export async function writeBlackboardEntry(
  args: WriteBlackboardEntryArgs,
): Promise<BlackboardEntryRow> {
  const scopeId = normalizeRequired(args.scopeId, 'scopeId')
  const key = normalizeRequired(args.key, 'key')
  const previous = await db.query.blackboardEntries.findFirst({
    where: and(
      eq(schema.blackboardEntries.scopeType, args.scopeType),
      eq(schema.blackboardEntries.scopeId, scopeId),
      eq(schema.blackboardEntries.key, key),
      eq(schema.blackboardEntries.status, 'active'),
    ),
    orderBy: [desc(schema.blackboardEntries.version)],
  })
  if (previous) {
    await db
      .update(schema.blackboardEntries)
      .set({ status: 'superseded', updatedAt: Date.now() })
      .where(eq(schema.blackboardEntries.id, previous.id))
  }
  const now = Date.now()
  const row: BlackboardEntryRow = {
    id: newBlackboardEntryId(),
    scopeType: args.scopeType,
    scopeId,
    key,
    value: args.value,
    authorAgentProfileId: normalizeNullable(args.authorAgentProfileId),
    version: (previous?.version ?? 0) + 1,
    status: 'active',
    createdAt: now,
    updatedAt: now,
  }
  await db.insert(schema.blackboardEntries).values(row)
  await recordAuditLog({
    actorType: row.authorAgentProfileId ? 'agent' : 'system',
    actorId: row.authorAgentProfileId,
    action: 'collaboration.blackboard.write',
    resourceType: 'blackboard_entry',
    resourceId: row.id,
    message: `Blackboard entry ${row.key} updated to version ${row.version}.`,
    metadata: { scopeType: row.scopeType, scopeId: row.scopeId },
  })
  return row
}

export async function listBlackboardEntries(args: {
  scopeType?: BlackboardScopeType
  scopeId?: string
} = {}): Promise<BlackboardEntryRow[]> {
  const where =
    args.scopeType && args.scopeId
      ? and(
          eq(schema.blackboardEntries.scopeType, args.scopeType),
          eq(schema.blackboardEntries.scopeId, args.scopeId),
        )
      : undefined
  return db.query.blackboardEntries.findMany({
    where,
    orderBy: [asc(schema.blackboardEntries.key), desc(schema.blackboardEntries.version)],
    limit: 100,
  })
}

export interface CreateConflictResolutionArgs {
  resourceType: string
  resourceId: string
  conflictType: string
  participants?: string[]
  summary?: string
}

export async function createConflictResolution(
  args: CreateConflictResolutionArgs,
): Promise<ConflictResolutionRow> {
  const row: ConflictResolutionRow = {
    id: newConflictResolutionId(),
    resourceType: normalizeRequired(args.resourceType, 'resourceType'),
    resourceId: normalizeRequired(args.resourceId, 'resourceId'),
    conflictType: normalizeRequired(args.conflictType, 'conflictType'),
    participants: normalizeStringArray(args.participants),
    status: 'open',
    summary: args.summary?.trim() ?? '',
    resolution: null,
    createdAt: Date.now(),
    resolvedAt: null,
  }
  await db.insert(schema.conflictResolutions).values(row)
  await recordAuditLog({
    actorType: 'system',
    action: 'collaboration.conflict.open',
    resourceType: row.resourceType,
    resourceId: row.resourceId,
    riskLevel: 'medium',
    status: 'warning',
    message: row.summary || `Conflict ${row.conflictType} opened.`,
    metadata: { conflictResolutionId: row.id, participants: row.participants },
  })
  return row
}

export async function resolveConflictResolution(
  id: string,
  resolution: JsonObject,
): Promise<ConflictResolutionRow> {
  const existing = await getRequiredConflictResolution(id)
  await db
    .update(schema.conflictResolutions)
    .set({
      status: 'resolved',
      resolution,
      resolvedAt: Date.now(),
    })
    .where(eq(schema.conflictResolutions.id, id))
  await recordAuditLog({
    actorType: 'system',
    action: 'collaboration.conflict.resolve',
    resourceType: existing.resourceType,
    resourceId: existing.resourceId,
    message: `Conflict ${existing.conflictType} resolved.`,
    metadata: { conflictResolutionId: id },
  })
  return getRequiredConflictResolution(id)
}

export async function listConflictResolutions(): Promise<ConflictResolutionRow[]> {
  return db.query.conflictResolutions.findMany({
    orderBy: [desc(schema.conflictResolutions.createdAt)],
    limit: 100,
  })
}

const conflictEscalationLevels: Array<{
  level: number
  name: string
  action: ConflictEscalationAction
  maxAttempts?: number
  timeoutMs?: number
}> = [
  {
    level: 1,
    name: 'automatic_negotiation',
    action: 'automatic_negotiation',
    maxAttempts: 3,
    timeoutMs: 5 * 60 * 1000,
  },
  {
    level: 2,
    name: 'meta_agent_arbitration',
    action: 'meta_agent_arbitration',
    timeoutMs: 2 * 60 * 1000,
  },
  {
    level: 3,
    name: 'notify_user',
    action: 'notify_user',
  },
  {
    level: 4,
    name: 'pause_participants',
    action: 'pause_participants',
    timeoutMs: 60 * 60 * 1000,
  },
  {
    level: 5,
    name: 'force_conservative_decision',
    action: 'force_conservative_decision',
  },
]

export async function listConflictEscalations(
  conflictResolutionId?: string,
): Promise<ConflictEscalationRow[]> {
  return db.query.conflictEscalations.findMany({
    where: conflictResolutionId
      ? eq(schema.conflictEscalations.conflictResolutionId, conflictResolutionId)
      : undefined,
    orderBy: [asc(schema.conflictEscalations.createdAt)],
    limit: 100,
  })
}

export async function advanceConflictEscalation(args: {
  conflictResolutionId: string
  reason?: string
  forceLevel?: number
  now?: number
}): Promise<{
  conflictResolution: ConflictResolutionRow
  escalation: ConflictEscalationRow
  escalations: ConflictEscalationRow[]
}> {
  const conflict = await getRequiredConflictResolution(args.conflictResolutionId)
  if (conflict.status === 'resolved' && !args.forceLevel) {
    throw new Error(`Conflict ${conflict.id} is already resolved.`)
  }
  const now = args.now ?? Date.now()
  const escalations = await listConflictEscalations(conflict.id)
  const latest = escalations.at(-1) ?? null

  if (!args.forceLevel && latest?.level === 1 && latest.attempts + 1 < (latest.maxAttempts ?? 3)) {
    const attempts = latest.attempts + 1
    await db
      .update(schema.conflictEscalations)
      .set({
        attempts,
        updatedAt: now,
        recommendation: buildEscalationRecommendation(conflict, 'automatic_negotiation', args.reason, {
          attempts,
          maxAttempts: latest.maxAttempts ?? 3,
        }),
      })
      .where(eq(schema.conflictEscalations.id, latest.id))
    const updated = await getRequiredConflictEscalation(latest.id)
    await markConflictEscalated(conflict.id, now)
    return {
      conflictResolution: await getRequiredConflictResolution(conflict.id),
      escalation: updated,
      escalations: await listConflictEscalations(conflict.id),
    }
  }

  if (!args.forceLevel && latest?.level === 1 && latest.attempts + 1 >= (latest.maxAttempts ?? 3)) {
    await db
      .update(schema.conflictEscalations)
      .set({
        attempts: latest.maxAttempts ?? 3,
        status: 'timed_out',
        updatedAt: now,
        completedAt: now,
      })
      .where(eq(schema.conflictEscalations.id, latest.id))
  } else if (latest && latest.level < 5) {
    await db
      .update(schema.conflictEscalations)
      .set({
        status: latest.dueAt && latest.dueAt <= now ? 'timed_out' : 'completed',
        updatedAt: now,
        completedAt: now,
      })
      .where(eq(schema.conflictEscalations.id, latest.id))
  }

  const nextLevel = Math.min(
    Math.max(args.forceLevel ?? ((latest?.level ?? 0) + 1), 1),
    conflictEscalationLevels.length,
  )
  const config = conflictEscalationLevels[nextLevel - 1]
  const recommendation = buildEscalationRecommendation(conflict, config.action, args.reason, {
    attempts: config.level === 1 ? 1 : 0,
    maxAttempts: config.maxAttempts,
  })
  const sideEffect = await applyEscalationSideEffects(conflict, config.action, recommendation, now)
  const row: ConflictEscalationRow = {
    id: newConflictEscalationId(),
    conflictResolutionId: conflict.id,
    level: config.level,
    name: config.name,
    action: config.action,
    maxAttempts: config.maxAttempts ?? null,
    attempts: config.level === 1 ? 1 : 0,
    timeoutMs: config.timeoutMs ?? null,
    status:
      config.action === 'force_conservative_decision'
        ? 'forced'
        : config.action === 'notify_user' || config.action === 'pause_participants'
          ? 'waiting'
          : 'active',
    recommendation: { ...recommendation, ...sideEffect },
    createdAt: now,
    updatedAt: now,
    dueAt: config.timeoutMs ? now + config.timeoutMs : null,
    completedAt: config.action === 'force_conservative_decision' ? now : null,
  }
  await db.insert(schema.conflictEscalations).values(row)

  if (config.action === 'force_conservative_decision') {
    await resolveConflictResolution(conflict.id, row.recommendation)
  } else {
    await markConflictEscalated(conflict.id, now)
  }
  await recordAuditLog({
    actorType: 'system',
    action: 'collaboration.conflict.escalate',
    resourceType: conflict.resourceType,
    resourceId: conflict.resourceId,
    status: config.action === 'force_conservative_decision' ? 'allowed' : 'warning',
    riskLevel: config.level >= 4 ? 'high' : 'medium',
    message: `Conflict ${conflict.conflictType} escalated to level ${config.level}: ${config.name}.`,
    metadata: {
      conflictResolutionId: conflict.id,
      conflictEscalationId: row.id,
      action: config.action,
      participants: conflict.participants,
    },
  })
  return {
    conflictResolution: await getRequiredConflictResolution(conflict.id),
    escalation: row,
    escalations: await listConflictEscalations(conflict.id),
  }
}

export interface CreateRealtimeCollabSessionArgs {
  documentPath: string
  protocol?: RealtimeCollabProtocol
  conflictResolution?: RealtimeCollabResolution
  showAgentCursor?: boolean
  showAgentSelection?: boolean
  agentAwareOfUserEdits?: boolean
  createdBy?: string | null
}

export interface AcquireRealtimeSegmentLockArgs {
  sessionId: string
  employeeRunId?: string | null
  agentProfileId?: string | null
  participantType: RealtimeParticipantType
  participantId?: string | null
  filePath?: string | null
  startLine: number
  endLine: number
  cursorLine?: number | null
  cursorColumn?: number | null
  expiresAt?: number | null
}

export interface ApplyRealtimeEditOperationArgs {
  sessionId: string
  segmentLockId?: string | null
  participantType: RealtimeParticipantType
  participantId?: string | null
  filePath?: string | null
  operationKind: RealtimeEditOperationKind
  startLine: number
  endLine: number
  baseVersion: number
  newText?: string | null
}

export async function createRealtimeCollabSession(
  args: CreateRealtimeCollabSessionArgs,
): Promise<RealtimeCollabSessionRow> {
  const now = Date.now()
  const row: RealtimeCollabSessionRow = {
    id: newRealtimeCollabSessionId(),
    documentPath: normalizeRequired(args.documentPath, 'documentPath'),
    protocol: args.protocol ?? 'segment_lock',
    conflictResolution: args.conflictResolution ?? 'user_wins',
    showAgentCursor: args.showAgentCursor ?? true,
    showAgentSelection: args.showAgentSelection ?? true,
    agentAwareOfUserEdits: args.agentAwareOfUserEdits ?? true,
    status: 'active',
    currentVersion: 1,
    createdBy: normalizeNullable(args.createdBy),
    createdAt: now,
    updatedAt: now,
  }
  await db.insert(schema.realtimeCollabSessions).values(row)
  await recordAuditLog({
    actorType: 'system',
    actorId: row.createdBy,
    action: 'collaboration.realtime_session.create',
    resourceType: 'realtime_collab_session',
    resourceId: row.id,
    message: `Realtime collaboration session opened for ${row.documentPath}.`,
    metadata: {
      protocol: row.protocol,
      conflictResolution: row.conflictResolution,
      showAgentCursor: row.showAgentCursor,
      showAgentSelection: row.showAgentSelection,
      agentAwareOfUserEdits: row.agentAwareOfUserEdits,
    },
  })
  return row
}

export async function listRealtimeCollabSessions(): Promise<RealtimeCollabSessionRow[]> {
  return db.query.realtimeCollabSessions.findMany({
    orderBy: [desc(schema.realtimeCollabSessions.updatedAt)],
    limit: 100,
  })
}

export async function acquireRealtimeSegmentLock(
  args: AcquireRealtimeSegmentLockArgs,
): Promise<{
  segmentLock: RealtimeSegmentLockRow
  conflicts: RealtimeSegmentLockRow[]
  conflictResolution: ConflictResolutionRow | null
}> {
  const session = await getRequiredRealtimeCollabSession(args.sessionId)
  const range = normalizeLineRange(args.startLine, args.endLine)
  const filePath = normalizeNullable(args.filePath) ?? session.documentPath
  const activeLocks = (await db.query.realtimeSegmentLocks.findMany({
    where: and(
      eq(schema.realtimeSegmentLocks.sessionId, session.id),
      eq(schema.realtimeSegmentLocks.status, 'active'),
    ),
  })).filter((lock) => lock.filePath === filePath && rangesOverlap(range.startLine, range.endLine, lock.startLine, lock.endLine))
  const conflict = activeLocks.length
    ? await createConflictResolution({
        resourceType: 'realtime_collab_segment',
        resourceId: `${filePath}:${range.startLine}-${range.endLine}`,
        conflictType: 'overlapping_segment_lock',
        participants: [
          participantLabel(args.participantType, args.participantId ?? args.agentProfileId),
          ...activeLocks.map((lock) => participantLabel(lock.participantType, lock.participantId ?? lock.agentProfileId)),
        ],
        summary: `Realtime edit overlap on ${filePath} lines ${range.startLine}-${range.endLine}.`,
      })
    : null
  const shouldGrant = shouldGrantConflictingLock(session.conflictResolution, args.participantType, activeLocks)
  if (conflict && shouldGrant) {
    const superseded = activeLocks.filter((lock) => lock.participantType !== args.participantType)
    for (const lock of superseded) {
      await db
        .update(schema.realtimeSegmentLocks)
        .set({ status: 'conflicted', conflictId: conflict.id, releasedAt: Date.now() })
        .where(eq(schema.realtimeSegmentLocks.id, lock.id))
    }
  }
  const now = Date.now()
  const row: RealtimeSegmentLockRow = {
    id: newRealtimeSegmentLockId(),
    sessionId: session.id,
    employeeRunId: normalizeNullable(args.employeeRunId),
    agentProfileId: normalizeNullable(args.agentProfileId),
    participantType: args.participantType,
    participantId: normalizeNullable(args.participantId),
    filePath,
    startLine: range.startLine,
    endLine: range.endLine,
    cursorLine: normalizeOptionalNumber(args.cursorLine),
    cursorColumn: normalizeOptionalNumber(args.cursorColumn),
    status: activeLocks.length && !shouldGrant ? 'conflicted' : 'active',
    conflictId: conflict?.id ?? null,
    createdAt: now,
    expiresAt: normalizeOptionalNumber(args.expiresAt),
    releasedAt: activeLocks.length && !shouldGrant ? now : null,
  }
  await db.insert(schema.realtimeSegmentLocks).values(row)
  await db
    .update(schema.realtimeCollabSessions)
    .set({ updatedAt: now })
    .where(eq(schema.realtimeCollabSessions.id, session.id))
  await recordAuditLog({
    actorType: row.participantType === 'agent' ? 'agent' : 'system',
    actorId: row.agentProfileId ?? row.participantId,
    action: 'collaboration.realtime_segment_lock.acquire',
    resourceType: 'realtime_segment_lock',
    resourceId: row.id,
    status: row.status === 'active' ? 'allowed' : 'warning',
    riskLevel: row.status === 'active' ? 'low' : 'medium',
    message: `Realtime ${row.participantType} lock ${row.status} for ${row.filePath}:${row.startLine}-${row.endLine}.`,
    metadata: { sessionId: session.id, conflictId: row.conflictId, conflictCount: activeLocks.length },
  })
  return { segmentLock: row, conflicts: activeLocks, conflictResolution: conflict }
}

export async function releaseRealtimeSegmentLock(id: string): Promise<RealtimeSegmentLockRow> {
  const existing = await getRequiredRealtimeSegmentLock(id)
  const now = Date.now()
  await db
    .update(schema.realtimeSegmentLocks)
    .set({ status: 'released', releasedAt: now })
    .where(eq(schema.realtimeSegmentLocks.id, id))
  await db
    .update(schema.realtimeCollabSessions)
    .set({ updatedAt: now })
    .where(eq(schema.realtimeCollabSessions.id, existing.sessionId))
  await recordAuditLog({
    actorType: existing.participantType === 'agent' ? 'agent' : 'system',
    actorId: existing.agentProfileId ?? existing.participantId,
    action: 'collaboration.realtime_segment_lock.release',
    resourceType: 'realtime_segment_lock',
    resourceId: id,
    message: `Realtime segment lock released for ${existing.filePath}.`,
  })
  return getRequiredRealtimeSegmentLock(id)
}

export async function listRealtimeSegmentLocks(sessionId?: string): Promise<RealtimeSegmentLockRow[]> {
  return db.query.realtimeSegmentLocks.findMany({
    where: sessionId ? eq(schema.realtimeSegmentLocks.sessionId, sessionId) : undefined,
    orderBy: [desc(schema.realtimeSegmentLocks.createdAt)],
    limit: 100,
  })
}

export async function applyRealtimeEditOperation(
  args: ApplyRealtimeEditOperationArgs,
): Promise<RealtimeEditOperationRow> {
  const session = await getRequiredRealtimeCollabSession(args.sessionId)
  const lock = args.segmentLockId ? await getRequiredRealtimeSegmentLock(args.segmentLockId) : null
  const range = normalizeLineRange(args.startLine, args.endLine)
  const filePath = normalizeNullable(args.filePath) ?? lock?.filePath ?? session.documentPath
  const lockProblem = lock && lock.status !== 'active' ? `segment lock is ${lock.status}` : null
  const versionProblem =
    args.baseVersion !== session.currentVersion
      ? `base version ${args.baseVersion} does not match current version ${session.currentVersion}`
      : null
  const conflict =
    lockProblem || versionProblem
      ? await createConflictResolution({
          resourceType: 'realtime_collab_edit',
          resourceId: `${filePath}:${range.startLine}-${range.endLine}`,
          conflictType: lockProblem ? 'inactive_segment_lock' : 'stale_edit_version',
          participants: [participantLabel(args.participantType, args.participantId)],
          summary: lockProblem ?? versionProblem ?? 'Realtime edit conflict.',
        })
      : null
  const now = Date.now()
  const status = conflict ? 'conflict' : 'applied'
  const result: JsonObject = conflict
    ? { autoMerged: false, reason: conflict.summary, currentVersion: session.currentVersion }
    : {
        autoMerged: true,
        mergedRange: { startLine: range.startLine, endLine: range.endLine },
        newVersion: session.currentVersion + 1,
      }
  const row: RealtimeEditOperationRow = {
    id: newRealtimeEditOperationId(),
    sessionId: session.id,
    segmentLockId: lock?.id ?? null,
    participantType: args.participantType,
    participantId: normalizeNullable(args.participantId),
    filePath,
    operationKind: args.operationKind,
    startLine: range.startLine,
    endLine: range.endLine,
    baseVersion: args.baseVersion,
    newText: normalizeNullable(args.newText),
    status,
    conflictId: conflict?.id ?? null,
    result,
    createdAt: now,
    appliedAt: status === 'applied' ? now : null,
  }
  await db.insert(schema.realtimeEditOperations).values(row)
  await db
    .update(schema.realtimeCollabSessions)
    .set({
      currentVersion: status === 'applied' ? session.currentVersion + 1 : session.currentVersion,
      updatedAt: now,
    })
    .where(eq(schema.realtimeCollabSessions.id, session.id))
  await recordAuditLog({
    actorType: row.participantType === 'agent' ? 'agent' : 'system',
    actorId: row.participantId,
    action: 'collaboration.realtime_edit.apply',
    resourceType: 'realtime_edit_operation',
    resourceId: row.id,
    status: status === 'applied' ? 'allowed' : 'warning',
    riskLevel: status === 'applied' ? 'low' : 'medium',
    message: `Realtime edit ${status} for ${row.filePath}:${row.startLine}-${row.endLine}.`,
    metadata: { sessionId: session.id, segmentLockId: row.segmentLockId, conflictId: row.conflictId },
  })
  return row
}

export async function listRealtimeEditOperations(sessionId?: string): Promise<RealtimeEditOperationRow[]> {
  return db.query.realtimeEditOperations.findMany({
    where: sessionId ? eq(schema.realtimeEditOperations.sessionId, sessionId) : undefined,
    orderBy: [desc(schema.realtimeEditOperations.createdAt)],
    limit: 100,
  })
}

async function getRequiredConflictResolution(id: string): Promise<ConflictResolutionRow> {
  const row = await db.query.conflictResolutions.findFirst({
    where: eq(schema.conflictResolutions.id, id),
  })
  if (!row) throw new Error(`Conflict resolution not found: ${id}`)
  return row
}

async function getRequiredConflictEscalation(id: string): Promise<ConflictEscalationRow> {
  const row = await db.query.conflictEscalations.findFirst({
    where: eq(schema.conflictEscalations.id, id),
  })
  if (!row) throw new Error(`Conflict escalation not found: ${id}`)
  return row
}

async function markConflictEscalated(conflictResolutionId: string, now: number): Promise<void> {
  await db
    .update(schema.conflictResolutions)
    .set({ status: 'escalated' })
    .where(eq(schema.conflictResolutions.id, conflictResolutionId))
  await recordAuditLog({
    actorType: 'system',
    action: 'collaboration.conflict.status.escalated',
    resourceType: 'conflict_resolution',
    resourceId: conflictResolutionId,
    status: 'warning',
    riskLevel: 'medium',
    message: `Conflict ${conflictResolutionId} entered the escalation path.`,
    metadata: { escalatedAt: now },
  })
}

function buildEscalationRecommendation(
  conflict: ConflictResolutionRow,
  action: ConflictEscalationAction,
  reason: string | undefined,
  extra: JsonObject = {},
): JsonObject {
  const base = {
    conflictResolutionId: conflict.id,
    conflictType: conflict.conflictType,
    resourceType: conflict.resourceType,
    resourceId: conflict.resourceId,
    participants: conflict.participants,
    reason: reason?.trim() || conflict.summary || 'Conflict escalation requested.',
  }
  if (action === 'automatic_negotiation') {
    return {
      ...base,
      action,
      instruction: 'Participants should propose a compromise and stop after maxAttempts.',
      ...extra,
    }
  }
  if (action === 'meta_agent_arbitration') {
    return {
      ...base,
      action,
      instruction: 'Meta Agent should compare participant claims and recommend the lowest-risk path.',
      timeoutPolicy: '2m',
      ...extra,
    }
  }
  if (action === 'notify_user') {
    return {
      ...base,
      action,
      notification: 'non_blocking',
      instruction: 'Notify the user without blocking unrelated Agent work.',
      ...extra,
    }
  }
  if (action === 'pause_participants') {
    return {
      ...base,
      action,
      instruction: 'Pause both conflict participants while waiting for user handling.',
      timeoutPolicy: '1h',
      onTimeout: 'use_conservative_option',
      ...extra,
    }
  }
  return {
    ...base,
    action,
    decision: 'use_conservative_option',
    fallback: 'cancel_conflicting_tasks_if_conservative_option_is_unsafe',
    instruction: 'End the loop with a conservative decision so Agents do not argue forever.',
    ...extra,
  }
}

async function applyEscalationSideEffects(
  conflict: ConflictResolutionRow,
  action: ConflictEscalationAction,
  recommendation: JsonObject,
  now: number,
): Promise<JsonObject> {
  if (action === 'notify_user') {
    const notification = await createNotification({
      channel: 'in_app',
      level: 'warning',
      sourceType: 'conflict_resolution',
      sourceId: conflict.id,
      title: `Conflict needs attention: ${conflict.conflictType}`,
      message: conflict.summary || 'Agent conflict reached user-notification escalation.',
      payload: recommendation,
    })
    return { notificationId: notification.id }
  }
  if (action === 'pause_participants') {
    const pausedRunIds = await pauseConflictParticipants(conflict.participants, now)
    return { pausedRunIds }
  }
  if (action === 'force_conservative_decision') {
    return { resolvedAt: now, resolutionSource: 'conflict_escalation' }
  }
  return {}
}

async function pauseConflictParticipants(participants: string[], now: number): Promise<string[]> {
  const participantIds = [...new Set(participants.map(extractParticipantId).filter(Boolean))]
  const pausedRunIds: string[] = []
  for (const participantId of participantIds) {
    const directRun = participantId.startsWith('er_')
      ? await db.query.employeeRuns.findFirst({ where: eq(schema.employeeRuns.id, participantId) })
      : null
    const agentRuns = directRun
      ? [directRun]
      : await db.query.employeeRuns.findMany({
          where: and(
            eq(schema.employeeRuns.agentProfileId, participantId),
            inArray(schema.employeeRuns.status, ['queued', 'running']),
          ),
        })
    for (const run of agentRuns) {
      if (run.status !== 'queued' && run.status !== 'running') continue
      await db
        .update(schema.employeeRuns)
        .set({
          status: 'paused',
          currentPhase: 'paused',
          currentStep: 'Paused by conflict escalation.',
          updatedAt: now,
        })
        .where(eq(schema.employeeRuns.id, run.id))
      pausedRunIds.push(run.id)
    }
  }
  return pausedRunIds
}

function extractParticipantId(participant: string): string {
  const trimmed = participant.trim()
  if (!trimmed) return ''
  const parts = trimmed.split(':')
  return parts.at(-1)?.trim() ?? ''
}

async function getRequiredRealtimeCollabSession(id: string): Promise<RealtimeCollabSessionRow> {
  const row = await db.query.realtimeCollabSessions.findFirst({
    where: eq(schema.realtimeCollabSessions.id, id),
  })
  if (!row) throw new Error(`Realtime collaboration session not found: ${id}`)
  return row
}

async function getRequiredRealtimeSegmentLock(id: string): Promise<RealtimeSegmentLockRow> {
  const row = await db.query.realtimeSegmentLocks.findFirst({
    where: eq(schema.realtimeSegmentLocks.id, id),
  })
  if (!row) throw new Error(`Realtime segment lock not found: ${id}`)
  return row
}

function normalizeLineRange(startLine: number, endLine: number): { startLine: number; endLine: number } {
  const start = Math.max(1, Math.floor(startLine))
  const end = Math.max(start, Math.floor(endLine))
  return { startLine: start, endLine: end }
}

function rangesOverlap(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart <= bEnd && bStart <= aEnd
}

function shouldGrantConflictingLock(
  resolution: RealtimeCollabResolution,
  participantType: RealtimeParticipantType,
  activeLocks: RealtimeSegmentLockRow[],
): boolean {
  if (activeLocks.length === 0) return true
  if (resolution === 'manual_merge') return false
  if (resolution === 'user_wins') return participantType === 'user'
  if (resolution === 'agent_wins') return participantType === 'agent'
  return false
}

function participantLabel(type: RealtimeParticipantType, id: string | null | undefined): string {
  return `${type}:${normalizeNullable(id) ?? 'anonymous'}`
}

function normalizeOptionalNumber(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? Math.floor(value) : null
}

function normalizeRequired(value: string | null | undefined, label: string): string {
  const trimmed = value?.trim() ?? ''
  if (!trimmed) throw new Error(`${label} is required.`)
  return trimmed
}

function normalizeNullable(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? ''
  return trimmed ? trimmed : null
}

function normalizeStringArray(values: string[] | undefined): string[] {
  return [...new Set((values ?? []).map((value) => value.trim()).filter(Boolean))]
}
