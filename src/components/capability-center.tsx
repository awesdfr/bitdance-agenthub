'use client'

import {
  Bot,
  CheckCircle2,
  GitBranch,
  Loader2,
  Network,
  RefreshCw,
  Search,
  Sparkles,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Textarea } from '@/components/ui/textarea'
import type {
  AgentProfileRow,
  CapabilityIndexEntryRow,
  CapabilityRecommendationRow,
  CapabilitySourceType,
  KnowledgeGraphEdgeRow,
  KnowledgeGraphNodeRow,
} from '@/db/schema'
import {
  applyCapabilityRecommendation,
  fetchAgentProfiles,
  fetchCapabilityIndexEntries,
  fetchCapabilityKnowledgeGraph,
  fetchCapabilityRecommendations,
  rebuildCapabilityIndex,
  recommendCapabilitiesForAgent,
  searchCapabilities,
  type CapabilityRecommendationResultDto,
  type CapabilitySearchResultDto,
} from '@/lib/api'

const sourceTypes: Array<CapabilitySourceType | 'all'> = [
  'all',
  'skill',
  'mcp_server',
  'mcp_tool',
  'tool_connection',
  'cli_profile',
  'software_profile',
  'software_command',
  'recorded_macro',
  'model_profile',
  'agent_profile',
  'playbook',
]

type LoadingAction = 'reload' | 'rebuild' | 'search' | 'recommend' | null

export function CapabilityCenter() {
  const [agents, setAgents] = useState<AgentProfileRow[]>([])
  const [entries, setEntries] = useState<CapabilityIndexEntryRow[]>([])
  const [nodes, setNodes] = useState<KnowledgeGraphNodeRow[]>([])
  const [edges, setEdges] = useState<KnowledgeGraphEdgeRow[]>([])
  const [recommendationHistory, setRecommendationHistory] = useState<CapabilityRecommendationRow[]>([])
  const [searchResults, setSearchResults] = useState<CapabilitySearchResultDto[]>([])
  const [recommendationResults, setRecommendationResults] = useState<CapabilityRecommendationResultDto[]>([])

  const [sourceType, setSourceType] = useState<CapabilitySourceType | 'all'>('all')
  const [selectedAgentId, setSelectedAgentId] = useState('')
  const [searchQuery, setSearchQuery] = useState('browser cli model memory')
  const [goal, setGoal] = useState('Finish a customer task by choosing the best model, skills, CLI, and software tools.')
  const [loadingAction, setLoadingAction] = useState<LoadingAction>('reload')
  const [applyingRecommendationId, setApplyingRecommendationId] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const selectedAgent = agents.find((agent) => agent.id === selectedAgentId) ?? null
  const entriesById = useMemo(() => new Map(entries.map((entry) => [entry.id, entry])), [entries])
  const nodesById = useMemo(() => new Map(nodes.map((node) => [node.id, node])), [nodes])
  const enabledCount = entries.filter((entry) => entry.enabled).length
  const riskyCount = entries.filter((entry) => entry.riskLevel === 'high').length
  const sourceStats = useMemo(() => {
    const counts = new Map<CapabilitySourceType, number>()
    for (const entry of entries) {
      counts.set(entry.sourceType, (counts.get(entry.sourceType) ?? 0) + 1)
    }
    return counts
  }, [entries])

  const topEntries = useMemo(
    () =>
      [...entries]
        .sort((a, b) => Number(b.enabled) - Number(a.enabled) || b.scoreHint - a.scoreHint)
        .slice(0, 18),
    [entries],
  )
  const visibleEdges = edges.slice(0, 24)

  const reload = useCallback(async () => {
    setLoadingAction('reload')
    setError(null)
    try {
      const [entriesNext, graphNext, agentsNext] = await Promise.all([
        fetchCapabilityIndexEntries(sourceType === 'all' ? undefined : sourceType),
        fetchCapabilityKnowledgeGraph(),
        fetchAgentProfiles(),
      ])
      setEntries(entriesNext)
      setNodes(graphNext.nodes)
      setEdges(graphNext.edges)
      setAgents(agentsNext)
      const nextAgentId = selectedAgentId || agentsNext[0]?.id || ''
      if (!selectedAgentId && nextAgentId) setSelectedAgentId(nextAgentId)
      if (nextAgentId) {
        setRecommendationHistory(await fetchCapabilityRecommendations(nextAgentId))
      } else {
        setRecommendationHistory([])
      }
      setNotice(`Loaded ${entriesNext.length} indexed capabilities.`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load capability center data.')
    } finally {
      setLoadingAction(null)
    }
  }, [selectedAgentId, sourceType])

  useEffect(() => {
    void reload()
  }, [reload])

  const handleRebuild = async () => {
    setLoadingAction('rebuild')
    setError(null)
    try {
      const rebuilt = await rebuildCapabilityIndex()
      const [entriesNext, graphNext] = await Promise.all([
        fetchCapabilityIndexEntries(sourceType === 'all' ? undefined : sourceType),
        fetchCapabilityKnowledgeGraph(),
      ])
      setEntries(entriesNext)
      setNodes(graphNext.nodes)
      setEdges(graphNext.edges)
      setNotice(`Rebuilt ${rebuilt.length} capability entries.`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to rebuild capability index.')
    } finally {
      setLoadingAction(null)
    }
  }

  const handleSearch = async () => {
    setLoadingAction('search')
    setError(null)
    try {
      const results = await searchCapabilities({ query: searchQuery, limit: 12 })
      setSearchResults(results)
      setNotice(`Found ${results.length} matching capabilities.`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to search capabilities.')
    } finally {
      setLoadingAction(null)
    }
  }

  const handleRecommend = async () => {
    if (!selectedAgentId) {
      setError('Create or select an Agent before requesting recommendations.')
      return
    }
    setLoadingAction('recommend')
    setError(null)
    try {
      const results = await recommendCapabilitiesForAgent(selectedAgentId, {
        goal,
        limit: 8,
      })
      setRecommendationResults(results)
      setRecommendationHistory(await fetchCapabilityRecommendations(selectedAgentId))
      setNotice(`Recommended ${results.length} capabilities for ${selectedAgent?.name ?? 'the Agent'}.`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to recommend capabilities.')
    } finally {
      setLoadingAction(null)
    }
  }

  const handleApplyRecommendation = async (recommendationId: string) => {
    setApplyingRecommendationId(recommendationId)
    setError(null)
    try {
      const result = await applyCapabilityRecommendation(recommendationId)
      setAgents((current) =>
        current.map((agent) => (agent.id === result.agentProfile.id ? result.agentProfile : agent)),
      )
      setRecommendationResults((current) =>
        current.map((item) =>
          item.recommendation.id === recommendationId
            ? { ...item, recommendation: result.recommendation }
            : item,
        ),
      )
      const [historyNext, graphNext] = await Promise.all([
        fetchCapabilityRecommendations(result.agentProfile.id),
        fetchCapabilityKnowledgeGraph(),
      ])
      setRecommendationHistory(historyNext)
      setNodes(graphNext.nodes)
      setEdges(graphNext.edges)
      setNotice(`Applied ${result.entry.displayName}: ${result.appliedChanges.join(', ')}.`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to apply capability recommendation.')
    } finally {
      setApplyingRecommendationId('')
    }
  }

  return (
    <div className="flex h-full flex-col">
      <div className="shrink-0 border-b p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <Network className="size-4 text-primary" />
              <h2 className="truncate text-sm font-semibold">Capability Center</h2>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              Index, search, recommend, and inspect every Agent-callable capability.
            </p>
          </div>
          <Button size="sm" variant="outline" onClick={() => void reload()} disabled={!!loadingAction}>
            {loadingAction === 'reload' ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <RefreshCw className="size-3.5" />
            )}
            Refresh
          </Button>
        </div>

        <div className="mt-3 grid grid-cols-4 gap-2">
          <Metric label="Indexed" value={entries.length} icon={<Network className="size-3.5" />} />
          <Metric label="Enabled" value={enabledCount} icon={<CheckCircle2 className="size-3.5" />} />
          <Metric label="Graph" value={`${nodes.length}/${edges.length}`} icon={<GitBranch className="size-3.5" />} />
          <Metric label="High Risk" value={riskyCount} icon={<Sparkles className="size-3.5" />} />
        </div>

        {error && (
          <div className="mt-3 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            {error}
          </div>
        )}
        {notice && !error && (
          <div className="mt-3 rounded-md border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
            {notice}
          </div>
        )}
      </div>

      <ScrollArea className="min-h-0 flex-1">
        <div className="space-y-4 p-4">
          <section className="rounded-lg border bg-background">
            <div className="flex items-center justify-between gap-3 border-b p-3">
              <div>
                <h3 className="text-sm font-semibold">Capability Index</h3>
                <p className="text-xs text-muted-foreground">Rebuild and filter the local ability catalog.</p>
              </div>
              <Button size="sm" onClick={() => void handleRebuild()} disabled={!!loadingAction}>
                {loadingAction === 'rebuild' ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <RefreshCw className="size-3.5" />
                )}
                Rebuild Index
              </Button>
            </div>

            <div className="space-y-3 p-3">
              <div className="grid grid-cols-2 gap-2">
                <label className="space-y-1 text-xs font-medium">
                  Source
                  <select
                    value={sourceType}
                    onChange={(event) => setSourceType(event.target.value as CapabilitySourceType | 'all')}
                    className="h-9 w-full rounded-md border bg-background px-2 text-xs outline-none"
                  >
                    {sourceTypes.map((source) => (
                      <option key={source} value={source}>
                        {formatSource(source)}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="space-y-1 text-xs font-medium">
                  Source mix
                  <div className="flex min-h-9 flex-wrap items-center gap-1 rounded-md border px-2 py-1">
                    {Array.from(sourceStats.entries())
                      .slice(0, 6)
                      .map(([source, count]) => (
                        <Badge key={source} variant="secondary" className="text-[10px]">
                          {formatSource(source)} {count}
                        </Badge>
                      ))}
                    {sourceStats.size === 0 && <span className="text-xs text-muted-foreground">No entries yet</span>}
                  </div>
                </div>
              </div>

              <div className="grid gap-2">
                {topEntries.map((entry) => (
                  <CapabilityEntryItem key={entry.id} entry={entry} />
                ))}
                {topEntries.length === 0 && (
                  <EmptyState title="No indexed capabilities" body="Run Rebuild Index to collect skills, tools, CLIs, software commands, models, Agents, and playbooks." />
                )}
              </div>
            </div>
          </section>

          <section className="rounded-lg border bg-background">
            <div className="border-b p-3">
              <h3 className="text-sm font-semibold">Search Capabilities</h3>
              <p className="text-xs text-muted-foreground">Find the best ability by natural-language intent.</p>
            </div>
            <div className="space-y-3 p-3">
              <div className="flex gap-2">
                <Input
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.target.value)}
                  placeholder="code review, browser automation, export PDF"
                  className="h-9 text-xs"
                />
                <Button size="sm" onClick={() => void handleSearch()} disabled={!!loadingAction}>
                  {loadingAction === 'search' ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    <Search className="size-3.5" />
                  )}
                  Search Capabilities
                </Button>
              </div>
              <div className="grid gap-2">
                {searchResults.map((result) => (
                  <SearchResultItem key={result.entry.id} result={result} />
                ))}
                {searchResults.length === 0 && (
                  <EmptyState title="No search run yet" body="Search the catalog to see ranked matching abilities and matched keywords." />
                )}
              </div>
            </div>
          </section>

          <section className="rounded-lg border bg-background">
            <div className="border-b p-3">
              <h3 className="text-sm font-semibold">Agent Recommendations</h3>
              <p className="text-xs text-muted-foreground">Pick an Agent and ask the system which abilities it should use.</p>
            </div>
            <div className="space-y-3 p-3">
              <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2">
                <label className="space-y-1 text-xs font-medium">
                  Agent
                  <select
                    value={selectedAgentId}
                    onChange={(event) => setSelectedAgentId(event.target.value)}
                    className="h-9 w-full rounded-md border bg-background px-2 text-xs outline-none"
                  >
                    <option value="">No Agent selected</option>
                    {agents.map((agent) => (
                      <option key={agent.id} value={agent.id}>
                        {agent.name}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="flex items-end">
                  <Button size="sm" onClick={() => void handleRecommend()} disabled={!!loadingAction || !selectedAgentId}>
                    {loadingAction === 'recommend' ? (
                      <Loader2 className="size-3.5 animate-spin" />
                    ) : (
                      <Sparkles className="size-3.5" />
                    )}
                    Recommend
                  </Button>
                </div>
              </div>

              {selectedAgent && (
                <div className="rounded-md border bg-muted/30 p-3">
                  <div className="flex items-center gap-2">
                    <Bot className="size-3.5 text-primary" />
                    <span className="text-xs font-semibold">{selectedAgent.name}</span>
                    <Badge variant="outline" className="text-[10px]">
                      {selectedAgent.role}
                    </Badge>
                  </div>
                  <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                    {selectedAgent.description || 'No description configured.'}
                  </p>
                </div>
              )}

              <Textarea
                value={goal}
                onChange={(event) => setGoal(event.target.value)}
                rows={3}
                className="text-xs"
                placeholder="Describe the customer goal this Agent must complete."
              />

              <div className="grid gap-2">
                {recommendationResults.map((result) => (
                  <RecommendationItem
                    key={result.recommendation.id}
                    result={result}
                    applying={applyingRecommendationId === result.recommendation.id}
                    onApply={handleApplyRecommendation}
                  />
                ))}
                {recommendationResults.length === 0 && (
                  <EmptyState title="No fresh recommendation" body="Run Recommend to create scored capability suggestions for the selected Agent." />
                )}
              </div>

              <div className="rounded-md border">
                <div className="border-b px-3 py-2 text-xs font-semibold">Recent recommendation records</div>
                <div className="grid max-h-48 gap-0 overflow-auto">
                  {recommendationHistory.slice(0, 8).map((row) => (
                    <div key={row.id} className="border-b px-3 py-2 last:border-b-0">
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate text-xs font-medium">
                          {entriesById.get(row.capabilityEntryId ?? '')?.displayName ?? row.capabilityEntryId ?? 'Unknown capability'}
                        </span>
                        <Badge variant={row.applied ? 'default' : 'secondary'} className="text-[10px]">
                          {row.applied ? 'applied' : 'suggested'} {row.score.toFixed(1)}
                        </Badge>
                      </div>
                      <p className="mt-1 line-clamp-2 text-[11px] text-muted-foreground">{row.reason}</p>
                    </div>
                  ))}
                  {recommendationHistory.length === 0 && (
                    <div className="px-3 py-6 text-center text-xs text-muted-foreground">
                      No persisted recommendations for this Agent.
                    </div>
                  )}
                </div>
              </div>
            </div>
          </section>

          <section className="rounded-lg border bg-background">
            <div className="border-b p-3">
              <h3 className="text-sm font-semibold">Knowledge Graph</h3>
              <p className="text-xs text-muted-foreground">Inspect capability, Agent, model, skill, and recommendation edges.</p>
            </div>
            <div className="grid gap-2 p-3">
              {visibleEdges.map((edge) => {
                const from = nodesById.get(edge.fromNodeId)
                const to = nodesById.get(edge.toNodeId)
                return (
                  <div key={edge.id} className="rounded-md border px-3 py-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="min-w-0 truncate text-xs font-medium">
                        {from?.label ?? edge.fromNodeId} {'->'} {to?.label ?? edge.toNodeId}
                      </span>
                      <Badge variant="outline" className="text-[10px]">
                        {edge.edgeType} {edge.weight.toFixed(1)}
                      </Badge>
                    </div>
                    <p className="mt-1 line-clamp-2 text-[11px] text-muted-foreground">
                      {summarizeEvidence(edge.evidence)}
                    </p>
                  </div>
                )
              })}
              {visibleEdges.length === 0 && (
                <EmptyState title="No graph edges yet" body="Rebuild the index or run Agent recommendations to create knowledge graph links." />
              )}
            </div>
          </section>
        </div>
      </ScrollArea>
    </div>
  )
}

function Metric({
  label,
  value,
  icon,
}: {
  label: string
  value: ReactNode
  icon: ReactNode
}) {
  return (
    <div className="rounded-md border bg-background p-2">
      <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
        {icon}
        {label}
      </div>
      <div className="mt-1 truncate text-sm font-semibold tabular-nums">{value}</div>
    </div>
  )
}

function CapabilityEntryItem({ entry }: { entry: CapabilityIndexEntryRow }) {
  return (
    <div className="rounded-md border px-3 py-2">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="truncate text-xs font-semibold">{entry.displayName}</span>
            <Badge variant={entry.enabled ? 'default' : 'secondary'} className="text-[10px]">
              {entry.enabled ? 'enabled' : 'disabled'}
            </Badge>
          </div>
          <p className="mt-1 line-clamp-2 text-[11px] text-muted-foreground">
            {entry.description || 'No description'}
          </p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <Badge variant="outline" className="text-[10px]">
            {entry.capabilityKind}
          </Badge>
          <Badge variant={riskVariant(entry.riskLevel)} className="text-[10px]">
            {entry.riskLevel}
          </Badge>
        </div>
      </div>
      <KeywordLine keywords={entry.keywords} />
    </div>
  )
}

function SearchResultItem({ result }: { result: CapabilitySearchResultDto }) {
  return (
    <div className="rounded-md border px-3 py-2">
      <div className="flex items-center justify-between gap-2">
        <span className="min-w-0 truncate text-xs font-semibold">{result.entry.displayName}</span>
        <Badge variant="default" className="text-[10px]">
          score {result.score.toFixed(1)}
        </Badge>
      </div>
      <p className="mt-1 line-clamp-2 text-[11px] text-muted-foreground">{result.reason}</p>
      <KeywordLine keywords={result.matchedKeywords.length ? result.matchedKeywords : result.entry.keywords} />
    </div>
  )
}

function RecommendationItem({
  result,
  applying,
  onApply,
}: {
  result: CapabilityRecommendationResultDto
  applying: boolean
  onApply: (recommendationId: string) => void
}) {
  return (
    <div className="rounded-md border px-3 py-2">
      <div className="flex items-center justify-between gap-2">
        <span className="min-w-0 truncate text-xs font-semibold">{result.entry.displayName}</span>
        <div className="flex shrink-0 items-center gap-1">
          <Badge variant={result.recommendation.applied ? 'default' : 'secondary'} className="text-[10px]">
            {result.recommendation.applied ? 'applied' : result.score.toFixed(1)}
          </Badge>
          <Button
            size="sm"
            variant="outline"
            className="h-7 px-2 text-[11px]"
            onClick={() => onApply(result.recommendation.id)}
            disabled={applying || result.recommendation.applied}
          >
            {applying ? <Loader2 className="size-3 animate-spin" /> : <CheckCircle2 className="size-3" />}
            Apply
          </Button>
        </div>
      </div>
      <div className="mt-1 flex flex-wrap gap-1">
        <Badge variant="outline" className="text-[10px]">
          {formatSource(result.entry.sourceType)}
        </Badge>
        <Badge variant={riskVariant(result.entry.riskLevel)} className="text-[10px]">
          {result.entry.riskLevel}
        </Badge>
      </div>
      <p className="mt-1 line-clamp-2 text-[11px] text-muted-foreground">{result.reason}</p>
    </div>
  )
}

function KeywordLine({ keywords }: { keywords: string[] }) {
  if (!keywords.length) return null
  return (
    <div className="mt-2 flex flex-wrap gap-1">
      {keywords.slice(0, 8).map((keyword) => (
        <Badge key={keyword} variant="secondary" className="max-w-28 truncate text-[10px]">
          {keyword}
        </Badge>
      ))}
    </div>
  )
}

function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-md border border-dashed px-3 py-6 text-center">
      <div className="text-xs font-semibold">{title}</div>
      <p className="mt-1 text-[11px] text-muted-foreground">{body}</p>
    </div>
  )
}

function formatSource(source: CapabilitySourceType | 'all'): string {
  if (source === 'all') return 'All'
  return source
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

function riskVariant(risk: CapabilityIndexEntryRow['riskLevel']) {
  if (risk === 'high') return 'destructive'
  if (risk === 'medium') return 'secondary'
  return 'outline'
}

function summarizeEvidence(evidence: Record<string, unknown>) {
  const query = typeof evidence.query === 'string' ? evidence.query : ''
  const source = typeof evidence.source === 'string' ? evidence.source : ''
  const matched = Array.isArray(evidence.matchedKeywords)
    ? evidence.matchedKeywords.filter((item): item is string => typeof item === 'string')
    : []
  if (query) return `Recommendation query: ${query}`
  if (matched.length) return `Matched keywords: ${matched.slice(0, 8).join(', ')}`
  if (source) return `Source: ${source}`
  return JSON.stringify(evidence).slice(0, 180) || 'No evidence payload.'
}
