import type { AgentRow, ConversationRow, MessageRow } from '@/db/schema'

async function json<T>(req: Promise<Response>): Promise<T> {
  const res = await req
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`HTTP ${res.status}: ${body || res.statusText}`)
  }
  return res.json() as Promise<T>
}

// ─── Agents ─────────────────────────────────────
export async function fetchAgents(): Promise<AgentRow[]> {
  const { agents } = await json<{ agents: AgentRow[] }>(fetch('/api/agents'))
  return agents
}

// ─── Conversations ──────────────────────────────
export async function fetchConversations(): Promise<ConversationRow[]> {
  const { conversations } = await json<{ conversations: ConversationRow[] }>(
    fetch('/api/conversations'),
  )
  return conversations
}

export interface CreateConversationBody {
  title?: string
  mode: 'single' | 'group'
  agentIds: string[]
}

export async function createConversation(body: CreateConversationBody): Promise<ConversationRow> {
  const { conversation } = await json<{ conversation: ConversationRow }>(
    fetch('/api/conversations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
  )
  return conversation
}

// ─── Messages ───────────────────────────────────
export async function fetchMessages(conversationId: string): Promise<MessageRow[]> {
  const { messages } = await json<{ messages: MessageRow[] }>(
    fetch(`/api/conversations/${conversationId}/messages`),
  )
  return messages
}

export interface SendMessageBody {
  content: string
  mentionedAgentIds?: string[]
}

export interface SendMessageResult {
  messageId: string
  runIds: string[]
}

export async function sendMessage(
  conversationId: string,
  body: SendMessageBody,
): Promise<SendMessageResult> {
  return json<SendMessageResult>(
    fetch(`/api/conversations/${conversationId}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
  )
}

// ─── Runs ───────────────────────────────────────
export async function abortRun(runId: string): Promise<void> {
  await json<{ ok: true }>(fetch(`/api/runs/${runId}/abort`, { method: 'POST' }))
}
