'use client'

import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { MessageInput } from '@/components/message-input'
import { MessageList } from '@/components/message-list'
import { selectActiveConversation, useAppStore } from '@/stores/app-store'

export function ChatPanel() {
  const conv = useAppStore(selectActiveConversation)
  const agents = useAppStore((s) => s.agents)
  const streamConnected = useAppStore((s) => s.streamConnected)

  if (!conv) {
    return (
      <main className="flex flex-1 items-center justify-center bg-background">
        <div className="space-y-3 text-center text-muted-foreground">
          <div className="text-5xl">💬</div>
          <div className="text-sm">选择左侧会话开始聊天，或新建一个</div>
        </div>
      </main>
    )
  }

  const participantAgents = conv.agentIds.map((id) => agents[id]).filter(Boolean)

  return (
    <main className="flex flex-1 flex-col bg-background">
      <header className="flex items-center justify-between border-b px-4 py-3">
        <div className="flex items-center gap-3">
          <div className="flex -space-x-2">
            {participantAgents.map((a) => (
              <Avatar key={a.id} className="size-8 border-2 border-background">
                <AvatarFallback className="text-sm">{a.avatar}</AvatarFallback>
              </Avatar>
            ))}
          </div>
          <div>
            <div className="text-sm font-medium">{conv.title}</div>
            <div className="text-xs text-muted-foreground">
              {conv.mode === 'single' ? '单聊' : '群聊'} · {participantAgents.length} 位 Agent
            </div>
          </div>
        </div>
        <Badge variant={streamConnected ? 'default' : 'outline'} className="gap-1.5">
          <span
            className={`size-1.5 rounded-full ${streamConnected ? 'bg-green-500' : 'bg-zinc-400'}`}
          />
          {streamConnected ? '已连接' : '断开'}
        </Badge>
      </header>

      <MessageList conversationId={conv.id} />
      <MessageInput conversationId={conv.id} />
    </main>
  )
}
