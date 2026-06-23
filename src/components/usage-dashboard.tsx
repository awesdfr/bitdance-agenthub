'use client'

import {
  BarChart3,
  CheckCircle2,
  Clock3,
  Coins,
  Database,
  FileText,
  Gauge,
  Loader2,
  RefreshCw,
  ShieldCheck,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'

import { ScrollArea } from '@/components/ui/scroll-area'
import { fetchUsageSummary, type UsageBucket, type UsageSummary } from '@/lib/api'
import { cn } from '@/lib/utils'
import { useAppStore } from '@/stores/app-store'

export function UsageDashboard() {
  const [data, setData] = useState<UsageSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const setActiveConversation = useAppStore((s) => s.setActiveConversation)

  const reload = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const summary = await fetchUsageSummary()
      setData(summary)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void reload()
  }, [reload])

  const contextLabel = useMemo(() => {
    if (!data) return '正常'
    if (data.runtime.contextStatus === 'over_limit') return '需要压缩'
    if (data.runtime.contextStatus === 'near_limit') return '接近上限'
    return '正常'
  }, [data])

  if (loading && !data) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center gap-2 text-xs text-muted-foreground">
        <Loader2 className="size-3.5 animate-spin" />
        正在加载用量数据
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 p-4 text-center text-xs">
        <div className="text-destructive">{error}</div>
        <button
          type="button"
          onClick={() => void reload()}
          className="rounded-md border px-3 py-1.5 hover:bg-accent"
        >
          重试
        </button>
      </div>
    )
  }

  if (!data) return null

  return (
    <ScrollArea className="min-h-0 flex-1">
      <div className="min-h-full bg-background p-3 text-xs">
        <header className="mb-3 flex items-center justify-between border-b pb-2">
          <span className="flex items-center gap-1.5 font-semibold">
            <BarChart3 className="size-3.5" />
            用量分析
          </span>
          <button
            type="button"
            onClick={() => void reload()}
            disabled={loading}
            className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-50"
          >
            <RefreshCw className={cn('size-3.5', loading && 'animate-spin')} />
            刷新
          </button>
        </header>

        <div className="grid max-w-[1280px] gap-3 xl:grid-cols-[320px_minmax(0,1fr)]">
          <div className="space-y-3">
            <Panel title="上下文窗口" hint="当前上下文窗口占用" icon={<Gauge className="size-4" />}>
              <ContextGauge data={data} />
            </Panel>

            <Panel title="运行指标" icon={<Clock3 className="size-4" />}>
              <div className="grid grid-cols-2 gap-2">
                <MetricTile label="耗时" value={formatDuration(data.runtime.elapsedMs)} />
                <MetricTile label="请求数" value={formatInteger(data.runtime.requestCount)} />
                <MetricTile
                  className="col-span-2"
                  label="会话 tokens"
                  value={formatInteger(data.runtime.conversationTokens)}
                />
              </div>
            </Panel>

            <Panel title="成本" icon={<Coins className="size-4" />}>
              <div className="grid grid-cols-2 gap-2">
                <MetricTile
                  label="缓存命中"
                  value={
                    data.runtime.cacheHitTokens > 0
                      ? `${Math.round(data.runtime.cacheHitRate * 100)}%`
                      : '-'
                  }
                />
                <MetricTile
                  label="估算费用"
                  value={`$${data.runtime.estimatedCostUsd.toFixed(4)}`}
                />
              </div>
            </Panel>

            <Panel title="会话状态" icon={<ShieldCheck className="size-4" />}>
              <div className="grid grid-cols-2 gap-2">
                <MetricTile
                  label="上下文状态"
                  value={contextLabel}
                  tone={data.runtime.contextStatus === 'normal' ? 'good' : 'warn'}
                />
                <MetricTile
                  label="压缩状态"
                  value={
                    data.runtime.compressionPercent > 0
                      ? `${data.runtime.compressionPercent}%`
                      : '待生成'
                  }
                />
              </div>
            </Panel>
          </div>

          <div className="space-y-3">
            <Panel title="模型实际消耗" hint="按模型拆分真实 token、缓存与费用" icon={<BarChart3 className="size-4" />}>
              <ModelUsagePanel models={data.byModel} totalTokens={data.allTime.totalTokens} />
            </Panel>

            <Panel title="工程文件上下文" hint="降低 token 消耗的工程文件策略" icon={<FileText className="size-4" />}>
              <div className="grid gap-2 sm:grid-cols-4">
                <StrategyPill label="文件索引" value="启用" />
                <StrategyPill label="读取方式" value="按需" />
                <StrategyPill label="单次上限" value={formatInteger(data.projectContext.fileReadCharLimit)} />
                <StrategyPill
                  label="摘要 tokens"
                  value={formatInteger(data.projectContext.summaryTokens)}
                />
              </div>
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                {data.projectContext.rules.map((rule) => (
                  <div
                    key={rule}
                    className="flex min-h-12 items-start gap-2 rounded-md border bg-muted/20 p-2 text-muted-foreground"
                  >
                    <CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-emerald-500" />
                    <span>{rule}</span>
                  </div>
                ))}
              </div>
            </Panel>

            <Panel title="时间统计" icon={<Database className="size-4" />}>
              <div className="grid gap-2 sm:grid-cols-3">
                <BucketTile label="今日" bucket={data.today} />
                <BucketTile label="本周" bucket={data.week} />
                <BucketTile label="全部" bucket={data.allTime} />
              </div>
            </Panel>

            <Panel title="消耗排行" icon={<BarChart3 className="size-4" />}>
              <div className="grid gap-4 lg:grid-cols-2">
                <RankGroup title="按模型">
                  {data.byModel.length > 0 ? (
                    data.byModel.slice(0, 5).map((item) => (
                      <BarRow
                        key={item.model}
                        label={item.model}
                        value={item.totalTokens}
                        runs={item.runs}
                        max={data.byModel[0].totalTokens}
                      />
                    ))
                  ) : (
                    <EmptyLine text="暂无模型用量" />
                  )}
                </RankGroup>

                <RankGroup title="按智能体">
                  {data.byAgent.length > 0 ? (
                    data.byAgent.slice(0, 5).map((item) => (
                      <BarRow
                        key={item.agentId}
                        label={item.name}
                        value={item.totalTokens}
                        runs={item.runs}
                        max={data.byAgent[0].totalTokens}
                      />
                    ))
                  ) : (
                    <EmptyLine text="暂无智能体用量" />
                  )}
                </RankGroup>
              </div>
            </Panel>

            <Panel title="高耗会话" icon={<Coins className="size-4" />}>
              <div className="space-y-1.5">
                {data.topConversations.length > 0 ? (
                  data.topConversations.map((conversation) => (
                    <button
                      key={conversation.id}
                      type="button"
                      onClick={() => setActiveConversation(conversation.id)}
                      className="flex w-full items-center justify-between gap-3 rounded-md border bg-muted/10 px-3 py-2 text-left hover:bg-accent"
                    >
                      <span className="min-w-0 flex-1 truncate font-medium">
                        {conversation.title}
                      </span>
                      <span className="shrink-0 font-mono text-muted-foreground">
                        {formatTokens(conversation.totalTokens)}
                      </span>
                    </button>
                  ))
                ) : (
                  <EmptyLine text="暂无会话用量" />
                )}
              </div>
            </Panel>
          </div>
        </div>
      </div>
    </ScrollArea>
  )
}

function ModelUsagePanel({
  models,
  totalTokens,
}: {
  models: UsageSummary['byModel']
  totalTokens: number
}) {
  if (models.length === 0) return <EmptyLine text="暂无模型消耗数据" />

  const max = Math.max(...models.map((model) => model.totalTokens), 1)
  return (
    <div className="space-y-3">
      <div className="grid gap-2 sm:grid-cols-4">
        <MetricTile label="模型数" value={formatInteger(models.length)} />
        <MetricTile label="总 tokens" value={formatTokens(totalTokens)} />
        <MetricTile
          label="最高消耗模型"
          value={formatTokens(models[0]?.totalTokens ?? 0)}
        />
        <MetricTile
          label="模型总费用"
          value={`$${models.reduce((sum, model) => sum + model.estimatedCostUsd, 0).toFixed(4)}`}
        />
      </div>

      <div className="space-y-2">
        {models.slice(0, 8).map((model) => (
          <ModelUsageCard key={model.model} model={model} maxTokens={max} />
        ))}
      </div>
    </div>
  )
}

function ModelUsageCard({
  model,
  maxTokens,
}: {
  model: UsageSummary['byModel'][number]
  maxTokens: number
}) {
  const relativePercent = maxTokens > 0 ? (model.totalTokens / maxTokens) * 100 : 0
  const inputPercent = segmentPercent(model.inputTokens, model.totalTokens)
  const outputPercent = segmentPercent(model.outputTokens, model.totalTokens)
  const cacheReadPercent = segmentPercent(model.cacheReadTokens, model.totalTokens)
  const cacheCreationPercent = segmentPercent(model.cacheCreationTokens, model.totalTokens)

  return (
    <article className="rounded-lg border bg-muted/10 p-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold">{model.model}</div>
          <div className="mt-1 text-[11px] text-muted-foreground">
            {model.runs} 次请求 · 平均 {formatTokens(model.avgTokensPerRun)} / 次 · 占比 {formatPercent(model.sharePercent * 100)}
          </div>
        </div>
        <div className="text-right">
          <div className="font-mono text-lg font-semibold">{formatTokens(model.totalTokens)}</div>
          <div className="text-[11px] text-muted-foreground">${model.estimatedCostUsd.toFixed(4)}</div>
        </div>
      </div>

      <div className="mt-3 h-2 overflow-hidden rounded-full bg-muted">
        <div className="flex h-full rounded-full" style={{ width: `${Math.max(2, Math.min(100, relativePercent))}%` }}>
          <UsageSegment className="bg-cyan-400" percent={inputPercent} />
          <UsageSegment className="bg-blue-500" percent={outputPercent} />
          <UsageSegment className="bg-emerald-500" percent={cacheReadPercent} />
          <UsageSegment className="bg-amber-500" percent={cacheCreationPercent} />
        </div>
      </div>

      <div className="mt-3 grid gap-2 sm:grid-cols-3 2xl:grid-cols-6">
        <MiniMetric color="bg-cyan-400" label="输入" value={formatTokens(model.inputTokens)} />
        <MiniMetric color="bg-blue-500" label="输出" value={formatTokens(model.outputTokens)} />
        <MiniMetric color="bg-emerald-500" label="缓存命中" value={formatTokens(model.cacheReadTokens)} />
        <MiniMetric color="bg-amber-500" label="缓存写入" value={formatTokens(model.cacheCreationTokens)} />
        <MiniMetric label="命中率" value={model.cacheReadTokens > 0 ? formatPercent(model.cacheHitRate * 100) : '-'} />
        <MiniMetric label="费用" value={`$${model.estimatedCostUsd.toFixed(4)}`} />
      </div>
    </article>
  )
}

function UsageSegment({ className, percent }: { className: string; percent: number }) {
  if (percent <= 0) return null
  return <div className={className} style={{ width: `${Math.max(1, percent)}%` }} />
}

function MiniMetric({
  label,
  value,
  color,
}: {
  label: string
  value: string
  color?: string
}) {
  return (
    <div className="rounded-md border bg-background px-2 py-1.5">
      <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
        {color ? <span className={cn('size-2 rounded-full', color)} /> : null}
        {label}
      </div>
      <div className="mt-1 truncate font-mono text-xs font-semibold">{value}</div>
    </div>
  )
}

function segmentPercent(value: number, total: number): number {
  return total > 0 ? (value / total) * 100 : 0
}

function Panel({
  title,
  hint,
  icon,
  children,
}: {
  title: string
  hint?: string
  icon: ReactNode
  children: ReactNode
}) {
  return (
    <section className="rounded-md border bg-card p-3 shadow-sm">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground">{icon}</span>
          <span className="font-semibold">{title}</span>
        </div>
        {hint ? <span className="text-[11px] text-muted-foreground">{hint}</span> : null}
      </div>
      {children}
    </section>
  )
}

function ContextGauge({ data }: { data: UsageSummary }) {
  const percent = Math.max(0, Math.min(100, data.context.percent))
  const gaugeStyle = {
    background: `conic-gradient(#3370ff ${percent * 3.6}deg, hsl(var(--muted)) 0deg)`,
  }
  const legend = [
    { label: 'Prompt', value: data.context.promptTokens, color: 'bg-cyan-400' },
    { label: 'Completion', value: data.context.completionTokens, color: 'bg-blue-500' },
    { label: 'Reasoning', value: data.context.reasoningTokens, color: 'bg-orange-400' },
    { label: 'Other', value: data.context.otherTokens, color: 'bg-neutral-500' },
  ]

  return (
    <div className="flex flex-col items-center">
      <div className="relative flex size-40 items-center justify-center rounded-full p-3" style={gaugeStyle}>
        <div className="flex size-full flex-col items-center justify-center rounded-full border bg-card text-center">
          <div className="text-3xl font-semibold tabular-nums">{formatTokens(data.context.usedTokens)}</div>
          <div className="mt-1 text-[11px] text-muted-foreground">
            / {formatTokens(data.context.limitTokens)} tokens
          </div>
        </div>
      </div>
      <div className="mt-4 text-2xl font-semibold tabular-nums">{formatPercent(percent)}</div>
      <div className="mt-4 w-full space-y-2">
        {legend.map((item) => (
          <div key={item.label} className="flex items-center justify-between gap-3">
            <span className="flex items-center gap-2 text-muted-foreground">
              <span className={cn('size-2.5 rounded-full', item.color)} />
              {item.label}
            </span>
            <span className="font-mono">{formatInteger(item.value)}</span>
          </div>
        ))}
      </div>
      <div className="mt-3 flex w-full items-center justify-between border-t pt-3">
        <span className="text-muted-foreground">Total</span>
        <span className="font-mono font-semibold">
          {formatInteger(data.context.totalTokens)} / {formatInteger(data.context.limitTokens)}
        </span>
      </div>
    </div>
  )
}

function MetricTile({
  label,
  value,
  tone = 'default',
  className,
}: {
  label: string
  value: string
  tone?: 'default' | 'good' | 'warn'
  className?: string
}) {
  return (
    <div className={cn('rounded-md border bg-muted/10 p-2.5', className)}>
      <div className="mb-1 text-[11px] text-muted-foreground">{label}</div>
      <div
        className={cn(
          'text-lg font-semibold tabular-nums',
          tone === 'good' && 'text-emerald-500',
          tone === 'warn' && 'text-orange-500',
        )}
      >
        {value}
      </div>
    </div>
  )
}

function StrategyPill({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border bg-muted/10 p-2">
      <div className="text-[11px] text-muted-foreground">{label}</div>
      <div className="mt-1 truncate font-semibold">{value}</div>
    </div>
  )
}

function BucketTile({ label, bucket }: { label: string; bucket: UsageBucket }) {
  return (
    <div className="rounded-md border bg-muted/10 p-2.5">
      <div className="text-[11px] text-muted-foreground">{label}</div>
      <div className="mt-1 font-mono text-lg font-semibold">{formatTokens(bucket.totalTokens)}</div>
      <div className="text-[11px] text-muted-foreground">{bucket.runs} 次请求</div>
    </div>
  )
}

function RankGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <div className="mb-2 text-[11px] font-medium text-muted-foreground">{title}</div>
      <div className="space-y-2">{children}</div>
    </div>
  )
}

function BarRow({
  label,
  value,
  runs,
  max,
}: {
  label: string
  value: number
  runs: number
  max: number
}) {
  const percent = max > 0 ? (value * 100) / max : 0
  return (
    <div className="space-y-1">
      <div className="flex items-baseline justify-between gap-3">
        <span className="min-w-0 flex-1 truncate font-medium">{label}</span>
        <span className="shrink-0 font-mono text-muted-foreground">
          {formatTokens(value)}
          <span className="ml-1 text-[10px]">· {runs}</span>
        </span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full bg-[#3370ff] transition-all"
          style={{ width: `${Math.min(100, percent)}%` }}
        />
      </div>
    </div>
  )
}

function EmptyLine({ text }: { text: string }) {
  return (
    <div className="rounded-md border border-dashed bg-muted/10 px-3 py-4 text-center text-muted-foreground">
      {text}
    </div>
  )
}

function formatTokens(value: number): string {
  if (value < 1000) return formatInteger(value)
  if (value < 1_000_000) return `${(value / 1000).toFixed(value < 10_000 ? 1 : 1)}k`
  return `${(value / 1_000_000).toFixed(2)}M`
}

function formatInteger(value: number): string {
  return new Intl.NumberFormat('en-US').format(Math.round(value))
}

function formatPercent(value: number): string {
  return `${Number.isInteger(value) ? value.toFixed(0) : value.toFixed(1)}%`
}

function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.round(ms / 1000))
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  if (hours > 0) return `${hours}小时${minutes}分`
  if (minutes > 0) return `${minutes}分${seconds}秒`
  return `${seconds}秒`
}
