'use client'

import {
  Bot,
  CheckCircle2,
  GitMerge,
  Loader2,
  MessageSquare,
  RefreshCw,
  Send,
  SquarePen,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Textarea } from '@/components/ui/textarea'
import type {
  AgentMessageType,
  AgentCommunicationProtocolRow,
  AgentProtocolMessageRow,
  AgentProtocolMessageType,
  AgentProtocolPriority,
  AgentProfileRow,
  BlackboardEntryRow,
  BlackboardScopeType,
  ConflictEscalationRow,
  ConflictResolutionRow,
  InterAgentMessageRow,
  JsonObject,
  RealtimeCollabResolution,
  RealtimeCollabSessionRow,
  RealtimeEditOperationKind,
  RealtimeEditOperationRow,
  RealtimeParticipantType,
  RealtimeSegmentLockRow,
} from '@/db/schema'
import {
  acquireRealtimeSegmentLock,
  applyRealtimeEditOperation,
  createConflictResolution,
  createAgentProtocolMessage,
  createRealtimeCollabSession,
  fetchAgentCommunicationProtocols,
  fetchAgentMessages,
  fetchAgentProtocolMessages,
  fetchAgentProfiles,
  fetchBlackboardEntries,
  fetchConflictEscalations,
  fetchConflictResolutions,
  fetchRealtimeCollabSessions,
  fetchRealtimeEditOperations,
  fetchRealtimeSegmentLocks,
  releaseRealtimeSegmentLock,
  resolveConflictResolution,
  sendAgentMessage,
  seedAgentCommunicationProtocol,
  advanceConflictEscalation,
  writeBlackboardEntry,
} from '@/lib/api'

const messageTypes: AgentMessageType[] = ['status', 'handoff', 'question', 'artifact', 'warning']
const protocolMessageTypes: AgentProtocolMessageType[] = [
  'status',
  'handoff',
  'question',
  'artifact',
  'warning',
  'request',
  'response',
  'proposal',
]
const protocolPriorities: AgentProtocolPriority[] = ['low', 'normal', 'high', 'urgent']
const scopeTypes: BlackboardScopeType[] = ['workflow_run', 'project', 'workspace', 'global']
const realtimeResolutions: RealtimeCollabResolution[] = ['user_wins', 'agent_wins', 'manual_merge']
const realtimeParticipants: RealtimeParticipantType[] = ['agent', 'user', 'system']

type LoadingAction =
  | 'reload'
  | 'message'
  | 'protocol-seed'
  | 'protocol-message'
  | 'blackboard'
  | 'conflict'
  | 'escalate'
  | 'resolve'
  | 'realtime-session'
  | 'realtime-lock'
  | 'realtime-edit'
  | 'realtime-release'
  | null

export function CollaborationCenter() {
  const [agents, setAgents] = useState<AgentProfileRow[]>([])
  const [messages, setMessages] = useState<InterAgentMessageRow[]>([])
  const [protocols, setProtocols] = useState<AgentCommunicationProtocolRow[]>([])
  const [protocolMessages, setProtocolMessages] = useState<AgentProtocolMessageRow[]>([])
  const [blackboardEntries, setBlackboardEntries] = useState<BlackboardEntryRow[]>([])
  const [conflicts, setConflicts] = useState<ConflictResolutionRow[]>([])
  const [conflictEscalations, setConflictEscalations] = useState<ConflictEscalationRow[]>([])
  const [realtimeSessions, setRealtimeSessions] = useState<RealtimeCollabSessionRow[]>([])
  const [realtimeLocks, setRealtimeLocks] = useState<RealtimeSegmentLockRow[]>([])
  const [realtimeOperations, setRealtimeOperations] = useState<RealtimeEditOperationRow[]>([])

  const [channel, setChannel] = useState('default')
  const [senderAgentId, setSenderAgentId] = useState('')
  const [recipientAgentId, setRecipientAgentId] = useState('')
  const [messageType, setMessageType] = useState<AgentMessageType>('status')
  const [messageText, setMessageText] = useState('Shared status: I finished my step and produced the expected artifact.')
  const [protocolType, setProtocolType] = useState<AgentProtocolMessageType>('handoff')
  const [protocolPriority, setProtocolPriority] = useState<AgentProtocolPriority>('normal')
  const [protocolIntent, setProtocolIntent] = useState('handoff_completed_step')
  const [protocolSignature, setProtocolSignature] = useState('')

  const [scopeType, setScopeType] = useState<BlackboardScopeType>('workspace')
  const [scopeId, setScopeId] = useState('local_workspace')
  const [blackboardKey, setBlackboardKey] = useState('current_plan')
  const [blackboardText, setBlackboardText] = useState('{"summary":"Agents share progress and next actions here."}')

  const [conflictDraft, setConflictDraft] = useState({
    resourceType: 'blackboard_entry',
    resourceId: 'current_plan',
    conflictType: 'priority_disagreement',
    summary: 'Two Agents proposed different next steps; request arbitration.',
    participants: '',
  })
  const [resolutionText, setResolutionText] = useState('{"decision":"Use the lower-risk plan and ask the design Agent to verify the artifact."}')
  const [selectedConflictId, setSelectedConflictId] = useState('')
  const [selectedRealtimeSessionId, setSelectedRealtimeSessionId] = useState('')
  const [realtimeSessionDraft, setRealtimeSessionDraft] = useState({
    documentPath: 'src/components/example.tsx',
    conflictResolution: 'user_wins' as RealtimeCollabResolution,
  })
  const [realtimeLockDraft, setRealtimeLockDraft] = useState({
    participantType: 'agent' as RealtimeParticipantType,
    participantId: '',
    startLine: '42',
    endLine: '58',
    cursorLine: '42',
    cursorColumn: '1',
  })
  const [realtimeEditDraft, setRealtimeEditDraft] = useState({
    operationKind: 'replace' as RealtimeEditOperationKind,
    startLine: '42',
    endLine: '58',
    newText: 'updated segment from collaborator',
  })

  const [loadingAction, setLoadingAction] = useState<LoadingAction>('reload')
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const agentNames = useMemo(() => new Map(agents.map((agent) => [agent.id, agent.name])), [agents])
  const openConflicts = conflicts.filter((conflict) => conflict.status === 'open')
  const activeBlackboard = blackboardEntries.filter((entry) => entry.status === 'active')
  const activeRealtimeLocks = realtimeLocks.filter((lock) => lock.status === 'active')
  const selectedRealtimeSession = realtimeSessions.find((session) => session.id === selectedRealtimeSessionId) ?? realtimeSessions[0]
  const selectedConflictEscalations = conflictEscalations.filter(
    (escalation) => escalation.conflictResolutionId === selectedConflictId,
  )

  const reload = useCallback(async () => {
    setLoadingAction('reload')
    setError(null)
    try {
      const [
        agentsNext,
        messagesNext,
        protocolsNext,
        protocolMessagesNext,
        blackboardNext,
        conflictsNext,
        escalationsNext,
        realtimeSessionsNext,
        realtimeLocksNext,
        realtimeOperationsNext,
      ] = await Promise.all([
        fetchAgentProfiles(),
        fetchAgentMessages({ channel: channel || undefined }),
        fetchAgentCommunicationProtocols({ limit: 10 }),
        fetchAgentProtocolMessages({ limit: 50 }),
        fetchBlackboardEntries({ scopeType, scopeId: scopeId || undefined }),
        fetchConflictResolutions(),
        fetchConflictEscalations(),
        fetchRealtimeCollabSessions(),
        fetchRealtimeSegmentLocks(),
        fetchRealtimeEditOperations(),
      ])
      setAgents(agentsNext)
      setMessages(messagesNext)
      setProtocols(protocolsNext)
      setProtocolMessages(protocolMessagesNext)
      setBlackboardEntries(blackboardNext)
      setConflicts(conflictsNext)
      setConflictEscalations(escalationsNext)
      setRealtimeSessions(realtimeSessionsNext)
      setRealtimeLocks(realtimeLocksNext)
      setRealtimeOperations(realtimeOperationsNext)
      if (!senderAgentId && agentsNext[0]) setSenderAgentId(agentsNext[0].id)
      if (!recipientAgentId && agentsNext[1]) setRecipientAgentId(agentsNext[1].id)
      if (!selectedConflictId && conflictsNext[0]) setSelectedConflictId(conflictsNext[0].id)
      if (!selectedRealtimeSessionId && realtimeSessionsNext[0]) {
        setSelectedRealtimeSessionId(realtimeSessionsNext[0].id)
      }
      setNotice(`Loaded ${messagesNext.length} messages, ${protocolMessagesNext.length} protocol envelopes, ${blackboardNext.length} blackboard entries, ${conflictsNext.length} conflicts, and ${realtimeLocksNext.length} realtime locks.`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load collaboration data.')
    } finally {
      setLoadingAction(null)
    }
  }, [
    channel,
    recipientAgentId,
    scopeId,
    scopeType,
    selectedConflictId,
    selectedRealtimeSessionId,
    senderAgentId,
  ])

  useEffect(() => {
    void reload()
  }, [reload])

  const handleSendMessage = async () => {
    setLoadingAction('message')
    setError(null)
    try {
      const message = await sendAgentMessage({
        senderAgentProfileId: senderAgentId || null,
        recipientAgentProfileId: recipientAgentId || null,
        channel,
        messageType,
        content: {
          text: messageText,
          createdFrom: 'collaboration_center',
        },
      })
      setMessages((current) => [...current, message])
      setNotice(`Sent ${messageType} message on ${message.channel}.`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send message.')
    } finally {
      setLoadingAction(null)
    }
  }

  const handleSeedProtocol = async () => {
    setLoadingAction('protocol-seed')
    setError(null)
    try {
      const seeded = await seedAgentCommunicationProtocol()
      setProtocols(seeded)
      setNotice(`Seeded Agent communication protocol v${seeded[0]?.version ?? '1.0'}.`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to seed Agent communication protocol.')
    } finally {
      setLoadingAction(null)
    }
  }

  const handleSendProtocolMessage = async () => {
    setLoadingAction('protocol-message')
    setError(null)
    try {
      const protocolMessage = await createAgentProtocolMessage({
        protocolId: protocols[0]?.id,
        header: {
          from: senderAgentId || 'system',
          to: recipientAgentId || null,
          type: protocolType,
          priority: protocolPriority,
          replyTo: null,
        },
        body: {
          intent: protocolIntent,
          detail: messageText,
          context: {
            artifacts: [],
            memories: [],
            files: [],
          },
          proposedAction: {
            action: 'continue_collaboration',
            channel,
          },
        },
        signature: protocolSignature || null,
      })
      setProtocolMessages((current) => [...current, protocolMessage])
      setNotice(`Created protocol envelope ${protocolMessage.messageId}.`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send protocol envelope.')
    } finally {
      setLoadingAction(null)
    }
  }

  const handleWriteBlackboard = async () => {
    setLoadingAction('blackboard')
    setError(null)
    try {
      const entry = await writeBlackboardEntry({
        scopeType,
        scopeId,
        key: blackboardKey,
        value: parseJsonObject(blackboardText),
        authorAgentProfileId: senderAgentId || null,
      })
      setBlackboardEntries(await fetchBlackboardEntries({ scopeType, scopeId }))
      setNotice(`Wrote blackboard key ${entry.key} v${entry.version}.`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to write blackboard entry.')
    } finally {
      setLoadingAction(null)
    }
  }

  const handleCreateConflict = async () => {
    setLoadingAction('conflict')
    setError(null)
    try {
      const conflict = await createConflictResolution({
        resourceType: conflictDraft.resourceType,
        resourceId: conflictDraft.resourceId,
        conflictType: conflictDraft.conflictType,
        summary: conflictDraft.summary,
        participants: conflictDraft.participants
          .split(',')
          .map((item) => item.trim())
          .filter(Boolean),
      })
      const conflictsNext = await fetchConflictResolutions()
      setConflicts(conflictsNext)
      setConflictEscalations(await fetchConflictEscalations())
      setSelectedConflictId(conflict.id)
      setNotice(`Opened conflict ${conflict.conflictType}.`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create conflict.')
    } finally {
      setLoadingAction(null)
    }
  }

  const handleEscalateConflict = async () => {
    if (!selectedConflictId) {
      setError('Select a conflict before escalating.')
      return
    }
    setLoadingAction('escalate')
    setError(null)
    try {
      const result = await advanceConflictEscalation(selectedConflictId, {
        reason: 'Escalated from Collaboration Center',
      })
      setConflicts(await fetchConflictResolutions())
      setConflictEscalations(await fetchConflictEscalations())
      setNotice(`Escalated to level ${result.escalation.level}: ${result.escalation.name}.`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to escalate conflict.')
    } finally {
      setLoadingAction(null)
    }
  }

  const handleResolveConflict = async () => {
    if (!selectedConflictId) {
      setError('Select a conflict before resolving.')
      return
    }
    setLoadingAction('resolve')
    setError(null)
    try {
      const resolved = await resolveConflictResolution(selectedConflictId, parseJsonObject(resolutionText))
      setConflicts(await fetchConflictResolutions())
      setConflictEscalations(await fetchConflictEscalations())
      setNotice(`Resolved conflict ${resolved.conflictType}.`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to resolve conflict.')
    } finally {
      setLoadingAction(null)
    }
  }

  const handleCreateRealtimeSession = async () => {
    setLoadingAction('realtime-session')
    setError(null)
    try {
      const session = await createRealtimeCollabSession({
        documentPath: realtimeSessionDraft.documentPath,
        conflictResolution: realtimeSessionDraft.conflictResolution,
        protocol: 'segment_lock',
        showAgentCursor: true,
        showAgentSelection: true,
        agentAwareOfUserEdits: true,
        createdBy: senderAgentId || null,
      })
      setRealtimeSessions(await fetchRealtimeCollabSessions())
      setSelectedRealtimeSessionId(session.id)
      setNotice(`Opened realtime co-edit session for ${session.documentPath}.`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to open realtime session.')
    } finally {
      setLoadingAction(null)
    }
  }

  const handleAcquireRealtimeLock = async () => {
    const session = selectedRealtimeSession
    if (!session) {
      setError('Create or select a realtime session first.')
      return
    }
    setLoadingAction('realtime-lock')
    setError(null)
    try {
      const result = await acquireRealtimeSegmentLock({
        sessionId: session.id,
        agentProfileId: realtimeLockDraft.participantType === 'agent' ? senderAgentId || null : null,
        participantType: realtimeLockDraft.participantType,
        participantId: realtimeLockDraft.participantId || senderAgentId || null,
        filePath: session.documentPath,
        startLine: parsePositiveInt(realtimeLockDraft.startLine, 'startLine'),
        endLine: parsePositiveInt(realtimeLockDraft.endLine, 'endLine'),
        cursorLine: parsePositiveInt(realtimeLockDraft.cursorLine, 'cursorLine'),
        cursorColumn: parseNonNegativeInt(realtimeLockDraft.cursorColumn, 'cursorColumn'),
      })
      setRealtimeLocks(await fetchRealtimeSegmentLocks())
      setConflicts(await fetchConflictResolutions())
      setNotice(`Realtime lock ${result.segmentLock.status} for lines ${result.segmentLock.startLine}-${result.segmentLock.endLine}.`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to acquire realtime lock.')
    } finally {
      setLoadingAction(null)
    }
  }

  const handleApplyRealtimeEdit = async () => {
    const session = selectedRealtimeSession
    const lock = activeRealtimeLocks.find((item) => item.sessionId === session?.id)
    if (!session || !lock) {
      setError('Acquire an active realtime lock before applying an edit.')
      return
    }
    setLoadingAction('realtime-edit')
    setError(null)
    try {
      const operation = await applyRealtimeEditOperation({
        sessionId: session.id,
        segmentLockId: lock.id,
        participantType: lock.participantType,
        participantId: lock.participantId,
        filePath: lock.filePath,
        operationKind: realtimeEditDraft.operationKind,
        startLine: parsePositiveInt(realtimeEditDraft.startLine, 'startLine'),
        endLine: parsePositiveInt(realtimeEditDraft.endLine, 'endLine'),
        baseVersion: session.currentVersion,
        newText: realtimeEditDraft.newText,
      })
      setRealtimeSessions(await fetchRealtimeCollabSessions())
      setRealtimeOperations(await fetchRealtimeEditOperations())
      setConflicts(await fetchConflictResolutions())
      setNotice(`Realtime edit ${operation.status}; base v${operation.baseVersion}.`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to apply realtime edit.')
    } finally {
      setLoadingAction(null)
    }
  }

  const handleReleaseRealtimeLock = async () => {
    const lock = activeRealtimeLocks[0]
    if (!lock) {
      setError('No active realtime lock to release.')
      return
    }
    setLoadingAction('realtime-release')
    setError(null)
    try {
      const released = await releaseRealtimeSegmentLock(lock.id)
      setRealtimeLocks(await fetchRealtimeSegmentLocks())
      setNotice(`Released realtime lock ${released.id}.`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to release realtime lock.')
    } finally {
      setLoadingAction(null)
    }
  }

  return (
    <div className="flex h-full flex-col">
      <div className="shrink-0 border-b p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <GitMerge className="size-4 text-primary" />
              <h2 className="truncate text-sm font-semibold">Collaboration Center</h2>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              Coordinate Agent employees through messages, shared blackboard state, and conflict records.
            </p>
          </div>
          <Button size="sm" variant="outline" onClick={() => void reload()} disabled={!!loadingAction}>
            {loadingAction === 'reload' ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <RefreshCw className="size-3.5" />
            )}
            Refresh
          </Button>
        </div>

        <div className="mt-3 grid grid-cols-6 gap-2">
          <Metric label="Agents" value={agents.length} icon={<Bot className="size-3.5" />} />
          <Metric label="Messages" value={messages.length} icon={<MessageSquare className="size-3.5" />} />
          <Metric label="Envelopes" value={protocolMessages.length} icon={<Send className="size-3.5" />} />
          <Metric label="Blackboard" value={activeBlackboard.length} icon={<SquarePen className="size-3.5" />} />
          <Metric label="Open Conflicts" value={openConflicts.length} icon={<GitMerge className="size-3.5" />} />
          <Metric label="Realtime Locks" value={activeRealtimeLocks.length} icon={<SquarePen className="size-3.5" />} />
        </div>

        {error && (
          <div className="mt-3 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            {error}
          </div>
        )}
        {notice && !error && (
          <div className="mt-3 rounded-md border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
            {notice}
          </div>
        )}
      </div>

      <ScrollArea className="min-h-0 flex-1">
        <div className="space-y-4 p-4">
          <section className="rounded-lg border bg-background">
            <div className="border-b p-3">
              <h3 className="text-sm font-semibold">Inter-Agent Messages</h3>
              <p className="text-xs text-muted-foreground">Send structured handoffs, questions, artifact notices, warnings, and status updates.</p>
            </div>
            <div className="space-y-3 p-3">
              <div className="grid grid-cols-2 gap-2">
                <label className="space-y-1 text-xs font-medium">
                  Sender
                  <AgentSelect value={senderAgentId} agents={agents} onChange={setSenderAgentId} emptyLabel="System" />
                </label>
                <label className="space-y-1 text-xs font-medium">
                  Recipient
                  <AgentSelect value={recipientAgentId} agents={agents} onChange={setRecipientAgentId} emptyLabel="Broadcast" />
                </label>
                <label className="space-y-1 text-xs font-medium">
                  Channel
                  <Input value={channel} onChange={(event) => setChannel(event.target.value)} className="h-9 text-xs" />
                </label>
                <label className="space-y-1 text-xs font-medium">
                  Type
                  <select
                    value={messageType}
                    onChange={(event) => setMessageType(event.target.value as AgentMessageType)}
                    className="h-9 w-full rounded-md border bg-background px-2 text-xs outline-none"
                  >
                    {messageTypes.map((type) => (
                      <option key={type} value={type}>
                        {type}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <Textarea value={messageText} onChange={(event) => setMessageText(event.target.value)} rows={3} className="text-xs" />
              <Button size="sm" onClick={() => void handleSendMessage()} disabled={!!loadingAction}>
                {loadingAction === 'message' ? <Loader2 className="size-3.5 animate-spin" /> : <Send className="size-3.5" />}
                Send Message
              </Button>

              <div className="grid gap-2">
                {messages.slice(-10).reverse().map((message) => (
                  <MessageItem key={message.id} message={message} agentNames={agentNames} />
                ))}
                {messages.length === 0 && (
                  <EmptyState title="No messages" body="Send a status, handoff, question, artifact notice, or warning between Agents." />
                )}
              </div>
            </div>
          </section>

          <section className="rounded-lg border bg-background">
            <div className="border-b p-3">
              <h3 className="text-sm font-semibold">Agent Communication Protocol</h3>
              <p className="text-xs text-muted-foreground">Create standard JSON envelopes with header, body, context, proposed action, TTL, and optional signature.</p>
            </div>
            <div className="space-y-3 p-3">
              <div className="grid grid-cols-2 gap-2">
                <label className="space-y-1 text-xs font-medium">
                  Protocol Type
                  <select
                    value={protocolType}
                    onChange={(event) => setProtocolType(event.target.value as AgentProtocolMessageType)}
                    className="h-9 w-full rounded-md border bg-background px-2 text-xs outline-none"
                  >
                    {protocolMessageTypes.map((type) => (
                      <option key={type} value={type}>
                        {type}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="space-y-1 text-xs font-medium">
                  Priority
                  <select
                    value={protocolPriority}
                    onChange={(event) => setProtocolPriority(event.target.value as AgentProtocolPriority)}
                    className="h-9 w-full rounded-md border bg-background px-2 text-xs outline-none"
                  >
                    {protocolPriorities.map((priority) => (
                      <option key={priority} value={priority}>
                        {priority}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="space-y-1 text-xs font-medium">
                  Intent
                  <Input
                    value={protocolIntent}
                    onChange={(event) => setProtocolIntent(event.target.value)}
                    className="h-9 text-xs"
                  />
                </label>
                <label className="space-y-1 text-xs font-medium">
                  Signature
                  <Input
                    value={protocolSignature}
                    onChange={(event) => setProtocolSignature(event.target.value)}
                    className="h-9 text-xs"
                    placeholder="optional"
                  />
                </label>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="outline" onClick={() => void handleSeedProtocol()} disabled={!!loadingAction}>
                  {loadingAction === 'protocol-seed' ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
                  Seed Protocol
                </Button>
                <Button size="sm" onClick={() => void handleSendProtocolMessage()} disabled={!!loadingAction}>
                  {loadingAction === 'protocol-message' ? <Loader2 className="size-3.5 animate-spin" /> : <Send className="size-3.5" />}
                  Create Envelope
                </Button>
              </div>
              <div className="grid gap-2">
                {protocols.slice(0, 3).map((protocol) => (
                  <div key={protocol.id} className="rounded-lg border bg-muted/20 p-2 text-xs">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium">{protocol.name}</span>
                      <Badge variant="secondary">v{protocol.version}</Badge>
                    </div>
                    <div className="mt-1 text-[11px] text-muted-foreground">
                      header {protocol.headerFields.length} / body {protocol.bodyFields.length} / context {protocol.contextFields.length}
                    </div>
                  </div>
                ))}
                {protocolMessages.slice(-8).reverse().map((message) => (
                  <div key={message.id} className="rounded-lg border bg-muted/20 p-2 text-xs">
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate font-medium">{message.intent}</span>
                      <Badge variant="secondary">{message.priority}</Badge>
                    </div>
                    <div className="mt-1 line-clamp-2 text-[11px] text-muted-foreground">
                      {message.fromAgentId || 'system'} {' -> '} {message.toAgentId || 'broadcast'} / {message.messageType} / {message.messageId}
                    </div>
                  </div>
                ))}
                {protocols.length === 0 && protocolMessages.length === 0 && (
                  <EmptyState title="No protocol envelopes" body="Seed the protocol and create a standard Agent-to-Agent envelope." />
                )}
              </div>
            </div>
          </section>

          <section className="rounded-lg border bg-background">
            <div className="border-b p-3">
              <h3 className="text-sm font-semibold">Shared Blackboard</h3>
              <p className="text-xs text-muted-foreground">Persist versioned shared state for a workflow, project, workspace, or global scope.</p>
            </div>
            <div className="space-y-3 p-3">
              <div className="grid grid-cols-2 gap-2">
                <label className="space-y-1 text-xs font-medium">
                  Scope
                  <select
                    value={scopeType}
                    onChange={(event) => setScopeType(event.target.value as BlackboardScopeType)}
                    className="h-9 w-full rounded-md border bg-background px-2 text-xs outline-none"
                  >
                    {scopeTypes.map((scope) => (
                      <option key={scope} value={scope}>
                        {scope}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="space-y-1 text-xs font-medium">
                  Scope ID
                  <Input value={scopeId} onChange={(event) => setScopeId(event.target.value)} className="h-9 text-xs" />
                </label>
                <label className="space-y-1 text-xs font-medium">
                  Key
                  <Input value={blackboardKey} onChange={(event) => setBlackboardKey(event.target.value)} className="h-9 text-xs" />
                </label>
                <label className="space-y-1 text-xs font-medium">
                  Author
                  <AgentSelect value={senderAgentId} agents={agents} onChange={setSenderAgentId} emptyLabel="System" />
                </label>
              </div>
              <Textarea value={blackboardText} onChange={(event) => setBlackboardText(event.target.value)} rows={4} className="font-mono text-xs" />
              <Button size="sm" onClick={() => void handleWriteBlackboard()} disabled={!!loadingAction}>
                {loadingAction === 'blackboard' ? <Loader2 className="size-3.5 animate-spin" /> : <SquarePen className="size-3.5" />}
                Write Blackboard
              </Button>

              <div className="grid gap-2">
                {blackboardEntries.slice(0, 12).map((entry) => (
                  <BlackboardItem key={entry.id} entry={entry} agentNames={agentNames} />
                ))}
                {blackboardEntries.length === 0 && (
                  <EmptyState title="No blackboard entries" body="Write a key to create versioned shared memory for collaborating Agents." />
                )}
              </div>
            </div>
          </section>

          <section className="rounded-lg border bg-background">
            <div className="border-b p-3">
              <h3 className="text-sm font-semibold">Realtime Co-edit</h3>
              <p className="text-xs text-muted-foreground">Coordinate user and Agent edits with visible segment locks, cursors, and merge status.</p>
            </div>
            <div className="space-y-3 p-3">
              <div className="grid grid-cols-2 gap-2">
                <label className="space-y-1 text-xs font-medium">
                  Document Path
                  <Input
                    value={realtimeSessionDraft.documentPath}
                    onChange={(event) =>
                      setRealtimeSessionDraft((draft) => ({ ...draft, documentPath: event.target.value }))
                    }
                    className="h-9 text-xs"
                  />
                </label>
                <label className="space-y-1 text-xs font-medium">
                  Conflict Resolution
                  <select
                    value={realtimeSessionDraft.conflictResolution}
                    onChange={(event) =>
                      setRealtimeSessionDraft((draft) => ({
                        ...draft,
                        conflictResolution: event.target.value as RealtimeCollabResolution,
                      }))
                    }
                    className="h-9 w-full rounded-md border bg-background px-2 text-xs outline-none"
                  >
                    {realtimeResolutions.map((resolution) => (
                      <option key={resolution} value={resolution}>
                        {resolution}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" onClick={() => void handleCreateRealtimeSession()} disabled={!!loadingAction}>
                  {loadingAction === 'realtime-session' ? <Loader2 className="size-3.5 animate-spin" /> : <SquarePen className="size-3.5" />}
                  Open Realtime Session
                </Button>
                <select
                  value={selectedRealtimeSessionId}
                  onChange={(event) => setSelectedRealtimeSessionId(event.target.value)}
                  className="h-8 min-w-0 flex-1 rounded-md border bg-background px-2 text-xs outline-none"
                >
                  <option value="">Latest realtime session</option>
                  {realtimeSessions.map((session) => (
                    <option key={session.id} value={session.id}>
                      {session.documentPath} v{session.currentVersion}
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-3 gap-2">
                <label className="space-y-1 text-xs font-medium">
                  Participant
                  <select
                    value={realtimeLockDraft.participantType}
                    onChange={(event) =>
                      setRealtimeLockDraft((draft) => ({
                        ...draft,
                        participantType: event.target.value as RealtimeParticipantType,
                      }))
                    }
                    className="h-9 w-full rounded-md border bg-background px-2 text-xs outline-none"
                  >
                    {realtimeParticipants.map((participant) => (
                      <option key={participant} value={participant}>
                        {participant}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="space-y-1 text-xs font-medium">
                  Start
                  <Input
                    value={realtimeLockDraft.startLine}
                    onChange={(event) =>
                      setRealtimeLockDraft((draft) => ({ ...draft, startLine: event.target.value }))
                    }
                    className="h-9 text-xs"
                    type="number"
                  />
                </label>
                <label className="space-y-1 text-xs font-medium">
                  End
                  <Input
                    value={realtimeLockDraft.endLine}
                    onChange={(event) =>
                      setRealtimeLockDraft((draft) => ({ ...draft, endLine: event.target.value }))
                    }
                    className="h-9 text-xs"
                    type="number"
                  />
                </label>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" onClick={() => void handleAcquireRealtimeLock()} disabled={!!loadingAction}>
                  {loadingAction === 'realtime-lock' ? <Loader2 className="size-3.5 animate-spin" /> : <GitMerge className="size-3.5" />}
                  Acquire Segment Lock
                </Button>
                <Button variant="outline" size="sm" onClick={() => void handleReleaseRealtimeLock()} disabled={!!loadingAction}>
                  {loadingAction === 'realtime-release' ? <Loader2 className="size-3.5 animate-spin" /> : <CheckCircle2 className="size-3.5" />}
                  Release Latest Lock
                </Button>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <label className="space-y-1 text-xs font-medium">
                  Operation Text
                  <Input
                    value={realtimeEditDraft.newText}
                    onChange={(event) =>
                      setRealtimeEditDraft((draft) => ({ ...draft, newText: event.target.value }))
                    }
                    className="h-9 text-xs"
                  />
                </label>
                <label className="space-y-1 text-xs font-medium">
                  Operation
                  <select
                    value={realtimeEditDraft.operationKind}
                    onChange={(event) =>
                      setRealtimeEditDraft((draft) => ({
                        ...draft,
                        operationKind: event.target.value as RealtimeEditOperationKind,
                      }))
                    }
                    className="h-9 w-full rounded-md border bg-background px-2 text-xs outline-none"
                  >
                    {['replace', 'insert', 'delete'].map((kind) => (
                      <option key={kind} value={kind}>
                        {kind}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <Button size="sm" onClick={() => void handleApplyRealtimeEdit()} disabled={!!loadingAction}>
                {loadingAction === 'realtime-edit' ? <Loader2 className="size-3.5 animate-spin" /> : <SquarePen className="size-3.5" />}
                Apply Realtime Edit
              </Button>

              <div className="grid gap-2">
                {realtimeLocks.slice(0, 6).map((lock) => (
                  <RealtimeLockItem key={lock.id} lock={lock} />
                ))}
                {realtimeOperations.slice(0, 4).map((operation) => (
                  <RealtimeOperationItem key={operation.id} operation={operation} />
                ))}
                {realtimeLocks.length === 0 && realtimeOperations.length === 0 && (
                  <EmptyState title="No realtime edits" body="Open a session, acquire a line segment lock, and apply an edit." />
                )}
              </div>
            </div>
          </section>

          <section className="rounded-lg border bg-background">
            <div className="border-b p-3">
              <h3 className="text-sm font-semibold">Conflict Arbitration</h3>
              <p className="text-xs text-muted-foreground">Open and resolve disagreements over artifacts, plans, resources, or blackboard state.</p>
            </div>
            <div className="space-y-3 p-3">
              <div className="grid grid-cols-2 gap-2">
                <label className="space-y-1 text-xs font-medium">
                  Resource Type
                  <Input
                    value={conflictDraft.resourceType}
                    onChange={(event) => setConflictDraft((draft) => ({ ...draft, resourceType: event.target.value }))}
                    className="h-9 text-xs"
                  />
                </label>
                <label className="space-y-1 text-xs font-medium">
                  Resource ID
                  <Input
                    value={conflictDraft.resourceId}
                    onChange={(event) => setConflictDraft((draft) => ({ ...draft, resourceId: event.target.value }))}
                    className="h-9 text-xs"
                  />
                </label>
                <label className="space-y-1 text-xs font-medium">
                  Conflict Type
                  <Input
                    value={conflictDraft.conflictType}
                    onChange={(event) => setConflictDraft((draft) => ({ ...draft, conflictType: event.target.value }))}
                    className="h-9 text-xs"
                  />
                </label>
                <label className="space-y-1 text-xs font-medium">
                  Participants
                  <Input
                    value={conflictDraft.participants}
                    onChange={(event) => setConflictDraft((draft) => ({ ...draft, participants: event.target.value }))}
                    placeholder="agent_id_a, agent_id_b"
                    className="h-9 text-xs"
                  />
                </label>
              </div>
              <Textarea
                value={conflictDraft.summary}
                onChange={(event) => setConflictDraft((draft) => ({ ...draft, summary: event.target.value }))}
                rows={3}
                className="text-xs"
              />
              <Button size="sm" onClick={() => void handleCreateConflict()} disabled={!!loadingAction}>
                {loadingAction === 'conflict' ? <Loader2 className="size-3.5 animate-spin" /> : <GitMerge className="size-3.5" />}
                Open Conflict
              </Button>

              <div className="rounded-md border p-3">
                <label className="space-y-1 text-xs font-medium">
                  Resolve Conflict
                  <select
                    value={selectedConflictId}
                    onChange={(event) => setSelectedConflictId(event.target.value)}
                    className="h-9 w-full rounded-md border bg-background px-2 text-xs outline-none"
                  >
                    <option value="">No conflict selected</option>
                    {conflicts.map((conflict) => (
                      <option key={conflict.id} value={conflict.id}>
                        {conflict.conflictType} - {conflict.status}
                      </option>
                    ))}
                  </select>
                </label>
                <Textarea
                  value={resolutionText}
                  onChange={(event) => setResolutionText(event.target.value)}
                  rows={3}
                  className="mt-2 font-mono text-xs"
                />
                <div className="mt-2 flex flex-wrap gap-2">
                  <Button size="sm" onClick={() => void handleResolveConflict()} disabled={!!loadingAction || !selectedConflictId}>
                    {loadingAction === 'resolve' ? <Loader2 className="size-3.5 animate-spin" /> : <CheckCircle2 className="size-3.5" />}
                    Resolve Conflict
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => void handleEscalateConflict()}
                    disabled={!!loadingAction || !selectedConflictId}
                  >
                    {loadingAction === 'escalate' ? <Loader2 className="size-3.5 animate-spin" /> : <Bot className="size-3.5" />}
                    Escalate
                  </Button>
                </div>
                <div className="mt-3 grid gap-1">
                  {selectedConflictEscalations.length === 0 ? (
                    <p className="text-[11px] text-muted-foreground">No escalation path yet.</p>
                  ) : (
                    selectedConflictEscalations.map((escalation) => (
                      <EscalationItem key={escalation.id} escalation={escalation} />
                    ))
                  )}
                </div>
              </div>

              <div className="grid gap-2">
                {conflicts.slice(0, 12).map((conflict) => (
                  <ConflictItem key={conflict.id} conflict={conflict} />
                ))}
                {conflicts.length === 0 && (
                  <EmptyState title="No conflicts" body="Open a conflict when Agents disagree about resources, artifacts, plans, or shared state." />
                )}
              </div>
            </div>
          </section>
        </div>
      </ScrollArea>
    </div>
  )
}

function AgentSelect({
  value,
  agents,
  onChange,
  emptyLabel,
}: {
  value: string
  agents: AgentProfileRow[]
  onChange: (value: string) => void
  emptyLabel: string
}) {
  return (
    <select
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className="h-9 w-full rounded-md border bg-background px-2 text-xs outline-none"
    >
      <option value="">{emptyLabel}</option>
      {agents.map((agent) => (
        <option key={agent.id} value={agent.id}>
          {agent.name}
        </option>
      ))}
    </select>
  )
}

function Metric({
  label,
  value,
  icon,
}: {
  label: string
  value: ReactNode
  icon: ReactNode
}) {
  return (
    <div className="rounded-md border bg-background p-2">
      <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
        {icon}
        {label}
      </div>
      <div className="mt-1 truncate text-sm font-semibold tabular-nums">{value}</div>
    </div>
  )
}

function MessageItem({
  message,
  agentNames,
}: {
  message: InterAgentMessageRow
  agentNames: Map<string, string>
}) {
  const sender = message.senderAgentProfileId ? agentNames.get(message.senderAgentProfileId) ?? message.senderAgentProfileId : 'System'
  const recipient = message.recipientAgentProfileId ? agentNames.get(message.recipientAgentProfileId) ?? message.recipientAgentProfileId : 'Broadcast'
  return (
    <div className="rounded-md border px-3 py-2">
      <div className="flex items-center justify-between gap-2">
        <span className="min-w-0 truncate text-xs font-semibold">
          {sender} {'->'} {recipient}
        </span>
        <Badge variant="outline" className="text-[10px]">
          {message.messageType}
        </Badge>
      </div>
      <p className="mt-1 line-clamp-2 text-[11px] text-muted-foreground">{summarizeObject(message.content)}</p>
    </div>
  )
}

function BlackboardItem({
  entry,
  agentNames,
}: {
  entry: BlackboardEntryRow
  agentNames: Map<string, string>
}) {
  const author = entry.authorAgentProfileId ? agentNames.get(entry.authorAgentProfileId) ?? entry.authorAgentProfileId : 'System'
  return (
    <div className="rounded-md border px-3 py-2">
      <div className="flex items-center justify-between gap-2">
        <span className="min-w-0 truncate text-xs font-semibold">{entry.key}</span>
        <Badge variant={entry.status === 'active' ? 'default' : 'secondary'} className="text-[10px]">
          v{entry.version} {entry.status}
        </Badge>
      </div>
      <p className="mt-1 text-[11px] text-muted-foreground">
        {entry.scopeType}:{entry.scopeId} by {author}
      </p>
      <p className="mt-1 line-clamp-2 font-mono text-[11px] text-muted-foreground">{summarizeObject(entry.value)}</p>
    </div>
  )
}

function ConflictItem({ conflict }: { conflict: ConflictResolutionRow }) {
  return (
    <div className="rounded-md border px-3 py-2">
      <div className="flex items-center justify-between gap-2">
        <span className="min-w-0 truncate text-xs font-semibold">{conflict.conflictType}</span>
        <Badge variant={conflict.status === 'resolved' ? 'default' : 'secondary'} className="text-[10px]">
          {conflict.status}
        </Badge>
      </div>
      <p className="mt-1 line-clamp-2 text-[11px] text-muted-foreground">
        {conflict.resourceType}:{conflict.resourceId} - {conflict.summary || 'No summary'}
      </p>
      {conflict.resolution && (
        <p className="mt-1 line-clamp-2 font-mono text-[11px] text-muted-foreground">
          {summarizeObject(conflict.resolution)}
        </p>
      )}
    </div>
  )
}

function EscalationItem({ escalation }: { escalation: ConflictEscalationRow }) {
  return (
    <div className="rounded-md border px-2 py-1.5 text-[11px]">
      <div className="flex items-center justify-between gap-2">
        <span className="truncate font-medium">
          L{escalation.level} {escalation.name}
        </span>
        <Badge variant={escalation.status === 'forced' ? 'default' : 'secondary'} className="text-[10px]">
          {escalation.status}
        </Badge>
      </div>
      <p className="mt-1 truncate text-muted-foreground">
        {escalation.action} / attempts {escalation.attempts}
        {escalation.maxAttempts ? `/${escalation.maxAttempts}` : ''}
      </p>
    </div>
  )
}

function RealtimeLockItem({ lock }: { lock: RealtimeSegmentLockRow }) {
  return (
    <div className="rounded-md border px-3 py-2">
      <div className="flex items-center justify-between gap-2">
        <span className="min-w-0 truncate text-xs font-semibold">
          {lock.participantType} {lock.filePath}:{lock.startLine}-{lock.endLine}
        </span>
        <Badge variant={lock.status === 'active' ? 'default' : 'secondary'} className="text-[10px]">
          {lock.status}
        </Badge>
      </div>
      <p className="mt-1 text-[11px] text-muted-foreground">
        cursor {lock.cursorLine ?? lock.startLine}:{lock.cursorColumn ?? 0}
        {lock.conflictId ? ` - conflict ${lock.conflictId}` : ''}
      </p>
    </div>
  )
}

function RealtimeOperationItem({ operation }: { operation: RealtimeEditOperationRow }) {
  return (
    <div className="rounded-md border px-3 py-2">
      <div className="flex items-center justify-between gap-2">
        <span className="min-w-0 truncate text-xs font-semibold">
          {operation.operationKind} {operation.filePath}:{operation.startLine}-{operation.endLine}
        </span>
        <Badge variant={operation.status === 'applied' ? 'default' : 'secondary'} className="text-[10px]">
          {operation.status}
        </Badge>
      </div>
      <p className="mt-1 line-clamp-2 font-mono text-[11px] text-muted-foreground">
        {summarizeObject(operation.result)}
      </p>
    </div>
  )
}

function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-md border border-dashed px-3 py-6 text-center">
      <div className="text-xs font-semibold">{title}</div>
      <p className="mt-1 text-[11px] text-muted-foreground">{body}</p>
    </div>
  )
}

function parsePositiveInt(value: string, label: string): number {
  const parsed = Number.parseInt(value, 10)
  if (!Number.isFinite(parsed) || parsed < 1) throw new Error(`${label} must be a positive integer.`)
  return parsed
}

function parseNonNegativeInt(value: string, label: string): number {
  const parsed = Number.parseInt(value, 10)
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`${label} must be zero or a positive integer.`)
  }
  return parsed
}

function parseJsonObject(text: string): JsonObject {
  const parsed: unknown = JSON.parse(text)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('JSON payload must be an object.')
  }
  return parsed as JsonObject
}

function summarizeObject(value: JsonObject) {
  const text = typeof value.text === 'string' ? value.text : ''
  if (text) return text
  return JSON.stringify(value).slice(0, 220)
}
