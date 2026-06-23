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
  const [queueName, setQueueName] = useState('Agent employee queue')
  const [concurrencyLimit, setConcurrencyLimit] = useState('1')
  const [maxItems, setMaxItems] = useState('1')
  const [scanLimit, setScanLimit] = useState('25')
  const [priority, setPriority] = useState('5')
  const [budgetLimitCents, setBudgetLimitCents] = useState('20')
  const [scheduleName, setScheduleName] = useState('Run employee queue tick')
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
      setNotice('Queue created')
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
        `Tick completed: ${result.processed.completed} complete, ${result.processed.failed} failed`,
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
      setNotice(`Queued ${result.queued} due continuation plan(s)`)
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
      setNotice(`Processed ${result.started} item(s)`)
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
      setNotice('Schedule created')
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
      setNotice(`Due runner: ${result.ran} ran, ${result.failed} failed`)
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
              <span className="truncate">Task Scheduler</span>
            </div>
            <div className="mt-1 grid grid-cols-4 gap-1 text-[10px] text-muted-foreground">
              <Metric label="queues" value={queues.length} />
              <Metric label="items" value={queueItems.length} />
              <Metric label="schedules" value={schedules.length} />
              <Metric label="due" value={dueContinuationCount} />
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
            <Section title="Queue">
              <Input
                value={queueName}
                onChange={(event) => setQueueName(event.target.value)}
                placeholder="Queue name"
              />
              <Input
                value={concurrencyLimit}
                onChange={(event) => setConcurrencyLimit(event.target.value)}
                inputMode="numeric"
                placeholder="Concurrency"
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
                Create Queue
              </Button>
            </Section>

            <Section title="Queues">
              <div className="space-y-1">
                {queues.length === 0 ? (
                  <EmptyState label="No queues" />
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
                          {queue.status}
                        </Badge>
                      </div>
                      <div className="mt-1 text-[10px] text-muted-foreground">
                        c{queue.concurrencyLimit} · {queue.id}
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
                  {selectedQueue?.name ?? 'No queue selected'}
                </div>
                <div className="mt-1 flex flex-wrap gap-1 text-[10px] text-muted-foreground">
                  <Pill label="queued" value={itemCounts.get('queued') ?? 0} />
                  <Pill label="running" value={itemCounts.get('running') ?? 0} />
                  <Pill label="complete" value={itemCounts.get('complete') ?? 0} />
                  <Pill label="failed" value={itemCounts.get('failed') ?? 0} />
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
                Run Due
              </Button>
            </div>

            <Section title="Controls">
              <div className="grid grid-cols-4 gap-2">
                <LabeledInput label="max" value={maxItems} onChange={setMaxItems} />
                <LabeledInput label="scan" value={scanLimit} onChange={setScanLimit} />
                <LabeledInput label="priority" value={priority} onChange={setPriority} />
                <LabeledInput label="budget" value={budgetLimitCents} onChange={setBudgetLimitCents} />
              </div>
              <div className="grid grid-cols-3 gap-2">
                <ActionButton
                  label="Tick"
                  icon={<Play className="size-3.5" />}
                  loading={saving === 'run_tick'}
                  disabled={!selectedQueueId || saving !== null}
                  onClick={() => void runSelectedQueueTick()}
                />
                <ActionButton
                  label="Enqueue Due"
                  icon={<TimerReset className="size-3.5" />}
                  loading={saving === 'enqueue_due'}
                  disabled={!selectedQueueId || saving !== null}
                  onClick={() => void enqueueDueContinuations()}
                />
                <ActionButton
                  label="Process"
                  icon={<CheckCircle2 className="size-3.5" />}
                  loading={saving === 'process_queue'}
                  disabled={!selectedQueueId || saving !== null}
                  onClick={() => void processSelectedQueue()}
                />
              </div>
            </Section>

            <Section title="Create Schedule">
              <div className="grid grid-cols-[1fr_9rem] gap-2">
                <Input
                  value={scheduleName}
                  onChange={(event) => setScheduleName(event.target.value)}
                  placeholder="Schedule name"
                />
                <select
                  value={scheduleKind}
                  onChange={(event) => setScheduleKind(event.target.value as TaskScheduleKind)}
                  className="h-8 rounded-lg border border-input bg-background px-2 text-xs outline-none focus-visible:border-ring"
                >
                  <option value="task_queue_tick">tick</option>
                  <option value="enqueue_due_continuations">scan only</option>
                </select>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <LabeledInput label="interval sec" value={intervalSeconds} onChange={setIntervalSeconds} />
                <LabeledInput label="delay sec" value={nextDelaySeconds} onChange={setNextDelaySeconds} />
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
                Add Schedule
              </Button>
            </Section>

            <Section title="Schedules">
              <div className="space-y-2">
                {schedules.length === 0 ? (
                  <EmptyState label="No schedules" />
                ) : (
                  schedules.map((schedule) => (
                    <RuntimeRow
                      key={schedule.id}
                      title={schedule.name}
                      subtitle={`${schedule.kind} · every ${Math.round(schedule.intervalMs / 1000)}s`}
                      badge={schedule.status}
                      meta={`next ${formatTime(schedule.nextRunAt)} · last ${formatTime(schedule.lastRunAt)}`}
                    />
                  ))
                )}
              </div>
            </Section>

            <Section title="Queue Items">
              <div className="space-y-2">
                {queueItems.length === 0 ? (
                  <EmptyState label="No queue items" />
                ) : (
                  queueItems.slice(0, 30).map((item) => (
                    <RuntimeRow
                      key={item.id}
                      title={item.kind}
                      subtitle={`${item.id} · p${item.priority}`}
                      badge={item.status}
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
  if (!value) return 'never'
  return new Date(value).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

function summarizePayload(value: JsonObject | null): string {
  if (!value) return 'no payload'
  const text = JSON.stringify(value)
  return text.length > 180 ? `${text.slice(0, 177)}...` : text
}

function badgeTone(status: string): 'default' | 'secondary' | 'destructive' | 'outline' {
  if (status === 'complete' || status === 'active') return 'secondary'
  if (status === 'failed' || status === 'canceled') return 'destructive'
  if (status === 'running' || status === 'queued') return 'default'
  return 'outline'
}

function formatError(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}
