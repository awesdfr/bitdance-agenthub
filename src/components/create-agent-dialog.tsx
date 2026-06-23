'use client'

import {
  Cable,
  Cpu,
  Loader2,
  MessageSquareText,
  PackageCheck,
  SlidersHorizontal,
  Sparkles,
  Terminal,
  User,
  Wrench,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'

import { AgentCreateWizard } from '@/components/agent-create-wizard'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import type { AgentRow, CliProfileRow, McpServerRow, ModelProfileRow, SkillRow } from '@/db/schema'
import {
  createAgent,
  fetchCliProfiles,
  fetchMcpServers,
  fetchModelProfiles,
  fetchSkillsCenterData,
  updateAgent,
  type CreateAgentBody,
  type UpdateAgentBody,
} from '@/lib/api'
import { cn } from '@/lib/utils'
import {
  AGENT_BUILDER_PROVIDER_DEFAULTS as PROVIDER_DEFAULTS,
  CLAUDE_CODE_DEFAULT_MODEL,
  CODEX_DEFAULT_MODEL,
  DEFAULT_CUSTOM_AGENT_TOOLS,
  type AgentBuilderAdapter as AdapterKind,
  type AgentBuilderProvider as Provider,
  type AgentConfigDraft,
} from '@/shared/agent-builder-config'
import { validateCodexBaseUrl } from '@/shared/codex-compat'
import {
  validateOpenAICompatibleApiKey,
  validateOpenAICompatibleBaseUrl,
} from '@/shared/openai-compatible'
import { useAppStore } from '@/stores/app-store'

type AgentTab = 'basic' | 'model' | 'toolsPrompt'
type CreateStep = 'choose' | 'wizard' | 'detail'

interface CapabilityCatalog {
  skills: SkillRow[]
  mcpServers: McpServerRow[]
  cliProfiles: CliProfileRow[]
}

const emptyCapabilityCatalog: CapabilityCatalog = {
  skills: [],
  mcpServers: [],
  cliProfiles: [],
}

const DEFAULT_CUSTOM_SYSTEM_PROMPT = `你是一个 AgentHub custom agent。你的任务是理解用户目标，使用已启用的工具完成工作，并把结果清晰交付给用户。

工作原则：
1. 先判断需要什么上下文；只有在用户提到附件、已有产物或工作区文件时，才调用对应读取工具。
2. 多步骤任务先给自己形成简短计划，但不要把固定流程强加给简单问题。
3. 工具调用要少而准确；每次调用都应服务于当前目标。
4. 产出代码、网页、文档或设计稿时，优先用 write_artifact 创建结构化产物；网页产物完成后再调用 deploy_artifact。
5. 探索项目目录时优先用 fs_list，再用 fs_read 读取具体文件；使用 fs_write 或 bash 前确认确有必要，并只在当前 workspace 范围内操作。
6. 最终回复保持简洁，说明完成了什么、产物在哪里、还剩什么需要用户决策。`

const MANUAL_MODEL_VALUE = '__manual_model__'

const SUPPORTED_AGENT_MODEL_PROFILE_PROVIDERS = new Set<ModelProfileRow['provider']>([
  'anthropic',
  'openai',
  'deepseek',
  'volcano-ark',
])

function isAgentCompatibleModelProfile(profile: ModelProfileRow) {
  return SUPPORTED_AGENT_MODEL_PROFILE_PROVIDERS.has(profile.provider)
}

function modelProfileProviderToAgentProvider(providerValue: ModelProfileRow['provider']): Provider | null {
  if (!SUPPORTED_AGENT_MODEL_PROFILE_PROVIDERS.has(providerValue)) return null
  return providerValue as Provider
}

function modelProfileStatusLabel(status: ModelProfileRow['healthStatus']) {
  if (status === 'ok') return '已通过'
  if (status === 'failed') return '异常'
  return '未测试'
}

function modelProfileMatchesAgent(profile: ModelProfileRow, agent: AgentRow) {
  const mappedProvider = modelProfileProviderToAgentProvider(profile.provider)
  if (!mappedProvider) return false
  if (agent.modelProvider !== mappedProvider || agent.modelId !== profile.model) return false
  return !agent.apiBaseUrl || agent.apiBaseUrl === profile.baseUrl
}

/**
 * 创建 / 编辑 Agent 的对话框。
 *
 * 传入 `agent` 进入编辑模式，未传则为创建模式。两种模式公用同一套字段、
 * 同一套校验，只是 submit 路径与文案不同。
 */
export function CreateAgentDialog({
  open,
  onOpenChange,
  agent,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  agent?: AgentRow
}) {
  const upsertAgent = useAppStore((s) => s.upsertAgent)
  const isEdit = !!agent

  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [capabilitiesText, setCapabilitiesText] = useState('')
  const [systemPrompt, setSystemPrompt] = useState('')
  const [modelProfiles, setModelProfiles] = useState<ModelProfileRow[]>([])
  const [modelProfilesLoading, setModelProfilesLoading] = useState(false)
  const [capabilityCatalog, setCapabilityCatalog] =
    useState<CapabilityCatalog>(emptyCapabilityCatalog)
  const [capabilityCatalogLoading, setCapabilityCatalogLoading] = useState(false)
  const [selectedModelProfileId, setSelectedModelProfileId] = useState('')
  const [adapterKind, setAdapterKind] = useState<AdapterKind>('custom')
  const [provider, setProvider] = useState<Provider>('deepseek')
  const [modelId, setModelId] = useState(PROVIDER_DEFAULTS.deepseek.defaultModel)
  const [toolNames, setToolNames] = useState<Set<string>>(new Set(DEFAULT_CUSTOM_AGENT_TOOLS))
  const [selectedSkillIds, setSelectedSkillIds] = useState<Set<string>>(new Set())
  const [selectedMcpServerIds, setSelectedMcpServerIds] = useState<Set<string>>(new Set())
  const [selectedCliProfileIds, setSelectedCliProfileIds] = useState<Set<string>>(new Set())
  const [supportsVision, setSupportsVision] = useState(true)
  const [apiKey, setApiKey] = useState('')
  const [apiBaseUrl, setApiBaseUrl] = useState('')
  const [showApiKey, setShowApiKey] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<AgentTab>('basic')
  const [createStep, setCreateStep] = useState<CreateStep>('choose')

  const compatibleModelProfiles = useMemo(
    () => modelProfiles.filter(isAgentCompatibleModelProfile),
    [modelProfiles],
  )
  const selectedModelProfile = useMemo(
    () =>
      compatibleModelProfiles.find((profile) => profile.id === selectedModelProfileId) ?? null,
    [compatibleModelProfiles, selectedModelProfileId],
  )

  const applyModelProfile = useCallback((profile: ModelProfileRow) => {
    const nextProvider = modelProfileProviderToAgentProvider(profile.provider)
    if (!nextProvider) return
    setSelectedModelProfileId(profile.id)
    setAdapterKind('custom')
    setProvider(nextProvider)
    setModelId(profile.model)
    setApiBaseUrl(profile.baseUrl)
    setApiKey('')
    setSupportsVision(profile.supportsVision)
    setToolNames((prev) => (prev.size === 0 ? new Set(DEFAULT_CUSTOM_AGENT_TOOLS) : prev))
  }, [])

  useEffect(() => {
    if (!open) return
    let alive = true
    setModelProfilesLoading(true)
    fetchModelProfiles()
      .then((profiles) => {
        if (alive) setModelProfiles(profiles)
      })
      .catch(() => {
        if (alive) setModelProfiles([])
      })
      .finally(() => {
        if (alive) setModelProfilesLoading(false)
      })
    return () => {
      alive = false
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    let alive = true
    setCapabilityCatalogLoading(true)
    Promise.all([fetchSkillsCenterData(), fetchMcpServers(), fetchCliProfiles()])
      .then(([skillsData, mcpServers, cliProfiles]) => {
        if (!alive) return
        setCapabilityCatalog({
          skills: skillsData.skills,
          mcpServers,
          cliProfiles,
        })
      })
      .catch(() => {
        if (alive) setCapabilityCatalog(emptyCapabilityCatalog)
      })
      .finally(() => {
        if (alive) setCapabilityCatalogLoading(false)
      })
    return () => {
      alive = false
    }
  }, [open])

  // 每次打开 / 切换 agent 时，重置表单到该 agent 的当前值（或创建态的默认）。
  useEffect(() => {
    if (!open) return
    if (agent) {
      const kind: AdapterKind =
        agent.adapterName === 'claude-code'
          ? 'claude-code'
          : agent.adapterName === 'codex'
            ? 'codex'
            : 'custom'
      setAdapterKind(kind)
      setName(agent.name)
      setDescription(agent.description)
      setCapabilitiesText(agent.capabilities.join(', '))
      setSystemPrompt(agent.systemPrompt)
      const p = (agent.modelProvider ?? 'deepseek') as Provider
      setProvider(p)
      setModelId(
        agent.modelId ??
          (kind === 'claude-code'
            ? CLAUDE_CODE_DEFAULT_MODEL
            : kind === 'codex'
              ? CODEX_DEFAULT_MODEL
              : PROVIDER_DEFAULTS[p].defaultModel),
      )
      setToolNames(new Set(agent.toolNames))
      setSelectedSkillIds(new Set(agent.skillIds))
      setSelectedMcpServerIds(new Set(agent.mcpServerIds))
      setSelectedCliProfileIds(new Set(agent.cliProfileIds))
      setSupportsVision(agent.supportsVision)
      setApiKey(agent.apiKey ?? '')
      setApiBaseUrl(agent.apiBaseUrl ?? '')
      setSelectedModelProfileId('')
    } else {
      setAdapterKind('custom')
      setName('')
      setDescription('')
      setCapabilitiesText('')
      setSystemPrompt(DEFAULT_CUSTOM_SYSTEM_PROMPT)
      setProvider('deepseek')
      setModelId(PROVIDER_DEFAULTS.deepseek.defaultModel)
      setToolNames(new Set(DEFAULT_CUSTOM_AGENT_TOOLS))
      setSelectedSkillIds(new Set())
      setSelectedMcpServerIds(new Set())
      setSelectedCliProfileIds(new Set())
      setSupportsVision(true)
      setApiKey('')
      setApiBaseUrl('')
      setSelectedModelProfileId('')
      setCreateStep('choose')
    }
    if (agent) setCreateStep('detail')
    setShowApiKey(false)
    setError(null)
    setActiveTab('basic')
  }, [open, agent])

  useEffect(() => {
    if (!open || compatibleModelProfiles.length === 0) return
    if (agent) {
      const match = compatibleModelProfiles.find((profile) => modelProfileMatchesAgent(profile, agent))
      setSelectedModelProfileId(match?.id ?? MANUAL_MODEL_VALUE)
      return
    }
    if (!selectedModelProfileId) applyModelProfile(compatibleModelProfiles[0])
  }, [agent, applyModelProfile, compatibleModelProfiles, open, selectedModelProfileId])

  const handleProviderChange = (p: Provider) => {
    setSelectedModelProfileId(MANUAL_MODEL_VALUE)
    setAdapterKind('custom')
    setProvider(p)
    // 切换 provider 时把 modelId 自动重置到该 provider 的默认（避免跨家串）
    setModelId(PROVIDER_DEFAULTS[p].defaultModel)
  }

  const toggleSelectedId = (
    setter: React.Dispatch<React.SetStateAction<Set<string>>>,
    id: string,
  ) => {
    setter((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const applyDraftToForm = (draft: AgentConfigDraft) => {
    const kind = draft.adapterName
    const p = draft.modelProvider ?? 'deepseek'
    setAdapterKind(kind)
    setName(draft.name)
    setDescription(draft.description)
    setCapabilitiesText(draft.capabilities.join(', '))
    setSystemPrompt(draft.systemPrompt)
    setProvider(p)
    setModelId(
      draft.modelId ??
        (kind === 'claude-code'
          ? CLAUDE_CODE_DEFAULT_MODEL
          : kind === 'codex'
            ? CODEX_DEFAULT_MODEL
            : PROVIDER_DEFAULTS[p].defaultModel),
    )
    setToolNames(new Set(draft.toolNames))
    setSupportsVision(draft.supportsVision)
    setApiKey('')
    setApiBaseUrl('')
    setShowApiKey(false)
    setError(null)
    setActiveTab('basic')
  }

  const editDraftDetails = (draft: AgentConfigDraft) => {
    applyDraftToForm(draft)
    setCreateStep('detail')
  }

  const createFromDraft = async (draft: AgentConfigDraft) => {
    if (submitting) return
    setSubmitting(true)
    setError(null)
    try {
      const isSdkAgent = draft.adapterName === 'claude-code' || draft.adapterName === 'codex'
      const body: CreateAgentBody = {
        name: draft.name.trim(),
        avatar: draft.avatar,
        description: draft.description.trim(),
        capabilities: draft.capabilities,
        systemPrompt: draft.systemPrompt.trim(),
        adapterName: draft.adapterName,
        modelProvider: isSdkAgent ? undefined : draft.modelProvider,
        modelId: draft.modelId?.trim() || undefined,
        toolNames: isSdkAgent ? [] : draft.toolNames,
        skillIds: [],
        mcpServerIds: [],
        cliProfileIds: [],
        supportsVision: draft.supportsVision,
      }
      const created = await createAgent(body)
      upsertAgent(created)
      onOpenChange(false)
    } catch (err) {
      const nextError = err instanceof Error ? err : new Error(String(err))
      setError(nextError.message)
      throw nextError
    } finally {
      setSubmitting(false)
    }
  }

  const submit = async () => {
    if (submitting) return
    setError(null)

    const trimmed = name.trim()
    const fail = (tab: AgentTab, msg: string) => {
      setActiveTab(tab)
      setError(msg)
    }
    if (!trimmed) return fail('basic', '名称不能为空')
    if (!description.trim()) return fail('basic', '描述不能为空')
    if (!systemPrompt.trim()) return fail('toolsPrompt', 'System Prompt 不能为空')
    if (adapterKind === 'custom' && !modelId.trim()) return fail('model', '请先选择模型，或手动填写模型 ID')
    const trimmedApiBaseUrl = apiBaseUrl.trim()
    const trimmedApiKey = apiKey.trim()
    if (adapterKind === 'codex') {
      const baseUrlError = validateCodexBaseUrl(trimmedApiBaseUrl || null)
      if (baseUrlError) return fail('model', baseUrlError)
    }
    if (adapterKind === 'custom') {
      const baseUrlError = validateOpenAICompatibleBaseUrl(provider, trimmedApiBaseUrl || null)
      if (baseUrlError) return fail('model', baseUrlError)
      const apiKeyError = validateOpenAICompatibleApiKey(provider, trimmedApiKey || null)
      if (apiKeyError) return fail('model', apiKeyError)
    }

    const capabilities = capabilitiesText
      .split(/[,，\s]+/)
      .map((s) => s.trim())
      .filter(Boolean)

    setSubmitting(true)
    try {
      const isClaudeCode = adapterKind === 'claude-code'
      const isCodex = adapterKind === 'codex'
      const isSdkAgent = isClaudeCode || isCodex
      if (isEdit && agent) {
        const patch: UpdateAgentBody = {
          name: trimmed,
          description: description.trim(),
          capabilities,
          systemPrompt: systemPrompt.trim(),
          adapterName: adapterKind,
          modelProvider: isSdkAgent ? undefined : provider,
          modelId: isSdkAgent ? modelId.trim() || null : modelId.trim(),
          toolNames: isSdkAgent ? [] : Array.from(toolNames),
          skillIds: Array.from(selectedSkillIds),
          mcpServerIds: Array.from(selectedMcpServerIds),
          cliProfileIds: Array.from(selectedCliProfileIds),
          supportsVision,
          apiKey: trimmedApiKey || null,
          apiBaseUrl: trimmedApiBaseUrl || null,
        }
        const updated = await updateAgent(agent.id, patch)
        upsertAgent(updated)
      } else {
        const body: CreateAgentBody = {
          name: trimmed,
          avatar: '',
          description: description.trim(),
          capabilities,
          systemPrompt: systemPrompt.trim(),
          adapterName: adapterKind,
          modelProvider: isSdkAgent ? undefined : provider,
          modelId: modelId.trim() || undefined,
          toolNames: isSdkAgent ? [] : Array.from(toolNames),
          skillIds: Array.from(selectedSkillIds),
          mcpServerIds: Array.from(selectedMcpServerIds),
          cliProfileIds: Array.from(selectedCliProfileIds),
          supportsVision,
          apiKey: trimmedApiKey || undefined,
          apiBaseUrl: trimmedApiBaseUrl || undefined,
        }
        const created = await createAgent(body)
        upsertAgent(created)
      }
      onOpenChange(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSubmitting(false)
    }
  }

  const showDetailForm = isEdit || createStep === 'detail'
  const descriptionText = isEdit
    ? '修改这个 Agent 的配置。保存后立即生效，已存在的会话也会用新配置回复。'
    : createStep === 'choose'
      ? '选择创建方式。可以先用描述生成草稿，也可以直接进入完整配置。'
      : createStep === 'wizard'
        ? '通过描述生成一份可确认的 Agent 配置草稿。'
        : '为这个 Agent 设定身份与能力。它会出现在新建对话的选择列表里。'

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="grid max-h-[calc(100vh-2rem)] grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{isEdit ? '编辑 Agent' : '创建 Agent'}</DialogTitle>
          <DialogDescription>{descriptionText}</DialogDescription>
        </DialogHeader>

        {!showDetailForm ? (
          createStep === 'choose' ? (
            <CreateModeChoice
              onConversational={() => setCreateStep('wizard')}
              onDetailed={() => setCreateStep('detail')}
              onCancel={() => onOpenChange(false)}
            />
          ) : (
            <AgentCreateWizard
              onBack={() => {
                setError(null)
                setCreateStep('choose')
              }}
              onCancel={() => onOpenChange(false)}
              onEditDetails={editDraftDetails}
              onCreate={createFromDraft}
              creating={submitting}
            />
          )
        ) : (
        <div className="flex min-h-0 flex-col gap-2">
          <Tabs
            value={activeTab}
            onValueChange={(v) => setActiveTab(v as AgentTab)}
            className="flex min-h-0 flex-1 flex-col gap-3"
          >
            <TabsList className="self-start">
              <TabsTrigger value="basic">
                <User className="size-3.5" />
                基本信息
              </TabsTrigger>
              <TabsTrigger value="model">
                <Cpu className="size-3.5" />
                模型
              </TabsTrigger>
              <TabsTrigger value="toolsPrompt">
                <Wrench className="size-3.5" />
                能力与提示词
              </TabsTrigger>
            </TabsList>

            <div className="min-h-0 flex-1 overflow-y-auto pr-1">
              <TabsContent value="basic" className="mt-0 space-y-3 py-1">
                <div className="grid grid-cols-[80px_1fr] items-start gap-3">
                  <Label required>名称</Label>
                  <Input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="例：TestBot"
                  />
                </div>

                <div className="grid grid-cols-[80px_1fr] items-start gap-3">
                  <Label required>描述</Label>
                  <Input
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="一句话讲清楚它能做什么"
                  />
                </div>

                <div className="grid grid-cols-[80px_1fr] items-start gap-3">
                  <Label>能力标签</Label>
                  <div>
                    <Input
                      value={capabilitiesText}
                      onChange={(e) => setCapabilitiesText(e.target.value)}
                      placeholder="testing, react, vitest"
                    />
                    <div className="mt-1 text-[10px] text-muted-foreground">用逗号或空格分隔</div>
                  </div>
                </div>
              </TabsContent>

              <TabsContent value="model" className="mt-0 space-y-3 py-1">
                <div className="grid grid-cols-[80px_1fr] items-start gap-3">
                  <Label required>模型</Label>
                  <div className="space-y-2">
                    {compatibleModelProfiles.length > 0 ? (
                      <select
                        value={selectedModelProfile?.id ?? MANUAL_MODEL_VALUE}
                        onChange={(event) => {
                          const value = event.target.value
                          if (value === MANUAL_MODEL_VALUE) {
                            setSelectedModelProfileId(MANUAL_MODEL_VALUE)
                            setAdapterKind('custom')
                            return
                          }
                          const profile = compatibleModelProfiles.find((item) => item.id === value)
                          if (profile) applyModelProfile(profile)
                        }}
                        className="h-10 w-full rounded-md border bg-background px-3 text-sm outline-none transition focus:border-ring"
                      >
                        {compatibleModelProfiles.map((profile) => (
                          <option key={profile.id} value={profile.id}>
                            {profile.name} · {profile.model}
                          </option>
                        ))}
                        <option value={MANUAL_MODEL_VALUE}>手动填写模型</option>
                      </select>
                    ) : (
                      <div className="rounded-md border border-dashed bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
                        {modelProfilesLoading
                          ? '正在读取模型配置...'
                          : '还没有可直接选择的模型。可以先去「模型管理」添加并测试，也可以在下面手动填写。'}
                      </div>
                    )}

                    {selectedModelProfile ? (
                      <div className="rounded-md border bg-primary/5 px-3 py-2 text-xs leading-5">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-medium">{selectedModelProfile.name}</span>
                          <span className="rounded bg-background px-1.5 py-0.5 text-[10px] text-muted-foreground">
                            {PROVIDER_DEFAULTS[provider]?.label ?? selectedModelProfile.provider}
                          </span>
                          <span className="rounded bg-background px-1.5 py-0.5 text-[10px] text-muted-foreground">
                            {modelProfileStatusLabel(selectedModelProfile.healthStatus)}
                          </span>
                        </div>
                        <div className="mt-0.5 font-mono text-[10px] text-muted-foreground">
                          {selectedModelProfile.model}
                        </div>
                      </div>
                    ) : (
                      <div className="text-[10px] leading-4 text-muted-foreground">
                        新 Agent 默认使用这里选中的模型。模型的 API Key、代理出口和连通性建议统一在左侧「模型管理」里维护。
                      </div>
                    )}
                  </div>
                </div>

                {!selectedModelProfile && (
                  <div className="grid grid-cols-[80px_1fr] items-start gap-3">
                    <Label>手动模型</Label>
                    <div className="flex gap-2">
                      <select
                        value={provider}
                        onChange={(event) => handleProviderChange(event.target.value as Provider)}
                        className="rounded-md border bg-background px-2 py-1.5 text-sm"
                      >
                        {(Object.keys(PROVIDER_DEFAULTS) as Provider[]).map((item) => (
                          <option key={item} value={item}>
                            {PROVIDER_DEFAULTS[item].label}
                          </option>
                        ))}
                      </select>
                      <Input
                        value={modelId}
                        onChange={(event) => {
                          setSelectedModelProfileId(MANUAL_MODEL_VALUE)
                          setAdapterKind('custom')
                          setModelId(event.target.value)
                        }}
                        placeholder="model id"
                        className="flex-1 font-mono text-xs"
                      />
                    </div>
                  </div>
                )}

                <details className="rounded-md border bg-muted/20 px-3 py-2">
                  <summary className="cursor-pointer text-xs font-medium text-muted-foreground">
                    高级覆盖
                  </summary>
                  <div className="mt-3 space-y-3">
                    <div className="grid grid-cols-[80px_1fr] items-start gap-3">
                      <Label>Base URL</Label>
                      <div>
                        <Input
                          value={apiBaseUrl}
                          onChange={(event) => setApiBaseUrl(event.target.value)}
                          placeholder="留空则使用模型默认地址"
                          className="font-mono text-xs"
                        />
                        <div className="mt-1 text-[10px] text-muted-foreground">
                          只有临时覆盖模型出口时才需要填写；普通用户保持默认即可。
                        </div>
                      </div>
                    </div>

                    <div className="grid grid-cols-[80px_1fr] items-start gap-3">
                      <Label>API Key</Label>
                      <div>
                        <div className="flex gap-2">
                          <Input
                            type={showApiKey ? 'text' : 'password'}
                            value={apiKey}
                            onChange={(event) => setApiKey(event.target.value)}
                            placeholder="留空则使用系统设置或环境变量"
                            className="flex-1 font-mono text-xs"
                            autoComplete="off"
                          />
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => setShowApiKey((value) => !value)}
                          >
                            {showApiKey ? '隐藏' : '显示'}
                          </Button>
                        </div>
                        <div className="mt-1 text-[10px] text-muted-foreground">
                          这里只适合给单个 Agent 临时覆盖密钥；常用密钥请放到「模型管理」或系统设置。
                        </div>
                      </div>
                    </div>

                    <div className="grid grid-cols-[80px_1fr] items-start gap-3">
                      <Label>视觉</Label>
                      <label
                        className={cn(
                          'flex cursor-pointer items-start gap-2 rounded-md border px-3 py-2 transition hover:border-foreground/30',
                          supportsVision && 'border-primary bg-primary/5',
                        )}
                      >
                        <input
                          type="checkbox"
                          checked={supportsVision}
                          onChange={(event) => setSupportsVision(event.target.checked)}
                          className="mt-0.5 accent-primary"
                        />
                        <div className="min-w-0">
                          <div className="text-xs font-medium">允许这个 Agent 接收图片</div>
                          <div className="mt-0.5 text-[10px] text-muted-foreground">
                            只有所选模型本身支持多模态时才会生效。
                          </div>
                        </div>
                      </label>
                    </div>
                  </div>
                </details>
              </TabsContent>

              <TabsContent value="toolsPrompt" className="mt-0 space-y-3 py-1">
                <div className="grid grid-cols-[80px_1fr] items-start gap-3">
                  <Label>可用能力</Label>
                  <div className="space-y-2">
                    {capabilityCatalogLoading ? (
                      <div className="flex items-center gap-2 rounded-md border bg-muted/30 px-3 py-3 text-xs text-muted-foreground">
                        <Loader2 className="size-3.5 animate-spin" />
                        正在读取已配置能力
                      </div>
                    ) : (
                      <>
                        <CapabilityPickGroup
                          icon={<PackageCheck className="size-3.5" />}
                          title="已安装 Skills"
                          emptyText="还没有已安装技能，可先去「技能中心」安装。"
                          items={capabilityCatalog.skills.map((skill) => ({
                            id: skill.id,
                            title: skill.name,
                            description: skill.description,
                            meta: skill.enabled ? '已启用' : '已禁用',
                          }))}
                          selectedIds={selectedSkillIds}
                          onToggle={(id) => toggleSelectedId(setSelectedSkillIds, id)}
                        />
                        <CapabilityPickGroup
                          icon={<Cable className="size-3.5" />}
                          title="MCP 工具"
                          emptyText="还没有 MCP 工具，可先去「工具连接」添加。"
                          items={capabilityCatalog.mcpServers.map((server) => ({
                            id: server.id,
                            title: server.displayName,
                            description: server.command ?? server.endpoint ?? 'MCP 工具连接',
                            meta: server.enabled ? server.healthStatus : '已禁用',
                          }))}
                          selectedIds={selectedMcpServerIds}
                          onToggle={(id) => toggleSelectedId(setSelectedMcpServerIds, id)}
                        />
                        <CapabilityPickGroup
                          icon={<Terminal className="size-3.5" />}
                          title="CLI 命令"
                          emptyText="还没有 CLI，可先去「工具连接」接入。"
                          items={capabilityCatalog.cliProfiles.map((cli) => ({
                            id: cli.id,
                            title: cli.name,
                            description: `${cli.command} ${cli.argsTemplate}`.trim(),
                            meta: cli.requiresApproval ? '需要审批' : '可直接运行',
                          }))}
                          selectedIds={selectedCliProfileIds}
                          onToggle={(id) => toggleSelectedId(setSelectedCliProfileIds, id)}
                        />
                      </>
                    )}
                  </div>
                </div>

                <div className="grid grid-cols-[80px_1fr] items-start gap-3">
                  <Label required>System Prompt</Label>
                  <Textarea
                    value={systemPrompt}
                    onChange={(e) => setSystemPrompt(e.target.value)}
                    placeholder="你是…&#10;你的核心产出是…&#10;遵守以下原则…"
                    className="min-h-[160px] font-mono text-xs"
                  />
                </div>
              </TabsContent>
            </div>
          </Tabs>

          {error && (
            <div className="shrink-0 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800 dark:border-red-900/40 dark:bg-red-950/30 dark:text-red-200">
              {error}
            </div>
          )}
        </div>
        )}

        {showDetailForm && (
          <DialogFooter>
            {!isEdit && (
              <Button
                variant="outline"
                onClick={() => {
                  setError(null)
                  setCreateStep('choose')
                }}
              >
                返回
              </Button>
            )}
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              取消
            </Button>
            <Button onClick={() => void submit()} disabled={submitting}>
              {submitting ? (isEdit ? '保存中...' : '创建中...') : isEdit ? '保存' : '创建'}
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  )
}

function CreateModeChoice({
  onConversational,
  onDetailed,
  onCancel,
}: {
  onConversational: () => void
  onDetailed: () => void
  onCancel: () => void
}) {
  return (
    <div className="flex min-h-0 flex-col gap-3">
      <div className="grid gap-2">
        <button
          type="button"
          onClick={onConversational}
          className="flex cursor-pointer items-start gap-3 rounded-md border px-3 py-3 text-left transition hover:border-primary hover:bg-primary/5"
        >
          <div className="mt-0.5 inline-flex size-8 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
            <MessageSquareText className="size-4" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 text-sm font-medium">
              对话创建
              <Sparkles className="size-3.5 text-primary" />
            </div>
            <div className="mt-1 text-xs leading-5 text-muted-foreground">
              描述想要的角色、任务和交付物，先生成可审阅的配置草稿。
            </div>
          </div>
        </button>

        <button
          type="button"
          onClick={onDetailed}
          className="flex cursor-pointer items-start gap-3 rounded-md border px-3 py-3 text-left transition hover:border-foreground/30"
        >
          <div className="mt-0.5 inline-flex size-8 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
            <SlidersHorizontal className="size-4" />
          </div>
          <div className="min-w-0">
            <div className="text-sm font-medium">详细配置</div>
            <div className="mt-1 text-xs leading-5 text-muted-foreground">
              直接编辑名称、模型、工具权限和提示词。
            </div>
          </div>
        </button>
      </div>

      <div className="flex justify-end">
        <Button variant="outline" onClick={onCancel}>
          取消
        </Button>
      </div>
    </div>
  )
}

function CapabilityPickGroup({
  icon,
  title,
  emptyText,
  items,
  selectedIds,
  onToggle,
}: {
  icon: React.ReactNode
  title: string
  emptyText: string
  items: Array<{
    id: string
    title: string
    description: string
    meta: string
  }>
  selectedIds: Set<string>
  onToggle: (id: string) => void
}) {
  return (
    <section className="rounded-md border bg-background">
      <div className="flex items-center justify-between gap-2 border-b px-3 py-2">
        <div className="flex min-w-0 items-center gap-1.5 text-xs font-medium">
          {icon}
          <span className="truncate">{title}</span>
        </div>
        <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
          已选 {selectedIds.size}
        </span>
      </div>
      <div className="grid max-h-48 gap-1.5 overflow-y-auto p-2">
        {items.length === 0 ? (
          <div className="rounded-md border border-dashed bg-muted/20 px-3 py-3 text-center text-[11px] text-muted-foreground">
            {emptyText}
          </div>
        ) : (
          items.map((item) => {
            const selected = selectedIds.has(item.id)
            return (
              <label
                key={item.id}
                className={cn(
                  'flex cursor-pointer items-start gap-2 rounded-md border px-3 py-2 transition hover:border-foreground/30',
                  selected && 'border-primary bg-primary/5',
                )}
              >
                <input
                  type="checkbox"
                  checked={selected}
                  onChange={() => onToggle(item.id)}
                  className="mt-0.5 accent-primary"
                />
                <div className="min-w-0 flex-1">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="truncate text-xs font-medium">{item.title}</span>
                    <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                      {item.meta}
                    </span>
                  </div>
                  <div className="mt-0.5 line-clamp-2 text-[10px] text-muted-foreground">
                    {item.description}
                  </div>
                </div>
              </label>
            )
          })
        )}
      </div>
    </section>
  )
}

function Label({ children, required }: { children: React.ReactNode; required?: boolean }) {
  return (
    <div className="pt-2 text-xs text-muted-foreground">
      {children}
      {required && <span className="ml-0.5 text-red-500">*</span>}
    </div>
  )
}
