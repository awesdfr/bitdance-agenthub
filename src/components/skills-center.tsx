'use client'

import {
  Bot,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Code2,
  DownloadCloud,
  ExternalLink,
  Loader2,
  Package,
  Power,
  RefreshCw,
  Settings2,
  Sparkles,
  UploadCloud,
  UserCheck,
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
  setSkillEnabled,
  type SkillsCenterData,
  type SkillsMpCliSkillResult,
} from '@/lib/api'
import { emitUiCommand } from '@/lib/ui-command-events'
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

const skillUseSteps = [
  {
    title: '选择推荐技能',
    detail: '从推荐技能里选择一个适合当前智能体岗位的能力。',
  },
  {
    title: '安装到本地',
    detail: '安装后会进入我的技能，可以随时启用或停用。',
  },
  {
    title: '分配给智能体',
    detail: '打开智能体设置，把技能加入员工工具包。',
  },
]

const featuredMarketplaceSkills: SkillsMpCliSkillResult[] = [
  {
    id: 'featured-code-review',
    name: 'code-review-plus',
    description: '代码审查、风险提示、测试建议，适合给开发智能体当基础技能。',
    repository: 'skillsmp/code-review-plus',
    creator: 'SkillsMP',
    sourceUrl: 'https://skillsmp.com/skills/code-review-plus',
    skillUrl: 'https://skillsmp.com/skills/code-review-plus',
    stars: 1260,
    downloads: 18400,
    category: '代码开发',
    occupation: '开发员工',
    updatedAt: '推荐',
    tags: ['代码审查', '测试建议', '风险分析'],
    manifest: { name: 'code-review-plus', capabilities: ['code_review', 'risk_analysis'] },
  },
  {
    id: 'featured-browser-automation',
    name: 'browser-research-plus',
    description: '网页检索、页面总结、资料归档，适合研究、运营和资料收集智能体。',
    repository: 'skillsmp/browser-research-plus',
    creator: 'SkillsMP',
    sourceUrl: 'https://skillsmp.com/skills/browser-research-plus',
    skillUrl: 'https://skillsmp.com/skills/browser-research-plus',
    stars: 980,
    downloads: 15100,
    category: '浏览器网页',
    occupation: '研究员工',
    updatedAt: '推荐',
    tags: ['浏览器自动化', '资料收集', '网页总结'],
    manifest: { name: 'browser-research-plus', capabilities: ['web_research', 'source_summary'] },
  },
  {
    id: 'featured-video-editor',
    name: 'video-editing-operator',
    description: '整理素材、生成剪辑步骤、输出交付检查，适合视频制作类智能体。',
    repository: 'skillsmp/video-editing-operator',
    creator: 'SkillsMP',
    sourceUrl: 'https://skillsmp.com/skills/video-editing-operator',
    skillUrl: 'https://skillsmp.com/skills/video-editing-operator',
    stars: 760,
    downloads: 9200,
    category: '视频创作',
    occupation: '剪辑员工',
    updatedAt: '推荐',
    tags: ['视频剪辑', '素材整理', '交付检查'],
    manifest: { name: 'video-editing-operator', capabilities: ['video_editing', 'delivery_check'] },
  },
]

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
  const [manualInstallOpen, setManualInstallOpen] = useState(false)
  const [installHistoryOpen, setInstallHistoryOpen] = useState(false)
  const [developerToolsOpen, setDeveloperToolsOpen] = useState(false)
  const [selectedMarketplaceSkillId, setSelectedMarketplaceSkillId] = useState<string | null>(null)

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

  const filteredSkills = visibleSkills

  const installedSkillNames = useMemo(
    () => new Set(data.skills.map((skill) => skill.name.toLowerCase())),
    [data.skills],
  )

  const enabledCount = visibleSkills.filter((skill) => skill.enabled).length
  const duplicateSkillCount = Math.max(0, data.skills.length - visibleSkills.length)
  const marketplaceItems = featuredMarketplaceSkills
  const marketplaceCount = marketplaceItems.length
  const selectedMarketplaceSkill = useMemo(() => {
    return (
      marketplaceItems.find((skill) => skill.id === selectedMarketplaceSkillId) ??
      marketplaceItems[0] ??
      null
    )
  }, [marketplaceItems, selectedMarketplaceSkillId])
  const selectedMarketplaceSkillInstalled = selectedMarketplaceSkill
    ? installedSkillNames.has(selectedMarketplaceSkill.name.toLowerCase())
    : false

  useEffect(() => {
    setSelectedMarketplaceSkillId((current) => {
      if (current && marketplaceItems.some((skill) => skill.id === current)) return current
      return marketplaceItems[0]?.id ?? null
    })
  }, [marketplaceItems])

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
              <Metric label="开发包" value={data.sdkManifests.length} />
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
                  <div
                    className="rounded-md border bg-primary/5 px-2.5 py-2 text-xs leading-5 text-muted-foreground"
                    data-testid="installed-skills-agent-hint"
                  >
                    已安装技能会出现在智能体设置里，给某个员工勾选后才会进入它的工具包。
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
                <button
                  type="button"
                  className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm font-semibold transition hover:bg-muted/40"
                  onClick={() => setInstallHistoryOpen((current) => !current)}
                >
                  <span className="flex min-w-0 items-center gap-2">
                    {installHistoryOpen ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
                    <span className="truncate">安装记录</span>
                  </span>
                  <Badge variant="outline" className="shrink-0">
                    {data.installFlows.length}
                  </Badge>
                </button>
                {installHistoryOpen && (
                  <div className="border-t p-3">
                    <InstallFlowList flows={data.installFlows} />
                  </div>
                )}
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
                <div className="mt-1 text-xs text-muted-foreground">推荐、安装、分配给智能体</div>
              </div>
            </div>

            <SkillInstallAssistant
              selectedSkill={selectedMarketplaceSkill}
              installed={selectedMarketplaceSkillInstalled}
              installedCount={visibleSkills.length}
              enabledCount={enabledCount}
            />

            <SkillUsePath
              selectedSkill={selectedMarketplaceSkill}
              installed={selectedMarketplaceSkillInstalled}
              saving={saving}
              onInstall={installMarketplaceSkill}
            />

          </div>

          <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_minmax(18rem,22rem)]">
            <ScrollArea className="min-h-0 bg-muted/10">
              <SkillsMpResultList
                items={marketplaceItems}
                saving={saving}
                fallbackUrl={data.marketplaceUrl}
                installedSkillNames={installedSkillNames}
                selectedSkillId={selectedMarketplaceSkillId}
                onSelect={setSelectedMarketplaceSkillId}
                onInstall={installMarketplaceSkill}
              />
            </ScrollArea>
            <aside className="min-h-0 border-l bg-background">
              <ScrollArea className="h-full">
                <SkillDetailPanel
                  skill={selectedMarketplaceSkill}
                  saving={saving}
                  installed={selectedMarketplaceSkillInstalled}
                  fallbackUrl={data.marketplaceUrl}
                  onInstall={installMarketplaceSkill}
                />
              </ScrollArea>
            </aside>
          </div>

          <div className="shrink-0 border-t bg-background">
            <button
              type="button"
              className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left text-sm font-semibold transition hover:bg-muted/40"
              onClick={() => setDeveloperToolsOpen((current) => !current)}
            >
              <span className="flex items-center gap-2">
                {developerToolsOpen ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
                开发者工具：创建和发布技能
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

function SkillInstallAssistant({
  selectedSkill,
  installed,
  installedCount,
  enabledCount,
}: {
  selectedSkill: SkillsMpCliSkillResult | null
  installed: boolean
  installedCount: number
  enabledCount: number
}) {
  const fit = selectedSkill ? inferSkillAgentFit(selectedSkill) : null
  return (
    <section
      data-testid="skills-install-assistant"
      className="mt-4 rounded-lg border bg-primary/5 p-3"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <Sparkles className="size-4 text-primary" />
            技能安装助手
          </div>
          <div className="mt-1 text-xs leading-5 text-muted-foreground">
            选择一个推荐技能，安装以后回到智能体设置里勾选即可。
          </div>
        </div>
        <div className="grid grid-cols-2 gap-1 text-[10px] text-muted-foreground">
          <Metric label="我的技能" value={installedCount} />
          <Metric label="已启用" value={enabledCount} />
        </div>
      </div>

      <div className="mt-3">
        <div className="rounded-md border bg-background p-3">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="text-[11px] font-semibold text-muted-foreground">当前选中技能</div>
              <div className="mt-1 truncate text-sm font-semibold">
                {selectedSkill?.name ?? '先从市场里选一个技能'}
              </div>
              <div className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">
                {selectedSkill
                  ? fit?.capability
                  : '选中后这里会显示它适合哪个 Agent，以及下一步怎么分配。'}
              </div>
            </div>
            <Badge variant={installed ? 'default' : 'outline'} className="shrink-0">
              {installed ? '可分配' : '待安装'}
            </Badge>
          </div>
          <div className="mt-3 grid gap-1.5">
            <AssistantStep done={Boolean(selectedSkill)} label="选择技能" />
            <AssistantStep done={installed} label="安装到本地" />
            <AssistantStep done={installed} label="分配给智能体" />
          </div>
          <div className="mt-3 rounded-md border bg-muted/30 px-2.5 py-2 text-xs leading-5 text-muted-foreground">
            下一步：{selectedSkill ? (installed ? '打开智能体设置，把技能勾选给对应员工。' : '点击安装到本地。') : '从推荐技能里选择一个。'}
          </div>
        </div>
      </div>
    </section>
  )
}

function AssistantStep({ done, label }: { done: boolean; label: string }) {
  return (
    <div className="flex items-center justify-between gap-2 rounded-md border bg-muted/10 px-2 py-1.5 text-xs">
      <span className="truncate">{label}</span>
      <Badge variant={done ? 'default' : 'outline'} className="h-5 px-1.5 text-[9px]">
        {done ? '完成' : '待办'}
      </Badge>
    </div>
  )
}

function SkillUsePath({
  selectedSkill,
  installed,
  saving,
  onInstall,
}: {
  selectedSkill: SkillsMpCliSkillResult | null
  installed: boolean
  saving: string | null
  onInstall: (skill: SkillsMpCliSkillResult) => Promise<void>
}) {
  const fit = selectedSkill ? inferSkillAgentFit(selectedSkill) : null
  return (
    <section
      className="mt-3 rounded-lg border bg-muted/10 p-3"
      data-testid="skills-use-path"
    >
      <div
        className="rounded-md border bg-background p-3"
        data-testid="skills-market-command-bar"
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <Sparkles className="size-4 text-primary" />
              技能市场工作台
            </div>
            <div className="mt-1 text-xs text-muted-foreground">
              选技能、安装到本地，然后分配给某个智能体。
            </div>
          </div>
          <Badge variant={installed ? 'default' : 'outline'} className="shrink-0">
            {installed ? '已安装，可分配' : '未安装'}
          </Badge>
        </div>

        <div className="mt-3 grid gap-2 md:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_auto]">
          <div className="min-w-0 rounded-md border bg-muted/20 px-3 py-2">
            <div className="text-[11px] text-muted-foreground">当前技能</div>
            <div className="mt-1 truncate text-sm font-semibold">
              {selectedSkill?.name ?? '先从下面选择一个技能'}
            </div>
            <div className="mt-1 line-clamp-1 text-xs text-muted-foreground">
              {selectedSkill?.description ?? '选择后这里会显示它能帮智能体做什么。'}
            </div>
          </div>
          <div className="min-w-0 rounded-md border bg-muted/20 px-3 py-2">
            <div className="text-[11px] text-muted-foreground">推荐给</div>
            <div className="mt-1 line-clamp-1 text-sm font-semibold">
              {fit?.role ?? '智能体岗位'}
            </div>
            <div className="mt-1 line-clamp-1 text-xs text-muted-foreground">
              {fit?.capability ?? '安装后可加入智能体工具包。'}
            </div>
          </div>
          <div className="flex min-w-44 flex-col gap-2">
            <Button
              className="h-9 gap-1"
              disabled={!selectedSkill || installed || saving !== null}
              onClick={() => {
                if (selectedSkill) void onInstall(selectedSkill)
              }}
            >
              {selectedSkill && saving === `marketplace:${selectedSkill.id}` ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <DownloadCloud className="size-3.5" />
              )}
              {installed ? '已经安装' : '安装到本地'}
            </Button>
            <Button
              className="h-9 gap-1"
              variant="outline"
              onClick={() => emitUiCommand('open-agent-settings')}
            >
              <UserCheck className="size-3.5" />
              分配给智能体
            </Button>
          </div>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm font-semibold">技能怎么变成智能体能力</div>
          <div className="mt-1 text-xs text-muted-foreground">
            当前选中：{selectedSkill?.name ?? '先选一个技能'} · {installed ? '已安装，可以分配' : '安装后可分配'}
          </div>
        </div>
        <Badge variant={installed ? 'default' : 'outline'} className="shrink-0">
          {installed ? '可分配' : '待安装'}
        </Badge>
      </div>
      <div className="mt-3 grid gap-2 md:grid-cols-3">
        {skillUseSteps.map((step, index) => (
          <div key={step.title} className="rounded-md border bg-background px-3 py-2">
            <div className="flex items-center gap-2 text-xs font-semibold">
              <span className="grid size-5 place-items-center rounded-full bg-primary text-[10px] text-primary-foreground">
                {index + 1}
              </span>
              <span>{step.title}</span>
            </div>
            <div className="mt-1 text-[11px] leading-5 text-muted-foreground">{step.detail}</div>
          </div>
        ))}
      </div>
    </section>
  )
}

function SkillsMpResultList({
  items,
  saving,
  fallbackUrl,
  installedSkillNames,
  selectedSkillId,
  onSelect,
  onInstall,
}: {
  items: SkillsMpCliSkillResult[]
  saving: string | null
  fallbackUrl: string
  installedSkillNames: Set<string>
  selectedSkillId: string | null
  onSelect: (id: string) => void
  onInstall: (skill: SkillsMpCliSkillResult) => Promise<void>
}) {
  if (items.length === 0) {
    return (
      <div className="grid min-h-72 place-items-center p-6">
        <EmptyLine text="还没有推荐技能" />
      </div>
    )
  }
  return (
    <div className="grid gap-3 p-4">
      <section
        data-testid="skillsmp-featured-market"
        className="rounded-lg border bg-background p-3"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <div className="text-sm font-semibold">推荐技能</div>
            <div className="mt-1 text-xs text-muted-foreground">
              这里展示可安装的推荐技能，点卡片查看详情。
            </div>
          </div>
          <Badge variant="outline">{items.length} 个技能</Badge>
        </div>
      </section>
      {items.map((skill) => {
        const url = skill.sourceUrl ?? skill.skillUrl ?? fallbackUrl
        const installed = installedSkillNames.has(skill.name.toLowerCase())
        const selected = selectedSkillId === skill.id
        return (
          <article
            key={`${skill.id}-${url}`}
            role="button"
            tabIndex={0}
            data-testid="skillsmp-result-card"
            data-selected={selected}
            onClick={() => onSelect(skill.id)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault()
                onSelect(skill.id)
              }
            }}
            className={cn(
              'flex min-h-48 cursor-pointer flex-col rounded-lg border bg-background p-3 text-sm transition hover:border-primary/50 hover:bg-accent/30 focus:outline-none focus:ring-2 focus:ring-ring/40',
              selected && 'border-primary bg-primary/5 shadow-sm ring-2 ring-primary/15',
            )}
          >
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

            <div className="mt-auto flex flex-wrap items-center justify-between gap-2 pt-4">
              <div className="flex min-w-0 flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <span>{formatSkillMetric(skill.stars, '收藏')}</span>
                <span>{formatSkillMetric(skill.downloads, '使用')}</span>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                {url && (
                  <a
                    href={url}
                    target="_blank"
                    rel="noreferrer"
                    onClick={(event) => event.stopPropagation()}
                    className="inline-flex size-9 items-center justify-center rounded-lg border transition hover:bg-muted"
                    title="打开来源"
                  >
                    <ExternalLink className="size-4" />
                  </a>
                )}
                <Button
                  className="h-9 gap-1"
                  variant={installed ? 'outline' : 'default'}
                  onClick={(event) => {
                    event.stopPropagation()
                    void onInstall(skill)
                  }}
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

function SkillDetailPanel({
  skill,
  saving,
  installed,
  fallbackUrl,
  onInstall,
}: {
  skill: SkillsMpCliSkillResult | null
  saving: string | null
  installed: boolean
  fallbackUrl: string
  onInstall: (skill: SkillsMpCliSkillResult) => Promise<void>
}) {
  if (!skill) {
    return (
      <div className="p-4">
        <EmptyLine text="选择一个推荐技能后，这里会显示用途、来源和安装入口" />
      </div>
    )
  }

  const url = skill.sourceUrl ?? skill.skillUrl ?? fallbackUrl
  return (
    <div data-testid="skillsmp-detail-panel" className="space-y-4 p-4 text-sm">
      <SkillDetailHero
        skill={skill}
        url={url}
        saving={saving}
        installed={installed}
        onInstall={onInstall}
      />

      <SkillAgentFitGuide skill={skill} installed={installed} />

      <SkillAssignmentPlan skill={skill} installed={installed} />

      <section className="rounded-lg border bg-muted/10 p-3">
        <div className="mb-2 flex items-center gap-2 font-semibold">
          <Bot className="size-4 text-primary" />
          给智能体使用
        </div>
        <p className="text-xs leading-5 text-muted-foreground">
          安装后，在智能体设置里勾选这个技能，就能把它加入该 Agent 的能力清单。
        </p>
        <Button
          data-testid="assign-skill-to-agent"
          className="mt-3 h-9 w-full gap-1"
          variant="outline"
          onClick={() => emitUiCommand('open-agent-settings')}
        >
          <Bot className="size-3.5" />
          打开智能体设置并分配
        </Button>
      </section>

      <section className="rounded-lg border bg-muted/10 p-3">
        <div className="mb-2 font-semibold">标签</div>
        <div className="flex flex-wrap gap-1.5">
          {(skill.tags.length > 0 ? skill.tags : ['skillsmp']).slice(0, 8).map((tag) => (
            <span key={tag} className="rounded-full bg-background px-2 py-1 text-[11px] text-muted-foreground">
              {tag}
            </span>
          ))}
        </div>
      </section>

      <section className="rounded-lg border bg-muted/10 p-3">
        <div className="mb-2 font-semibold">来源</div>
        <div className="space-y-1 text-xs text-muted-foreground">
          <div className="truncate">作者：{skill.creator ?? '未知'}</div>
          <div className="truncate">仓库：{skill.repository ?? '未提供'}</div>
          <div className="truncate">更新：{skill.updatedAt ?? '未知'}</div>
        </div>
      </section>

      <div className="grid gap-2">
        <Button
          className="h-10 gap-1"
          variant={installed ? 'outline' : 'default'}
          onClick={() => void onInstall(skill)}
          disabled={saving !== null || installed}
        >
          {saving === `marketplace:${skill.id}` ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <CheckCircle2 className="size-4" />
          )}
          {installed ? '已安装' : '安装到本地'}
        </Button>
        {url && (
          <a
            href={url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex h-9 items-center justify-center gap-1 rounded-lg border text-xs transition hover:bg-muted"
          >
            <ExternalLink className="size-3.5" />
            打开来源页面
          </a>
        )}
      </div>
    </div>
  )
}

function SkillDetailHero({
  skill,
  url,
  saving,
  installed,
  onInstall,
}: {
  skill: SkillsMpCliSkillResult
  url: string
  saving: string | null
  installed: boolean
  onInstall: (skill: SkillsMpCliSkillResult) => Promise<void>
}) {
  const fit = inferSkillAgentFit(skill)
  return (
    <section
      data-testid="skillsmp-detail-hero"
      className="overflow-hidden rounded-lg border bg-gradient-to-b from-primary/5 to-background"
    >
      <div className="border-b bg-background/70 px-3 py-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <Package className="size-4 text-primary" />
            技能名片
          </div>
          <Badge variant={installed ? 'default' : 'outline'}>
            {installed ? '已安装，可分配' : '待安装'}
          </Badge>
        </div>
      </div>

      <div className="space-y-3 p-3">
        <div>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="truncate text-base font-semibold">{skill.name}</div>
              <div className="mt-1 text-xs text-muted-foreground">
                {skill.category ?? skill.occupation ?? '通用技能'}
              </div>
            </div>
            <div className="flex shrink-0 gap-1.5">
              {url && (
                <a
                  href={url}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex size-8 items-center justify-center rounded-md border bg-background transition hover:bg-muted"
                  title="打开来源"
                >
                  <ExternalLink className="size-3.5" />
                </a>
              )}
            </div>
          </div>
          <p className="mt-2 text-xs leading-5 text-muted-foreground">
            {skill.description || '这个技能暂时没有描述。'}
          </p>
        </div>

        <div data-testid="skillsmp-detail-market-signal">
          <div className="mb-2 text-xs font-semibold text-muted-foreground">市场热度</div>
          <div className="grid grid-cols-2 gap-2">
            <Metric label="收藏" value={skill.stars ?? 0} />
            <Metric label="使用" value={skill.downloads ?? 0} />
          </div>
        </div>

        <div
          data-testid="skillsmp-detail-assignment-path"
          className="rounded-lg border bg-background px-3 py-2"
        >
          <div className="text-xs font-semibold text-muted-foreground">安装与分配路径</div>
          <div className="mt-1 text-sm font-semibold">推荐给：{fit.role}</div>
          <div className="mt-1 text-xs leading-5 text-muted-foreground">
            {installed
              ? '这个技能已经在本地，可以直接去智能体设置里勾选。'
              : '先安装到本地，再把它分配给对应智能体。'}{' '}
            会增强：{fit.capability}
          </div>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            <Button
              className="h-9 gap-1"
              variant={installed ? 'outline' : 'default'}
              disabled={saving !== null || installed}
              onClick={() => void onInstall(skill)}
            >
              {saving === `marketplace:${skill.id}` ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <DownloadCloud className="size-3.5" />
              )}
              {installed ? '已经安装' : '安装技能'}
            </Button>
            <Button
              className="h-9 gap-1"
              variant="outline"
              onClick={() => emitUiCommand('open-agent-settings')}
            >
              <Bot className="size-3.5" />
              去分配给智能体
            </Button>
          </div>
        </div>

        <div>
          <div className="mb-2 text-xs font-semibold text-muted-foreground">能力标签</div>
          <div className="flex flex-wrap gap-1.5">
            {(skill.tags.length > 0 ? skill.tags : ['skillsmp']).slice(0, 6).map((tag) => (
              <span key={tag} className="rounded-full border bg-background px-2 py-1 text-[11px] text-muted-foreground">
                {tag}
              </span>
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}

function SkillAssignmentPlan({
  skill,
  installed,
}: {
  skill: SkillsMpCliSkillResult
  installed: boolean
}) {
  const fit = inferSkillAgentFit(skill)
  return (
    <section
      data-testid="skills-agent-assignment-plan"
      className="rounded-lg border bg-primary/5 p-3"
    >
      <div className="mb-2 flex items-center gap-2 font-semibold">
        <Package className="size-4 text-primary" />
        分配建议
      </div>
      <div className="space-y-2 text-xs leading-5 text-muted-foreground">
        <div>
          <span className="font-medium text-foreground">给谁用：</span>
          {fit.role}
        </div>
        <div>
          <span className="font-medium text-foreground">怎么用：</span>
          {installed ? '打开智能体设置，勾选这个技能。' : '先安装到本地，再打开智能体设置分配。'}
        </div>
        <div>
          <span className="font-medium text-foreground">会增强：</span>
          {fit.capability}
        </div>
      </div>
    </section>
  )
}

function SkillAgentFitGuide({
  skill,
  installed,
}: {
  skill: SkillsMpCliSkillResult
  installed: boolean
}) {
  const fit = inferSkillAgentFit(skill)
  return (
    <section
      data-testid="skillsmp-agent-fit-guide"
      className="rounded-lg border bg-muted/10 p-3"
    >
      <div className="mb-2 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2 font-semibold">
            <Bot className="size-4 text-primary" />
            智能体适配
          </div>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            先看这个技能适合交给哪类 Agent，再决定要不要安装和分配。
          </p>
        </div>
        <Badge variant={installed ? 'default' : 'outline'} className="shrink-0">
          {installed ? '已可分配' : '安装后可分配'}
        </Badge>
      </div>

      <div className="grid gap-2">
        <SkillFitRow label="适合岗位" value={fit.role} />
        <SkillFitRow label="能力增益" value={fit.capability} />
        <SkillFitRow label="配置位置" value="智能体设置 > 技能中心 > 勾选这个技能" />
      </div>
    </section>
  )
}

function SkillFitRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid gap-1 rounded-md border bg-background px-3 py-2 sm:grid-cols-[4.5rem_minmax(0,1fr)]">
      <div className="text-xs font-medium text-muted-foreground">{label}</div>
      <div className="text-xs leading-5 text-foreground">{value}</div>
    </div>
  )
}

function inferSkillAgentFit(skill: SkillsMpCliSkillResult): { role: string; capability: string } {
  const haystack = [
    skill.name,
    skill.description,
    skill.category,
    skill.occupation,
    skill.repository,
    ...skill.tags,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()

  if (haystack.includes('video') || haystack.includes('剪辑') || haystack.includes('素材')) {
    return {
      role: '视频制作 Agent、运营 Agent、交付检查 Agent',
      capability: '整理素材、生成剪辑步骤、检查导出产物和交付质量。',
    }
  }
  if (haystack.includes('browser') || haystack.includes('research') || haystack.includes('网页')) {
    return {
      role: '研究 Agent、运营 Agent、浏览器操作 Agent',
      capability: '网页检索、资料总结、来源归档和客户资料收集。',
    }
  }
  if (haystack.includes('code') || haystack.includes('review') || haystack.includes('测试')) {
    return {
      role: '写代码 Agent、代码审查 Agent、测试 Agent',
      capability: '代码审查、风险提示、测试建议和修改方案整理。',
    }
  }
  if (haystack.includes('data') || haystack.includes('excel') || haystack.includes('表格')) {
    return {
      role: '数据分析 Agent、运营 Agent、报表 Agent',
      capability: '清洗表格、汇总数据、生成报告和检查字段质量。',
    }
  }
  return {
    role: '通用执行 Agent、项目助理 Agent',
    capability: '补充专业流程、工具说明和可复用操作经验。',
  }
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
