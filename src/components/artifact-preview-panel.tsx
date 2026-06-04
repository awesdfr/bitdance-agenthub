'use client'

import { ChevronRight, Clock, Code, Copy, Download, ExternalLink, Eye, FileText, History, Image as ImageIcon, Layers, Pencil, RotateCcw, Save, X } from 'lucide-react'
import dynamic from 'next/dynamic'
import { useCallback, useEffect, useMemo, useState } from 'react'

import { Markdown } from '@/components/markdown'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import type { ArtifactRow } from '@/db/schema'
import { createArtifactVersion, fetchArtifactVersions } from '@/lib/api'
import { artifactPreviewPath } from '@/lib/artifact-preview'
import { cn } from '@/lib/utils'
import type { ArtifactContent } from '@/shared/types'
import { useAppStore } from '@/stores/app-store'

// 编辑器仅在用户点「编辑」时懒加载（重型 client 库；CodeMirror 无 worker、离线 OK）
const ArtifactCodeEditor = dynamic(() => import('./artifact-code-editor'), {
  ssr: false,
  loading: () => (
    <div className="flex size-full items-center justify-center p-4 text-xs text-muted-foreground">
      编辑器加载中…
    </div>
  ),
})

type SaveVersionFn = (rawContent: unknown, title?: string) => Promise<void>

/**
 * ArtifactPreviewPanel — 右侧滑入的产物预览面板。
 *
 * 由 store.previewArtifactId 控制显隐。按 artifact.type 分发到不同 view。
 * 顶部支持多版本切换：从同一个 root 派生的所有 artifact 通过 /versions API 查回。
 * web_app / document 支持面板内编辑并「提交为新版本」（POST /versions → createArtifactVersion）。
 */
export function ArtifactPreviewPanel() {
  const id = useAppStore((s) => s.previewArtifactId)
  const artifact = useAppStore((s) => (id ? s.artifacts[id] : null))
  const upsertArtifact = useAppStore((s) => s.upsertArtifact)
  const close = useAppStore((s) => s.closeArtifactPreview)
  const openPreview = useAppStore((s) => s.openArtifactPreview)

  const [versions, setVersions] = useState<ArtifactRow[] | null>(null)
  const [versionsLoading, setVersionsLoading] = useState(false)
  const [showVersions, setShowVersions] = useState(false)

  // 切到新 artifact 时拉它的版本链
  useEffect(() => {
    if (!id) return
    let cancelled = false
    setVersionsLoading(true)
    fetchArtifactVersions(id)
      .then((list) => {
        if (cancelled) return
        setVersions(list)
        // 把新发现的兄弟版本灌到 store，方便下次切换不重拉
        for (const v of list) upsertArtifact(v)
      })
      .catch((err) => {
        if (!cancelled) console.warn('[ArtifactPreviewPanel] versions fetch failed', err)
      })
      .finally(() => {
        if (!cancelled) setVersionsLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [id, upsertArtifact])

  const switchVersion = useCallback(
    (targetId: string) => {
      if (targetId !== id) openPreview(targetId)
    },
    [id, openPreview],
  )

  // 提交编辑后的内容为新版本，成功后切到新版本（版本条经 id effect 自动刷新）
  const handleSaveVersion = useCallback<SaveVersionFn>(
    async (rawContent, title) => {
      if (!id) return
      const row = await createArtifactVersion(id, { content: rawContent, title })
      upsertArtifact(row)
      openPreview(row.id)
    },
    [id, upsertArtifact, openPreview],
  )

  if (!id || !artifact) return null

  const versionCount = versions?.length ?? 0
  const hasMultiple = versionCount > 1

  return (
    <aside className="flex w-1/2 min-w-[420px] shrink-0 flex-col border-l bg-card max-md:fixed max-md:inset-0 max-md:z-40 max-md:w-full max-md:min-w-0">
      <header className="flex shrink-0 items-center justify-between border-b px-4 py-3">
        <div className="flex min-w-0 items-center gap-2">
          <TypeIcon type={artifact.type} />
          <div className="min-w-0">
            <div className="truncate text-sm font-medium">{artifact.title}</div>
            <div className="text-xs text-muted-foreground">
              {artifact.type} · v{artifact.version}
              {hasMultiple && ` / ${versionCount}`}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-1">
          {hasMultiple && (
            <Button
              size="icon"
              variant={showVersions ? 'default' : 'ghost'}
              onClick={() => setShowVersions((v) => !v)}
              title={`版本历史 (${versionCount} 个)`}
            >
              <History className="size-4" />
            </Button>
          )}
          {artifact.type === 'web_app' && (
            <>
              <Button
                size="icon"
                variant="ghost"
                onClick={() => openPreviewInNewTab(artifact.id)}
                title="打开预览 URL"
              >
                <ExternalLink className="size-4" />
              </Button>
              <Button
                size="icon"
                variant="ghost"
                onClick={() => copyPreviewUrl(artifact.id)}
                title="复制预览 URL"
              >
                <Copy className="size-4" />
              </Button>
            </>
          )}
          <a
            href={`/api/artifacts/${artifact.id}/export`}
            download
            title={`下载${artifact.type === 'web_app' ? ' .zip' : artifact.type === 'document' ? ' .md' : ''}`}
            className="inline-flex size-8 items-center justify-center rounded-lg text-foreground/70 transition hover:bg-muted hover:text-foreground"
          >
            <Download className="size-4" />
          </a>
          <Button size="icon" variant="ghost" onClick={close} title="关闭预览">
            <X className="size-4" />
          </Button>
        </div>
      </header>

      {/* 版本切换条：展开时显示所有版本，点击切换 */}
      {showVersions && versions && versions.length > 0 && (
        <div className="shrink-0 border-b bg-muted/20 px-3 py-2">
          <div className="mb-1 text-[10px] uppercase tracking-wider text-muted-foreground">
            版本历史
          </div>
          <div className="flex flex-wrap gap-1">
            {versions.map((v) => {
              const isCurrent = v.id === id
              return (
                <button
                  key={v.id}
                  type="button"
                  onClick={() => switchVersion(v.id)}
                  className={cn(
                    'inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] transition',
                    isCurrent
                      ? 'border-primary bg-primary/10 text-foreground'
                      : 'border-transparent hover:border-foreground/20 hover:bg-accent',
                  )}
                  title={`v${v.version} · ${new Date(v.createdAt).toLocaleString('zh-CN')}`}
                >
                  <span className="font-mono">v{v.version}</span>
                  <span className="text-muted-foreground">·</span>
                  <Clock className="size-2.5" />
                  <span className="font-mono text-[10px] text-muted-foreground">
                    {new Date(v.createdAt).toLocaleTimeString('zh-CN', {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </span>
                </button>
              )
            })}
          </div>
          {versionsLoading && (
            <div className="mt-1 text-[10px] text-muted-foreground">加载中…</div>
          )}
        </div>
      )}

      <ArtifactView artifact={artifact} onSaveVersion={handleSaveVersion} />
    </aside>
  )
}

// ─── 调度 ──────────────────────────────────────────────
function ArtifactView({
  artifact,
  onSaveVersion,
}: {
  artifact: ArtifactRow
  onSaveVersion: SaveVersionFn
}) {
  const content = artifact.content as ArtifactContent

  // 用 data-selection-target 标记容器：SelectionPopover 会响应这里的文字选择
  const wrap = (children: React.ReactNode) => (
    <div
      data-selection-target="artifact"
      data-selection-label={`产物「${artifact.title}」 v${artifact.version}`}
      data-selection-artifact-id={artifact.id}
      className="contents"
    >
      {children}
    </div>
  )

  switch (content.type) {
    case 'web_app':
      return wrap(<WebAppView artifactId={artifact.id} content={content} onSaveVersion={onSaveVersion} />)
    case 'document':
      return wrap(<DocumentView content={content} onSaveVersion={onSaveVersion} />)
    case 'image':
      return <ImageView content={content} />
    case 'code_file':
      return wrap(<CodeFileView content={content} />)
    case 'diff':
      return (
        <Empty>
          Diff 视图开发中。当前 artifact 类型: {content.type}
        </Empty>
      )
    default:
      return <Empty>该类型暂不支持预览</Empty>
  }
}

// ─── web_app: iframe + 源码 + 编辑 ─────────────────────
function WebAppView({
  artifactId,
  content,
  onSaveVersion,
}: {
  artifactId: string
  content: Extract<ArtifactContent, { type: 'web_app' }>
  onSaveVersion: SaveVersionFn
}) {
  const [view, setView] = useState<'render' | 'source' | 'edit'>('render')
  const [activeFile, setActiveFile] = useState<string>(content.entry)
  const [draftFiles, setDraftFiles] = useState<Record<string, string>>(content.files)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fileNames = Object.keys(content.files)

  // 切版本/产物（content 每行是新对象）时重置编辑态
  useEffect(() => {
    setDraftFiles(content.files)
    setActiveFile(content.entry)
    setView('render')
    setSaving(false)
    setError(null)
  }, [content])

  const dirty = useMemo(
    () => JSON.stringify(draftFiles) !== JSON.stringify(content.files),
    [draftFiles, content.files],
  )

  const save = async () => {
    setSaving(true)
    setError(null)
    try {
      await onSaveVersion({ files: draftFiles, entry: content.entry })
      // 成功后面板切到新版本，本视图随 content 变化自动重置
    } catch (e) {
      setError(e instanceof Error ? e.message : '提交失败')
      setSaving(false)
    }
  }

  const showFilePicker = (view === 'source' || view === 'edit') && fileNames.length > 1

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center justify-between border-b px-2">
        <div className="flex">
          <ViewTab active={view === 'render'} onClick={() => setView('render')}>
            <Eye className="size-3.5" />
            预览
          </ViewTab>
          <ViewTab active={view === 'source'} onClick={() => setView('source')}>
            <Code className="size-3.5" />
            源码
          </ViewTab>
          <ViewTab active={view === 'edit'} onClick={() => setView('edit')}>
            <Pencil className="size-3.5" />
            编辑
          </ViewTab>
        </div>
        {showFilePicker && (
          <select
            value={activeFile}
            onChange={(e) => setActiveFile(e.target.value)}
            className="rounded border bg-background px-2 py-0.5 text-xs"
          >
            {fileNames.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        )}
      </div>

      <div className="min-h-0 flex-1">
        {view === 'render' && (
          <iframe
            key={artifactId}
            src={artifactPreviewPath(artifactId)}
            sandbox="allow-scripts"
            className="size-full border-0 bg-white"
            title="Artifact preview"
          />
        )}
        {view === 'source' && (
          <ScrollArea className="size-full">
            <pre className="overflow-x-auto p-4 text-xs leading-relaxed">
              <code>{content.files[activeFile] ?? ''}</code>
            </pre>
          </ScrollArea>
        )}
        {view === 'edit' && (
          <ArtifactCodeEditor
            value={draftFiles[activeFile] ?? ''}
            onChange={(next) => setDraftFiles((d) => ({ ...d, [activeFile]: next }))}
            filename={activeFile}
            type="web_app"
          />
        )}
      </div>

      {view === 'edit' && (
        <EditFooter
          dirty={dirty}
          saving={saving}
          error={error}
          onSave={save}
          onReset={() => {
            setDraftFiles(content.files)
            setActiveFile(content.entry)
            setError(null)
          }}
        />
      )}
    </div>
  )
}

// ─── document: 预览 + 编辑 ─────────────────────────────
function DocumentView({
  content,
  onSaveVersion,
}: {
  content: Extract<ArtifactContent, { type: 'document' }>
  onSaveVersion: SaveVersionFn
}) {
  const [view, setView] = useState<'render' | 'edit'>('render')
  const [draft, setDraft] = useState(content.content)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setDraft(content.content)
    setView('render')
    setSaving(false)
    setError(null)
  }, [content])

  const dirty = draft !== content.content

  const save = async () => {
    setSaving(true)
    setError(null)
    try {
      await onSaveVersion({ content: draft })
    } catch (e) {
      setError(e instanceof Error ? e.message : '提交失败')
      setSaving(false)
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 border-b px-2">
        <ViewTab active={view === 'render'} onClick={() => setView('render')}>
          <Eye className="size-3.5" />
          预览
        </ViewTab>
        <ViewTab active={view === 'edit'} onClick={() => setView('edit')}>
          <Pencil className="size-3.5" />
          编辑
        </ViewTab>
      </div>
      <div className="min-h-0 flex-1">
        {view === 'render' ? (
          <ScrollArea className="size-full">
            <div className="mx-auto max-w-3xl px-6 py-6">
              <Markdown>{content.content}</Markdown>
            </div>
          </ScrollArea>
        ) : (
          <ArtifactCodeEditor value={draft} onChange={setDraft} filename="document.md" type="document" />
        )}
      </div>
      {view === 'edit' && (
        <EditFooter
          dirty={dirty}
          saving={saving}
          error={error}
          onSave={save}
          onReset={() => {
            setDraft(content.content)
            setError(null)
          }}
        />
      )}
    </div>
  )
}

// ─── image ─────────────────────────────────────────────
function ImageView({ content }: { content: Extract<ArtifactContent, { type: 'image' }> }) {
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center bg-zinc-100 p-4 dark:bg-zinc-900">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={content.url}
        alt={content.alt}
        className="max-h-full max-w-full object-contain"
      />
    </div>
  )
}

// ─── code_file（workspace 文件，目前先 readonly 显示）───
function CodeFileView({
  content,
}: {
  content: Extract<ArtifactContent, { type: 'code_file' }>
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="shrink-0 border-b px-4 py-2 text-xs text-muted-foreground">
        <span className="font-mono">{content.workspacePath}</span>
        <span className="ml-2">· {content.language}</span>
        <span className="ml-2">· {(content.sizeBytes / 1024).toFixed(1)} KB</span>
      </div>
      <ScrollArea className="min-h-0 flex-1">
        <div className="px-4 py-3 text-xs text-muted-foreground">
          需要从 workspace 加载文件内容才能渲染（P1）
        </div>
      </ScrollArea>
    </div>
  )
}

// ─── 共享小组件 ───────────────────────────────────────
function EditFooter({
  dirty,
  saving,
  error,
  onSave,
  onReset,
}: {
  dirty: boolean
  saving: boolean
  error: string | null
  onSave: () => void
  onReset: () => void
}) {
  return (
    <div className="flex shrink-0 items-center gap-2 border-t px-3 py-2">
      <Button size="sm" disabled={!dirty || saving} onClick={onSave}>
        <Save className="size-3.5" />
        {saving ? '提交中…' : '提交为新版本'}
      </Button>
      <Button size="sm" variant="ghost" disabled={!dirty || saving} onClick={onReset}>
        <RotateCcw className="size-3.5" />
        重置
      </Button>
      {error ? (
        <span className="truncate text-xs text-red-600 dark:text-red-400">{error}</span>
      ) : (
        <span className="text-xs text-muted-foreground">
          {dirty ? '已修改 · 提交将创建新版本' : '编辑后提交为新版本'}
        </span>
      )}
    </div>
  )
}

function ViewTab({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex items-center gap-1.5 border-b-2 px-3 py-2 text-xs transition',
        active
          ? 'border-primary text-foreground'
          : 'border-transparent text-muted-foreground hover:text-foreground',
      )}
    >
      {children}
    </button>
  )
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center p-8 text-center text-sm text-muted-foreground">
      <div className="flex flex-col items-center gap-2">
        <ChevronRight className="size-5" />
        <div>{children}</div>
      </div>
    </div>
  )
}

function TypeIcon({ type }: { type: string }) {
  if (type === 'image') return <ImageIcon className="size-4 text-muted-foreground" />
  if (type === 'document') return <FileText className="size-4 text-muted-foreground" />
  return <Layers className="size-4 text-muted-foreground" />
}

function openPreviewInNewTab(artifactId: string): void {
  window.open(artifactPreviewPath(artifactId), '_blank', 'noopener,noreferrer')
}

function copyPreviewUrl(artifactId: string): void {
  const url = new URL(artifactPreviewPath(artifactId), window.location.origin).toString()
  navigator.clipboard?.writeText(url).catch(() => {})
}
