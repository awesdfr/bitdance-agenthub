'use client'

import { Plus } from 'lucide-react'
import { useEffect, useState } from 'react'

import { NewConversationDialog } from '@/components/new-conversation-dialog'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { fetchAgents, fetchConversations } from '@/lib/api'
import { cn } from '@/lib/utils'
import { selectConversationList, useAppStore } from '@/stores/app-store'

export function Sidebar() {
  const conversations = useAppStore(selectConversationList)
  const activeId = useAppStore((s) => s.activeConversationId)
  const setActive = useAppStore((s) => s.setActiveConversation)
  const setConversations = useAppStore((s) => s.setConversations)
  const setAgents = useAppStore((s) => s.setAgents)
  const agents = useAppStore((s) => s.agents)

  const [dialogOpen, setDialogOpen] = useState(false)

  useEffect(() => {
    fetchConversations().then(setConversations).catch(console.error)
    fetchAgents().then(setAgents).catch(console.error)
  }, [setConversations, setAgents])

  return (
    <aside className="flex w-72 shrink-0 flex-col border-r bg-card">
      <div className="flex items-center justify-between border-b px-4 py-3">
        <div>
          <h1 className="text-base font-semibold">AgentHub</h1>
          <p className="text-xs text-muted-foreground">多 Agent 协作平台</p>
        </div>
        <Button size="icon" variant="ghost" onClick={() => setDialogOpen(true)}>
          <Plus className="size-4" />
        </Button>
      </div>

      <ScrollArea className="flex-1">
        <div className="p-2">
          {conversations.length === 0 ? (
            <div className="px-3 py-8 text-center text-xs text-muted-foreground">
              没有会话，点击右上 + 新建
            </div>
          ) : (
            conversations.map((c) => {
              const firstAgent = c.agentIds[0] ? agents[c.agentIds[0]] : null
              return (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => setActive(c.id)}
                  className={cn(
                    'flex w-full items-center gap-3 rounded-md px-2 py-2 text-left transition hover:bg-accent',
                    activeId === c.id && 'bg-accent',
                  )}
                >
                  <Avatar className="size-9 shrink-0">
                    <AvatarFallback className="text-sm">
                      {firstAgent?.avatar ?? '?'}
                    </AvatarFallback>
                  </Avatar>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{c.title}</div>
                    <div className="truncate text-xs text-muted-foreground">
                      {c.mode === 'single' ? '单聊' : '群聊'} · {c.agentIds.length} 位 Agent
                    </div>
                  </div>
                </button>
              )
            })
          )}
        </div>
      </ScrollArea>

      <NewConversationDialog open={dialogOpen} onOpenChange={setDialogOpen} />
    </aside>
  )
}
