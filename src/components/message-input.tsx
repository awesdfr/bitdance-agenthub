'use client'

import { Send } from 'lucide-react'
import { nanoid } from 'nanoid'
import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { sendMessage as sendMessageAPI } from '@/lib/api'
import { useAppStore } from '@/stores/app-store'

export function MessageInput({ conversationId }: { conversationId: string }) {
  const [content, setContent] = useState('')
  const [sending, setSending] = useState(false)

  const addLocalUserMessage = useAppStore((s) => s.addLocalUserMessage)
  const replaceLocalMessageId = useAppStore((s) => s.replaceLocalMessageId)

  const submit = async () => {
    const text = content.trim()
    if (!text || sending) return

    const tempId = `temp_${nanoid()}`
    addLocalUserMessage({ tempId, conversationId, content: text, mentionedAgentIds: [] })
    setContent('')
    setSending(true)

    try {
      const { messageId } = await sendMessageAPI(conversationId, { content: text })
      replaceLocalMessageId(tempId, messageId)
    } catch (err) {
      console.error('[MessageInput] send failed', err)
      // 简单容错：把临时消息标错（后续 milestone 改）
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="border-t bg-background p-3">
      <div className="flex items-end gap-2">
        <Textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              void submit()
            }
          }}
          placeholder="输入消息，Enter 发送，Shift+Enter 换行"
          className="min-h-[44px] max-h-40 resize-none"
        />
        <Button onClick={() => void submit()} disabled={!content.trim() || sending} size="icon">
          <Send className="size-4" />
        </Button>
      </div>
    </div>
  )
}
