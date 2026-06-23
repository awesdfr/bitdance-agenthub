'use client'

import {
  CheckCircle2,
  ClipboardCheck,
  Download,
  HardDrive,
  Loader2,
  MonitorCog,
  Play,
  RefreshCw,
  Server,
  ShieldCheck,
  Square,
  TriangleAlert,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  createProductionGoLiveDecision,
  createProductionLivePilotLease,
  discoverProductionWorkstationProviders,
  exportProductionCustomerEnvironmentPackage,
  exportProductionOnsiteActivationPackage,
  fetchProductionCustomerEnvironmentReport,
  fetchProductionExecutionPreflightReport,
  fetchProductionFinalAcceptanceLedger,
  fetchProductionGoLiveDrillReport,
  fetchProductionIntegrationReadiness,
  fetchProductionLiveConnectorReport,
  fetchProductionLivePilotSessionReport,
  fetchProductionModelCredentialReport,
  fetchProductionOnsiteActivationGuide,
  fetchProductionPackageIntegrityReport,
  fetchProductionSetupGuide,
  fetchRealControlRuntimeAcceptanceReport,
  probeProductionDesktop,
  startProductionLivePilotSession,
  stopProductionLivePilotSession,
  type ProductionCustomerEnvironmentPackageDto,
  type ProductionCustomerEnvironmentReportDto,
  type ProductionExecutionPreflightReportDto,
  type ProductionFinalAcceptanceLedgerDto,
  type ProductionGoLiveDecisionDto,
  type ProductionGoLiveDrillReportDto,
  type ProductionIntegrationReadinessDto,
  type ProductionIntegrationStatus,
  type ProductionLiveConnectorReportDto,
  type ProductionLivePilotLeaseDto,
  type ProductionLivePilotSessionReportDto,
  type ProductionModelCredentialReportDto,
  type ProductionOnsiteActivationGuideDto,
  type ProductionOnsiteActivationPackageDto,
  type ProductionPackageIntegrityReportDto,
  type ProductionSetupGuideDto,
  type RealControlRuntimeAcceptanceReportDto,
  type WorkstationProviderDiscoveryDto,
  type DesktopAutomationProbeDto,
} from '@/lib/api'
import { cn } from '@/lib/utils'

type SavingAction =
  | 'refresh'
  | 'desktop'
  | 'workstation'
  | 'decision'
  | 'lease'
  | 'session'
  | 'activation-export'
  | 'customer-export'

interface ProductionDashboardState {
  readiness: ProductionIntegrationReadinessDto | null
  modelCredentials: ProductionModelCredentialReportDto | null
  liveConnectors: ProductionLiveConnectorReportDto | null
  realControl: RealControlRuntimeAcceptanceReportDto | null
  executionPreflight: ProductionExecutionPreflightReportDto | null
  setupGuide: ProductionSetupGuideDto | null
  finalAcceptance: ProductionFinalAcceptanceLedgerDto | null
  goLiveDrill: ProductionGoLiveDrillReportDto | null
  livePilotSession: ProductionLivePilotSessionReportDto | null
  packageIntegrity: ProductionPackageIntegrityReportDto | null
  activationGuide: ProductionOnsiteActivationGuideDto | null
  customerEnvironment: ProductionCustomerEnvironmentReportDto | null
}

const EMPTY_STATE: ProductionDashboardState = {
  readiness: null,
  modelCredentials: null,
  liveConnectors: null,
  realControl: null,
  executionPreflight: null,
  setupGuide: null,
  finalAcceptance: null,
  goLiveDrill: null,
  livePilotSession: null,
  packageIntegrity: null,
  activationGuide: null,
  customerEnvironment: null,
}

export function ProductionIntegrationsCenter() {
  const [dashboard, setDashboard] = useState<ProductionDashboardState>(EMPTY_STATE)
  const [goLiveDecision, setGoLiveDecision] = useState<ProductionGoLiveDecisionDto | null>(null)
  const [livePilotLease, setLivePilotLease] = useState<ProductionLivePilotLeaseDto | null>(null)
  const [activationPackage, setActivationPackage] =
    useState<ProductionOnsiteActivationPackageDto | null>(null)
  const [customerPackage, setCustomerPackage] =
    useState<ProductionCustomerEnvironmentPackageDto | null>(null)
  const [desktopProbe, setDesktopProbe] = useState<DesktopAutomationProbeDto | null>(null)
  const [workstationProbe, setWorkstationProbe] =
    useState<WorkstationProviderDiscoveryDto | null>(null)
  const [saving, setSaving] = useState<SavingAction | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const reload = useCallback(async () => {
    setSaving((current) => current ?? 'refresh')
    setError(null)
    try {
      const [
        readiness,
        modelCredentials,
        liveConnectors,
        realControl,
        executionPreflight,
        setupGuide,
        finalAcceptance,
        goLiveDrill,
        livePilotSession,
        packageIntegrity,
        activationGuide,
        customerEnvironment,
      ] = await Promise.all([
        fetchProductionIntegrationReadiness(),
        fetchProductionModelCredentialReport(),
        fetchProductionLiveConnectorReport(),
        fetchRealControlRuntimeAcceptanceReport(),
        fetchProductionExecutionPreflightReport(),
        fetchProductionSetupGuide(),
        fetchProductionFinalAcceptanceLedger(),
        fetchProductionGoLiveDrillReport(),
        fetchProductionLivePilotSessionReport(),
        fetchProductionPackageIntegrityReport(),
        fetchProductionOnsiteActivationGuide(),
        fetchProductionCustomerEnvironmentReport(),
      ])
      setDashboard({
        readiness,
        modelCredentials,
        liveConnectors,
        realControl,
        executionPreflight,
        setupGuide,
        finalAcceptance,
        goLiveDrill,
        livePilotSession,
        packageIntegrity,
        activationGuide,
        customerEnvironment,
      })
      setNotice('交付状态已刷新')
    } catch (err) {
      setError(formatError(err))
    } finally {
      setSaving((current) => (current === 'refresh' ? null : current))
    }
  }, [])

  useEffect(() => {
    void reload()
  }, [reload])

  const score = useMemo(() => {
    const scores = [
      dashboard.readiness?.readinessScore,
      dashboard.modelCredentials?.readinessScore,
      dashboard.liveConnectors?.readinessScore,
      dashboard.realControl?.readinessScore,
      dashboard.finalAcceptance?.readinessScore,
      dashboard.goLiveDrill?.readinessScore,
      dashboard.activationGuide?.readinessScore,
      dashboard.customerEnvironment?.readinessScore,
    ].filter((value): value is number => typeof value === 'number')
    if (scores.length === 0) return 0
    return Math.round(scores.reduce((sum, value) => sum + value, 0) / scores.length)
  }, [dashboard])

  const blockers = useMemo(() => uniqueLines([
    ...(dashboard.modelCredentials?.blockers ?? []),
    ...(dashboard.liveConnectors?.blockers ?? []),
    ...(dashboard.realControl?.blockers ?? []),
    ...(dashboard.finalAcceptance?.blockers ?? []),
    ...(dashboard.goLiveDrill?.blockers ?? []),
    ...(dashboard.activationGuide?.blockers ?? []),
    ...(dashboard.customerEnvironment?.blockers ?? []),
    ...(dashboard.livePilotSession?.blockers ?? []),
  ]).slice(0, 6), [dashboard])

  const nextActions = useMemo(() => uniqueLines([
    ...(dashboard.setupGuide?.steps
      .filter((step) => step.status !== 'done')
      .map((step) => step.title) ?? []),
    ...(dashboard.modelCredentials?.nextActions ?? []),
    ...(dashboard.liveConnectors?.nextActions ?? []),
    ...(dashboard.realControl?.nextActions ?? []),
    ...(dashboard.finalAcceptance?.nextActions ?? []),
    ...(dashboard.goLiveDrill?.nextActions ?? []),
    ...(dashboard.activationGuide?.nextActions ?? []),
    ...(dashboard.customerEnvironment?.nextActions ?? []),
    ...(dashboard.livePilotSession?.nextActions ?? []),
  ]).slice(0, 8), [dashboard])

  const runAction = async (
    action: SavingAction,
    successText: string,
    fn: () => Promise<void>,
  ) => {
    setSaving(action)
    setError(null)
    setNotice(null)
    try {
      await fn()
      setNotice(successText)
    } catch (err) {
      setError(formatError(err))
    } finally {
      setSaving(null)
    }
  }

  const refreshAfterMutation = async () => {
    await reload()
  }

  const handleDesktopProbe = () =>
    runAction('desktop', '电脑控制检查完成', async () => {
      setDesktopProbe(await probeProductionDesktop({ live: false, includeWindowList: true }))
      await refreshAfterMutation()
    })

  const handleWorkstationProbe = () =>
    runAction('workstation', '虚拟工位检查完成', async () => {
      setWorkstationProbe(await discoverProductionWorkstationProviders({ live: false }))
      await refreshAfterMutation()
    })

  const handleGoLiveDecision = () =>
    runAction('decision', '交付判定已生成', async () => {
      setGoLiveDecision(await createProductionGoLiveDecision())
      await refreshAfterMutation()
    })

  const handleLivePilotLease = () =>
    runAction('lease', '试运行凭证已生成', async () => {
      setLivePilotLease(await createProductionLivePilotLease({ durationMinutes: 60 }))
      await refreshAfterMutation()
    })

  const handleLivePilotSession = () =>
    runAction(
      'session',
      dashboard.livePilotSession?.activeSession ? '试运行已停止' : '试运行已开始',
      async () => {
        if (dashboard.livePilotSession?.activeSession) {
          await stopProductionLivePilotSession({ reason: 'manual_stop_from_production_center' })
        } else {
          await startProductionLivePilotSession({ durationMinutes: 60 })
        }
        await refreshAfterMutation()
      },
    )

  const handleActivationExport = () =>
    runAction('activation-export', '现场激活包已导出', async () => {
      setActivationPackage(await exportProductionOnsiteActivationPackage())
      await refreshAfterMutation()
    })

  const handleCustomerExport = () =>
    runAction('customer-export', '客户环境包已导出', async () => {
      setCustomerPackage(await exportProductionCustomerEnvironmentPackage())
      await refreshAfterMutation()
    })

  const sessionActive = !!dashboard.livePilotSession?.activeSession
  const canStartPilot = dashboard.goLiveDrill?.safeToStartLivePilot ?? false
  const actionBusy = saving !== null && saving !== 'refresh'

  return (
    <main className="flex min-h-0 flex-1 flex-col overflow-hidden bg-muted/20">
      <header className="shrink-0 border-b bg-background px-5 py-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <ClipboardCheck className="size-5 text-primary" />
              <h2 className="text-lg font-semibold">交付检查</h2>
              <StatusBadge status={overallStatus(score, blockers.length)} />
            </div>
            <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
              智能体要去真实操作电脑、跑客户任务或导出交付包之前，先在这里确认能不能安全交付。
            </p>
          </div>
          <Button
            variant="outline"
            className="gap-2"
            disabled={saving !== null}
            onClick={() => void reload()}
          >
            {saving === 'refresh' ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
            刷新状态
          </Button>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-auto p-5">
        <div className="mx-auto flex max-w-7xl flex-col gap-4">
          {(error || notice) && (
            <div
              className={cn(
                'rounded-md border px-3 py-2 text-sm',
                error
                  ? 'border-destructive/30 bg-destructive/10 text-destructive'
                  : 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
              )}
            >
              {error ?? notice}
            </div>
          )}

          <section className="grid gap-3 lg:grid-cols-[1.4fr_1fr]">
            <Panel className="min-h-[230px]">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold">交付准备度</div>
                  <div className="mt-1 text-4xl font-semibold tracking-tight">{score}%</div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <QuickBadge label="模型连接" value={dashboard.modelCredentials?.summary.readyModels ?? 0} />
                  <QuickBadge label="工具连接" value={dashboard.liveConnectors?.summary.ready ?? 0} />
                  <QuickBadge label="验收记录" value={dashboard.finalAcceptance?.summary.evidenceItems ?? 0} />
                  <QuickBadge label="试运行" value={dashboard.livePilotSession?.summary.active ?? 0} />
                </div>
              </div>
              <div className="mt-5 h-2 rounded-full bg-muted">
                <div
                  className={cn(
                    'h-full rounded-full transition-all',
                    score >= 85 ? 'bg-emerald-500' : score >= 55 ? 'bg-amber-500' : 'bg-primary',
                  )}
                  style={{ width: `${Math.max(4, Math.min(score, 100))}%` }}
                />
              </div>
              <div className="mt-5 grid gap-3 md:grid-cols-3">
                <StateTile
                  icon={<ShieldCheck className="size-4" />}
                  title="交付闸门"
                  value={dashboard.finalAcceptance?.canClaimProductionReady ? '已满足' : '待补齐'}
                  status={dashboard.finalAcceptance?.status}
                />
                <StateTile
                  icon={<MonitorCog className="size-4" />}
                  title="电脑操作"
                  value={dashboard.realControl?.safeToUseLiveControls ? '可使用' : '需检查'}
                  status={dashboard.realControl?.status}
                />
                <StateTile
                  icon={<Play className="size-4" />}
                  title="现场试运行"
                  value={sessionActive ? '运行中' : canStartPilot ? '可开始' : '未准备好'}
                  status={sessionActive ? 'ready' : dashboard.goLiveDrill?.status}
                />
              </div>
            </Panel>

            <Panel title="下一步" icon={<ClipboardCheck className="size-4" />}>
              {blockers.length > 0 ? (
                <Checklist lines={blockers} tone="blocked" />
              ) : nextActions.length > 0 ? (
                <Checklist lines={nextActions.slice(0, 5)} tone="next" />
              ) : (
                <EmptyState text="当前没有明显阻塞，可以生成交付判定或开始试运行。" />
              )}
            </Panel>
          </section>

          <Panel title="交付流程" icon={<CheckCircle2 className="size-4" />}>
            <div className="grid gap-3 xl:grid-cols-3">
              <DeliveryStepCard
                step="1"
                title="检查基础能力"
                description="先确认电脑或虚拟工位能不能被 Agent 安全使用。"
              >
                <ActionButton
                  title="检查电脑控制"
                  description="截图、窗口观察、受控点击"
                  icon={<MonitorCog className="size-4" />}
                  loading={saving === 'desktop'}
                  disabled={actionBusy}
                  onClick={handleDesktopProbe}
                />
                <ActionButton
                  title="检查虚拟工位（可选）"
                  description="RDP、VNC、虚拟机能力"
                  icon={<HardDrive className="size-4" />}
                  loading={saving === 'workstation'}
                  disabled={actionBusy}
                  onClick={handleWorkstationProbe}
                />
              </DeliveryStepCard>

              <DeliveryStepCard
                step="2"
                title="小范围试运行"
                description="先让 Agent 在受控窗口里跑一小段，确认不会乱操作。"
              >
                <ActionButton
                  title="生成试运行凭证"
                  description="创建 60 分钟受控窗口"
                  icon={<ClipboardCheck className="size-4" />}
                  loading={saving === 'lease'}
                  disabled={actionBusy}
                  onClick={handleLivePilotLease}
                />
                <ActionButton
                  title={sessionActive ? '停止试运行' : '开始试运行'}
                  description={sessionActive ? '结束当前试运行' : '开启受控试运行'}
                  icon={sessionActive ? <Square className="size-4" /> : <Play className="size-4" />}
                  loading={saving === 'session'}
                  disabled={actionBusy}
                  onClick={handleLivePilotSession}
                />
                <ActionButton
                  title="生成交付判定"
                  description="判断是否可以进入真实任务"
                  icon={<ShieldCheck className="size-4" />}
                  loading={saving === 'decision'}
                  disabled={actionBusy}
                  onClick={handleGoLiveDecision}
                />
              </DeliveryStepCard>

              <DeliveryStepCard
                step="3"
                title="导出交付材料"
                description="把现场执行、客户验收和回滚材料整理成包。"
              >
                <ActionButton
                  title="导出现场激活包"
                  description="激活脚本、回滚脚本、说明"
                  icon={<Download className="size-4" />}
                  loading={saving === 'activation-export'}
                  disabled={actionBusy}
                  onClick={handleActivationExport}
                />
                <ActionButton
                  title="导出客户环境包"
                  description="客户现场验收和环境迁移"
                  icon={<Download className="size-4" />}
                  loading={saving === 'customer-export'}
                  disabled={actionBusy}
                  onClick={handleCustomerExport}
                />
              </DeliveryStepCard>
            </div>
          </Panel>

          <section className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
            <Panel title="连接状态" icon={<Server className="size-4" />}>
              <div className="grid gap-2 md:grid-cols-2">
                {(dashboard.liveConnectors?.connectors ?? []).slice(0, 8).map((connector) => (
                  <div key={connector.id} className="rounded-md border bg-background px-3 py-2">
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0 truncate text-sm font-medium">{connector.label}</div>
                      <StatusBadge status={connector.status} />
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      {connector.ready ? '可以使用' : connector.blockers[0] ?? '需要继续配置'}
                    </div>
                  </div>
                ))}
              </div>
              {!dashboard.liveConnectors?.connectors.length && <EmptyState text="还没有连接状态，点击刷新后查看。" />}
            </Panel>

            <Panel title="试运行与上线凭证" icon={<Play className="size-4" />}>
              <div className="space-y-3 text-sm">
                <InfoRow
                  label="试运行状态"
                  value={
                    sessionActive
                      ? `运行中，${formatTime(dashboard.livePilotSession?.activeSession?.expiresAt)} 到期`
                      : '未运行'
                  }
                />
                <InfoRow
                  label="最新试运行凭证"
                  value={livePilotLease ? `${livePilotLease.status} / ${shortHash(livePilotLease.contentHash)}` : '未生成'}
                />
                <InfoRow
                  label="交付判定"
                  value={
                    goLiveDecision
                      ? `${goLiveDecision.decision === 'approved' ? '通过' : '阻塞'} / ${shortHash(goLiveDecision.contentHash)}`
                      : '未生成'
                  }
                />
                <InfoRow
                  label="现场激活包"
                  value={
                    activationPackage
                      ? `${activationPackage.files.markdownFileName} / ${shortHash(activationPackage.contentHash)}`
                      : '未导出'
                  }
                />
                <InfoRow
                  label="客户环境包"
                  value={
                    customerPackage
                      ? `${customerPackage.files.markdownFileName} / ${shortHash(customerPackage.contentHash)}`
                      : '未导出'
                  }
                />
              </div>
            </Panel>
          </section>

          <section className="grid gap-4 xl:grid-cols-3">
            <ProbePanel title="电脑控制" probe={desktopProbe} />
            <ProbePanel title="虚拟工位" probe={workstationProbe} />
          </section>

          <Panel title="详细待办" icon={<TriangleAlert className="size-4" />}>
            {nextActions.length > 0 ? <Checklist lines={nextActions} tone="next" /> : <EmptyState text="暂无待办。" />}
          </Panel>
        </div>
      </div>
    </main>
  )
}

function Panel({
  title,
  icon,
  className,
  children,
}: {
  title?: string
  icon?: ReactNode
  className?: string
  children: ReactNode
}) {
  return (
    <section className={cn('rounded-lg border bg-background p-4 shadow-sm', className)}>
      {title && (
        <div className="mb-3 flex items-center gap-2 text-sm font-semibold">
          {icon}
          <span>{title}</span>
        </div>
      )}
      {children}
    </section>
  )
}

function DeliveryStepCard({
  step,
  title,
  description,
  children,
}: {
  step: string
  title: string
  description: string
  children: ReactNode
}) {
  return (
    <div className="rounded-lg border bg-muted/10 p-3">
      <div className="flex items-start gap-3">
        <div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-primary text-sm font-semibold text-primary-foreground">
          {step}
        </div>
        <div className="min-w-0">
          <div className="text-sm font-semibold">{title}</div>
          <div className="mt-1 text-xs leading-5 text-muted-foreground">{description}</div>
        </div>
      </div>
      <div className="mt-3 grid gap-2">{children}</div>
    </div>
  )
}

function ActionButton({
  title,
  description,
  icon,
  loading,
  disabled,
  onClick,
}: {
  title: string
  description: string
  icon: ReactNode
  loading: boolean
  disabled: boolean
  onClick: () => void
}) {
  return (
    <Button
      type="button"
      variant="outline"
      className="h-auto min-h-[76px] justify-start gap-3 px-3 py-3 text-left"
      disabled={disabled}
      onClick={() => void onClick()}
    >
      <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
        {loading ? <Loader2 className="size-4 animate-spin" /> : icon}
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-medium text-foreground">{title}</span>
        <span className="mt-0.5 block whitespace-normal text-xs font-normal text-muted-foreground">
          {description}
        </span>
      </span>
    </Button>
  )
}

function StateTile({
  icon,
  title,
  value,
  status,
}: {
  icon: ReactNode
  title: string
  value: string
  status?: ProductionIntegrationStatus
}) {
  return (
    <div className="rounded-md border bg-muted/20 px-3 py-2">
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
          {icon}
          {title}
        </span>
        <StatusDot status={status ?? 'unknown'} />
      </div>
      <div className="mt-1 text-sm font-medium">{value}</div>
    </div>
  )
}

function QuickBadge({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md border bg-muted/30 px-3 py-1.5 text-center">
      <div className="text-sm font-semibold tabular-nums">{value}</div>
      <div className="text-[11px] text-muted-foreground">{label}</div>
    </div>
  )
}

function Checklist({ lines, tone }: { lines: string[]; tone: 'blocked' | 'next' }) {
  return (
    <div className="space-y-2">
      {lines.map((line, index) => (
        <div key={`${line}-${index}`} className="flex gap-2 rounded-md border bg-muted/20 px-3 py-2 text-sm">
          {tone === 'blocked' ? (
            <TriangleAlert className="mt-0.5 size-4 shrink-0 text-amber-500" />
          ) : (
            <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-primary" />
          )}
          <span className="min-w-0 break-words">{line}</span>
        </div>
      ))}
    </div>
  )
}

function ProbePanel({
  title,
  probe,
}: {
  title: string
  probe: DesktopAutomationProbeDto | WorkstationProviderDiscoveryDto | null
}) {
  return (
    <Panel title={title} icon={<MonitorCog className="size-4" />}>
      {probe ? (
        <div className="space-y-2 text-sm">
          <div className="flex items-center justify-between gap-2">
            <span className="text-muted-foreground">状态</span>
            <StatusBadge status={probe.status} />
          </div>
          <div className="rounded-md bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
            {probe.evidence[0] ?? probe.warnings[0] ?? probe.nextActions[0] ?? '检查完成，暂无更多说明。'}
          </div>
        </div>
      ) : (
        <EmptyState text="尚未检查。" />
      )}
    </Panel>
  )
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-3 border-b pb-2 last:border-b-0 last:pb-0">
      <span className="shrink-0 text-muted-foreground">{label}</span>
      <span className="min-w-0 break-words text-right font-medium">{value}</span>
    </div>
  )
}

function StatusBadge({ status }: { status: ProductionIntegrationStatus }) {
  const variant: 'default' | 'secondary' | 'destructive' | 'outline' =
    status === 'blocked' || status === 'not_installed'
      ? 'destructive'
      : status === 'ready'
        ? 'default'
        : status === 'available'
          ? 'secondary'
          : 'outline'
  return (
    <Badge variant={variant} className="shrink-0">
      {statusLabel(status)}
    </Badge>
  )
}

function StatusDot({ status }: { status: ProductionIntegrationStatus }) {
  return (
    <span
      className={cn(
        'size-2 rounded-full',
        status === 'ready'
          ? 'bg-emerald-500'
          : status === 'available'
            ? 'bg-blue-500'
            : status === 'blocked' || status === 'not_installed'
              ? 'bg-red-500'
              : 'bg-muted-foreground/40',
      )}
    />
  )
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="rounded-md border border-dashed bg-muted/20 px-3 py-6 text-center text-sm text-muted-foreground">
      {text}
    </div>
  )
}

function overallStatus(score: number, blockerCount: number): ProductionIntegrationStatus {
  if (blockerCount > 0) return 'blocked'
  if (score >= 85) return 'ready'
  if (score > 0) return 'available'
  return 'unknown'
}

function statusLabel(status: ProductionIntegrationStatus): string {
  const labels: Record<ProductionIntegrationStatus, string> = {
    ready: '已就绪',
    available: '可配置',
    not_configured: '未配置',
    not_installed: '未安装',
    blocked: '有阻塞',
    unknown: '未知',
  }
  return labels[status] ?? status
}

function uniqueLines(lines: string[]): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const line of lines) {
    const normalized = line.trim()
    if (!normalized || seen.has(normalized)) continue
    seen.add(normalized)
    result.push(normalized)
  }
  return result
}

function shortHash(value: string | null | undefined): string {
  if (!value) return '无哈希'
  return value.length > 12 ? `${value.slice(0, 12)}...` : value
}

function formatTime(timestamp: number | null | undefined): string {
  if (!timestamp) return '未知时间'
  return new Date(timestamp).toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function formatError(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}
