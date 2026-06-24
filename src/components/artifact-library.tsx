'use client'

import {
  CheckCircle2,
  Code2,
  Eye,
  FileText,
  FolderGit2,
  GitBranch,
  Image as ImageIcon,
  Layers,
  Loader2,
  PackageCheck,
  Presentation,
  Search,
  Sheet,
  Sparkles,
  Trash2,
  Video,
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'

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
import { ScrollArea } from '@/components/ui/scroll-area'
import { deleteArtifact, fetchArtifact, fetchArtifacts, type ArtifactListItem } from '@/lib/api'
import { groupArtifactVersions } from '@/lib/artifact-groups'
import { cn } from '@/lib/utils'
import { useAppStore } from '@/stores/app-store'

const typeOrder = ['all', 'code', 'document', 'report', 'image', 'video', 'spreadsheet', 'ppt', 'project']
const customerReadableTypes = new Set([
  'code',
  'document',
  'report',
  'image',
  'video',
  'spreadsheet',
  'ppt',
  'project',
  'file_bundle',
  'json',
  'browser_state',
  'desktop_result',
])

export function ArtifactLibrary({
  conversationId,
  showConversationTitle = true,
}: {
  conversationId?: string
  showConversationTitle?: boolean
}) {
  const [items, setItems] = useState<ArtifactListItem[]>([])
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')
  const [typeFilter, setTypeFilter] = useState('all')
  const [pendingPreviewId, setPendingPreviewId] = useState<string | null>(null)
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)

  const upsertArtifact = useAppStore((s) => s.upsertArtifact)
  const openArtifactPreview = useAppStore((s) => s.openArtifactPreview)
  const previewArtifactId = useAppStore((s) => s.previewArtifactId)
  const artifactsById = useAppStore((s) => s.artifacts)
  const removeArtifact = useAppStore((s) => s.removeArtifact)
  const storeArtifacts = useAppStore((s) => s.artifacts)
  const conversations = useAppStore((s) => s.conversations)

  const refresh = async () => {
    setLoading(true)
    try {
      const list = await fetchArtifacts()
      setItems(list)
    } catch (err) {
      console.error('[ArtifactLibrary] load failed', err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void refresh()
  }, [])

  const mergedItems = useMemo(() => {
    const byId = new Map<string, ArtifactListItem>()
    for (const item of items) byId.set(item.id, item)
    for (const artifact of Object.values(storeArtifacts)) {
      const existing = byId.get(artifact.id)
      byId.set(artifact.id, {
        id: artifact.id,
        conversationId: artifact.conversationId,
        conversationTitle:
          conversations[artifact.conversationId]?.title ?? existing?.conversationTitle ?? null,
        type: artifact.type,
        title: artifact.title,
        version: artifact.version,
        parentArtifactId: artifact.parentArtifactId ?? existing?.parentArtifactId ?? null,
        createdByAgentId: artifact.createdByAgentId,
        createdAt: artifact.createdAt,
      })
    }
    return [...byId.values()].sort((a, b) => b.createdAt - a.createdAt)
  }, [conversations, items, storeArtifacts])

  const scopedItems = useMemo(
    () => (conversationId ? mergedItems.filter((item) => item.conversationId === conversationId) : mergedItems),
    [conversationId, mergedItems],
  )

  const grouped = useMemo(() => groupArtifactVersions(scopedItems), [scopedItems])
  const typeCounts = useMemo(() => {
    const counts = new Map<string, number>()
    for (const group of grouped) {
      counts.set(group.latest.type, (counts.get(group.latest.type) ?? 0) + 1)
    }
    return counts
  }, [grouped])

  const filteredGroups = useMemo(() => {
    const q = query.trim().toLowerCase()
    return grouped.filter((group) => {
      const matchesType = typeFilter === 'all' || group.latest.type === typeFilter
      if (!matchesType) return false
      if (!q) return true
      return group.versions.some((artifact) => {
        const hay = `${artifact.title} ${artifact.type} v${artifact.version} ${
          artifact.conversationTitle ?? ''
        }`.toLowerCase()
        return hay.includes(q)
      })
    })
  }, [grouped, query, typeFilter])

  const conversationCount = useMemo(
    () => new Set(scopedItems.map((item) => item.conversationId)).size,
    [scopedItems],
  )

  const visibleTypeFilters = useMemo(() => {
    const fromData = [...typeCounts.keys()].filter((type) => !typeOrder.includes(type))
    return [...typeOrder, ...fromData]
  }, [typeCounts])

  const customerReadableCount = useMemo(
    () => grouped.filter((group) => isCustomerReadable(group.latest.type)).length,
    [grouped],
  )
  const pendingReviewCount = Math.max(0, grouped.length - customerReadableCount)
  const previewableCount = customerReadableCount
  const versionedGroupCount = useMemo(
    () => grouped.filter((group) => group.versions.length > 1).length,
    [grouped],
  )
  const topDeliveryTypes = useMemo(
    () => [...typeCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3),
    [typeCounts],
  )

  const recentDeliveryGroups = useMemo(() => grouped.slice(0, 3), [grouped])

  const openPreview = async (id: string) => {
    if (previewArtifactId === id) return
    if (artifactsById[id]) {
      openArtifactPreview(id)
      return
    }

    setPendingPreviewId(id)
    try {
      const full = await fetchArtifact(id)
      upsertArtifact(full)
      openArtifactPreview(id)
    } catch (err) {
      console.error('[ArtifactLibrary] preview load failed', err)
    } finally {
      setPendingPreviewId(null)
    }
  }

  const deleteTarget = deleteTargetId ? mergedItems.find((item) => item.id === deleteTargetId) : null

  const confirmDelete = async () => {
    if (!deleteTargetId) return
    setDeleting(true)
    try {
      await deleteArtifact(deleteTargetId)
      removeArtifact(deleteTargetId)
      setItems((current) => current.filter((item) => item.id !== deleteTargetId))
      setDeleteTargetId(null)
    } catch (err) {
      console.error('[ArtifactLibrary] delete failed', err)
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      <div className="shrink-0 border-b px-3 py-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <Layers className="size-4 text-primary" />
              <span>交付物中心</span>
            </div>
            <div className="mt-1 max-w-3xl text-xs text-muted-foreground">
              这里集中管理 Agent 产出的视频、图片、代码、文档和文件包。用户不用理解技术日志，只需要确认哪些内容能预览、能追溯、能交付给客户。
            </div>
          </div>
          <Button variant="outline" size="sm" className="gap-1" onClick={() => void refresh()} disabled={loading}>
            {loading ? <Loader2 className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />}
            刷新
          </Button>
        </div>

        <div className="mt-3 grid gap-2 sm:grid-cols-4">
          <StatCard label="客户可读" value={customerReadableCount} />
          <StatCard label="全部版本" value={scopedItems.length} />
          <StatCard label="来源会话" value={conversationCount} />
          <StatCard label="交付类型" value={typeCounts.size} />
        </div>

        <section
          className="mt-3 rounded-lg border bg-background p-3"
          data-testid="artifact-customer-delivery-overview"
        >
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2 text-sm font-semibold">
                <PackageCheck className="size-4 text-primary" />
                <span>客户可见交付总览</span>
              </div>
              <p className="mt-1 max-w-3xl text-xs text-muted-foreground">
                按 Agent 最终产物来看，不按技术日志来看：视频、图片、代码、文档、项目包都会汇总到这里，方便确认能不能直接给客户。
              </p>
            </div>
            <div className="flex flex-wrap gap-1.5">
              <DeliveryChip icon={<Sparkles className="size-3.5" />} label="生成产物" />
              <DeliveryChip icon={<Eye className="size-3.5" />} label="预览验收" />
              <DeliveryChip icon={<PackageCheck className="size-3.5" />} label="打包交付" />
            </div>
          </div>
          <div className="mt-3 grid gap-2 md:grid-cols-4">
            <DeliverySummaryCard label="可直接给客户" value={`${customerReadableCount} 个`} />
            <DeliverySummaryCard label="待人工确认" value={`${pendingReviewCount} 个`} />
            <DeliverySummaryCard label="可预览" value={`${previewableCount} 个`} />
            <DeliverySummaryCard label="有版本历史" value={`${versionedGroupCount} 组`} />
          </div>
          <div className="mt-3 rounded-md bg-muted px-2.5 py-2 text-xs text-muted-foreground">
            {topDeliveryTypes.length > 0
              ? `当前主要产物类型：${topDeliveryTypes
                  .map(([type, count]) => `${typeLabel(type)} ${count}`)
                  .join('、')}`
              : '等待第一个 Agent 产物。运行任务后，这里会显示客户能看到的最终成果。'}
          </div>
        </section>

        <section className="mt-3 rounded-lg border bg-muted/25 p-3" aria-label="客户交付包">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2 text-sm font-semibold">
                <PackageCheck className="size-4 text-primary" />
                <span>客户交付包</span>
              </div>
              <p className="mt-1 max-w-3xl text-xs text-muted-foreground">
                交付包会把画布和对话里产出的文件按客户能理解的方式收好：产物类型、来源会话、版本记录、交付检查都在这里。
              </p>
            </div>
            <div className="flex flex-wrap gap-1.5">
              <DeliveryChip icon={<Eye className="size-3.5" />} label="可预览" />
              <DeliveryChip icon={<GitBranch className="size-3.5" />} label="有版本" />
              <DeliveryChip icon={<CheckCircle2 className="size-3.5" />} label="可追溯" />
              <DeliveryChip icon={<PackageCheck className="size-3.5" />} label="客户可读" />
            </div>
          </div>

          {recentDeliveryGroups.length === 0 ? (
            <div className="mt-3 rounded-lg border border-dashed bg-background/70 px-3 py-4 text-sm text-muted-foreground">
              还没有交付物。运行智能体或编排画布后，视频、图片、代码、文档等会自动进入这里，并显示来源、版本和客户可读状态。
            </div>
          ) : (
            <div className="mt-3 grid gap-2 lg:grid-cols-3">
              {recentDeliveryGroups.map((group) => (
                <button
                  key={group.rootId}
                  type="button"
                  onClick={() => void openPreview(group.latest.id)}
                  className="min-w-0 rounded-lg border bg-background px-3 py-2 text-left transition hover:border-primary/50"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="line-clamp-1 text-sm font-semibold">{group.latest.title}</span>
                    <span className="shrink-0 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] text-primary">
                      {deliveryStatusLabel(group.latest.type)}
                    </span>
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                    <span>{typeLabel(group.latest.type)}</span>
                    <span>v{group.latest.version}</span>
                    <span>{group.versions.length} 个版本</span>
                  </div>
                </button>
              ))}
            </div>
          )}
        </section>
      </div>

      <div className="shrink-0 border-b px-3 py-3">
        <div className="grid gap-2 xl:grid-cols-[minmax(0,1fr)_auto]">
          <div className="relative min-w-0">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索交付物、类型、会话名称"
              className="h-10 pl-9"
            />
          </div>
          <div className="flex min-w-0 flex-wrap gap-1.5">
            {visibleTypeFilters.map((type) => (
              <button
                key={type}
                type="button"
                onClick={() => setTypeFilter(type)}
                className={cn(
                  'h-10 rounded-lg border px-3 text-xs transition',
                  typeFilter === type
                    ? 'border-primary bg-primary text-primary-foreground'
                    : 'bg-background text-muted-foreground hover:border-foreground/25 hover:text-foreground',
                )}
              >
                {typeLabel(type)}
                {type !== 'all' && (
                  <span className="ml-1 text-[10px] opacity-75">{typeCounts.get(type) ?? 0}</span>
                )}
              </button>
            ))}
          </div>
        </div>
      </div>

      <ScrollArea className="min-h-0 min-w-0 flex-1">
        <div className="grid gap-3 p-3 lg:grid-cols-2 2xl:grid-cols-3">
          {loading && mergedItems.length === 0 ? (
            <div className="col-span-full flex items-center justify-center rounded-lg border border-dashed py-12 text-sm text-muted-foreground">
              <Loader2 className="mr-2 size-4 animate-spin" />
              正在加载交付物
            </div>
          ) : filteredGroups.length === 0 ? (
            <div className="col-span-full rounded-lg border border-dashed px-4 py-12 text-center text-sm text-muted-foreground">
              {scopedItems.length === 0
                ? '还没有交付物。Agent 完成任务后会自动出现在这里。'
                : '没有匹配的交付物。'}
            </div>
          ) : (
            filteredGroups.map((group) => {
              const latest = group.latest
              const versions = group.versions
              const pendingVersionId = versions.some((artifact) => pendingPreviewId === artifact.id)
                ? pendingPreviewId
                : null
              const previewVersionId = versions.some((artifact) => previewArtifactId === artifact.id)
                ? previewArtifactId
                : null
              const selectedVersionId = pendingVersionId ?? previewVersionId ?? latest.id

              return (
                <article
                  key={group.rootId}
                  className={cn(
                    'group flex min-h-[14rem] min-w-0 flex-col rounded-lg border bg-background p-3 transition',
                    previewVersionId ? 'border-primary shadow-sm shadow-primary/10' : 'hover:border-foreground/25',
                  )}
                >
                  <button
                    type="button"
                    onClick={() => void openPreview(latest.id)}
                    disabled={pendingPreviewId === latest.id}
                    className="grid min-w-0 flex-1 grid-cols-[auto_minmax(0,1fr)] gap-3 text-left"
                  >
                    <div className="flex size-11 items-center justify-center rounded-lg bg-primary/10 text-primary">
                      {pendingPreviewId === latest.id ? (
                        <Loader2 className="size-5 animate-spin" />
                      ) : (
                        <TypeIcon type={latest.type} />
                      )}
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="line-clamp-2 text-sm font-semibold">{latest.title}</div>
                          <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                            <span>{typeLabel(latest.type)}</span>
                            <span>v{latest.version}</span>
                            <span>{formatTime(latest.createdAt)}</span>
                          </div>
                        </div>
                        <span
                          className={cn(
                            'shrink-0 rounded-full border px-2 py-0.5 text-[10px]',
                            isCustomerReadable(latest.type)
                              ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-600'
                              : 'text-muted-foreground',
                          )}
                        >
                          {deliveryStatusLabel(latest.type)}
                        </span>
                      </div>

                      <div className="mt-3 grid gap-1.5 text-xs text-muted-foreground">
                        {showConversationTitle && (
                          <MetaLine label="来源会话" value={latest.conversationTitle ?? '未绑定会话'} />
                        )}
                        <MetaLine label="创建 Agent" value={latest.createdByAgentId || '未知'} />
                        <MetaLine label="交付检查" value={isCustomerReadable(latest.type) ? '客户可读，可预览' : '需要人工确认'} />
                      </div>
                    </div>
                  </button>

                  <div className="mt-3 flex items-center justify-between gap-2 border-t pt-3">
                    <div className="flex min-w-0 flex-wrap items-center gap-1">
                      <span className="mr-1 text-xs text-muted-foreground">版本</span>
                      {versions.map((version) => {
                        const isPending = pendingPreviewId === version.id
                        const isSelected = version.id === selectedVersionId
                        return (
                          <button
                            key={version.id}
                            type="button"
                            onClick={() => void openPreview(version.id)}
                            disabled={isPending}
                            aria-pressed={isSelected}
                            title={`${version.title} - ${formatTime(version.createdAt)}`}
                            className={cn(
                              'inline-flex h-7 shrink-0 items-center gap-1 rounded-md border px-2 font-mono text-[11px] transition',
                              isSelected
                                ? 'border-primary/40 bg-primary/10 text-foreground'
                                : 'bg-background text-muted-foreground hover:border-foreground/25 hover:text-foreground',
                            )}
                          >
                            {isPending && <Loader2 className="size-3 animate-spin" />}
                            v{version.version}
                          </button>
                        )
                      })}
                    </div>

                    <button
                      type="button"
                      onClick={() => setDeleteTargetId(latest.id)}
                      title="删除最新版本"
                      className="flex size-8 shrink-0 items-center justify-center rounded-md border text-muted-foreground opacity-0 transition hover:border-red-500/40 hover:text-red-600 group-hover:opacity-100"
                    >
                      <Trash2 className="size-4" />
                    </button>
                  </div>
                </article>
              )
            })
          )}
        </div>
      </ScrollArea>

      <Dialog open={!!deleteTargetId} onOpenChange={(open) => !open && setDeleteTargetId(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>删除交付物</DialogTitle>
            <DialogDescription>
              {deleteTarget
                ? `确定删除「${deleteTarget.title}」v${deleteTarget.version} 吗？聊天里指向这个版本的卡片将不再可预览。`
                : '确定删除这个交付物版本吗？该操作不可恢复。'}
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

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border bg-background px-3 py-2">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 text-xl font-semibold">{value}</div>
    </div>
  )
}

function DeliverySummaryCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border bg-muted/20 px-3 py-2">
      <div className="text-[11px] text-muted-foreground">{label}</div>
      <div className="mt-1 truncate text-lg font-semibold">{value}</div>
    </div>
  )
}

function DeliveryChip({ icon, label }: { icon: ReactNode; label: string }) {
  return (
    <span className="inline-flex h-7 items-center gap-1 rounded-md border bg-background px-2 text-xs text-muted-foreground">
      {icon}
      {label}
    </span>
  )
}

function MetaLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid min-w-0 grid-cols-[4.5rem_minmax(0,1fr)] gap-2 rounded-md bg-muted px-2 py-1.5">
      <span className="shrink-0 text-muted-foreground">{label}</span>
      <span className="truncate text-foreground">{value}</span>
    </div>
  )
}

function TypeIcon({ type }: { type: string }) {
  const className = 'size-5'
  if (type === 'code') return <Code2 className={className} />
  if (type === 'image') return <ImageIcon className={className} />
  if (type === 'video') return <Video className={className} />
  if (type === 'document' || type === 'report') return <FileText className={className} />
  if (type === 'spreadsheet') return <Sheet className={className} />
  if (type === 'ppt') return <Presentation className={className} />
  if (type === 'project' || type === 'file_bundle') return <FolderGit2 className={className} />
  return <Layers className={className} />
}

function isCustomerReadable(type: string): boolean {
  return customerReadableTypes.has(type)
}

function deliveryStatusLabel(type: string): string {
  return isCustomerReadable(type) ? '客户可读' : '待检查'
}

function typeLabel(type: string): string {
  const table: Record<string, string> = {
    all: '全部',
    code: '代码',
    document: '文档',
    report: '报告',
    image: '图片',
    video: '视频',
    spreadsheet: '表格',
    ppt: '演示',
    project: '项目',
    file_bundle: '文件包',
    json: '数据',
    browser_state: '浏览器状态',
    desktop_result: '电脑操作结果',
  }
  return table[type] ?? type
}

function formatTime(ts: number): string {
  const date = new Date(ts)
  const now = new Date()
  if (
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate()
  ) {
    return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
  }
  return date.toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' })
}
