'use client'

import {
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Code2,
  ExternalLink,
  Loader2,
  Package,
  Power,
  RefreshCw,
  Search,
  Settings2,
  UploadCloud,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Textarea } from '@/components/ui/textarea'
import type {
  SkillInstallFlowRow,
  SkillMarketplacePublicationRow,
  SkillRow,
  SkillSdkManifestRow,
  SkillSource,
} from '@/db/schema'
import {
  fetchSkillsCenterData,
  installSkill,
  publishSkillSdkManifest,
  scaffoldSkillSdkProject,
  searchSkillsMpCli,
  setSkillEnabled,
  type SkillsCenterData,
  type SkillsMpCliSearchResult,
  type SkillsMpCliSkillResult,
} from '@/lib/api'
import { cn } from '@/lib/utils'

interface InstallDraft {
  source: SkillSource
  url: string
  name: string
  description: string
}

interface SdkDraft {
  name: string
  version: string
  capabilities: string
  pythonPackages: string
  nodePackages: string
  systemTools: string
  permissions: string
}

type VisibleSkillRow = SkillRow & { duplicateCount: number }

const emptyData: SkillsCenterData = {
  skills: [],
  installFlows: [],
  sdkManifests: [],
  marketplacePublications: [],
  marketplaceUrl: 'about:blank',
}

const quickSkillQueries = ['代码审查', '浏览器自动化', '视频剪辑', '运营文案', '数据分析', '文件处理']

export function SkillsCenter() {
  const [data, setData] = useState<SkillsCenterData>(emptyData)
  const [draft, setDraft] = useState<InstallDraft>({
    source: 'skillsmp',
    url: '',
    name: '',
    description: '',
  })
  const [sdkDraft, setSdkDraft] = useState<SdkDraft>({
    name: 'code-review-plus',
    version: '0.1.0',
    capabilities: 'code_review, risk_analysis',
    pythonPackages: '',
    nodePackages: 'typescript, vitest',
    systemTools: 'git',
    permissions: 'read_files, run_tests',
  })
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [installedQuery, setInstalledQuery] = useState('')
  const [manualInstallOpen, setManualInstallOpen] = useState(false)
  const [developerToolsOpen, setDeveloperToolsOpen] = useState(false)
  const [marketplaceQuery, setMarketplaceQuery] = useState('code review')
  const [marketplaceSort, setMarketplaceSort] = useState<'recent' | 'stars'>('recent')
  const [marketplaceLoading, setMarketplaceLoading] = useState(false)
  const [marketplaceError, setMarketplaceError] = useState<string | null>(null)
  const [marketplaceResult, setMarketplaceResult] = useState<SkillsMpCliSearchResult | null>(null)

  const reload = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      setData(await fetchSkillsCenterData())
    } catch (err) {
      setError(formatError(err))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void reload()
  }, [reload])

  const visibleSkills = useMemo(() => dedupeSkills(data.skills), [data.skills])

  const filteredSkills = useMemo(() => {
    const query = installedQuery.trim().toLowerCase()
    if (!query) return visibleSkills
    return visibleSkills.filter((skill) =>
      [skill.name, skill.description, skill.source, skill.status].some((value) =>
        String(value ?? '').toLowerCase().includes(query),
      ),
    )
  }, [visibleSkills, installedQuery])

  const installedSkillNames = useMemo(
    () => new Set(data.skills.map((skill) => skill.name.toLowerCase())),
    [data.skills],
  )

  const enabledCount = visibleSkills.filter((skill) => skill.enabled).length
  const duplicateSkillCount = Math.max(0, data.skills.length - visibleSkills.length)
  const marketplaceCount = marketplaceResult?.total ?? 0

  const submitInstall = async () => {
    setSaving('install')
    setError(null)
    setNotice(null)
    try {
      await installSkill({
        source: draft.source,
        url: draft.url,
        name: draft.name || undefined,
        description: draft.description || undefined,
        manifest: {},
      })
      setDraft((current) => ({ ...current, url: '', name: '', description: '' }))
      setManualInstallOpen(false)
      setNotice('技能已安装')
      await reload()
    } catch (err) {
      setError(formatError(err))
    } finally {
      setSaving(null)
    }
  }

  const toggleSkill = async (skill: SkillRow) => {
    setSaving(skill.id)
    setError(null)
    setNotice(null)
    try {
      await setSkillEnabled(skill.id, !skill.enabled)
      setNotice(skill.enabled ? '技能已停用' : '技能已启用')
      await reload()
    } catch (err) {
      setError(formatError(err))
    } finally {
      setSaving(null)
    }
  }

  const scaffoldSdk = async () => {
    setSaving('sdk-scaffold')
    setError(null)
    setNotice(null)
    try {
      const result = await scaffoldSkillSdkProject({
        name: sdkDraft.name,
        version: sdkDraft.version,
        capabilities: parseList(sdkDraft.capabilities),
        dependencies: {
          python_packages: parseList(sdkDraft.pythonPackages),
          node_packages: parseList(sdkDraft.nodePackages),
          system_tools: parseList(sdkDraft.systemTools),
        },
        permissions: parseList(sdkDraft.permissions),
      })
      setNotice(`技能 SDK 已创建，共 ${Object.keys(result.files).length} 个文件`)
      await reload()
    } catch (err) {
      setError(formatError(err))
    } finally {
      setSaving(null)
    }
  }

  const publishManifest = async (manifest: SkillSdkManifestRow) => {
    setSaving(manifest.id)
    setError(null)
    setNotice(null)
    try {
      await publishSkillSdkManifest(manifest.id, data.marketplaceUrl)
      setNotice('市场发布记录已保存')
      await reload()
    } catch (err) {
      setError(formatError(err))
    } finally {
      setSaving(null)
    }
  }

  const searchMarketplace = async (queryOverride?: string) => {
    const query = (queryOverride ?? marketplaceQuery).trim()
    if (!query) {
      setMarketplaceError('请输入要搜索的技能关键词')
      return
    }
    setMarketplaceLoading(true)
    setMarketplaceError(null)
    setNotice(null)
    try {
      setMarketplaceResult(
        await searchSkillsMpCli({
          query,
          limit: 12,
          sortBy: marketplaceSort,
        }),
      )
    } catch (err) {
      setMarketplaceError(formatError(err))
    } finally {
      setMarketplaceLoading(false)
    }
  }

  const installMarketplaceSkill = async (skill: SkillsMpCliSkillResult) => {
    const url = skill.sourceUrl ?? skill.skillUrl ?? data.marketplaceUrl
    setSaving(`marketplace:${skill.id}`)
    setError(null)
    setNotice(null)
    try {
      await installSkill({
        source: 'skillsmp',
        url,
        name: skill.name,
        description: skill.description,
        manifest: skill.manifest,
      })
      setNotice(`已安装技能：${skill.name}`)
      await reload()
    } catch (err) {
      setError(formatError(err))
    } finally {
      setSaving(null)
    }
  }

  const quickSearch = (query: string) => {
    setMarketplaceQuery(query)
    void searchMarketplace(query)
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="shrink-0 border-b bg-background px-4 py-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-base font-semibold">
              <Package className="size-4 text-primary" />
              <span className="truncate">技能中心</span>
            </div>
            <div className="mt-2 grid grid-cols-4 gap-2 text-[11px] text-muted-foreground">
              <Metric label="已安装" value={visibleSkills.length} />
              <Metric label="已启用" value={enabledCount} />
              <Metric label="市场结果" value={marketplaceCount} />
              <Metric label="SDK" value={data.sdkManifests.length} />
            </div>
          </div>
          <div className="flex items-center gap-2">
            {(error || notice) && (
              <div
                className={cn(
                  'max-w-md rounded-lg border px-3 py-2 text-xs',
                  error
                    ? 'border-destructive/30 bg-destructive/10 text-destructive'
                    : 'border-emerald-500/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
                )}
              >
                {error ?? notice}
              </div>
            )}
            <Button size="icon" variant="ghost" onClick={() => void reload()} disabled={loading} title="刷新">
              <RefreshCw className={cn('size-4', loading && 'animate-spin')} />
            </Button>
          </div>
        </div>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-[minmax(20rem,24rem)_minmax(0,1fr)]">
        <aside className="min-h-0 border-r bg-muted/10">
          <ScrollArea className="h-full">
            <div className="space-y-3 p-3">
              <section className="rounded-lg border bg-background">
                <div className="flex items-center justify-between gap-2 border-b px-3 py-2.5">
                  <div className="min-w-0">
                    <div className="text-sm font-semibold">我的技能</div>
                    <div className="mt-0.5 text-[11px] text-muted-foreground">
                      {enabledCount}/{visibleSkills.length} 已启用
                      {duplicateSkillCount > 0 && (
                        <span className="ml-1">已合并 {duplicateSkillCount} 条重复记录</span>
                      )}
                    </div>
                  </div>
                  <Button
                    className="h-8 gap-1"
                    variant="outline"
                    onClick={() => setManualInstallOpen((current) => !current)}
                  >
                    <Settings2 className="size-3.5" />
                    手动安装
                  </Button>
                </div>
                <div className="space-y-2 p-3">
                  <div className="relative">
                    <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      className="h-9 pl-8"
                      value={installedQuery}
                      onChange={(event) => setInstalledQuery(event.target.value)}
                      placeholder="搜索已安装技能"
                    />
                  </div>
                  <SkillList skills={filteredSkills} saving={saving} onToggle={toggleSkill} />
                </div>
              </section>

              {manualInstallOpen && (
                <section className="rounded-lg border bg-background">
                  <div className="border-b px-3 py-2 text-sm font-semibold">手动安装</div>
                  <div className="space-y-2 p-3">
                    <Select
                      value={draft.source}
                      onChange={(value) => setDraft((current) => ({ ...current, source: value as SkillSource }))}
                      options={[
                        { label: 'SkillsMP', value: 'skillsmp' },
                        { label: 'GitHub', value: 'github' },
                        { label: '本地目录', value: 'local' },
                      ]}
                    />
                    <Input
                      value={draft.url}
                      onChange={(event) => setDraft((current) => ({ ...current, url: event.target.value }))}
                      placeholder="技能地址"
                    />
                    <Input
                      value={draft.name}
                      onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))}
                      placeholder="名称，可选"
                    />
                    <Textarea
                      className="min-h-16 text-xs"
                      value={draft.description}
                      onChange={(event) =>
                        setDraft((current) => ({ ...current, description: event.target.value }))
                      }
                      placeholder="描述，可选"
                    />
                    <Button
                      className="h-9 w-full gap-1"
                      onClick={() => void submitInstall()}
                      disabled={saving !== null || !draft.url.trim()}
                    >
                      {saving === 'install' ? (
                        <Loader2 className="size-3.5 animate-spin" />
                      ) : (
                        <CheckCircle2 className="size-3.5" />
                      )}
                      安装技能
                    </Button>
                  </div>
                </section>
              )}

              <section className="rounded-lg border bg-background">
                <div className="border-b px-3 py-2 text-sm font-semibold">最近安装</div>
                <div className="p-3">
                  <InstallFlowList flows={data.installFlows} />
                </div>
              </section>
            </div>
          </ScrollArea>
        </aside>

        <main className="flex min-w-0 flex-col">
          <div className="shrink-0 border-b bg-background p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <div className="text-base font-semibold">SkillsMP 技能市场</div>
                  <Badge variant="outline" className="shrink-0">
                    SkillsMP CLI
                  </Badge>
                </div>
                <div className="mt-1 text-xs text-muted-foreground">搜索、安装、分配给智能体</div>
              </div>
            </div>

            <div className="mt-4 grid grid-cols-[minmax(0,1fr)_8rem_6rem] gap-2">
              <div className="relative min-w-0">
                <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  className="h-10 pl-9"
                  value={marketplaceQuery}
                  onChange={(event) => setMarketplaceQuery(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') void searchMarketplace()
                  }}
                  placeholder="搜索技能，比如：写代码、运营、浏览器、视频"
                />
              </div>
              <select
                value={marketplaceSort}
                onChange={(event) => setMarketplaceSort(event.target.value as 'recent' | 'stars')}
                className="h-10 rounded-lg border border-input bg-background px-3 text-sm outline-none transition focus:border-ring focus:ring-2 focus:ring-ring/30"
              >
                <option value="recent">最新</option>
                <option value="stars">最热门</option>
              </select>
              <Button className="h-10 gap-1" onClick={() => void searchMarketplace()} disabled={marketplaceLoading}>
                {marketplaceLoading ? <Loader2 className="size-4 animate-spin" /> : <Search className="size-4" />}
                搜索
              </Button>
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-2">
              <span className="text-[11px] text-muted-foreground">热门搜索</span>
              {quickSkillQueries.map((query) => (
                <Button
                  key={query}
                  className="h-7 rounded-full px-3 text-xs"
                  variant="outline"
                  onClick={() => quickSearch(query)}
                  disabled={marketplaceLoading}
                >
                  {query}
                </Button>
              ))}
            </div>

            {(marketplaceError || marketplaceResult) && (
              <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                {marketplaceError ? (
                  <span className="rounded-lg border border-destructive/30 bg-destructive/10 px-2 py-1 text-destructive">
                    {marketplaceError}
                  </span>
                ) : (
                  <>
                    <span className="rounded-lg border bg-muted/40 px-2 py-1">
                      来源：{marketplaceResult?.source === 'fixture' ? '本地测试数据' : 'SkillsMP 官方 API'}
                    </span>
                    <span className="rounded-lg border bg-muted/40 px-2 py-1">结果：{marketplaceResult?.total ?? 0}</span>
                    {marketplaceResult?.rateLimit?.dailyRemaining && (
                      <span className="rounded-lg border bg-muted/40 px-2 py-1">
                        今日剩余额度：{marketplaceResult.rateLimit.dailyRemaining}
                      </span>
                    )}
                  </>
                )}
              </div>
            )}
          </div>

          <ScrollArea className="min-h-0 flex-1 bg-muted/10">
            <SkillsMpResultList
              result={marketplaceResult}
              loading={marketplaceLoading}
              saving={saving}
              fallbackUrl={data.marketplaceUrl}
              installedSkillNames={installedSkillNames}
              onInstall={installMarketplaceSkill}
            />
          </ScrollArea>

          <div className="shrink-0 border-t bg-background">
            <button
              type="button"
              className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left text-sm font-semibold transition hover:bg-muted/40"
              onClick={() => setDeveloperToolsOpen((current) => !current)}
            >
              <span className="flex items-center gap-2">
                {developerToolsOpen ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
                高级：创建和发布技能
              </span>
              <span className="text-xs font-normal text-muted-foreground">
                {data.sdkManifests.length} 个 SDK / {data.marketplacePublications.length} 条发布
              </span>
            </button>
            {developerToolsOpen && (
              <div className="grid max-h-80 grid-cols-[minmax(20rem,24rem)_minmax(0,1fr)_minmax(0,1fr)] overflow-hidden border-t">
                <ScrollArea className="min-h-0 border-r">
                  <SdkCreateForm
                    draft={sdkDraft}
                    saving={saving}
                    onDraftChange={setSdkDraft}
                    onScaffold={scaffoldSdk}
                  />
                </ScrollArea>
                <ScrollArea className="min-h-0 border-r">
                  <SdkManifestList manifests={data.sdkManifests} saving={saving} onPublish={publishManifest} />
                </ScrollArea>
                <ScrollArea className="min-h-0">
                  <MarketplacePublicationList publications={data.marketplacePublications} />
                </ScrollArea>
              </div>
            )}
          </div>
        </main>
      </div>
    </div>
  )
}

function SkillsMpResultList({
  result,
  loading,
  saving,
  fallbackUrl,
  installedSkillNames,
  onInstall,
}: {
  result: SkillsMpCliSearchResult | null
  loading: boolean
  saving: string | null
  fallbackUrl: string
  installedSkillNames: Set<string>
  onInstall: (skill: SkillsMpCliSkillResult) => Promise<void>
}) {
  if (loading && !result) {
    return (
      <div className="grid min-h-72 place-items-center p-6 text-sm text-muted-foreground">
        <div className="flex items-center gap-2">
          <Loader2 className="size-4 animate-spin" />
          正在搜索技能
        </div>
      </div>
    )
  }
  if (!result || result.items.length === 0) {
    return (
      <div className="grid min-h-72 place-items-center p-6">
        <EmptyLine text="输入关键词后点击搜索，就能从 SkillsMP 查找可安装技能" />
      </div>
    )
  }
  return (
    <div className="grid gap-3 p-4 xl:grid-cols-2 2xl:grid-cols-3">
      {result.items.map((skill) => {
        const url = skill.sourceUrl ?? skill.skillUrl ?? fallbackUrl
        const installed = installedSkillNames.has(skill.name.toLowerCase())
        return (
          <article key={`${skill.id}-${url}`} className="flex min-h-48 flex-col rounded-lg border bg-background p-3 text-sm">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="truncate font-semibold">{skill.name}</div>
                <div className="mt-1 line-clamp-2 min-h-10 text-xs text-muted-foreground">
                  {skill.description || '这个技能暂时没有描述。'}
                </div>
              </div>
              <Badge variant={installed ? 'default' : 'outline'} className="shrink-0">
                {installed ? '已安装' : skill.category ?? skill.occupation ?? '技能'}
              </Badge>
            </div>

            <div className="mt-3 flex min-h-7 flex-wrap gap-1.5">
              {skill.tags.slice(0, 4).map((tag) => (
                <span key={tag} className="rounded-full bg-muted px-2 py-1 text-[11px] text-muted-foreground">
                  {tag}
                </span>
              ))}
              {skill.repository && (
                <span className="max-w-full truncate rounded-full bg-muted px-2 py-1 font-mono text-[11px] text-muted-foreground">
                  {skill.repository}
                </span>
              )}
            </div>

            <div className="mt-auto flex items-center justify-between gap-2 pt-4">
              <div className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
                <span>{formatSkillMetric(skill.stars, '收藏')}</span>
                <span>{formatSkillMetric(skill.downloads, '使用')}</span>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                {url && (
                  <a
                    href={url}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex size-9 items-center justify-center rounded-lg border transition hover:bg-muted"
                    title="打开来源"
                  >
                    <ExternalLink className="size-4" />
                  </a>
                )}
                <Button
                  className="h-9 gap-1"
                  variant={installed ? 'outline' : 'default'}
                  onClick={() => void onInstall(skill)}
                  disabled={saving !== null || installed}
                >
                  {saving === `marketplace:${skill.id}` ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    <CheckCircle2 className="size-3.5" />
                  )}
                  {installed ? '已安装' : '安装'}
                </Button>
              </div>
            </div>
          </article>
        )
      })}
    </div>
  )
}

function SkillList({
  skills,
  saving,
  onToggle,
}: {
  skills: VisibleSkillRow[]
  saving: string | null
  onToggle: (skill: SkillRow) => Promise<void>
}) {
  if (skills.length === 0) return <EmptyLine text="暂无匹配技能" />
  return (
    <div className="space-y-2">
      {skills.map((skill) => (
        <article key={skill.id} className="rounded-lg border bg-background px-3 py-2 text-xs">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="truncate text-sm font-medium">{skill.name}</div>
              <div className="mt-1 line-clamp-2 min-h-8 text-muted-foreground">
                {skill.description || '暂无描述'}
              </div>
            </div>
            <Button
              variant={skill.enabled ? 'outline' : 'default'}
              className="h-8 shrink-0 gap-1 px-2"
              disabled={saving !== null}
              onClick={() => void onToggle(skill)}
            >
              {saving === skill.id ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Power className={cn('size-3.5', skill.enabled && 'text-emerald-600')} />
              )}
              {skill.enabled ? '停用' : '启用'}
            </Button>
          </div>
          <div className="mt-2 flex items-center justify-between gap-2">
            <Badge variant={skill.enabled ? 'default' : 'outline'} className="h-5 px-1.5 text-[10px]">
              {skillStatusLabel(skill.status)}
            </Badge>
            <span className="truncate font-mono text-[10px] text-muted-foreground">{skill.source}</span>
          </div>
          {skill.duplicateCount > 1 && (
            <div className="mt-2 rounded-md bg-muted px-2 py-1 text-[10px] text-muted-foreground">
              已把 {skill.duplicateCount} 条同名测试记录合并显示
            </div>
          )}
        </article>
      ))}
    </div>
  )
}

function InstallFlowList({ flows }: { flows: SkillInstallFlowRow[] }) {
  if (flows.length === 0) return <EmptyLine text="暂无安装记录" />
  return (
    <div className="space-y-2">
      {flows.slice(0, 6).map((flow) => (
        <div key={flow.id} className="rounded-lg border px-3 py-2 text-xs">
          <div className="flex items-center justify-between gap-2">
            <span className="min-w-0 truncate">{flow.url || '本地安装'}</span>
            <Badge variant={flow.status === 'failed' ? 'destructive' : 'outline'} className="h-5 px-1.5 text-[10px]">
              {skillStatusLabel(flow.status)}
            </Badge>
          </div>
          <div className="mt-1 truncate font-mono text-[10px] text-muted-foreground">{flow.installPath}</div>
        </div>
      ))}
    </div>
  )
}

function SdkCreateForm({
  draft,
  saving,
  onDraftChange,
  onScaffold,
}: {
  draft: SdkDraft
  saving: string | null
  onDraftChange: (draft: SdkDraft) => void
  onScaffold: () => Promise<void>
}) {
  return (
    <div className="space-y-2 p-3">
      <div className="text-sm font-semibold">创建 SDK</div>
      <Input
        value={draft.name}
        onChange={(event) => onDraftChange({ ...draft, name: event.target.value })}
        placeholder="技能名称"
      />
      <Input
        value={draft.version}
        onChange={(event) => onDraftChange({ ...draft, version: event.target.value })}
        placeholder="版本"
      />
      <Textarea
        className="min-h-14 text-xs"
        value={draft.capabilities}
        onChange={(event) => onDraftChange({ ...draft, capabilities: event.target.value })}
        placeholder="能力"
      />
      <Input
        value={draft.nodePackages}
        onChange={(event) => onDraftChange({ ...draft, nodePackages: event.target.value })}
        placeholder="Node 依赖"
      />
      <Input
        value={draft.pythonPackages}
        onChange={(event) => onDraftChange({ ...draft, pythonPackages: event.target.value })}
        placeholder="Python 依赖"
      />
      <Input
        value={draft.systemTools}
        onChange={(event) => onDraftChange({ ...draft, systemTools: event.target.value })}
        placeholder="系统工具"
      />
      <Input
        value={draft.permissions}
        onChange={(event) => onDraftChange({ ...draft, permissions: event.target.value })}
        placeholder="权限"
      />
      <Button
        className="h-9 w-full gap-1"
        onClick={() => void onScaffold()}
        disabled={saving !== null || !draft.name.trim() || parseList(draft.capabilities).length === 0}
      >
        {saving === 'sdk-scaffold' ? <Loader2 className="size-3.5 animate-spin" /> : <Code2 className="size-3.5" />}
        创建 SDK
      </Button>
    </div>
  )
}

function SdkManifestList({
  manifests,
  saving,
  onPublish,
}: {
  manifests: SkillSdkManifestRow[]
  saving: string | null
  onPublish: (manifest: SkillSdkManifestRow) => Promise<void>
}) {
  return (
    <div className="space-y-2 p-3">
      <div className="text-sm font-semibold">SDK 清单</div>
      {manifests.length === 0 ? (
        <EmptyLine text="暂无 SDK 清单" />
      ) : (
        manifests.slice(0, 8).map((manifest) => (
          <div key={manifest.id} className="rounded-lg border px-3 py-2 text-xs">
            <div className="flex items-center justify-between gap-2">
              <span className="min-w-0 truncate font-medium">{manifest.name}</span>
              <Badge
                variant={manifest.validationStatus === 'valid' ? 'default' : 'destructive'}
                className="h-5 px-1.5 text-[10px]"
              >
                {skillStatusLabel(manifest.validationStatus)}
              </Badge>
            </div>
            <div className="mt-1 truncate font-mono text-[10px] text-muted-foreground">
              v{manifest.version} / {manifest.scaffoldFiles.length} 个文件
            </div>
            <div className="mt-1 line-clamp-2 text-muted-foreground">{manifest.capabilities.join(', ')}</div>
            <Button
              className="mt-2 h-8 w-full gap-1"
              variant="outline"
              onClick={() => void onPublish(manifest)}
              disabled={saving !== null || manifest.validationStatus !== 'valid'}
            >
              {saving === manifest.id ? <Loader2 className="size-3 animate-spin" /> : <UploadCloud className="size-3" />}
              发布
            </Button>
          </div>
        ))
      )}
    </div>
  )
}

function MarketplacePublicationList({ publications }: { publications: SkillMarketplacePublicationRow[] }) {
  return (
    <div className="space-y-2 p-3">
      <div className="text-sm font-semibold">发布记录</div>
      {publications.length === 0 ? (
        <EmptyLine text="暂无发布记录" />
      ) : (
        publications.slice(0, 8).map((publication) => (
          <div key={publication.id} className="rounded-lg border px-3 py-2 text-xs">
            <div className="flex items-center justify-between gap-2">
              <span className="min-w-0 truncate font-medium">{publication.packageName}</span>
              <Badge className="h-5 px-1.5 text-[10px]">{skillStatusLabel(publication.status)}</Badge>
            </div>
            <div className="mt-1 truncate font-mono text-[10px] text-muted-foreground">
              v{publication.packageVersion}
            </div>
            <div className="mt-1 truncate text-muted-foreground">{publication.marketplaceUrl}</div>
          </div>
        ))
      )}
    </div>
  )
}

function Select({
  value,
  options,
  onChange,
}: {
  value: string
  options: Array<{ label: string; value: string }>
  onChange: (value: string) => void
}) {
  return (
    <select
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className="h-9 w-full rounded-lg border border-input bg-background px-2 text-sm outline-none transition focus:border-ring focus:ring-2 focus:ring-ring/30"
    >
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  )
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="min-w-16 rounded-lg border bg-muted/30 px-2.5 py-1.5">
      <div className="font-mono text-sm text-foreground">{value}</div>
      <div className="truncate">{label}</div>
    </div>
  )
}

function EmptyLine({ text }: { text: string }) {
  return (
    <div className="w-full rounded-lg border border-dashed bg-muted/20 px-4 py-5 text-center text-xs text-muted-foreground">
      {text}
    </div>
  )
}

function skillStatusLabel(status: string): string {
  const map: Record<string, string> = {
    installed: '已安装',
    pending: '等待中',
    failed: '失败',
    valid: '有效',
    invalid: '无效',
    published: '已发布',
    draft: '草稿',
    disabled: '已禁用',
    enabled: '已启用',
  }
  return map[status] ?? status
}

function formatSkillMetric(value: number | null, label: string): string {
  if (typeof value !== 'number') return `0 ${label}`
  if (value >= 10_000) return `${(value / 10_000).toFixed(1)}万 ${label}`
  if (value >= 1000) return `${(value / 1000).toFixed(1)}k ${label}`
  return `${value} ${label}`
}

function formatError(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

function parseList(value: string): string[] {
  return value
    .split(/[\n,]/)
    .map((item) => item.trim())
    .filter(Boolean)
}

function dedupeSkills(skills: SkillRow[]): VisibleSkillRow[] {
  const groups = new Map<string, VisibleSkillRow>()
  for (const skill of skills) {
    const key = [
      skill.name.trim().toLowerCase(),
      skill.source,
      (skill.description ?? '').trim().toLowerCase(),
    ].join('::')
    const existing = groups.get(key)
    if (!existing) {
      groups.set(key, { ...skill, duplicateCount: 1 })
      continue
    }

    const duplicateCount = existing.duplicateCount + 1
    const preferred = !existing.enabled && skill.enabled ? skill : existing
    groups.set(key, { ...preferred, duplicateCount })
  }
  return Array.from(groups.values())
}
