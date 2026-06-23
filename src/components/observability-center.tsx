'use client'

import {
  Activity,
  Bell,
  Bot,
  BugPlay,
  Download,
  HeartPulse,
  Loader2,
  Plus,
  RefreshCw,
  Siren,
  Trophy,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Textarea } from '@/components/ui/textarea'
import type {
  AgentHealthScoreRow,
  AgentProfileRow,
  AgentReputationReviewRow,
  AgentReputationSnapshotRow,
  AlertEventRow,
  AlertRuleRow,
  DebugReplaySnapshotRow,
  EmployeeRunRow,
  JsonObject,
  MetaAgentDigestRow,
  MetaAgentProfileRow,
  MetaAgentRecommendationRow,
  MetricPointRow,
  NotificationChannel,
  NotificationLevel,
  NotificationPreferenceRow,
  NotificationRow,
} from '@/db/schema'
import {
  computeAgentHealthScore,
  computeAgentReputation,
  createAlertRule,
  createEmployeeRunDebugReplay,
  createAgentReputationReview,
  createMetaAgentProfile,
  createNotification,
  employeeRunDebugPackageUrl,
  fetchAgentReputationLeaderboard,
  fetchAgentReputationReviews,
  fetchAgentReputations,
  fetchMetaAgentDigests,
  fetchMetaAgentProfiles,
  fetchMetaAgentRecommendations,
  fetchAgentHealthScores,
  fetchAgentProfiles,
  fetchAlertEvents,
  fetchAlertRules,
  fetchDebugReplaySnapshots,
  fetchEmployeeRuns,
  fetchEmployeeRunDebugPackageManifest,
  fetchMetricPoints,
  fetchNotificationPreferences,
  fetchNotifications,
  generateMetaAgentDigest,
  markNotificationRead,
  refreshAgentReputationLeaderboard,
  updateMetaAgentRecommendationStatus,
  recordMetricPoint,
  type AgentReputationLeaderboardDto,
  type EmployeeRunDebugPackageDto,
  upsertNotificationPreference,
} from '@/lib/api'
import { cn } from '@/lib/utils'

const comparisons: AlertRuleRow['comparison'][] = ['gt', 'gte', 'lt', 'lte', 'eq']
const levels: NotificationLevel[] = ['info', 'success', 'warning', 'critical']
const channels: NotificationChannel[] = ['in_app', 'desktop_notification', 'email', 'webhook']
const alertStatuses: Array<'' | AlertEventRow['status']> = ['', 'open', 'acknowledged', 'resolved']
const notificationStatuses: Array<'' | NotificationRow['status']> = ['', 'unread', 'read', 'archived']

type SavingAction =
  | 'metric'
  | 'alert'
  | 'notification'
  | 'preference'
  | 'health'
  | 'reputation'
  | 'reputation-refresh'
  | 'reputation-review'
  | 'replay'
  | 'debug-package'
  | 'simulate-debug'
  | 'meta-profile'
  | 'meta-digest'
  | `meta-rec:${string}`
  | `read:${string}`
  | null

export function ObservabilityCenter() {
  const [agents, setAgents] = useState<AgentProfileRow[]>([])
  const [employeeRuns, setEmployeeRuns] = useState<EmployeeRunRow[]>([])
  const [metrics, setMetrics] = useState<MetricPointRow[]>([])
  const [alertRules, setAlertRules] = useState<AlertRuleRow[]>([])
  const [alertEvents, setAlertEvents] = useState<AlertEventRow[]>([])
  const [debugReplays, setDebugReplays] = useState<DebugReplaySnapshotRow[]>([])
  const [debugPackageManifest, setDebugPackageManifest] =
    useState<EmployeeRunDebugPackageDto | null>(null)
  const [healthScores, setHealthScores] = useState<AgentHealthScoreRow[]>([])
  const [reputationSnapshots, setReputationSnapshots] = useState<AgentReputationSnapshotRow[]>([])
  const [reputationReviews, setReputationReviews] = useState<AgentReputationReviewRow[]>([])
  const [reputationLeaderboard, setReputationLeaderboard] =
    useState<AgentReputationLeaderboardDto | null>(null)
  const [notifications, setNotifications] = useState<NotificationRow[]>([])
  const [preferences, setPreferences] = useState<NotificationPreferenceRow[]>([])
  const [metaProfiles, setMetaProfiles] = useState<MetaAgentProfileRow[]>([])
  const [metaDigests, setMetaDigests] = useState<MetaAgentDigestRow[]>([])
  const [metaRecommendations, setMetaRecommendations] = useState<MetaAgentRecommendationRow[]>([])

  const [selectedAgentId, setSelectedAgentId] = useState('')
  const [selectedRunId, setSelectedRunId] = useState('')
  const [metricFilter, setMetricFilter] = useState('')
  const [alertStatus, setAlertStatus] = useState<Array<'' | AlertEventRow['status']>[number]>('')
  const [notificationStatus, setNotificationStatus] = useState<
    Array<'' | NotificationRow['status']>[number]
  >('unread')

  const [metricDraft, setMetricDraft] = useState({
    metricName: 'agenthub.queue_depth',
    value: '1',
    unit: 'count',
    resourceType: 'workspace',
    resourceId: 'local',
    tagsText: '{}',
  })
  const [alertDraft, setAlertDraft] = useState({
    name: 'Queue depth warning',
    metricName: 'agenthub.queue_depth',
    comparison: 'gte' as AlertRuleRow['comparison'],
    threshold: '1',
    severity: 'warning' as NotificationLevel,
    cooldownMs: '300000',
    enabled: true,
  })
  const [notificationDraft, setNotificationDraft] = useState({
    channel: 'in_app' as NotificationChannel,
    level: 'info' as NotificationLevel,
    sourceType: 'manual',
    sourceId: '',
    title: 'Manual operator note',
    message: 'A human operator created this notification.',
    payloadText: '{}',
  })
  const [preferenceDraft, setPreferenceDraft] = useState({
    channel: 'in_app' as NotificationChannel,
    minLevel: 'info' as NotificationLevel,
    enabled: true,
  })
  const [metaDraft, setMetaDraft] = useState({
    name: 'System Meta Agent',
    scheduleLocalTime: '08:00',
    budgetLimitCents: '10000',
  })
  const [reputationDraft, setReputationDraft] = useState({
    monthLabel: currentMonthLabel(),
    taskId: '',
    userRating: '5',
    autoScore: '90',
    comment: '',
  })

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState<SavingAction>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const selectedAgent = useMemo(
    () => agents.find((agent) => agent.id === selectedAgentId) ?? null,
    [agents, selectedAgentId],
  )
  const selectedRun = useMemo(
    () => employeeRuns.find((run) => run.id === selectedRunId) ?? null,
    [employeeRuns, selectedRunId],
  )
  const selectedRunReplay = useMemo(
    () => debugReplays.find((replay) => replay.resourceId === selectedRunId) ?? null,
    [debugReplays, selectedRunId],
  )
  const openAlerts = useMemo(
    () => alertEvents.filter((event) => event.status === 'open').length,
    [alertEvents],
  )
  const unreadNotifications = useMemo(
    () => notifications.filter((notification) => notification.status === 'unread').length,
    [notifications],
  )
  const latestHealth = healthScores[0] ?? null
  const latestReputation = reputationSnapshots[0] ?? null
  const latestMetaProfile = metaProfiles[0] ?? null

  const reload = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [
        agentsNext,
        runsNext,
        metricsNext,
        rulesNext,
        eventsNext,
        replaysNext,
        healthNext,
        reputationNext,
        reputationReviewsNext,
        reputationLeaderboardNext,
        notificationsNext,
        prefsNext,
        metaProfilesNext,
        metaDigestsNext,
        metaRecommendationsNext,
      ] = await Promise.all([
        fetchAgentProfiles(),
        fetchEmployeeRuns(selectedAgentId || undefined),
        fetchMetricPoints(metricFilter || undefined),
        fetchAlertRules(),
        fetchAlertEvents(alertStatus || undefined),
        fetchDebugReplaySnapshots(),
        fetchAgentHealthScores(selectedAgentId || undefined),
        fetchAgentReputations({
          agentProfileId: selectedAgentId || undefined,
          monthLabel: reputationDraft.monthLabel || undefined,
          limit: 50,
        }),
        selectedAgentId ? fetchAgentReputationReviews(selectedAgentId) : Promise.resolve([]),
        fetchAgentReputationLeaderboard({
          monthLabel: reputationDraft.monthLabel || undefined,
          limit: 20,
        }),
        fetchNotifications(notificationStatus || undefined),
        fetchNotificationPreferences(),
        fetchMetaAgentProfiles(20),
        fetchMetaAgentDigests(20),
        fetchMetaAgentRecommendations({ limit: 50 }),
      ])
      setAgents(agentsNext)
      setEmployeeRuns(runsNext)
      setMetrics(metricsNext)
      setAlertRules(rulesNext)
      setAlertEvents(eventsNext)
      setDebugReplays(replaysNext)
      setHealthScores(healthNext)
      setReputationSnapshots(reputationNext)
      setReputationReviews(reputationReviewsNext)
      setReputationLeaderboard(reputationLeaderboardNext)
      setNotifications(notificationsNext)
      setPreferences(prefsNext)
      setMetaProfiles(metaProfilesNext)
      setMetaDigests(metaDigestsNext)
      setMetaRecommendations(metaRecommendationsNext)
      setSelectedAgentId((current) =>
        current && agentsNext.some((agent) => agent.id === current) ? current : agentsNext[0]?.id ?? '',
      )
      setSelectedRunId((current) =>
        current && runsNext.some((run) => run.id === current) ? current : runsNext[0]?.id ?? '',
      )
    } catch (err) {
      setError(formatError(err))
    } finally {
      setLoading(false)
    }
  }, [alertStatus, metricFilter, notificationStatus, reputationDraft.monthLabel, selectedAgentId])

  useEffect(() => {
    void reload()
  }, [reload])

  const withAction = async (action: SavingAction, work: () => Promise<string>) => {
    setSaving(action)
    setError(null)
    setNotice(null)
    try {
      const message = await work()
      setNotice(message)
      await reload()
    } catch (err) {
      setError(formatError(err))
    } finally {
      setSaving(null)
    }
  }

  const submitMetric = () =>
    withAction('metric', async () => {
      const result = await recordMetricPoint({
        metricName: metricDraft.metricName,
        value: parseNumber(metricDraft.value, 'metric value'),
        unit: metricDraft.unit,
        resourceType: metricDraft.resourceType || null,
        resourceId: metricDraft.resourceId || null,
        tags: parseJsonObject(metricDraft.tagsText, 'Metric tags'),
      })
      return `Metric recorded with ${result.alertEvents.length} alert events`
    })

  const submitAlert = () =>
    withAction('alert', async () => {
      await createAlertRule({
        name: alertDraft.name,
        metricName: alertDraft.metricName,
        comparison: alertDraft.comparison,
        threshold: parseNumber(alertDraft.threshold, 'threshold'),
        severity: alertDraft.severity,
        cooldownMs: parsePositiveInt(alertDraft.cooldownMs, 300000),
        enabled: alertDraft.enabled,
      })
      return 'Alert rule created'
    })

  const submitNotification = () =>
    withAction('notification', async () => {
      await createNotification({
        channel: notificationDraft.channel,
        level: notificationDraft.level,
        sourceType: notificationDraft.sourceType,
        sourceId: notificationDraft.sourceId || null,
        title: notificationDraft.title,
        message: notificationDraft.message,
        payload: parseJsonObject(notificationDraft.payloadText, 'Notification payload'),
      })
      return 'Notification created'
    })

  const submitPreference = () =>
    withAction('preference', async () => {
      await upsertNotificationPreference({
        channel: preferenceDraft.channel,
        minLevel: preferenceDraft.minLevel,
        enabled: preferenceDraft.enabled,
      })
      return 'Notification preference saved'
    })

  const submitMetaProfile = () =>
    withAction('meta-profile', async () => {
      const profile = await createMetaAgentProfile({
        name: metaDraft.name,
        scheduleLocalTime: metaDraft.scheduleLocalTime,
      })
      return `Meta Agent created: ${profile.name}`
    })

  const submitMetaDigest = () =>
    withAction('meta-digest', async () => {
      const result = await generateMetaAgentDigest({
        metaAgentProfileId: latestMetaProfile?.id ?? null,
        budgetLimitCents: parseOptionalPositiveInt(metaDraft.budgetLimitCents),
      })
      return `Meta digest generated with ${result.recommendations.length} recommendation(s)`
    })

  const setMetaRecommendationStatus = (
    recommendation: MetaAgentRecommendationRow,
    status: MetaAgentRecommendationRow['status'],
  ) =>
    withAction(`meta-rec:${recommendation.id}`, async () => {
      await updateMetaAgentRecommendationStatus(recommendation.id, status)
      return `Meta recommendation ${status}`
    })

  const submitReputation = () =>
    withAction('reputation', async () => {
      if (!selectedAgentId) throw new Error('Select an Agent first.')
      const snapshot = await computeAgentReputation(selectedAgentId, {
        monthLabel: reputationDraft.monthLabel || undefined,
      })
      return `Reputation score ${snapshot.overallScore}`
    })

  const refreshReputation = () =>
    withAction('reputation-refresh', async () => {
      const result = await refreshAgentReputationLeaderboard({
        monthLabel: reputationDraft.monthLabel || undefined,
        limit: 20,
      })
      return `Reputation leaderboard refreshed for ${result.agentReputationSnapshots.length} Agent(s)`
    })

  const submitReputationReview = () =>
    withAction('reputation-review', async () => {
      if (!selectedAgentId) throw new Error('Select an Agent first.')
      await createAgentReputationReview(selectedAgentId, {
        taskId: reputationDraft.taskId || selectedRunId || undefined,
        employeeRunId: selectedRunId || null,
        userRating: parseIntegerInRange(reputationDraft.userRating, 'user rating', 1, 5),
        autoScore: parseNumberInRange(reputationDraft.autoScore, 'auto score', 0, 100),
        comment: reputationDraft.comment || null,
      })
      return 'Reputation review recorded'
    })

  const computeHealth = () =>
    withAction('health', async () => {
      if (!selectedAgentId) throw new Error('Select an Agent first.')
      const score = await computeAgentHealthScore(selectedAgentId)
      return `Health score ${score.score}`
    })

  const createReplay = () =>
    withAction('replay', async () => {
      if (!selectedRunId) throw new Error('Select an employee run first.')
      const replay = await createEmployeeRunDebugReplay(selectedRunId)
      const manifest = replay.payload.debugPackageManifest
      if (isDebugPackageManifest(manifest)) setDebugPackageManifest(manifest)
      return `Debug replay captured with ${replay.eventCount} events`
    })

  const exportDebugPackage = () =>
    withAction('debug-package', async () => {
      if (!selectedRunId) throw new Error('Select an employee run first.')
      const manifest = await fetchEmployeeRunDebugPackageManifest(selectedRunId)
      setDebugPackageManifest(manifest)
      window.open(employeeRunDebugPackageUrl(selectedRunId), '_blank', 'noopener,noreferrer')
      return `Debug package ready: ${manifest.files.length} file(s)`
    })

  const simulateDebugNextStep = () =>
    withAction('simulate-debug', async () => {
      if (!selectedRunId) throw new Error('Select an employee run first.')
      const manifest = await fetchEmployeeRunDebugPackageManifest(selectedRunId)
      setDebugPackageManifest(manifest)
      return `Next step: ${debugNextStepLabel(manifest.diagnostics)}`
    })

  const markRead = (notification: NotificationRow) =>
    withAction(`read:${notification.id}`, async () => {
      await markNotificationRead(notification.id)
      return 'Notification marked read'
    })

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="shrink-0 border-b px-3 py-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <Activity className="size-4" />
              <span className="truncate">Observability Center</span>
            </div>
            <div className="mt-1 grid grid-cols-10 gap-1 text-[10px] text-muted-foreground">
              <Metric label="metrics" value={metrics.length} />
              <Metric label="rules" value={alertRules.length} />
              <Metric label="open" value={openAlerts} />
              <Metric label="replays" value={debugReplays.length} />
              <Metric label="health" value={latestHealth ? Math.round(latestHealth.score) : 0} />
              <Metric
                label="repute"
                value={latestReputation ? Math.round(latestReputation.overallScore) : 0}
              />
              <Metric label="rank" value={reputationLeaderboard?.entries.length ?? 0} />
              <Metric label="unread" value={unreadNotifications} />
              <Metric label="digests" value={metaDigests.length} />
              <Metric label="meta" value={metaRecommendations.length} />
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

      <div className="grid min-h-0 flex-1 grid-cols-[19rem_1fr]">
        <ScrollArea className="min-h-0 border-r">
          <div className="space-y-3 p-3">
            <Section title="Scope" icon={<Activity className="size-3.5" />}>
              <Select
                value={selectedAgentId}
                onChange={setSelectedAgentId}
                options={agents.map((agent) => agent.id)}
                labels={Object.fromEntries(agents.map((agent) => [agent.id, agent.name]))}
                emptyLabel="All Agents"
              />
              <Select
                value={selectedRunId}
                onChange={setSelectedRunId}
                options={employeeRuns.map((run) => run.id)}
                labels={Object.fromEntries(
                  employeeRuns.map((run) => [run.id, `${run.goal.slice(0, 42)} ${run.status}`]),
                )}
                emptyLabel="Select run"
              />
              <Hint>
                {selectedAgent
                  ? `${selectedAgent.name} run history is selected.`
                  : 'Workspace monitoring lens is active.'}
              </Hint>
            </Section>

            <Section title="Meta Agent" icon={<Bot className="size-3.5" />}>
              <Input
                value={metaDraft.name}
                onChange={(event) =>
                  setMetaDraft((draft) => ({ ...draft, name: event.target.value }))
                }
                placeholder="Meta Agent name"
              />
              <div className="grid grid-cols-2 gap-2">
                <Input
                  value={metaDraft.scheduleLocalTime}
                  onChange={(event) =>
                    setMetaDraft((draft) => ({ ...draft, scheduleLocalTime: event.target.value }))
                  }
                  placeholder="08:00"
                />
                <Input
                  value={metaDraft.budgetLimitCents}
                  onChange={(event) =>
                    setMetaDraft((draft) => ({ ...draft, budgetLimitCents: event.target.value }))
                  }
                  inputMode="numeric"
                  placeholder="Budget cents"
                />
              </div>
              <Button
                className="h-8 w-full gap-1"
                onClick={() => void submitMetaProfile()}
                disabled={saving !== null || !metaDraft.name.trim()}
              >
                {saving === 'meta-profile' ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <Bot className="size-3.5" />
                )}
                Create Meta Agent
              </Button>
              <Button
                className="h-8 w-full gap-1"
                variant="outline"
                onClick={() => void submitMetaDigest()}
                disabled={saving !== null}
              >
                {saving === 'meta-digest' ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <Bell className="size-3.5" />
                )}
                Generate Digest
              </Button>
              <Hint>
                {latestMetaProfile
                  ? `${latestMetaProfile.name} runs at ${latestMetaProfile.scheduleLocalTime}.`
                  : 'Create or generate to initialize the restricted system Meta Agent.'}
              </Hint>
            </Section>

            <Section title="Reputation" icon={<Trophy className="size-3.5" />}>
              <Input
                value={reputationDraft.monthLabel}
                onChange={(event) =>
                  setReputationDraft((draft) => ({ ...draft, monthLabel: event.target.value }))
                }
                placeholder="2026-06"
              />
              <div className="grid grid-cols-2 gap-2">
                <Button
                  className="h-8 gap-1"
                  onClick={() => void submitReputation()}
                  disabled={saving !== null || !selectedAgentId}
                >
                  {saving === 'reputation' ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    <HeartPulse className="size-3.5" />
                  )}
                  Score
                </Button>
                <Button
                  className="h-8 gap-1"
                  variant="outline"
                  onClick={() => void refreshReputation()}
                  disabled={saving !== null}
                >
                  {saving === 'reputation-refresh' ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    <Trophy className="size-3.5" />
                  )}
                  Rank
                </Button>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Input
                  value={reputationDraft.userRating}
                  onChange={(event) =>
                    setReputationDraft((draft) => ({ ...draft, userRating: event.target.value }))
                  }
                  inputMode="numeric"
                  placeholder="Rating 1-5"
                />
                <Input
                  value={reputationDraft.autoScore}
                  onChange={(event) =>
                    setReputationDraft((draft) => ({ ...draft, autoScore: event.target.value }))
                  }
                  inputMode="decimal"
                  placeholder="Auto 0-100"
                />
              </div>
              <Input
                value={reputationDraft.taskId}
                onChange={(event) =>
                  setReputationDraft((draft) => ({ ...draft, taskId: event.target.value }))
                }
                placeholder="Task or run id"
              />
              <Textarea
                value={reputationDraft.comment}
                onChange={(event) =>
                  setReputationDraft((draft) => ({ ...draft, comment: event.target.value }))
                }
                placeholder="Review comment"
                rows={3}
              />
              <Button
                className="h-8 w-full gap-1"
                variant="outline"
                onClick={() => void submitReputationReview()}
                disabled={saving !== null || !selectedAgentId}
              >
                {saving === 'reputation-review' ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <Plus className="size-3.5" />
                )}
                Add Review
              </Button>
              <Hint>
                {latestReputation
                  ? `${latestReputation.overallScore} / ${latestReputation.trend} / ${latestReputation.badges.length} badge(s)`
                  : 'Score the selected Agent or refresh the monthly leaderboard.'}
              </Hint>
            </Section>

            <Section title="Metric Point" icon={<Activity className="size-3.5" />}>
              <Input
                value={metricDraft.metricName}
                onChange={(event) =>
                  setMetricDraft((draft) => ({ ...draft, metricName: event.target.value }))
                }
                placeholder="Metric name"
              />
              <div className="grid grid-cols-2 gap-2">
                <Input
                  value={metricDraft.value}
                  onChange={(event) =>
                    setMetricDraft((draft) => ({ ...draft, value: event.target.value }))
                  }
                  inputMode="decimal"
                  placeholder="Value"
                />
                <Input
                  value={metricDraft.unit}
                  onChange={(event) =>
                    setMetricDraft((draft) => ({ ...draft, unit: event.target.value }))
                  }
                  placeholder="Unit"
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Input
                  value={metricDraft.resourceType}
                  onChange={(event) =>
                    setMetricDraft((draft) => ({ ...draft, resourceType: event.target.value }))
                  }
                  placeholder="Resource type"
                />
                <Input
                  value={metricDraft.resourceId}
                  onChange={(event) =>
                    setMetricDraft((draft) => ({ ...draft, resourceId: event.target.value }))
                  }
                  placeholder="Resource ID"
                />
              </div>
              <Textarea
                className="min-h-16 text-xs"
                value={metricDraft.tagsText}
                onChange={(event) =>
                  setMetricDraft((draft) => ({ ...draft, tagsText: event.target.value }))
                }
                placeholder="Tags JSON"
              />
              <Button
                className="h-8 w-full gap-1"
                onClick={() => void submitMetric()}
                disabled={saving !== null || !metricDraft.metricName.trim()}
              >
                {saving === 'metric' ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <Plus className="size-3.5" />
                )}
                Record Metric
              </Button>
            </Section>

            <Section title="Alert Rule" icon={<Siren className="size-3.5" />}>
              <Input
                value={alertDraft.name}
                onChange={(event) =>
                  setAlertDraft((draft) => ({ ...draft, name: event.target.value }))
                }
                placeholder="Rule name"
              />
              <Input
                value={alertDraft.metricName}
                onChange={(event) =>
                  setAlertDraft((draft) => ({ ...draft, metricName: event.target.value }))
                }
                placeholder="Metric name"
              />
              <div className="grid grid-cols-3 gap-2">
                <Select
                  value={alertDraft.comparison}
                  onChange={(value) =>
                    setAlertDraft((draft) => ({
                      ...draft,
                      comparison: value as AlertRuleRow['comparison'],
                    }))
                  }
                  options={comparisons}
                />
                <Input
                  value={alertDraft.threshold}
                  onChange={(event) =>
                    setAlertDraft((draft) => ({ ...draft, threshold: event.target.value }))
                  }
                  inputMode="decimal"
                  placeholder="Threshold"
                />
                <Select
                  value={alertDraft.severity}
                  onChange={(value) =>
                    setAlertDraft((draft) => ({ ...draft, severity: value as NotificationLevel }))
                  }
                  options={levels}
                />
              </div>
              <Input
                value={alertDraft.cooldownMs}
                onChange={(event) =>
                  setAlertDraft((draft) => ({ ...draft, cooldownMs: event.target.value }))
                }
                inputMode="numeric"
                placeholder="Cooldown ms"
              />
              <Toggle
                label="Enabled"
                checked={alertDraft.enabled}
                onChange={(checked) => setAlertDraft((draft) => ({ ...draft, enabled: checked }))}
              />
              <Button
                className="h-8 w-full gap-1"
                onClick={() => void submitAlert()}
                disabled={saving !== null || !alertDraft.name.trim() || !alertDraft.metricName.trim()}
              >
                {saving === 'alert' ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <Plus className="size-3.5" />
                )}
                Create Alert
              </Button>
            </Section>

            <Section title="Notification" icon={<Bell className="size-3.5" />}>
              <div className="grid grid-cols-2 gap-2">
                <Select
                  value={notificationDraft.channel}
                  onChange={(value) =>
                    setNotificationDraft((draft) => ({
                      ...draft,
                      channel: value as NotificationChannel,
                    }))
                  }
                  options={channels}
                />
                <Select
                  value={notificationDraft.level}
                  onChange={(value) =>
                    setNotificationDraft((draft) => ({ ...draft, level: value as NotificationLevel }))
                  }
                  options={levels}
                />
              </div>
              <Input
                value={notificationDraft.title}
                onChange={(event) =>
                  setNotificationDraft((draft) => ({ ...draft, title: event.target.value }))
                }
                placeholder="Title"
              />
              <Textarea
                className="min-h-14 text-xs"
                value={notificationDraft.message}
                onChange={(event) =>
                  setNotificationDraft((draft) => ({ ...draft, message: event.target.value }))
                }
                placeholder="Message"
              />
              <div className="grid grid-cols-2 gap-2">
                <Input
                  value={notificationDraft.sourceType}
                  onChange={(event) =>
                    setNotificationDraft((draft) => ({
                      ...draft,
                      sourceType: event.target.value,
                    }))
                  }
                  placeholder="Source type"
                />
                <Input
                  value={notificationDraft.sourceId}
                  onChange={(event) =>
                    setNotificationDraft((draft) => ({ ...draft, sourceId: event.target.value }))
                  }
                  placeholder="Source ID"
                />
              </div>
              <Textarea
                className="min-h-14 text-xs"
                value={notificationDraft.payloadText}
                onChange={(event) =>
                  setNotificationDraft((draft) => ({
                    ...draft,
                    payloadText: event.target.value,
                  }))
                }
                placeholder="Payload JSON"
              />
              <Button
                className="h-8 w-full gap-1"
                onClick={() => void submitNotification()}
                disabled={saving !== null || !notificationDraft.title.trim()}
              >
                {saving === 'notification' ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <Plus className="size-3.5" />
                )}
                Create Notice
              </Button>
            </Section>

            <Section title="Preference" icon={<Bell className="size-3.5" />}>
              <div className="grid grid-cols-2 gap-2">
                <Select
                  value={preferenceDraft.channel}
                  onChange={(value) =>
                    setPreferenceDraft((draft) => ({
                      ...draft,
                      channel: value as NotificationChannel,
                    }))
                  }
                  options={channels}
                />
                <Select
                  value={preferenceDraft.minLevel}
                  onChange={(value) =>
                    setPreferenceDraft((draft) => ({ ...draft, minLevel: value as NotificationLevel }))
                  }
                  options={levels}
                />
              </div>
              <Toggle
                label="Enabled"
                checked={preferenceDraft.enabled}
                onChange={(checked) =>
                  setPreferenceDraft((draft) => ({ ...draft, enabled: checked }))
                }
              />
              <Button
                className="h-8 w-full gap-1"
                onClick={() => void submitPreference()}
                disabled={saving !== null}
              >
                {saving === 'preference' ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <Plus className="size-3.5" />
                )}
                Save Preference
              </Button>
            </Section>

            <Section title="Agent Debug" icon={<BugPlay className="size-3.5" />}>
              <div className="rounded-md border px-2 py-2 text-[11px]">
                <div className="truncate font-medium">
                  {selectedRun ? selectedRun.goal : 'No run selected'}
                </div>
                <div className="mt-1 grid grid-cols-2 gap-1 text-muted-foreground">
                  <span>{selectedRun?.status ?? 'idle'}</span>
                  <span>{selectedRun?.currentPhase ?? 'none'}</span>
                  <span>{debugPanelStat(selectedRunReplay, 'context')}</span>
                  <span>{debugPanelStat(selectedRunReplay, 'locks')}</span>
                </div>
              </div>
              <Button
                className="h-8 w-full gap-1"
                onClick={() => void createReplay()}
                disabled={saving !== null || !selectedRunId}
              >
                {saving === 'replay' ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <BugPlay className="size-3.5" />
                )}
                Capture Debug Replay
              </Button>
              <div className="grid grid-cols-2 gap-2">
                <Button
                  className="h-8 gap-1"
                  variant="outline"
                  onClick={() => void exportDebugPackage()}
                  disabled={saving !== null || !selectedRunId}
                >
                  {saving === 'debug-package' ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    <Download className="size-3.5" />
                  )}
                  Export
                </Button>
                <Button
                  className="h-8 gap-1"
                  variant="outline"
                  onClick={() => void simulateDebugNextStep()}
                  disabled={saving !== null || !selectedRunId}
                >
                  {saving === 'simulate-debug' ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    <BugPlay className="size-3.5" />
                  )}
                  Simulate
                </Button>
              </div>
              <div className="grid grid-cols-3 gap-1 text-[10px]">
                {['inject_prompt', 'skip_step', 'force_retry'].map((label) => (
                  <Badge key={label} variant="outline">
                    {label}
                  </Badge>
                ))}
              </div>
              {debugPackageManifest && (
                <div className="rounded-md border px-2 py-2 text-[10px] text-muted-foreground">
                  <div className="truncate text-foreground">{debugPackageManifest.fileName}</div>
                  <div className="mt-1">
                    {debugPackageManifest.files.length} files / {debugNextStepLabel(debugPackageManifest.diagnostics)}
                  </div>
                </div>
              )}
              <Button
                className="h-8 w-full gap-1"
                variant="outline"
                onClick={() => void computeHealth()}
                disabled={saving !== null || !selectedAgentId}
              >
                {saving === 'health' ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <HeartPulse className="size-3.5" />
                )}
                Compute Health
              </Button>
              <Hint>
                {selectedRun
                  ? `Selected run: ${selectedRun.status} / ${selectedRun.currentPhase}`
                  : 'Select an employee run to capture replay context.'}
              </Hint>
            </Section>
          </div>
        </ScrollArea>

        <ScrollArea className="min-h-0">
          <div className="space-y-3 p-3">
            <Section title="Metric Timeline" icon={<Activity className="size-3.5" />}>
              <Input
                value={metricFilter}
                onChange={(event) => setMetricFilter(event.target.value)}
                placeholder="Filter metric name"
              />
              <div className="grid grid-cols-2 gap-2">
                {metrics.length === 0 ? (
                  <EmptyState label="No metric points" />
                ) : (
                  metrics.slice(0, 24).map((metric) => (
                    <EntityRow
                      key={metric.id}
                      title={metric.metricName}
                      subtitle={`${metric.value} ${metric.unit}`}
                      badge="metric"
                      meta={`${metric.resourceType ?? 'workspace'} 路 ${formatTime(metric.createdAt)}`}
                    />
                  ))
                )}
              </div>
            </Section>

            <Section title="Alert Rules" icon={<Siren className="size-3.5" />}>
              <div className="grid grid-cols-2 gap-2">
                {alertRules.length === 0 ? (
                  <EmptyState label="No alert rules" />
                ) : (
                  alertRules.map((rule) => (
                    <EntityRow
                      key={rule.id}
                      title={rule.name}
                      subtitle={`${rule.metricName} ${rule.comparison} ${rule.threshold}`}
                      badge={rule.severity}
                      meta={`${rule.enabled ? 'enabled' : 'disabled'} 路 ${formatTime(rule.createdAt)}`}
                    />
                  ))
                )}
              </div>
            </Section>

            <Section title="Alert Events" icon={<Siren className="size-3.5" />}>
              <Select
                value={alertStatus}
                onChange={(value) => setAlertStatus(value as Array<'' | AlertEventRow['status']>[number])}
                options={alertStatuses}
                labels={{ '': 'all events' }}
              />
              <div className="grid grid-cols-2 gap-2">
                {alertEvents.length === 0 ? (
                  <EmptyState label="No alert events" />
                ) : (
                  alertEvents.map((event) => (
                    <EntityRow
                      key={event.id}
                      title={event.severity}
                      subtitle={event.message}
                      badge={event.status}
                      meta={`${event.resourceType ?? 'metric'} 路 ${formatTime(event.createdAt)}`}
                    />
                  ))
                )}
              </div>
            </Section>

            <Section title="Debug Replays" icon={<BugPlay className="size-3.5" />}>
              <div className="grid grid-cols-2 gap-2">
                {debugReplays.length === 0 ? (
                  <EmptyState label="No debug replays" />
                ) : (
                  debugReplays.map((replay) => (
                    <EntityRow
                      key={replay.id}
                      title={replay.resourceType}
                      subtitle={replay.summary}
                      badge={`${replay.eventCount} events`}
                      meta={`${replay.resourceId} / ${debugReplayFileCount(replay)} files / ${formatTime(replay.createdAt)}`}
                    />
                  ))
                )}
              </div>
            </Section>

            <Section title="Agent Health" icon={<HeartPulse className="size-3.5" />}>
              <div className="grid grid-cols-2 gap-2">
                {healthScores.length === 0 ? (
                  <EmptyState label="No health scores" />
                ) : (
                  healthScores.map((score) => (
                    <EntityRow
                      key={score.id}
                      title={`${score.score} health`}
                      subtitle={`success ${percent(score.successRate)} / failure ${percent(score.failureRate)}`}
                      badge={score.score >= 80 ? 'healthy' : score.score >= 50 ? 'watch' : 'critical'}
                      meta={`${score.runCount} runs 路 ${formatTime(score.computedAt)}`}
                    />
                  ))
                )}
              </div>
            </Section>

            <Section title="Agent Reputation" icon={<Trophy className="size-3.5" />}>
              <div className="grid grid-cols-2 gap-2">
                {reputationSnapshots.length === 0 ? (
                  <EmptyState label="No reputation snapshots" />
                ) : (
                  reputationSnapshots.map((snapshot) => (
                    <EntityRow
                      key={snapshot.id}
                      title={`${snapshot.overallScore} reputation`}
                      subtitle={`R ${snapshot.reliabilityScore} / E ${snapshot.efficiencyScore} / Q ${snapshot.qualityScore} / S ${snapshot.safetyScore} / L ${snapshot.learningScore} / C ${snapshot.collaborationScore}`}
                      badge={snapshot.trend}
                      meta={`${snapshot.monthLabel} / ${snapshot.runCount} runs / ${snapshot.badges.join(', ') || 'no badges'}`}
                    />
                  ))
                )}
              </div>
              {reputationReviews.length > 0 && (
                <div className="mt-2 grid grid-cols-2 gap-2">
                  {reputationReviews.slice(0, 4).map((review) => (
                    <EntityRow
                      key={review.id}
                      title={`${review.userRating}/5 review`}
                      subtitle={review.comment || `auto score ${review.autoScore}`}
                      badge="review"
                      meta={`${review.taskId} / ${formatTime(review.createdAt)}`}
                    />
                  ))}
                </div>
              )}
            </Section>

            <Section title="Reputation Leaderboard" icon={<Trophy className="size-3.5" />}>
              <div className="space-y-2">
                {!reputationLeaderboard || reputationLeaderboard.entries.length === 0 ? (
                  <EmptyState label="No reputation leaderboard" />
                ) : (
                  <>
                    <Hint>
                      {leaderboardSummary(reputationLeaderboard)}
                    </Hint>
                    <div className="grid grid-cols-2 gap-2">
                      {reputationLeaderboard.entries.slice(0, 10).map((entry) => (
                        <EntityRow
                          key={entry.snapshot.id}
                          title={`${entry.rank}. ${entry.agent?.name ?? entry.snapshot.agentProfileId}`}
                          subtitle={`${entry.snapshot.overallScore} score / success ${percent(entry.successRate)} / cost ${entry.averageCostPerTaskCents}c`}
                          badge={entry.snapshot.overallScore >= 85 ? 'top' : entry.snapshot.trend}
                          meta={`delta ${entry.deltaScore} / ${entry.snapshot.completedRunCount} completed`}
                        />
                      ))}
                    </div>
                  </>
                )}
              </div>
            </Section>

            <Section title="Meta Agent Digests" icon={<Bot className="size-3.5" />}>
              <div className="space-y-2">
                {metaDigests.length === 0 ? (
                  <EmptyState label="No Meta Agent digests" />
                ) : (
                  metaDigests.slice(0, 12).map((digest) => (
                    <EntityRow
                      key={digest.id}
                      title={digest.dateLabel}
                      subtitle={digest.summary}
                      badge={
                        digest.criticalAgentCount > 0
                          ? 'critical'
                          : digest.warningAgentCount > 0
                            ? 'watch'
                            : 'healthy'
                      }
                      meta={`ready ${digest.readyAgentCount} / warn ${digest.warningAgentCount} / approvals ${digest.pendingApprovalCount}`}
                    />
                  ))
                )}
              </div>
            </Section>

            <Section title="Meta Recommendations" icon={<Bot className="size-3.5" />}>
              <div className="space-y-2">
                {metaRecommendations.length === 0 ? (
                  <EmptyState label="No Meta Agent recommendations" />
                ) : (
                  metaRecommendations.slice(0, 20).map((recommendation) => (
                    <EntityRow
                      key={recommendation.id}
                      title={recommendation.title}
                      subtitle={recommendation.rationale || jsonPreview(recommendation.proposedAction)}
                      badge={recommendation.severity}
                      meta={`${recommendation.recommendationType} / ${recommendation.status} / approval ${recommendation.requiresApproval ? 'yes' : 'no'}`}
                      actions={
                        recommendation.status === 'open' ? (
                          <>
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 gap-1"
                              disabled={saving !== null}
                              onClick={() =>
                                void setMetaRecommendationStatus(recommendation, 'approved')
                              }
                            >
                              {saving === `meta-rec:${recommendation.id}` ? (
                                <Loader2 className="size-3 animate-spin" />
                              ) : (
                                <Bell className="size-3" />
                              )}
                              Approve
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7"
                              disabled={saving !== null}
                              onClick={() =>
                                void setMetaRecommendationStatus(recommendation, 'dismissed')
                              }
                            >
                              Dismiss
                            </Button>
                          </>
                        ) : null
                      }
                    />
                  ))
                )}
              </div>
            </Section>

            <Section title="Notifications" icon={<Bell className="size-3.5" />}>
              <Select
                value={notificationStatus}
                onChange={(value) =>
                  setNotificationStatus(value as Array<'' | NotificationRow['status']>[number])
                }
                options={notificationStatuses}
                labels={{ '': 'all notifications' }}
              />
              <div className="space-y-2">
                {notifications.length === 0 ? (
                  <EmptyState label="No notifications" />
                ) : (
                  notifications.map((notification) => (
                    <EntityRow
                      key={notification.id}
                      title={notification.title}
                      subtitle={notification.message || jsonPreview(notification.payload)}
                      badge={notification.status}
                      meta={`${notification.level} 路 ${notification.channel} 路 ${formatTime(notification.createdAt)}`}
                      actions={
                        notification.status === 'unread' ? (
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 gap-1"
                            disabled={saving !== null}
                            onClick={() => void markRead(notification)}
                          >
                            {saving === `read:${notification.id}` ? (
                              <Loader2 className="size-3 animate-spin" />
                            ) : (
                              <Bell className="size-3" />
                            )}
                            Read
                          </Button>
                        ) : null
                      }
                    />
                  ))
                )}
              </div>
            </Section>

            <Section title="Notification Preferences" icon={<Bell className="size-3.5" />}>
              <div className="grid grid-cols-2 gap-2">
                {preferences.length === 0 ? (
                  <EmptyState label="No notification preferences" />
                ) : (
                  preferences.map((preference) => (
                    <EntityRow
                      key={preference.id}
                      title={preference.channel}
                      subtitle={`minimum ${preference.minLevel}`}
                      badge={preference.enabled ? 'enabled' : 'disabled'}
                      meta={formatTime(preference.updatedAt)}
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

function Section({
  title,
  icon,
  children,
}: {
  title: string
  icon?: ReactNode
  children: ReactNode
}) {
  return (
    <section className="rounded-lg border bg-background/60 p-2.5">
      <div className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase text-muted-foreground">
        {icon}
        <span>{title}</span>
      </div>
      <div className="space-y-2">{children}</div>
    </section>
  )
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md border bg-background px-1.5 py-1">
      <div className="truncate uppercase">{label}</div>
      <div className="text-sm font-semibold text-foreground">{value}</div>
    </div>
  )
}

function EntityRow({
  title,
  subtitle,
  badge,
  meta,
  actions,
}: {
  title: string
  subtitle: string
  badge: string
  meta: string
  actions?: ReactNode
}) {
  return (
    <div className="rounded-lg border bg-background p-2 text-xs">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate font-medium">{title}</div>
          <div className="mt-0.5 line-clamp-2 text-[11px] text-muted-foreground">{subtitle}</div>
        </div>
        <StatusBadge value={badge} />
      </div>
      <div className="mt-2 flex items-center justify-between gap-2">
        <div className="min-w-0 truncate text-[10px] text-muted-foreground">{meta}</div>
        {actions && <div className="flex shrink-0 items-center gap-1">{actions}</div>}
      </div>
    </div>
  )
}

function EmptyState({ label }: { label: string }) {
  return (
    <div className="rounded-lg border border-dashed px-3 py-4 text-center text-xs text-muted-foreground">
      {label}
    </div>
  )
}

function StatusBadge({ value }: { value: string }) {
  const tone =
    value === 'success' ||
    value === 'read' ||
    value === 'resolved' ||
    value === 'metric' ||
    value === 'healthy' ||
    value === 'enabled' ||
    value === 'improving' ||
    value === 'top' ||
    value === 'review'
      ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
      : value === 'critical' || value === 'open' || value === 'declining'
        ? 'border-destructive/30 bg-destructive/10 text-destructive'
        : 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300'
  return (
    <Badge variant="outline" className={cn('h-5 shrink-0 px-1.5 text-[10px]', tone)}>
      {value}
    </Badge>
  )
}

function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string
  checked: boolean
  onChange: (checked: boolean) => void
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className={cn(
        'flex h-8 items-center justify-center rounded-lg border px-2 text-[11px] transition',
        checked ? 'border-foreground/30 bg-accent text-foreground' : 'bg-background text-muted-foreground',
      )}
    >
      {label}
    </button>
  )
}

function Select({
  value,
  onChange,
  options,
  labels,
  emptyLabel,
}: {
  value: string
  onChange: (value: string) => void
  options: string[]
  labels?: Record<string, string>
  emptyLabel?: string
}) {
  return (
    <select
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className="h-8 w-full rounded-lg border border-input bg-background px-2 text-xs outline-none focus-visible:border-ring"
    >
      {emptyLabel && <option value="">{emptyLabel}</option>}
      {options.map((option) => (
        <option key={option} value={option}>
          {labels?.[option] ?? option}
        </option>
      ))}
    </select>
  )
}

function Hint({ children }: { children: ReactNode }) {
  return <div className="rounded-md bg-muted px-2 py-1.5 text-[11px] text-muted-foreground">{children}</div>
}

function parseJsonObject(text: string, label: string): JsonObject {
  try {
    const parsed = JSON.parse(text || '{}')
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error(`${label} must be a JSON object.`)
    }
    return parsed as JsonObject
  } catch (err) {
    throw new Error(`${label} must be valid JSON: ${formatError(err)}`)
  }
}

function parseNumber(value: string, label: string): number {
  const next = Number(value)
  if (!Number.isFinite(next)) throw new Error(`${label} must be a number.`)
  return next
}

function parseNumberInRange(value: string, label: string, min: number, max: number): number {
  const next = parseNumber(value, label)
  if (next < min || next > max) throw new Error(`${label} must be between ${min} and ${max}.`)
  return next
}

function parseIntegerInRange(value: string, label: string, min: number, max: number): number {
  const next = Math.trunc(parseNumberInRange(value, label, min, max))
  if (String(next) !== value.trim()) throw new Error(`${label} must be an integer.`)
  return next
}

function parsePositiveInt(value: string, fallback: number): number {
  const next = Number.parseInt(value, 10)
  return Number.isFinite(next) && next > 0 ? next : fallback
}

function parseOptionalPositiveInt(value: string): number | null {
  const trimmed = value.trim()
  if (!trimmed) return null
  const next = Number.parseInt(trimmed, 10)
  return Number.isFinite(next) && next > 0 ? next : null
}

function percent(value: number): string {
  return `${Math.round(value * 100)}%`
}

function currentMonthLabel(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
}

function leaderboardSummary(leaderboard: AgentReputationLeaderboardDto): string {
  const top = leaderboard.topAgent
    ? `top ${leaderboard.topAgent.agent?.name ?? leaderboard.topAgent.snapshot.agentProfileId} ${leaderboard.topAgent.snapshot.overallScore}`
    : 'no top Agent'
  const improver = leaderboard.fastestImprover
    ? `improver ${leaderboard.fastestImprover.agent?.name ?? leaderboard.fastestImprover.snapshot.agentProfileId} +${leaderboard.fastestImprover.deltaScore}`
    : 'no improver'
  const attention = leaderboard.needsAttention.length
    ? `watch ${leaderboard.needsAttention.map((entry) => entry.agent?.name ?? entry.snapshot.agentProfileId).join(', ')}`
    : 'no watch list'
  return `${leaderboard.monthLabel}: ${top} / ${improver} / ${attention}`
}

function jsonPreview(value: unknown): string {
  const text =
    typeof value === 'string'
      ? value
      : (() => {
          try {
            return JSON.stringify(value)
          } catch {
            return String(value)
          }
        })()
  return text.length > 140 ? `${text.slice(0, 140)}...` : text
}

function debugPanelStat(replay: DebugReplaySnapshotRow | null, kind: 'context' | 'locks'): string {
  const manifest = asObject(replay?.payload.debugPackageManifest)
  const diagnostics = asObject(manifest?.diagnostics)
  if (kind === 'locks') return `locks ${getNumber(diagnostics, 'heldLocks') ?? 0}`
  const tokenEstimate = getNumber(diagnostics, 'tokenEstimate') ?? 0
  const tokenBudget = getNumber(diagnostics, 'tokenBudget')
  return tokenBudget ? `ctx ${tokenEstimate}/${tokenBudget}` : `ctx ${tokenEstimate}`
}

function debugReplayFileCount(replay: DebugReplaySnapshotRow): number {
  const manifest = asObject(replay.payload.debugPackageManifest)
  const files = manifest?.files
  return Array.isArray(files) ? files.length : 0
}

function debugNextStepLabel(diagnostics: JsonObject): string {
  const simulation = asObject(diagnostics.nextStepSimulation)
  return getString(simulation, 'nextStep') ?? 'inspect_debug_package'
}

function isDebugPackageManifest(value: unknown): value is EmployeeRunDebugPackageDto {
  const manifest = asObject(value)
  return Boolean(
    manifest &&
      typeof manifest.fileName === 'string' &&
      manifest.resourceType === 'employee_run' &&
      typeof manifest.resourceId === 'string' &&
      Array.isArray(manifest.files),
  )
}

function asObject(value: unknown): JsonObject | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as JsonObject)
    : null
}

function getString(obj: JsonObject | null, key: string): string | null {
  const value = obj?.[key]
  return typeof value === 'string' ? value : null
}

function getNumber(obj: JsonObject | null, key: string): number | null {
  const value = obj?.[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function formatTime(value: number | null | undefined): string {
  if (!value) return '-'
  return new Date(value).toLocaleString()
}

function formatError(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}
