'use client'

import { AlertTriangle, FolderSearch } from 'lucide-react'
import { useEffect, useState } from 'react'

import { AgentAvatar } from '@/components/agent-avatar'
import { DirPickerDialog } from '@/components/dir-picker-dialog'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { createConversation, getServerPlatform, type ServerPlatform } from '@/lib/api'
import { cn } from '@/lib/utils'
import { useAgentList, useAppStore } from '@/stores/app-store'

type WorkspaceMode = 'sandbox' | 'local'

export function NewConversationDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const agents = useAgentList()
  const upsertConversation = useAppStore((s) => s.upsertConversation)
  const setActive = useAppStore((s) => s.setActiveConversation)

  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [creating, setCreating] = useState(false)
  const [workspaceMode, setWorkspaceMode] = useState<WorkspaceMode>('sandbox')
  const [boundPath, setBoundPath] = useState('')
  const [pickerOpen, setPickerOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [platform, setPlatform] = useState<ServerPlatform | null>(null)

  useEffect(() => {
    getServerPlatform()
      .then((p) => setPlatform(p))
      .catch(() => setPlatform('posix'))
  }, [])

  const boundPathPlaceholder =
    platform === 'windows' ? 'D:\\projects\\foo' : '/Users/me/projects/foo'

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const reset = () => {
    setSelected(new Set())
    setWorkspaceMode('sandbox')
    setBoundPath('')
    setError(null)
  }

  const submit = async () => {
    if (creating) return
    setError(null)

    if (selected.size < 2) {
      setError('工作对话区至少需要选择 2 个智能体')
      return
    }

    if (workspaceMode === 'local' && !boundPath.trim()) {
      setError('选择了「本地目录」后，需要填写或选择目录路径')
      return
    }

    setCreating(true)
    try {
      const conversation = await createConversation({
        mode: 'group',
        agentIds: Array.from(selected),
        boundPath: workspaceMode === 'local' ? boundPath.trim() : undefined,
      })
      upsertConversation(conversation)
      setActive(conversation.id)
      reset()
      onOpenChange(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setCreating(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) reset()
        onOpenChange(next)
      }}
    >
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>新建工作对话区</DialogTitle>
          <DialogDescription>
            选择 2 个或更多智能体，创建一个多智能体协作的工作对话区域。
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2 py-2">
          {agents.length === 0 ? (
            <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
              暂无可用智能体
              <div className="mt-1 text-xs">先到「智能体」页面创建一个员工智能体。</div>
            </div>
          ) : (
            agents.map((agent) => {
              const isSelected = selected.has(agent.id)
              return (
                <button
                  key={agent.id}
                  type="button"
                  onClick={() => toggle(agent.id)}
                  className={cn(
                    'flex w-full items-start gap-3 rounded-md border p-3 text-left transition hover:border-foreground/30',
                    isSelected && 'border-primary bg-primary/5',
                  )}
                >
                  <AgentAvatar agent={agent} size="lg" />
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium">{agent.name}</div>
                    <p className="mt-0.5 text-xs text-muted-foreground line-clamp-2">
                      {agent.description}
                    </p>
                  </div>
                </button>
              )
            })
          )}
        </div>

        <div className="space-y-2 border-t pt-3">
          <div className="text-xs font-medium text-muted-foreground">工作目录</div>
          <label className="flex cursor-pointer items-start gap-2 rounded-md border px-3 py-2 transition hover:border-foreground/30">
            <input
              type="radio"
              checked={workspaceMode === 'sandbox'}
              onChange={() => setWorkspaceMode('sandbox')}
              className="mt-0.5 accent-primary"
            />
            <div className="min-w-0 flex-1">
              <div className="text-xs font-medium">沙箱隔离</div>
              <div className="mt-0.5 text-[10px] text-muted-foreground">
                工作目录放在 <code className="font-mono">.agenthub-data/</code> 内部，不直接改动真实项目。
              </div>
            </div>
          </label>
          <label
            className={cn(
              'flex cursor-pointer items-start gap-2 rounded-md border px-3 py-2 transition hover:border-foreground/30',
              workspaceMode === 'local' &&
                'border-amber-300 bg-amber-50/40 dark:border-amber-900/50 dark:bg-amber-950/20',
            )}
          >
            <input
              type="radio"
              checked={workspaceMode === 'local'}
              onChange={() => setWorkspaceMode('local')}
              className="mt-0.5 accent-primary"
            />
            <div className="min-w-0 flex-1 space-y-1.5">
              <div className="text-xs font-medium">绑定本地目录</div>
              {workspaceMode === 'local' && (
                <>
                  <div className="flex gap-2">
                    <Input
                      value={boundPath}
                      onChange={(event) => setBoundPath(event.target.value)}
                      placeholder={boundPathPlaceholder}
                      className="flex-1 font-mono text-xs"
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setPickerOpen(true)}
                    >
                      <FolderSearch className="mr-1 size-3.5" />
                      浏览
                    </Button>
                  </div>
                  <div className="flex items-start gap-1.5 text-[10px] text-amber-700 dark:text-amber-300">
                    <AlertTriangle className="mt-0.5 size-3 shrink-0" />
                    <span>智能体会读写这个目录里的真实文件，建议先确认项目已经备份。</span>
                  </div>
                </>
              )}
            </div>
          </label>
        </div>

        {error && (
          <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800 dark:border-red-900/40 dark:bg-red-950/30 dark:text-red-200">
            {error}
          </div>
        )}

        <DialogFooter>
          <div className="mr-auto text-xs text-muted-foreground">
            已选 {selected.size} 位 · 将创建工作对话区
          </div>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button onClick={() => void submit()} disabled={creating || selected.size < 2}>
            {creating ? '创建中...' : '创建'}
          </Button>
        </DialogFooter>
      </DialogContent>

      <DirPickerDialog
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        onSelect={(path) => setBoundPath(path)}
      />
    </Dialog>
  )
}
