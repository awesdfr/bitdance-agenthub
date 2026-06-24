'use client'

import {
  CalendarClock,
  CheckCircle2,
  Clock3,
  Loader2,
  Play,
  Plus,
  RefreshCw,
  TimerReset,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import type {
  ContinuationPlanRow,
  JsonObject,
  TaskQueueItemRow,
  TaskQueueRow,
  TaskScheduleKind,
  TaskScheduleRow,
} from '@/db/schema'
import {
  createTaskQueue,
  createTaskSchedule,
  enqueueDueContinuationPlans,
  fetchContinuationPlans,
  fetchTaskQueueItems,
  fetchTaskQueues,
  fetchTaskSchedules,
  processTaskQueue,
  runDueTaskSchedules,
  runTaskQueueTick,
} from '@/lib/api'
import { cn } from '@/lib/utils'

type SavingAction =
  | 'create_queue'
  | 'create_schedule'
  | 'run_tick'
  | 'run_due'
  | 'enqueue_due'
  | 'process_queue'
  | null

export function TaskSchedulerCenter() {
  const [queues, setQueues] = useState<TaskQueueRow[]>([])
  const [queueItems, setQueueItems] = useState<TaskQueueItemRow[]>([])
  const [schedules, setSchedules] = useState<TaskScheduleRow[]>([])
  const [continuationPlans, setContinuationPlans] = useState<ContinuationPlanRow[]>([])
  const [selectedQueueId, setSelectedQueueId] = useState('')
  const [queueName, setQueueName] = useState('智能体员工队列')
  const [concurrencyLimit, setConcurrencyLimit] = useState('1')
  const [maxItems, setMaxItems] = useState('1')
  const [scanLimit, setScanLimit] = useState('25')
  const [priority, setPriority] = useState('5')
  const [budgetLimitCents, setBudgetLimitCents] = useState('20')
  const [scheduleName, setScheduleName] = useState('定时执行员工队列')
  const [scheduleKind, setScheduleKind] = useState<TaskScheduleKind>('task_queue_tick')
  const [intervalSeconds, setIntervalSeconds] = useState('60')
  const [nextDelaySeconds, setNextDelaySeconds] = useState('0')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState<SavingAction>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [clockNow, setClockNow] = useState(0)

  const selectedQueue = useMemo(
    () => queues.find((queue) => queue.id === selectedQueueId) ?? null,
    [queues, selectedQueueId],
  )

  const itemCounts = useMemo(() => {
    const counts = new Map<string, number>()
    for (const item of queueItems) {
      counts.set(item.status, (counts.get(item.status) ?? 0) + 1)
    }
    return counts
  }, [queueItems])

  const dueContinuationCount = useMemo(() => {
    return continuationPlans.filter((plan) => plan.dueAt !== null && plan.dueAt <= clockNow).length
  }, [clockNow, continuationPlans])

  const reloadQueueDetails = useCallback(async (queueId: string) => {
    if (!queueId) {
      setQueueItems([])
      setSchedules([])
      return
    }
    const [itemsNext, schedulesNext] = await Promise.all([
      fetchTaskQueueItems(queueId),
      fetchTaskSchedules(queueId),
    ])
    setQueueItems(itemsNext)
    setSchedules(schedulesNext)
  }, [])

  const reload = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [queuesNext, plansNext] = await Promise.all([
        fetchTaskQueues(),
        fetchContinuationPlans({ status: 'open', limit: 100 }),
      ])
      setClockNow(Date.now())
      const nextSelected = selectedQueueId && queuesNext.some((queue) => queue.id === selectedQueueId)
        ? selectedQueueId
        : queuesNext[0]?.id ?? ''
      setQueues(queuesNext)
      setContinuationPlans(plansNext)
      setSelectedQueueId(nextSelected)
      await reloadQueueDetails(nextSelected)
    } catch (err) {
      setError(formatError(err))
    } finally {
      setLoading(false)
    }
  }, [reloadQueueDetails, selectedQueueId])

  useEffect(() => {
    void reload()
  }, [reload])

  const createQueue = async () => {
    setSaving('create_queue')
    setError(null)
    setNotice(null)
    try {
      const queue = await createTaskQueue({
        name: queueName,
        concurrencyLimit: parsePositiveInt(concurrencyLimit, 1),
      })
      setNotice('已创建任务队列')
      setSelectedQueueId(queue.id)
      setQueues((current) => [queue, ...current])
      await reloadQueueDetails(queue.id)
    } catch (err) {
      setError(formatError(err))
    } finally {
      setSaving(null)
    }
  }

  const runSelectedQueueTick = async () => {
    if (!selectedQueueId) return
    setSaving('run_tick')
    setError(null)
    setNotice(null)
    try {
      const result = await runTaskQueueTick(selectedQueueId, {
        maxItems: parsePositiveInt(maxItems, 1),
        continuationScanLimit: parsePositiveInt(scanLimit, 25),
        continuationPriority: parseInteger(priority, 0),
        budgetLimitCents: parseNullableInteger(budgetLimitCents),
      })
      setNotice(
        `队列执行完成：${result.processed.completed} 个完成，${result.processed.failed} 个失败`,
      )
      await reload()
    } catch (err) {
      setError(formatError(err))
    } finally {
      setSaving(null)
    }
  }

  const enqueueDueContinuations = async () => {
    if (!selectedQueueId) return
    setSaving('enqueue_due')
    setError(null)
    setNotice(null)
    try {
      const result = await enqueueDueContinuationPlans({
        queueId: selectedQueueId,
        limit: parsePositiveInt(scanLimit, 25),
        priority: parseInteger(priority, 0),
        budgetLimitCents: parseNullableInteger(budgetLimitCents),
      })
      setNotice(`已加入 ${result.queued} 个到期任务`)
      await reload()
    } catch (err) {
      setError(formatError(err))
    } finally {
      setSaving(null)
    }
  }

  const processSelectedQueue = async () => {
    if (!selectedQueueId) return
    setSaving('process_queue')
    setError(null)
    setNotice(null)
    try {
      const result = await processTaskQueue(selectedQueueId, parsePositiveInt(maxItems, 1))
      setNotice(`已开始处理 ${result.started} 个任务`)
      await reload()
    } catch (err) {
      setError(formatError(err))
    } finally {
      setSaving(null)
    }
  }

  const createSchedule = async () => {
    if (!selectedQueueId) return
    setSaving('create_schedule')
    setError(null)
    setNotice(null)
    try {
      const schedule = await createTaskSchedule({
        queueId: selectedQueueId,
        name: scheduleName,
        kind: scheduleKind,
        intervalMs: parsePositiveInt(intervalSeconds, 60) * 1000,
        nextRunAt: Date.now() + parseInteger(nextDelaySeconds, 0) * 1000,
        payload: buildSchedulePayload(scheduleKind, {
          maxItems,
          scanLimit,
          priority,
          budgetLimitCents,
        }),
      })
      setNotice('已创建定时规则')
      setSchedules((current) => [schedule, ...current])
      await reloadQueueDetails(selectedQueueId)
    } catch (err) {
      setError(formatError(err))
    } finally {
      setSaving(null)
    }
  }

  const runDueSchedules = async () => {
    setSaving('run_due')
    setError(null)
    setNotice(null)
    try {
      const result = await runDueTaskSchedules({ limit: 25 })
      setNotice(`到期任务执行：${result.ran} 个已运行，${result.failed} 个失败`)
      await reload()
    } catch (err) {
      setError(formatError(err))
    } finally {
      setSaving(null)
    }
  }

  const selectQueue = async (queueId: string) => {
    setSelectedQueueId(queueId)
    setError(null)
    await reloadQueueDetails(queueId)
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="shrink-0 border-b px-3 py-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <Clock3 className="size-4" />
              <span className="truncate">任务调度</span>
            </div>
            <p className="mt-1 text-[11px] text-muted-foreground">
              用来让智能体按时间自动处理队列任务。普通使用只看规则和任务，高级参数已经收在下面。
            </p>
            <div className="mt-2 grid grid-cols-4 gap-1 text-[10px] text-muted-foreground">
              <Metric label="队列" value={queues.length} />
              <Metric label="任务" value={queueItems.length} />
              <Metric label="规则" value={schedules.length} />
              <Metric label="到期" value={dueContinuationCount} />
            </div>
          </div>
          <Button size="icon" variant="ghost" onClick={() => void reload()} disabled={loading}>
            <RefreshCw className={cn('size-4', loading && 'animate-spin')} />
          </Button>
        </div>
        {(error || notice) && (
          <div
            className={cn(
              'mt-2 rounded-md border px-2 py-1.5 text-[11px]',
              error
                ? 'border-destructive/30 bg-destructive/10 text-destructive'
                : 'border-emerald-500/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
            )}
          >
            {error ?? notice}
          </div>
        )}
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-[17rem_1fr]">
        <ScrollArea className="min-h-0 border-r">
          <div className="space-y-3 p-3">
            <Section title="新建任务队列">
              <Input
                value={queueName}
                onChange={(event) => setQueueName(event.target.value)}
                placeholder="队列名称"
              />
              <Input
                value={concurrencyLimit}
                onChange={(event) => setConcurrencyLimit(event.target.value)}
                inputMode="numeric"
                placeholder="同时运行数量"
              />
              <Button
                className="h-8 w-full gap-1"
                onClick={() => void createQueue()}
                disabled={saving !== null || !queueName.trim()}
              >
                {saving === 'create_queue' ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <Plus className="size-3.5" />
                )}
                新建队列
              </Button>
            </Section>

            <Section title="任务队列">
              <div className="space-y-1">
                {queues.length === 0 ? (
                  <EmptyState label="还没有任务队列" />
                ) : (
                  queues.map((queue) => (
                    <button
                      key={queue.id}
                      type="button"
                      onClick={() => void selectQueue(queue.id)}
                      className={cn(
                        'w-full rounded-md border px-2 py-2 text-left text-xs transition',
                        selectedQueueId === queue.id
                          ? 'border-primary/50 bg-primary/10'
                          : 'border-border hover:bg-muted/60',
                      )}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate font-medium">{queue.name}</span>
                        <Badge variant={queue.status === 'active' ? 'secondary' : 'outline'}>
                          {statusLabel(queue.status)}
                        </Badge>
                      </div>
                      <div className="mt-1 text-[10px] text-muted-foreground">
                        同时运行 {queue.concurrencyLimit} 个 · {queue.id}
                      </div>
                    </button>
                  ))
                )}
              </div>
            </Section>
          </div>
        </ScrollArea>

        <ScrollArea className="min-h-0">
          <div className="space-y-3 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b pb-2">
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold">
                  {selectedQueue?.name ?? '请选择一个任务队列'}
                </div>
                <div className="mt-1 flex flex-wrap gap-1 text-[10px] text-muted-foreground">
                  <Pill label="排队" value={itemCounts.get('queued') ?? 0} />
                  <Pill label="运行中" value={itemCounts.get('running') ?? 0} />
                  <Pill label="已完成" value={itemCounts.get('complete') ?? 0} />
                  <Pill label="失败" value={itemCounts.get('failed') ?? 0} />
                </div>
              </div>
              <Button
                size="sm"
                variant="outline"
                className="gap-1"
                onClick={() => void runDueSchedules()}
                disabled={saving !== null}
              >
                {saving === 'run_due' ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <CalendarClock className="size-3.5" />
                )}
                立即运行到期任务
              </Button>
            </div>

            <Section title="快速操作">
              <div className="grid grid-cols-4 gap-2">
                <LabeledInput label="本次最多" value={maxItems} onChange={setMaxItems} />
                <LabeledInput label="扫描数量" value={scanLimit} onChange={setScanLimit} />
                <LabeledInput label="优先级" value={priority} onChange={setPriority} />
                <LabeledInput label="预算分" value={budgetLimitCents} onChange={setBudgetLimitCents} />
              </div>
              <div className="grid grid-cols-3 gap-2">
                <ActionButton
                  label="执行一次"
                  icon={<Play className="size-3.5" />}
                  loading={saving === 'run_tick'}
                  disabled={!selectedQueueId || saving !== null}
                  onClick={() => void runSelectedQueueTick()}
                />
                <ActionButton
                  label="加入到期任务"
                  icon={<TimerReset className="size-3.5" />}
                  loading={saving === 'enqueue_due'}
                  disabled={!selectedQueueId || saving !== null}
                  onClick={() => void enqueueDueContinuations()}
                />
                <ActionButton
                  label="处理队列"
                  icon={<CheckCircle2 className="size-3.5" />}
                  loading={saving === 'process_queue'}
                  disabled={!selectedQueueId || saving !== null}
                  onClick={() => void processSelectedQueue()}
                />
              </div>
            </Section>

            <Section title="新建定时规则">
              <div className="grid grid-cols-[1fr_9rem] gap-2">
                <Input
                  value={scheduleName}
                  onChange={(event) => setScheduleName(event.target.value)}
                  placeholder="规则名称"
                />
                <select
                  value={scheduleKind}
                  onChange={(event) => setScheduleKind(event.target.value as TaskScheduleKind)}
                  className="h-8 rounded-lg border border-input bg-background px-2 text-xs outline-none focus-visible:border-ring"
                >
                  <option value="task_queue_tick">执行队列</option>
                  <option value="enqueue_due_continuations">只扫描到期任务</option>
                </select>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <LabeledInput label="间隔秒" value={intervalSeconds} onChange={setIntervalSeconds} />
                <LabeledInput label="延迟秒" value={nextDelaySeconds} onChange={setNextDelaySeconds} />
              </div>
              <Button
                className="h-8 w-full gap-1"
                onClick={() => void createSchedule()}
                disabled={saving !== null || !selectedQueueId || !scheduleName.trim()}
              >
                {saving === 'create_schedule' ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <CalendarClock className="size-3.5" />
                )}
                添加定时规则
              </Button>
            </Section>

            <Section title="定时规则">
              <div className="space-y-2">
                {schedules.length === 0 ? (
                  <EmptyState label="还没有定时规则" />
                ) : (
                  schedules.map((schedule) => (
                    <RuntimeRow
                      key={schedule.id}
                      title={schedule.name}
                      subtitle={`${scheduleKindLabel(schedule.kind)} · 每 ${Math.round(schedule.intervalMs / 1000)} 秒`}
                      badge={statusLabel(schedule.status)}
                      meta={`下次 ${formatTime(schedule.nextRunAt)} · 上次 ${formatTime(schedule.lastRunAt)}`}
                    />
                  ))
                )}
              </div>
            </Section>

            <Section title="队列任务">
              <div className="space-y-2">
                {queueItems.length === 0 ? (
                  <EmptyState label="当前队列还没有任务" />
                ) : (
                  queueItems.slice(0, 30).map((item) => (
                    <RuntimeRow
                      key={item.id}
                      title={item.kind}
                      subtitle={`${item.id} · p${item.priority}`}
                      badge={statusLabel(item.status)}
                      meta={item.error ?? summarizePayload(item.result ?? item.payload)}
                    />
                  ))
                )}
              </div>
            </Section>
          </div>
        </ScrollArea>
      </div>
    </div>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-2">
      <div className="text-[11px] font-semibold uppercase tracking-normal text-muted-foreground">
        {title}
      </div>
      {children}
    </section>
  )
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md border px-2 py-1">
      <div className="tabular-nums text-foreground">{value}</div>
      <div className="truncate">{label}</div>
    </div>
  )
}

function Pill({ label, value }: { label: string; value: number }) {
  return (
    <span className="rounded-full border px-2 py-0.5 tabular-nums">
      {label} {value}
    </span>
  )
}

function LabeledInput({
  label,
  value,
  onChange,
}: {
  label: string
  value: string
  onChange: (value: string) => void
}) {
  return (
    <label className="space-y-1">
      <span className="block text-[10px] text-muted-foreground">{label}</span>
      <Input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        inputMode="numeric"
        className="h-8 text-xs"
      />
    </label>
  )
}

function ActionButton({
  label,
  icon,
  loading,
  disabled,
  onClick,
}: {
  label: string
  icon: ReactNode
  loading: boolean
  disabled: boolean
  onClick: () => void
}) {
  return (
    <Button
      size="sm"
      variant="outline"
      className="w-full gap-1"
      disabled={disabled}
      onClick={onClick}
    >
      {loading ? <Loader2 className="size-3.5 animate-spin" /> : icon}
      {label}
    </Button>
  )
}

function RuntimeRow({
  title,
  subtitle,
  badge,
  meta,
}: {
  title: string
  subtitle: string
  badge: string
  meta: string
}) {
  return (
    <div className="rounded-md border px-2 py-2 text-xs">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate font-medium">{title}</div>
          <div className="mt-0.5 truncate text-[10px] text-muted-foreground">{subtitle}</div>
        </div>
        <Badge variant={badgeTone(badge)}>{badge}</Badge>
      </div>
      <div className="mt-1 line-clamp-2 text-[10px] text-muted-foreground">{meta}</div>
    </div>
  )
}

function EmptyState({ label }: { label: string }) {
  return (
    <div className="rounded-md border border-dashed px-2 py-4 text-center text-xs text-muted-foreground">
      {label}
    </div>
  )
}

function buildSchedulePayload(
  kind: TaskScheduleKind,
  values: {
    maxItems: string
    scanLimit: string
    priority: string
    budgetLimitCents: string
  },
): JsonObject {
  const budget = parseNullableInteger(values.budgetLimitCents)
  if (kind === 'enqueue_due_continuations') {
    return {
      limit: parsePositiveInt(values.scanLimit, 25),
      priority: parseInteger(values.priority, 0),
      budgetLimitCents: budget,
    }
  }
  return {
    maxItems: parsePositiveInt(values.maxItems, 1),
    continuationScanLimit: parsePositiveInt(values.scanLimit, 25),
    continuationPriority: parseInteger(values.priority, 0),
    budgetLimitCents: budget,
    enqueueDueContinuationPlans: true,
  }
}

function parsePositiveInt(value: string, fallback: number): number {
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

function parseInteger(value: string, fallback: number): number {
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) ? parsed : fallback
}

function parseNullableInteger(value: string): number | null {
  if (!value.trim()) return null
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null
}

function formatTime(value: number | null): string {
  if (!value) return '从未'
  return new Date(value).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

function statusLabel(status: string): string {
  const map: Record<string, string> = {
    active: '启用中',
    paused: '已暂停',
    queued: '排队中',
    running: '运行中',
    complete: '已完成',
    completed: '已完成',
    failed: '失败',
    canceled: '已取消',
    cancelled: '已取消',
  }
  return map[status] ?? status
}

function scheduleKindLabel(kind: TaskScheduleKind): string {
  if (kind === 'enqueue_due_continuations') return '扫描到期任务'
  return '执行队列'
}

function summarizePayload(value: JsonObject | null): string {
  if (!value) return '无参数'
  const text = JSON.stringify(value)
  return text.length > 180 ? `${text.slice(0, 177)}...` : text
}

function badgeTone(status: string): 'default' | 'secondary' | 'destructive' | 'outline' {
  if (status === 'complete' || status === 'active' || status === '已完成' || status === '启用中') {
    return 'secondary'
  }
  if (status === 'failed' || status === 'canceled' || status === '失败' || status === '已取消') {
    return 'destructive'
  }
  if (status === 'running' || status === 'queued' || status === '运行中' || status === '排队中') {
    return 'default'
  }
  return 'outline'
}

function formatError(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

