import {
  Codex,
  type ApprovalMode,
  type Input as CodexInput,
  type SandboxMode,
  type ThreadEvent,
  type ThreadItem,
  type ThreadOptions,
  type Usage,
} from '@openai/codex-sdk'
import { eq } from 'drizzle-orm'

import { db, schema } from '@/db/client'
import { newMessageId, newToolCallId } from '@/server/ids'
import {
  codexResponsesCompatibilityError,
  isCodexResponsesMissingErrorMessage,
  validateCodexBaseUrl,
} from '@/shared/codex-compat'
import type { StreamEvent } from '@/shared/types'

import {
  adapterSessionKey,
  buildCodexChildProcessEnv,
  createAdapterEvent,
  createAdapterSessionStore,
  isAbortLikeError,
} from './adapter-utils'
import type { AdapterInput, AgentPlatformAdapter } from './types'

const DEFAULT_MODEL = 'gpt-5-codex'
const codexSessions = createAdapterSessionStore('codex')

export function clearCodexSession(conversationId: string): void {
  for (const key of codexSessions.keys()) {
    if (key.startsWith(`${conversationId}:`)) codexSessions.delete(key)
  }
}

export class CodexAdapter implements AgentPlatformAdapter {
  readonly name = 'codex' as const

  async *stream(input: AdapterInput, signal: AbortSignal): AsyncIterable<StreamEvent> {
    const baseUrlError = validateCodexBaseUrl(input.apiBaseUrl)
    if (baseUrlError) throw new Error(baseUrlError)

    const messageId = newMessageId()
    const baseEvent = createAdapterEvent(input.conversationId)

    yield baseEvent({
      type: 'message.start' as const,
      messageId,
      agentId: input.agentId,
      runId: input.runId,
    })

    const conv = await db.query.conversations.findFirst({
      where: eq(schema.conversations.id, input.conversationId),
    })
    const approvalMode = conv?.fsWriteApprovalMode ?? 'review'
    const sandboxMode: SandboxMode = approvalMode === 'auto' ? 'workspace-write' : 'read-only'
    const approvalPolicy: ApprovalMode = 'never'

    const codex = new Codex({
      apiKey: input.apiKey ?? undefined,
      baseUrl: input.apiBaseUrl ?? undefined,
      env: buildCodexChildProcessEnv(),
      config: {
        developer_instructions: input.systemPrompt,
      },
    })

    const sessionKey = adapterSessionKey(input.conversationId, input.agentId)
    const previousThreadId = codexSessions.get(sessionKey)
    const threadOptions: ThreadOptions = {
      workingDirectory: input.workspacePath,
      skipGitRepoCheck: true,
      model: input.modelId ?? DEFAULT_MODEL,
      sandboxMode,
      approvalPolicy,
      networkAccessEnabled: false,
      webSearchMode: 'disabled',
    }
    const thread = previousThreadId
      ? codex.resumeThread(previousThreadId, threadOptions)
      : codex.startThread(threadOptions)

    let nextPartIndex = 0
    const toolCallIdByItemId = new Map<string, string>()
    const completedToolItemIds = new Set<string>()

    try {
      const { events } = await thread.runStreamed(buildCodexInput(input), { signal })
      for await (const event of events) {
        if (event.type === 'thread.started') {
          codexSessions.set(sessionKey, event.thread_id)
          continue
        }
        if (event.type === 'turn.failed') {
          throw new Error(event.error.message)
        }
        if (event.type === 'error') {
          throw new Error(event.message)
        }
        if (event.type === 'turn.completed') {
          yield baseEvent({
            type: 'message.usage' as const,
            messageId,
            usage: toMessageUsage(event.usage),
          })
          yield baseEvent({
            type: 'run.usage' as const,
            runId: input.runId,
            usage: toRunUsage(event.usage, input.modelId ?? DEFAULT_MODEL),
          })
          continue
        }

        const translated = translateItemEvent(event, {
          baseEvent,
          messageId,
          nextPartIndex,
          toolCallIdByItemId,
          completedToolItemIds,
        })
        nextPartIndex = translated.nextPartIndex
        for (const streamEvent of translated.events) {
          yield streamEvent
        }
      }
    } catch (err) {
      if (!isAbortLikeError(err, signal)) throw normalizeCodexError(err)
    }

    yield baseEvent({ type: 'message.end' as const, messageId })
  }
}

function normalizeCodexError(err: unknown): Error {
  if (err instanceof Error) {
    if (isCodexResponsesMissingErrorMessage(err.message)) {
      return new Error(codexResponsesCompatibilityError(err.message))
    }
    return err
  }
  return new Error(String(err))
}

interface TranslateCtx {
  baseEvent: ReturnType<typeof createAdapterEvent>
  messageId: string
  nextPartIndex: number
  toolCallIdByItemId: Map<string, string>
  completedToolItemIds: Set<string>
}

function translateItemEvent(
  event: ThreadEvent,
  ctx: TranslateCtx,
): { events: StreamEvent[]; nextPartIndex: number } {
  if (
    event.type !== 'item.started' &&
    event.type !== 'item.updated' &&
    event.type !== 'item.completed'
  ) {
    return { events: [], nextPartIndex: ctx.nextPartIndex }
  }

  const item = event.item
  const out: StreamEvent[] = []

  if (isToolLikeItem(item)) {
    const call = ensureToolCall(item, ctx)
    if (call) out.push(call)
    if (event.type === 'item.completed' && !ctx.completedToolItemIds.has(item.id)) {
      ctx.completedToolItemIds.add(item.id)
      const callId = ctx.toolCallIdByItemId.get(item.id)
      if (callId) {
        out.push(
          ctx.baseEvent({
            type: 'tool.result' as const,
            messageId: ctx.messageId,
            callId,
            result: toolResultFor(item),
            isError: isToolItemError(item),
          }),
        )
      }
    }
    return { events: out, nextPartIndex: ctx.nextPartIndex }
  }

  if (event.type !== 'item.completed') {
    return { events: [], nextPartIndex: ctx.nextPartIndex }
  }

  if (item.type === 'agent_message' && item.text.trim()) {
    const partIndex = ctx.nextPartIndex
    out.push(
      ctx.baseEvent({
        type: 'part.start' as const,
        messageId: ctx.messageId,
        partIndex,
        part: { type: 'text' as const, content: item.text },
      }),
      ctx.baseEvent({
        type: 'part.end' as const,
        messageId: ctx.messageId,
        partIndex,
      }),
    )
    return { events: out, nextPartIndex: partIndex + 1 }
  }

  if (item.type === 'reasoning' && item.text.trim()) {
    const partIndex = ctx.nextPartIndex
    out.push(
      ctx.baseEvent({
        type: 'part.start' as const,
        messageId: ctx.messageId,
        partIndex,
        part: { type: 'thinking' as const, content: item.text },
      }),
      ctx.baseEvent({
        type: 'part.end' as const,
        messageId: ctx.messageId,
        partIndex,
      }),
    )
    return { events: out, nextPartIndex: partIndex + 1 }
  }

  if (item.type === 'todo_list' && item.items.length > 0) {
    const partIndex = ctx.nextPartIndex
    const content = item.items
      .map((todo) => `${todo.completed ? '[x]' : '[ ]'} ${todo.text}`)
      .join('\n')
    out.push(
      ctx.baseEvent({
        type: 'part.start' as const,
        messageId: ctx.messageId,
        partIndex,
        part: { type: 'thinking' as const, content },
      }),
      ctx.baseEvent({
        type: 'part.end' as const,
        messageId: ctx.messageId,
        partIndex,
      }),
    )
    return { events: out, nextPartIndex: partIndex + 1 }
  }

  if (item.type === 'error' && item.message.trim()) {
    const partIndex = ctx.nextPartIndex
    out.push(
      ctx.baseEvent({
        type: 'part.start' as const,
        messageId: ctx.messageId,
        partIndex,
        part: { type: 'text' as const, content: `Codex error: ${item.message}` },
      }),
      ctx.baseEvent({
        type: 'part.end' as const,
        messageId: ctx.messageId,
        partIndex,
      }),
    )
    return { events: out, nextPartIndex: partIndex + 1 }
  }

  return { events: out, nextPartIndex: ctx.nextPartIndex }
}

function ensureToolCall(item: ThreadItem, ctx: TranslateCtx): StreamEvent | null {
  const existing = ctx.toolCallIdByItemId.get(item.id)
  if (existing) return null
  const callId = newToolCallId()
  ctx.toolCallIdByItemId.set(item.id, callId)
  return ctx.baseEvent({
    type: 'tool.call' as const,
    messageId: ctx.messageId,
    callId,
    toolName: toolNameFor(item),
    args: toolArgsFor(item),
  })
}

function isToolLikeItem(item: ThreadItem): boolean {
  return (
    item.type === 'command_execution' ||
    item.type === 'file_change' ||
    item.type === 'mcp_tool_call' ||
    item.type === 'web_search'
  )
}

function toolNameFor(item: ThreadItem): string {
  switch (item.type) {
    case 'command_execution':
      return 'codex_command'
    case 'file_change':
      return 'codex_file_change'
    case 'mcp_tool_call':
      return `codex_mcp_${safeToolSegment(item.server)}_${safeToolSegment(item.tool)}`
    case 'web_search':
      return 'codex_web_search'
    default:
      return 'codex_item'
  }
}

function toolArgsFor(item: ThreadItem): unknown {
  switch (item.type) {
    case 'command_execution':
      return { command: item.command }
    case 'file_change':
      return { changes: item.changes }
    case 'mcp_tool_call':
      return { server: item.server, tool: item.tool, arguments: item.arguments }
    case 'web_search':
      return { query: item.query }
    default:
      return {}
  }
}

function toolResultFor(item: ThreadItem): unknown {
  switch (item.type) {
    case 'command_execution':
      return {
        command: item.command,
        output: item.aggregated_output,
        exitCode: item.exit_code ?? null,
        status: item.status,
      }
    case 'file_change':
      return { changes: item.changes, status: item.status }
    case 'mcp_tool_call':
      return item.error
        ? { error: item.error.message, status: item.status }
        : { result: item.result ?? null, status: item.status }
    case 'web_search':
      return { query: item.query, status: 'completed' }
    default:
      return item
  }
}

function isToolItemError(item: ThreadItem): boolean {
  switch (item.type) {
    case 'command_execution':
      return item.status === 'failed' || (item.exit_code ?? 0) !== 0
    case 'file_change':
      return item.status === 'failed'
    case 'mcp_tool_call':
      return item.status === 'failed' || !!item.error
    default:
      return false
  }
}

function buildCodexInput(input: AdapterInput): CodexInput {
  const images =
    input.attachments
      ?.filter((att) => att.kind === 'image')
      .map((att) => ({ type: 'local_image' as const, path: att.absPath })) ?? []
  if (images.length === 0) return input.prompt
  return [{ type: 'text' as const, text: input.prompt }, ...images]
}

function toMessageUsage(usage: Usage) {
  return {
    inputTokens: usage.input_tokens,
    outputTokens: usage.output_tokens,
    cacheReadTokens: usage.cached_input_tokens,
  }
}

function toRunUsage(usage: Usage, model: string) {
  return {
    inputTokens: usage.input_tokens,
    outputTokens: usage.output_tokens,
    cacheCreationTokens: 0,
    cacheReadTokens: usage.cached_input_tokens,
    lastInputTokens: usage.input_tokens,
    model,
  }
}

function safeToolSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9_]/g, '_').replace(/^_+|_+$/g, '') || 'tool'
}
