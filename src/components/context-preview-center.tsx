'use client'

import {
  BrainCircuit,
  CheckCircle2,
  FileText,
  Loader2,
  RefreshCw,
  Scissors,
  XCircle,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Textarea } from '@/components/ui/textarea'
import type { AgentProfileRow } from '@/db/schema'
import {
  fetchAgentProfiles,
  previewAgentContextPack,
  type AgentContextPackPreviewDto,
  type PackedContextSectionDto,
} from '@/lib/api'

export function ContextPreviewCenter() {
  const [agents, setAgents] = useState<AgentProfileRow[]>([])
  const [selectedAgentId, setSelectedAgentId] = useState('')
  const [goal, setGoal] = useState('Prepare a verified customer deliverable using project memory, assigned tools, and the required output contract.')
  const [inputText, setInputText] = useState('{"customer":"demo","artifactType":"report"}')
  const [tokenBudget, setTokenBudget] = useState('900')
  const [memoryLimit, setMemoryLimit] = useState('8')
  const [preview, setPreview] = useState<AgentContextPackPreviewDto | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const selectedAgent = useMemo(
    () => agents.find((agent) => agent.id === selectedAgentId) ?? null,
    [agents, selectedAgentId],
  )
  const statusCounts = useMemo(() => {
    const counts = { included: 0, truncated: 0, omitted: 0 }
    for (const section of preview?.sections ?? []) counts[section.status] += 1
    return counts
  }, [preview])

  const reload = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const agentsNext = await fetchAgentProfiles()
      setAgents(agentsNext)
      if (!selectedAgentId && agentsNext[0]) setSelectedAgentId(agentsNext[0].id)
      setNotice(`Loaded ${agentsNext.length} Agent profiles.`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load Agent profiles.')
    } finally {
      setLoading(false)
    }
  }, [selectedAgentId])

  useEffect(() => {
    void reload()
  }, [reload])

  const handlePreview = async () => {
    if (!selectedAgentId) {
      setError('Select an Agent before previewing context.')
      return
    }
    setSaving(true)
    setError(null)
    try {
      const parsedInput = parseJsonObject(inputText)
      const next = await previewAgentContextPack(selectedAgentId, {
        goal,
        input: parsedInput,
        tokenBudget: parseOptionalInt(tokenBudget),
        memoryLimit: parseOptionalInt(memoryLimit) ?? undefined,
      })
      setPreview(next)
      setNotice(next.summary)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to preview context pack.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex h-full flex-col">
      <div className="shrink-0 border-b p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <BrainCircuit className="size-4 text-primary" />
              <h2 className="truncate text-sm font-semibold">Context Preview</h2>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              Pack Agent instructions, task input, contracts, policies, capabilities, and memories into a token budget.
            </p>
          </div>
          <Button size="sm" variant="outline" onClick={() => void reload()} disabled={loading || saving}>
            {loading ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
            Refresh
          </Button>
        </div>

        <div className="mt-3 grid grid-cols-4 gap-2">
          <Metric label="Budget" value={preview?.tokenBudget ?? tokenBudget} icon={<FileText className="size-3.5" />} />
          <Metric label="Used" value={preview?.tokenUsed ?? '-'} icon={<CheckCircle2 className="size-3.5" />} />
          <Metric label="Truncated" value={statusCounts.truncated} icon={<Scissors className="size-3.5" />} />
          <Metric label="Omitted" value={statusCounts.omitted} icon={<XCircle className="size-3.5" />} />
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
            <div className="border-b p-3">
              <h3 className="text-sm font-semibold">Preview Context Pack</h3>
              <p className="text-xs text-muted-foreground">Use a dry-run packer before an Agent run spends model context.</p>
            </div>
            <div className="space-y-3 p-3">
              <div className="grid grid-cols-2 gap-2">
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
                <label className="space-y-1 text-xs font-medium">
                  Token Budget
                  <Input value={tokenBudget} onChange={(event) => setTokenBudget(event.target.value)} className="h-9 text-xs" />
                </label>
                <label className="space-y-1 text-xs font-medium">
                  Memory Limit
                  <Input value={memoryLimit} onChange={(event) => setMemoryLimit(event.target.value)} className="h-9 text-xs" />
                </label>
                <div className="space-y-1 text-xs font-medium">
                  Template
                  <div className="flex h-9 items-center rounded-md border px-2 text-xs text-muted-foreground">
                    {preview?.promptTemplate?.name ?? 'Agent fallback prompt'}
                  </div>
                </div>
              </div>

              {selectedAgent && (
                <div className="rounded-md border bg-muted/30 p-3">
                  <div className="flex items-center gap-2">
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

              <label className="space-y-1 text-xs font-medium">
                Goal
                <Textarea value={goal} onChange={(event) => setGoal(event.target.value)} rows={3} className="text-xs" />
              </label>
              <label className="space-y-1 text-xs font-medium">
                Input JSON
                <Textarea value={inputText} onChange={(event) => setInputText(event.target.value)} rows={4} className="font-mono text-xs" />
              </label>
              <Button size="sm" onClick={() => void handlePreview()} disabled={saving || loading || !selectedAgentId}>
                {saving ? <Loader2 className="size-3.5 animate-spin" /> : <BrainCircuit className="size-3.5" />}
                Preview Context
              </Button>
            </div>
          </section>

          <section className="rounded-lg border bg-background">
            <div className="border-b p-3">
              <h3 className="text-sm font-semibold">Packed Sections</h3>
              <p className="text-xs text-muted-foreground">Each section explains why it was included, truncated, or omitted.</p>
            </div>
            <div className="grid gap-2 p-3">
              {preview?.sections.map((section) => (
                <ContextSectionItem key={section.id} section={section} />
              ))}
              {!preview && (
                <div className="rounded-md border border-dashed px-3 py-8 text-center">
                  <div className="text-xs font-semibold">No context preview yet</div>
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    Run Preview Context to see budget fit, truncation, and omitted sections.
                  </p>
                </div>
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

function ContextSectionItem({ section }: { section: PackedContextSectionDto }) {
  return (
    <div className="rounded-md border px-3 py-2">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="truncate text-xs font-semibold">{section.title}</span>
            <Badge variant="outline" className="text-[10px]">
              {section.kind}
            </Badge>
          </div>
          <p className="mt-1 line-clamp-2 text-[11px] text-muted-foreground">{section.reason}</p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <Badge variant={statusVariant(section.status)} className="text-[10px]">
            {section.status}
          </Badge>
          <span className="text-[10px] text-muted-foreground">
            {section.tokenUsed}/{section.tokenEstimate}
          </span>
        </div>
      </div>
      {section.content && (
        <pre className="mt-2 max-h-28 overflow-auto rounded-md bg-muted/40 p-2 text-[10px] leading-relaxed text-muted-foreground">
          {section.content}
        </pre>
      )}
    </div>
  )
}

function statusVariant(status: PackedContextSectionDto['status']) {
  if (status === 'included') return 'default'
  if (status === 'truncated') return 'secondary'
  return 'destructive'
}

function parseOptionalInt(value: string): number | null {
  const trimmed = value.trim()
  if (!trimmed) return null
  const parsed = Number.parseInt(trimmed, 10)
  if (!Number.isFinite(parsed) || parsed <= 0) throw new Error(`${value} is not a positive integer.`)
  return parsed
}

function parseJsonObject(value: string) {
  const parsed: unknown = JSON.parse(value)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Input JSON must be an object.')
  }
  return parsed as Record<string, unknown>
}
