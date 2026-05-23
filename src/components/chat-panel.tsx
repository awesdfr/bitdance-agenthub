'use client'

import { FolderOpen, MessagesSquare, UserPlus } from 'lucide-react'
import { useState } from 'react'

import { AddAgentDialog } from '@/components/add-agent-dialog'
import { AgentInfoPopover } from '@/components/agent-info-popover'
import { FileLibraryDialog } from '@/components/file-library-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { MessageInput } from '@/components/message-input'
import { MessageList } from '@/components/message-list'
import { useActiveConversation, useAppStore } from '@/stores/app-store'

export function ChatPanel() {
  const conv = useActiveConversation()
  const agents = useAppStore((s) => s.agents)
  const streamConnected = useAppStore((s) => s.streamConnected)
  const [addOpen, setAddOpen] = useState(false)
  const [filesOpen, setFilesOpen] = useState(false)

  if (!conv) {
    return (
      <main className="flex min-w-0 flex-1 items-center justify-center bg-background">
        <div className="flex max-w-sm flex-col items-center gap-4 px-6 text-center">
          <div className="flex size-16 items-center justify-center rounded-2xl bg-muted">
            <MessagesSquare className="size-7 text-muted-foreground" />
          </div>
          <div className="space-y-1.5">
            <h2 className="text-lg font-semibold">开始你的多 Agent 协作</h2>
            <p className="text-sm leading-6 text-muted-foreground">
              从左侧选择一个会话继续聊天，或点击「+ 新建对话」选择一个或多个 Agent 开始
            </p>
          </div>
        </div>
      </main>
    )
  }

  const participantAgents = conv.agentIds.map((id) => agents[id]).filter(Boolean)

  return (
    <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-background">
      <header className="flex shrink-0 items-center justify-between border-b px-4 py-3">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex shrink-0 -space-x-2">
            {participantAgents.map((a) => (
              <AgentInfoPopover
                key={a.id}
                agent={a}
                size="md"
                avatarClassName="border-2 border-background"
              />
            ))}
          </div>
          <div className="min-w-0">
            <div className="truncate text-sm font-medium">{conv.title}</div>
            <div className="text-xs text-muted-foreground">
              {conv.mode === 'single' ? '单聊' : '群聊'} · {participantAgents.length} 位 Agent
            </div>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button
            size="icon"
            variant="ghost"
            onClick={() => setFilesOpen(true)}
            title="会话文件库"
          >
            <FolderOpen className="size-4" />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            onClick={() => setAddOpen(true)}
            title="添加 Agent"
          >
            <UserPlus className="size-4" />
          </Button>
          <Badge variant={streamConnected ? 'default' : 'outline'} className="gap-1.5">
            <span
              className={`size-1.5 rounded-full ${streamConnected ? 'bg-green-500' : 'bg-zinc-400'}`}
            />
            {streamConnected ? '已连接' : '断开'}
          </Badge>
        </div>
      </header>

      <MessageList conversationId={conv.id} />
      <MessageInput conversationId={conv.id} />

      <AddAgentDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        conversationId={conv.id}
        existingAgentIds={conv.agentIds}
      />

      <FileLibraryDialog
        open={filesOpen}
        onOpenChange={setFilesOpen}
        conversationId={conv.id}
      />
    </main>
  )
}
