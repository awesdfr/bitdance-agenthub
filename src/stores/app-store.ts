'use client'

import { enableMapSet } from 'immer'
import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'

import type { AgentRunRow, AgentRow, ArtifactRow, ConversationRow, MessageRow } from '@/db/schema'
import type { MessagePart, StreamEvent } from '@/shared/types'

enableMapSet()

interface AppState {
  // ─── 实体 ──────────────────────────────────────────
  conversations: Record<string, ConversationRow>
  agents: Record<string, AgentRow>
  messages: Record<string, MessageRow>
  artifacts: Record<string, ArtifactRow>

  // ─── 关系（按 conversationId 分桶）───────────────
  messageIdsByConv: Record<string, string[]>
  runsByConv: Record<string, Record<string, AgentRunRow>>

  // ─── 当前会话 ──────────────────────────────────────
  activeConversationId: string | null

  // ─── 流连接状态 ────────────────────────────────────
  streamConnected: boolean

  // ─── actions ───────────────────────────────────────
  setStreamConnected(connected: boolean): void

  setConversations(list: ConversationRow[]): void
  upsertConversation(conv: ConversationRow): void

  setAgents(list: AgentRow[]): void

  setMessagesForConversation(conversationId: string, list: MessageRow[]): void
  setActiveConversation(id: string | null): void

  addLocalUserMessage(args: {
    tempId: string
    conversationId: string
    content: string
    mentionedAgentIds: string[]
  }): void
  replaceLocalMessageId(tempId: string, realId: string): void

  applyEvent(event: StreamEvent): void
}

export const useAppStore = create<AppState>()(
  immer((set) => ({
    conversations: {},
    agents: {},
    messages: {},
    artifacts: {},
    messageIdsByConv: {},
    runsByConv: {},
    activeConversationId: null,
    streamConnected: false,

    setStreamConnected: (connected) =>
      set((s) => {
        s.streamConnected = connected
      }),

    setConversations: (list) =>
      set((s) => {
        for (const c of list) s.conversations[c.id] = c
      }),

    upsertConversation: (conv) =>
      set((s) => {
        s.conversations[conv.id] = conv
      }),

    setAgents: (list) =>
      set((s) => {
        for (const a of list) s.agents[a.id] = a
      }),

    setMessagesForConversation: (conversationId, list) =>
      set((s) => {
        s.messageIdsByConv[conversationId] = list.map((m) => m.id)
        for (const m of list) s.messages[m.id] = m
      }),

    setActiveConversation: (id) =>
      set((s) => {
        s.activeConversationId = id
      }),

    addLocalUserMessage: ({ tempId, conversationId, content, mentionedAgentIds }) =>
      set((s) => {
        s.messages[tempId] = {
          id: tempId,
          conversationId,
          role: 'user',
          agentId: null,
          parts: [{ type: 'text', content }] as MessagePart[],
          status: 'complete',
          parentMessageId: null,
          mentionedAgentIds,
          runId: null,
          createdAt: Date.now(),
        }
        s.messageIdsByConv[conversationId] ??= []
        s.messageIdsByConv[conversationId].push(tempId)
      }),

    replaceLocalMessageId: (tempId, realId) =>
      set((s) => {
        const msg = s.messages[tempId]
        if (!msg) return
        s.messages[realId] = { ...msg, id: realId }
        delete s.messages[tempId]
        for (const convId in s.messageIdsByConv) {
          const arr = s.messageIdsByConv[convId]
          const idx = arr.indexOf(tempId)
          if (idx >= 0) arr[idx] = realId
        }
      }),

    applyEvent: (event) =>
      set((s) => {
        switch (event.type) {
          case 'heartbeat':
            return

          case 'run.start': {
            s.runsByConv[event.conversationId] ??= {}
            s.runsByConv[event.conversationId][event.runId] = {
              id: event.runId,
              conversationId: event.conversationId,
              agentId: event.agentId,
              triggerMessageId: event.triggerMessageId,
              status: 'running',
              error: null,
              parentRunId: event.parentRunId ?? null,
              startedAt: event.timestamp,
              finishedAt: null,
            }
            return
          }

          case 'run.end': {
            const run = s.runsByConv[event.conversationId]?.[event.runId]
            if (run) {
              run.status = event.status
              run.finishedAt = event.timestamp
              run.error = event.error ?? null
            }
            return
          }

          case 'message.start': {
            // 新 agent 消息（DB 端也插入了同 id 的行，前端再次接到是 idempotent）
            s.messages[event.messageId] = {
              id: event.messageId,
              conversationId: event.conversationId,
              role: 'agent',
              agentId: event.agentId,
              parts: [],
              status: 'streaming',
              parentMessageId: null,
              mentionedAgentIds: [],
              runId: event.runId,
              createdAt: event.timestamp,
            }
            s.messageIdsByConv[event.conversationId] ??= []
            if (!s.messageIdsByConv[event.conversationId].includes(event.messageId)) {
              s.messageIdsByConv[event.conversationId].push(event.messageId)
            }
            return
          }

          case 'message.end': {
            const msg = s.messages[event.messageId]
            if (msg) msg.status = 'complete'
            return
          }

          case 'part.start': {
            const msg = s.messages[event.messageId]
            if (!msg) return
            msg.parts[event.partIndex] = event.part
            return
          }

          case 'part.delta': {
            const msg = s.messages[event.messageId]
            if (!msg) return
            const part = msg.parts[event.partIndex]
            if (!part) return
            if (event.delta.type === 'text.append' && part.type === 'text') {
              part.content += event.delta.text
            } else if (event.delta.type === 'thinking.append' && part.type === 'thinking') {
              part.content += event.delta.text
            } else if (event.delta.type === 'code.append' && part.type === 'code') {
              part.content += event.delta.text
            }
            return
          }

          case 'part.end':
            return

          case 'tool.call': {
            const msg = s.messages[event.messageId]
            if (!msg) return
            msg.parts.push({
              type: 'tool_use',
              callId: event.callId,
              toolName: event.toolName,
              args: event.args,
            })
            return
          }

          case 'tool.result': {
            const msg = s.messages[event.messageId]
            if (!msg) return
            msg.parts.push({
              type: 'tool_result',
              callId: event.callId,
              result: event.result,
              isError: event.isError,
            })
            return
          }

          case 'artifact.create': {
            const a = event.artifact
            s.artifacts[a.id] = {
              ...a,
              parentArtifactId: a.parentArtifactId ?? null,
            }
            return
          }

          case 'artifact.update': {
            const art = s.artifacts[event.artifactId]
            if (!art) return
            art.content = { ...art.content, ...(event.patch as object) } as typeof art.content
            return
          }

          // dispatch.* 在 Orchestrator milestone 接入，先 noop
          default:
            return
        }
      }),
  })),
)

// ─── 派生 selector（避免组件里现场 filter）────────
export const selectMessagesForConversation = (conversationId: string) => (s: AppState) =>
  (s.messageIdsByConv[conversationId] ?? []).map((id) => s.messages[id]).filter(Boolean)

export const selectActiveConversation = (s: AppState) =>
  s.activeConversationId ? s.conversations[s.activeConversationId] : null

export const selectConversationList = (s: AppState) =>
  Object.values(s.conversations).sort((a, b) => b.updatedAt - a.updatedAt)
