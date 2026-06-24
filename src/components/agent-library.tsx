'use client'

import { Pencil, Plus, Settings2, Trash2, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'

import { AgentAvatar } from '@/components/agent-avatar'
import { CreateAgentDialog } from '@/components/create-agent-dialog'
import { EmployeeAgentFactory } from '@/components/employee-agent-factory'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { ScrollArea } from '@/components/ui/scroll-area'
import type { AgentRow } from '@/db/schema'
import { deleteAgent as deleteAgentAPI } from '@/lib/api'
import { cn } from '@/lib/utils'
import { useAgentList, useAppStore } from '@/stores/app-store'

interface AgentLibraryProps {
  defaultSettingsOpen?: boolean
  settingsRequestKey?: number
  focusCapabilitiesOnSettingsOpen?: boolean
}

export function AgentLibrary({
  defaultSettingsOpen = false,
  settingsRequestKey = 0,
  focusCapabilitiesOnSettingsOpen = false,
}: AgentLibraryProps) {
  const agents = useAgentList()
  const removeAgent = useAppStore((s) => s.removeAgent)

  const [formOpen, setFormOpen] = useState(false)
  const [editingAgent, setEditingAgent] = useState<AgentRow | null>(null)
  const [settingsAgentId, setSettingsAgentId] = useState<string | null>(
    defaultSettingsOpen ? '__first__' : null,
  )
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)

  const deleteTarget = deleteTargetId ? agents.find((agent) => agent.id === deleteTargetId) : null
  const settingsAgent = useMemo(() => {
    if (settingsAgentId === '__first__') return agents[0] ?? null
    return settingsAgentId ? agents.find((agent) => agent.id === settingsAgentId) ?? null : null
  }, [agents, settingsAgentId])
  const settingsOpen = Boolean(settingsAgent)

  useEffect(() => {
    if (settingsRequestKey <= 0) return
    setSettingsAgentId('__first__')
  }, [settingsRequestKey])

  const openCreate = () => {
    setEditingAgent(null)
    setFormOpen(true)
  }

  const openEdit = (agent: AgentRow) => {
    setEditingAgent(agent)
    setFormOpen(true)
  }

  const openSettings = (agent: AgentRow) => {
    setSettingsAgentId(agent.id)
  }

  const handleFormOpenChange = (open: boolean) => {
    setFormOpen(open)
    if (!open) setEditingAgent(null)
  }

  const confirmDelete = async () => {
    if (!deleteTargetId) return
    setDeleting(true)
    try {
      await deleteAgentAPI(deleteTargetId)
      removeAgent(deleteTargetId)
      setDeleteTargetId(null)
      if (settingsAgentId === deleteTargetId) setSettingsAgentId(null)
    } catch (err) {
      console.error('[AgentLibrary] delete failed', err)
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div className="flex min-h-0 flex-1 overflow-hidden max-lg:flex-col">
      <div
        className={cn(
          'flex min-h-0 flex-col',
          settingsOpen ? 'shrink-0 border-r lg:w-[22rem]' : 'flex-1',
        )}
      >
        <div className="shrink-0 space-y-2 border-b px-3 py-3">
          <Button className="w-full justify-start gap-2" variant="outline" onClick={openCreate}>
            <Plus className="size-4" />
            创建智能体
          </Button>
          <p className="text-xs text-muted-foreground">
            每个智能体旁边的齿轮就是设置入口，可以配置模型、工具、权限、记忆和运行能力。
          </p>
        </div>

        <ScrollArea className="min-h-0 flex-1">
          <div className="space-y-2 p-2">
            {agents.length === 0 ? (
              <div className="px-3 py-8 text-center text-xs text-muted-foreground">
                还没有智能体
              </div>
            ) : (
              agents.map((agent) => (
                <AgentCard
                  key={agent.id}
                  agent={agent}
                  selected={settingsAgent?.id === agent.id}
                  onEdit={() => openEdit(agent)}
                  onSettings={() => openSettings(agent)}
                  onDelete={() => setDeleteTargetId(agent.id)}
                />
              ))
            )}
          </div>
        </ScrollArea>
      </div>

      {settingsOpen && settingsAgent && (
        <section className="relative flex min-h-0 min-w-0 flex-1 flex-col border-t bg-background lg:border-t-0">
          <Button
            size="icon"
            variant="ghost"
            className="absolute right-3 top-3 z-10"
            onClick={() => setSettingsAgentId(null)}
            title="收起设置"
          >
            <X className="size-4" />
          </Button>
          <EmployeeAgentFactory
            embedded
            initialTab="agent"
            initialFocusSection={focusCapabilitiesOnSettingsOpen ? 'capabilities' : undefined}
            initialAgentProfileId={settingsAgent.id}
            initialAgentName={settingsAgent.name}
            initialAgentDescription={settingsAgent.description}
            title={`${settingsAgent.name} 设置`}
            subtitle="这里配置这个智能体能用什么模型、工具、命令、软件和权限。"
          />
        </section>
      )}

      <CreateAgentDialog
        open={formOpen}
        onOpenChange={handleFormOpenChange}
        agent={editingAgent ?? undefined}
      />

      <Dialog open={!!deleteTargetId} onOpenChange={(open) => !open && setDeleteTargetId(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>删除智能体</DialogTitle>
            <DialogDescription>
              确定删除「{deleteTarget?.name}」吗？已经使用这个智能体的会话将无法继续使用它。这个操作不可恢复。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTargetId(null)}>
              取消
            </Button>
            <Button className="bg-red-600 hover:bg-red-700" onClick={() => void confirmDelete()} disabled={deleting}>
              {deleting ? '删除中...' : '删除'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function AgentCard({
  agent,
  selected,
  onEdit,
  onSettings,
  onDelete,
}: {
  agent: AgentRow
  selected: boolean
  onEdit: () => void
  onSettings: () => void
  onDelete: () => void
}) {
  const capabilityCount = agent.skillIds.length + agent.mcpServerIds.length + agent.cliProfileIds.length

  return (
    <div
      className={cn(
        'group flex items-start gap-3 rounded-md border bg-card px-3 py-3 transition',
        selected ? 'border-primary bg-primary/5 shadow-sm' : 'hover:border-foreground/20',
      )}
    >
      <AgentAvatar agent={agent} size="md" />
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-1.5">
          <span className="truncate text-sm font-medium">{agent.name}</span>
          {agent.isBuiltin && (
            <span className="shrink-0 rounded bg-muted px-1 py-0.5 text-[10px] text-muted-foreground">
              内置
            </span>
          )}
          {agent.isOrchestrator && (
            <span className="shrink-0 rounded bg-primary/10 px-1 py-0.5 text-[10px] text-primary">
              调度
            </span>
          )}
        </div>
        <div className="mt-1 line-clamp-2 text-xs text-muted-foreground">{agent.description}</div>
        {agent.modelId && (
          <div className="mt-1 truncate text-[11px] text-muted-foreground">
            模型：<span className="font-mono">{agent.modelId}</span>
          </div>
        )}
        <div
          className="mt-2 rounded-md border bg-muted/20 px-2 py-1.5"
          data-testid="agent-card-toolbox"
        >
          <div className="flex items-center justify-between gap-2 text-[10px] font-medium text-foreground">
            <span>员工工具包</span>
            <span className="text-muted-foreground">
              {capabilityCount > 0 ? `${capabilityCount} 项能力` : '还没分配工具'}
            </span>
          </div>
          <div className="mt-1 flex flex-wrap gap-1 text-[10px] text-muted-foreground">
            <span className="rounded bg-background px-1.5 py-0.5">技能 {agent.skillIds.length}</span>
            <span className="rounded bg-background px-1.5 py-0.5">MCP {agent.mcpServerIds.length}</span>
            <span className="rounded bg-background px-1.5 py-0.5">CLI {agent.cliProfileIds.length}</span>
          </div>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <Button
          type="button"
          size="icon"
          variant={selected ? 'secondary' : 'ghost'}
          className="size-8"
          onClick={onSettings}
          title="设置智能体"
        >
          <Settings2 className="size-4" />
        </Button>
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className="size-8 opacity-70 transition hover:opacity-100"
          onClick={onEdit}
          title="编辑基础信息"
        >
          <Pencil className="size-4" />
        </Button>
        {!agent.isBuiltin && (
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="size-8 text-muted-foreground transition hover:text-red-600"
            onClick={onDelete}
            title="删除智能体"
          >
            <Trash2 className="size-4" />
          </Button>
        )}
      </div>
    </div>
  )
}
