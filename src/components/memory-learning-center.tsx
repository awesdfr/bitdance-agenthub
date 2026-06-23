'use client'

import {
  Archive,
  Brain,
  CheckCircle2,
  Edit3,
  Loader2,
  Pin,
  Plus,
  RefreshCw,
  Send,
  Trash2,
  Users,
  XCircle,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Textarea } from '@/components/ui/textarea'
import type {
  AgentDiaryEntryRow,
  AgentProfileRow,
  AgentRetirementPlanRow,
  ContinuationPlanRow,
  KnowledgeTransferPackageRow,
  KnowledgeTransferReceiverHandling,
  LearningEventRow,
  MemoryDecayPoint,
  MemoryDecaySnapshotRow,
  MemoryItemRow,
  MemoryPrivacyDataType,
  MemoryPrivacyEncryption,
  MemoryPrivacyReadAccess,
  MemoryPrivacyWriteAccess,
  MemoryScope,
  MemoryType,
  OrganizationalKnowledgeItemRow,
  OrganizationalLearningReportRow,
  PlaybookRow,
} from '@/db/schema'
import {
  approveLearningEvent,
  applyMemoryDecayAction,
  buildOrganizationalKnowledge,
  completeAgentRetirementPlan,
  createAgentRetirementPlan,
  createKnowledgeTransferPackage,
  createMemoryDecaySnapshot,
  createMemoryItem,
  fetchAgentDiaryEntries,
  fetchAgentProfiles,
  fetchAgentRetirementPlans,
  fetchContinuationPlans,
  fetchKnowledgeTransferPackages,
  fetchLearningEvents,
  fetchMemoryDecaySnapshots,
  fetchMemoryItems,
  fetchOrganizationalKnowledgeItems,
  fetchOrganizationalLearningReports,
  fetchPlaybooks,
  promoteOrganizationalInsight,
  rejectLearningEvent,
} from '@/lib/api'
import { cn } from '@/lib/utils'

type LearningStatusFilter = '' | LearningEventRow['status']

const memoryTypes: MemoryType[] = [
  'episodic',
  'semantic',
  'procedural',
  'project',
  'customer',
  'software',
  'mistake',
  'success',
]

const memoryScopes: MemoryScope[] = ['agent', 'project', 'workspace', 'global']
const memoryReadAccessOptions: MemoryPrivacyReadAccess[] = [
  'only_me',
  'my_team',
  'my_role',
  'project',
  'organization',
  'user_only',
]
const memoryWriteAccessOptions: MemoryPrivacyWriteAccess[] = ['only_me', 'user', 'team_lead']
const memoryEncryptionOptions: MemoryPrivacyEncryption[] = ['at_rest', 'always_encrypted', 'none']
const memoryDataTypeOptions: MemoryPrivacyDataType[] = [
  'pii',
  'credentials',
  'business_secret',
  'customer_data',
  'internal_only',
  'public_ok',
]

export function MemoryLearningCenter() {
  const [agents, setAgents] = useState<AgentProfileRow[]>([])
  const [memories, setMemories] = useState<MemoryItemRow[]>([])
  const [learningEvents, setLearningEvents] = useState<LearningEventRow[]>([])
  const [diaryEntries, setDiaryEntries] = useState<AgentDiaryEntryRow[]>([])
  const [continuationPlans, setContinuationPlans] = useState<ContinuationPlanRow[]>([])
  const [retirementPlans, setRetirementPlans] = useState<AgentRetirementPlanRow[]>([])
  const [transferPackages, setTransferPackages] = useState<KnowledgeTransferPackageRow[]>([])
  const [orgInsights, setOrgInsights] = useState<OrganizationalKnowledgeItemRow[]>([])
  const [orgReports, setOrgReports] = useState<OrganizationalLearningReportRow[]>([])
  const [playbooks, setPlaybooks] = useState<PlaybookRow[]>([])
  const [decaySnapshot, setDecaySnapshot] = useState<MemoryDecaySnapshotRow | null>(null)
  const [selectedDecayMemoryId, setSelectedDecayMemoryId] = useState<string | null>(null)
  const [selectedAgentId, setSelectedAgentId] = useState('')
  const [targetAgentId, setTargetAgentId] = useState('')
  const [receiverHandling, setReceiverHandling] =
    useState<KnowledgeTransferReceiverHandling>('review_each')
  const [excludeMistakes, setExcludeMistakes] = useState(false)
  const [promoteTeamMemory, setPromoteTeamMemory] = useState(true)
  const [learningStatus, setLearningStatus] = useState<LearningStatusFilter>('pending_review')
  const [memoryTitle, setMemoryTitle] = useState('')
  const [memoryContent, setMemoryContent] = useState('')
  const [memoryScope, setMemoryScope] = useState<MemoryScope>('agent')
  const [memoryType, setMemoryType] = useState<MemoryType>('semantic')
  const [memoryImportance, setMemoryImportance] = useState('0.7')
  const [memoryReadAccess, setMemoryReadAccess] = useState<MemoryPrivacyReadAccess>('only_me')
  const [memoryWriteAccess, setMemoryWriteAccess] = useState<MemoryPrivacyWriteAccess>('only_me')
  const [memoryEncryption, setMemoryEncryption] = useState<MemoryPrivacyEncryption>('at_rest')
  const [memoryDataTypes, setMemoryDataTypes] = useState<MemoryPrivacyDataType[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const selectedAgent = useMemo(
    () => agents.find((agent) => agent.id === selectedAgentId) ?? null,
    [agents, selectedAgentId],
  )

  const pendingLearningCount = useMemo(
    () => learningEvents.filter((event) => event.status === 'pending_review').length,
    [learningEvents],
  )

  const blockerDiaryCount = useMemo(
    () => diaryEntries.filter((entry) => entry.entryType === 'blocker').length,
    [diaryEntries],
  )

  const latestRetirementPlan = retirementPlans[0] ?? null

  const reload = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [
        agentsNext,
        memoriesNext,
        learningNext,
        diaryNext,
        continuationNext,
        retirementNext,
        transfersNext,
        orgInsightsNext,
        orgReportsNext,
        playbooksNext,
        decaySnapshotsNext,
      ] = await Promise.all([
        fetchAgentProfiles(),
        fetchMemoryItems({
          agentProfileId: selectedAgentId || undefined,
          limit: 100,
        }),
        fetchLearningEvents(learningStatus || undefined),
        fetchAgentDiaryEntries({
          agentProfileId: selectedAgentId || undefined,
          limit: 80,
        }),
        fetchContinuationPlans({
          agentProfileId: selectedAgentId || undefined,
          limit: 80,
        }),
        fetchAgentRetirementPlans({
          agentProfileId: selectedAgentId || undefined,
          limit: 40,
        }),
        fetchKnowledgeTransferPackages({
          fromAgentProfileId: selectedAgentId || undefined,
          limit: 40,
        }),
        fetchOrganizationalKnowledgeItems({ limit: 60 }),
        fetchOrganizationalLearningReports(20),
        fetchPlaybooks(selectedAgentId || undefined),
        fetchMemoryDecaySnapshots({
          agentProfileId: selectedAgentId || undefined,
          limit: 1,
        }),
      ])
      const decayNext =
        decaySnapshotsNext[0] ??
        (await createMemoryDecaySnapshot({
          agentProfileId: selectedAgentId || null,
          includeExpired: true,
          filters: { limit: 100 },
        }))
      setAgents(agentsNext)
      setMemories(memoriesNext)
      setLearningEvents(learningNext)
      setDiaryEntries(diaryNext)
      setContinuationPlans(continuationNext)
      setRetirementPlans(retirementNext)
      setTransferPackages(transfersNext)
      setOrgInsights(orgInsightsNext)
      setOrgReports(orgReportsNext)
      setPlaybooks(playbooksNext)
      setDecaySnapshot(decayNext)
      setSelectedDecayMemoryId((current) =>
        current && decayNext.points.some((point) => point.memoryItemId === current)
          ? current
          : decayNext.points[0]?.memoryItemId ?? null,
      )
    } catch (err) {
      setError(formatError(err))
    } finally {
      setLoading(false)
    }
  }, [learningStatus, selectedAgentId])

  useEffect(() => {
    void reload()
  }, [reload])

  const submitMemory = async () => {
    setSaving('memory')
    setError(null)
    setNotice(null)
    try {
      await createMemoryItem({
        agentProfileId: selectedAgentId || null,
        scope: memoryScope,
        type: memoryType,
        title: memoryTitle,
        content: memoryContent,
        importance: clampNumber(memoryImportance, 0.7),
        confidence: 0.8,
        readAccess: memoryReadAccess,
        writeAccess: memoryWriteAccess,
        encryption: memoryEncryption,
        containsDataTypes: memoryDataTypes,
      })
      setMemoryTitle('')
      setMemoryContent('')
      setMemoryDataTypes([])
      setNotice('Memory saved')
      await reload()
    } catch (err) {
      setError(formatError(err))
    } finally {
      setSaving(null)
    }
  }

  const reviewLearning = async (event: LearningEventRow, approved: boolean) => {
    setSaving(event.id)
    setError(null)
    setNotice(null)
    try {
      if (approved) {
        await approveLearningEvent(event.id, 'Approved from Memory Center')
        setNotice('Learning approved')
      } else {
        await rejectLearningEvent(event.id, 'Rejected from Memory Center')
        setNotice('Learning rejected')
      }
      await reload()
    } catch (err) {
      setError(formatError(err))
    } finally {
      setSaving(null)
    }
  }

  const createRetirement = async () => {
    if (!selectedAgentId) {
      setError('Select an Agent first')
      return
    }
    setSaving('retirement')
    setError(null)
    setNotice(null)
    try {
      const plan = await createAgentRetirementPlan({
        agentProfileId: selectedAgentId,
        targetAgentProfileId: targetAgentId || null,
      })
      setNotice(`Retirement plan created: ${plan.status}`)
      await reload()
    } catch (err) {
      setError(formatError(err))
    } finally {
      setSaving(null)
    }
  }

  const transferKnowledge = async () => {
    if (!selectedAgentId || !targetAgentId) {
      setError('Select source and target Agents')
      return
    }
    setSaving('transfer')
    setError(null)
    setNotice(null)
    try {
      const transfer = await createKnowledgeTransferPackage({
        fromAgentProfileId: selectedAgentId,
        toAgentProfileId: targetAgentId,
        retirementPlanId: latestRetirementPlan?.id ?? null,
        receiverHandling,
        transferItems: {
          allMemories: true,
          allPlaybooks: true,
          minimumConfidence: 0.6,
          minimumImportance: 0.4,
          excludeMistakes,
          excludeLowConfidence: true,
        },
      })
      setNotice(`Knowledge transfer ${transfer.status}`)
      await reload()
    } catch (err) {
      setError(formatError(err))
    } finally {
      setSaving(null)
    }
  }

  const completeRetirement = async () => {
    if (!latestRetirementPlan) {
      setError('No retirement plan')
      return
    }
    setSaving('complete-retirement')
    setError(null)
    setNotice(null)
    try {
      const plan = await completeAgentRetirementPlan(latestRetirementPlan.id)
      setNotice(`Retirement ${plan.status}`)
      await reload()
    } catch (err) {
      setError(formatError(err))
    } finally {
      setSaving(null)
    }
  }

  const buildOrgLearning = async () => {
    setSaving('org-learning')
    setError(null)
    setNotice(null)
    try {
      const result = await buildOrganizationalKnowledge({
        source: 'all_agents',
        minFrequency: 1,
        promoteCandidates: promoteTeamMemory,
      })
      setNotice(`Org learning report: ${result.insights.length} insight(s)`)
      await reload()
    } catch (err) {
      setError(formatError(err))
    } finally {
      setSaving(null)
    }
  }

  const promoteLatestOrgInsight = async () => {
    const candidate = orgInsights.find((insight) => insight.status === 'candidate') ?? orgInsights[0]
    if (!candidate) {
      setError('No organizational insight')
      return
    }
    setSaving('promote-org')
    setError(null)
    setNotice(null)
    try {
      const insight = await promoteOrganizationalInsight(candidate.id)
      setNotice(`Promoted ${insight.title}`)
      await reload()
    } catch (err) {
      setError(formatError(err))
    } finally {
      setSaving(null)
    }
  }

  const refreshDecaySnapshot = async () => {
    setSaving('decay')
    setError(null)
    setNotice(null)
    try {
      const snapshot = await createMemoryDecaySnapshot({
        agentProfileId: selectedAgentId || null,
        includeExpired: true,
        filters: { limit: 100 },
      })
      setDecaySnapshot(snapshot)
      setSelectedDecayMemoryId(snapshot.points[0]?.memoryItemId ?? null)
      setNotice('Knowledge decay refreshed')
    } catch (err) {
      setError(formatError(err))
    } finally {
      setSaving(null)
    }
  }

  const handleDecayAction = async (point: MemoryDecayPoint, action: 'pin' | 'delete_now' | 'update_content') => {
    if (!decaySnapshot) return
    if (action === 'delete_now' && !window.confirm(`Delete memory "${point.title}"?`)) return
    setSaving(`decay-${point.memoryItemId}-${action}`)
    setError(null)
    setNotice(null)
    try {
      const snapshot = await applyMemoryDecayAction(decaySnapshot.id, {
        memoryItemId: point.memoryItemId,
        action,
        confirm: action === 'delete_now',
        patch: action === 'update_content' ? { importance: Math.max(point.importance, 0.7) } : {},
      })
      setDecaySnapshot(snapshot)
      setNotice(String(snapshot.actionResult.message ?? 'Memory updated'))
      await reload()
    } catch (err) {
      setError(formatError(err))
    } finally {
      setSaving(null)
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="shrink-0 border-b px-3 py-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <Brain className="size-4" />
              <span className="truncate">Memory Center</span>
            </div>
            <div className="mt-1 grid grid-cols-9 gap-1 text-[10px] text-muted-foreground">
              <Metric label="memory" value={memories.length} />
              <Metric label="pending" value={pendingLearningCount} />
              <Metric label="diary" value={diaryEntries.length} />
              <Metric label="blockers" value={blockerDiaryCount} />
              <Metric label="plans" value={continuationPlans.length} />
              <Metric label="retire" value={retirementPlans.length} />
              <Metric label="transfer" value={transferPackages.length} />
              <Metric label="org" value={orgInsights.length} />
              <Metric label="reports" value={orgReports.length} />
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
            <Section title="Agent">
              <select
                value={selectedAgentId}
                onChange={(event) => setSelectedAgentId(event.target.value)}
                className="h-8 w-full rounded-lg border border-input bg-background px-2 text-xs outline-none focus-visible:border-ring"
              >
                <option value="">All agents</option>
                {agents.map((agent) => (
                  <option key={agent.id} value={agent.id}>
                    {agent.name}
                  </option>
                ))}
              </select>
              {selectedAgent && (
                <div className="rounded-md border px-2 py-2 text-xs">
                  <div className="truncate font-medium">{selectedAgent.name}</div>
                  <div className="mt-1 truncate text-[10px] text-muted-foreground">
                    {selectedAgent.role}
                  </div>
                </div>
              )}
            </Section>

            <Section title="New Memory">
              <Input
                value={memoryTitle}
                onChange={(event) => setMemoryTitle(event.target.value)}
                placeholder="Title"
              />
              <Textarea
                className="min-h-20 text-xs"
                value={memoryContent}
                onChange={(event) => setMemoryContent(event.target.value)}
                placeholder="Content"
              />
              <div className="grid grid-cols-2 gap-2">
                <select
                  value={memoryScope}
                  onChange={(event) => setMemoryScope(event.target.value as MemoryScope)}
                  className="h-8 rounded-lg border border-input bg-background px-2 text-xs outline-none focus-visible:border-ring"
                >
                  {memoryScopes.map((scope) => (
                    <option key={scope} value={scope}>
                      {scope}
                    </option>
                  ))}
                </select>
                <select
                  value={memoryType}
                  onChange={(event) => setMemoryType(event.target.value as MemoryType)}
                  className="h-8 rounded-lg border border-input bg-background px-2 text-xs outline-none focus-visible:border-ring"
                >
                  {memoryTypes.map((type) => (
                    <option key={type} value={type}>
                      {type}
                    </option>
                  ))}
                </select>
              </div>
              <Input
                value={memoryImportance}
                onChange={(event) => setMemoryImportance(event.target.value)}
                inputMode="decimal"
                placeholder="Importance 0-1"
              />
              <div className="grid grid-cols-2 gap-2">
                <select
                  value={memoryReadAccess}
                  onChange={(event) =>
                    setMemoryReadAccess(event.target.value as MemoryPrivacyReadAccess)
                  }
                  className="h-8 rounded-lg border border-input bg-background px-2 text-xs outline-none focus-visible:border-ring"
                >
                  {memoryReadAccessOptions.map((access) => (
                    <option key={access} value={access}>
                      {access}
                    </option>
                  ))}
                </select>
                <select
                  value={memoryWriteAccess}
                  onChange={(event) =>
                    setMemoryWriteAccess(event.target.value as MemoryPrivacyWriteAccess)
                  }
                  className="h-8 rounded-lg border border-input bg-background px-2 text-xs outline-none focus-visible:border-ring"
                >
                  {memoryWriteAccessOptions.map((access) => (
                    <option key={access} value={access}>
                      {access}
                    </option>
                  ))}
                </select>
              </div>
              <select
                value={memoryEncryption}
                onChange={(event) =>
                  setMemoryEncryption(event.target.value as MemoryPrivacyEncryption)
                }
                className="h-8 rounded-lg border border-input bg-background px-2 text-xs outline-none focus-visible:border-ring"
              >
                {memoryEncryptionOptions.map((encryption) => (
                  <option key={encryption} value={encryption}>
                    {encryption}
                  </option>
                ))}
              </select>
              <div className="grid grid-cols-2 gap-1">
                {memoryDataTypeOptions.map((dataType) => (
                  <label
                    key={dataType}
                    className="flex min-w-0 items-center gap-1 rounded-md border px-2 py-1 text-[10px]"
                  >
                    <input
                      type="checkbox"
                      checked={memoryDataTypes.includes(dataType)}
                      onChange={() =>
                        setMemoryDataTypes((current) => toggleDataType(current, dataType))
                      }
                    />
                    <span className="truncate">{dataType}</span>
                  </label>
                ))}
              </div>
              <Button
                className="h-8 w-full gap-1"
                onClick={() => void submitMemory()}
                disabled={saving !== null || !memoryTitle.trim() || !memoryContent.trim()}
              >
                {saving === 'memory' ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <Plus className="size-3.5" />
                )}
                Save Memory
              </Button>
            </Section>

            <Section title="Learning Filter">
              <select
                value={learningStatus}
                onChange={(event) => setLearningStatus(event.target.value as LearningStatusFilter)}
                className="h-8 w-full rounded-lg border border-input bg-background px-2 text-xs outline-none focus-visible:border-ring"
              >
                <option value="">All</option>
                <option value="pending_review">pending_review</option>
                <option value="approved">approved</option>
                <option value="rejected">rejected</option>
              </select>
            </Section>

            <Section title="Org Learning">
              <label className="flex items-center gap-2 rounded-md border px-2 py-1.5 text-xs">
                <input
                  type="checkbox"
                  checked={promoteTeamMemory}
                  onChange={(event) => setPromoteTeamMemory(event.target.checked)}
                />
                <span>Promote team memory</span>
              </label>
              <Button
                className="h-8 w-full gap-1"
                onClick={() => void buildOrgLearning()}
                disabled={saving !== null}
              >
                {saving === 'org-learning' ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <Users className="size-3.5" />
                )}
                Build Org Learning
              </Button>
              <Button
                className="h-8 w-full gap-1"
                variant="outline"
                onClick={() => void promoteLatestOrgInsight()}
                disabled={saving !== null || orgInsights.length === 0}
              >
                {saving === 'promote-org' ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <CheckCircle2 className="size-3.5" />
                )}
                Promote Insight
              </Button>
            </Section>

            <Section title="Retirement">
              <select
                value={targetAgentId}
                onChange={(event) => setTargetAgentId(event.target.value)}
                className="h-8 w-full rounded-lg border border-input bg-background px-2 text-xs outline-none focus-visible:border-ring"
              >
                <option value="">Target Agent</option>
                {agents
                  .filter((agent) => agent.id !== selectedAgentId)
                  .map((agent) => (
                    <option key={agent.id} value={agent.id}>
                      {agent.name}
                    </option>
                  ))}
              </select>
              <select
                value={receiverHandling}
                onChange={(event) =>
                  setReceiverHandling(event.target.value as KnowledgeTransferReceiverHandling)
                }
                className="h-8 w-full rounded-lg border border-input bg-background px-2 text-xs outline-none focus-visible:border-ring"
              >
                <option value="review_each">review_each</option>
                <option value="accept_high_confidence">accept_high_confidence</option>
                <option value="accept_all">accept_all</option>
              </select>
              <label className="flex items-center gap-2 rounded-md border px-2 py-1.5 text-xs">
                <input
                  type="checkbox"
                  checked={excludeMistakes}
                  onChange={(event) => setExcludeMistakes(event.target.checked)}
                />
                <span>Exclude mistakes</span>
              </label>
              <Button
                className="h-8 w-full gap-1"
                onClick={() => void createRetirement()}
                disabled={saving !== null || !selectedAgentId}
              >
                {saving === 'retirement' ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <Archive className="size-3.5" />
                )}
                Create Retirement
              </Button>
              <Button
                className="h-8 w-full gap-1"
                variant="outline"
                onClick={() => void transferKnowledge()}
                disabled={saving !== null || !selectedAgentId || !targetAgentId}
              >
                {saving === 'transfer' ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <Send className="size-3.5" />
                )}
                Transfer Knowledge
              </Button>
              <Button
                className="h-8 w-full gap-1"
                variant="secondary"
                onClick={() => void completeRetirement()}
                disabled={saving !== null || !latestRetirementPlan}
              >
                {saving === 'complete-retirement' ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <CheckCircle2 className="size-3.5" />
                )}
                Complete Latest
              </Button>
            </Section>
          </div>
        </ScrollArea>

        <ScrollArea className="min-h-0">
          <div className="space-y-3 p-3">
            <Section title="Knowledge Decay">
              <MemoryDecayPanel
                snapshot={decaySnapshot}
                selectedMemoryId={selectedDecayMemoryId}
                saving={saving}
                onRefresh={() => void refreshDecaySnapshot()}
                onSelect={setSelectedDecayMemoryId}
                onAction={(point, action) => void handleDecayAction(point, action)}
              />
            </Section>

            <Section title="Learning Review">
              <div className="space-y-2">
                {learningEvents.length === 0 ? (
                  <EmptyState label="No learning events" />
                ) : (
                  learningEvents.slice(0, 20).map((event) => (
                    <LearningRow
                      key={event.id}
                      event={event}
                      saving={saving === event.id}
                      onApprove={() => void reviewLearning(event, true)}
                      onReject={() => void reviewLearning(event, false)}
                    />
                  ))
                )}
              </div>
            </Section>

            <Section title="Memory Items">
              <div className="grid grid-cols-2 gap-2">
                {memories.length === 0 ? (
                  <EmptyState label="No memory items" />
                ) : (
                  memories.slice(0, 24).map((memory) => (
                    <KnowledgeRow
                      key={memory.id}
                      title={memory.title}
                      body={memory.content}
                      badge={memory.type}
                      meta={`${memory.scope} / ${memoryPrivacySummary(memory)} / importance ${memory.importance.toFixed(2)}`}
                    />
                  ))
                )}
              </div>
            </Section>

            <Section title="Diary">
              <div className="space-y-2">
                {diaryEntries.length === 0 ? (
                  <EmptyState label="No diary entries" />
                ) : (
                  diaryEntries.slice(0, 18).map((entry) => (
                    <KnowledgeRow
                      key={entry.id}
                      title={entry.title}
                      body={entry.content}
                      badge={entry.entryType}
                      meta={formatTime(entry.createdAt)}
                    />
                  ))
                )}
              </div>
            </Section>

            <Section title="Continuation Plans">
              <div className="space-y-2">
                {continuationPlans.length === 0 ? (
                  <EmptyState label="No continuation plans" />
                ) : (
                  continuationPlans.slice(0, 18).map((plan) => (
                    <KnowledgeRow
                      key={plan.id}
                      title={plan.title}
                      body={plan.summary}
                      badge={plan.status}
                      meta={`due ${formatTime(plan.dueAt)} · steps ${plan.nextSteps.length}`}
                    />
                  ))
                )}
              </div>
            </Section>

            <Section title="Retirement Plans">
              <div className="space-y-2">
                {retirementPlans.length === 0 ? (
                  <EmptyState label="No retirement plans" />
                ) : (
                  retirementPlans.slice(0, 12).map((plan) => (
                    <KnowledgeRow
                      key={plan.id}
                      title={plan.farewellMessage || plan.id}
                      body={formatReport(plan.retirementReport)}
                      badge={plan.status}
                      meta={`memory ${numberFromJson(plan.analysis, 'memoryCount')} / playbook ${numberFromJson(plan.analysis, 'playbookCount')}`}
                    />
                  ))
                )}
              </div>
            </Section>

            <Section title="Knowledge Transfers">
              <div className="space-y-2">
                {transferPackages.length === 0 ? (
                  <EmptyState label="No knowledge transfers" />
                ) : (
                  transferPackages.slice(0, 12).map((transfer) => (
                    <KnowledgeRow
                      key={transfer.id}
                      title={`${transfer.fromAgentProfileId ?? 'source'} -> ${transfer.toAgentProfileId ?? 'target'}`}
                      body={formatReport(transfer.summary)}
                      badge={transfer.status}
                      meta={`mem ${transfer.memoryItemIds.length}/${transfer.createdMemoryItemIds.length} / playbook ${transfer.playbookIds.length}/${transfer.createdPlaybookIds.length}`}
                    />
                  ))
                )}
              </div>
            </Section>

            <Section title="Organizational Knowledge">
              <div className="grid grid-cols-2 gap-2">
                {orgInsights.length === 0 ? (
                  <EmptyState label="No organizational insights" />
                ) : (
                  orgInsights.slice(0, 16).map((insight) => (
                    <KnowledgeRow
                      key={insight.id}
                      title={insight.title}
                      body={insight.summary}
                      badge={insight.status}
                      meta={`${insight.insightType} / freq ${insight.frequency} / eff ${insight.effectiveness.toFixed(2)}`}
                    />
                  ))
                )}
              </div>
            </Section>

            <Section title="Weekly Org Reports">
              <div className="space-y-2">
                {orgReports.length === 0 ? (
                  <EmptyState label="No org learning reports" />
                ) : (
                  orgReports.slice(0, 10).map((report) => (
                    <KnowledgeRow
                      key={report.id}
                      title={report.topInsight}
                      body={report.recommendedActions.join(' ')}
                      badge={report.source}
                      meta={`discoveries ${report.newDiscoveries} / deprecated ${report.deprecatedKnowledge}`}
                    />
                  ))
                )}
              </div>
            </Section>

            <Section title="Playbooks">
              <div className="space-y-2">
                {playbooks.length === 0 ? (
                  <EmptyState label="No playbooks" />
                ) : (
                  playbooks.slice(0, 18).map((playbook) => (
                    <KnowledgeRow
                      key={playbook.id}
                      title={playbook.title}
                      body={playbook.description}
                      badge={playbook.status}
                      meta={formatTime(playbook.updatedAt)}
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

function MemoryDecayPanel({
  snapshot,
  selectedMemoryId,
  saving,
  onRefresh,
  onSelect,
  onAction,
}: {
  snapshot: MemoryDecaySnapshotRow | null
  selectedMemoryId: string | null
  saving: string | null
  onRefresh: () => void
  onSelect: (memoryItemId: string) => void
  onAction: (point: MemoryDecayPoint, action: 'pin' | 'delete_now' | 'update_content') => void
}) {
  const selected =
    snapshot?.points.find((point) => point.memoryItemId === selectedMemoryId) ??
    snapshot?.points[0] ??
    null
  const summary = snapshot?.summary ?? {}
  return (
    <div className="rounded-md border">
      <div className="flex items-start justify-between gap-2 border-b px-3 py-2">
        <div className="grid min-w-0 grid-cols-5 gap-1 text-[10px] text-muted-foreground">
          <Metric label="pinned" value={numberFromJson(summary, 'pinned')} />
          <Metric label="fresh" value={numberFromJson(summary, 'fresh')} />
          <Metric label="decay" value={numberFromJson(summary, 'decaying')} />
          <Metric label="expire" value={numberFromJson(summary, 'expiringSoon')} />
          <Metric label="cleanup" value={numberFromJson(summary, 'cleanupCandidates')} />
        </div>
        <Button
          size="xs"
          variant="outline"
          className="shrink-0 gap-1"
          onClick={onRefresh}
          disabled={saving !== null}
        >
          {saving === 'decay' ? (
            <Loader2 className="size-3 animate-spin" />
          ) : (
            <RefreshCw className="size-3" />
          )}
          Refresh Decay
        </Button>
      </div>

      {!snapshot || snapshot.points.length === 0 ? (
        <div className="p-3">
          <EmptyState label="No decay data" />
        </div>
      ) : (
        <div className="grid gap-3 p-3 lg:grid-cols-[minmax(0,1fr)_18rem]">
          <div className="min-w-0">
            <svg
              viewBox="0 0 640 260"
              role="img"
              aria-label="Knowledge decay importance over time"
              className="h-64 w-full rounded-md border bg-background"
            >
              <line x1="52" y1="210" x2="612" y2="210" className="stroke-border" />
              <line x1="52" y1="28" x2="52" y2="210" className="stroke-border" />
              <line x1="52" y1="76" x2="612" y2="76" className="stroke-muted" strokeDasharray="4 4" />
              <line x1="52" y1="136" x2="612" y2="136" className="stroke-muted" strokeDasharray="4 4" />
              <text x="18" y="36" className="fill-muted-foreground text-[11px]">高</text>
              <text x="18" y="104" className="fill-muted-foreground text-[11px]">中</text>
              <text x="18" y="202" className="fill-muted-foreground text-[11px]">低</text>
              <text x="548" y="238" className="fill-muted-foreground text-[11px]">时间</text>
              {snapshot.points.map((point) => (
                <g key={point.memoryItemId}>
                  <line
                    x1="52"
                    y1={pointY(point)}
                    x2={pointX(point)}
                    y2={pointY(point)}
                    className={cn('stroke-muted-foreground/40', point.lineStyle === 'dashed' && 'stroke-dasharray-4')}
                    strokeDasharray={point.lineStyle === 'dashed' ? '5 5' : undefined}
                  />
                  {point.marker === 'square' ? (
                    <rect
                      role="button"
                      tabIndex={0}
                      aria-label={point.title}
                      x={pointX(point) - 6}
                      y={pointY(point) - 6}
                      width="12"
                      height="12"
                      className={cn('cursor-pointer stroke-background', decayFill(point), selected?.memoryItemId === point.memoryItemId && 'stroke-foreground')}
                      onClick={() => onSelect(point.memoryItemId)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') onSelect(point.memoryItemId)
                      }}
                    />
                  ) : (
                    <circle
                      role="button"
                      tabIndex={0}
                      aria-label={point.title}
                      cx={pointX(point)}
                      cy={pointY(point)}
                      r={selected?.memoryItemId === point.memoryItemId ? 7 : 5}
                      className={cn('cursor-pointer stroke-background', decayFill(point), selected?.memoryItemId === point.memoryItemId && 'stroke-foreground')}
                      onClick={() => onSelect(point.memoryItemId)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') onSelect(point.memoryItemId)
                      }}
                    />
                  )}
                </g>
              ))}
            </svg>
            <div className="mt-2 flex flex-wrap gap-2 text-[10px] text-muted-foreground">
              <span>solid = pinned</span>
              <span>dashed = decaying</span>
              <span>square = cleanup soon</span>
            </div>
          </div>
          <div className="min-w-0 space-y-2">
            {selected ? (
              <>
                <KnowledgeRow
                  title={selected.title}
                  body={selected.detailText}
                  badge={selected.status}
                  meta={`${selected.type} / importance ${selected.importance.toFixed(2)} / age ${selected.ageDays}d`}
                />
                <div className="grid grid-cols-3 gap-1">
                  <Button
                    size="icon"
                    variant="outline"
                    title="Pin"
                    onClick={() => onAction(selected, 'pin')}
                    disabled={saving !== null || !selected.actionSuggestions.includes('pin')}
                  >
                    <Pin className="size-3.5" />
                  </Button>
                  <Button
                    size="icon"
                    variant="outline"
                    title="Update"
                    onClick={() => onAction(selected, 'update_content')}
                    disabled={saving !== null}
                  >
                    <Edit3 className="size-3.5" />
                  </Button>
                  <Button
                    size="icon"
                    variant="destructive"
                    title="Delete"
                    onClick={() => onAction(selected, 'delete_now')}
                    disabled={saving !== null || !selected.actionSuggestions.includes('delete_now')}
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </div>
              </>
            ) : (
              <EmptyState label="No selected memory" />
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function LearningRow({
  event,
  saving,
  onApprove,
  onReject,
}: {
  event: LearningEventRow
  saving: boolean
  onApprove: () => void
  onReject: () => void
}) {
  return (
    <div className="rounded-md border px-2 py-2 text-xs">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate font-medium">{event.title}</div>
          <div className="mt-1 line-clamp-2 text-[11px] text-muted-foreground">{event.summary}</div>
        </div>
        <Badge variant={badgeTone(event.status)}>{event.status}</Badge>
      </div>
      {event.status === 'pending_review' && (
        <div className="mt-2 flex gap-1">
          <Button
            size="xs"
            variant="outline"
            className="gap-1"
            onClick={onApprove}
            disabled={saving}
          >
            {saving ? <Loader2 className="size-3 animate-spin" /> : <CheckCircle2 className="size-3" />}
            Approve
          </Button>
          <Button
            size="xs"
            variant="destructive"
            className="gap-1"
            onClick={onReject}
            disabled={saving}
          >
            <XCircle className="size-3" />
            Reject
          </Button>
        </div>
      )}
    </div>
  )
}

function KnowledgeRow({
  title,
  body,
  badge,
  meta,
}: {
  title: string
  body: string
  badge: string
  meta: string
}) {
  return (
    <div className="rounded-md border px-2 py-2 text-xs">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate font-medium">{title}</div>
          <div className="mt-1 line-clamp-2 text-[11px] text-muted-foreground">{body}</div>
        </div>
        <Badge variant={badgeTone(badge)}>{badge}</Badge>
      </div>
      <div className="mt-1 truncate text-[10px] text-muted-foreground">{meta}</div>
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

function badgeTone(status: string): 'default' | 'secondary' | 'destructive' | 'outline' {
  if (
    status === 'approved' ||
    status === 'active' ||
    status === 'completed' ||
    status === 'success'
  ) {
    return 'secondary'
  }
  if (status === 'rejected' || status === 'canceled' || status === 'mistake' || status === 'blocker') {
    return 'destructive'
  }
  if (
    status === 'pending_review' ||
    status === 'ready_for_review' ||
    status === 'open' ||
    status === 'in_progress'
  ) return 'default'
  return 'outline'
}

function formatTime(value: number | null): string {
  if (!value) return 'none'
  return new Date(value).toLocaleString([], {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function clampNumber(value: string, fallback: number): number {
  const parsed = Number.parseFloat(value)
  if (!Number.isFinite(parsed)) return fallback
  return Math.max(0, Math.min(1, parsed))
}

function toggleDataType(
  current: MemoryPrivacyDataType[],
  dataType: MemoryPrivacyDataType,
): MemoryPrivacyDataType[] {
  return current.includes(dataType)
    ? current.filter((item) => item !== dataType)
    : [...current, dataType]
}

function memoryPrivacySummary(memory: MemoryItemRow): string {
  const dataTypes = memory.containsDataTypes.length ? memory.containsDataTypes.join(',') : 'no_tags'
  return `read ${memory.readAccess} / write ${memory.writeAccess} / ${memory.encryption} / ${dataTypes}`
}

function pointX(point: MemoryDecayPoint): number {
  return 52 + point.x * 560
}

function pointY(point: MemoryDecayPoint): number {
  return 210 - point.y * 182
}

function decayFill(point: MemoryDecayPoint): string {
  if (point.colorRole === 'core') return 'fill-red-500'
  if (point.colorRole === 'important') return 'fill-amber-500'
  if (point.colorRole === 'temporary') return 'fill-emerald-500'
  if (point.colorRole === 'expiring') return 'fill-zinc-200 stroke-zinc-500'
  return 'fill-zinc-500'
}

function numberFromJson(value: Record<string, unknown>, key: string): number {
  const raw = value[key]
  return typeof raw === 'number' && Number.isFinite(raw) ? raw : 0
}

function formatReport(value: Record<string, unknown>): string {
  const statistics = value.statistics
  if (statistics && typeof statistics === 'object' && !Array.isArray(statistics)) {
    const stats = statistics as Record<string, unknown>
    return `runs ${numberFromJson(stats, 'completedRuns')}/${numberFromJson(stats, 'failedRuns')} / memories ${numberFromJson(stats, 'memoryCount')}`
  }
  const selectedMemories = numberFromJson(value, 'selectedMemories')
  const createdMemories = numberFromJson(value, 'createdMemories')
  const selectedPlaybooks = numberFromJson(value, 'selectedPlaybooks')
  const createdPlaybooks = numberFromJson(value, 'createdPlaybooks')
  if (selectedMemories || createdMemories || selectedPlaybooks || createdPlaybooks) {
    return `memories ${selectedMemories}/${createdMemories} / playbooks ${selectedPlaybooks}/${createdPlaybooks}`
  }
  return JSON.stringify(value).slice(0, 180)
}

function formatError(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}
