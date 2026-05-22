'use client'

import { Check, ChevronRight, Copy, FileText, Image as ImageIcon, Layers, Loader2, Wrench } from 'lucide-react'
import { useState } from 'react'

import { Card, CardContent } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import type { MessagePart } from '@/shared/types'
import { useAppStore } from '@/stores/app-store'

// ─── PartList: 调度入口 ─────────────────────────────────
export function PartList({ parts }: { parts: MessagePart[] }) {
  return (
    <div className="space-y-2">
      {parts.map((p, i) => (
        <PartRenderer key={i} part={p} />
      ))}
    </div>
  )
}

function PartRenderer({ part }: { part: MessagePart }) {
  switch (part.type) {
    case 'text':
      return <TextPart content={part.content} />
    case 'thinking':
      return <ThinkingPart content={part.content} />
    case 'code':
      return <CodePart language={part.language} content={part.content} />
    case 'tool_use':
      return <ToolUsePart toolName={part.toolName} args={part.args} callId={part.callId} />
    case 'tool_result':
      return <ToolResultPart result={part.result} isError={part.isError} />
    case 'artifact_ref':
      return <ArtifactRefPart artifactId={part.artifactId} />
    default:
      return null
  }
}

// ─── Text ──────────────────────────────────────────────
function TextPart({ content }: { content: string }) {
  return <div className="whitespace-pre-wrap text-sm leading-6 text-foreground">{content}</div>
}

// ─── Thinking（可折叠）──────────────────────────────────
function ThinkingPart({ content }: { content: string }) {
  const [open, setOpen] = useState(false)
  if (!content) return null
  return (
    <button
      type="button"
      onClick={() => setOpen((v) => !v)}
      className="group flex w-full items-start gap-2 rounded-md border border-dashed border-muted-foreground/30 bg-muted/40 px-3 py-2 text-left text-xs text-muted-foreground transition hover:border-muted-foreground/50"
    >
      <ChevronRight
        className={cn('mt-0.5 size-3.5 shrink-0 transition-transform', open && 'rotate-90')}
      />
      <div className="flex-1">
        <div className="font-medium uppercase tracking-wide text-muted-foreground/70">思考</div>
        <div
          className={cn(
            'mt-1 whitespace-pre-wrap italic leading-relaxed',
            !open && 'line-clamp-1',
          )}
        >
          {content}
        </div>
      </div>
    </button>
  )
}

// ─── Code ──────────────────────────────────────────────
function CodePart({ language, content }: { language: string; content: string }) {
  const [copied, setCopied] = useState(false)

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(content)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // 忽略
    }
  }

  return (
    <div className="group relative overflow-hidden rounded-md border bg-zinc-950 text-zinc-100">
      <div className="flex items-center justify-between border-b border-zinc-800 px-3 py-1.5 text-xs">
        <span className="font-mono text-zinc-400">{language || 'text'}</span>
        <button
          type="button"
          onClick={copy}
          className="flex items-center gap-1 rounded px-1.5 py-0.5 text-zinc-400 opacity-0 transition group-hover:opacity-100 hover:bg-zinc-800 hover:text-zinc-100"
        >
          {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
          {copied ? '已复制' : '复制'}
        </button>
      </div>
      <pre className="overflow-x-auto px-3 py-2 text-xs leading-relaxed">
        <code>{content}</code>
      </pre>
    </div>
  )
}

// ─── ToolUse ───────────────────────────────────────────
function ToolUsePart({
  toolName,
  args,
  callId,
}: {
  toolName: string
  args: unknown
  callId: string
}) {
  return (
    <Card className="border-amber-200 bg-amber-50/50 dark:border-amber-900/50 dark:bg-amber-950/20">
      <CardContent className="flex items-start gap-2 px-3 py-2">
        <Wrench className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" />
        <div className="flex-1 space-y-1">
          <div className="flex items-center gap-2 text-xs font-medium">
            <span>调用工具</span>
            <code className="rounded bg-amber-100 px-1.5 py-0.5 font-mono text-amber-900 dark:bg-amber-900/30 dark:text-amber-200">
              {toolName}
            </code>
            <span className="text-muted-foreground">·</span>
            <Loader2 className="size-3 animate-spin text-amber-600 dark:text-amber-400" />
          </div>
          <pre className="overflow-x-auto rounded bg-amber-100/50 px-2 py-1 text-xs text-amber-900 dark:bg-amber-900/20 dark:text-amber-200">
            {JSON.stringify(args, null, 2)}
          </pre>
          <div className="font-mono text-[10px] text-muted-foreground">{callId}</div>
        </div>
      </CardContent>
    </Card>
  )
}

// ─── ToolResult ────────────────────────────────────────
function ToolResultPart({ result, isError }: { result: unknown; isError: boolean }) {
  return (
    <Card
      className={cn(
        isError
          ? 'border-red-200 bg-red-50/50 dark:border-red-900/50 dark:bg-red-950/20'
          : 'border-emerald-200 bg-emerald-50/50 dark:border-emerald-900/50 dark:bg-emerald-950/20',
      )}
    >
      <CardContent className="flex items-start gap-2 px-3 py-2">
        <Check
          className={cn(
            'mt-0.5 size-4 shrink-0',
            isError ? 'text-red-600 dark:text-red-400' : 'text-emerald-600 dark:text-emerald-400',
          )}
        />
        <div className="flex-1">
          <div className="text-xs font-medium">{isError ? '工具调用失败' : '工具返回'}</div>
          <pre className="mt-1 overflow-x-auto rounded bg-black/5 px-2 py-1 text-xs dark:bg-white/5">
            {typeof result === 'string' ? result : JSON.stringify(result, null, 2)}
          </pre>
        </div>
      </CardContent>
    </Card>
  )
}

// ─── ArtifactRef ───────────────────────────────────────
function ArtifactRefPart({ artifactId }: { artifactId: string }) {
  const artifact = useAppStore((s) => s.artifacts[artifactId])

  if (!artifact) {
    return (
      <Card className="border-dashed">
        <CardContent className="flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground">
          <Layers className="size-4" />
          <span>产物 {artifactId} 加载中</span>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card className="cursor-pointer transition hover:border-foreground/30">
      <CardContent className="flex items-start gap-3 px-3 py-2">
        <ArtifactIcon type={artifact.type} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium">{artifact.title}</div>
          <div className="text-xs text-muted-foreground">
            {artifact.type} · v{artifact.version}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

function ArtifactIcon({ type }: { type: string }) {
  if (type === 'image') return <ImageIcon className="size-5 shrink-0 text-muted-foreground" />
  if (type === 'document') return <FileText className="size-5 shrink-0 text-muted-foreground" />
  return <Layers className="size-5 shrink-0 text-muted-foreground" />
}
