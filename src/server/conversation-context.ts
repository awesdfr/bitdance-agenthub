import { and, desc, eq, inArray, ne } from 'drizzle-orm'
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions'

import { db, schema } from '@/db/client'
import type { ArtifactRow, MessageRow } from '@/db/schema'
import type { MessagePart } from '@/shared/types'

/**
 * 把 conversation messages 序列化成 OpenAI ChatMessage 数组，给 CustomAgentAdapter 拼到
 * [system, ...history, currentUser] 中间，让 agent 跨 run 记住上下文。
 *
 * 详细规格见 specs/13-conversation-context.md。
 */

export interface BuildHistoryOptions {
  /** 取最近多少条 messages（不含 pinned）。默认 20。 */
  maxTurns?: number
  /** 是否注入 pinned messages。默认 true。 */
  includePinned?: boolean
  /** 当前触发消息 id；它不应进入历史（避免重复）。 */
  excludeMessageId?: string
}

const DEFAULT_MAX_TURNS = 20

export async function buildHistoryFor(
  agentId: string,
  conversationId: string,
  options: BuildHistoryOptions = {},
): Promise<ChatCompletionMessageParam[]> {
  const maxTurns = options.maxTurns ?? DEFAULT_MAX_TURNS
  const includePinned = options.includePinned ?? true
  const excludeMessageId = options.excludeMessageId

  // 拉最近 N 条 complete 消息（按时间逆序取，下面再翻回正序）
  const recentWhere = excludeMessageId
    ? and(
        eq(schema.messages.conversationId, conversationId),
        eq(schema.messages.status, 'complete'),
        ne(schema.messages.id, excludeMessageId),
      )
    : and(
        eq(schema.messages.conversationId, conversationId),
        eq(schema.messages.status, 'complete'),
      )

  const recent = await db
    .select()
    .from(schema.messages)
    .where(recentWhere)
    .orderBy(desc(schema.messages.createdAt))
    .limit(maxTurns)

  // pinned 消息：可能在最近 N 条之外，单独拉
  let pinned: MessageRow[] = []
  if (includePinned) {
    const conv = await db.query.conversations.findFirst({
      where: eq(schema.conversations.id, conversationId),
    })
    const pinnedIds = (conv?.pinnedMessageIds ?? []).filter((id) => id !== excludeMessageId)
    if (pinnedIds.length > 0) {
      pinned = await db
        .select()
        .from(schema.messages)
        .where(
          and(
            inArray(schema.messages.id, pinnedIds),
            eq(schema.messages.status, 'complete'),
          ),
        )
    }
  }

  // 合并去重，按时间升序
  const byId = new Map<string, MessageRow>()
  for (const m of recent) byId.set(m.id, m)
  for (const m of pinned) byId.set(m.id, m)
  const merged = Array.from(byId.values()).sort((a, b) => a.createdAt - b.createdAt)

  // 批量取 artifact title 给 artifact_ref 折叠用
  const artifactIds = collectArtifactIds(merged)
  const artifactTitles = await loadArtifactTitles(artifactIds)

  const out: ChatCompletionMessageParam[] = []
  for (const msg of merged) {
    const serialized = serializeMessage(msg, agentId, artifactTitles)
    if (serialized) out.push(...serialized)
  }
  return out
}

// ─── 序列化核心 ─────────────────────────────────────────

function serializeMessage(
  msg: MessageRow,
  currentAgentId: string,
  artifactTitles: Map<string, string>,
): ChatCompletionMessageParam[] | null {
  if (msg.role === 'system') return null // system prompt 由 agent-runner 注入，不进 history

  if (msg.role === 'user') {
    const content = renderUserParts(msg.parts)
    if (!content) return null
    return [{ role: 'user', content }]
  }

  // role === 'agent'
  if (msg.role === 'agent') {
    // Phase A / B：只处理「自己」的 agent message；他人的留给 Phase C
    if (msg.agentId !== currentAgentId) return null
    return renderSelfAssistantParts(msg.parts, artifactTitles)
  }

  return null
}

function renderUserParts(parts: MessagePart[]): string {
  const buf: string[] = []
  for (const p of parts) {
    switch (p.type) {
      case 'text':
        buf.push(p.content)
        break
      case 'image_attachment':
        buf.push(`[图片附件: ${p.fileName}]`)
        break
      case 'file_attachment':
        buf.push(`[文件附件: ${p.fileName}]`)
        break
      // user 不应出现 thinking/tool_use/tool_result/code/artifact_ref，跳过
      default:
        break
    }
  }
  return buf.join('\n').trim()
}

function renderSelfAssistantParts(
  parts: MessagePart[],
  artifactTitles: Map<string, string>,
): ChatCompletionMessageParam[] | null {
  // 先把 parts 拆成「文本类」和「工具调用 + 对应结果」
  const textBuf: string[] = []
  const toolUses: Array<{ callId: string; toolName: string; args: unknown }> = []
  const toolResults = new Map<string, { result: unknown; isError: boolean }>()

  for (const p of parts) {
    switch (p.type) {
      case 'text':
        if (p.content) textBuf.push(p.content)
        break
      case 'code':
        if (p.content) textBuf.push(p.content)
        break
      case 'artifact_ref': {
        const title = artifactTitles.get(p.artifactId) ?? ''
        textBuf.push(title ? `[产物: ${title} (id=${p.artifactId})]` : `[产物 ${p.artifactId}]`)
        break
      }
      case 'tool_use':
        toolUses.push({ callId: p.callId, toolName: p.toolName, args: p.args })
        break
      case 'tool_result':
        toolResults.set(p.callId, { result: p.result, isError: p.isError })
        break
      // thinking 一律丢
      default:
        break
    }
  }

  // 任何 tool_use 缺对应 tool_result → 整条消息跳过（OpenAI 不接受悬挂的 tool_call_id）
  for (const tu of toolUses) {
    if (!toolResults.has(tu.callId)) return null
  }

  const text = textBuf.join('\n').trim()
  const hasTools = toolUses.length > 0
  if (!text && !hasTools) return null

  const messages: ChatCompletionMessageParam[] = []

  if (hasTools) {
    // assistant message with tool_calls
    messages.push({
      role: 'assistant',
      content: text || null,
      tool_calls: toolUses.map((t) => ({
        id: t.callId,
        type: 'function' as const,
        function: {
          name: t.toolName,
          arguments: JSON.stringify(t.args ?? {}),
        },
      })),
    })
    // each tool_call 跟一条 tool message
    for (const t of toolUses) {
      const r = toolResults.get(t.callId)!
      messages.push({
        role: 'tool',
        tool_call_id: t.callId,
        content: stringifyToolResult(r.result, r.isError),
      })
    }
  } else {
    // 纯文本 assistant
    messages.push({ role: 'assistant', content: text })
  }

  return messages
}

function stringifyToolResult(result: unknown, isError: boolean): string {
  if (typeof result === 'string') return isError ? `[error] ${result}` : result
  try {
    const s = JSON.stringify(result)
    return isError ? `[error] ${s}` : s
  } catch {
    return isError ? '[error] (unserializable)' : '(unserializable)'
  }
}

// ─── 批量取 artifact title ───────────────────────────────

function collectArtifactIds(messages: MessageRow[]): string[] {
  const ids = new Set<string>()
  for (const m of messages) {
    if (m.role !== 'agent') continue
    for (const p of m.parts) {
      if (p.type === 'artifact_ref') ids.add(p.artifactId)
    }
  }
  return Array.from(ids)
}

async function loadArtifactTitles(ids: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  if (ids.length === 0) return out
  const rows = await db
    .select({ id: schema.artifacts.id, title: schema.artifacts.title })
    .from(schema.artifacts)
    .where(inArray(schema.artifacts.id, ids))
  for (const r of rows as Pick<ArtifactRow, 'id' | 'title'>[]) {
    out.set(r.id, r.title)
  }
  return out
}
