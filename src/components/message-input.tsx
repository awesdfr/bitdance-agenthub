'use client'

import { Paperclip, Send, Square, X } from 'lucide-react'
import { nanoid } from 'nanoid'
import { useEffect, useMemo, useRef, useState } from 'react'

import { AgentAvatar } from '@/components/agent-avatar'
import { AttachmentChip, PendingAttachmentChip } from '@/components/attachment-chip'
import { QuotedMessage } from '@/components/quoted-message'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import type { AgentRow, AttachmentRow } from '@/db/schema'
import {
  abortRun,
  sendMessage as sendMessageAPI,
  uploadAttachment as uploadAttachmentAPI,
} from '@/lib/api'
import { cn } from '@/lib/utils'
import { useAppStore, useTopLevelRunningRuns } from '@/stores/app-store'

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
  const [pending, setPending] = useState<AttachmentRow[]>([])
  const [uploading, setUploading] = useState<Array<{ tempId: string; name: string }>>([])

  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const addLocalUserMessage = useAppStore((s) => s.addLocalUserMessage)
  const replaceLocalMessageId = useAppStore((s) => s.replaceLocalMessageId)
  const conversation = useAppStore((s) => s.conversations[conversationId])
  const agents = useAppStore((s) => s.agents)
  const runningRuns = useTopLevelRunningRuns(conversationId)
  const isRunning = runningRuns.length > 0

  // 引用回复目标
  const replyTargetId = useAppStore((s) => s.replyTargetByConv[conversationId])
  const replyMessage = useAppStore((s) => (replyTargetId ? s.messages[replyTargetId] : null))
  const setReplyTarget = useAppStore((s) => s.setReplyTarget)

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

  // 切换会话清空 state
  useEffect(() => {
    setContent('')
    setMentionedIds([])
    setTrigger(null)
    setPending([])
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
    setPending((prev) => prev.filter((a) => a.id !== id))
  }

  const handleFileSelect = async (files: FileList | null) => {
    if (!files || files.length === 0) return
    const list = Array.from(files)
    // 创建上传中占位
    const placeholders = list.map((f) => ({ tempId: nanoid(), name: f.name }))
    setUploading((prev) => [...prev, ...placeholders])

    await Promise.all(
      list.map(async (file, i) => {
        const tempId = placeholders[i].tempId
        try {
          const att = await uploadAttachmentAPI(conversationId, file)
          setPending((prev) => [...prev, att])
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

    const tempId = `temp_${nanoid()}`
    const parentId = replyTargetId ?? undefined
    addLocalUserMessage({
      tempId,
      conversationId,
      content: text,
      mentionedAgentIds: mentionedIds,
      parentMessageId: parentId,
      attachments: pending,
    })
    setContent('')
    setMentionedIds([])
    setTrigger(null)
    const attachmentIds = pending.map((a) => a.id)
    setPending([])
    if (replyTargetId) setReplyTarget(conversationId, null)
    setSending(true)

    try {
      const { messageId } = await sendMessageAPI(conversationId, {
        content: text,
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

      <div className="flex items-end gap-2">
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
