'use client'

import { Paperclip, Send, Shield, Sparkles, Square, X, Zap } from 'lucide-react'
import { nanoid } from 'nanoid'
import { useEffect, useMemo, useRef, useState } from 'react'

import { AgentAvatar } from '@/components/agent-avatar'
import { AttachmentChip, PendingAttachmentChip } from '@/components/attachment-chip'
import { QuotedMessage } from '@/components/quoted-message'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import type { AgentRow } from '@/db/schema'
import {
  abortRun,
  compactConversation as compactConversationAPI,
  sendMessage as sendMessageAPI,
  setFsWriteApprovalMode,
  uploadAttachment as uploadAttachmentAPI,
} from '@/lib/api'
import { cn } from '@/lib/utils'
import { useAppStore, usePendingAttachments, useTopLevelRunningRuns } from '@/stores/app-store'

interface MentionTrigger {
  start: number // textarea 中 @ 字符的 index
  query: string // @ 之后到光标之间的字符
}

export function MessageInput({ conversationId }: { conversationId: string }) {
  const [content, setContent] = useState('')
  const [mentionedIds, setMentionedIds] = useState<string[]>([])
  const [trigger, setTrigger] = useState<MentionTrigger | null>(null)
  const [highlight, setHighlight] = useState(0)
  const [sending, setSending] = useState(false)
  const [aborting, setAborting] = useState(false)
  const [uploading, setUploading] = useState<Array<{ tempId: string; name: string }>>([])

  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const addLocalUserMessage = useAppStore((s) => s.addLocalUserMessage)
  const upsertMessage = useAppStore((s) => s.upsertMessage)
  const replaceLocalMessageId = useAppStore((s) => s.replaceLocalMessageId)
  const conversation = useAppStore((s) => s.conversations[conversationId])
  const upsertConversation = useAppStore((s) => s.upsertConversation)
  const agents = useAppStore((s) => s.agents)
  const runningRuns = useTopLevelRunningRuns(conversationId)
  const isRunning = runningRuns.length > 0
  const pending = usePendingAttachments(conversationId)
  const addPendingAttachment = useAppStore((s) => s.addPendingAttachment)
  const removePendingAttachment = useAppStore((s) => s.removePendingAttachment)
  const clearPendingAttachments = useAppStore((s) => s.clearPendingAttachments)
  const [modeBusy, setModeBusy] = useState(false)

  // 引用回复目标
  const replyTargetId = useAppStore((s) => s.replyTargetByConv[conversationId])
  const replyMessage = useAppStore((s) => (replyTargetId ? s.messages[replyTargetId] : null))
  const setReplyTarget = useAppStore((s) => s.setReplyTarget)
  const pendingQuote = useAppStore((s) => s.pendingQuoteForInput)
  const setPendingQuote = useAppStore((s) => s.setPendingQuote)

  // 拿到 pendingQuote 后聚焦输入框，方便用户立刻输指令
  useEffect(() => {
    if (pendingQuote) textareaRef.current?.focus()
  }, [pendingQuote])

  const isGroup = conversation?.mode === 'group'

  // 可被 @ 的 agent：群聊里所有成员，包含 Orchestrator
  // (@ Orchestrator 是合法语义：用户明确请求 Orchestrator 接手)
  const candidates = useMemo<AgentRow[]>(() => {
    if (!conversation) return []
    return conversation.agentIds
      .map((id) => agents[id])
      .filter((a): a is AgentRow => Boolean(a))
  }, [conversation, agents])

  // 过滤候选
  const filtered = useMemo(() => {
    if (!trigger) return []
    const q = trigger.query.toLowerCase()
    if (!q) return candidates
    return candidates.filter((a) => a.name.toLowerCase().includes(q))
  }, [trigger, candidates])

  // 候选变化时重置高亮项
  useEffect(() => {
    setHighlight(0)
  }, [trigger?.query, filtered.length])

  // 切换会话清空 state（pending 由 store 自己分桶，不需要在这里清）
  useEffect(() => {
    setContent('')
    setMentionedIds([])
    setTrigger(null)
    setUploading([])
  }, [conversationId])

  const mentionedAgents = mentionedIds.map((id) => agents[id]).filter(Boolean)

  // —— 触发检测：从光标往前找 @，遇 whitespace 则放弃；@ 前必须是 word boundary
  const updateTrigger = (text: string, cursor: number) => {
    if (!isGroup) return setTrigger(null)
    let i = cursor - 1
    while (i >= 0) {
      const c = text[i]
      if (c === '@') {
        const before = i === 0 ? ' ' : text[i - 1]
        if (/\s/.test(before)) {
          setTrigger({ start: i, query: text.slice(i + 1, cursor) })
          return
        }
        setTrigger(null)
        return
      }
      if (/\s/.test(c)) {
        setTrigger(null)
        return
      }
      i--
    }
    setTrigger(null)
  }

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value
    setContent(value)
    updateTrigger(value, e.target.selectionStart)
  }

  // 光标移动（鼠标点击 / 方向键）也要重新判断
  const handleSelect = () => {
    const cursor = textareaRef.current?.selectionStart ?? 0
    updateTrigger(content, cursor)
  }

  const fillMention = (agent: AgentRow) => {
    if (!trigger || !textareaRef.current) return
    const cursor = textareaRef.current.selectionStart ?? content.length
    const insertText = `@${agent.name} `
    const newContent =
      content.slice(0, trigger.start) + insertText + content.slice(cursor)
    setContent(newContent)
    setMentionedIds((prev) => (prev.includes(agent.id) ? prev : [...prev, agent.id]))
    setTrigger(null)

    // 把光标移到插入的尾部
    requestAnimationFrame(() => {
      const newPos = trigger.start + insertText.length
      textareaRef.current?.setSelectionRange(newPos, newPos)
      textareaRef.current?.focus()
    })
  }

  const removeMention = (id: string) => {
    setMentionedIds((prev) => prev.filter((x) => x !== id))
  }

  const removePending = (id: string) => {
    removePendingAttachment(conversationId, id)
  }

  const handleFileSelect = async (files: FileList | null) => {
    if (!files || files.length === 0) return
    const list = Array.from(files)
    const placeholders = list.map((f) => ({ tempId: nanoid(), name: f.name }))
    setUploading((prev) => [...prev, ...placeholders])

    await Promise.all(
      list.map(async (file, i) => {
        const tempId = placeholders[i].tempId
        try {
          const att = await uploadAttachmentAPI(conversationId, file)
          addPendingAttachment(conversationId, att)
        } catch (err) {
          console.error('[MessageInput] upload failed', err)
        } finally {
          setUploading((prev) => prev.filter((p) => p.tempId !== tempId))
        }
      }),
    )
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // 在 popup 打开时，方向键/Enter/Esc 走 popup
    if (trigger && filtered.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setHighlight((i) => (i + 1) % filtered.length)
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setHighlight((i) => (i - 1 + filtered.length) % filtered.length)
        return
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault()
        fillMention(filtered[highlight])
        return
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        setTrigger(null)
        return
      }
    }

    // 默认 Enter 提交
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      void submit()
    }
  }

  const submit = async () => {
    const text = content.trim()
    const hasAttachments = pending.length > 0
    if ((!text && !hasAttachments) || sending || isRunning) return

    if (text === '/compact' && !hasAttachments) {
      setContent('')
      setMentionedIds([])
      setTrigger(null)
      if (pendingQuote) setPendingQuote(null)
      if (replyTargetId) setReplyTarget(conversationId, null)
      setSending(true)
      try {
        const result = await compactConversationAPI(conversationId)
        upsertMessage(result.message)
      } catch (err) {
        console.error('[MessageInput] compact failed', err)
      } finally {
        setSending(false)
      }
      return
    }

    // 选区改写：把 pendingQuote 注入消息开头（XML 块给 LLM 当上下文）
    const finalContent = pendingQuote
      ? `<quoted_selection source="${pendingQuote.sourceLabel}"${pendingQuote.artifactId ? ` artifactId="${pendingQuote.artifactId}"` : ''}${pendingQuote.filePath ? ` filePath="${pendingQuote.filePath}"` : ''}>\n${pendingQuote.text}\n</quoted_selection>\n\n${text}`
      : text

    const tempId = `temp_${nanoid()}`
    const parentId = replyTargetId ?? undefined
    addLocalUserMessage({
      tempId,
      conversationId,
      content: finalContent,
      mentionedAgentIds: mentionedIds,
      parentMessageId: parentId,
      attachments: pending,
    })
    setContent('')
    setMentionedIds([])
    setTrigger(null)
    if (pendingQuote) setPendingQuote(null)
    const attachmentIds = pending.map((a) => a.id)
    clearPendingAttachments(conversationId)
    if (replyTargetId) setReplyTarget(conversationId, null)
    setSending(true)

    try {
      const { messageId } = await sendMessageAPI(conversationId, {
        content: finalContent,
        mentionedAgentIds: mentionedIds,
        parentMessageId: parentId,
        attachmentIds,
      })
      replaceLocalMessageId(tempId, messageId)
    } catch (err) {
      console.error('[MessageInput] send failed', err)
    } finally {
      setSending(false)
    }
  }

  const abortAll = async () => {
    if (aborting) return
    setAborting(true)
    try {
      await Promise.allSettled(runningRuns.map((r) => abortRun(r.id)))
    } finally {
      setAborting(false)
    }
  }

  const approvalMode = conversation?.fsWriteApprovalMode ?? 'review'
  const toggleApprovalMode = async () => {
    if (modeBusy || !conversation) return
    const nextMode = approvalMode === 'review' ? 'auto' : 'review'
    setModeBusy(true)
    try {
      const updated = await setFsWriteApprovalMode(conversationId, nextMode)
      upsertConversation(updated)
    } catch (err) {
      console.error('[MessageInput] toggle approval mode failed', err)
    } finally {
      setModeBusy(false)
    }
  }

  return (
    <div className="relative shrink-0 border-t bg-background p-3">
      {/* 引用预览 */}
      {replyMessage && (
        <div className="mb-2">
          <QuotedMessage
            message={replyMessage}
            variant="compose"
            onDismiss={() => setReplyTarget(conversationId, null)}
          />
        </div>
      )}

      {/* 选区改写引用块 */}
      {pendingQuote && (
        <div className="mb-2 flex items-start gap-2 rounded-md border border-[#3370FF]/30 bg-[#3370FF]/5 px-2 py-1.5 text-xs">
          <Sparkles className="mt-0.5 size-3 shrink-0 text-[#3370FF]" />
          <div className="min-w-0 flex-1">
            <div className="font-medium text-[#3370FF]">改写 · {pendingQuote.sourceLabel}</div>
            <pre className="mt-0.5 line-clamp-3 whitespace-pre-wrap break-words font-mono text-[10px] text-muted-foreground">
              {pendingQuote.text}
            </pre>
            <div className="mt-0.5 text-[10px] text-muted-foreground/70">
              在下方输入框写改写指令，发送时会作为引用一起发给 Agent
            </div>
          </div>
          <button
            type="button"
            onClick={() => setPendingQuote(null)}
            className="shrink-0 rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
            title="取消引用"
          >
            <X className="size-3" />
          </button>
        </div>
      )}

      {/* Attachments chips */}
      {(pending.length > 0 || uploading.length > 0) && (
        <div className="mb-2 flex flex-wrap gap-2">
          {pending.map((a) => (
            <AttachmentChip
              key={a.id}
              attachment={{
                id: a.id,
                fileName: a.fileName,
                size: a.size,
                mimeType: a.mimeType,
                kind: a.kind,
              }}
              context="compose"
              onRemove={() => removePending(a.id)}
            />
          ))}
          {uploading.map((u) => (
            <PendingAttachmentChip key={u.tempId} fileName={u.name} />
          ))}
        </div>
      )}

      {/* 已确认的 mention chips */}
      {mentionedAgents.length > 0 && (
        <div className="mb-2 flex flex-wrap items-center gap-1.5">
          <span className="text-[10px] text-muted-foreground">@ 指定</span>
          {mentionedAgents.map((a) => (
            <span
              key={a.id}
              className="inline-flex items-center gap-1 rounded-full bg-primary/10 py-0.5 pl-1 pr-1.5 text-xs text-primary"
            >
              <AgentAvatar agent={a} size="xs" />
              <span>{a.name}</span>
              <button
                type="button"
                onClick={() => removeMention(a.id)}
                className="rounded-full p-0.5 hover:bg-primary/20"
                title="移除"
              >
                <X className="size-3" />
              </button>
            </span>
          ))}
        </div>
      )}

      {/* @ Mention popup */}
      {trigger && filtered.length > 0 && (
        <div className="absolute bottom-full left-3 right-3 mb-2 max-h-60 overflow-y-auto rounded-md border bg-popover p-1 shadow-md">
          <div className="px-2 py-1 text-[10px] text-muted-foreground">
            选择 Agent · ↑↓ 切换 · Enter 确认 · Esc 取消
          </div>
          {filtered.map((a, i) => (
            <button
              key={a.id}
              type="button"
              onMouseDown={(e) => {
                // 阻止 textarea 失焦，否则 selectionStart 拿不到正确位置
                e.preventDefault()
                fillMention(a)
              }}
              onMouseEnter={() => setHighlight(i)}
              className={cn(
                'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition',
                i === highlight && 'bg-accent',
              )}
            >
              <AgentAvatar agent={a} size="xs" />
              <div className="min-w-0 flex-1">
                <div className="truncate text-xs font-medium">{a.name}</div>
                <div className="truncate text-[10px] text-muted-foreground">{a.description}</div>
              </div>
            </button>
          ))}
        </div>
      )}

      <div className="flex items-center gap-2">
        <Textarea
          ref={textareaRef}
          value={content}
          onChange={handleChange}
          onSelect={handleSelect}
          onKeyDown={handleKeyDown}
          placeholder={
            isRunning
              ? '当前有 Agent 正在响应…'
              : isGroup
                ? '输入消息，@ 指定 Agent，Enter 发送，Shift+Enter 换行'
                : '输入消息，Enter 发送，Shift+Enter 换行'
          }
          className="min-h-[44px] max-h-40 resize-none"
          disabled={isRunning}
        />

        {/* 文件上传 */}
        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="hidden"
          onChange={(e) => {
            void handleFileSelect(e.target.files)
            e.target.value = '' // 允许同名文件再次选择
          }}
        />
        {/* 辅助按钮组（紧贴）—— 让 Paperclip + 审批模式视觉成一组，与右侧主操作按钮 send 区分 */}
        <div className="flex items-center">
          <Button
            type="button"
            size="icon"
            variant="ghost"
            onClick={() => fileInputRef.current?.click()}
            disabled={isRunning}
            title="附件 / 图片"
          >
            <Paperclip className="size-4" />
          </Button>
          {/* fs_write 审批模式开关：绿色 = Review（默认安全），红色 = Auto（直写） */}
          <Button
            type="button"
            size="icon"
            variant="ghost"
            onClick={() => void toggleApprovalMode()}
            disabled={modeBusy}
            title={
              approvalMode === 'review'
                ? 'Review 模式 · Agent 写入需审批（点击切到 Auto，直接生效 ⚠）'
                : '⚠ Auto 模式 · Agent 写入直接生效（点击切回 Review）'
            }
            className={cn(
              approvalMode === 'review'
                ? 'text-emerald-600 hover:text-emerald-700 dark:text-emerald-400'
                : 'text-[#FE3B25] hover:text-[#FE3B25] dark:text-[#FE3B25]',
            )}
          >
            {approvalMode === 'review' ? (
              <Shield className="size-4" />
            ) : (
              <Zap className="size-4" />
            )}
          </Button>
        </div>
        {isRunning ? (
          <Button
            onClick={() => void abortAll()}
            disabled={aborting}
            size="icon"
            variant="destructive"
            title="中止全部"
          >
            <Square className="size-4 fill-current" />
          </Button>
        ) : (
          <Button
            onClick={() => void submit()}
            disabled={(!content.trim() && pending.length === 0) || sending}
            size="icon"
            title="发送 (Enter)"
          >
            <Send className="size-4" />
          </Button>
        )}
      </div>
    </div>
  )
}
