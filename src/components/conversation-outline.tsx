'use client'

import { ListTree, MessageSquare } from 'lucide-react'

import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { MessageRow } from '@/db/schema'
import { useAppStore, useMessagesForConversation } from '@/stores/app-store'

/**
 * ConversationOutline —— ChatPanel header 的「目录」按钮。
 *
 * 点击弹 popover 列出本会话所有 user message（用户提问），点击跳转 + 短暂高亮。
 * 长对话回顾上文用，避免无限上滚找位置。
 */
export function ConversationOutline({ conversationId }: { conversationId: string }) {
  const messages = useMessagesForConversation(conversationId)
  const highlightMessage = useAppStore((s) => s.highlightMessage)

  const userMessages = messages.filter((m) => m.role === 'user')

  if (userMessages.length === 0) return null

  const handleJump = (id: string) => {
    const el = document.getElementById(`message-${id}`)
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' })
      highlightMessage(id)
    }
  }

  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button
            size="icon"
            variant="ghost"
            title={`对话目录 · ${userMessages.length} 条提问`}
          />
        }
      >
        <ListTree className="size-4" />
      </PopoverTrigger>
      <PopoverContent className="w-96 p-0" align="end">
        <div className="flex items-center justify-between border-b px-3 py-2 text-xs">
          <span className="flex items-center gap-1.5 font-medium">
            <ListTree className="size-3.5" />
            对话目录
          </span>
          <span className="text-[10px] text-muted-foreground">{userMessages.length} 条提问</span>
        </div>
        <ScrollArea className="max-h-[60vh]">
          <div className="space-y-0.5 p-1">
            {userMessages.map((m, i) => (
              <OutlineItem
                key={m.id}
                index={i + 1}
                message={m}
                onClick={() => handleJump(m.id)}
              />
            ))}
          </div>
        </ScrollArea>
      </PopoverContent>
    </Popover>
  )
}

function OutlineItem({
  index,
  message,
  onClick,
}: {
  index: number
  message: MessageRow
  onClick: () => void
}) {
  // 取第一个 text part 的内容；没有就 fallback 附件 / 占位
  const textPart = message.parts.find((p) => p.type === 'text')
  const preview = textPart && textPart.type === 'text' ? textPart.content : ''
  const hasAttachments = message.parts.some(
    (p) => p.type === 'image_attachment' || p.type === 'file_attachment',
  )

  const displayText = preview || (hasAttachments ? '(附件消息)' : '(空)')
  const time = new Date(message.createdAt).toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
  })

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'group flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left text-xs transition hover:bg-accent',
      )}
    >
      <span className="mt-0.5 shrink-0 font-mono text-[10px] text-muted-foreground/70 group-hover:text-foreground/70">
        #{index}
      </span>
      <MessageSquare className="mt-0.5 size-3 shrink-0 text-muted-foreground/50" />
      <div className="min-w-0 flex-1">
        <div className="line-clamp-2 whitespace-pre-wrap break-words leading-snug">
          {displayText}
        </div>
        <div className="mt-0.5 text-[10px] text-muted-foreground">{time}</div>
      </div>
    </button>
  )
}
