'use client'

import { useEffect, useLayoutEffect, useRef } from 'react'

import { MessageItem } from '@/components/message-item'
import { ScrollArea } from '@/components/ui/scroll-area'
import { fetchMessages } from '@/lib/api'
import { useAppStore, useMessagesForConversation } from '@/stores/app-store'

export function MessageList({ conversationId }: { conversationId: string }) {
  const messages = useMessagesForConversation(conversationId)
  const setMessagesForConversation = useAppStore((s) => s.setMessagesForConversation)
  const messageIdsByConv = useAppStore((s) => s.messageIdsByConv[conversationId])

  const containerRef = useRef<HTMLDivElement>(null)

  // 首次进入会话拉历史
  useEffect(() => {
    if (messageIdsByConv) return
    let cancelled = false
    fetchMessages(conversationId)
      .then((list) => {
        if (!cancelled) setMessagesForConversation(conversationId, list)
      })
      .catch((err) => {
        console.error('[MessageList] fetch failed', err)
      })
    return () => {
      cancelled = true
    }
  }, [conversationId, messageIdsByConv, setMessagesForConversation])

  // 新消息自动滚到底部
  useLayoutEffect(() => {
    const el = containerRef.current
    if (!el) return
    el.scrollTop = el.scrollHeight
  }, [messages])

  if (messages.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center p-8 text-sm text-muted-foreground">
        还没有消息，发一条试试。
      </div>
    )
  }

  return (
    <ScrollArea className="flex-1">
      <div ref={containerRef} className="space-y-4 p-4">
        {messages.map((m) => (
          <MessageItem key={m.id} message={m} />
        ))}
      </div>
    </ScrollArea>
  )
}
