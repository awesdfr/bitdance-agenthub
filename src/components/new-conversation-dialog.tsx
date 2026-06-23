'use client'

import { AlertTriangle, FolderSearch, Sparkles } from 'lucide-react'
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
import type { ModelProfileRow } from '@/db/schema'
import {
  createConversation,
  fetchModelProfiles,
  getServerPlatform,
  type ServerPlatform,
} from '@/lib/api'
import { cn } from '@/lib/utils'
import { useAgentList, useAppStore } from '@/stores/app-store'

type WorkspaceMode = 'sandbox' | 'local'

export function NewConversationDialog({
  open,
  onOpenChange,
  intent = 'conversation',
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  intent?: 'conversation' | 'work-area'
}) {
  const agents = useAgentList()
  const upsertConversation = useAppStore((s) => s.upsertConversation)
  const setActive = useAppStore((s) => s.setActiveConversation)

  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [models, setModels] = useState<ModelProfileRow[]>([])
  const [modelsLoading, setModelsLoading] = useState(false)
  const [selectedModelId, setSelectedModelId] = useState('')
  const [creating, setCreating] = useState(false)
  const [workspaceMode, setWorkspaceMode] = useState<WorkspaceMode>('sandbox')
  const [boundPath, setBoundPath] = useState('')
  const [pickerOpen, setPickerOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [platform, setPlatform] = useState<ServerPlatform | null>(null)
  const workAreaMode = intent === 'work-area'
  const selectedModel = models.find((model) => model.id === selectedModelId) ?? null

  // 拉一次服务器平台，决定 boundPath placeholder 文案；失败不阻塞 UI（fallback posix）
  useEffect(() => {
    getServerPlatform()
      .then((p) => setPlatform(p))
      .catch(() => setPlatform('posix'))
  }, [])

  useEffect(() => {
    if (!open || workAreaMode) return
    let alive = true
    setModelsLoading(true)
    fetchModelProfiles()
      .then((list) => {
        if (!alive) return
        setModels(list)
        setSelectedModelId((current) =>
          current && list.some((model) => model.id === current) ? current : list[0]?.id ?? '',
        )
      })
      .catch(() => {
        if (!alive) return
        setModels([])
        setSelectedModelId('')
      })
      .finally(() => {
        if (alive) setModelsLoading(false)
      })
    return () => {
      alive = false
    }
  }, [open, workAreaMode])

  const boundPathPlaceholder =
    platform === 'windows' ? 'D:\\projects\\foo' : '/Users/me/projects/foo'

  const mode: 'single' | 'group' = workAreaMode ? 'group' : selected.size > 1 ? 'group' : 'single'

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
    setSelectedModelId('')
    setWorkspaceMode('sandbox')
    setBoundPath('')
    setError(null)
  }

  const submit = async () => {
    if (creating) return
    setError(null)

    if (!workAreaMode) {
      if (!selectedModelId) {
        setError('先选择一个模型')
        return
      }
      setCreating(true)
      try {
        const conv = await createConversation({
          mode: 'single',
          agentIds: [],
          modelProfileId: selectedModelId,
        })
        upsertConversation(conv)
        setActive(conv.id)
        reset()
        onOpenChange(false)
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
      } finally {
        setCreating(false)
      }
      return
    }

    if (workAreaMode && selected.size < 2) {
      setError('工作对话区至少需要选择 2 个智能体')
      return
    }

    if (workspaceMode === 'local' && !boundPath.trim()) {
      setError('选了「本地目录」就要填路径')
      return
    }

    setCreating(true)
    try {
      const conv = await createConversation({
        mode,
        agentIds: Array.from(selected),
        boundPath: workspaceMode === 'local' ? boundPath.trim() : undefined,
      })
      upsertConversation(conv)
      setActive(conv.id)
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
          <DialogTitle>{workAreaMode ? '新建工作对话区' : '新建对话'}</DialogTitle>
          <DialogDescription>
            {workAreaMode
              ? '选择 2 个或更多智能体，创建一个多智能体协作的工作对话区域'
              : '选择一个已经配置好的模型，创建一个单独的普通聊天窗口'}
          </DialogDescription>
        </DialogHeader>

        {workAreaMode ? (
          <div className="space-y-2 py-2">
            {agents.length === 0 ? (
              <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
                暂无可用智能体
                <div className="mt-1 text-xs">先到「智能体」页面创建一个员工智能体</div>
              </div>
            ) : (
              agents.map((a) => {
                const isSelected = selected.has(a.id)
                return (
                  <button
                    key={a.id}
                    type="button"
                    onClick={() => toggle(a.id)}
                    className={cn(
                      'flex w-full items-start gap-3 rounded-md border p-3 text-left transition hover:border-foreground/30',
                      isSelected && 'border-primary bg-primary/5',
                    )}
                  >
                    <AgentAvatar agent={a} size="lg" />
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium">{a.name}</div>
                      <p className="mt-0.5 text-xs text-muted-foreground line-clamp-2">
                        {a.description}
                      </p>
                    </div>
                  </button>
                )
              })
            )}
          </div>
        ) : (
          <div className="space-y-2 py-2">
            <div className="text-xs font-medium text-muted-foreground">选择模型</div>
            {modelsLoading ? (
              <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
                正在读取模型配置...
              </div>
            ) : models.length === 0 ? (
              <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
                还没有可用模型
                <div className="mt-1 text-xs">先到「模型管理」里添加 DeepSeek、OpenAI 或其他兼容模型</div>
              </div>
            ) : (
              models.map((model) => {
                const isSelected = model.id === selectedModelId
                return (
                  <button
                    key={model.id}
                    type="button"
                    onClick={() => setSelectedModelId(model.id)}
                    className={cn(
                      'flex w-full items-start gap-3 rounded-md border p-3 text-left transition hover:border-foreground/30',
                      isSelected && 'border-primary bg-primary/5',
                    )}
                  >
                    <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                      <Sparkles className="size-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <div className="truncate text-sm font-medium">{model.name}</div>
                        <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                          {model.provider}
                        </span>
                      </div>
                      <p className="mt-0.5 truncate text-xs text-muted-foreground">
                        {model.model} ·{' '}
                        {model.healthStatus === 'ok'
                          ? '连接正常'
                          : model.healthStatus === 'failed'
                            ? '需要检查'
                            : '未测试'}
                      </p>
                    </div>
                  </button>
                )
              })
            )}
          </div>
        )}

        {/* 工作目录 */}
        {workAreaMode && (
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
                  工作目录在 <code className="font-mono">.agenthub-data/</code> 内部，不接触你的真实代码
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
                        onChange={(e) => setBoundPath(e.target.value)}
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
                      <span>Agent 将能读写此目录中的真实文件。请确保已 git 备份。</span>
                    </div>
                  </>
                )}
              </div>
            </label>
          </div>
        )}

        {error && (
          <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800 dark:border-red-900/40 dark:bg-red-950/30 dark:text-red-200">
            {error}
          </div>
        )}

        <DialogFooter>
          <div className="mr-auto text-xs text-muted-foreground">
            {workAreaMode
              ? `已选 ${selected.size} 位 · 将创建工作对话区`
              : selectedModel
                ? `已选 ${selectedModel.name} · 将创建模型对话`
                : '选择一个模型后创建对话'}
          </div>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button
            onClick={() => void submit()}
            disabled={creating || (workAreaMode ? selected.size === 0 : !selectedModelId)}
          >
            {creating ? '创建中...' : '创建'}
          </Button>
        </DialogFooter>
      </DialogContent>

      <DirPickerDialog
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        onSelect={(p) => setBoundPath(p)}
      />
    </Dialog>
  )
}
