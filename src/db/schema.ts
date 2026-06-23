/**
 * Drizzle schema — 与 specs/01-core-entities.md 对应。
 *
 * 修改本文件后必须运行 `pnpm db:push` 同步到 SQLite。
 */

import { sql } from 'drizzle-orm'
import { index, integer, real, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import type { ArtifactContent, ArtifactType, AdapterName, MessagePart, ModelProvider } from '@/shared/types'

// ─── Agents ──────────────────────────────────────────────────
export const agents = sqliteTable('agents', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  avatar: text('avatar').notNull(),
  description: text('description').notNull(),
  capabilities: text('capabilities', { mode: 'json' }).$type<string[]>().notNull(),

  systemPrompt: text('system_prompt').notNull(),
  adapterName: text('adapter_name').$type<AdapterName>().notNull(),

  modelProvider: text('model_provider').$type<ModelProvider>(),
  modelId: text('model_id'),
  /**
   * 该 agent 单独的 API key。优先级高于 app_settings / env var。
   * Codex adapter 会把最终 key 注入隔离 CODEX_HOME 下的 SDK runtime。
   */
  apiKey: text('api_key'),

  /**
   * 该 agent 单独的 API base URL。
   * NULL 表示走 adapter 默认 endpoint；Claude Code 还可走 app_settings.anthropicBaseUrl。
   * 配合 apiKey 一起用：base URL 非空时，SDK adapter 会把 apiKey 作为对应 token 传入。
   * Codex 只支持 Codex/Responses 兼容 endpoint，Chat Completions-only provider 需走 custom。
   */
  apiBaseUrl: text('api_base_url'),

  toolNames: text('tool_names', { mode: 'json' }).$type<string[]>().notNull(),
  skillIds: text('skill_ids', { mode: 'json' }).$type<string[]>().notNull().default(sql`'[]'`),
  mcpServerIds: text('mcp_server_ids', { mode: 'json' }).$type<string[]>().notNull().default(sql`'[]'`),
  cliProfileIds: text('cli_profile_ids', { mode: 'json' }).$type<string[]>().notNull().default(sql`'[]'`),

  isBuiltin: integer('is_builtin', { mode: 'boolean' }).notNull().default(false),
  isOrchestrator: integer('is_orchestrator', { mode: 'boolean' }).notNull().default(false),
  supportsVision: integer('supports_vision', { mode: 'boolean' }).notNull().default(false),

  createdAt: integer('created_at').notNull(),
})

// ─── Conversations ───────────────────────────────────────────
export const conversations = sqliteTable(
  'conversations',
  {
    id: text('id').primaryKey(),
    title: text('title').notNull(),
    mode: text('mode', { enum: ['single', 'group'] }).notNull(),
    agentIds: text('agent_ids', { mode: 'json' }).$type<string[]>().notNull(),
    modelProfileId: text('model_profile_id').references(() => modelProfiles.id, {
      onDelete: 'set null',
    }),
    /** 注入 LLM 长期上下文的重要消息（agent-runner 用，UI 暂未暴露入口）。 */
    pinnedMessageIds: text('pinned_message_ids', { mode: 'json' })
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'`),
    /** 用户的 UI 书签 —— 仅用于 outline 导航定位 / 高亮，不影响 LLM 上下文。 */
    bookmarkedMessageIds: text('bookmarked_message_ids', { mode: 'json' })
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'`),
    archived: integer('archived', { mode: 'boolean' }).notNull().default(false),
    /** 置顶时间戳；NULL 表示未置顶。排序时 pinned 永远在前，相互按 pinnedAt desc。 */
    pinnedAt: integer('pinned_at'),

    /**
     * Agent 通过 fs_write 改文件时的审批策略：
     * 'review' — 写入前推送 fs_write.pending，让前端弹审批 dialog（默认）
     * 'auto'   — 直接写
     * 仅影响 agent；用户手动在 FileTab 编辑保存不走审批。
     */
    fsWriteApprovalMode: text('fs_write_approval_mode', { enum: ['auto', 'review'] })
      .notNull()
      .default('review'),

    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [index('idx_conv_updated').on(t.updatedAt)],
)

// ─── Messages ────────────────────────────────────────────────
export const messages = sqliteTable(
  'messages',
  {
    id: text('id').primaryKey(),
    conversationId: text('conversation_id')
      .notNull()
      .references(() => conversations.id, { onDelete: 'cascade' }),

    role: text('role', { enum: ['user', 'agent', 'system'] }).notNull(),
    agentId: text('agent_id').references(() => agents.id),

    parts: text('parts', { mode: 'json' }).$type<MessagePart[]>().notNull(),

    status: text('status', { enum: ['streaming', 'complete', 'error', 'aborted'] }).notNull(),
    parentMessageId: text('parent_message_id'),
    mentionedAgentIds: text('mentioned_agent_ids', { mode: 'json' })
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'`),

    runId: text('run_id'),

    /** 这条消息（单 LLM 响应）的 token 用量。null 表示 user 消息 / 不上报的 mock / 旧数据 */
    usage: text('usage', { mode: 'json' }).$type<MessageUsage>(),

    createdAt: integer('created_at').notNull(),
  },
  (t) => [index('idx_messages_conv_created').on(t.conversationId, t.createdAt)],
)

/** Per-message token usage —— 比 RunUsage 略简，单条 LLM 响应级别。 */
export interface MessageUsage {
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
}

export type SemanticDiffImpact = 'low' | 'medium' | 'high'

export interface SemanticDiffStructuralChange {
  added: string[]
  removed: string[]
  modified: string[]
  moved: string[]
}

export interface SemanticDiffSemanticChange {
  description: string
  impact: SemanticDiffImpact
  relatedSections: string[]
}

export type AgentCloneSkillMode = 'shared' | 'independent_snapshot' | 'none'
export type AgentCloneMemoryMode = 'semantic_only' | 'none'
export type AgentExperimentStatus = 'created' | 'planned' | 'completed' | 'failed'
export type AgentWhatIfImpactLevel = 'positive' | 'neutral' | 'warning' | 'risk'

// ─── Artifacts ───────────────────────────────────────────────
export const artifacts = sqliteTable(
  'artifacts',
  {
    id: text('id').primaryKey(),
    conversationId: text('conversation_id')
      .notNull()
      .references(() => conversations.id, { onDelete: 'cascade' }),

    type: text('type').$type<ArtifactType>().notNull(),
    title: text('title').notNull(),
    content: text('content', { mode: 'json' }).$type<ArtifactContent>().notNull(),

    version: integer('version').notNull().default(1),
    parentArtifactId: text('parent_artifact_id'),

    createdByAgentId: text('created_by_agent_id')
      .notNull()
      .references(() => agents.id),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [index('idx_artifacts_conv').on(t.conversationId)],
)

// ─── Workspaces ──────────────────────────────────────────────
export const artifactSemanticDiffs = sqliteTable(
  'artifact_semantic_diffs',
  {
    id: text('id').primaryKey(),
    artifactV1Id: text('artifact_v1_id')
      .notNull()
      .references(() => artifacts.id, { onDelete: 'cascade' }),
    artifactV2Id: text('artifact_v2_id')
      .notNull()
      .references(() => artifacts.id, { onDelete: 'cascade' }),
    structuralChanges: text('structural_changes', { mode: 'json' })
      .$type<SemanticDiffStructuralChange[]>()
      .notNull()
      .default(sql`'[]'`),
    semanticChanges: text('semantic_changes', { mode: 'json' })
      .$type<SemanticDiffSemanticChange[]>()
      .notNull()
      .default(sql`'[]'`),
    summary: text('summary').notNull(),
    risks: text('risks', { mode: 'json' }).$type<string[]>().notNull().default(sql`'[]'`),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [
    index('idx_artifact_semantic_diffs_pair').on(t.artifactV1Id, t.artifactV2Id),
    index('idx_artifact_semantic_diffs_artifact_v2').on(t.artifactV2Id, t.createdAt),
  ],
)

export const workspaces = sqliteTable('workspaces', {
  id: text('id').primaryKey(),
  conversationId: text('conversation_id')
    .notNull()
    .unique()
    .references(() => conversations.id, { onDelete: 'cascade' }),
  rootPath: text('root_path').notNull(),
  /**
   * 'sandbox' — 隔离目录（.agenthub-data/workspaces/<convId>），默认
   * 'local'   — 绑定用户机器上的真实目录
   */
  mode: text('mode', { enum: ['sandbox', 'local'] }).notNull().default('sandbox'),
  /** mode='local' 时填，绝对路径；sandbox 时为 null */
  boundPath: text('bound_path'),
  createdAt: integer('created_at').notNull(),
})

// ─── Attachments (会话文件库) ─────────────────────────────────
export const attachments = sqliteTable(
  'attachments',
  {
    id: text('id').primaryKey(),
    conversationId: text('conversation_id')
      .notNull()
      .references(() => conversations.id, { onDelete: 'cascade' }),

    kind: text('kind', { enum: ['image', 'file'] }).notNull(),
    fileName: text('file_name').notNull(),
    filePath: text('file_path').notNull(),    // 相对 workspace.rootPath
    size: integer('size').notNull(),
    mimeType: text('mime_type').notNull(),

    createdAt: integer('created_at').notNull(),
  },
  (t) => [index('idx_attachments_conv').on(t.conversationId)],
)

// ─── AgentRuns ───────────────────────────────────────────────
export const agentRuns = sqliteTable(
  'agent_runs',
  {
    id: text('id').primaryKey(),
    conversationId: text('conversation_id')
      .notNull()
      .references(() => conversations.id, { onDelete: 'cascade' }),
    agentId: text('agent_id')
      .notNull()
      .references(() => agents.id),
    triggerMessageId: text('trigger_message_id'),

    status: text('status', { enum: ['queued', 'running', 'complete', 'failed', 'aborted'] }).notNull(),
    error: text('error'),

    parentRunId: text('parent_run_id'),

    /** Token 使用量。run 完成时由 adapter 报告并由 AgentRunner 落库。null = 该 run 未上报（如 mock / 失败）。 */
    usage: text('usage', { mode: 'json' }).$type<RunUsage>(),

    startedAt: integer('started_at').notNull(),
    finishedAt: integer('finished_at'),
  },
  (t) => [index('idx_runs_parent').on(t.parentRunId)],
)

/** RunUsage —— 一次 run 累计的 token 用量。所有字段 0+ 整数；不返回的字段 0 不是 null（聚合好处理）。 */
export interface RunUsage {
  inputTokens: number
  outputTokens: number
  /** Anthropic prompt caching: 写入缓存的 tokens（贵） */
  cacheCreationTokens: number
  /** Anthropic prompt caching: 命中缓存的 tokens（便宜）；DeepSeek 的 prompt_cache_hit_tokens 也映射到这里 */
  cacheReadTokens: number
  /** 用于上下文窗口仪表的最近一次「input prompt 长度」（不是累计），方便 UI 显示 ctx X/200k */
  lastInputTokens?: number
  /** 实际使用的模型 id；不同 run 可能不同（agent 配置改过 / 第三方网关动态路由），用来归类 */
  model?: string
}

// ─── Employee Agent control plane foundation ───────────────────────────────
export type HealthStatus = 'unknown' | 'ok' | 'failed'
export type ModelProfileProvider =
  | 'openai'
  | 'anthropic'
  | 'deepseek'
  | 'google'
  | 'openrouter'
  | 'ollama'
  | 'custom'
  | 'volcano-ark'
  | 'openai-compatible'
export type NetworkMode = 'direct' | 'http_proxy' | 'socks5_proxy' | 'custom_gateway'
export type NetworkAppliesTo = 'model_only' | 'browser_only' | 'cli_only' | 'all_agent_traffic'
export type ModelConnectionTestMode = 'dry_run' | 'live'
export type ModelRouteStatus = 'selected' | 'fallback_selected' | 'no_match'
export type WorkstationMode =
  | 'browser_context'
  | 'physical_desktop'
  | 'virtual_desktop'
  | 'vm'
  | 'remote_session'
export type WorkstationStatus = 'idle' | 'busy' | 'paused' | 'error'
export type ComputerSessionStatus = 'active' | 'complete' | 'failed' | 'paused'
export type ComputerActionStatus = 'planned' | 'complete' | 'blocked' | 'failed'
export type BrowserSessionStatus = 'active' | 'expired' | 'revoked' | 'archived'
export type BrowserSessionMaxAge = '1d' | '7d' | '30d' | 'forever'
export type BrowserSessionKeepAliveInterval = '1h' | '4h' | '12h'
export type BrowserSessionEventType =
  | 'created'
  | 'access_evaluated'
  | 'keep_alive_planned'
  | 'export_planned'
  | 'revoked'
  | 'expired'
export type BrowserSessionEventStatus = 'allowed' | 'blocked' | 'planned' | 'recorded'
export type ToolConnectionType = 'mcp' | 'cli' | 'software' | 'api'
export type ToolProtocolSource = 'mcp' | 'cli' | 'software' | 'api' | 'internal'
export type ToolProtocolInvocationStatus = 'created' | 'running' | 'succeeded' | 'failed'
export type McpTransport = 'stdio' | 'sse' | 'http'
export type McpToolCallMode = 'dry_run' | 'execute'
export type McpToolCallStatus = 'planned' | 'blocked' | 'complete' | 'failed'
export type SkillSource = 'skillsmp' | 'github' | 'local'
export type SkillStatus = 'installed' | 'disabled' | 'failed'
export type SkillInstallStatus = 'pending' | 'installed' | 'failed'
export type SkillSdkValidationStatus = 'valid' | 'invalid'
export type SkillMarketplacePublicationStatus = 'draft' | 'validated' | 'published' | 'rejected'
export type PluginExtensionPoint =
  | 'tool_provider'
  | 'model_provider'
  | 'memory_backend'
  | 'workstation_type'
  | 'verification_strategy'
  | 'output_adapter'
  | 'notification_channel'
  | 'trigger_type'
  | 'ui_panel'
  | 'artifact_renderer'
export type PluginStatus = 'installed' | 'enabled' | 'disabled' | 'uninstalled' | 'failed'
export type PluginHealthStatus = 'unknown' | 'ok' | 'failed'
export type PluginLifecycleEventType =
  | 'install'
  | 'enable'
  | 'disable'
  | 'uninstall'
  | 'upgrade'
  | 'health_check'
  | 'compatibility_check'
export type PluginLifecycleStatus = 'succeeded' | 'failed'

export interface PluginCapabilityDefinition {
  id: string
  name: string
  type: PluginExtensionPoint
  description: string
  inputSchema?: JsonObject
  outputSchema?: JsonObject
  riskLevel?: 'low' | 'medium' | 'high'
}

export interface PluginMarketplaceMetadata {
  source: 'local' | 'marketplace' | 'github' | 'file'
  marketplaceUrl?: string | null
  rating?: number | null
  downloads?: number | null
  reviews?: number | null
  updateAvailable?: boolean
  latestVersion?: string | null
}

export interface PluginCompatibilityReport {
  systemVersion: string
  compatible: boolean
  requiredCoreVersion?: string | null
  conflicts: string[]
  warnings: string[]
  checkedAt: number
}

export interface PluginSecurityScanResult {
  status: 'passed' | 'warning' | 'blocked'
  findings: string[]
  scannedAt: number
}
export type TeamUserRoleSystem = 'admin' | 'operator' | 'viewer' | 'custom'
export type TeamUserStatus = 'active' | 'disabled'
export type TeamStatus = 'active' | 'archived'
export type TeamMembershipStatus = 'active' | 'removed'
export type TeamResourceType =
  | 'agent_template'
  | 'workflow'
  | 'skill'
  | 'model_profile'
  | 'memory'
export type TeamResourceSharingPolicy = 'team_shared' | 'project_shared' | 'private'
export type TeamSecretHandling = 'user_isolated' | 'shared_reference' | 'not_applicable'
export type TeamApprovalMode =
  | 'specific_user'
  | 'any_approver'
  | 'all_must_approve'
  | 'one_of_many'
export type TeamApprovalPolicyStatus = 'active' | 'disabled'
export type TeamApprovalDecisionValue = 'approved' | 'rejected'
export type TeamApprovalResolutionStatus = 'pending' | 'approved' | 'rejected'

export interface TeamApprovalResolution {
  status: TeamApprovalResolutionStatus
  approvedBy: string[]
  rejectedBy: string[]
  missingApproverIds: string[]
  reason: string
}
export type AgentTemplatePackageType =
  | 'agent_profile'
  | 'workflow'
  | 'skill_package'
  | 'software_command'
  | 'macro_package'
export type AgentTemplateCategory =
  | 'development'
  | 'design'
  | 'operations'
  | 'office'
  | 'project'
  | 'custom'
export type AgentTemplateSource = 'system' | 'user' | 'marketplace'
export type AgentTemplateVisibility = 'private' | 'team' | 'public'
export type AgentTemplateStatus = 'draft' | 'published' | 'archived'
export type AgentTemplateInstallStatus = 'installed' | 'failed'
export type TestFixtureType = 'file' | 'project_template' | 'web_fixture' | 'memory_fixture'
export type TestFixtureGenerationStatus = 'planned' | 'generated' | 'failed'
export type TestStrategyItemKind =
  | 'pyramid_layer'
  | 'integration_case'
  | 'mock_model_capability'
  | 'chaos_case'
export type TestStrategyItemStatus = 'covered' | 'record_only' | 'planned'
export type BenchmarkDimension = 'accuracy' | 'efficiency' | 'robustness' | 'safety' | 'consistency'
export type BenchmarkRunStatus = 'queued' | 'running' | 'completed' | 'failed'
export type BenchmarkRegressionStatus = 'passed' | 'warn' | 'failed'
export type SupportedLocale = 'zh-CN' | 'en-US' | 'ja-JP' | 'zh-TW'
export type LocalizationNamespace = 'ui' | 'errors' | 'agent-prompts' | 'docs'
export type OutputLanguagePolicy =
  | 'workspace_default'
  | 'follow_user_locale'
  | 'fixed_locale'
  | 'match_input'
export type I18nContractArea =
  | 'ui_text_keys'
  | 'agent_prompt_language'
  | 'locale_formatting'
  | 'localized_errors'
  | 'localized_docs'
export type I18nContractStatus = 'passing' | 'warning' | 'failing'
export type ArchitectureEvolutionTrack =
  | 'single_machine_to_cluster'
  | 'cloud_worker'
  | 'saas_private_deploy'
  | 'mobile_future'
export type ArchitectureAbstractionKind =
  | 'event_bus'
  | 'storage'
  | 'lock_service'
  | 'runtime_worker'
  | 'deployment'
  | 'mobile_interface'
export type ArchitectureEvolutionStatus = 'reserved' | 'planned' | 'blocked' | 'implemented'
export type ThemePresetKey = 'light' | 'dark' | 'highContrast' | 'cozy'
export type ThemeSpacingScale = 'compact' | 'comfortable' | 'spacious'
export type ThemeModePreference = 'system' | 'light' | 'dark'
export type KeyboardShortcutScope = 'global' | 'canvas' | 'run_monitor' | 'common'
export type KeyboardShortcutStatus = 'active' | 'disabled'
export type AccessibilityColorScheme = 'system' | 'light' | 'dark'
export type AccessibilityProfileStatus = 'active' | 'disabled'
export type ReasonixFileFormatKind = 'agent' | 'workflow' | 'skill' | 'macro' | 'package' | 'debug'
export type ReasonixFileFormatValidationStatus = 'valid' | 'invalid'
export type MigrationSourceTool = 'autogpt' | 'crewai' | 'langchain' | 'csv'
export type MigrationWizardStatus = 'checked' | 'imported' | 'failed'
export type MigrationCompatibilityStatus = 'compatible' | 'warning' | 'blocked'
export type MigrationImportTargetType = 'agent_profile' | 'memory_item' | 'workflow' | 'manual_mapping'
export type MigrationImportResult = 'planned' | 'created' | 'skipped' | 'failed'
export type PerformanceAnalysisScope = 'agent' | 'system' | 'workspace'
export type PerformanceAnalysisStatus = 'completed' | 'failed'
export type PerformanceRecommendationStatus = 'open' | 'applied' | 'dismissed'
export type SecurityAuditCadence = 'quarterly' | 'major_version' | 'quarterly_or_major' | 'continuous'
export type SecurityAuditRunStatus = 'draft' | 'completed' | 'failed'
export type SecurityAuditItemStatus = 'pending' | 'passed' | 'failed' | 'not_applicable'
export type IncidentSeverity = 'P0' | 'P1' | 'P2' | 'P3'
export type IncidentStatus = 'open' | 'triaged' | 'mitigating' | 'resolved' | 'postmortem_complete'
export type IncidentActionStatus = 'pending' | 'completed' | 'skipped'
export type CapacityEvaluationStatus = 'ok' | 'warning' | 'over_capacity'
export type DeprecationStage = 'notice' | 'warning' | 'disabled_new' | 'removed'
export type DeprecationMigrationMode = 'dry_run' | 'apply'
export type DeprecationMigrationStatus = 'planned' | 'completed' | 'failed'
export type DocumentationSectionCategory =
  | 'getting_started'
  | 'user_guide'
  | 'advanced'
  | 'developer'
  | 'troubleshooting'
  | 'reference'
  | 'release_notes'
export type DocumentationPageStatus = 'planned' | 'draft' | 'published' | 'missing'
export type HelpCenterSurfaceStatus = 'active' | 'disabled'
export type HelpCenterItemType =
  | 'question_button'
  | 'tooltip'
  | 'example_value'
  | 'error_doc_link'
  | 'onboarding_step'
export type HelpOnboardingFlowStatus = 'active' | 'archived'
export type GlossaryTermCategory =
  | 'lifecycle'
  | 'runtime'
  | 'safety'
  | 'collaboration'
  | 'quality'
  | 'learning'
  | 'operations'
export type FaqEntryCategory =
  | 'security'
  | 'recovery'
  | 'models'
  | 'cost'
  | 'offline'
  | 'platform'
  | 'safety'
export type TroubleshootingCategory =
  | 'model'
  | 'runtime'
  | 'browser'
  | 'skills'
  | 'memory'
  | 'workflow'
  | 'approval'
  | 'security'
export type QuickReferenceCategory =
  | 'agent'
  | 'task'
  | 'runtime'
  | 'approval'
  | 'monitoring'
  | 'debug'
  | 'safety'
export type NonGoalScope = 'v1_not_do' | 'never_do'
export type BrandCandidateLanguage = 'zh' | 'en'
export type CompetitivePositioningStatus = 'draft' | 'active' | 'archived'
export type EcosystemRoadmapStage = 'internal_beta' | 'open' | 'ecosystem' | 'platform'
export type EcosystemRoadmapStatus = 'planned' | 'active' | 'complete' | 'archived'
export type EthicalAlignmentDecision = 'allowed' | 'warn' | 'refused' | 'ask_user'
export type EthicalAlignmentPolicyStatus = 'draft' | 'active' | 'archived'
export type EthicalOnRefuse = 'explain_why' | 'silent_reject' | 'ask_user_to_rephrase'
export type LegalComplianceStatus = 'draft' | 'active' | 'archived'
export type LegalDisclaimerPlacement = 'installation' | 'agent_creation' | 'approval_footer' | 'artifact_output'
export type LicenseRiskLevel = 'low' | 'medium' | 'high' | 'critical'
export type EmotionalUxGuidelineType = 'tone' | 'microinteraction' | 'anxiety_reduction'
export type EmotionalUxStatus = 'draft' | 'active' | 'archived'
export type SystemBootstrapComponent =
  | 'database_connection'
  | 'message_queue'
  | 'model_providers'
  | 'mcp_servers'
  | 'disk_space'
  | 'memory_usage'
  | 'running_agents'
  | 'pending_approvals'
  | 'api_latency'
  | 'websocket_connections'
  | 'event_throughput'
  | 'database_slow_queries'
  | 'checkpoint_latency'
  | 'ops_agent'
export type SystemBootstrapCheckStatus = 'ok' | 'warning' | 'failed'
export type SuccessMetricCategory = 'product' | 'quality' | 'community' | 'business'
export type SuccessMetricTargetOperator = 'gte' | 'lte' | 'track'
export type SuccessMetricSnapshotStatus = 'met' | 'missed' | 'observed'
export type ReadinessChecklistCategory =
  | 'technical'
  | 'security'
  | 'planning'
  | 'environment'
  | 'team'
  | 'documentation'
  | 'legal'
export type OAuthProvider = 'github' | 'google' | 'microsoft' | 'notion' | 'slack' | 'custom'
export type OAuthGrantType = 'authorization_code' | 'client_credentials' | 'device_code'
export type OAuthActingAs = 'user' | 'service_account' | 'bot'
export type OAuthCredentialStatus = 'active' | 'expired' | 'refreshing' | 'reauth_required' | 'revoked'
export type OAuthRefreshStatus = 'pending' | 'succeeded' | 'failed' | 'reauthorized'
export type WorkspaceInitSourceType = 'git' | 'local' | 'template' | 'empty'
export type WorkspaceStructure = 'node' | 'python' | 'go' | 'custom'
export type WorkspaceSetupFailPolicy = 'abort' | 'retry' | 'skip_and_warn' | 'ask_user'
export type WorkspaceInitRunStatus = 'planned' | 'ready' | 'failed' | 'warning' | 'awaiting_user'
export type CustomModelSourceType = 'openai_finetune' | 'huggingface' | 'local_gguf' | 'ollama_custom'
export type CustomModelStatus = 'available' | 'testing' | 'disabled'
export type FinetuneDatasetSourceScope = 'agent' | 'project' | 'workspace'
export type FinetuneDatasetConsentStatus = 'pending' | 'approved' | 'rejected' | 'exported'
export type ProjectSwitchMode = 'sequential' | 'parallel' | 'time_sliced'
export type ProjectContextStatus = 'active' | 'archived'
export type ProjectSwitchStatus = 'planned' | 'completed' | 'blocked'
export type BehaviorSnapshotKind = 'baseline' | 'current'
export type BehaviorDriftSeverity = 'none' | 'minor' | 'significant'
export type DriftResponsePolicy = 'notify' | 'auto_correct' | 'ask_user'
export type BehaviorStabilizationRunStatus = 'planned' | 'applied' | 'skipped'
export type SkillSynthesisStatus = 'suggested' | 'accepted' | 'rejected' | 'published'
export type ToolPipelineFailurePolicy = 'abort' | 'skip' | 'retry' | 'use_fallback_tool'
export type ToolPipelineStatus = 'draft' | 'tested' | 'published'
export type UnifiedSearchEntityType =
  | 'agent'
  | 'task'
  | 'memory'
  | 'artifact'
  | 'workflow'
  | 'event'
  | 'knowledge_graph'
  | 'document'
export type ContextPreloadTaskType = 'code' | 'data' | 'doc' | 'general'
export type ContextCacheStatus = 'fresh' | 'stale' | 'invalidated'
export type ContextWindowContentType =
  | 'instruction'
  | 'plan'
  | 'memory'
  | 'observation'
  | 'tool'
  | 'input'
  | 'policy'
  | 'other'
export type ContextWindowImportance = 'critical' | 'important' | 'supporting'
export type ContextWindowActionType =
  | 'compress_plan'
  | 'remove_old_steps'
  | 'expand_window'
  | 'compress_memory'
  | 'trim_tools'

export interface ContextWindowSegment {
  id: string
  title: string
  kind: string
  contentType: ContextWindowContentType
  importance: ContextWindowImportance
  status: 'included' | 'truncated' | 'omitted'
  tokens: number
  estimatedTokens: number
  shareOfUsed: number
  shareOfCapacity: number
  barUnits: number
  reason: string
}

export interface ContextWindowBreakdownItem {
  key: string
  label: string
  tokens: number
  percentage: number
}

export interface ContextWindowSuggestion {
  actionType: ContextWindowActionType
  label: string
  reason: string
  estimatedTokenDelta: number
  riskLevel: RiskLevel
}
export type PromptTemplateStatus = 'draft' | 'active' | 'archived'
export type PromptTemplateScope = 'agent' | 'workspace' | 'global'
export type PromptTemplateEngine = 'handlebars' | 'jinja2' | 'custom'
export type PromptVariableSource =
  | 'agent_profile'
  | 'task_input'
  | 'memory'
  | 'runtime_state'
  | 'env'
  | 'static'
export interface PromptTemplateVariableBinding {
  source: PromptVariableSource
  path: string
  default?: string
}
export type PromptTemplateVariables = Record<string, PromptTemplateVariableBinding>
export interface PromptTemplateConditionalBlock {
  condition: string
  block: string
}
export type PromptVersionAbTestMetric = 'success_rate' | 'step_efficiency' | 'user_satisfaction'
export interface PromptVersionAbTest {
  experimentId: string
  variant: 'A' | 'B'
  trafficPercent: number
  metrics: PromptVersionAbTestMetric[]
}
export type ContextCompressionStrategy =
  | 'summarize_oldest'
  | 'summarize_least_relevant'
  | 'sliding_window'
  | 'hierarchical'
export type ContextPreserveItem =
  | 'plan'
  | 'current_goal'
  | 'error_log'
  | 'user_instructions'
  | 'important_observations'
export type ContextSummarizerModel = 'cheap_local' | 'same_model'
export type ContextCompressorPolicyStatus = 'active' | 'disabled'
export type ContextCompressionPlanStatus = 'not_needed' | 'planned' | 'compressed'
export interface ContextCompressorConfig {
  triggerThreshold: number
  strategy: ContextCompressionStrategy
  preserveAlways: ContextPreserveItem[]
  summarizerModel: ContextSummarizerModel
}
export interface TokenBudgetAllocationConfig {
  totalWindow: number
  systemPromptMax: number
  currentPlanMax: number
  relevantMemoriesMax: number
  recentStepSummariesMax: number
  toolDefinitionsMax: number
  safetyMargin: number
  fullRecentStepsCount: number
}
export interface TokenBudgetAllocationResult {
  totalWindow: number
  systemPrompt: number
  currentPlan: number
  relevantMemories: number
  recentStepSummaries: number
  toolDefinitions: number
  safetyMargin: number
  fullRecentStepsCount: number
  remainingForFullRecentSteps: number
  totalAllocated: number
  overflowTokens: number
}
export interface ContextCompressionSectionDecision {
  id: string
  title: string
  kind: string
  beforeTokens: number
  afterTokens: number
  savedTokens: number
  reason: string
}
export type PromptDriftSchedule = '7d' | '30d' | 'on_model_update_notice'
export type PromptDriftAction = 'notify_user' | 'auto_rollback_model' | 'create_incident'
export type PromptDriftMonitorStatus = 'active' | 'disabled'
export type PromptDriftRunStatus = 'stable' | 'warning' | 'drift_detected'
export type ConsensusCriticalTask =
  | 'security_analysis'
  | 'code_review'
  | 'data_analysis_conclusion'
  | 'financial_calculation'
  | 'legal_document_generation'
export type SecondaryModelStrategy = 'cheap_fast_model' | 'same_model' | 'different_provider'
export type ConsensusRecommendedAction = 'use_primary' | 'use_secondary' | 'merge' | 'ask_user'
export type AgentVotingTieBreaker = 'user_decides' | 'lead_agent_decides' | 'conservative_option'
export type AgentVotingDecision = 'accepted' | 'rejected' | 'tie' | 'no_quorum'
export type AdversarialReviewStatus = 'passed' | 'issues_found' | 'needs_revision'
export type AdversarialReviewAction = 'approve' | 'revise' | 'ask_user'
export type ContentSafetyCategory =
  | 'safe'
  | 'hate'
  | 'adult'
  | 'violence'
  | 'spam'
  | 'self_harm'
  | 'pii'
  | 'blocked_pattern'
  | 'cloud_review'
export type ContentSafetyCloudProvider = 'openai_moderation' | 'azure_content_safety' | 'custom'
export type ContentSafetyAction = 'block' | 'warn' | 'redact' | 'quarantine' | 'ask_user'
export type ContentSafetyDecision = 'allow' | ContentSafetyAction
export type ContentSafetyPolicyStatus = 'active' | 'disabled'
export type ContentSafetyScanStatus = 'passed' | 'flagged' | 'blocked' | 'quarantined' | 'needs_user'
export type SafetyReviewedContentType = 'text' | 'code' | 'document' | 'image' | 'json' | 'file_bundle'
export type CopyrightOnMatch = 'warn_with_attribution' | 'block' | 'ask_user'
export type CopyrightCheckStatus = 'clear' | 'needs_attribution' | 'blocked' | 'needs_user'
export interface ContentSafetyLayers {
  keywordFilter: {
    blockedPatterns: string[]
    piiPatterns: string[]
  }
  localClassifier: {
    categories: ContentSafetyCategory[]
    threshold: number
  }
  cloudSafetyAPI?: {
    provider: ContentSafetyCloudProvider
    requiresUserConsent: true
  }
}
export interface CopyrightCheckConfig {
  codePlagiarism: {
    similarityThreshold: number
    minMatchLength: number
    onMatch: CopyrightOnMatch
  }
  imageCopyright: {
    checkMetadata: boolean
    reverseImageSearch: boolean
  }
}
export type TrustCalibrationPolicyStatus = 'active' | 'disabled'
export type TrustLevel = 'day_1_untrusted' | 'low' | 'medium' | 'high'
export type TrustCalibrationRecommendation =
  | 'increase_autonomy'
  | 'decrease_autonomy'
  | 'keep_current'
  | 'require_manual_review'
export interface TrustCalibrationConfig {
  highConfidenceIndicators: {
    showConfidenceBadge: boolean
    showEvidence: boolean
    showVerifiedCheck: boolean
  }
  lowConfidenceIndicators: {
    showWarningBadge: boolean
    showUncertaintyReason: boolean
    suggestHumanReview: boolean
  }
  antiOverTrust: {
    streakWarning: number
    periodicRealityCheck: boolean
  }
}
export interface TrustCalibrationMetrics {
  daysActive: number
  runCount: number
  successRate: number
  approvalsApproved: number
  approvalsRejected: number
  takeoverCount: number
  modificationRate: number
  similarTaskCount: number
  verifiedArtifactCount: number
  highConfidenceSuccessStreak: number
}
export type BudgetScope =
  | 'per_task'
  | 'per_agent_per_day'
  | 'per_project_per_month'
  | 'global_per_month'
export type BudgetLimitType = 'token_count' | 'usd_amount'
export type BudgetPolicyStatus = 'active' | 'disabled'
export type BudgetEvaluationStatus = 'ok' | 'notify' | 'blocked'
export type BudgetControlAction = 'allow' | 'notify_user' | 'stop_task'
export type BudgetUsageGroupBy = 'agent' | 'project' | 'day' | 'week' | 'month'
export type BudgetRoutingCondition =
  | 'task_type'
  | 'estimated_steps'
  | 'context_length'
  | 'needs_vision'
  | 'time_of_day'
export type BudgetRoutingOperator = 'equals' | 'lt' | 'gt'
export interface BudgetModelRoutingRule {
  condition: BudgetRoutingCondition
  operator: BudgetRoutingOperator
  value: string | number | boolean
  routeTo: string
  reason?: string
}
export interface BudgetPolicyConfig {
  routingRules: BudgetModelRoutingRule[]
  estimateFactors: {
    modelUnitPriceUsd: number
    averageStepTokens: number
    visionMultiplier: number
    largeContextMultiplier: number
    historicalTaskWeight: number
  }
  reportTags: string[]
}
export interface BudgetUsageSnapshot {
  consumedTokens: number
  consumedUsd: number
  estimatedAdditionalTokens: number
  estimatedAdditionalUsd: number
  projectedTokens: number
  projectedUsd: number
  usagePercent: number
  periodStartAt?: number
  periodEndAt?: number
}
export interface BudgetCostBreakdown {
  modelCalls: JsonObject[]
  toolExecutions: JsonObject[]
  cliExecutions: JsonObject[]
}
export interface PromptDriftChecks {
  outputFormatStability: boolean
  refusalRateChange: boolean
  verbosityChange: boolean
  toolCallingAccuracy: boolean
  reasoningQuality: boolean
  latencyChange: boolean
  costChange: boolean
}
export type SoftwareAppType =
  | 'native_app'
  | 'browser_app'
  | 'cli_app'
  | 'mobile_app'
  | 'api_service'
  | 'script'
export type SoftwareAdapterType =
  | 'cli'
  | 'mcp'
  | 'api'
  | 'browser_automation'
  | 'desktop_automation'
  | 'recorded_macro'
  | 'hybrid'
export type RiskLevel = 'low' | 'medium' | 'high'
export type SecretKind = 'env_ref' | 'encrypted_value'
export type SecretStatus = 'active' | 'revoked'
export type CredentialResourceType =
  | 'global'
  | 'model_profile'
  | 'agent_profile'
  | 'cli_profile'
  | 'mcp_server'
  | 'mcp_tool'
  | 'tool_connection'
  | 'software_profile'
export type SandboxLevel = 'strict' | 'workspace' | 'trusted'
export type SandboxNetworkMode = 'none' | 'model_only' | 'approved_hosts' | 'unrestricted'
export type AuditActorType = 'user' | 'agent' | 'system'
export type AuditActionStatus = 'allowed' | 'blocked' | 'warning'
export type SecurityFindingSeverity = 'low' | 'medium' | 'high' | 'critical'
export type SecurityFindingAction = 'block' | 'warn' | 'redact' | 'require_approval' | 'log'
export type MemoryScope = 'agent' | 'project' | 'workspace' | 'global'
export type MemoryType =
  | 'episodic'
  | 'semantic'
  | 'procedural'
  | 'project'
  | 'customer'
  | 'software'
  | 'mistake'
  | 'success'
export type MemoryPrivacyReadAccess =
  | 'only_me'
  | 'my_team'
  | 'my_role'
  | 'project'
  | 'organization'
  | 'user_only'
export type MemoryPrivacyWriteAccess = 'only_me' | 'user' | 'team_lead'
export type MemoryPrivacyEncryption = 'none' | 'at_rest' | 'always_encrypted'
export type MemoryPrivacyDataType =
  | 'pii'
  | 'credentials'
  | 'business_secret'
  | 'customer_data'
  | 'internal_only'
  | 'public_ok'
export type LearningEventStatus = 'pending_review' | 'approved' | 'rejected'
export type PlaybookStatus = 'draft' | 'active' | 'archived'
export type AgentDiaryEntryType = 'run_summary' | 'handoff' | 'lesson' | 'blocker' | 'next_step'
export type ContinuationPlanStatus = 'open' | 'in_progress' | 'completed' | 'canceled'
export type AgentRetirementStatus = 'draft' | 'ready_for_review' | 'completed' | 'canceled'
export type KnowledgeTransferStatus = 'pending_review' | 'completed' | 'rejected'
export type KnowledgeTransferReceiverHandling =
  | 'accept_all'
  | 'review_each'
  | 'accept_high_confidence'
export type OrganizationalKnowledgeSource = 'all_agents' | 'specific_project' | 'specific_role'
export type OrganizationalInsightType =
  | 'failure_pattern'
  | 'best_practice'
  | 'software_tip'
  | 'customer_preference'
export type OrganizationalInsightStatus = 'candidate' | 'promoted' | 'deprecated'
export type MetaAgentStatus = 'active' | 'paused'
export type MetaAgentResponsibility =
  | 'monitor_all_agents_health'
  | 'suggest_agent_optimizations'
  | 'resolve_inter_agent_conflicts'
  | 'route_incoming_tasks'
  | 'detect_anomalies'
  | 'generate_daily_digest'
  | 'manage_resource_allocation'
  | 'onboard_new_agents'
  | 'retire_underperforming_agents'
export type MetaAgentRecommendationType =
  | 'check_health'
  | 'optimize_agent'
  | 'resolve_conflict'
  | 'route_task'
  | 'detect_anomaly'
  | 'daily_digest'
  | 'resource_allocation'
  | 'onboard_agent'
  | 'retire_agent'
export type MetaAgentRecommendationStatus = 'open' | 'approved' | 'dismissed' | 'applied'
export type MetaAgentRecommendationSeverity = 'info' | 'warning' | 'critical'
export type AgentReputationTrend = 'improving' | 'stable' | 'declining'
export type AgentReputationBadge =
  | 'reliable_100'
  | 'cost_saver'
  | 'fast_learner'
  | 'team_player'
  | 'survivor'
  | 'polyglot'
  | 'night_owl'
export type ProgrammaticApiKeyStatus = 'active' | 'revoked'
export type SdkTaskStatus = 'queued' | 'running' | 'completed' | 'failed' | 'canceled'
export type WebhookSubscriptionStatus = 'active' | 'paused' | 'disabled'
export type WebhookEventType =
  | 'run.created'
  | 'run.queued'
  | 'run.completed'
  | 'run.failed'
  | 'run.event'
  | 'webhook.test'
export type WebhookDeliveryStatus = 'queued' | 'recorded' | 'delivered' | 'failed' | 'skipped'
export type WebhookDeliveryMode = 'record_only' | 'http_post'
export type WorkflowStatus = 'draft' | 'active' | 'archived'
export type RunStatus = 'queued' | 'running' | 'complete' | 'failed' | 'aborted' | 'paused'
export type WorkflowOptimizationStatus = 'analyzed' | 'applied'
export type NaturalLanguageWorkflowDraftStatus = 'preview' | 'modified' | 'confirmed' | 'discarded'
export type NaturalLanguageWorkflowIntentType = 'github_issue_triage' | 'generic_sequential'
export type AgentScheduleCurrentStatus =
  | 'on_duty'
  | 'off_duty'
  | 'overtime'
  | 'maintenance'
  | 'vacation'
export type AgentVacationBehavior = 'reject_all_tasks' | 'queue_tasks' | 'delegate_to_backup'
export type AgentScheduleStatus = 'active' | 'disabled'
export type WeekdayName =
  | 'monday'
  | 'tuesday'
  | 'wednesday'
  | 'thursday'
  | 'friday'
  | 'saturday'
  | 'sunday'

export interface AgentWorkingDaySchedule {
  active: boolean
  start?: string
  end?: string
  allDay?: boolean
}

export type AgentWeeklySchedule = Record<WeekdayName, AgentWorkingDaySchedule>

export interface AgentMaintenanceWindow {
  day: WeekdayName
  start: string
  end: string
  reason: string
}

export interface AgentOvertimePolicy {
  acceptTasksOutsideHours: boolean
  maxOvertimePerDay: string
  notifyOnOvertime: boolean
  urgentTasksBypassRestriction: boolean
}

export interface AgentVacationMode {
  enabled: boolean
  startDate?: number | null
  endDate?: number | null
  behavior: AgentVacationBehavior
  backupAgentId?: string | null
}

export interface AgentAvailabilityDecision {
  allowed: boolean
  currentStatus: AgentScheduleCurrentStatus
  reason: string
  queueTask: boolean
  delegateToAgentId: string | null
  notifyUser: boolean
}
export type AgentCertificationValidityPeriod = '6m' | '1y' | 'permanent'
export type AgentCertificationLevel = 'basic' | 'intermediate' | 'advanced' | 'expert'
export type AgentCertificationExamStatus = 'active' | 'archived'
export type AgentCertificationRunStatus = 'completed' | 'failed'

export interface AgentCertificationRubric {
  correctness: number
  efficiency: number
  codeStyle: number
  safetyAwareness: number
}

export interface AgentCertificationTask {
  taskId: string
  description: string
  expectedOutput: unknown
  scoringRubric: AgentCertificationRubric
}

export interface AgentCertificationSubmission {
  taskId: string
  output: unknown
  durationMs?: number
  notes?: string
}

export interface AgentCertificationTaskScore {
  taskId: string
  score: number
  correctness: number
  efficiency: number
  codeStyle: number
  safetyAwareness: number
  feedback: string[]
}
export interface WorkflowOptimizationBottleneck {
  nodeId: string
  avgDurationMs: number
  avgDuration: string
  percentOfTotalTime: number
  suggestion: string
}

export interface WorkflowOptimizationRedundancy {
  nodes: string[]
  description: string
  suggestion: string
}

export interface WorkflowParallelizationOpportunity {
  nodes: string[]
  reason: string
  estimatedTimeSavingMs: number
  estimatedTimeSaving: string
}

export interface WorkflowCostOptimization {
  nodeId: string
  currentCostCents: number
  currentCost: number
  suggestedChange: string
  estimatedSavingCents: number
  estimatedSaving: number
}

export interface WorkflowOptimizationAnalysis {
  bottlenecks: WorkflowOptimizationBottleneck[]
  redundancies: WorkflowOptimizationRedundancy[]
  parallelizationOpportunities: WorkflowParallelizationOpportunity[]
  costOptimizations: WorkflowCostOptimization[]
}

export interface WorkflowOptimizationAutoApply {
  enabled: boolean
  riskThreshold: 'low' | 'medium'
  requireApprovalFor: 'medium' | 'high'
}

export interface WorkflowOptimizationAppliedChange {
  kind: 'cost_optimization' | 'parallelization' | 'redundancy_cleanup' | 'bottleneck_review'
  riskLevel: RiskLevel
  description: string
  nodeIds: string[]
  applied: boolean
}
export type AgentTeamDashboardStatus = 'live' | 'exported'
export type AgentTeamDashboardCommandType =
  | 'pause_all'
  | 'resume_all'
  | 'emergency_stop'
  | 'export_report'
export type AgentTeamDashboardCommandStatus = 'planned' | 'applied' | 'partially_applied' | 'skipped'
export type CicdPlatform = 'github_actions' | 'gitlab_ci' | 'jenkins' | 'circleci' | 'azure_devops'
export type CicdMode = 'cli' | 'action' | 'api' | 'webhook'
export type CicdIntegrationStatus = 'active' | 'disabled'
export type CicdRunStatus = 'queued' | 'completed' | 'failed'
export type CicdAgentConclusion =
  | 'passed'
  | 'security_issue_found'
  | 'style_issues_only'
  | 'agent_failed'
export type CapabilityNegotiationStatus = 'open' | 'resolved' | 'failed' | 'expired'
export type CapabilityNegotiationStrategy =
  | 'find_alternative'
  | 'request_skill_install'
  | 'delegate_to_peer'
  | 'degrade_task'
  | 'refuse_task'
export type CapabilityNegotiationEventType =
  | 'self_check'
  | 'alternative_found'
  | 'skill_install_requested'
  | 'delegation_proposed'
  | 'task_degraded'
  | 'refused'
  | 'resolved'

export interface CapabilityNegotiationStrategies {
  findAlternative: boolean
  requestSkillInstall: boolean
  delegateToPeer: boolean
  degradeTask: boolean
  refuseTask: boolean
}

export interface CapabilityNegotiationResolution {
  strategy: CapabilityNegotiationStrategy
  explanation: string
  installRequest?: {
    skillName: string
    reason: string
    riskLevel: RiskLevel
  }
  delegation?: {
    toAgentId: string
    subtask: string
    expectedResult: string
  }
  alternative?: {
    capability: string
    substituteWith: string
    limitation: string
  }
  degradedScope?: {
    canDo: string[]
    cannotDo: string[]
  }
}

export interface AgentTeamDashboardCard {
  agentProfileId: string
  agentName: string
  role: string
  status: 'idle' | 'working' | 'waiting_approval' | 'blocked' | 'failed' | 'paused' | 'complete'
  employeeRunId: string | null
  goal: string
  currentPhase: string
  currentStep: string
  stepIndex: number
  stepTotal: number
  lastEventAt: number | null
  waitingApprovalCount: number
  computerSessionIds: string[]
  canViewScreen: boolean
  canHelp: boolean
  canTakeOver: boolean
  error: string | null
}

export interface AgentTeamBlackboardItem {
  id: string
  authorAgentProfileId: string | null
  authorName: string
  key: string
  summary: string
  version: number
  updatedAt: number
}
export type AgentPersonaTone =
  | 'formal'
  | 'casual'
  | 'technical'
  | 'friendly'
  | 'concise'
  | 'detailed'

export interface AgentPersonaCommunicationStyle {
  useEmoji: boolean
  useCodeBlocks: boolean
  preferBulletPoints: boolean
  showThinkingProcess: boolean
  selfReference: string
}

export interface AgentPersonaTraits {
  cautious: number
  creative: number
  thorough: number
  efficient: number
}

export interface AgentPersona {
  avatar: string
  tone: AgentPersonaTone
  language: string
  communicationStyle: AgentPersonaCommunicationStyle
  personalityTraits: AgentPersonaTraits
}
export type WorkflowPreflightStatus = 'ok' | 'warning' | 'blocked'
export type SimulationTargetType = 'agent' | 'workflow'
export type SimulationRunMode = 'dry_run' | 'user_played_environment'
export type SimulationRunStatus = 'awaiting_review' | 'approved' | 'rejected'
export type BacktestRunMode = 'historical' | 'golden'
export type BacktestGateStatus = 'passed' | 'warning' | 'failed'
export type GoldenTaskSetStatus = 'active' | 'draft' | 'archived'
export type CliRunMode = 'dry_run' | 'execute'
export type CliRunStatus = 'planned' | 'blocked' | 'complete' | 'failed'
export type SoftwareCommandRunMode = 'dry_run' | 'execute'
export type SoftwareCommandRunStatus = 'planned' | 'blocked' | 'complete' | 'failed'
export type RecordedMacroStatus = 'draft' | 'active' | 'archived'
export type MacroReplayRunMode = 'dry_run' | 'execute'
export type MacroReplayRunStatus = 'planned' | 'blocked' | 'complete' | 'failed'
export type ConfigEntityType =
  | 'agent_profile'
  | 'model_profile'
  | 'network_profile'
  | 'cli_profile'
  | 'mcp_server'
  | 'tool_connection'
  | 'software_profile'
  | 'software_command'
  | 'recorded_macro'
  | 'workflow'
  | 'prompt_template'
  | 'playbook'
export type ConfigVersionSource = 'manual' | 'api' | 'runtime_snapshot' | 'gitops_export'
export type ConfigExportFormat = 'json' | 'yaml' | 'gitops_bundle'
export type ConfigImpactLevel = 'none' | 'low' | 'medium' | 'high'
export type EditConflictResolution = 'overwrite' | 'merge' | 'discard' | 'show_diff'
export type EditConflictStatus = 'open' | 'resolved'
export type ExportPackageType =
  | 'agent_profile'
  | 'workflow'
  | 'skill'
  | 'software_command'
  | 'recorded_macro'
export type ExportPackageStatus = 'ready' | 'failed'
export type PackageCompatibilityStatus = 'compatible' | 'warning' | 'blocked'
export type ApprovalStatus = 'pending' | 'approved' | 'rejected' | 'canceled'
export type HumanApprovalPolicyStatus = 'active' | 'disabled'
export type ApprovalOnTimeout =
  | 'auto_reject'
  | 'auto_approve'
  | 'keep_waiting'
  | 'escalate_to_admin'
export interface ApprovalBatchingConfig {
  enabled: boolean
  maxBatchSize: number
  maxWaitSeconds: number
  mergeSimilar: boolean
}
export interface AutoApproveCondition {
  condition: string
  maxAutoApprovalsPerRun: number
}
export interface ApprovalEscalationStep {
  level: number
  approver: 'user' | 'admin' | 'project_owner' | 'external'
  escalateAfterSeconds: number
}
export interface HumanApprovalPolicyConfig {
  timeoutSeconds: number
  onTimeout: ApprovalOnTimeout
  batching: ApprovalBatchingConfig
  autoApproveConditions: AutoApproveCondition[]
  escalationChain: ApprovalEscalationStep[]
}
export type PlanStepDecisionType = 'approved' | 'rejected' | 'modified' | 'skipped'
export type PlanApprovalOverallDecision = 'approved_with_changes' | 'rejected' | 'approved'
export interface PlanStepDecision {
  stepId: string
  decision: PlanStepDecisionType
  modification?: string
  reason?: string
}
export type TakeoverResource = 'browser' | 'desktop' | 'cli' | 'file_editor'
export type TakeoverSessionStatus = 'active' | 'completed' | 'cancelled'
export type TakeoverActionType = 'click' | 'type' | 'scroll' | 'navigate' | 'run_command' | 'edit_file'
export interface TakeoverUserAction {
  type: TakeoverActionType
  payload: JsonObject
  timestamp: number
}
export type ResourceLockStatus = 'held' | 'released' | 'expired'
export type EmployeeRunEventType =
  | 'status'
  | 'phase'
  | 'checkpoint'
  | 'decision'
  | 'budget'
  | 'verification'
  | 'error'
export type TaskQueueStatus = 'active' | 'paused' | 'archived'
export type TaskQueueItemKind =
  | 'employee_run'
  | 'workflow_run'
  | 'software_command'
  | 'continuation_plan'
  | 'task_batch'
export type TaskQueueItemStatus = 'queued' | 'running' | 'complete' | 'failed' | 'canceled'
export type TaskBatchStatus = 'planned' | 'batched' | 'skipped'
export type WorkflowPartialRerunStatus = 'planned' | 'applied' | 'skipped'
export type TaskMergeSuggestionStatus = 'suggested' | 'approved' | 'rejected' | 'applied'
export type WorkflowTemplateInstantiationStatus = 'draft' | 'instantiated' | 'failed'
export type WorkflowTemplateParameterType = 'string' | 'number' | 'file' | 'url' | 'select' | 'boolean'
export interface WorkflowTemplateParameterDefinition {
  type: WorkflowTemplateParameterType
  label: string
  description: string
  default?: unknown
  required: boolean
  options?: Array<{ label: string; value: unknown }>
}
export type WorkflowTemplateParameterSchema = Record<string, WorkflowTemplateParameterDefinition>
export interface TaskBatchMergeable {
  sameAgent: boolean
  sameType: boolean
  sameProject: boolean
  crossAgent: boolean
}

export interface TaskBatchStrategy {
  windowMs: number
  maxBatchSize: number
  mergeable: TaskBatchMergeable
  exclusionRules: string[]
}

export interface TaskBatchBenefits {
  savedModelCalls: number
  savedCostCents: number
  savedCost: number
  savedTimeMs: number
  savedTime: string
}

export interface TaskBatchExclusionReason {
  taskQueueItemId: string
  reason: string
  rule: string
}
export type AcceptanceScenarioKey =
  | 'first_experience'
  | 'parallel_agents'
  | 'crash_recovery'
  | 'canvas_workflow'
  | 'approval_flow'
  | 'budget_control'
  | 'memory_learning'
  | 'security_boundary'
  | 'offline_degradation'
  | 'emergency_stop'
export type AcceptanceScenarioStatus = 'passed' | 'warning' | 'failed' | 'manual_required'

export interface AcceptanceScenarioStepResult {
  step: string
  status: AcceptanceScenarioStatus
  evidence: string[]
  gaps: string[]
}
export type TaskScheduleKind = 'task_queue_tick' | 'enqueue_due_continuations'
export type TaskScheduleStatus = 'active' | 'paused' | 'archived'
export type TaskTemplateParameterType = 'string' | 'number' | 'boolean' | 'file' | 'url' | 'select'
export type TaskTemplateStatus = 'active' | 'archived'
export type TaskTemplateRunStatus = 'planned' | 'queued' | 'completed' | 'failed'
export type RecoveryEventType =
  | 'checkpoint_saved'
  | 'resume_requested'
  | 'resume_completed'
  | 'resume_failed'
  | 'shutdown_notice'
export type RecoveryEventStatus = 'recorded' | 'complete' | 'failed'
export type ErrorTaxonomyCategory =
  | 'model_error'
  | 'tool_error'
  | 'network_error'
  | 'permission_error'
  | 'resource_error'
  | 'input_error'
  | 'environment_error'
  | 'rate_limit_error'
  | 'timeout_error'
export type ErrorSeverity = 'recoverable' | 'recoverable_with_help' | 'fatal'
export type RecoveryStrategyType =
  | 'retry'
  | 'retry_with_fallback_model'
  | 'retry_with_different_approach'
  | 'skip_step'
  | 'replan_from_scratch'
  | 'ask_user'
  | 'rollback'
  | 'delegate_to_agent'
export type RecoveryStrategyOutcome = 'succeeded' | 'failed' | 'skipped' | 'needs_user'
export type IdempotencyStatus = 'started' | 'completed' | 'failed'
export type DecisionRollbackGranularity =
  | 'single_decision'
  | 'step_decisions'
  | 'from_decision_onwards'
export type DecisionRollbackReasonType =
  | 'user_requested'
  | 'incorrect_outcome'
  | 'based_on_wrong_memory'
  | 'cascading_failure'
export type DecisionRollbackStatus = 'planned' | 'applied' | 'failed'

export interface DecisionRollbackScope {
  fileChanges: boolean
  memoryChanges: boolean
  cascadeToPeers: boolean
  knowledgeGraphChanges: boolean
}

export interface DecisionRollbackHistoryItem {
  decisionId: string
  rolledBackAt: number
  reason: string
  whatWasLost: string[]
  costOfRollbackCents: number
}

export interface DecisionRollbackRestartPlan {
  messageToAgent: string
  restartFromDecisionId: string
  replayContext: JsonObject
  blockedDecisionIds: string[]
  requiredUserReview: boolean
}
export type AgentMessageStatus = 'sent' | 'read' | 'archived'
export type AgentMessageType = 'handoff' | 'question' | 'status' | 'artifact' | 'warning'
export type AgentProtocolMessageType =
  | AgentMessageType
  | 'request'
  | 'response'
  | 'proposal'
export type AgentProtocolPriority = 'low' | 'normal' | 'high' | 'urgent'
export type AgentProtocolStatus = 'draft' | 'active' | 'deprecated'
export type AgentProtocolValidationStatus = 'valid' | 'invalid'
export type StreamProtocolMessageType = 'event' | 'request' | 'response' | 'error' | 'ping' | 'pong'
export type StreamProtocolTransport = 'websocket' | 'sse'
export type BlackboardScopeType = 'workflow_run' | 'project' | 'workspace' | 'global'
export type BlackboardEntryStatus = 'active' | 'superseded' | 'archived'
export type ConflictStatus = 'open' | 'resolved' | 'escalated'
export type ConflictEscalationAction =
  | 'automatic_negotiation'
  | 'meta_agent_arbitration'
  | 'notify_user'
  | 'pause_participants'
  | 'force_conservative_decision'
export type ConflictEscalationStatus = 'active' | 'waiting' | 'completed' | 'timed_out' | 'forced'
export type RealtimeCollabProtocol = 'segment_lock' | 'crdt' | 'ot'
export type RealtimeCollabResolution = 'user_wins' | 'agent_wins' | 'manual_merge'
export type RealtimeCollabStatus = 'active' | 'paused' | 'closed'
export type RealtimeParticipantType = 'user' | 'agent' | 'system'
export type RealtimeSegmentLockStatus = 'active' | 'released' | 'conflicted' | 'expired'
export type RealtimeEditOperationKind = 'insert' | 'delete' | 'replace'
export type RealtimeEditOperationStatus = 'queued' | 'applied' | 'conflict'
export type AlertComparison = 'gt' | 'gte' | 'lt' | 'lte' | 'eq'
export type AlertEventStatus = 'open' | 'acknowledged' | 'resolved'
export type ExternalMonitoringStatus = 'active' | 'disabled'
export type ExternalMonitoringLogFormat = 'json' | 'syslog'
export type ExternalMonitoringLogDestination = 'stdout' | 'file' | 'http' | 'elasticsearch'

export interface ExternalMonitoringLogExport {
  format: ExternalMonitoringLogFormat
  destination: ExternalMonitoringLogDestination
  structured: boolean
  redactSensitive: boolean
  target?: string | null
}
export type NotificationChannel = 'in_app' | 'desktop_notification' | 'email' | 'webhook'
export type NotificationLevel = 'info' | 'success' | 'warning' | 'critical'
export type NotificationStatus = 'unread' | 'read' | 'archived'
export type RetentionEntity =
  | 'run_log'
  | 'run_event'
  | 'artifact'
  | 'memory'
  | 'screenshot'
  | 'audit_log'
export type RetentionExpiryAction = 'delete' | 'archive' | 'anonymize' | 'ask_user'
export type StorageQuotaScope = 'agent' | 'project' | 'workspace'
export type StorageQuotaStatus = 'ok' | 'warning' | 'blocked'
export type PiiType = 'phone' | 'email' | 'id_number' | 'address' | 'name' | 'ip' | 'custom'
export type PiiDetectedBy = 'regex' | 'model' | 'user_marked'
export type PiiMarkerStatus = 'flagged' | 'reviewed' | 'redacted' | 'cleared'
export type DataExportScope = 'agent' | 'project' | 'workspace'
export type DataExportFormat = 'json' | 'yaml' | 'zip_manifest'
export type DataExportStatus = 'planned' | 'ready' | 'failed'
export type FeatureFlagStatus = 'development' | 'beta' | 'released' | 'deprecated'
export type FeatureFlagTargetUsers = 'all' | 'beta_testers' | 'internal' | 'by_user_id'
export type FeatureFlagEvaluationStatus = 'enabled' | 'disabled' | 'blocked'
export type DegradationResourceType =
  | 'model_profile'
  | 'mcp_server'
  | 'network_profile'
  | 'tool_connection'
  | 'browser_session'
  | 'external_api'
  | 'task_queue'
export type DegradationTrigger = 'offline' | 'health_failed' | 'timeout' | 'rate_limited' | 'manual'
export type DegradationAction =
  | 'use_fallback_model'
  | 'use_fallback_server'
  | 'use_direct_network'
  | 'mark_pending_retry'
  | 'pause_until_online'
  | 'keep_queue_state'
  | 'mark_unavailable'
export type DegradationEventStatus = 'planned' | 'applied' | 'blocked' | 'pending_retry'
export type UpdateCheckInterval = 'on_launch' | 'daily' | 'weekly'
export type UpdateChannel = 'stable' | 'beta' | 'nightly'
export type UpdateInstallMode = 'on_quit' | 'on_idle' | 'ask_user' | 'scheduled'
export type UpdateAgentsRunningStrategy =
  | 'wait_for_completion'
  | 'notify_user'
  | 'force_after_timeout'
export type MaintenanceWindowStatus = 'active' | 'completed' | 'failed'
export type DataMaintenancePolicyStatus = 'active' | 'disabled'
export type DataMaintenanceRunStatus = 'completed' | 'warning' | 'failed'
export type DataMaintenanceArchiveStrategy = 'compress' | 'delete' | 'summarize'
export type MemoryIntegrityPolicyStatus = 'active' | 'disabled'
export type MemoryIntegritySourceType =
  | 'agent_direct_observation'
  | 'user_explicit_instruction'
  | 'external_web_content'
  | 'inferred_from_task'
  | 'other_agent_shared'
  | 'external_file'
export type MemoryIntegrityDangerousAction = 'block_and_alert' | 'flag_for_review' | 'allow_with_warning'
export type MemoryIntegrityDecision = 'allowed' | 'warning' | 'blocked' | 'flagged'
export type NfrCategory = 'reliability' | 'usability' | 'compatibility' | 'security' | 'maintainability'
export type NfrRequirementStatus = 'active' | 'archived'
export type NfrEvaluationStatus = 'passed' | 'warning' | 'failed' | 'unknown'
export type NfrMetricOperator = 'lte' | 'gte' | 'eq' | 'contains' | 'exists'
export type KnownLimitationCategory =
  | 'desktop_automation'
  | 'parallel_agents'
  | 'mobile_operation'
  | 'native_dialogs'
  | 'browser_automation'
  | 'enterprise_network'
  | 'local_model'
  | 'long_running_task'
  | 'cluster'
  | 'voice'
export type KnownLimitationSeverity = 'info' | 'warning' | 'blocking'
export type KnownLimitationStatus = 'active' | 'resolved' | 'archived'
export type LimitationDisclosureSurface =
  | 'documentation'
  | 'onboarding'
  | 'agent_factory'
  | 'run_preflight'
  | 'approval'
  | 'settings'
export interface DataMaintenancePolicy {
  logRotation: {
    maxEventsPerRun: number
    olderThanDays: number
    archiveStrategy: DataMaintenanceArchiveStrategy
  }
  sqliteMaintenance: {
    schedule: string
    operations: Array<'backup' | 'integrity_check' | 'ANALYZE' | 'VACUUM' | 'REINDEX'>
  }
  workspaceGc: {
    trashRetentionDays: number
    cleanRunTempForStatuses: RunStatus[]
    removeEmptyDirs: boolean
    cleanBrowserSessionResidue: boolean
    preserve: string[]
  }
  browserProfiles: {
    clearCacheOnTaskEnd: boolean
    keepCookies: boolean
    warnSizeBytes: number
    archiveInactiveDays: number
  }
}
export interface MemoryIntegrityPolicy {
  beforeWrite: {
    sourceConfidenceMap: Record<MemoryIntegritySourceType, number>
    dangerousPatterns: string[]
    onDangerousPattern: MemoryIntegrityDangerousAction
    minimumAllowedConfidence: number
  }
  periodicScan: {
    intervalDays: number
    lowConfidenceThreshold: number
    contradictionScan: boolean
  }
}
export type OptimizationTarget =
  | 'minimize_cost'
  | 'maximize_speed'
  | 'maximize_quality'
  | 'maximize_safety'
  | 'balanced'
  | 'custom'
export type CustomMetricScope = 'workspace' | 'agent' | 'project' | 'global'
export type CustomMetricEvaluationStatus = 'ok' | 'warning' | 'approval_required' | 'blocked'
export type OnboardingSessionStatus =
  | 'started'
  | 'needs_selected'
  | 'agent_created'
  | 'demo_running'
  | 'completed'
  | 'skipped'
export type CapabilitySourceType =
  | 'skill'
  | 'mcp_server'
  | 'mcp_tool'
  | 'tool_connection'
  | 'cli_profile'
  | 'software_profile'
  | 'software_command'
  | 'software_command_run'
  | 'recorded_macro'
  | 'model_profile'
  | 'agent_profile'
  | 'memory_item'
  | 'knowledge_entity'
  | 'playbook'
export type KnowledgeNodeType =
  | 'capability'
  | 'agent'
  | 'skill'
  | 'tool'
  | 'model'
  | 'playbook'
  | 'person'
  | 'project'
  | 'software'
  | 'concept'
  | 'file'
  | 'error'
  | 'solution'
  | 'customer'
export type KnowledgeEdgeType =
  | 'represents'
  | 'uses'
  | 'requires'
  | 'produces'
  | 'similar_to'
  | 'recommended_for'
  | 'owned_by'
  | 'depends_on'
  | 'solves'
  | 'causes'
  | 'belongs_to'
  | 'prefers'
  | 'avoids'
  | 'alternative_to'
export type MemoryGraphNodeType =
  | 'memory'
  | 'agent'
  | 'project'
  | 'customer'
  | 'preference'
  | 'technology'
  | 'error'
  | 'solution'
  | 'topic'
export type MemoryGraphEdgeType =
  | 'belongs_to'
  | 'prefers'
  | 'used_in'
  | 'depends_on'
  | 'has_error'
  | 'solves'
  | 'similar_to'
  | 'mentions'
  | 'learned_by'
export type MemoryGraphViewStatus = 'generated' | 'exported'
export type MemoryGraphLayout = 'force' | 'hierarchical'
export type MemoryGraphExportFormat = 'json' | 'graphml_manifest'
export type MemoryDecayStatus = 'pinned' | 'fresh' | 'decaying' | 'expiring_soon' | 'expired'
export type MemoryDecayLineStyle = 'solid' | 'dashed'
export type MemoryDecayMarker = 'circle' | 'square'
export type MemoryDecayAction = 'pin' | 'delete_now' | 'update_content'
export type MemoryDecaySnapshotStatus = 'generated' | 'action_planned' | 'action_applied'

export interface MemoryGraphNode {
  id: string
  type: MemoryGraphNodeType
  label: string
  summary: string
  sourceMemoryId?: string | null
  agentProfileId?: string | null
  importance: number
  confidence: number
  size: number
  expired: boolean
  properties: Record<string, unknown>
}

export interface MemoryGraphEdge {
  id: string
  source: string
  target: string
  type: MemoryGraphEdgeType
  label: string
  confidence: number
  weight: number
  width: number
  evidenceMemoryIds: string[]
}

export interface MemoryDecayPoint {
  memoryItemId: string
  title: string
  type: MemoryType
  scope: MemoryScope
  agentProfileId: string | null
  importance: number
  confidence: number
  ageDays: number
  daysSinceUpdated: number
  expiresInDays: number | null
  x: number
  y: number
  status: MemoryDecayStatus
  lineStyle: MemoryDecayLineStyle
  marker: MemoryDecayMarker
  colorRole: 'core' | 'important' | 'temporary' | 'expiring' | 'expired'
  detailText: string
  actionSuggestions: MemoryDecayAction[]
}
export type AutonomyLevel =
  | 'observe_only'
  | 'propose_only'
  | 'execute_with_approval'
  | 'execute_low_risk'
  | 'fully_autonomous'
export type AutonomyActionType =
  | 'read_file'
  | 'write_file'
  | 'delete_file'
  | 'run_command'
  | 'install_dependency'
  | 'network_request'
  | 'browser_operation'
  | 'desktop_operation'
  | 'software_command'
  | 'mcp_tool'
  | 'cli_profile'
  | 'mobile_operation'
  | 'login'
  | 'payment'
  | 'send_message'
  | 'system_setting'
export type AutonomyDecisionStatus = 'allowed' | 'requires_approval' | 'blocked'
export type AgentProbationStatus = 'probation' | 'eligible_for_promotion' | 'graduated' | 'blocked'
export type AgentDeploymentEnvironment = 'staging' | 'production'
export type AgentRiskTier = 'low' | 'medium' | 'high' | 'critical'
export type AgentEnvironmentPromotionStatus = 'requested' | 'approved' | 'rejected' | 'promoted'
export type DynamicPermissionDuration = 'single_operation' | 'this_step' | 'this_task'
export type DynamicPermissionGrantStatus =
  | 'requested'
  | 'granted'
  | 'requires_approval'
  | 'rejected'
  | 'revoked'
  | 'downgraded'
  | 'expired'
export type VoiceInputMode = 'push_to_talk' | 'always_listening' | 'wake_word'
export type TtsEngine = 'system' | 'openai_tts' | 'elevenlabs' | 'custom'
export type VoiceSpeakOn = 'task_complete' | 'approval_needed' | 'error' | 'milestone'
export type VoiceProfileStatus = 'draft' | 'active' | 'disabled'
export type VoiceConversationSpeaker = 'user' | 'agent' | 'system'
export type VoiceConversationTurnStatus = 'captured' | 'planned' | 'delivered'
export type LocalIpcEncryption = 'none' | 'tls_local'
export type RemoteCommunicationEncryption = 'tls_1_3'
export type E2EEncryptionPolicyStatus = 'draft' | 'active' | 'disabled'
export type E2EEncryptionCheckScope = 'local_ipc' | 'remote_communication' | 'data_export'
export type E2EEncryptionCheckStatus = 'ok' | 'warning' | 'blocked'
export type ConcurrencyProfileStatus = 'active' | 'disabled'
export type ConcurrencyMemoryTier = 'low_memory' | 'mid_memory' | 'high_memory' | 'workstation'
export type ConcurrencyEvaluationStatus = 'ok' | 'throttled' | 'blocked'
export type AbusePreventionSeverity = 'none' | 'light' | 'moderate' | 'severe' | 'critical'
export type AbusePreventionAction =
  | 'none'
  | 'warn_user'
  | 'pause_agent_and_warn'
  | 'stop_and_quarantine_agent'
  | 'stop_all_and_notify_admin'
export type AbusePreventionPolicyStatus = 'active' | 'disabled'
export type AbuseAppealStatus = 'submitted' | 'approved' | 'rejected'
export type FutureTechCapabilityKind =
  | 'compute_provider'
  | 'computer_use'
  | 'reinforcement_learning'
  | 'model_router'
  | 'os_integration'
  | 'organization_service'
  | 'proactive_agent'
export type FutureTechReadiness = 'planned' | 'reserved' | 'experimental' | 'ready'
export type FutureTechStage = 'v1_now' | 'v2_near' | 'v3_mid' | 'v4_far'
export type FutureTechRadarStatus = 'planned' | 'in_progress' | 'available' | 'blocked'
export type CommercialPlanKey = 'community' | 'professional' | 'team' | 'enterprise'
export type CommercialBillingPeriod = 'free' | 'monthly' | 'per_user_monthly' | 'custom'
export type CommercialPlanStatus = 'active' | 'disabled'
export type RevenueStreamType =
  | 'subscription'
  | 'enterprise_service'
  | 'marketplace_commission'
  | 'compute_resale'
  | 'certification'
export type RevenueStreamStatus = 'active' | 'future' | 'disabled'
export type CommercialPolicyRuleType = 'allowed_revenue' | 'forbidden_practice'
export type CommercialPolicySeverity = 'info' | 'warning' | 'critical'
export type SourceLicenseLayer = 'core_mit' | 'plus_commercial' | 'community_author'
export type OpenSourceGovernanceStatus = 'active' | 'disabled'
export type GovernanceRoleType =
  | 'maintainer'
  | 'contributor'
  | 'community_manager'
  | 'plugin_author'
export type GovernanceRfcStatus =
  | 'rfc'
  | 'discussion'
  | 'maintainer_vote'
  | 'implementation'
  | 'accepted'
  | 'rejected'
export type ContributorTool = 'node' | 'rust' | 'python' | 'git' | 'chrome'
export type ContributionPolicyType =
  | 'getting_started'
  | 'project_structure'
  | 'commit_convention'
  | 'branch_rule'
  | 'review_rule'
export type ArchitecturePatternKey =
  | 'event_bus'
  | 'command'
  | 'strategy'
  | 'observer'
  | 'responsibility_chain'
  | 'repository'
  | 'factory'
  | 'state'
export type TechnicalArchitectureArea =
  | 'stack'
  | 'process'
  | 'database'
  | 'data_flow'
export type TechnicalArchitectureCheckStatus = 'passed' | 'warning' | 'failed'
export type TechnicalArchitectureEvaluationStatus = TechnicalArchitectureCheckStatus
export interface TechnicalArchitectureCheck {
  key: string
  area: TechnicalArchitectureArea
  title: string
  expected: string
  actual: string
  status: TechnicalArchitectureCheckStatus
  required: boolean
  evidence: string[]
}
export interface TechnicalArchitectureManifest {
  version: string
  selectedDesktopShell: 'electron_node' | 'tauri_rust' | 'web_only'
  frontendStack: {
    framework: string
    language: string
    state: string
    styling: string
    canvas: string
    editor: string
  }
  backendStack: {
    runtime: string
    embeddedServer: string
    database: string
    vectorStore: string
    eventBus: string
    childProcess: string
    encryption: string
    browserEngine: string
  }
  processArchitecture: {
    mainProcess: string[]
    rendererProcess: string[]
    runtimeManagers: string[]
  }
  supplementalTables: Record<string, string[]>
  dataFlow: string[]
}
export interface TechnicalArchitectureSummary {
  totalChecks: number
  passed: number
  warnings: number
  failed: number
  requiredFailed: number
  status: TechnicalArchitectureEvaluationStatus
}
export type ErrorCodeCategory = 'M' | 'T' | 'A' | 'W' | 'R' | 'F' | 'S' | 'N' | 'SY'
export type ErrorCodeSeverity = 'info' | 'warning' | 'error' | 'critical'
export type EntityStateMachineType = 'agent' | 'task_run' | 'workflow' | 'memory' | 'skill'
export type PromptAntiPatternRuleKey =
  | 'too_long'
  | 'contradictory_instruction'
  | 'vague_language'
  | 'internal_jargon'
  | 'missing_examples'
  | 'missing_must_rules'
export type ResourceType =
  | 'physical_mouse_keyboard'
  | 'browser_profile'
  | 'workspace_path'
  | 'file_path'
  | 'software_instance'
  | 'mobile_device'
  | 'network_profile'
export type OSInterferenceSourceType = 'system_popup' | 'application_popup' | 'screen_state'
export type OSInterferenceSignal =
  | 'uac_prompt'
  | 'firewall_prompt'
  | 'system_update_prompt'
  | 'low_battery'
  | 'disk_space_low'
  | 'save_changes_dialog'
  | 'app_update_dialog'
  | 'file_modified_dialog'
  | 'crash_report_dialog'
  | 'print_dialog'
  | 'native_file_picker'
  | 'screen_saver'
  | 'screen_locked'
  | 'display_sleep'
  | 'fast_user_switch'
  | 'rdp_disconnected'
  | 'rdp_reconnected'
  | 'none'
export type OSPowerState = 'ac' | 'battery' | 'low_battery' | 'critical'
export type OSInterferenceAction =
  | 'continue'
  | 'pause_all_agents'
  | 'continue_headless'
  | 'notify_user'
  | 'skip_action'
  | 'escalate'
  | 'attempt_close'
  | 'take_screenshot_and_ask'
  | 'hibernate_agents'
  | 'pause_ui_agents'
  | 'continue_headless_only'
  | 'use_cli_or_api_instead'
export type OSInterferenceEventStatus = 'observed' | 'handled' | 'blocked' | 'needs_user'
export interface OSInterferencePolicy {
  onScreenLocked: 'pause_all_agents' | 'continue_headless' | 'notify_user'
  onUacPrompt: 'skip_action' | 'notify_user' | 'escalate'
  onSystemDialog: 'attempt_close' | 'skip_action' | 'take_screenshot_and_ask'
  onLowBattery: 'pause_all_agents' | 'continue' | 'hibernate_agents'
  onRemoteSession: 'pause_ui_agents' | 'continue_headless_only'
  nativeFilePickerStrategy: 'use_cli_or_api_instead' | 'take_screenshot_and_ask'
}
export interface OSInterferenceMonitorSnapshot {
  screenSaverActive?: boolean
  screenLocked?: boolean
  uacPromptVisible?: boolean
  systemDialogDetected?: boolean
  nativeFilePickerVisible?: boolean
  remoteSessionActive?: boolean
  rdpDisconnected?: boolean
  powerState?: OSPowerState
  diskSpaceLow?: boolean
  applicationDialog?: string
}
export type FileBoundaryPlatform = 'windows' | 'linux' | 'macos'
export type FileBoundaryOperation = 'read' | 'write' | 'create' | 'delete' | 'execute'
export type FileBoundaryRiskType =
  | 'encoding'
  | 'line_ending'
  | 'bom'
  | 'path_length'
  | 'file_lock'
  | 'large_file'
  | 'binary_file'
  | 'special_filename'
export type FileBoundarySeverity = 'info' | 'warning' | 'high' | 'blocked'
export type FileBoundaryAction =
  | 'allow_full_read'
  | 'stream_summary'
  | 'metadata_only'
  | 'block'
  | 'normalize_filename'
  | 'wait_or_notify'
  | 'use_shadow_copy'
  | 'shorten_workspace_root'
  | 'strip_bom'
  | 'transcode_utf8'
  | 'normalize_line_endings'
export type FileBoundaryEvaluationStatus = 'safe' | 'warning' | 'needs_user' | 'blocked'
export interface FileEncodingPolicy {
  defaultEncoding: 'utf-8'
  defaultLineEnding: 'lf' | 'crlf' | 'platform-native'
  defaultBOM: boolean
  autoDetect: {
    encoding: boolean
    lineEnding: boolean
    BOM: boolean
  }
  binaryExtensions: string[]
  encodingOverrides: Record<string, string>
}
export interface LargeFilePolicy {
  thresholds: {
    smallBytes: number
    mediumBytes: number
    largeBytes: number
  }
  mediumStrategy: 'stream_summary'
  largeStrategy: 'metadata_only'
  hugeStrategy: 'block'
}
export interface FileSystemBoundaryPolicy {
  encoding: FileEncodingPolicy
  pathLength: {
    windowsMaxPath: number
    warnAt: number
    shallowWorkspaceRoot: string
    longPathsEnabledRequired: boolean
    fallbackToShortPath: boolean
  }
  fileLock: {
    checkBeforeWrite: boolean
    maxWaitMs: number
    onLocked: 'wait_or_notify' | 'use_shadow_copy'
  }
  largeFile: LargeFilePolicy
  filename: {
    windowsForbiddenPattern: string
    replacement: string
    stripEmoji: boolean
    maxNameLength: number
    shellEscapeSpaces: boolean
  }
}
export interface FileSystemBoundaryInput {
  path?: string
  fileName?: string
  extension?: string
  fileSizeBytes?: number
  encoding?: string
  hasBom?: boolean
  lineEnding?: 'lf' | 'crlf' | 'mixed'
  isBinary?: boolean
  operation: FileBoundaryOperation
  platform?: FileBoundaryPlatform
  lockDetected?: boolean
}
export interface FileBoundaryRisk {
  type: FileBoundaryRiskType
  severity: FileBoundarySeverity
  message: string
  action: FileBoundaryAction
}
export type BrowserAutomationTrapType =
  | 'extension_interference'
  | 'rendering_difference'
  | 'captcha_or_bot_detection'
export type BrowserAutomationSignal =
  | 'ad_blocker_extension'
  | 'password_manager_extension'
  | 'translation_extension'
  | 'writing_assistant_extension'
  | 'unknown_extension'
  | 'dpi_scaling'
  | 'browser_zoom'
  | 'dark_mode'
  | 'gpu_rendering'
  | 'color_profile'
  | 'font_rendering'
  | 'cloudflare_challenge'
  | 'recaptcha'
  | 'hcaptcha'
  | 'bot_detection'
  | 'image_locator_only'
  | 'pixel_comparison'
  | 'none'
export type BrowserAutomationTrapAction =
  | 'continue'
  | 'use_clean_profile'
  | 'disable_extensions'
  | 'set_zoom_100'
  | 'set_fixed_viewport'
  | 'prefer_selector_locator'
  | 'use_ssim_comparison'
  | 'pause_and_notify_user'
  | 'reuse_session_after_user_approval'
export type BrowserAutomationTrapStatus = 'safe' | 'warning' | 'needs_user' | 'blocked'
export interface BrowserAutomationTrapPolicy {
  extensionPolicy: {
    cleanProfileRequired: boolean
    disableExtensionsByDefault: boolean
    knownInterferingExtensions: string[]
  }
  renderingPolicy: {
    zoomPercent: number
    viewport: { width: number; height: number }
    deviceScaleFactor: number
    comparisonStrategy: 'ssim' | 'pixel' | 'ocr'
    locatorPreference: 'selector_first' | 'xpath_first' | 'image_first'
    colorScheme: 'light' | 'dark' | 'system'
  }
  botDetectionPolicy: {
    onCaptcha: 'pause_and_notify_user'
    allowThirdPartySolvers: boolean
    allowSessionReuseWithApproval: boolean
    minHumanDelayMs: number
    maxHumanDelayMs: number
    bypassProhibited: boolean
  }
}
export interface BrowserAutomationTrapInput {
  extensionsDetected?: string[]
  browserZoom?: number
  deviceScaleFactor?: number
  viewport?: { width: number; height: number }
  colorScheme?: 'light' | 'dark' | 'system'
  gpuAcceleration?: boolean
  captchaDetected?: 'cloudflare' | 'recaptcha' | 'hcaptcha' | 'generic' | false
  botDetectionMessage?: string
  locatorStrategy?: 'css' | 'xpath' | 'image' | 'ocr'
  screenshotComparison?: 'pixel' | 'ssim' | 'ocr'
}
export interface BrowserAutomationTrapRisk {
  type: BrowserAutomationTrapType
  signal: BrowserAutomationSignal
  severity: 'info' | 'warning' | 'needs_user' | 'blocked'
  message: string
  action: BrowserAutomationTrapAction
}
export type EnterpriseProxyType = 'http' | 'https' | 'socks5' | 'pac' | 'system'
export type EnterpriseProxyAuth = 'none' | 'basic' | 'ntlm' | 'kerberos' | 'negotiate'
export type EnterpriseCertificateIssue =
  | 'self_signed'
  | 'corporate_ca'
  | 'ssl_interception'
  | 'missing_ca_bundle'
  | 'none'
export type EnterpriseNetworkRiskType = 'proxy' | 'proxy_auth' | 'pac' | 'certificate' | 'no_proxy'
export type EnterpriseNetworkAction =
  | 'continue'
  | 'use_system_proxy'
  | 'configure_node_proxy_agent'
  | 'configure_browser_proxy'
  | 'install_requests_ntlm'
  | 'set_node_extra_ca_certs'
  | 'set_ssl_cert_file'
  | 'set_requests_ca_bundle'
  | 'manual_trust_certificate'
  | 'ask_it_admin'
export type EnterpriseNetworkStatus = 'safe' | 'warning' | 'needs_user' | 'blocked'
export interface EnterpriseNetworkPolicy {
  proxy: {
    preferSystemProxy: boolean
    supportedTypes: EnterpriseProxyType[]
    supportedAuth: EnterpriseProxyAuth[]
    requireSecretRefForPasswords: boolean
    defaultNoProxy: string[]
    ntlmRequiresRequestsNtlm: boolean
    nodeRequiresProxyAgent: boolean
    browserProxyInjection: boolean
  }
  certificates: {
    useSystemCertStoreForBrowser: boolean
    cliEnvVars: string[]
    manualTrustRequiresApproval: boolean
    rejectUnauthorizedBypassProhibited: boolean
  }
}
export interface EnterpriseNetworkInput {
  proxyType?: EnterpriseProxyType
  proxyUrl?: string
  auth?: EnterpriseProxyAuth
  username?: string
  passwordRef?: string
  domain?: string
  pacUrl?: string
  noProxy?: string[]
  needsBrowserProxy?: boolean
  needsNodeProxy?: boolean
  needsPythonRequests?: boolean
  certificateIssues?: EnterpriseCertificateIssue[]
  caBundlePath?: string
  sslInspectionDetected?: boolean
  targetUrl?: string
}
export interface EnterpriseNetworkRisk {
  type: EnterpriseNetworkRiskType
  severity: 'info' | 'warning' | 'needs_user' | 'blocked'
  message: string
  action: EnterpriseNetworkAction
}
export type OutputConsistencyArtifactType = 'code' | 'document' | 'report' | 'json' | 'spreadsheet' | 'image'
export type OutputLanguage = 'zh-CN' | 'en-US' | 'ja-JP' | 'auto'
export type OutputConsistencyRiskType =
  | 'wrong_language'
  | 'mixed_language'
  | 'comment_language'
  | 'formatter_missing'
  | 'formatter_failed'
export type OutputConsistencyAction =
  | 'continue'
  | 'normalize_output_language'
  | 'use_english_code_comments'
  | 'run_formatter'
  | 'warn_manual_format'
  | 'reject_artifact'
export type OutputConsistencyStatus = 'passed' | 'warning' | 'rejected'
export interface OutputConsistencyPolicy {
  language: {
    outputLanguage: OutputLanguage
    commentLanguage: 'same_as_output' | 'english'
    detectMixedLanguage: boolean
    enforceConsistency: boolean
  }
  codeStyle: {
    formatters: Record<string, string>
    onFormatFail: 'warn' | 'reject_artifact'
  }
}
export interface OutputConsistencyInput {
  artifactType: OutputConsistencyArtifactType
  content?: string
  fileName?: string
  expectedLanguage?: OutputLanguage
  detectedLanguages?: OutputLanguage[]
  detectedCommentLanguages?: OutputLanguage[]
  formatterResults?: Record<string, 'passed' | 'failed' | 'missing'>
}
export interface OutputConsistencyRisk {
  type: OutputConsistencyRiskType
  severity: 'info' | 'warning' | 'rejected'
  message: string
  action: OutputConsistencyAction
}
export type ResourceGovernorSignal =
  | 'cpu_pressure'
  | 'gpu_pressure'
  | 'memory_pressure'
  | 'disk_io_pressure'
  | 'network_pressure'
  | 'battery_mode'
  | 'low_battery'
  | 'critical_battery'
  | 'thermal_pressure'
  | 'none'
export type ResourceGovernorAction =
  | 'continue'
  | 'throttle'
  | 'pause_low_priority'
  | 'notify_user'
  | 'reduce_concurrency'
  | 'use_cheaper_model'
  | 'increase_checkpoint_frequency'
  | 'disable_local_llm'
  | 'slow_browser_actions'
  | 'force_checkpoint'
  | 'show_tray_resource_status'
export type ResourceGovernorStatus = 'safe' | 'throttled' | 'paused' | 'needs_user'
export interface ResourceGovernorPolicy {
  quotas: {
    maxTotalCPUPercent: number
    maxPerAgentCPUPercent: number
    maxTotalMemoryMB: number
    maxPerAgentMemoryMB: number
    maxTotalGPUVRAMMB: number
    maxPerAgentGPUVRAMMB: number
    maxTotalNetworkKBps: number
    maxDiskIOKBps: number
  }
  priorities: {
    foregroundAgentBoost: number
    backgroundAgentThrottle: number
  }
  battery: {
    maxConcurrentAgentsOnBattery: number
    lowBatteryPercent: number
    criticalBatteryPercent: number
    disableLocalLLMOnBattery: boolean
    checkpointEveryStepsOnBattery: number
  }
  thermal: {
    highCPUTempC: number
    highGPUTempC: number
    onThermalPressure: 'throttle' | 'pause_low_priority' | 'notify_user'
    trayStatusRequired: boolean
  }
  onResourcePressure: 'throttle' | 'pause_low_priority' | 'notify_user'
}
export interface ResourceGovernorSnapshot {
  totalCPUPercent?: number
  perAgentCPUPercent?: Record<string, number>
  totalMemoryMB?: number
  perAgentMemoryMB?: Record<string, number>
  totalGPUVRAMMB?: number
  perAgentGPUVRAMMB?: Record<string, number>
  totalNetworkKBps?: number
  diskIOKBps?: number
  activeAgentCount?: number
  foregroundAgentId?: string
  powerSource?: 'ac' | 'battery'
  batteryPercent?: number
  cpuTempC?: number
  gpuTempC?: number
}
export interface ResourceGovernorDecision {
  signal: ResourceGovernorSignal
  severity: 'info' | 'warning' | 'critical'
  message: string
  actions: ResourceGovernorAction[]
  affectedAgentIds: string[]
}
export type GlobalOSIntegrationOperation = 'clipboard' | 'window_focus' | 'native_dialog'
export type NativeDialogKind = 'file_picker' | 'print_dialog' | 'color_picker' | 'unknown'
export type GlobalOSIntegrationSignal =
  | 'system_clipboard_required'
  | 'clipboard_can_be_virtualized'
  | 'user_active_focus_risk'
  | 'foreground_required'
  | 'headless_available'
  | 'native_file_picker'
  | 'native_print_dialog'
  | 'native_color_picker'
  | 'native_dialog_unknown'
  | 'none'
export type GlobalOSIntegrationAction =
  | 'continue'
  | 'use_virtual_clipboard'
  | 'dispatch_direct_input'
  | 'backup_and_restore_clipboard'
  | 'delay_until_user_idle'
  | 'run_headless'
  | 'run_in_background'
  | 'inject_file_input'
  | 'use_pdf_generation_api'
  | 'use_css_color_injection'
  | 'ask_user_assistance'
  | 'mark_needs_user'
export type GlobalOSIntegrationStatus = 'safe' | 'delayed' | 'needs_user' | 'blocked'
export interface GlobalOSIntegrationPolicy {
  clipboard: {
    preferVirtualClipboard: boolean
    preferDirectInputDispatch: boolean
    allowSystemClipboardWithBackup: boolean
    maxSystemClipboardUseMs: number
  }
  focus: {
    preferHeadless: boolean
    preferBackground: boolean
    recentUserInputThresholdMs: number
    foregroundDelayWhenUserActive: boolean
  }
  nativeDialogs: {
    filePickerStrategy: 'inject_file_input' | 'ask_user_assistance'
    printStrategy: 'use_pdf_generation_api' | 'ask_user_assistance'
    colorPickerStrategy: 'use_css_color_injection' | 'ask_user_assistance'
    unknownDialogStrategy: 'mark_needs_user'
  }
}
export interface GlobalOSIntegrationInput {
  operation: GlobalOSIntegrationOperation
  requiresSystemClipboard?: boolean
  canUseVirtualClipboard?: boolean
  canDispatchDirectInput?: boolean
  foregroundRequired?: boolean
  headlessAvailable?: boolean
  backgroundAvailable?: boolean
  userIdleMs?: number
  nativeDialogKind?: NativeDialogKind
  canInjectFileInput?: boolean
  canUsePdfApi?: boolean
  canUseCssInjection?: boolean
}
export interface GlobalOSIntegrationDecision {
  signal: GlobalOSIntegrationSignal
  severity: 'info' | 'warning' | 'needs_user' | 'blocked'
  message: string
  action: GlobalOSIntegrationAction
}
export type TelemetryLevel = 'minimal' | 'usage' | 'performance' | 'full' | 'off'
export type TelemetryNeverCollectCategory =
  | 'api_keys'
  | 'user_files'
  | 'agent_outputs'
  | 'memory_content'
  | 'browser_screenshots'
  | 'clipboard_data'
  | 'credentials'
export type TelemetryDecisionStatus = 'allowed' | 'redacted' | 'blocked' | 'disabled'
export interface TelemetryPolicy {
  level: TelemetryLevel
  requiresExplicitConsent: boolean
  defaultOptIn: boolean
  consentGranted: boolean
  minimal: {
    appVersion: string
    os: string
    anonymousInstallId: string
    crashReports: boolean
  }
  usage: {
    agentsCreated: number
    tasksRun: number
    workflowsCreated: number
  }
  performance: {
    avgTaskDuration: number
    modelLatency: number
  }
  full: {
    errorTraces: boolean
  }
  neverCollect: TelemetryNeverCollectCategory[]
  exportable: boolean
}
export interface TelemetryEventInput {
  level: TelemetryLevel
  eventType: string
  payload: JsonObject
  contains?: TelemetryNeverCollectCategory[]
}
export interface TelemetryDecision {
  status: TelemetryDecisionStatus
  reason: string
  allowedPayload: JsonObject
  blockedFields: string[]
  redactedFields: string[]
  collectedLevel: TelemetryLevel
}
export type ModelInvocationTaskType =
  | 'code_generation'
  | 'creative_writing'
  | 'analysis'
  | 'planning'
  | 'tool_selection'
  | 'summarization'
  | 'task_planning'
  | 'creative_generation'
  | 'safety_critical'
  | 'other'
export type ModelCacheStrategy = 'exact' | 'semantic' | 'none'
export type ModelCacheEvaluationStatus = 'hit' | 'miss' | 'miss_stored' | 'bypassed'
export type ModelWarmupStatus = 'warming' | 'warmed' | 'failed'
export type ModelOptimizationEventType =
  | 'cache_hit'
  | 'cache_miss'
  | 'cache_bypass'
  | 'parameters_resolved'
  | 'warmup_started'
  | 'warmup_completed'
export interface ModelParameterValues {
  temperature: number
  topP: number
}
export interface ModelInvocationOptimizationPolicy {
  responseCache: {
    strategy: ModelCacheStrategy
    exactTTL: number
    semanticTTL: number
    similarityThreshold: number
    noCacheFor: ModelInvocationTaskType[]
    stats: { hits: number; misses: number; savedCost: number }
  }
  parameters: {
    byTaskType: Record<ModelInvocationTaskType, ModelParameterValues>
    agentOverrides?: Record<string, Partial<Record<ModelInvocationTaskType, ModelParameterValues>>>
  }
  warmup: {
    autoWarmupAfterAgentCreated: boolean
    warmupRequest: string
    cacheConnection: boolean
    displayStatus: string
    connectionPool: {
      keepHttp2Alive: boolean
      avoidRepeatedTlsHandshake: boolean
      maxIdleMs: number
    }
  }
}
export type RuntimeTimeoutKind = 'waiting_for_approval' | 'agent_idle' | 'agent_stuck'
export type RuntimeTimeoutAction =
  | 'auto_reject'
  | 'keep_waiting'
  | 'escalate'
  | 'hibernate'
  | 'do_nothing'
  | 'suggest_tasks'
  | 'ask_user'
  | 'replan'
export type RuntimeBusyAction =
  | 'queue_after_current'
  | 'safe_pause_and_preempt'
  | 'delegate_to_other_agent'
  | 'ask_user'
export type RuntimeMicroOperationDecisionType = 'idle_timeout' | 'busy_task'
export type RuntimeMicroOperationDecisionStatus =
  | 'continue'
  | 'planned'
  | 'queued'
  | 'delegated'
  | 'needs_user'
  | 'escalated'
export type ScheduledActionStatus = 'scheduled' | 'due' | 'queued' | 'completed' | 'canceled'
export type AgentInboxItemType =
  | 'user_message'
  | 'agent_help'
  | 'system_notification'
  | 'approval_result'
  | 'task_assignment'
export type AgentInboxItemStatus = 'unread' | 'processing' | 'done' | 'dismissed'
export interface RuntimeMicroOperationPolicy {
  idleTimeout: {
    waitingForApproval: {
      timeout: number
      onTimeout: Extract<RuntimeTimeoutAction, 'auto_reject' | 'keep_waiting' | 'escalate'>
    }
    agentIdle: {
      timeout: number
      onTimeout: Extract<RuntimeTimeoutAction, 'hibernate' | 'do_nothing' | 'suggest_tasks'>
    }
    agentStuck: {
      noProgressSteps: number
      timeout: number
      onTimeout: Extract<RuntimeTimeoutAction, 'ask_user' | 'replan' | 'escalate'>
    }
  }
  busyBehavior: {
    defaultAction: RuntimeBusyAction
    highPriorityAction: RuntimeBusyAction
    delegateWhenOtherAgentCapable: boolean
    askUserBeforeInterrupting: boolean
    priorityPreemptDelta: number
  }
  delayedActions: {
    wakeHibernatingAgent: boolean
    queueWhenBusy: boolean
  }
  inbox: {
    processWhenIdle: boolean
    priorityOrder: AgentInboxItemType[]
  }
}
export type MultimodalInputKind =
  | 'text'
  | 'image'
  | 'screenshot'
  | 'audio'
  | 'video_frame'
  | 'structured'
export type MultimodalOutputKind =
  | 'text'
  | 'code_diff'
  | 'screenshot'
  | 'chart'
  | 'recording'
  | 'report'
  | 'audio_summary'
export type MultimodalIoStatus = 'registered' | 'validated' | 'rejected'
export interface OutputAccessibilityPolicy {
  html?: {
    requireAltText?: boolean
    requireSemanticHTML?: boolean
    requireARIALabels?: boolean
    checkColorContrast?: boolean
  }
  documents?: {
    requireHeadings?: boolean
    requireDescriptiveLinks?: boolean
  }
  images?: {
    generateAltText?: boolean
    suggestColorBlindPalette?: boolean
  }
}
export type StyleGuideStatus = 'active' | 'archived'
export type StyleGuideBindingStatus = 'active' | 'superseded' | 'disabled'
export type StyleGuideSentenceLength = 'short' | 'medium' | 'varied'
export type StyleGuideIndentStyle = 'space' | 'tab'
export type StyleGuideQuotes = 'single' | 'double'
export type StyleGuideNamingConvention = 'camelCase' | 'PascalCase' | 'snake_case'
export type AgentPersonality =
  | 'creative'
  | 'cautious'
  | 'user_advocate'
  | 'security'
  | 'performance'
  | 'operator'
  | 'custom'
export type AgentRiskPosture = 'bold' | 'balanced' | 'conservative'
export type AgentDiversityProfileStatus = 'active' | 'archived'
export type DiversityScopeType = 'team' | 'workflow' | 'project' | 'workspace'
export type AgentInterviewStatus = 'scheduled' | 'completed' | 'needs_revision' | 'failed'
export type AgentInterviewDecision = 'start_trial' | 'revise_prompt' | 'reject'
export type PerformanceReviewStatus = 'draft' | 'ready_for_review' | 'applied' | 'dismissed'
export type AgentMentorshipScope = 'all_tasks' | 'specific_task_types' | 'until_proficiency'
export type AgentMentorshipStyle = 'review_and_feedback' | 'pair_execution' | 'shadow_mode'
export type AgentMentorshipStatus = 'active' | 'paused' | 'graduated' | 'archived'
export type AgentMentoringEventType =
  | 'review_output'
  | 'intervene_when_stuck'
  | 'share_memory'
  | 'generate_practice_task'
  | 'progress_update'
export type UserOverrideCommand =
  | 'STOP'
  | 'UNDO'
  | 'PAUSE'
  | 'NEVER_DO_THIS_AGAIN'
  | 'IGNORE_PREVIOUS_INSTRUCTION'
export type UserOverrideTargetType =
  | 'global'
  | 'workspace'
  | 'agent_profile'
  | 'employee_run'
  | 'workflow_run'
  | 'task_queue'
  | 'resource'
export type UserOverrideTrigger = 'ui' | 'api' | 'hotkey' | 'tray' | 'cli' | 'system'
export type UserOverrideStatus = 'recorded' | 'applied' | 'failed'
export type AgentEnvironmentMountMode = 'ro' | 'rw'
export interface AgentEnvironmentMount {
  agentPath: string
  realPath: string
  mode: AgentEnvironmentMountMode
}
export interface AgentEnvironment {
  fs: {
    home: string
    workspace: string
    mounts: AgentEnvironmentMount[]
    userHomeVisible: boolean
  }
  env: {
    whitelist: string[]
    visible: Record<string, string>
    custom: Record<string, string>
    secrets: Record<string, string>
    redactedSecretNames: string[]
  }
  network: {
    proxy?: string
    dns?: string
    allowedDomains: string[]
  }
  isolation: {
    globalEnvVisible: boolean
    userHomeVisible: boolean
    secretValuesExposed: boolean
  }
}

export type JsonObject = Record<string, unknown>
export interface CanvasPosition {
  x: number
  y: number
}

export const networkProfiles = sqliteTable('network_profiles', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  mode: text('mode').$type<NetworkMode>().notNull().default('direct'),
  proxyUrl: text('proxy_url'),
  bindInterface: text('bind_interface'),
  regionLabel: text('region_label'),
  appliesTo: text('applies_to').$type<NetworkAppliesTo>().notNull().default('model_only'),
  healthStatus: text('health_status').$type<HealthStatus>().notNull().default('unknown'),
  lastTestResult: text('last_test_result'),
  lastCheckedAt: integer('last_checked_at'),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
})

export const modelProfiles = sqliteTable(
  'model_profiles',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    provider: text('provider').$type<ModelProfileProvider>().notNull(),
    baseUrl: text('base_url').notNull(),
    apiKeyRef: text('api_key_ref').notNull(),
    model: text('model').notNull(),
    contextWindow: integer('context_window'),
    supportsVision: integer('supports_vision', { mode: 'boolean' }).notNull().default(false),
    supportsToolCalling: integer('supports_tool_calling', { mode: 'boolean' }).notNull().default(false),
    supportsJsonMode: integer('supports_json_mode', { mode: 'boolean' }).notNull().default(false),
    networkProfileId: text('network_profile_id').references(() => networkProfiles.id, {
      onDelete: 'set null',
    }),
    healthStatus: text('health_status').$type<HealthStatus>().notNull().default('unknown'),
    lastTestResult: text('last_test_result'),
    lastCheckedAt: integer('last_checked_at'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [index('idx_model_profiles_provider').on(t.provider)],
)

export const modelConnectionTests = sqliteTable(
  'model_connection_tests',
  {
    id: text('id').primaryKey(),
    modelProfileId: text('model_profile_id').references(() => modelProfiles.id, {
      onDelete: 'set null',
    }),
    mode: text('mode').$type<ModelConnectionTestMode>().notNull().default('dry_run'),
    status: text('status').$type<HealthStatus>().notNull(),
    latencyMs: integer('latency_ms'),
    message: text('message').notNull(),
    capabilityChecks: text('capability_checks', { mode: 'json' }).$type<JsonObject>().notNull().default(sql`'{}'`),
    networkProfileId: text('network_profile_id').references(() => networkProfiles.id, {
      onDelete: 'set null',
    }),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [
    index('idx_model_connection_tests_profile').on(t.modelProfileId, t.createdAt),
    index('idx_model_connection_tests_status').on(t.status),
  ],
)

export const modelRouteDecisions = sqliteTable(
  'model_route_decisions',
  {
    id: text('id').primaryKey(),
    agentProfileId: text('agent_profile_id').references(() => agentProfiles.id, {
      onDelete: 'set null',
    }),
    requestedCapabilities: text('requested_capabilities', { mode: 'json' })
      .$type<JsonObject>()
      .notNull()
      .default(sql`'{}'`),
    selectedModelProfileId: text('selected_model_profile_id').references(() => modelProfiles.id, {
      onDelete: 'set null',
    }),
    fallbackModelProfileIds: text('fallback_model_profile_ids', { mode: 'json' })
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'`),
    status: text('status').$type<ModelRouteStatus>().notNull(),
    reason: text('reason').notNull(),
    estimatedInputTokens: integer('estimated_input_tokens').notNull().default(0),
    estimatedOutputTokens: integer('estimated_output_tokens').notNull().default(0),
    estimatedCostCents: integer('estimated_cost_cents').notNull().default(0),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [
    index('idx_model_route_decisions_agent').on(t.agentProfileId, t.createdAt),
    index('idx_model_route_decisions_selected').on(t.selectedModelProfileId),
  ],
)

export const cliProfiles = sqliteTable('cli_profiles', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  command: text('command').notNull(),
  argsTemplate: text('args_template').notNull().default(''),
  cwdPolicy: text('cwd_policy', { enum: ['workspace', 'agent_workspace', 'custom'] })
    .notNull()
    .default('workspace'),
  customCwd: text('custom_cwd'),
  env: text('env', { mode: 'json' }).$type<Record<string, string>>().notNull().default(sql`'{}'`),
  timeoutMs: integer('timeout_ms').notNull().default(120000),
  inputMode: text('input_mode', { enum: ['stdin', 'args', 'file'] }).notNull().default('args'),
  outputMode: text('output_mode', { enum: ['stdout', 'file', 'json'] }).notNull().default('stdout'),
  allowedAgentIds: text('allowed_agent_ids', { mode: 'json' })
    .$type<string[]>()
    .notNull()
    .default(sql`'[]'`),
  requiresApproval: integer('requires_approval', { mode: 'boolean' }).notNull().default(true),
  healthStatus: text('health_status').$type<HealthStatus>().notNull().default('unknown'),
  lastTestResult: text('last_test_result'),
  lastCheckedAt: integer('last_checked_at'),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
})

export const toolConnections = sqliteTable('tool_connections', {
  id: text('id').primaryKey(),
  displayName: text('display_name').notNull(),
  type: text('type').$type<ToolConnectionType>().notNull(),
  config: text('config', { mode: 'json' }).$type<JsonObject>().notNull().default(sql`'{}'`),
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
  healthStatus: text('health_status').$type<HealthStatus>().notNull().default('unknown'),
  lastTestResult: text('last_test_result'),
  lastCheckedAt: integer('last_checked_at'),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
})

export const mcpServers = sqliteTable(
  'mcp_servers',
  {
    id: text('id').primaryKey(),
    displayName: text('display_name').notNull(),
    transport: text('transport').$type<McpTransport>().notNull().default('stdio'),
    command: text('command'),
    args: text('args', { mode: 'json' }).$type<string[]>().notNull().default(sql`'[]'`),
    env: text('env', { mode: 'json' }).$type<Record<string, string>>().notNull().default(sql`'{}'`),
    endpoint: text('endpoint'),
    enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
    healthStatus: text('health_status').$type<HealthStatus>().notNull().default('unknown'),
    lastTestResult: text('last_test_result'),
    lastCheckedAt: integer('last_checked_at'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [index('idx_mcp_servers_enabled').on(t.enabled)],
)

export const mcpToolDefinitions = sqliteTable(
  'mcp_tool_definitions',
  {
    id: text('id').primaryKey(),
    mcpServerId: text('mcp_server_id')
      .notNull()
      .references(() => mcpServers.id, { onDelete: 'cascade' }),
    toolName: text('tool_name').notNull(),
    displayName: text('display_name').notNull(),
    description: text('description').notNull().default(''),
    inputSchema: text('input_schema', { mode: 'json' }).$type<JsonObject>().notNull().default(sql`'{}'`),
    outputSchema: text('output_schema', { mode: 'json' }).$type<JsonObject>().notNull().default(sql`'{}'`),
    annotations: text('annotations', { mode: 'json' }).$type<JsonObject>().notNull().default(sql`'{}'`),
    riskLevel: text('risk_level').$type<RiskLevel>().notNull().default('medium'),
    requiresApproval: integer('requires_approval', { mode: 'boolean' }).notNull().default(true),
    enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
    discoveredAt: integer('discovered_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [
    index('idx_mcp_tool_definitions_server').on(t.mcpServerId, t.toolName),
    index('idx_mcp_tool_definitions_enabled').on(t.enabled),
  ],
)

export const toolProtocolManifests = sqliteTable(
  'tool_protocol_manifests',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    description: text('description').notNull().default(''),
    source: text('source').$type<ToolProtocolSource>().notNull(),
    inputSchema: text('input_schema', { mode: 'json' }).$type<JsonObject>().notNull().default(sql`'{}'`),
    idempotent: integer('idempotent', { mode: 'boolean' }).notNull().default(false),
    readOnly: integer('read_only', { mode: 'boolean' }).notNull().default(false),
    destructive: integer('destructive', { mode: 'boolean' }).notNull().default(false),
    longRunning: integer('long_running', { mode: 'boolean' }).notNull().default(false),
    requiresApproval: integer('requires_approval', { mode: 'boolean' }).notNull().default(true),
    riskLevel: text('risk_level').$type<RiskLevel>().notNull().default('medium'),
    status: text('status').$type<OpenSourceGovernanceStatus>().notNull().default('active'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [
    index('idx_tool_protocol_manifests_name').on(t.name),
    index('idx_tool_protocol_manifests_source').on(t.source, t.status),
    index('idx_tool_protocol_manifests_risk').on(t.riskLevel, t.requiresApproval),
  ],
)

export const toolProtocolInvocations = sqliteTable(
  'tool_protocol_invocations',
  {
    id: text('id').primaryKey(),
    manifestId: text('manifest_id')
      .notNull()
      .references(() => toolProtocolManifests.id, { onDelete: 'cascade' }),
    callId: text('call_id').notNull(),
    toolName: text('tool_name').notNull(),
    argumentsJson: text('arguments_json', { mode: 'json' }).$type<JsonObject>().notNull().default(sql`'{}'`),
    idempotencyKey: text('idempotency_key'),
    status: text('status').$type<ToolProtocolInvocationStatus>().notNull().default('created'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [
    index('idx_tool_protocol_invocations_call').on(t.callId),
    index('idx_tool_protocol_invocations_manifest').on(t.manifestId, t.status),
    index('idx_tool_protocol_invocations_idempotency').on(t.idempotencyKey),
  ],
)

export const toolProtocolResults = sqliteTable(
  'tool_protocol_results',
  {
    id: text('id').primaryKey(),
    invocationId: text('invocation_id')
      .notNull()
      .references(() => toolProtocolInvocations.id, { onDelete: 'cascade' }),
    callId: text('call_id').notNull(),
    success: integer('success', { mode: 'boolean' }).notNull(),
    data: text('data', { mode: 'json' }).$type<JsonObject | null>(),
    error: text('error', { mode: 'json' }).$type<JsonObject | null>(),
    metadata: text('metadata', { mode: 'json' }).$type<JsonObject>().notNull().default(sql`'{}'`),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [
    index('idx_tool_protocol_results_invocation').on(t.invocationId),
    index('idx_tool_protocol_results_call').on(t.callId, t.success),
  ],
)

export const skills = sqliteTable(
  'skills',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    description: text('description').notNull().default(''),
    source: text('source').$type<SkillSource>().notNull(),
    sourceUrl: text('source_url').notNull(),
    manifest: text('manifest', { mode: 'json' }).$type<JsonObject>().notNull().default(sql`'{}'`),
    installPath: text('install_path').notNull(),
    enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
    status: text('status').$type<SkillStatus>().notNull().default('installed'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [index('idx_skills_status').on(t.status)],
)

export const skillInstallFlows = sqliteTable(
  'skill_install_flows',
  {
    id: text('id').primaryKey(),
    skillId: text('skill_id').references(() => skills.id, { onDelete: 'set null' }),
    source: text('source').$type<SkillSource>().notNull(),
    url: text('url').notNull(),
    manifest: text('manifest', { mode: 'json' }).$type<JsonObject>().notNull().default(sql`'{}'`),
    installPath: text('install_path').notNull(),
    status: text('status').$type<SkillInstallStatus>().notNull().default('pending'),
    error: text('error'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [index('idx_skill_install_flows_status').on(t.status)],
)

export const skillSdkManifests = sqliteTable(
  'skill_sdk_manifests',
  {
    id: text('id').primaryKey(),
    skillId: text('skill_id').references(() => skills.id, { onDelete: 'set null' }),
    name: text('name').notNull(),
    version: text('version').notNull(),
    capabilities: text('capabilities', { mode: 'json' }).$type<string[]>().notNull().default(sql`'[]'`),
    dependencies: text('dependencies', { mode: 'json' }).$type<JsonObject>().notNull().default(sql`'{}'`),
    permissions: text('permissions', { mode: 'json' }).$type<string[]>().notNull().default(sql`'[]'`),
    requiredFiles: text('required_files', { mode: 'json' }).$type<string[]>().notNull().default(sql`'[]'`),
    scaffoldFiles: text('scaffold_files', { mode: 'json' }).$type<string[]>().notNull().default(sql`'[]'`),
    manifest: text('manifest', { mode: 'json' }).$type<JsonObject>().notNull().default(sql`'{}'`),
    validationStatus: text('validation_status')
      .$type<SkillSdkValidationStatus>()
      .notNull()
      .default('invalid'),
    validationFindings: text('validation_findings', { mode: 'json' })
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'`),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [
    index('idx_skill_sdk_manifests_skill').on(t.skillId),
    index('idx_skill_sdk_manifests_name_version').on(t.name, t.version),
    index('idx_skill_sdk_manifests_status').on(t.validationStatus, t.updatedAt),
  ],
)

export const skillMarketplacePublications = sqliteTable(
  'skill_marketplace_publications',
  {
    id: text('id').primaryKey(),
    manifestId: text('manifest_id')
      .notNull()
      .references(() => skillSdkManifests.id, { onDelete: 'cascade' }),
    marketplaceUrl: text('marketplace_url').notNull(),
    packageName: text('package_name').notNull(),
    packageVersion: text('package_version').notNull(),
    status: text('status').$type<SkillMarketplacePublicationStatus>().notNull().default('draft'),
    submissionPayload: text('submission_payload', { mode: 'json' }).$type<JsonObject>().notNull().default(sql`'{}'`),
    validationSnapshot: text('validation_snapshot', { mode: 'json' }).$type<JsonObject>().notNull().default(sql`'{}'`),
    publishedAt: integer('published_at'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [
    index('idx_skill_marketplace_publications_manifest').on(t.manifestId, t.status),
    index('idx_skill_marketplace_publications_package').on(t.packageName, t.packageVersion),
  ],
)

export const pluginPackages = sqliteTable(
  'plugin_packages',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    version: text('version').notNull(),
    description: text('description').notNull().default(''),
    author: text('author').notNull().default(''),
    source: text('source').$type<PluginMarketplaceMetadata['source']>().notNull().default('local'),
    extensionPoints: text('extension_points', { mode: 'json' })
      .$type<PluginExtensionPoint[]>()
      .notNull()
      .default(sql`'[]'`),
    capabilities: text('capabilities', { mode: 'json' })
      .$type<PluginCapabilityDefinition[]>()
      .notNull()
      .default(sql`'[]'`),
    config: text('config', { mode: 'json' }).$type<JsonObject>().notNull().default(sql`'{}'`),
    marketplaceMetadata: text('marketplace_metadata', { mode: 'json' })
      .$type<PluginMarketplaceMetadata>()
      .notNull()
      .default(sql`'{}'`),
    compatibilityReport: text('compatibility_report', { mode: 'json' })
      .$type<PluginCompatibilityReport>()
      .notNull()
      .default(sql`'{}'`),
    securityScanResult: text('security_scan_result', { mode: 'json' })
      .$type<PluginSecurityScanResult>()
      .notNull()
      .default(sql`'{}'`),
    status: text('status').$type<PluginStatus>().notNull().default('installed'),
    healthStatus: text('health_status').$type<PluginHealthStatus>().notNull().default('unknown'),
    healthMessage: text('health_message').notNull().default(''),
    installedAt: integer('installed_at').notNull(),
    enabledAt: integer('enabled_at'),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [
    index('idx_plugin_packages_status').on(t.status, t.updatedAt),
    index('idx_plugin_packages_name_version').on(t.name, t.version),
    index('idx_plugin_packages_source').on(t.source),
  ],
)

export const pluginLifecycleEvents = sqliteTable(
  'plugin_lifecycle_events',
  {
    id: text('id').primaryKey(),
    pluginId: text('plugin_id')
      .notNull()
      .references(() => pluginPackages.id, { onDelete: 'cascade' }),
    eventType: text('event_type').$type<PluginLifecycleEventType>().notNull(),
    fromVersion: text('from_version'),
    toVersion: text('to_version'),
    status: text('status').$type<PluginLifecycleStatus>().notNull().default('succeeded'),
    message: text('message').notNull().default(''),
    metadata: text('metadata', { mode: 'json' }).$type<JsonObject>().notNull().default(sql`'{}'`),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [
    index('idx_plugin_lifecycle_events_plugin').on(t.pluginId, t.createdAt),
    index('idx_plugin_lifecycle_events_type').on(t.eventType, t.createdAt),
  ],
)

export const teamUsers = sqliteTable(
  'team_users',
  {
    id: text('id').primaryKey(),
    displayName: text('display_name').notNull(),
    email: text('email').notNull(),
    roleSystem: text('role_system').$type<TeamUserRoleSystem>().notNull().default('viewer'),
    permissions: text('permissions', { mode: 'json' }).$type<JsonObject>().notNull().default(sql`'{}'`),
    scope: text('scope').notNull().default('global'),
    status: text('status').$type<TeamUserStatus>().notNull().default('active'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [
    index('idx_team_users_email').on(t.email),
    index('idx_team_users_role_status').on(t.roleSystem, t.status),
  ],
)

export const teams = sqliteTable(
  'teams',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    description: text('description').notNull().default(''),
    status: text('status').$type<TeamStatus>().notNull().default('active'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [index('idx_teams_status').on(t.status, t.updatedAt)],
)

export const teamMemberships = sqliteTable(
  'team_memberships',
  {
    id: text('id').primaryKey(),
    teamId: text('team_id')
      .notNull()
      .references(() => teams.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => teamUsers.id, { onDelete: 'cascade' }),
    roleSystem: text('role_system').$type<TeamUserRoleSystem>().notNull().default('viewer'),
    permissions: text('permissions', { mode: 'json' }).$type<JsonObject>().notNull().default(sql`'{}'`),
    scope: text('scope').notNull().default('global'),
    status: text('status').$type<TeamMembershipStatus>().notNull().default('active'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [
    index('idx_team_memberships_team').on(t.teamId, t.status),
    index('idx_team_memberships_user').on(t.userId, t.status),
  ],
)

export const teamResourceShares = sqliteTable(
  'team_resource_shares',
  {
    id: text('id').primaryKey(),
    teamId: text('team_id')
      .notNull()
      .references(() => teams.id, { onDelete: 'cascade' }),
    resourceType: text('resource_type').$type<TeamResourceType>().notNull(),
    resourceId: text('resource_id').notNull(),
    sharingPolicy: text('sharing_policy')
      .$type<TeamResourceSharingPolicy>()
      .notNull()
      .default('team_shared'),
    secretHandling: text('secret_handling')
      .$type<TeamSecretHandling>()
      .notNull()
      .default('not_applicable'),
    createdByUserId: text('created_by_user_id').references(() => teamUsers.id, { onDelete: 'set null' }),
    metadata: text('metadata', { mode: 'json' }).$type<JsonObject>().notNull().default(sql`'{}'`),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [
    index('idx_team_resource_shares_team').on(t.teamId, t.resourceType),
    index('idx_team_resource_shares_resource').on(t.resourceType, t.resourceId),
  ],
)

export const teamApprovalPolicies = sqliteTable(
  'team_approval_policies',
  {
    id: text('id').primaryKey(),
    teamId: text('team_id')
      .notNull()
      .references(() => teams.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    approvalMode: text('approval_mode').$type<TeamApprovalMode>().notNull(),
    approverUserIds: text('approver_user_ids', { mode: 'json' })
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'`),
    requiredPermission: text('required_permission').notNull().default('approval:decide'),
    riskLevel: text('risk_level').$type<RiskLevel>().notNull().default('medium'),
    status: text('status').$type<TeamApprovalPolicyStatus>().notNull().default('active'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [
    index('idx_team_approval_policies_team').on(t.teamId, t.status),
    index('idx_team_approval_policies_mode').on(t.approvalMode, t.riskLevel),
  ],
)

export const teamApprovalDecisions = sqliteTable(
  'team_approval_decisions',
  {
    id: text('id').primaryKey(),
    policyId: text('policy_id')
      .notNull()
      .references(() => teamApprovalPolicies.id, { onDelete: 'cascade' }),
    approvalRequestId: text('approval_request_id').references(() => approvalRequests.id, {
      onDelete: 'set null',
    }),
    userId: text('user_id')
      .notNull()
      .references(() => teamUsers.id, { onDelete: 'cascade' }),
    decision: text('decision').$type<TeamApprovalDecisionValue>().notNull(),
    comment: text('comment').notNull().default(''),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [
    index('idx_team_approval_decisions_policy').on(t.policyId, t.createdAt),
    index('idx_team_approval_decisions_user').on(t.userId, t.createdAt),
  ],
)

export const agentTemplatePackages = sqliteTable(
  'agent_template_packages',
  {
    id: text('id').primaryKey(),
    templateKey: text('template_key').notNull(),
    templateType: text('template_type').$type<AgentTemplatePackageType>().notNull(),
    category: text('category').$type<AgentTemplateCategory>().notNull().default('custom'),
    name: text('name').notNull(),
    description: text('description').notNull().default(''),
    role: text('role').notNull().default(''),
    payload: text('payload', { mode: 'json' }).$type<JsonObject>().notNull().default(sql`'{}'`),
    requiredSkillIds: text('required_skill_ids', { mode: 'json' })
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'`),
    recommendedToolIds: text('recommended_tool_ids', { mode: 'json' })
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'`),
    tags: text('tags', { mode: 'json' }).$type<string[]>().notNull().default(sql`'[]'`),
    author: text('author').notNull().default('Reasonix'),
    source: text('source').$type<AgentTemplateSource>().notNull().default('system'),
    visibility: text('visibility').$type<AgentTemplateVisibility>().notNull().default('public'),
    marketplaceUrl: text('marketplace_url'),
    status: text('status').$type<AgentTemplateStatus>().notNull().default('published'),
    installCount: integer('install_count').notNull().default(0),
    rating: real('rating'),
    createdByUserId: text('created_by_user_id').references(() => teamUsers.id, {
      onDelete: 'set null',
    }),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [
    index('idx_agent_template_packages_key').on(t.templateKey),
    index('idx_agent_template_packages_type').on(t.templateType, t.status),
    index('idx_agent_template_packages_category').on(t.category, t.status),
    index('idx_agent_template_packages_source').on(t.source, t.visibility),
  ],
)

export const agentTemplateInstalls = sqliteTable(
  'agent_template_installs',
  {
    id: text('id').primaryKey(),
    templateId: text('template_id')
      .notNull()
      .references(() => agentTemplatePackages.id, { onDelete: 'cascade' }),
    installedByUserId: text('installed_by_user_id').references(() => teamUsers.id, {
      onDelete: 'set null',
    }),
    targetType: text('target_type').$type<AgentTemplatePackageType>().notNull(),
    status: text('status').$type<AgentTemplateInstallStatus>().notNull().default('installed'),
    createdAgentProfileId: text('created_agent_profile_id').references(() => agentProfiles.id, {
      onDelete: 'set null',
    }),
    createdWorkflowId: text('created_workflow_id'),
    result: text('result', { mode: 'json' }).$type<JsonObject>().notNull().default(sql`'{}'`),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [
    index('idx_agent_template_installs_template').on(t.templateId, t.createdAt),
    index('idx_agent_template_installs_user').on(t.installedByUserId, t.createdAt),
    index('idx_agent_template_installs_target').on(t.targetType, t.status),
  ],
)

export const testStrategyItems = sqliteTable(
  'test_strategy_items',
  {
    id: text('id').primaryKey(),
    itemKey: text('item_key').notNull(),
    kind: text('kind').$type<TestStrategyItemKind>().notNull(),
    title: text('title').notNull(),
    description: text('description').notNull().default(''),
    expectedCoverage: text('expected_coverage').notNull().default(''),
    evidenceRefs: text('evidence_refs', { mode: 'json' }).$type<string[]>().notNull().default(sql`'[]'`),
    status: text('status').$type<TestStrategyItemStatus>().notNull().default('planned'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [
    index('idx_test_strategy_items_key').on(t.itemKey),
    index('idx_test_strategy_items_kind_status').on(t.kind, t.status),
  ],
)

export const testFixtureSpecs = sqliteTable(
  'test_fixture_specs',
  {
    id: text('id').primaryKey(),
    fixtureType: text('fixture_type').$type<TestFixtureType>().notNull(),
    name: text('name').notNull(),
    description: text('description').notNull().default(''),
    contentKind: text('content_kind').notNull(),
    metadata: text('metadata', { mode: 'json' }).$type<JsonObject>().notNull().default(sql`'{}'`),
    status: text('status').notNull().default('active'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [
    index('idx_test_fixture_specs_type').on(t.fixtureType, t.status),
    index('idx_test_fixture_specs_name').on(t.name),
  ],
)

export const testFixtureGenerationRuns = sqliteTable(
  'test_fixture_generation_runs',
  {
    id: text('id').primaryKey(),
    fixtureId: text('fixture_id')
      .notNull()
      .references(() => testFixtureSpecs.id, { onDelete: 'cascade' }),
    targetPath: text('target_path'),
    status: text('status').$type<TestFixtureGenerationStatus>().notNull().default('planned'),
    generatedFiles: text('generated_files', { mode: 'json' }).$type<string[]>().notNull().default(sql`'[]'`),
    generatedBytes: integer('generated_bytes').notNull().default(0),
    resultSummary: text('result_summary', { mode: 'json' }).$type<JsonObject>().notNull().default(sql`'{}'`),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [
    index('idx_test_fixture_generation_runs_fixture').on(t.fixtureId, t.createdAt),
    index('idx_test_fixture_generation_runs_status').on(t.status, t.createdAt),
  ],
)

export const benchmarkSuites = sqliteTable(
  'benchmark_suites',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    description: text('description').notNull().default(''),
    schedule: text('schedule').notNull().default('manual'),
    ciEnabled: integer('ci_enabled', { mode: 'boolean' }).notNull().default(true),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [index('idx_benchmark_suites_name').on(t.name)],
)

export const benchmarkCases = sqliteTable(
  'benchmark_cases',
  {
    id: text('id').primaryKey(),
    suiteId: text('suite_id')
      .notNull()
      .references(() => benchmarkSuites.id, { onDelete: 'cascade' }),
    dimension: text('dimension').$type<BenchmarkDimension>().notNull(),
    name: text('name').notNull(),
    input: text('input', { mode: 'json' }).$type<JsonObject>().notNull().default(sql`'{}'`),
    expectedOutput: text('expected_output', { mode: 'json' }).$type<JsonObject>().notNull().default(sql`'{}'`),
    validationFn: text('validation_fn').notNull(),
    maxBudgetCents: integer('max_budget_cents').notNull().default(0),
    maxSteps: integer('max_steps').notNull().default(0),
    tags: text('tags', { mode: 'json' }).$type<string[]>().notNull().default(sql`'[]'`),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [
    index('idx_benchmark_cases_suite').on(t.suiteId, t.dimension),
    index('idx_benchmark_cases_tags').on(t.dimension),
  ],
)

export const benchmarkRuns = sqliteTable(
  'benchmark_runs',
  {
    id: text('id').primaryKey(),
    suiteId: text('suite_id')
      .notNull()
      .references(() => benchmarkSuites.id, { onDelete: 'cascade' }),
    promptVersion: text('prompt_version').notNull(),
    baselinePromptVersion: text('baseline_prompt_version').notNull(),
    modelProfileIds: text('model_profile_ids', { mode: 'json' }).$type<string[]>().notNull().default(sql`'[]'`),
    status: text('status').$type<BenchmarkRunStatus>().notNull().default('queued'),
    promptDriftDetected: integer('prompt_drift_detected', { mode: 'boolean' }).notNull().default(false),
    ciRegressionStatus: text('ci_regression_status').$type<BenchmarkRegressionStatus>().notNull().default('passed'),
    summary: text('summary', { mode: 'json' }).$type<JsonObject>().notNull().default(sql`'{}'`),
    createdAt: integer('created_at').notNull(),
    completedAt: integer('completed_at'),
  },
  (t) => [
    index('idx_benchmark_runs_suite').on(t.suiteId, t.createdAt),
    index('idx_benchmark_runs_status').on(t.status, t.ciRegressionStatus),
  ],
)

export const benchmarkCaseResults = sqliteTable(
  'benchmark_case_results',
  {
    id: text('id').primaryKey(),
    runId: text('run_id')
      .notNull()
      .references(() => benchmarkRuns.id, { onDelete: 'cascade' }),
    caseId: text('case_id')
      .notNull()
      .references(() => benchmarkCases.id, { onDelete: 'cascade' }),
    modelProfileId: text('model_profile_id').notNull(),
    passed: integer('passed', { mode: 'boolean' }).notNull(),
    score: real('score').notNull(),
    budgetCents: integer('budget_cents').notNull(),
    steps: integer('steps').notNull(),
    observedOutput: text('observed_output', { mode: 'json' }).$type<JsonObject>().notNull().default(sql`'{}'`),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [
    index('idx_benchmark_case_results_run').on(t.runId, t.modelProfileId),
    index('idx_benchmark_case_results_case').on(t.caseId, t.passed),
  ],
)

export const localizationSettings = sqliteTable(
  'localization_settings',
  {
    id: text('id').primaryKey(),
    defaultLocale: text('default_locale').$type<SupportedLocale>().notNull().default('zh-CN'),
    fallbackLocale: text('fallback_locale').$type<SupportedLocale>().notNull().default('zh-CN'),
    enabledLocales: text('enabled_locales', { mode: 'json' })
      .$type<SupportedLocale[]>()
      .notNull()
      .default(sql`'["zh-CN","en-US","ja-JP","zh-TW"]'`),
    namespaces: text('namespaces', { mode: 'json' })
      .$type<LocalizationNamespace[]>()
      .notNull()
      .default(sql`'["ui","errors","agent-prompts","docs"]'`),
    outputLanguagePolicy: text('output_language_policy')
      .$type<OutputLanguagePolicy>()
      .notNull()
      .default('workspace_default'),
    dateTimeFormat: text('date_time_format', { mode: 'json' }).$type<JsonObject>().notNull().default(sql`'{}'`),
    numberFormat: text('number_format', { mode: 'json' }).$type<JsonObject>().notNull().default(sql`'{}'`),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [index('idx_localization_settings_default').on(t.defaultLocale, t.fallbackLocale)],
)

export const localizationResources = sqliteTable(
  'localization_resources',
  {
    id: text('id').primaryKey(),
    locale: text('locale').$type<SupportedLocale>().notNull(),
    namespace: text('namespace').$type<LocalizationNamespace>().notNull(),
    key: text('key').notNull(),
    value: text('value').notNull(),
    status: text('status').notNull().default('active'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [
    index('idx_localization_resources_lookup').on(t.locale, t.namespace, t.key),
    index('idx_localization_resources_namespace').on(t.namespace, t.status),
  ],
)

export const agentLocalizationPolicies = sqliteTable(
  'agent_localization_policies',
  {
    id: text('id').primaryKey(),
    agentProfileId: text('agent_profile_id').references(() => agentProfiles.id, { onDelete: 'cascade' }),
    outputLanguagePolicy: text('output_language_policy')
      .$type<OutputLanguagePolicy>()
      .notNull()
      .default('workspace_default'),
    outputLocale: text('output_locale').$type<SupportedLocale>().notNull().default('zh-CN'),
    dateTimeLocale: text('date_time_locale').$type<SupportedLocale>().notNull().default('zh-CN'),
    numberLocale: text('number_locale').$type<SupportedLocale>().notNull().default('zh-CN'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [
    index('idx_agent_localization_policies_agent').on(t.agentProfileId),
    index('idx_agent_localization_policies_locale').on(t.outputLocale, t.outputLanguagePolicy),
  ],
)

export const i18nContractChecks = sqliteTable(
  'i18n_contract_checks',
  {
    id: text('id').primaryKey(),
    checkKey: text('check_key').notNull(),
    area: text('area').$type<I18nContractArea>().notNull(),
    description: text('description').notNull(),
    namespace: text('namespace').$type<LocalizationNamespace>(),
    requiredKeys: text('required_keys', { mode: 'json' }).$type<string[]>().notNull().default(sql`'[]'`),
    requiredLocales: text('required_locales', { mode: 'json' })
      .$type<SupportedLocale[]>()
      .notNull()
      .default(sql`'[]'`),
    status: text('status').$type<I18nContractStatus>().notNull().default('warning'),
    evidence: text('evidence', { mode: 'json' }).$type<JsonObject>().notNull().default(sql`'{}'`),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [
    index('idx_i18n_contract_checks_key').on(t.checkKey),
    index('idx_i18n_contract_checks_area').on(t.area, t.status),
  ],
)

export const architectureEvolutionReservations = sqliteTable(
  'architecture_evolution_reservations',
  {
    id: text('id').primaryKey(),
    track: text('track').$type<ArchitectureEvolutionTrack>().notNull(),
    abstractionKind: text('abstraction_kind').$type<ArchitectureAbstractionKind>().notNull(),
    abstractionName: text('abstraction_name').notNull(),
    currentImplementation: text('current_implementation').notNull(),
    futureImplementation: text('future_implementation').notNull(),
    migrationTrigger: text('migration_trigger').notNull(),
    notes: text('notes').notNull().default(''),
    evidence: text('evidence', { mode: 'json' }).$type<JsonObject>().notNull().default(sql`'{}'`),
    status: text('status').$type<ArchitectureEvolutionStatus>().notNull().default('reserved'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [
    index('idx_architecture_evolution_track').on(t.track, t.status),
    index('idx_architecture_evolution_abstraction').on(t.abstractionKind, t.abstractionName),
  ],
)

export const themeProfiles = sqliteTable(
  'theme_profiles',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    presetKey: text('preset_key').$type<ThemePresetKey>().notNull(),
    followSystem: integer('follow_system', { mode: 'boolean' }).notNull().default(false),
    modePreference: text('mode_preference').$type<ThemeModePreference>().notNull().default('system'),
    colorTokens: text('color_tokens', { mode: 'json' }).$type<JsonObject>().notNull().default(sql`'{}'`),
    fontTokens: text('font_tokens', { mode: 'json' }).$type<JsonObject>().notNull().default(sql`'{}'`),
    radiusPx: integer('radius_px').notNull().default(8),
    spacingScale: text('spacing_scale').$type<ThemeSpacingScale>().notNull().default('comfortable'),
    status: text('status').notNull().default('active'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [
    index('idx_theme_profiles_preset').on(t.presetKey, t.status),
    index('idx_theme_profiles_mode').on(t.modePreference, t.followSystem),
  ],
)

export const keyboardShortcuts = sqliteTable(
  'keyboard_shortcuts',
  {
    id: text('id').primaryKey(),
    scope: text('scope').$type<KeyboardShortcutScope>().notNull(),
    action: text('action').notNull(),
    keys: text('keys', { mode: 'json' }).$type<string[]>().notNull().default(sql`'[]'`),
    description: text('description').notNull().default(''),
    preventDefault: integer('prevent_default', { mode: 'boolean' }).notNull().default(true),
    status: text('status').$type<KeyboardShortcutStatus>().notNull().default('active'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [
    index('idx_keyboard_shortcuts_scope').on(t.scope, t.status),
    index('idx_keyboard_shortcuts_action').on(t.action),
  ],
)

export const accessibilityProfiles = sqliteTable(
  'accessibility_profiles',
  {
    id: text('id').primaryKey(),
    profileKey: text('profile_key').notNull(),
    name: text('name').notNull(),
    keyboardNavigation: integer('keyboard_navigation', { mode: 'boolean' }).notNull().default(true),
    screenReaderSupport: integer('screen_reader_support', { mode: 'boolean' }).notNull().default(true),
    highContrastMode: integer('high_contrast_mode', { mode: 'boolean' }).notNull().default(false),
    fontScale: real('font_scale').notNull().default(1),
    colorScheme: text('color_scheme').$type<AccessibilityColorScheme>().notNull().default('system'),
    themeProfileId: text('theme_profile_id').references(() => themeProfiles.id, { onDelete: 'set null' }),
    checkResults: text('check_results', { mode: 'json' }).$type<JsonObject[]>().notNull().default(sql`'[]'`),
    status: text('status').$type<AccessibilityProfileStatus>().notNull().default('active'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [
    index('idx_accessibility_profiles_key').on(t.profileKey),
    index('idx_accessibility_profiles_status').on(t.status, t.updatedAt),
  ],
)

export const reasonixFileFormatSpecs = sqliteTable(
  'reasonix_file_format_specs',
  {
    id: text('id').primaryKey(),
    formatKind: text('format_kind').$type<ReasonixFileFormatKind>().notNull(),
    extension: text('extension').notNull(),
    displayName: text('display_name').notNull(),
    schemaVersion: text('schema_version').notNull(),
    requiredFields: text('required_fields', { mode: 'json' })
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'`),
    metadataSchema: text('metadata_schema', { mode: 'json' }).$type<JsonObject>().notNull().default(sql`'{}'`),
    checksumAlgorithm: text('checksum_algorithm').notNull().default('sha256'),
    signatureOptional: integer('signature_optional', { mode: 'boolean' }).notNull().default(true),
    secretRefsForbidden: integer('secret_refs_forbidden', { mode: 'boolean' }).notNull().default(true),
    status: text('status').notNull().default('active'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [
    index('idx_reasonix_file_format_specs_kind').on(t.formatKind, t.status),
    index('idx_reasonix_file_format_specs_extension').on(t.extension),
  ],
)

export const reasonixFileValidations = sqliteTable(
  'reasonix_file_validations',
  {
    id: text('id').primaryKey(),
    formatKind: text('format_kind').$type<ReasonixFileFormatKind>().notNull(),
    extension: text('extension').notNull(),
    schemaVersion: text('schema_version'),
    checksum: text('checksum'),
    signaturePresent: integer('signature_present', { mode: 'boolean' }).notNull().default(false),
    status: text('status').$type<ReasonixFileFormatValidationStatus>().notNull(),
    findings: text('findings', { mode: 'json' }).$type<string[]>().notNull().default(sql`'[]'`),
    metadata: text('metadata', { mode: 'json' }).$type<JsonObject>().notNull().default(sql`'{}'`),
    payloadSummary: text('payload_summary', { mode: 'json' }).$type<JsonObject>().notNull().default(sql`'{}'`),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [
    index('idx_reasonix_file_validations_kind').on(t.formatKind, t.status),
    index('idx_reasonix_file_validations_created').on(t.createdAt),
  ],
)

export const migrationWizardSessions = sqliteTable(
  'migration_wizard_sessions',
  {
    id: text('id').primaryKey(),
    sourceTool: text('source_tool').$type<MigrationSourceTool>().notNull(),
    sourceName: text('source_name').notNull().default(''),
    status: text('status').$type<MigrationWizardStatus>().notNull().default('checked'),
    compatibilityStatus: text('compatibility_status')
      .$type<MigrationCompatibilityStatus>()
      .notNull()
      .default('warning'),
    sourcePayload: text('source_payload', { mode: 'json' }).$type<JsonObject>().notNull().default(sql`'{}'`),
    compatibilityReport: text('compatibility_report', { mode: 'json' })
      .$type<JsonObject>()
      .notNull()
      .default(sql`'{}'`),
    importedCounts: text('imported_counts', { mode: 'json' }).$type<JsonObject>().notNull().default(sql`'{}'`),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
    importedAt: integer('imported_at'),
  },
  (t) => [
    index('idx_migration_wizard_sessions_source').on(t.sourceTool, t.status),
    index('idx_migration_wizard_sessions_compat').on(t.compatibilityStatus, t.updatedAt),
  ],
)

export const migrationImportRecords = sqliteTable(
  'migration_import_records',
  {
    id: text('id').primaryKey(),
    sessionId: text('session_id')
      .notNull()
      .references(() => migrationWizardSessions.id, { onDelete: 'cascade' }),
    sourceTool: text('source_tool').$type<MigrationSourceTool>().notNull(),
    sourceId: text('source_id'),
    targetType: text('target_type').$type<MigrationImportTargetType>().notNull(),
    targetId: text('target_id'),
    sourceTag: text('source_tag').notNull(),
    result: text('result').$type<MigrationImportResult>().notNull(),
    payload: text('payload', { mode: 'json' }).$type<JsonObject>().notNull().default(sql`'{}'`),
    message: text('message').notNull().default(''),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [
    index('idx_migration_import_records_session').on(t.sessionId, t.result),
    index('idx_migration_import_records_target').on(t.targetType, t.targetId),
  ],
)

export const performanceAnalysisRuns = sqliteTable(
  'performance_analysis_runs',
  {
    id: text('id').primaryKey(),
    scope: text('scope').$type<PerformanceAnalysisScope>().notNull(),
    agentProfileId: text('agent_profile_id').references(() => agentProfiles.id, {
      onDelete: 'set null',
    }),
    status: text('status').$type<PerformanceAnalysisStatus>().notNull().default('completed'),
    windowStart: integer('window_start'),
    windowEnd: integer('window_end'),
    p50LatencyMs: integer('p50_latency_ms').notNull().default(0),
    p95LatencyMs: integer('p95_latency_ms').notNull().default(0),
    p99LatencyMs: integer('p99_latency_ms').notNull().default(0),
    slowestSteps: text('slowest_steps', { mode: 'json' }).$type<JsonObject[]>().notNull().default(sql`'[]'`),
    slowestTools: text('slowest_tools', { mode: 'json' }).$type<JsonObject[]>().notNull().default(sql`'[]'`),
    sqliteSlowQueries: text('sqlite_slow_queries', { mode: 'json' })
      .$type<JsonObject[]>()
      .notNull()
      .default(sql`'[]'`),
    memoryFlamegraph: text('memory_flamegraph', { mode: 'json' }).$type<JsonObject>().notNull().default(sql`'{}'`),
    processMetrics: text('process_metrics', { mode: 'json' }).$type<JsonObject>().notNull().default(sql`'{}'`),
    summary: text('summary', { mode: 'json' }).$type<JsonObject>().notNull().default(sql`'{}'`),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [
    index('idx_performance_analysis_runs_scope').on(t.scope, t.createdAt),
    index('idx_performance_analysis_runs_agent').on(t.agentProfileId, t.createdAt),
  ],
)

export const performanceOptimizationRecommendations = sqliteTable(
  'performance_optimization_recommendations',
  {
    id: text('id').primaryKey(),
    analysisRunId: text('analysis_run_id')
      .notNull()
      .references(() => performanceAnalysisRuns.id, { onDelete: 'cascade' }),
    recommendationType: text('recommendation_type').notNull(),
    target: text('target').notNull(),
    message: text('message').notNull(),
    estimatedImpact: text('estimated_impact').notNull().default('medium'),
    evidence: text('evidence', { mode: 'json' }).$type<JsonObject>().notNull().default(sql`'{}'`),
    status: text('status').$type<PerformanceRecommendationStatus>().notNull().default('open'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [
    index('idx_performance_recommendations_run').on(t.analysisRunId, t.status),
    index('idx_performance_recommendations_target').on(t.target, t.status),
  ],
)

export const securityAuditChecklistItems = sqliteTable(
  'security_audit_checklist_items',
  {
    id: text('id').primaryKey(),
    cadence: text('cadence').$type<SecurityAuditCadence>().notNull(),
    itemKey: text('item_key').notNull(),
    category: text('category').notNull(),
    title: text('title').notNull(),
    description: text('description').notNull().default(''),
    required: integer('required', { mode: 'boolean' }).notNull().default(true),
    status: text('status').notNull().default('active'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [
    index('idx_security_audit_items_key').on(t.itemKey),
    index('idx_security_audit_items_cadence').on(t.cadence, t.status),
  ],
)

export const securityAuditRuns = sqliteTable(
  'security_audit_runs',
  {
    id: text('id').primaryKey(),
    cadence: text('cadence').$type<SecurityAuditCadence>().notNull(),
    releaseLabel: text('release_label').notNull().default(''),
    status: text('status').$type<SecurityAuditRunStatus>().notNull().default('draft'),
    summary: text('summary', { mode: 'json' }).$type<JsonObject>().notNull().default(sql`'{}'`),
    createdAt: integer('created_at').notNull(),
    completedAt: integer('completed_at'),
  },
  (t) => [
    index('idx_security_audit_runs_cadence').on(t.cadence, t.status),
    index('idx_security_audit_runs_created').on(t.createdAt),
  ],
)

export const securityAuditRunItems = sqliteTable(
  'security_audit_run_items',
  {
    id: text('id').primaryKey(),
    runId: text('run_id')
      .notNull()
      .references(() => securityAuditRuns.id, { onDelete: 'cascade' }),
    checklistItemId: text('checklist_item_id').references(() => securityAuditChecklistItems.id, {
      onDelete: 'set null',
    }),
    itemKey: text('item_key').notNull(),
    status: text('status').$type<SecurityAuditItemStatus>().notNull().default('pending'),
    evidence: text('evidence', { mode: 'json' }).$type<JsonObject>().notNull().default(sql`'{}'`),
    notes: text('notes').notNull().default(''),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [
    index('idx_security_audit_run_items_run').on(t.runId, t.status),
    index('idx_security_audit_run_items_key').on(t.itemKey),
  ],
)

export const incidentResponsePlans = sqliteTable(
  'incident_response_plans',
  {
    id: text('id').primaryKey(),
    severity: text('severity').$type<IncidentSeverity>().notNull(),
    title: text('title').notNull(),
    responseWindowMinutes: integer('response_window_minutes').notNull(),
    triggerExamples: text('trigger_examples', { mode: 'json' })
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'`),
    actionSequence: text('action_sequence', { mode: 'json' })
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'`),
    description: text('description').notNull().default(''),
    status: text('status').notNull().default('active'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [
    index('idx_incident_response_plans_severity').on(t.severity, t.status),
    index('idx_incident_response_plans_window').on(t.responseWindowMinutes),
  ],
)

export const incidentReports = sqliteTable(
  'incident_reports',
  {
    id: text('id').primaryKey(),
    severity: text('severity').$type<IncidentSeverity>().notNull(),
    title: text('title').notNull(),
    trigger: text('trigger').notNull(),
    status: text('status').$type<IncidentStatus>().notNull().default('open'),
    responsePlanId: text('response_plan_id').references(() => incidentResponsePlans.id, {
      onDelete: 'set null',
    }),
    affectedResources: text('affected_resources', { mode: 'json' })
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'`),
    evidence: text('evidence', { mode: 'json' }).$type<JsonObject>().notNull().default(sql`'{}'`),
    responseSummary: text('response_summary', { mode: 'json' }).$type<JsonObject>().notNull().default(sql`'{}'`),
    openedAt: integer('opened_at').notNull(),
    dueAt: integer('due_at').notNull(),
    resolvedAt: integer('resolved_at'),
  },
  (t) => [
    index('idx_incident_reports_severity').on(t.severity, t.status),
    index('idx_incident_reports_due').on(t.dueAt, t.status),
  ],
)

export const incidentResponseActions = sqliteTable(
  'incident_response_actions',
  {
    id: text('id').primaryKey(),
    incidentId: text('incident_id')
      .notNull()
      .references(() => incidentReports.id, { onDelete: 'cascade' }),
    actionKey: text('action_key').notNull(),
    title: text('title').notNull(),
    status: text('status').$type<IncidentActionStatus>().notNull().default('pending'),
    required: integer('required', { mode: 'boolean' }).notNull().default(true),
    dueAt: integer('due_at').notNull(),
    completedAt: integer('completed_at'),
    evidence: text('evidence', { mode: 'json' }).$type<JsonObject>().notNull().default(sql`'{}'`),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [
    index('idx_incident_response_actions_incident').on(t.incidentId, t.status),
    index('idx_incident_response_actions_key').on(t.actionKey),
  ],
)

export const capacityPlanningProfiles = sqliteTable(
  'capacity_planning_profiles',
  {
    id: text('id').primaryKey(),
    tierKey: text('tier_key').notNull(),
    memoryGb: integer('memory_gb').notNull(),
    cpuCores: integer('cpu_cores').notNull(),
    gpuRequired: integer('gpu_required', { mode: 'boolean' }).notNull().default(false),
    maxAgents: integer('max_agents').notNull(),
    maxBrowsers: integer('max_browsers').notNull(),
    persona: text('persona').notNull(),
    databaseGuidance: text('database_guidance').notNull().default(''),
    storageGuidance: text('storage_guidance').notNull().default(''),
    status: text('status').notNull().default('active'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [
    index('idx_capacity_profiles_tier').on(t.tierKey),
    index('idx_capacity_profiles_specs').on(t.memoryGb, t.cpuCores, t.gpuRequired),
  ],
)

export const capacityPlanningEvaluations = sqliteTable(
  'capacity_planning_evaluations',
  {
    id: text('id').primaryKey(),
    memoryGb: integer('memory_gb').notNull(),
    cpuCores: integer('cpu_cores').notNull(),
    hasGpu: integer('has_gpu', { mode: 'boolean' }).notNull().default(false),
    desiredAgents: integer('desired_agents').notNull().default(0),
    desiredBrowsers: integer('desired_browsers').notNull().default(0),
    agentCount: integer('agent_count').notNull().default(0),
    memoriesPerAgent: integer('memories_per_agent').notNull().default(0),
    taskCount: integer('task_count').notNull().default(0),
    matchedProfileId: text('matched_profile_id').references(() => capacityPlanningProfiles.id, {
      onDelete: 'set null',
    }),
    status: text('status').$type<CapacityEvaluationStatus>().notNull(),
    estimate: text('estimate', { mode: 'json' }).$type<JsonObject>().notNull().default(sql`'{}'`),
    warnings: text('warnings', { mode: 'json' }).$type<string[]>().notNull().default(sql`'[]'`),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [
    index('idx_capacity_evaluations_status').on(t.status, t.createdAt),
    index('idx_capacity_evaluations_profile').on(t.matchedProfileId),
  ],
)

export const deprecationPolicyStages = sqliteTable(
  'deprecation_policy_stages',
  {
    id: text('id').primaryKey(),
    stage: text('stage').$type<DeprecationStage>().notNull(),
    sequenceIndex: integer('sequence_index').notNull(),
    monthsFromNotice: integer('months_from_notice').notNull(),
    runtimeBehavior: text('runtime_behavior').notNull(),
    description: text('description').notNull().default(''),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [
    index('idx_deprecation_policy_stages_stage').on(t.stage),
    index('idx_deprecation_policy_stages_sequence').on(t.sequenceIndex),
  ],
)

export const featureDeprecations = sqliteTable(
  'feature_deprecations',
  {
    id: text('id').primaryKey(),
    featureKey: text('feature_key').notNull(),
    featureName: text('feature_name').notNull(),
    currentStage: text('current_stage').$type<DeprecationStage>().notNull().default('notice'),
    replacementFeature: text('replacement_feature'),
    migrationGuide: text('migration_guide').notNull().default(''),
    autoMigrateAvailable: integer('auto_migrate_available', { mode: 'boolean' }).notNull().default(false),
    noticeAt: integer('notice_at').notNull(),
    warningAt: integer('warning_at').notNull(),
    disabledNewAt: integer('disabled_new_at').notNull(),
    removedAt: integer('removed_at').notNull(),
    status: text('status').notNull().default('active'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [
    index('idx_feature_deprecations_key').on(t.featureKey),
    index('idx_feature_deprecations_stage').on(t.currentStage, t.status),
  ],
)

export const deprecationMigrationRuns = sqliteTable(
  'deprecation_migration_runs',
  {
    id: text('id').primaryKey(),
    featureDeprecationId: text('feature_deprecation_id')
      .notNull()
      .references(() => featureDeprecations.id, { onDelete: 'cascade' }),
    mode: text('mode').$type<DeprecationMigrationMode>().notNull().default('dry_run'),
    status: text('status').$type<DeprecationMigrationStatus>().notNull().default('planned'),
    migratedCount: integer('migrated_count').notNull().default(0),
    report: text('report', { mode: 'json' }).$type<JsonObject>().notNull().default(sql`'{}'`),
    createdAt: integer('created_at').notNull(),
    completedAt: integer('completed_at'),
  },
  (t) => [
    index('idx_deprecation_migration_runs_feature').on(t.featureDeprecationId, t.status),
    index('idx_deprecation_migration_runs_mode').on(t.mode, t.createdAt),
  ],
)

export const documentationSections = sqliteTable(
  'documentation_sections',
  {
    id: text('id').primaryKey(),
    category: text('category').$type<DocumentationSectionCategory>().notNull(),
    directory: text('directory').notNull(),
    title: text('title').notNull(),
    description: text('description').notNull().default(''),
    topicSlugs: text('topic_slugs', { mode: 'json' }).$type<string[]>().notNull().default(sql`'[]'`),
    ownerAudience: text('owner_audience').notNull().default('users'),
    status: text('status').notNull().default('active'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [
    index('idx_documentation_sections_category').on(t.category, t.status),
    index('idx_documentation_sections_directory').on(t.directory),
  ],
)

export const documentationPages = sqliteTable(
  'documentation_pages',
  {
    id: text('id').primaryKey(),
    sectionId: text('section_id')
      .notNull()
      .references(() => documentationSections.id, { onDelete: 'cascade' }),
    category: text('category').$type<DocumentationSectionCategory>().notNull(),
    slug: text('slug').notNull(),
    filePath: text('file_path').notNull(),
    title: text('title').notNull(),
    summary: text('summary').notNull().default(''),
    status: text('status').$type<DocumentationPageStatus>().notNull().default('planned'),
    required: integer('required', { mode: 'boolean' }).notNull().default(true),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [
    index('idx_documentation_pages_section').on(t.sectionId, t.status),
    index('idx_documentation_pages_category').on(t.category, t.status),
    index('idx_documentation_pages_path').on(t.filePath),
  ],
)

export const helpCenterSurfaces = sqliteTable(
  'help_center_surfaces',
  {
    id: text('id').primaryKey(),
    surfaceKey: text('surface_key').notNull(),
    route: text('route').notNull(),
    title: text('title').notNull(),
    description: text('description').notNull().default(''),
    documentationPageId: text('documentation_page_id').references(() => documentationPages.id, {
      onDelete: 'set null',
    }),
    docHref: text('doc_href').notNull().default(''),
    questionButtonLabel: text('question_button_label').notNull().default('?'),
    status: text('status').$type<HelpCenterSurfaceStatus>().notNull().default('active'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [
    index('idx_help_center_surfaces_key').on(t.surfaceKey),
    index('idx_help_center_surfaces_route').on(t.route),
    index('idx_help_center_surfaces_status').on(t.status, t.updatedAt),
  ],
)

export const helpCenterItems = sqliteTable(
  'help_center_items',
  {
    id: text('id').primaryKey(),
    surfaceId: text('surface_id')
      .notNull()
      .references(() => helpCenterSurfaces.id, { onDelete: 'cascade' }),
    itemKey: text('item_key').notNull(),
    itemType: text('item_type').$type<HelpCenterItemType>().notNull(),
    label: text('label').notNull(),
    body: text('body').notNull().default(''),
    selector: text('selector'),
    docHref: text('doc_href').notNull().default(''),
    exampleValue: text('example_value', { mode: 'json' }).$type<JsonObject>().notNull().default(sql`'{}'`),
    orderIndex: integer('order_index').notNull().default(0),
    status: text('status').notNull().default('active'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [
    index('idx_help_center_items_surface').on(t.surfaceId, t.itemType),
    index('idx_help_center_items_key').on(t.itemKey),
    index('idx_help_center_items_type').on(t.itemType, t.status),
  ],
)

export const helpOnboardingFlows = sqliteTable(
  'help_onboarding_flows',
  {
    id: text('id').primaryKey(),
    flowKey: text('flow_key').notNull(),
    title: text('title').notNull(),
    description: text('description').notNull().default(''),
    startSurfaceKey: text('start_surface_key').notNull().default('agent_factory'),
    steps: text('steps', { mode: 'json' }).$type<JsonObject[]>().notNull().default(sql`'[]'`),
    status: text('status').$type<HelpOnboardingFlowStatus>().notNull().default('active'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [
    index('idx_help_onboarding_flows_key').on(t.flowKey),
    index('idx_help_onboarding_flows_status').on(t.status, t.updatedAt),
  ],
)

export const glossaryTerms = sqliteTable(
  'glossary_terms',
  {
    id: text('id').primaryKey(),
    userTerm: text('user_term').notNull(),
    internalTerm: text('internal_term').notNull(),
    category: text('category').$type<GlossaryTermCategory>().notNull(),
    definition: text('definition').notNull().default(''),
    relatedEntity: text('related_entity').notNull().default(''),
    status: text('status').notNull().default('active'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [
    index('idx_glossary_terms_user').on(t.userTerm),
    index('idx_glossary_terms_internal').on(t.internalTerm),
    index('idx_glossary_terms_category').on(t.category, t.status),
  ],
)

export const faqEntries = sqliteTable(
  'faq_entries',
  {
    id: text('id').primaryKey(),
    questionKey: text('question_key').notNull(),
    question: text('question').notNull(),
    answer: text('answer').notNull(),
    category: text('category').$type<FaqEntryCategory>().notNull(),
    relatedFeature: text('related_feature').notNull().default(''),
    status: text('status').notNull().default('active'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [
    index('idx_faq_entries_key').on(t.questionKey),
    index('idx_faq_entries_category').on(t.category, t.status),
  ],
)

export const troubleshootingEntries = sqliteTable(
  'troubleshooting_entries',
  {
    id: text('id').primaryKey(),
    symptom: text('symptom').notNull(),
    cause: text('cause').notNull(),
    solution: text('solution').notNull(),
    category: text('category').$type<TroubleshootingCategory>().notNull(),
    relatedFeature: text('related_feature').notNull().default(''),
    status: text('status').notNull().default('active'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [
    index('idx_troubleshooting_entries_symptom').on(t.symptom),
    index('idx_troubleshooting_entries_category').on(t.category, t.status),
  ],
)

export const quickReferenceItems = sqliteTable(
  'quick_reference_items',
  {
    id: text('id').primaryKey(),
    actionLabel: text('action_label').notNull(),
    shortcut: text('shortcut'),
    sequenceSteps: text('sequence_steps', { mode: 'json' }).$type<string[]>().notNull().default(sql`'[]'`),
    category: text('category').$type<QuickReferenceCategory>().notNull(),
    targetSurface: text('target_surface').notNull().default('app'),
    status: text('status').notNull().default('active'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [
    index('idx_quick_reference_items_action').on(t.actionLabel),
    index('idx_quick_reference_items_category').on(t.category, t.status),
  ],
)

export const nonGoalPolicies = sqliteTable(
  'non_goal_policies',
  {
    id: text('id').primaryKey(),
    scope: text('scope').$type<NonGoalScope>().notNull(),
    featureKey: text('feature_key').notNull(),
    title: text('title').notNull(),
    rationale: text('rationale').notNull().default(''),
    enforcementPolicy: text('enforcement_policy').notNull().default('documented_boundary'),
    status: text('status').notNull().default('active'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [
    index('idx_non_goal_policies_scope').on(t.scope, t.status),
    index('idx_non_goal_policies_feature').on(t.featureKey),
  ],
)

export const brandCandidates = sqliteTable(
  'brand_candidates',
  {
    id: text('id').primaryKey(),
    language: text('language').$type<BrandCandidateLanguage>().notNull(),
    name: text('name').notNull(),
    rationale: text('rationale').notNull().default(''),
    status: text('status').notNull().default('candidate'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [
    index('idx_brand_candidates_language').on(t.language, t.status),
    index('idx_brand_candidates_name').on(t.name),
  ],
)

export const brandGuidelines = sqliteTable(
  'brand_guidelines',
  {
    id: text('id').primaryKey(),
    slogan: text('slogan').notNull(),
    toneKeywords: text('tone_keywords', { mode: 'json' }).$type<string[]>().notNull().default(sql`'[]'`),
    avoidKeywords: text('avoid_keywords', { mode: 'json' }).$type<string[]>().notNull().default(sql`'[]'`),
    positioning: text('positioning').notNull().default(''),
    status: text('status').notNull().default('active'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [
    index('idx_brand_guidelines_status').on(t.status, t.updatedAt),
  ],
)

export const competitivePositioningReports = sqliteTable(
  'competitive_positioning_reports',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    competitors: text('competitors', { mode: 'json' }).$type<JsonObject[]>().notNull().default(sql`'[]'`),
    differentiators: text('differentiators', { mode: 'json' }).$type<JsonObject[]>().notNull().default(sql`'[]'`),
    strategicImplications: text('strategic_implications', { mode: 'json' })
      .$type<JsonObject[]>()
      .notNull()
      .default(sql`'[]'`),
    summary: text('summary').notNull().default(''),
    status: text('status').$type<CompetitivePositioningStatus>().notNull().default('active'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [
    index('idx_competitive_positioning_status').on(t.status, t.updatedAt),
    index('idx_competitive_positioning_name').on(t.name),
  ],
)

export const ecosystemRoadmapPhases = sqliteTable(
  'ecosystem_roadmap_phases',
  {
    id: text('id').primaryKey(),
    phaseNumber: integer('phase_number').notNull(),
    phaseKey: text('phase_key').notNull(),
    stage: text('stage').$type<EcosystemRoadmapStage>().notNull(),
    title: text('title').notNull(),
    initiatives: text('initiatives', { mode: 'json' }).$type<JsonObject[]>().notNull().default(sql`'[]'`),
    requiredAssets: text('required_assets', { mode: 'json' }).$type<JsonObject>().notNull().default(sql`'{}'`),
    communityChannels: text('community_channels', { mode: 'json' }).$type<string[]>().notNull().default(sql`'[]'`),
    revenueModel: text('revenue_model').notNull().default(''),
    enterpriseReadiness: text('enterprise_readiness', { mode: 'json' }).$type<JsonObject>().notNull().default(sql`'{}'`),
    status: text('status').$type<EcosystemRoadmapStatus>().notNull().default('planned'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [
    index('idx_ecosystem_roadmap_phase').on(t.phaseNumber, t.status),
    index('idx_ecosystem_roadmap_stage').on(t.stage, t.status),
    index('idx_ecosystem_roadmap_key').on(t.phaseKey),
  ],
)

export const ethicalAlignmentPolicies = sqliteTable(
  'ethical_alignment_policies',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    refuseCategories: text('refuse_categories', { mode: 'json' }).$type<string[]>().notNull().default(sql`'[]'`),
    warnCategories: text('warn_categories', { mode: 'json' }).$type<string[]>().notNull().default(sql`'[]'`),
    onRefuse: text('on_refuse').$type<EthicalOnRefuse>().notNull().default('explain_why'),
    userValues: text('user_values', { mode: 'json' }).$type<JsonObject>().notNull().default(sql`'{}'`),
    preTaskAlignment: text('pre_task_alignment', { mode: 'json' }).$type<JsonObject>().notNull().default(sql`'{}'`),
    status: text('status').$type<EthicalAlignmentPolicyStatus>().notNull().default('active'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [
    index('idx_ethical_alignment_policies_status').on(t.status, t.updatedAt),
    index('idx_ethical_alignment_policies_name').on(t.name),
  ],
)

export const ethicalAlignmentEvaluations = sqliteTable(
  'ethical_alignment_evaluations',
  {
    id: text('id').primaryKey(),
    policyId: text('policy_id')
      .notNull()
      .references(() => ethicalAlignmentPolicies.id, { onDelete: 'cascade' }),
    taskSummary: text('task_summary').notNull(),
    detectedCategories: text('detected_categories', { mode: 'json' }).$type<string[]>().notNull().default(sql`'[]'`),
    decision: text('decision').$type<EthicalAlignmentDecision>().notNull(),
    reasons: text('reasons', { mode: 'json' }).$type<string[]>().notNull().default(sql`'[]'`),
    userValuesSnapshot: text('user_values_snapshot', { mode: 'json' }).$type<JsonObject>().notNull().default(sql`'{}'`),
    preTaskAlignmentSnapshot: text('pre_task_alignment_snapshot', { mode: 'json' })
      .$type<JsonObject>()
      .notNull()
      .default(sql`'{}'`),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [
    index('idx_ethical_alignment_evaluations_policy').on(t.policyId, t.createdAt),
    index('idx_ethical_alignment_evaluations_decision').on(t.decision, t.createdAt),
  ],
)

export const legalComplianceFrameworks = sqliteTable(
  'legal_compliance_frameworks',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    regulations: text('regulations', { mode: 'json' }).$type<JsonObject>().notNull().default(sql`'{}'`),
    dataResidencyDefault: text('data_residency_default').notNull().default('local_only'),
    notes: text('notes').notNull().default(''),
    status: text('status').$type<LegalComplianceStatus>().notNull().default('active'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [
    index('idx_legal_compliance_frameworks_status').on(t.status, t.updatedAt),
    index('idx_legal_compliance_frameworks_name').on(t.name),
  ],
)

export const legalDisclaimerNotices = sqliteTable(
  'legal_disclaimer_notices',
  {
    id: text('id').primaryKey(),
    placement: text('placement').$type<LegalDisclaimerPlacement>().notNull(),
    title: text('title').notNull(),
    message: text('message').notNull(),
    requiresAcknowledgement: integer('requires_acknowledgement', { mode: 'boolean' }).notNull().default(false),
    status: text('status').$type<LegalComplianceStatus>().notNull().default('active'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [
    index('idx_legal_disclaimer_notices_placement').on(t.placement, t.status),
  ],
)

export const licenseComplianceChecks = sqliteTable(
  'license_compliance_checks',
  {
    id: text('id').primaryKey(),
    source: text('source').notNull(),
    license: text('license').notNull(),
    obligations: text('obligations', { mode: 'json' }).$type<string[]>().notNull().default(sql`'[]'`),
    restrictions: text('restrictions', { mode: 'json' }).$type<string[]>().notNull().default(sql`'[]'`),
    riskLevel: text('risk_level').$type<LicenseRiskLevel>().notNull(),
    attributionText: text('attribution_text').notNull().default(''),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [
    index('idx_license_compliance_checks_license').on(t.license, t.riskLevel),
    index('idx_license_compliance_checks_source').on(t.source),
  ],
)

export const emotionalUxGuidelines = sqliteTable(
  'emotional_ux_guidelines',
  {
    id: text('id').primaryKey(),
    guidelineType: text('guideline_type').$type<EmotionalUxGuidelineType>().notNull(),
    scenarioKey: text('scenario_key').notNull(),
    title: text('title').notNull(),
    messageTemplate: text('message_template').notNull().default(''),
    behavior: text('behavior').notNull().default(''),
    visualCue: text('visual_cue').notNull().default(''),
    audioCue: text('audio_cue').notNull().default(''),
    anxietyReduction: text('anxiety_reduction').notNull().default(''),
    status: text('status').$type<EmotionalUxStatus>().notNull().default('active'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [
    index('idx_emotional_ux_guidelines_type').on(t.guidelineType, t.status),
    index('idx_emotional_ux_guidelines_scenario').on(t.scenarioKey),
  ],
)

export const systemBootstrapChecks = sqliteTable(
  'system_bootstrap_checks',
  {
    id: text('id').primaryKey(),
    runId: text('run_id').notNull(),
    component: text('component').$type<SystemBootstrapComponent>().notNull(),
    status: text('status').$type<SystemBootstrapCheckStatus>().notNull(),
    observed: text('observed', { mode: 'json' }).$type<JsonObject>().notNull().default(sql`'{}'`),
    threshold: text('threshold', { mode: 'json' }).$type<JsonObject>().notNull().default(sql`'{}'`),
    recommendation: text('recommendation').notNull().default(''),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [
    index('idx_system_bootstrap_checks_run').on(t.runId, t.createdAt),
    index('idx_system_bootstrap_checks_component').on(t.component, t.status),
    index('idx_system_bootstrap_checks_status').on(t.status, t.createdAt),
  ],
)

export const successMetricDefinitions = sqliteTable(
  'success_metric_definitions',
  {
    id: text('id').primaryKey(),
    metricKey: text('metric_key').notNull(),
    category: text('category').$type<SuccessMetricCategory>().notNull(),
    name: text('name').notNull(),
    targetOperator: text('target_operator').$type<SuccessMetricTargetOperator>().notNull().default('track'),
    targetValue: real('target_value'),
    unit: text('unit').notNull().default('count'),
    description: text('description').notNull().default(''),
    status: text('status').notNull().default('active'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [
    index('idx_success_metric_definitions_key').on(t.metricKey),
    index('idx_success_metric_definitions_category').on(t.category, t.status),
  ],
)

export const successMetricSnapshots = sqliteTable(
  'success_metric_snapshots',
  {
    id: text('id').primaryKey(),
    metricDefinitionId: text('metric_definition_id')
      .notNull()
      .references(() => successMetricDefinitions.id, { onDelete: 'cascade' }),
    metricKey: text('metric_key').notNull(),
    value: real('value').notNull(),
    status: text('status').$type<SuccessMetricSnapshotStatus>().notNull(),
    measuredAt: integer('measured_at').notNull(),
    notes: text('notes').notNull().default(''),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [
    index('idx_success_metric_snapshots_definition').on(t.metricDefinitionId, t.measuredAt),
    index('idx_success_metric_snapshots_key').on(t.metricKey, t.status),
  ],
)

export const readinessChecklistItems = sqliteTable(
  'readiness_checklist_items',
  {
    id: text('id').primaryKey(),
    itemKey: text('item_key').notNull(),
    title: text('title').notNull(),
    category: text('category').$type<ReadinessChecklistCategory>().notNull(),
    acceptanceCriteria: text('acceptance_criteria').notNull().default(''),
    required: integer('required', { mode: 'boolean' }).notNull().default(true),
    status: text('status').notNull().default('pending'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [
    index('idx_readiness_checklist_items_key').on(t.itemKey),
    index('idx_readiness_checklist_items_category').on(t.category, t.status),
  ],
)

export const oauthCredentials = sqliteTable(
  'oauth_credentials',
  {
    id: text('id').primaryKey(),
    provider: text('provider').$type<OAuthProvider>().notNull(),
    grantType: text('grant_type').$type<OAuthGrantType>().notNull(),
    accessTokenSecretRef: text('access_token_secret_ref').notNull(),
    refreshTokenSecretRef: text('refresh_token_secret_ref'),
    expiresAt: integer('expires_at').notNull(),
    scopes: text('scopes', { mode: 'json' }).$type<string[]>().notNull().default(sql`'[]'`),
    actingAs: text('acting_as').$type<OAuthActingAs>().notNull(),
    autoRefresh: integer('auto_refresh', { mode: 'boolean' }).notNull().default(true),
    refreshBeforeExpiry: integer('refresh_before_expiry').notNull().default(300),
    allowedOperations: text('allowed_operations', { mode: 'json' }).$type<string[]>().notNull().default(sql`'[]'`),
    requiresUserConsent: integer('requires_user_consent', { mode: 'boolean' }).notNull().default(false),
    shared: integer('shared', { mode: 'boolean' }).notNull().default(false),
    agentProfileId: text('agent_profile_id'),
    status: text('status').$type<OAuthCredentialStatus>().notNull().default('active'),
    lastRefreshStatus: text('last_refresh_status').$type<OAuthRefreshStatus>(),
    lastRefreshError: text('last_refresh_error'),
    pausedRunId: text('paused_run_id'),
    reauthorizationUrl: text('reauthorization_url'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [
    index('idx_oauth_credentials_provider').on(t.provider, t.status),
    index('idx_oauth_credentials_agent').on(t.agentProfileId, t.shared),
  ],
)

export const oauthRefreshEvents = sqliteTable(
  'oauth_refresh_events',
  {
    id: text('id').primaryKey(),
    credentialId: text('credential_id')
      .notNull()
      .references(() => oauthCredentials.id, { onDelete: 'cascade' }),
    status: text('status').$type<OAuthRefreshStatus>().notNull(),
    message: text('message').notNull().default(''),
    pausedRunId: text('paused_run_id'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [
    index('idx_oauth_refresh_events_credential').on(t.credentialId, t.createdAt),
    index('idx_oauth_refresh_events_status').on(t.status),
  ],
)

export const workspaceTemplates = sqliteTable(
  'workspace_templates',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    structure: text('structure').$type<WorkspaceStructure>().notNull(),
    description: text('description').notNull().default(''),
    fileTree: text('file_tree', { mode: 'json' }).$type<JsonObject[]>().notNull().default(sql`'[]'`),
    setupDefaults: text('setup_defaults', { mode: 'json' }).$type<JsonObject>().notNull().default(sql`'{}'`),
    verifyDefaults: text('verify_defaults', { mode: 'json' }).$type<JsonObject>().notNull().default(sql`'{}'`),
    status: text('status').notNull().default('active'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [
    index('idx_workspace_templates_structure').on(t.structure, t.status),
    index('idx_workspace_templates_name').on(t.name),
  ],
)

export const workspaceInitRuns = sqliteTable(
  'workspace_init_runs',
  {
    id: text('id').primaryKey(),
    agentProfileId: text('agent_profile_id'),
    employeeRunId: text('employee_run_id'),
    sourceType: text('source_type').$type<WorkspaceInitSourceType>().notNull(),
    sourceConfig: text('source_config', { mode: 'json' }).$type<JsonObject>().notNull().default(sql`'{}'`),
    structure: text('structure').$type<WorkspaceStructure>(),
    installDeps: integer('install_deps', { mode: 'boolean' }).notNull().default(false),
    runMigrations: integer('run_migrations', { mode: 'boolean' }).notNull().default(false),
    seedData: text('seed_data'),
    linkSharedModules: integer('link_shared_modules', { mode: 'boolean' }).notNull().default(false),
    runTests: integer('run_tests', { mode: 'boolean' }).notNull().default(false),
    checkTypes: integer('check_types', { mode: 'boolean' }).notNull().default(false),
    lintCheck: integer('lint_check', { mode: 'boolean' }).notNull().default(false),
    buildCheck: integer('build_check', { mode: 'boolean' }).notNull().default(false),
    onSetupFail: text('on_setup_fail').$type<WorkspaceSetupFailPolicy>().notNull().default('ask_user'),
    status: text('status').$type<WorkspaceInitRunStatus>().notNull().default('planned'),
    workspacePath: text('workspace_path'),
    actionPlan: text('action_plan', { mode: 'json' }).$type<JsonObject[]>().notNull().default(sql`'[]'`),
    verificationPlan: text('verification_plan', { mode: 'json' }).$type<JsonObject[]>().notNull().default(sql`'[]'`),
    failureMessage: text('failure_message'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [
    index('idx_workspace_init_runs_source').on(t.sourceType, t.status),
    index('idx_workspace_init_runs_agent').on(t.agentProfileId, t.createdAt),
    index('idx_workspace_init_runs_employee').on(t.employeeRunId),
  ],
)

export const customModels = sqliteTable(
  'custom_models',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    sourceType: text('source_type').$type<CustomModelSourceType>().notNull(),
    sourceConfig: text('source_config', { mode: 'json' }).$type<JsonObject>().notNull().default(sql`'{}'`),
    baseModel: text('base_model'),
    datasetDescription: text('dataset_description'),
    taskSpecialization: text('task_specialization', { mode: 'json' }).$type<string[]>().notNull().default(sql`'[]'`),
    finetunedAt: integer('finetuned_at'),
    performanceDelta: text('performance_delta'),
    maxContextWindow: integer('max_context_window').notNull(),
    requiresSpecialPromptFormat: integer('requires_special_prompt_format', { mode: 'boolean' }).notNull().default(false),
    knownLimitations: text('known_limitations', { mode: 'json' }).$type<string[]>().notNull().default(sql`'[]'`),
    compatibleSkills: text('compatible_skills', { mode: 'json' }).$type<string[]>().notNull().default(sql`'[]'`),
    incompatibleSkills: text('incompatible_skills', { mode: 'json' }).$type<string[]>().notNull().default(sql`'[]'`),
    status: text('status').$type<CustomModelStatus>().notNull().default('available'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [
    index('idx_custom_models_source').on(t.sourceType, t.status),
    index('idx_custom_models_name').on(t.name),
  ],
)

export const finetuneDatasetExports = sqliteTable(
  'finetune_dataset_exports',
  {
    id: text('id').primaryKey(),
    customModelId: text('custom_model_id').references(() => customModels.id, { onDelete: 'set null' }),
    sourceScope: text('source_scope').$type<FinetuneDatasetSourceScope>().notNull(),
    sourceIds: text('source_ids', { mode: 'json' }).$type<string[]>().notNull().default(sql`'[]'`),
    datasetPurpose: text('dataset_purpose').notNull(),
    recordCount: integer('record_count').notNull().default(0),
    destinationProvider: text('destination_provider').notNull().default('manual'),
    includePrivateData: integer('include_private_data', { mode: 'boolean' }).notNull().default(false),
    consentStatus: text('consent_status').$type<FinetuneDatasetConsentStatus>().notNull().default('pending'),
    outputManifest: text('output_manifest', { mode: 'json' }).$type<JsonObject>().notNull().default(sql`'{}'`),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [
    index('idx_finetune_dataset_exports_model').on(t.customModelId, t.createdAt),
    index('idx_finetune_dataset_exports_consent').on(t.consentStatus, t.sourceScope),
  ],
)

export const projectContexts = sqliteTable(
  'project_contexts',
  {
    id: text('id').primaryKey(),
    projectName: text('project_name').notNull(),
    modelProfileId: text('model_profile_id'),
    maxBudget: real('max_budget'),
    allowedSkills: text('allowed_skills', { mode: 'json' }).$type<string[]>().notNull().default(sql`'[]'`),
    requiredApprovalFor: text('required_approval_for', { mode: 'json' }).$type<string[]>().notNull().default(sql`'[]'`),
    networkProfileId: text('network_profile_id'),
    pauseCurrentTasks: integer('pause_current_tasks', { mode: 'boolean' }).notNull().default(true),
    isolateMemories: integer('isolate_memories', { mode: 'boolean' }).notNull().default(true),
    checkpointBeforeSwitch: integer('checkpoint_before_switch', { mode: 'boolean' }).notNull().default(true),
    switchMode: text('switch_mode').$type<ProjectSwitchMode>().notNull().default('sequential'),
    status: text('status').$type<ProjectContextStatus>().notNull().default('active'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [
    index('idx_project_contexts_name').on(t.projectName),
    index('idx_project_contexts_status').on(t.status, t.updatedAt),
  ],
)

export const projectAgentRoles = sqliteTable(
  'project_agent_roles',
  {
    id: text('id').primaryKey(),
    projectContextId: text('project_context_id')
      .notNull()
      .references(() => projectContexts.id, { onDelete: 'cascade' }),
    agentId: text('agent_id').notNull(),
    role: text('role').notNull(),
    joinedAt: integer('joined_at').notNull(),
    activeWorkflows: text('active_workflows', { mode: 'json' }).$type<string[]>().notNull().default(sql`'[]'`),
    contributedArtifacts: text('contributed_artifacts', { mode: 'json' }).$type<string[]>().notNull().default(sql`'[]'`),
    projectSpecificMemories: text('project_specific_memories', { mode: 'json' }).$type<string[]>().notNull().default(sql`'[]'`),
    status: text('status').notNull().default('active'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [
    index('idx_project_agent_roles_project').on(t.projectContextId, t.status),
    index('idx_project_agent_roles_agent').on(t.agentId, t.projectContextId),
  ],
)

export const projectSwitchEvents = sqliteTable(
  'project_switch_events',
  {
    id: text('id').primaryKey(),
    agentId: text('agent_id').notNull(),
    fromProjectContextId: text('from_project_context_id').references(() => projectContexts.id, { onDelete: 'set null' }),
    toProjectContextId: text('to_project_context_id')
      .notNull()
      .references(() => projectContexts.id, { onDelete: 'cascade' }),
    pauseCurrentTasks: integer('pause_current_tasks', { mode: 'boolean' }).notNull().default(true),
    isolateMemories: integer('isolate_memories', { mode: 'boolean' }).notNull().default(true),
    checkpointBeforeSwitch: integer('checkpoint_before_switch', { mode: 'boolean' }).notNull().default(true),
    mode: text('mode').$type<ProjectSwitchMode>().notNull().default('sequential'),
    checkpointId: text('checkpoint_id'),
    status: text('status').$type<ProjectSwitchStatus>().notNull().default('planned'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [
    index('idx_project_switch_events_agent').on(t.agentId, t.createdAt),
    index('idx_project_switch_events_to_project').on(t.toProjectContextId, t.status),
  ],
)

export const behaviorSnapshots = sqliteTable(
  'behavior_snapshots',
  {
    id: text('id').primaryKey(),
    agentProfileId: text('agent_profile_id').notNull(),
    kind: text('kind').$type<BehaviorSnapshotKind>().notNull(),
    schedule: text('schedule').notNull().default('weekly'),
    avgStepsPerTask: real('avg_steps_per_task').notNull(),
    avgCostPerTask: real('avg_cost_per_task').notNull(),
    approvalRequestRate: real('approval_request_rate').notNull(),
    typicalPlanStructure: text('typical_plan_structure').notNull(),
    toolPreferenceOrder: text('tool_preference_order', { mode: 'json' }).$type<string[]>().notNull().default(sql`'[]'`),
    outputVerbosity: real('output_verbosity').notNull(),
    maxAllowedDeviation: real('max_allowed_deviation').notNull().default(0.2),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [
    index('idx_behavior_snapshots_agent').on(t.agentProfileId, t.kind),
    index('idx_behavior_snapshots_created').on(t.createdAt),
  ],
)

export const behaviorDriftAnalyses = sqliteTable(
  'behavior_drift_analyses',
  {
    id: text('id').primaryKey(),
    agentProfileId: text('agent_profile_id').notNull(),
    baselineSnapshotId: text('baseline_snapshot_id')
      .notNull()
      .references(() => behaviorSnapshots.id, { onDelete: 'cascade' }),
    currentSnapshotId: text('current_snapshot_id')
      .notNull()
      .references(() => behaviorSnapshots.id, { onDelete: 'cascade' }),
    maxDeviation: real('max_deviation').notNull(),
    severity: text('severity').$type<BehaviorDriftSeverity>().notNull(),
    driftedMetrics: text('drifted_metrics', { mode: 'json' }).$type<JsonObject[]>().notNull().default(sql`'[]'`),
    onSignificantDrift: text('on_significant_drift').$type<DriftResponsePolicy>().notNull(),
    stabilizationActions: text('stabilization_actions', { mode: 'json' }).$type<string[]>().notNull().default(sql`'[]'`),
    recommendation: text('recommendation').notNull().default(''),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [
    index('idx_behavior_drift_agent').on(t.agentProfileId, t.severity),
    index('idx_behavior_drift_snapshots').on(t.baselineSnapshotId, t.currentSnapshotId),
  ],
)

export const behaviorStabilizationRuns = sqliteTable(
  'behavior_stabilization_runs',
  {
    id: text('id').primaryKey(),
    driftAnalysisId: text('drift_analysis_id')
      .notNull()
      .references(() => behaviorDriftAnalyses.id, { onDelete: 'cascade' }),
    agentProfileId: text('agent_profile_id').notNull(),
    actions: text('actions', { mode: 'json' }).$type<string[]>().notNull().default(sql`'[]'`),
    status: text('status').$type<BehaviorStabilizationRunStatus>().notNull().default('planned'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [
    index('idx_behavior_stabilization_runs_analysis').on(t.driftAnalysisId),
    index('idx_behavior_stabilization_runs_agent').on(t.agentProfileId, t.status),
  ],
)

export const skillSynthesisRecords = sqliteTable(
  'skill_synthesis_records',
  {
    id: text('id').primaryKey(),
    sourceSkillIds: text('source_skill_ids', { mode: 'json' }).$type<string[]>().notNull().default(sql`'[]'`),
    detectedPattern: text('detected_pattern').notNull(),
    suggestedCompositeName: text('suggested_composite_name').notNull(),
    compositeDescription: text('composite_description').notNull().default(''),
    confidence: real('confidence').notNull().default(0),
    publishable: integer('publishable', { mode: 'boolean' }).notNull().default(false),
    status: text('status').$type<SkillSynthesisStatus>().notNull().default('suggested'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [
    index('idx_skill_synthesis_status').on(t.status, t.createdAt),
    index('idx_skill_synthesis_name').on(t.suggestedCompositeName),
  ],
)

export const toolPipelines = sqliteTable(
  'tool_pipelines',
  {
    id: text('id').primaryKey(),
    synthesisRecordId: text('synthesis_record_id').references(() => skillSynthesisRecords.id, { onDelete: 'set null' }),
    name: text('name').notNull(),
    composedOf: text('composed_of', { mode: 'json' }).$type<string[]>().notNull().default(sql`'[]'`),
    chain: text('chain', { mode: 'json' }).$type<JsonObject[]>().notNull().default(sql`'[]'`),
    inputOutputMapping: text('input_output_mapping', { mode: 'json' }).$type<JsonObject>().notNull().default(sql`'{}'`),
    onStepFailure: text('on_step_failure').$type<ToolPipelineFailurePolicy>().notNull().default('abort'),
    publishable: integer('publishable', { mode: 'boolean' }).notNull().default(false),
    status: text('status').$type<ToolPipelineStatus>().notNull().default('draft'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [
    index('idx_tool_pipelines_status').on(t.status, t.updatedAt),
    index('idx_tool_pipelines_synthesis').on(t.synthesisRecordId),
  ],
)

export const unifiedSearchIndex = sqliteTable(
  'unified_search_index',
  {
    id: text('id').primaryKey(),
    entityType: text('entity_type').$type<UnifiedSearchEntityType>().notNull(),
    entityId: text('entity_id').notNull(),
    title: text('title').notNull(),
    content: text('content').notNull(),
    snippet: text('snippet').notNull().default(''),
    keywords: text('keywords', { mode: 'json' }).$type<string[]>().notNull().default(sql`'[]'`),
    embedding: text('embedding', { mode: 'json' }).$type<number[]>().notNull().default(sql`'[]'`),
    agentName: text('agent_name'),
    taskName: text('task_name'),
    projectName: text('project_name'),
    timestamp: integer('timestamp').notNull(),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [
    index('idx_unified_search_entity').on(t.entityType, t.entityId),
    index('idx_unified_search_timestamp').on(t.timestamp),
    index('idx_unified_search_project').on(t.projectName),
  ],
)

export const contextCaches = sqliteTable(
  'context_caches',
  {
    id: text('id').primaryKey(),
    agentProfileId: text('agent_profile_id').references(() => agentProfiles.id, { onDelete: 'set null' }),
    projectId: text('project_id'),
    taskType: text('task_type').$type<ContextPreloadTaskType>().notNull().default('general'),
    goal: text('goal').notNull(),
    cacheKey: text('cache_key').notNull(),
    predictors: text('predictors', { mode: 'json' }).$type<string[]>().notNull().default(sql`'[]'`),
    preloadFlags: text('preload_flags', { mode: 'json' }).$type<JsonObject>().notNull().default(sql`'{}'`),
    cachedSections: text('cached_sections', { mode: 'json' }).$type<string[]>().notNull().default(sql`'[]'`),
    projectStructureTTL: text('project_structure_ttl').notNull().default('until_file_change'),
    semanticCacheTTL: integer('semantic_cache_ttl').notNull().default(300),
    memorySearchCacheTTL: integer('memory_search_cache_ttl').notNull().default(600),
    expiresAt: integer('expires_at'),
    invalidationSignal: text('invalidation_signal'),
    status: text('status').$type<ContextCacheStatus>().notNull().default('fresh'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [
    index('idx_context_caches_key').on(t.cacheKey),
    index('idx_context_caches_agent_project').on(t.agentProfileId, t.projectId),
    index('idx_context_caches_status').on(t.status, t.updatedAt),
  ],
)

export const softwareProfiles = sqliteTable('software_profiles', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  appType: text('app_type').$type<SoftwareAppType>().notNull(),
  launchCommand: text('launch_command'),
  executablePath: text('executable_path'),
  defaultWorkstationMode: text('default_workstation_mode')
    .$type<WorkstationMode>()
    .notNull()
    .default('browser_context'),
  adapterType: text('adapter_type').$type<SoftwareAdapterType>().notNull(),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
})

export const softwareCommands = sqliteTable(
  'software_commands',
  {
    id: text('id').primaryKey(),
    softwareProfileId: text('software_profile_id')
      .notNull()
      .references(() => softwareProfiles.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    description: text('description').notNull().default(''),
    inputSchema: text('input_schema', { mode: 'json' }).$type<JsonObject>().notNull().default(sql`'{}'`),
    outputSchema: text('output_schema', { mode: 'json' }).$type<JsonObject>().notNull().default(sql`'{}'`),
    implementation: text('implementation', { mode: 'json' }).$type<JsonObject>().notNull(),
    riskLevel: text('risk_level').$type<RiskLevel>().notNull().default('medium'),
    requiresApproval: integer('requires_approval', { mode: 'boolean' }).notNull().default(true),
    healthStatus: text('health_status').$type<HealthStatus>().notNull().default('unknown'),
    lastTestResult: text('last_test_result'),
    lastCheckedAt: integer('last_checked_at'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [index('idx_software_commands_profile').on(t.softwareProfileId)],
)

export const recordedMacros = sqliteTable(
  'recorded_macros',
  {
    id: text('id').primaryKey(),
    softwareProfileId: text('software_profile_id')
      .notNull()
      .references(() => softwareProfiles.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    description: text('description').notNull().default(''),
    steps: text('steps', { mode: 'json' }).$type<JsonObject[]>().notNull().default(sql`'[]'`),
    inputSchema: text('input_schema', { mode: 'json' }).$type<JsonObject>().notNull().default(sql`'{}'`),
    outputSchema: text('output_schema', { mode: 'json' }).$type<JsonObject>().notNull().default(sql`'{}'`),
    parameterBindings: text('parameter_bindings', { mode: 'json' })
      .$type<JsonObject>()
      .notNull()
      .default(sql`'{}'`),
    riskLevel: text('risk_level').$type<RiskLevel>().notNull().default('medium'),
    status: text('status').$type<RecordedMacroStatus>().notNull().default('active'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [
    index('idx_recorded_macros_profile').on(t.softwareProfileId, t.status),
    index('idx_recorded_macros_status').on(t.status),
  ],
)

export const agentProfiles = sqliteTable(
  'agent_profiles',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    role: text('role').notNull(),
    description: text('description').notNull().default(''),
    modelProfileId: text('model_profile_id').references(() => modelProfiles.id, {
      onDelete: 'set null',
    }),
    fallbackModelProfileIds: text('fallback_model_profile_ids', { mode: 'json' })
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'`),
    skillIds: text('skill_ids', { mode: 'json' }).$type<string[]>().notNull().default(sql`'[]'`),
    mcpServerIds: text('mcp_server_ids', { mode: 'json' }).$type<string[]>().notNull().default(sql`'[]'`),
    cliProfileIds: text('cli_profile_ids', { mode: 'json' }).$type<string[]>().notNull().default(sql`'[]'`),
    softwareProfileIds: text('software_profile_ids', { mode: 'json' })
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'`),
    memoryPolicy: text('memory_policy', { mode: 'json' }).$type<JsonObject>().notNull().default(sql`'{}'`),
    autonomyPolicy: text('autonomy_policy', { mode: 'json' }).$type<JsonObject>().notNull().default(sql`'{}'`),
    workstationPolicy: text('workstation_policy', { mode: 'json' }).$type<JsonObject>().notNull().default(sql`'{}'`),
    permissionPolicy: text('permission_policy', { mode: 'json' }).$type<JsonObject>().notNull().default(sql`'{}'`),
    inputContract: text('input_contract', { mode: 'json' }).$type<JsonObject>().notNull().default(sql`'{}'`),
    outputContract: text('output_contract', { mode: 'json' }).$type<JsonObject>().notNull().default(sql`'{}'`),
    persona: text('persona', { mode: 'json' }).$type<AgentPersona>().notNull().default(sql`'{}'`),
    systemPrompt: text('system_prompt').notNull().default(''),
    behaviorRules: text('behavior_rules', { mode: 'json' }).$type<string[]>().notNull().default(sql`'[]'`),
    successCriteria: text('success_criteria', { mode: 'json' }).$type<string[]>().notNull().default(sql`'[]'`),
    status: text('status', { enum: ['draft', 'active', 'archived'] }).notNull().default('draft'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [index('idx_agent_profiles_status').on(t.status)],
)

export const agentCloneRecords = sqliteTable(
  'agent_clone_records',
  {
    id: text('id').primaryKey(),
    sourceAgentProfileId: text('source_agent_profile_id').references(() => agentProfiles.id, {
      onDelete: 'set null',
    }),
    clonedAgentProfileId: text('cloned_agent_profile_id').references(() => agentProfiles.id, {
      onDelete: 'set null',
    }),
    copiedModelConfig: integer('copied_model_config', { mode: 'boolean' }).notNull().default(true),
    skillMode: text('skill_mode').$type<AgentCloneSkillMode>().notNull().default('shared'),
    memoryMode: text('memory_mode').$type<AgentCloneMemoryMode>().notNull().default('semantic_only'),
    copiedPermissionConfig: integer('copied_permission_config', { mode: 'boolean' })
      .notNull()
      .default(true),
    modifications: text('modifications', { mode: 'json' }).$type<JsonObject>().notNull().default(sql`'{}'`),
    experimentNote: text('experiment_note').notNull().default(''),
    copiedMemoryIds: text('copied_memory_ids', { mode: 'json' })
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'`),
    status: text('status').$type<AgentExperimentStatus>().notNull().default('created'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [
    index('idx_agent_clone_records_source').on(t.sourceAgentProfileId, t.createdAt),
    index('idx_agent_clone_records_cloned').on(t.clonedAgentProfileId, t.createdAt),
  ],
)

export const agentComparisonReports = sqliteTable(
  'agent_comparison_reports',
  {
    id: text('id').primaryKey(),
    leftAgentProfileId: text('left_agent_profile_id').references(() => agentProfiles.id, {
      onDelete: 'set null',
    }),
    rightAgentProfileId: text('right_agent_profile_id').references(() => agentProfiles.id, {
      onDelete: 'set null',
    }),
    tasks: text('tasks', { mode: 'json' }).$type<JsonObject[]>().notNull().default(sql`'[]'`),
    metrics: text('metrics', { mode: 'json' }).$type<JsonObject>().notNull().default(sql`'{}'`),
    taskResults: text('task_results', { mode: 'json' })
      .$type<JsonObject[]>()
      .notNull()
      .default(sql`'[]'`),
    summary: text('summary', { mode: 'json' }).$type<JsonObject>().notNull().default(sql`'{}'`),
    status: text('status').$type<AgentExperimentStatus>().notNull().default('completed'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [
    index('idx_agent_comparison_reports_left').on(t.leftAgentProfileId, t.createdAt),
    index('idx_agent_comparison_reports_right').on(t.rightAgentProfileId, t.createdAt),
  ],
)

export const agentWhatIfAnalyses = sqliteTable(
  'agent_what_if_analyses',
  {
    id: text('id').primaryKey(),
    agentProfileId: text('agent_profile_id').references(() => agentProfiles.id, {
      onDelete: 'set null',
    }),
    proposedChanges: text('proposed_changes', { mode: 'json' })
      .$type<JsonObject>()
      .notNull()
      .default(sql`'{}'`),
    impactItems: text('impact_items', { mode: 'json' })
      .$type<JsonObject[]>()
      .notNull()
      .default(sql`'[]'`),
    affectedWorkflowIds: text('affected_workflow_ids', { mode: 'json' })
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'`),
    summary: text('summary', { mode: 'json' }).$type<JsonObject>().notNull().default(sql`'{}'`),
    status: text('status').$type<AgentExperimentStatus>().notNull().default('completed'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [index('idx_agent_what_if_analyses_agent').on(t.agentProfileId, t.createdAt)],
)

export const agentSchedules = sqliteTable(
  'agent_schedules',
  {
    id: text('id').primaryKey(),
    agentProfileId: text('agent_profile_id')
      .notNull()
      .references(() => agentProfiles.id, { onDelete: 'cascade' }),
    timezone: text('timezone').notNull().default('UTC'),
    weeklySchedule: text('weekly_schedule', { mode: 'json' })
      .$type<AgentWeeklySchedule>()
      .notNull()
      .default(sql`'{}'`),
    maintenanceWindows: text('maintenance_windows', { mode: 'json' })
      .$type<AgentMaintenanceWindow[]>()
      .notNull()
      .default(sql`'[]'`),
    overtimePolicy: text('overtime_policy', { mode: 'json' })
      .$type<AgentOvertimePolicy>()
      .notNull()
      .default(sql`'{}'`),
    vacationMode: text('vacation_mode', { mode: 'json' })
      .$type<AgentVacationMode>()
      .notNull()
      .default(sql`'{}'`),
    currentStatus: text('current_status')
      .$type<AgentScheduleCurrentStatus>()
      .notNull()
      .default('off_duty'),
    lastDecision: text('last_decision', { mode: 'json' })
      .$type<AgentAvailabilityDecision | null>(),
    status: text('status').$type<AgentScheduleStatus>().notNull().default('active'),
    lastEvaluatedAt: integer('last_evaluated_at'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [
    index('idx_agent_schedules_agent').on(t.agentProfileId, t.status),
    index('idx_agent_schedules_status').on(t.status, t.updatedAt),
  ],
)

export const agentCertificationExams = sqliteTable(
  'agent_certification_exams',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    description: text('description').notNull().default(''),
    tasks: text('tasks', { mode: 'json' }).$type<AgentCertificationTask[]>().notNull().default(sql`'[]'`),
    passingScore: real('passing_score').notNull().default(80),
    validityPeriod: text('validity_period')
      .$type<AgentCertificationValidityPeriod>()
      .notNull()
      .default('1y'),
    level: text('level').$type<AgentCertificationLevel>().notNull().default('basic'),
    status: text('status').$type<AgentCertificationExamStatus>().notNull().default('active'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [
    index('idx_agent_certification_exams_status').on(t.status, t.level),
    index('idx_agent_certification_exams_name').on(t.name),
  ],
)

export const agentCertificationRuns = sqliteTable(
  'agent_certification_runs',
  {
    id: text('id').primaryKey(),
    agentProfileId: text('agent_profile_id')
      .notNull()
      .references(() => agentProfiles.id, { onDelete: 'cascade' }),
    examId: text('exam_id')
      .notNull()
      .references(() => agentCertificationExams.id, { onDelete: 'cascade' }),
    submissions: text('submissions', { mode: 'json' })
      .$type<AgentCertificationSubmission[]>()
      .notNull()
      .default(sql`'[]'`),
    taskScores: text('task_scores', { mode: 'json' })
      .$type<AgentCertificationTaskScore[]>()
      .notNull()
      .default(sql`'[]'`),
    score: real('score').notNull().default(0),
    passed: integer('passed', { mode: 'boolean' }).notNull().default(false),
    status: text('status').$type<AgentCertificationRunStatus>().notNull().default('completed'),
    badge: text('badge').notNull().default(''),
    discoveredLimitations: text('discovered_limitations', { mode: 'json' })
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'`),
    improvementSuggestions: text('improvement_suggestions', { mode: 'json' })
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'`),
    completedAt: integer('completed_at').notNull(),
    expiresAt: integer('expires_at'),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [
    index('idx_agent_certification_runs_agent').on(t.agentProfileId, t.completedAt),
    index('idx_agent_certification_runs_exam').on(t.examId, t.passed),
  ],
)

export const styleGuides = sqliteTable(
  'style_guides',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    language: text('language', { mode: 'json' }).$type<JsonObject>().notNull().default(sql`'{}'`),
    code: text('code', { mode: 'json' }).$type<JsonObject>().notNull().default(sql`'{}'`),
    visual: text('visual', { mode: 'json' }).$type<JsonObject>().notNull().default(sql`'{}'`),
    outputRules: text('output_rules', { mode: 'json' }).$type<JsonObject>().notNull().default(sql`'{}'`),
    status: text('status').$type<StyleGuideStatus>().notNull().default('active'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [
    index('idx_style_guides_status').on(t.status, t.updatedAt),
  ],
)

export const agentStyleGuideBindings = sqliteTable(
  'agent_style_guide_bindings',
  {
    id: text('id').primaryKey(),
    agentProfileId: text('agent_profile_id')
      .notNull()
      .references(() => agentProfiles.id, { onDelete: 'cascade' }),
    styleGuideId: text('style_guide_id')
      .notNull()
      .references(() => styleGuides.id, { onDelete: 'cascade' }),
    status: text('status').$type<StyleGuideBindingStatus>().notNull().default('active'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [
    index('idx_agent_style_guide_bindings_agent').on(t.agentProfileId, t.status),
    index('idx_agent_style_guide_bindings_guide').on(t.styleGuideId, t.status),
  ],
)

export const agentDiversityProfiles = sqliteTable(
  'agent_diversity_profiles',
  {
    id: text('id').primaryKey(),
    agentProfileId: text('agent_profile_id')
      .notNull()
      .references(() => agentProfiles.id, { onDelete: 'cascade' }),
    personality: text('personality').$type<AgentPersonality>().notNull().default('cautious'),
    perspective: text('perspective').notNull().default('implementation'),
    temperature: real('temperature').notNull().default(0.4),
    riskPosture: text('risk_posture').$type<AgentRiskPosture>().notNull().default('balanced'),
    collaborationRole: text('collaboration_role').notNull().default('contributor'),
    status: text('status').$type<AgentDiversityProfileStatus>().notNull().default('active'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [
    index('idx_agent_diversity_profiles_agent').on(t.agentProfileId, t.status),
    index('idx_agent_diversity_profiles_personality').on(t.personality, t.status),
  ],
)

export const diversityAnalyses = sqliteTable(
  'diversity_analyses',
  {
    id: text('id').primaryKey(),
    scopeType: text('scope_type').$type<DiversityScopeType>().notNull().default('team'),
    scopeId: text('scope_id'),
    agentProfileIds: text('agent_profile_ids', { mode: 'json' })
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'`),
    modelDiversity: text('model_diversity', { mode: 'json' })
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'`),
    skillDiversity: integer('skill_diversity').notNull().default(0),
    perspectiveDiversity: real('perspective_diversity').notNull().default(0),
    personalityDiversity: real('personality_diversity').notNull().default(0),
    missingPerspectives: text('missing_perspectives', { mode: 'json' })
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'`),
    recommendation: text('recommendation').notNull(),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [
    index('idx_diversity_analyses_scope').on(t.scopeType, t.scopeId, t.createdAt),
  ],
)

export const agentInterviews = sqliteTable(
  'agent_interviews',
  {
    id: text('id').primaryKey(),
    agentProfileId: text('agent_profile_id')
      .notNull()
      .references(() => agentProfiles.id, { onDelete: 'cascade' }),
    scenarioTitle: text('scenario_title').notNull(),
    scenarioTask: text('scenario_task').notNull(),
    transcript: text('transcript', { mode: 'json' }).$type<JsonObject[]>().notNull().default(sql`'[]'`),
    rubric: text('rubric', { mode: 'json' }).$type<JsonObject>().notNull().default(sql`'{}'`),
    scores: text('scores', { mode: 'json' }).$type<JsonObject>().notNull().default(sql`'{}'`),
    overallScore: real('overall_score').notNull().default(0),
    strengths: text('strengths', { mode: 'json' }).$type<string[]>().notNull().default(sql`'[]'`),
    warnings: text('warnings', { mode: 'json' }).$type<string[]>().notNull().default(sql`'[]'`),
    recommendations: text('recommendations', { mode: 'json' }).$type<string[]>().notNull().default(sql`'[]'`),
    promptPatches: text('prompt_patches', { mode: 'json' }).$type<string[]>().notNull().default(sql`'[]'`),
    trialDecision: text('trial_decision').$type<AgentInterviewDecision>().notNull().default('revise_prompt'),
    status: text('status').$type<AgentInterviewStatus>().notNull().default('scheduled'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
    completedAt: integer('completed_at'),
  },
  (t) => [
    index('idx_agent_interviews_agent').on(t.agentProfileId, t.createdAt),
    index('idx_agent_interviews_status').on(t.status, t.overallScore),
  ],
)

export const performanceReviews = sqliteTable(
  'performance_reviews',
  {
    id: text('id').primaryKey(),
    agentProfileId: text('agent_profile_id')
      .notNull()
      .references(() => agentProfiles.id, { onDelete: 'cascade' }),
    reviewerAgentProfileId: text('reviewer_agent_profile_id').references(() => agentProfiles.id, {
      onDelete: 'set null',
    }),
    sampledRunIds: text('sampled_run_ids', { mode: 'json' }).$type<string[]>().notNull().default(sql`'[]'`),
    periodStartAt: integer('period_start_at'),
    periodEndAt: integer('period_end_at'),
    sampleSize: integer('sample_size').notNull().default(3),
    qualityScore: real('quality_score').notNull().default(0),
    reliabilityScore: real('reliability_score').notNull().default(0),
    adaptationScore: real('adaptation_score').notNull().default(0),
    overallScore: real('overall_score').notNull().default(0),
    findings: text('findings', { mode: 'json' }).$type<string[]>().notNull().default(sql`'[]'`),
    improvementSuggestions: text('improvement_suggestions', { mode: 'json' })
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'`),
    recommendedPromptPatches: text('recommended_prompt_patches', { mode: 'json' })
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'`),
    appliedChanges: text('applied_changes', { mode: 'json' }).$type<JsonObject>().notNull().default(sql`'{}'`),
    status: text('status').$type<PerformanceReviewStatus>().notNull().default('draft'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [
    index('idx_performance_reviews_agent').on(t.agentProfileId, t.createdAt),
    index('idx_performance_reviews_status').on(t.status, t.overallScore),
    index('idx_performance_reviews_reviewer').on(t.reviewerAgentProfileId),
  ],
)

export const agentMentorships = sqliteTable(
  'agent_mentorships',
  {
    id: text('id').primaryKey(),
    mentorAgentProfileId: text('mentor_agent_profile_id')
      .notNull()
      .references(() => agentProfiles.id, { onDelete: 'cascade' }),
    menteeAgentProfileId: text('mentee_agent_profile_id')
      .notNull()
      .references(() => agentProfiles.id, { onDelete: 'cascade' }),
    scope: text('scope').$type<AgentMentorshipScope>().notNull().default('until_proficiency'),
    scopeTaskTypes: text('scope_task_types', { mode: 'json' }).$type<string[]>().notNull().default(sql`'[]'`),
    style: text('style').$type<AgentMentorshipStyle>().notNull().default('review_and_feedback'),
    reviewOutputs: integer('review_outputs', { mode: 'boolean' }).notNull().default(true),
    interveneWhenStuck: integer('intervene_when_stuck', { mode: 'boolean' }).notNull().default(true),
    shareRelevantMemories: integer('share_relevant_memories', { mode: 'boolean' }).notNull().default(true),
    generatePracticeTasks: integer('generate_practice_tasks', { mode: 'boolean' }).notNull().default(true),
    initialProficiency: real('initial_proficiency').notNull().default(0),
    currentProficiency: real('current_proficiency').notNull().default(0),
    targetProficiency: real('target_proficiency').notNull().default(0.8),
    tasksUntilGraduation: integer('tasks_until_graduation').notNull().default(5),
    fastestImprovingAreas: text('fastest_improving_areas', { mode: 'json' })
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'`),
    needsImprovement: text('needs_improvement', { mode: 'json' }).$type<string[]>().notNull().default(sql`'[]'`),
    status: text('status').$type<AgentMentorshipStatus>().notNull().default('active'),
    startedAt: integer('started_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
    graduatedAt: integer('graduated_at'),
  },
  (t) => [
    index('idx_agent_mentorships_mentor').on(t.mentorAgentProfileId, t.status),
    index('idx_agent_mentorships_mentee').on(t.menteeAgentProfileId, t.status),
  ],
)

export const agentMentoringEvents = sqliteTable(
  'agent_mentoring_events',
  {
    id: text('id').primaryKey(),
    mentorshipId: text('mentorship_id')
      .notNull()
      .references(() => agentMentorships.id, { onDelete: 'cascade' }),
    eventType: text('event_type').$type<AgentMentoringEventType>().notNull(),
    employeeRunId: text('employee_run_id').references(() => employeeRuns.id, { onDelete: 'set null' }),
    artifactId: text('artifact_id').references(() => artifacts.id, { onDelete: 'set null' }),
    summary: text('summary').notNull().default(''),
    feedback: text('feedback').notNull().default(''),
    sharedMemoryIds: text('shared_memory_ids', { mode: 'json' }).$type<string[]>().notNull().default(sql`'[]'`),
    practiceTask: text('practice_task', { mode: 'json' }).$type<JsonObject>().notNull().default(sql`'{}'`),
    proficiencyDelta: real('proficiency_delta').notNull().default(0),
    successfulTask: integer('successful_task', { mode: 'boolean' }).notNull().default(false),
    areasImproved: text('areas_improved', { mode: 'json' }).$type<string[]>().notNull().default(sql`'[]'`),
    needsImprovement: text('needs_improvement', { mode: 'json' }).$type<string[]>().notNull().default(sql`'[]'`),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [
    index('idx_agent_mentoring_events_mentorship').on(t.mentorshipId, t.createdAt),
    index('idx_agent_mentoring_events_type').on(t.eventType, t.createdAt),
  ],
)

export const userOverrides = sqliteTable(
  'user_overrides',
  {
    id: text('id').primaryKey(),
    command: text('command').$type<UserOverrideCommand>().notNull(),
    targetType: text('target_type').$type<UserOverrideTargetType>().notNull().default('workspace'),
    targetId: text('target_id'),
    reason: text('reason').notNull().default(''),
    trigger: text('trigger').$type<UserOverrideTrigger>().notNull().default('api'),
    payload: text('payload', { mode: 'json' }).$type<JsonObject>().notNull().default(sql`'{}'`),
    effects: text('effects', { mode: 'json' }).$type<JsonObject>().notNull().default(sql`'{}'`),
    status: text('status').$type<UserOverrideStatus>().notNull().default('recorded'),
    createdAt: integer('created_at').notNull(),
    appliedAt: integer('applied_at'),
  },
  (t) => [
    index('idx_user_overrides_target').on(t.targetType, t.targetId, t.createdAt),
    index('idx_user_overrides_command').on(t.command, t.status),
  ],
)

export const capabilityIndexEntries = sqliteTable(
  'capability_index_entries',
  {
    id: text('id').primaryKey(),
    sourceType: text('source_type').$type<CapabilitySourceType>().notNull(),
    sourceId: text('source_id').notNull(),
    displayName: text('display_name').notNull(),
    description: text('description').notNull().default(''),
    capabilityKind: text('capability_kind').notNull(),
    keywords: text('keywords', { mode: 'json' }).$type<string[]>().notNull().default(sql`'[]'`),
    signals: text('signals', { mode: 'json' }).$type<JsonObject>().notNull().default(sql`'{}'`),
    riskLevel: text('risk_level').$type<RiskLevel>().notNull().default('low'),
    enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
    healthStatus: text('health_status').$type<HealthStatus>().notNull().default('unknown'),
    scoreHint: real('score_hint').notNull().default(0),
    lastIndexedAt: integer('last_indexed_at').notNull(),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [
    index('idx_capability_index_source').on(t.sourceType, t.sourceId),
    index('idx_capability_index_kind').on(t.capabilityKind, t.enabled),
  ],
)

export const knowledgeGraphNodes = sqliteTable(
  'knowledge_graph_nodes',
  {
    id: text('id').primaryKey(),
    nodeType: text('node_type').$type<KnowledgeNodeType>().notNull(),
    sourceType: text('source_type').$type<CapabilitySourceType>(),
    sourceId: text('source_id'),
    label: text('label').notNull(),
    summary: text('summary').notNull().default(''),
    properties: text('properties', { mode: 'json' }).$type<JsonObject>().notNull().default(sql`'{}'`),
    embedding: text('embedding', { mode: 'json' }).$type<number[]>().notNull().default(sql`'[]'`),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [
    index('idx_knowledge_nodes_source').on(t.sourceType, t.sourceId),
    index('idx_knowledge_nodes_type').on(t.nodeType),
  ],
)

export const knowledgeGraphEdges = sqliteTable(
  'knowledge_graph_edges',
  {
    id: text('id').primaryKey(),
    fromNodeId: text('from_node_id')
      .notNull()
      .references(() => knowledgeGraphNodes.id, { onDelete: 'cascade' }),
    toNodeId: text('to_node_id')
      .notNull()
      .references(() => knowledgeGraphNodes.id, { onDelete: 'cascade' }),
    edgeType: text('edge_type').$type<KnowledgeEdgeType>().notNull(),
    weight: real('weight').notNull().default(1),
    evidence: text('evidence', { mode: 'json' }).$type<JsonObject>().notNull().default(sql`'{}'`),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [
    index('idx_knowledge_edges_from').on(t.fromNodeId, t.edgeType),
    index('idx_knowledge_edges_to').on(t.toNodeId, t.edgeType),
  ],
)

export const capabilityRecommendations = sqliteTable(
  'capability_recommendations',
  {
    id: text('id').primaryKey(),
    agentProfileId: text('agent_profile_id').references(() => agentProfiles.id, {
      onDelete: 'set null',
    }),
    query: text('query').notNull(),
    capabilityEntryId: text('capability_entry_id').references(() => capabilityIndexEntries.id, {
      onDelete: 'set null',
    }),
    score: real('score').notNull(),
    reason: text('reason').notNull(),
    applied: integer('applied', { mode: 'boolean' }).notNull().default(false),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [
    index('idx_capability_recommendations_agent').on(t.agentProfileId, t.createdAt),
    index('idx_capability_recommendations_entry').on(t.capabilityEntryId),
  ],
)

export const autonomyDecisions = sqliteTable(
  'autonomy_decisions',
  {
    id: text('id').primaryKey(),
    agentProfileId: text('agent_profile_id').references(() => agentProfiles.id, {
      onDelete: 'set null',
    }),
    actionType: text('action_type').$type<AutonomyActionType>().notNull(),
    resourceType: text('resource_type').notNull(),
    resourceId: text('resource_id'),
    requestedMode: text('requested_mode').notNull().default('dry_run'),
    autonomyLevel: text('autonomy_level').$type<AutonomyLevel>().notNull(),
    riskLevel: text('risk_level').$type<RiskLevel>().notNull(),
    status: text('status').$type<AutonomyDecisionStatus>().notNull(),
    requiresApproval: integer('requires_approval', { mode: 'boolean' }).notNull().default(false),
    reason: text('reason').notNull(),
    policySnapshot: text('policy_snapshot', { mode: 'json' }).$type<JsonObject>().notNull().default(sql`'{}'`),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [
    index('idx_autonomy_decisions_agent').on(t.agentProfileId, t.createdAt),
    index('idx_autonomy_decisions_resource').on(t.resourceType, t.resourceId),
  ],
)

export const dynamicPermissionGrants = sqliteTable(
  'dynamic_permission_grants',
  {
    id: text('id').primaryKey(),
    agentProfileId: text('agent_profile_id').references(() => agentProfiles.id, {
      onDelete: 'set null',
    }),
    employeeRunId: text('employee_run_id').references(() => employeeRuns.id, {
      onDelete: 'set null',
    }),
    permissionKey: text('permission_key').notNull(),
    actionType: text('action_type').$type<AutonomyActionType>().notNull(),
    resourceType: text('resource_type').notNull(),
    resourceId: text('resource_id'),
    duration: text('duration').$type<DynamicPermissionDuration>().notNull(),
    status: text('status').$type<DynamicPermissionGrantStatus>().notNull(),
    riskLevel: text('risk_level').$type<RiskLevel>().notNull(),
    justification: text('justification').notNull().default(''),
    reason: text('reason').notNull().default(''),
    policySnapshot: text('policy_snapshot', { mode: 'json' }).$type<JsonObject>().notNull().default(sql`'{}'`),
    autonomyDecisionId: text('autonomy_decision_id').references(() => autonomyDecisions.id, {
      onDelete: 'set null',
    }),
    approvalRequestId: text('approval_request_id').references(() => approvalRequests.id, {
      onDelete: 'set null',
    }),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
    expiresAt: integer('expires_at'),
    revokedAt: integer('revoked_at'),
  },
  (t) => [
    index('idx_dynamic_permission_grants_agent').on(t.agentProfileId, t.createdAt),
    index('idx_dynamic_permission_grants_run').on(t.employeeRunId, t.status),
    index('idx_dynamic_permission_grants_permission').on(t.permissionKey, t.status),
  ],
)

export const voiceInterfaceProfiles = sqliteTable(
  'voice_interface_profiles',
  {
    id: text('id').primaryKey(),
    agentProfileId: text('agent_profile_id').references(() => agentProfiles.id, {
      onDelete: 'set null',
    }),
    inputMode: text('input_mode').$type<VoiceInputMode>().notNull().default('push_to_talk'),
    wakeWord: text('wake_word'),
    language: text('language').notNull().default('en-US'),
    speakerIdentification: integer('speaker_identification', { mode: 'boolean' }).notNull().default(false),
    ttsEngine: text('tts_engine').$type<TtsEngine>().notNull().default('system'),
    voice: text('voice').notNull().default('default'),
    speed: real('speed').notNull().default(1),
    speakOn: text('speak_on', { mode: 'json' }).$type<VoiceSpeakOn[]>().notNull().default(sql`'[]'`),
    conversationPolicy: text('conversation_policy', { mode: 'json' }).$type<JsonObject>().notNull().default(sql`'{}'`),
    status: text('status').$type<VoiceProfileStatus>().notNull().default('draft'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [
    index('idx_voice_interface_profiles_agent').on(t.agentProfileId, t.status),
    index('idx_voice_interface_profiles_status').on(t.status),
  ],
)

export const voiceConversationTurns = sqliteTable(
  'voice_conversation_turns',
  {
    id: text('id').primaryKey(),
    voiceInterfaceProfileId: text('voice_interface_profile_id').references(
      () => voiceInterfaceProfiles.id,
      { onDelete: 'set null' },
    ),
    agentProfileId: text('agent_profile_id').references(() => agentProfiles.id, {
      onDelete: 'set null',
    }),
    speaker: text('speaker').$type<VoiceConversationSpeaker>().notNull(),
    speakerLabel: text('speaker_label').notNull().default(''),
    text: text('text').notNull(),
    language: text('language').notNull().default('en-US'),
    source: text('source').notNull().default('text_placeholder'),
    status: text('status').$type<VoiceConversationTurnStatus>().notNull().default('captured'),
    metadata: text('metadata', { mode: 'json' }).$type<JsonObject>().notNull().default(sql`'{}'`),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [
    index('idx_voice_turns_profile').on(t.voiceInterfaceProfileId, t.createdAt),
    index('idx_voice_turns_agent').on(t.agentProfileId, t.createdAt),
  ],
)

export const e2eEncryptionPolicies = sqliteTable(
  'e2e_encryption_policies',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    localIpcEncryption: text('local_ipc_encryption')
      .$type<LocalIpcEncryption>()
      .notNull()
      .default('none'),
    remoteEncryption: text('remote_encryption')
      .$type<RemoteCommunicationEncryption>()
      .notNull()
      .default('tls_1_3'),
    certificatePinning: integer('certificate_pinning', { mode: 'boolean' }).notNull().default(true),
    mutualTls: integer('mutual_tls', { mode: 'boolean' }).notNull().default(false),
    encryptExport: integer('encrypt_export', { mode: 'boolean' }).notNull().default(true),
    passwordProtected: integer('password_protected', { mode: 'boolean' }).notNull().default(true),
    notes: text('notes').notNull().default(''),
    status: text('status').$type<E2EEncryptionPolicyStatus>().notNull().default('active'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [index('idx_e2e_policies_status').on(t.status, t.createdAt)],
)

export const e2eEncryptionChecks = sqliteTable(
  'e2e_encryption_checks',
  {
    id: text('id').primaryKey(),
    policyId: text('policy_id').references(() => e2eEncryptionPolicies.id, {
      onDelete: 'set null',
    }),
    scope: text('scope').$type<E2EEncryptionCheckScope>().notNull(),
    resourceType: text('resource_type').notNull(),
    resourceId: text('resource_id'),
    status: text('status').$type<E2EEncryptionCheckStatus>().notNull(),
    findings: text('findings', { mode: 'json' }).$type<string[]>().notNull().default(sql`'[]'`),
    result: text('result', { mode: 'json' }).$type<JsonObject>().notNull().default(sql`'{}'`),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [
    index('idx_e2e_checks_policy').on(t.policyId, t.createdAt),
    index('idx_e2e_checks_scope_status').on(t.scope, t.status),
  ],
)

export const concurrencyProfiles = sqliteTable(
  'concurrency_profiles',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    maxProcesses: integer('max_processes').notNull().default(64),
    maxFileDescriptors: integer('max_file_descriptors').notNull().default(1024),
    maxMemoryBytes: integer('max_memory_bytes').notNull().default(8 * 1024 * 1024 * 1024),
    maxBrowserInstances: integer('max_browser_instances').notNull().default(3),
    maxModelConnections: integer('max_model_connections').notNull().default(8),
    lowMemoryMaxAgents: integer('low_memory_max_agents').notNull().default(2),
    lowMemoryMaxBrowsers: integer('low_memory_max_browsers').notNull().default(1),
    midMemoryMaxAgents: integer('mid_memory_max_agents').notNull().default(5),
    midMemoryMaxBrowsers: integer('mid_memory_max_browsers').notNull().default(3),
    highMemoryMaxAgents: integer('high_memory_max_agents').notNull().default(10),
    highMemoryMaxBrowsers: integer('high_memory_max_browsers').notNull().default(6),
    workstationMaxAgents: integer('workstation_max_agents').notNull().default(20),
    workstationMaxBrowsers: integer('workstation_max_browsers').notNull().default(12),
    adaptiveLimit: integer('adaptive_limit', { mode: 'boolean' }).notNull().default(true),
    status: text('status').$type<ConcurrencyProfileStatus>().notNull().default('active'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [index('idx_concurrency_profiles_status').on(t.status, t.createdAt)],
)

export const concurrencyEvaluations = sqliteTable(
  'concurrency_evaluations',
  {
    id: text('id').primaryKey(),
    concurrencyProfileId: text('concurrency_profile_id').references(() => concurrencyProfiles.id, {
      onDelete: 'set null',
    }),
    memoryTier: text('memory_tier').$type<ConcurrencyMemoryTier>().notNull(),
    currentAgents: integer('current_agents').notNull().default(0),
    currentBrowsers: integer('current_browsers').notNull().default(0),
    currentModelConnections: integer('current_model_connections').notNull().default(0),
    totalMemoryBytes: integer('total_memory_bytes').notNull().default(0),
    usedMemoryBytes: integer('used_memory_bytes').notNull().default(0),
    recommendedMaxAgents: integer('recommended_max_agents').notNull().default(0),
    recommendedMaxBrowsers: integer('recommended_max_browsers').notNull().default(0),
    status: text('status').$type<ConcurrencyEvaluationStatus>().notNull(),
    reason: text('reason').notNull().default(''),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [
    index('idx_concurrency_evaluations_profile').on(t.concurrencyProfileId, t.createdAt),
    index('idx_concurrency_evaluations_status').on(t.status, t.createdAt),
  ],
)

export const abusePreventionPolicies = sqliteTable(
  'abuse_prevention_policies',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    agentCreationBurstMax: integer('agent_creation_burst_max').notNull().default(10),
    agentCreationBurstWindowMs: integer('agent_creation_burst_window_ms').notNull().default(60 * 60 * 1000),
    outboundRequestBurstMax: integer('outbound_request_burst_max').notNull().default(100),
    outboundRequestBurstWindowMs: integer('outbound_request_burst_window_ms').notNull().default(60 * 1000),
    maxRequestsPerDomain: integer('max_requests_per_domain').notNull().default(30),
    spamSimilarOutputRatio: real('spam_similar_output_ratio').notNull().default(0.85),
    intrusionPatterns: text('intrusion_patterns', { mode: 'json' }).$type<string[]>().notNull().default(sql`'[]'`),
    lightAction: text('light_action').$type<AbusePreventionAction>().notNull().default('warn_user'),
    moderateAction: text('moderate_action').$type<AbusePreventionAction>().notNull().default('pause_agent_and_warn'),
    severeAction: text('severe_action').$type<AbusePreventionAction>().notNull().default('stop_and_quarantine_agent'),
    criticalAction: text('critical_action').$type<AbusePreventionAction>().notNull().default('stop_all_and_notify_admin'),
    status: text('status').$type<AbusePreventionPolicyStatus>().notNull().default('active'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [index('idx_abuse_policies_status').on(t.status, t.createdAt)],
)

export const abuseDetectionEvents = sqliteTable(
  'abuse_detection_events',
  {
    id: text('id').primaryKey(),
    policyId: text('policy_id').references(() => abusePreventionPolicies.id, {
      onDelete: 'set null',
    }),
    agentProfileId: text('agent_profile_id').references(() => agentProfiles.id, {
      onDelete: 'set null',
    }),
    employeeRunId: text('employee_run_id').references(() => employeeRuns.id, {
      onDelete: 'set null',
    }),
    severity: text('severity').$type<AbusePreventionSeverity>().notNull().default('none'),
    action: text('action').$type<AbusePreventionAction>().notNull().default('none'),
    detectedRules: text('detected_rules', { mode: 'json' }).$type<string[]>().notNull().default(sql`'[]'`),
    signals: text('signals', { mode: 'json' }).$type<JsonObject>().notNull().default(sql`'{}'`),
    result: text('result', { mode: 'json' }).$type<JsonObject>().notNull().default(sql`'{}'`),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [
    index('idx_abuse_events_policy').on(t.policyId, t.createdAt),
    index('idx_abuse_events_agent').on(t.agentProfileId, t.createdAt),
    index('idx_abuse_events_severity').on(t.severity, t.createdAt),
  ],
)

export const abuseAppeals = sqliteTable(
  'abuse_appeals',
  {
    id: text('id').primaryKey(),
    abuseDetectionEventId: text('abuse_detection_event_id').references(() => abuseDetectionEvents.id, {
      onDelete: 'set null',
    }),
    agentProfileId: text('agent_profile_id').references(() => agentProfiles.id, {
      onDelete: 'set null',
    }),
    reason: text('reason').notNull().default(''),
    status: text('status').$type<AbuseAppealStatus>().notNull().default('submitted'),
    reviewNote: text('review_note').notNull().default(''),
    createdAt: integer('created_at').notNull(),
    reviewedAt: integer('reviewed_at'),
  },
  (t) => [
    index('idx_abuse_appeals_event').on(t.abuseDetectionEventId),
    index('idx_abuse_appeals_status').on(t.status, t.createdAt),
  ],
)

export const futureTechInterfaces = sqliteTable(
  'future_tech_interfaces',
  {
    id: text('id').primaryKey(),
    capabilityKind: text('capability_kind').$type<FutureTechCapabilityKind>().notNull(),
    displayName: text('display_name').notNull(),
    abstractionName: text('abstraction_name').notNull(),
    description: text('description').notNull().default(''),
    reservedMethods: text('reserved_methods', { mode: 'json' }).$type<string[]>().notNull().default(sql`'[]'`),
    safetyBoundary: text('safety_boundary').notNull().default(''),
    localFirst: integer('local_first', { mode: 'boolean' }).notNull().default(true),
    readiness: text('readiness').$type<FutureTechReadiness>().notNull().default('reserved'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [
    index('idx_future_tech_interfaces_kind').on(t.capabilityKind),
    index('idx_future_tech_interfaces_readiness').on(t.readiness, t.updatedAt),
  ],
)

export const futureTechRadarItems = sqliteTable(
  'future_tech_radar_items',
  {
    id: text('id').primaryKey(),
    stage: text('stage').$type<FutureTechStage>().notNull(),
    title: text('title').notNull(),
    description: text('description').notNull().default(''),
    capabilityKinds: text('capability_kinds', { mode: 'json' }).$type<FutureTechCapabilityKind[]>().notNull().default(sql`'[]'`),
    dependencies: text('dependencies', { mode: 'json' }).$type<string[]>().notNull().default(sql`'[]'`),
    status: text('status').$type<FutureTechRadarStatus>().notNull().default('planned'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [
    index('idx_future_tech_radar_stage').on(t.stage, t.status),
    index('idx_future_tech_radar_status').on(t.status, t.updatedAt),
  ],
)

export const commercialPlans = sqliteTable(
  'commercial_plans',
  {
    id: text('id').primaryKey(),
    planKey: text('plan_key').$type<CommercialPlanKey>().notNull(),
    name: text('name').notNull(),
    priceCents: integer('price_cents'),
    currency: text('currency').notNull().default('USD'),
    billingPeriod: text('billing_period').$type<CommercialBillingPeriod>().notNull(),
    maxAgents: integer('max_agents'),
    maxConcurrentRuns: integer('max_concurrent_runs'),
    features: text('features', { mode: 'json' }).$type<string[]>().notNull().default(sql`'[]'`),
    limits: text('limits', { mode: 'json' }).$type<JsonObject>().notNull().default(sql`'{}'`),
    status: text('status').$type<CommercialPlanStatus>().notNull().default('active'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [
    index('idx_commercial_plans_key').on(t.planKey),
    index('idx_commercial_plans_status').on(t.status, t.updatedAt),
  ],
)

export const monetizationRevenueStreams = sqliteTable(
  'monetization_revenue_streams',
  {
    id: text('id').primaryKey(),
    streamType: text('stream_type').$type<RevenueStreamType>().notNull(),
    name: text('name').notNull(),
    priority: integer('priority').notNull().default(100),
    description: text('description').notNull().default(''),
    commissionRateBps: integer('commission_rate_bps'),
    status: text('status').$type<RevenueStreamStatus>().notNull().default('active'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [
    index('idx_revenue_streams_type').on(t.streamType),
    index('idx_revenue_streams_status').on(t.status, t.priority),
  ],
)

export const commercialPolicyRules = sqliteTable(
  'commercial_policy_rules',
  {
    id: text('id').primaryKey(),
    ruleType: text('rule_type').$type<CommercialPolicyRuleType>().notNull(),
    title: text('title').notNull(),
    description: text('description').notNull().default(''),
    severity: text('severity').$type<CommercialPolicySeverity>().notNull().default('info'),
    status: text('status').$type<CommercialPlanStatus>().notNull().default('active'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [
    index('idx_commercial_policy_rules_type').on(t.ruleType),
    index('idx_commercial_policy_rules_status').on(t.status, t.severity),
  ],
)

export const openSourceComponents = sqliteTable(
  'open_source_components',
  {
    id: text('id').primaryKey(),
    layer: text('layer').$type<SourceLicenseLayer>().notNull(),
    name: text('name').notNull(),
    scope: text('scope').notNull().default(''),
    license: text('license').notNull(),
    sourceVisibility: text('source_visibility').notNull().default('source_visible'),
    commercialUse: text('commercial_use').notNull().default('allowed'),
    authorPolicy: text('author_policy').notNull().default(''),
    status: text('status').$type<OpenSourceGovernanceStatus>().notNull().default('active'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [
    index('idx_open_source_components_layer').on(t.layer),
    index('idx_open_source_components_status').on(t.status, t.updatedAt),
  ],
)

export const communityGovernanceRoles = sqliteTable(
  'community_governance_roles',
  {
    id: text('id').primaryKey(),
    roleType: text('role_type').$type<GovernanceRoleType>().notNull(),
    name: text('name').notNull(),
    responsibilities: text('responsibilities', { mode: 'json' }).$type<string[]>().notNull().default(sql`'[]'`),
    permissions: text('permissions', { mode: 'json' }).$type<string[]>().notNull().default(sql`'[]'`),
    status: text('status').$type<OpenSourceGovernanceStatus>().notNull().default('active'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [
    index('idx_governance_roles_type').on(t.roleType),
    index('idx_governance_roles_status').on(t.status, t.updatedAt),
  ],
)

export const governanceRfcDecisions = sqliteTable(
  'governance_rfc_decisions',
  {
    id: text('id').primaryKey(),
    title: text('title').notNull(),
    summary: text('summary').notNull().default(''),
    proposer: text('proposer').notNull().default(''),
    status: text('status').$type<GovernanceRfcStatus>().notNull().default('rfc'),
    discussionUrl: text('discussion_url'),
    votesFor: integer('votes_for').notNull().default(0),
    votesAgainst: integer('votes_against').notNull().default(0),
    implementationNotes: text('implementation_notes').notNull().default(''),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [
    index('idx_governance_rfc_status').on(t.status, t.updatedAt),
    index('idx_governance_rfc_proposer').on(t.proposer, t.createdAt),
  ],
)

export const contributorPrerequisites = sqliteTable(
  'contributor_prerequisites',
  {
    id: text('id').primaryKey(),
    tool: text('tool').$type<ContributorTool>().notNull(),
    minimumVersion: text('minimum_version').notNull().default(''),
    required: integer('required', { mode: 'boolean' }).notNull().default(true),
    installHint: text('install_hint').notNull().default(''),
    status: text('status').$type<OpenSourceGovernanceStatus>().notNull().default('active'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [
    index('idx_contributor_prerequisites_tool').on(t.tool),
    index('idx_contributor_prerequisites_status').on(t.status, t.updatedAt),
  ],
)

export const contributionPolicies = sqliteTable(
  'contribution_policies',
  {
    id: text('id').primaryKey(),
    policyType: text('policy_type').$type<ContributionPolicyType>().notNull(),
    key: text('key').notNull(),
    description: text('description').notNull().default(''),
    required: integer('required', { mode: 'boolean' }).notNull().default(true),
    metadata: text('metadata', { mode: 'json' }).$type<JsonObject>().notNull().default(sql`'{}'`),
    status: text('status').$type<OpenSourceGovernanceStatus>().notNull().default('active'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [
    index('idx_contribution_policies_type').on(t.policyType),
    index('idx_contribution_policies_status').on(t.status, t.updatedAt),
  ],
)

export const architecturePatterns = sqliteTable(
  'architecture_patterns',
  {
    id: text('id').primaryKey(),
    patternKey: text('pattern_key').$type<ArchitecturePatternKey>().notNull(),
    name: text('name').notNull(),
    description: text('description').notNull().default(''),
    appliedTo: text('applied_to', { mode: 'json' }).$type<string[]>().notNull().default(sql`'[]'`),
    required: integer('required', { mode: 'boolean' }).notNull().default(true),
    status: text('status').$type<OpenSourceGovernanceStatus>().notNull().default('active'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [
    index('idx_architecture_patterns_key').on(t.patternKey),
    index('idx_architecture_patterns_status').on(t.status, t.updatedAt),
  ],
)

export const architectureInterfaces = sqliteTable(
  'architecture_interfaces',
  {
    id: text('id').primaryKey(),
    interfaceName: text('interface_name').notNull(),
    responsibility: text('responsibility').notNull().default(''),
    reservedMethods: text('reserved_methods', { mode: 'json' }).$type<string[]>().notNull().default(sql`'[]'`),
    ownerService: text('owner_service').notNull().default(''),
    status: text('status').$type<OpenSourceGovernanceStatus>().notNull().default('active'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [
    index('idx_architecture_interfaces_name').on(t.interfaceName),
    index('idx_architecture_interfaces_status').on(t.status, t.updatedAt),
  ],
)

export const technicalArchitectureEvaluations = sqliteTable(
  'technical_architecture_evaluations',
  {
    id: text('id').primaryKey(),
    version: text('version').notNull(),
    status: text('status').$type<TechnicalArchitectureEvaluationStatus>().notNull(),
    manifest: text('manifest', { mode: 'json' })
      .$type<TechnicalArchitectureManifest>()
      .notNull()
      .default(sql`'{}'`),
    checks: text('checks', { mode: 'json' })
      .$type<TechnicalArchitectureCheck[]>()
      .notNull()
      .default(sql`'[]'`),
    summary: text('summary', { mode: 'json' })
      .$type<TechnicalArchitectureSummary>()
      .notNull()
      .default(sql`'{}'`),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [
    index('idx_technical_architecture_evaluations_status').on(t.status, t.createdAt),
    index('idx_technical_architecture_evaluations_version').on(t.version, t.createdAt),
  ],
)

export const errorCodeCatalog = sqliteTable(
  'error_code_catalog',
  {
    id: text('id').primaryKey(),
    code: text('code').notNull(),
    category: text('category').$type<ErrorCodeCategory>().notNull(),
    numericCode: text('numeric_code').notNull(),
    title: text('title').notNull(),
    description: text('description').notNull().default(''),
    severity: text('severity').$type<ErrorCodeSeverity>().notNull().default('error'),
    retryable: integer('retryable', { mode: 'boolean' }).notNull().default(false),
    remediation: text('remediation').notNull().default(''),
    status: text('status').$type<OpenSourceGovernanceStatus>().notNull().default('active'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [
    index('idx_error_code_catalog_code').on(t.code),
    index('idx_error_code_catalog_category').on(t.category, t.numericCode),
    index('idx_error_code_catalog_status').on(t.status, t.updatedAt),
  ],
)

export const entityStateMachines = sqliteTable(
  'entity_state_machines',
  {
    id: text('id').primaryKey(),
    entityType: text('entity_type').$type<EntityStateMachineType>().notNull(),
    name: text('name').notNull(),
    description: text('description').notNull().default(''),
    states: text('states', { mode: 'json' }).$type<string[]>().notNull().default(sql`'[]'`),
    initialState: text('initial_state').notNull(),
    terminalStates: text('terminal_states', { mode: 'json' }).$type<string[]>().notNull().default(sql`'[]'`),
    errorState: text('error_state'),
    status: text('status').$type<OpenSourceGovernanceStatus>().notNull().default('active'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [
    index('idx_entity_state_machines_type').on(t.entityType),
    index('idx_entity_state_machines_status').on(t.status, t.updatedAt),
  ],
)

export const entityStateTransitions = sqliteTable(
  'entity_state_transitions',
  {
    id: text('id').primaryKey(),
    machineId: text('machine_id')
      .notNull()
      .references(() => entityStateMachines.id, { onDelete: 'cascade' }),
    entityType: text('entity_type').$type<EntityStateMachineType>().notNull(),
    fromState: text('from_state').notNull(),
    toState: text('to_state').notNull(),
    trigger: text('trigger').notNull().default(''),
    reversible: integer('reversible', { mode: 'boolean' }).notNull().default(false),
    description: text('description').notNull().default(''),
    status: text('status').$type<OpenSourceGovernanceStatus>().notNull().default('active'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [
    index('idx_entity_state_transitions_machine').on(t.machineId),
    index('idx_entity_state_transitions_entity_from').on(t.entityType, t.fromState),
    index('idx_entity_state_transitions_status').on(t.status, t.updatedAt),
  ],
)

export const promptEngineeringGuides = sqliteTable(
  'prompt_engineering_guides',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    description: text('description').notNull().default(''),
    recommendedSections: text('recommended_sections', { mode: 'json' })
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'`),
    requiredPlaceholders: text('required_placeholders', { mode: 'json' })
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'`),
    maxTokens: integer('max_tokens').notNull().default(3000),
    examplePolicy: text('example_policy').notNull().default('specific_examples_with_positive_negative_pairs'),
    mustRulePhrase: text('must_rule_phrase').notNull().default('你必须'),
    status: text('status').$type<OpenSourceGovernanceStatus>().notNull().default('active'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [
    index('idx_prompt_engineering_guides_status').on(t.status, t.updatedAt),
    index('idx_prompt_engineering_guides_name').on(t.name),
  ],
)

export const promptAntiPatternRules = sqliteTable(
  'prompt_anti_pattern_rules',
  {
    id: text('id').primaryKey(),
    guideId: text('guide_id')
      .notNull()
      .references(() => promptEngineeringGuides.id, { onDelete: 'cascade' }),
    ruleKey: text('rule_key').$type<PromptAntiPatternRuleKey>().notNull(),
    description: text('description').notNull().default(''),
    severity: text('severity').$type<RiskLevel>().notNull().default('medium'),
    detectorHint: text('detector_hint').notNull().default(''),
    status: text('status').$type<OpenSourceGovernanceStatus>().notNull().default('active'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [
    index('idx_prompt_anti_pattern_rules_guide').on(t.guideId),
    index('idx_prompt_anti_pattern_rules_key').on(t.ruleKey, t.status),
  ],
)

export const promptTemplates = sqliteTable(
  'prompt_templates',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    description: text('description').notNull().default(''),
    scope: text('scope').$type<PromptTemplateScope>().notNull().default('workspace'),
    agentProfileId: text('agent_profile_id').references(() => agentProfiles.id, {
      onDelete: 'set null',
    }),
    engine: text('engine').$type<PromptTemplateEngine>().notNull().default('handlebars'),
    template: text('template').notNull().default(''),
    variables: text('variables', { mode: 'json' })
      .$type<PromptTemplateVariables>()
      .notNull()
      .default(sql`'{}'`),
    conditionalBlocks: text('conditional_blocks', { mode: 'json' })
      .$type<PromptTemplateConditionalBlock[]>()
      .notNull()
      .default(sql`'[]'`),
    status: text('status').$type<PromptTemplateStatus>().notNull().default('draft'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [index('idx_prompt_templates_scope_status').on(t.scope, t.status)],
)

export const promptTemplateVersions = sqliteTable(
  'prompt_template_versions',
  {
    id: text('id').primaryKey(),
    promptTemplateId: text('prompt_template_id')
      .notNull()
      .references(() => promptTemplates.id, { onDelete: 'cascade' }),
    version: integer('version').notNull(),
    systemPrompt: text('system_prompt').notNull().default(''),
    content: text('content').notNull().default(''),
    contextRules: text('context_rules', { mode: 'json' })
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'`),
    inputSchema: text('input_schema', { mode: 'json' }).$type<JsonObject>().notNull().default(sql`'{}'`),
    outputSchema: text('output_schema', { mode: 'json' }).$type<JsonObject>().notNull().default(sql`'{}'`),
    modelHints: text('model_hints', { mode: 'json' }).$type<JsonObject>().notNull().default(sql`'{}'`),
    abTest: text('ab_test', { mode: 'json' }).$type<PromptVersionAbTest | null>(),
    deployedAt: integer('deployed_at'),
    retiredAt: integer('retired_at'),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [index('idx_prompt_template_versions_template').on(t.promptTemplateId, t.version)],
)

export const contextCompressorPolicies = sqliteTable(
  'context_compressor_policies',
  {
    id: text('id').primaryKey(),
    agentProfileId: text('agent_profile_id').references(() => agentProfiles.id, {
      onDelete: 'set null',
    }),
    name: text('name').notNull(),
    config: text('config', { mode: 'json' })
      .$type<ContextCompressorConfig>()
      .notNull()
      .default(sql`'{}'`),
    tokenBudgetConfig: text('token_budget_config', { mode: 'json' })
      .$type<TokenBudgetAllocationConfig>()
      .notNull()
      .default(sql`'{}'`),
    status: text('status').$type<ContextCompressorPolicyStatus>().notNull().default('active'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [
    index('idx_context_compressor_policies_agent').on(t.agentProfileId, t.status),
    index('idx_context_compressor_policies_status').on(t.status),
  ],
)

export const contextCompressionPlans = sqliteTable(
  'context_compression_plans',
  {
    id: text('id').primaryKey(),
    policyId: text('policy_id')
      .notNull()
      .references(() => contextCompressorPolicies.id, { onDelete: 'cascade' }),
    agentProfileId: text('agent_profile_id').references(() => agentProfiles.id, {
      onDelete: 'set null',
    }),
    employeeRunId: text('employee_run_id').references(() => employeeRuns.id, {
      onDelete: 'set null',
    }),
    runtimeContextSnapshotId: text('runtime_context_snapshot_id').references(
      () => runtimeContextSnapshots.id,
      { onDelete: 'set null' },
    ),
    goal: text('goal').notNull().default(''),
    input: text('input', { mode: 'json' }).$type<JsonObject>().notNull().default(sql`'{}'`),
    tokenBudget: integer('token_budget').notNull(),
    tokenEstimate: integer('token_estimate').notNull(),
    triggerThresholdTokens: integer('trigger_threshold_tokens').notNull(),
    status: text('status').$type<ContextCompressionPlanStatus>().notNull().default('planned'),
    strategy: text('strategy').$type<ContextCompressionStrategy>().notNull(),
    preserveAlways: text('preserve_always', { mode: 'json' })
      .$type<ContextPreserveItem[]>()
      .notNull()
      .default(sql`'[]'`),
    summarizerModel: text('summarizer_model').$type<ContextSummarizerModel>().notNull(),
    allocation: text('allocation', { mode: 'json' })
      .$type<TokenBudgetAllocationResult>()
      .notNull()
      .default(sql`'{}'`),
    preservedSections: text('preserved_sections', { mode: 'json' })
      .$type<ContextCompressionSectionDecision[]>()
      .notNull()
      .default(sql`'[]'`),
    compressedSections: text('compressed_sections', { mode: 'json' })
      .$type<ContextCompressionSectionDecision[]>()
      .notNull()
      .default(sql`'[]'`),
    omittedSections: text('omitted_sections', { mode: 'json' })
      .$type<ContextCompressionSectionDecision[]>()
      .notNull()
      .default(sql`'[]'`),
    summary: text('summary').notNull(),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [
    index('idx_context_compression_plans_policy').on(t.policyId, t.createdAt),
    index('idx_context_compression_plans_agent').on(t.agentProfileId, t.createdAt),
    index('idx_context_compression_plans_status').on(t.status, t.createdAt),
  ],
)

export const promptDriftMonitors = sqliteTable(
  'prompt_drift_monitors',
  {
    id: text('id').primaryKey(),
    agentProfileId: text('agent_profile_id').references(() => agentProfiles.id, {
      onDelete: 'set null',
    }),
    modelProfileId: text('model_profile_id').references(() => modelProfiles.id, {
      onDelete: 'set null',
    }),
    name: text('name').notNull(),
    schedule: text('schedule').$type<PromptDriftSchedule>().notNull().default('30d'),
    checks: text('checks', { mode: 'json' }).$type<PromptDriftChecks>().notNull(),
    onDriftDetected: text('on_drift_detected').$type<PromptDriftAction>().notNull().default('notify_user'),
    thresholds: text('thresholds', { mode: 'json' }).$type<JsonObject>().notNull().default(sql`'{}'`),
    status: text('status').$type<PromptDriftMonitorStatus>().notNull().default('active'),
    lastRunAt: integer('last_run_at'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [
    index('idx_prompt_drift_monitors_agent').on(t.agentProfileId, t.status),
    index('idx_prompt_drift_monitors_model').on(t.modelProfileId, t.status),
    index('idx_prompt_drift_monitors_schedule').on(t.schedule, t.status),
  ],
)

export const modelBehaviorSnapshots = sqliteTable(
  'model_behavior_snapshots',
  {
    id: text('id').primaryKey(),
    monitorId: text('monitor_id').references(() => promptDriftMonitors.id, {
      onDelete: 'set null',
    }),
    agentProfileId: text('agent_profile_id').references(() => agentProfiles.id, {
      onDelete: 'set null',
    }),
    modelProfileId: text('model_profile_id').references(() => modelProfiles.id, {
      onDelete: 'set null',
    }),
    modelName: text('model_name').notNull(),
    modelDate: text('model_date').notNull(),
    providerVersion: text('provider_version'),
    benchmarkResults: text('benchmark_results', { mode: 'json' }).$type<JsonObject>().notNull().default(sql`'{}'`),
    pinned: integer('pinned', { mode: 'boolean' }).notNull().default(false),
    notes: text('notes').notNull().default(''),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [
    index('idx_model_behavior_snapshots_monitor').on(t.monitorId, t.createdAt),
    index('idx_model_behavior_snapshots_model').on(t.modelName, t.modelDate),
    index('idx_model_behavior_snapshots_pinned').on(t.pinned, t.createdAt),
  ],
)

export const promptDriftRuns = sqliteTable(
  'prompt_drift_runs',
  {
    id: text('id').primaryKey(),
    monitorId: text('monitor_id')
      .notNull()
      .references(() => promptDriftMonitors.id, { onDelete: 'cascade' }),
    baselineSnapshotId: text('baseline_snapshot_id').references(() => modelBehaviorSnapshots.id, {
      onDelete: 'set null',
    }),
    candidateSnapshotId: text('candidate_snapshot_id').references(() => modelBehaviorSnapshots.id, {
      onDelete: 'set null',
    }),
    status: text('status').$type<PromptDriftRunStatus>().notNull(),
    driftSignals: text('drift_signals', { mode: 'json' }).$type<JsonObject[]>().notNull().default(sql`'[]'`),
    summary: text('summary').notNull(),
    recommendedAction: text('recommended_action').$type<PromptDriftAction>().notNull(),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [
    index('idx_prompt_drift_runs_monitor').on(t.monitorId, t.createdAt),
    index('idx_prompt_drift_runs_status').on(t.status, t.createdAt),
  ],
)

export const dualModelVerifications = sqliteTable(
  'dual_model_verifications',
  {
    id: text('id').primaryKey(),
    appliesTo: text('applies_to').$type<ConsensusCriticalTask>().notNull(),
    primaryModelProfileId: text('primary_model_profile_id').references(() => modelProfiles.id, {
      onDelete: 'set null',
    }),
    secondaryModelProfileId: text('secondary_model_profile_id').references(() => modelProfiles.id, {
      onDelete: 'set null',
    }),
    secondaryModel: text('secondary_model').$type<SecondaryModelStrategy>().notNull(),
    primaryResult: text('primary_result', { mode: 'json' }).$type<JsonObject>().notNull().default(sql`'{}'`),
    secondaryResult: text('secondary_result', { mode: 'json' }).$type<JsonObject>().notNull().default(sql`'{}'`),
    agreement: integer('agreement', { mode: 'boolean' }).notNull(),
    disagreementPoints: text('disagreement_points', { mode: 'json' }).$type<string[]>().notNull().default(sql`'[]'`),
    confidence: real('confidence').notNull(),
    recommendedAction: text('recommended_action').$type<ConsensusRecommendedAction>().notNull(),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [
    index('idx_dual_model_verifications_task').on(t.appliesTo, t.createdAt),
    index('idx_dual_model_verifications_action').on(t.recommendedAction, t.createdAt),
  ],
)

export const agentConsensusVotes = sqliteTable(
  'agent_consensus_votes',
  {
    id: text('id').primaryKey(),
    question: text('question').notNull(),
    voters: text('voters', { mode: 'json' }).$type<JsonObject[]>().notNull().default(sql`'[]'`),
    quorum: integer('quorum').notNull(),
    requiredMajority: real('required_majority').notNull(),
    tieBreaker: text('tie_breaker').$type<AgentVotingTieBreaker>().notNull(),
    winningVote: text('winning_vote'),
    majorityRatio: real('majority_ratio').notNull().default(0),
    decision: text('decision').$type<AgentVotingDecision>().notNull(),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [
    index('idx_agent_consensus_votes_decision').on(t.decision, t.createdAt),
    index('idx_agent_consensus_votes_question').on(t.question),
  ],
)

export const adversarialReviews = sqliteTable(
  'adversarial_reviews',
  {
    id: text('id').primaryKey(),
    subjectAgentId: text('subject_agent_id').references(() => agentProfiles.id, {
      onDelete: 'set null',
    }),
    reviewerAgentId: text('reviewer_agent_id').references(() => agentProfiles.id, {
      onDelete: 'set null',
    }),
    targetTitle: text('target_title').notNull(),
    targetContent: text('target_content', { mode: 'json' }).$type<JsonObject>().notNull().default(sql`'{}'`),
    skepticism: real('skepticism').notNull().default(0.8),
    assumptions: text('assumptions', { mode: 'json' }).$type<string[]>().notNull().default(sql`'[]'`),
    missedCases: text('missed_cases', { mode: 'json' }).$type<string[]>().notNull().default(sql`'[]'`),
    attackerExploitation: text('attacker_exploitation', { mode: 'json' }).$type<string[]>().notNull().default(sql`'[]'`),
    worstCases: text('worst_cases', { mode: 'json' }).$type<string[]>().notNull().default(sql`'[]'`),
    issues: text('issues', { mode: 'json' }).$type<string[]>().notNull().default(sql`'[]'`),
    status: text('status').$type<AdversarialReviewStatus>().notNull(),
    recommendedAction: text('recommended_action').$type<AdversarialReviewAction>().notNull(),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [
    index('idx_adversarial_reviews_subject').on(t.subjectAgentId, t.createdAt),
    index('idx_adversarial_reviews_reviewer').on(t.reviewerAgentId, t.createdAt),
    index('idx_adversarial_reviews_status').on(t.status, t.createdAt),
  ],
)

export const contentSafetyPolicies = sqliteTable(
  'content_safety_policies',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    layers: text('layers', { mode: 'json' }).$type<ContentSafetyLayers>().notNull(),
    onFlag: text('on_flag').$type<ContentSafetyAction>().notNull().default('warn'),
    status: text('status').$type<ContentSafetyPolicyStatus>().notNull().default('active'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [
    index('idx_content_safety_policies_status').on(t.status, t.updatedAt),
    index('idx_content_safety_policies_action').on(t.onFlag, t.status),
  ],
)

export const contentSafetyScans = sqliteTable(
  'content_safety_scans',
  {
    id: text('id').primaryKey(),
    policyId: text('policy_id').references(() => contentSafetyPolicies.id, {
      onDelete: 'set null',
    }),
    agentProfileId: text('agent_profile_id').references(() => agentProfiles.id, {
      onDelete: 'set null',
    }),
    employeeRunId: text('employee_run_id'),
    artifactId: text('artifact_id').references(() => artifacts.id, {
      onDelete: 'set null',
    }),
    contentType: text('content_type').$type<SafetyReviewedContentType>().notNull().default('text'),
    contentHash: text('content_hash').notNull(),
    inputPreview: text('input_preview').notNull().default(''),
    redactedPreview: text('redacted_preview').notNull().default(''),
    categories: text('categories', { mode: 'json' })
      .$type<ContentSafetyCategory[]>()
      .notNull()
      .default(sql`'[]'`),
    findings: text('findings', { mode: 'json' }).$type<JsonObject[]>().notNull().default(sql`'[]'`),
    cloudReviewRequired: integer('cloud_review_required', { mode: 'boolean' })
      .notNull()
      .default(false),
    decision: text('decision').$type<ContentSafetyDecision>().notNull(),
    status: text('status').$type<ContentSafetyScanStatus>().notNull(),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [
    index('idx_content_safety_scans_policy').on(t.policyId, t.createdAt),
    index('idx_content_safety_scans_agent').on(t.agentProfileId, t.createdAt),
    index('idx_content_safety_scans_status').on(t.status, t.createdAt),
  ],
)

export const copyrightChecks = sqliteTable(
  'copyright_checks',
  {
    id: text('id').primaryKey(),
    scanId: text('scan_id').references(() => contentSafetyScans.id, {
      onDelete: 'set null',
    }),
    agentProfileId: text('agent_profile_id').references(() => agentProfiles.id, {
      onDelete: 'set null',
    }),
    artifactId: text('artifact_id').references(() => artifacts.id, {
      onDelete: 'set null',
    }),
    contentType: text('content_type').$type<SafetyReviewedContentType>().notNull().default('code'),
    config: text('config', { mode: 'json' }).$type<CopyrightCheckConfig>().notNull(),
    similarityScore: real('similarity_score').notNull().default(0),
    matchedSourceRefs: text('matched_source_refs', { mode: 'json' })
      .$type<JsonObject[]>()
      .notNull()
      .default(sql`'[]'`),
    metadataFlags: text('metadata_flags', { mode: 'json' }).$type<string[]>().notNull().default(sql`'[]'`),
    externalSearchRequired: integer('external_search_required', { mode: 'boolean' })
      .notNull()
      .default(false),
    decision: text('decision').$type<CopyrightOnMatch | 'allow'>().notNull().default('allow'),
    status: text('status').$type<CopyrightCheckStatus>().notNull().default('clear'),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [
    index('idx_copyright_checks_scan').on(t.scanId, t.createdAt),
    index('idx_copyright_checks_agent').on(t.agentProfileId, t.createdAt),
    index('idx_copyright_checks_status').on(t.status, t.createdAt),
  ],
)

export const trustCalibrationPolicies = sqliteTable(
  'trust_calibration_policies',
  {
    id: text('id').primaryKey(),
    agentProfileId: text('agent_profile_id').references(() => agentProfiles.id, {
      onDelete: 'set null',
    }),
    name: text('name').notNull(),
    config: text('config', { mode: 'json' }).$type<TrustCalibrationConfig>().notNull(),
    trustPath: text('trust_path', { mode: 'json' }).$type<JsonObject[]>().notNull().default(sql`'[]'`),
    status: text('status').$type<TrustCalibrationPolicyStatus>().notNull().default('active'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [
    index('idx_trust_calibration_policies_agent').on(t.agentProfileId, t.status),
    index('idx_trust_calibration_policies_status').on(t.status, t.updatedAt),
  ],
)

export const trustCalibrationEvaluations = sqliteTable(
  'trust_calibration_evaluations',
  {
    id: text('id').primaryKey(),
    policyId: text('policy_id').references(() => trustCalibrationPolicies.id, {
      onDelete: 'set null',
    }),
    agentProfileId: text('agent_profile_id').references(() => agentProfiles.id, {
      onDelete: 'set null',
    }),
    metrics: text('metrics', { mode: 'json' }).$type<TrustCalibrationMetrics>().notNull(),
    currentTrustLevel: text('current_trust_level').$type<TrustLevel>().notNull(),
    recommendedTrustLevel: text('recommended_trust_level').$type<TrustLevel>().notNull(),
    currentAutonomyLevel: text('current_autonomy_level').$type<AutonomyLevel>().notNull(),
    recommendedAutonomyLevel: text('recommended_autonomy_level').$type<AutonomyLevel>().notNull(),
    recommendation: text('recommendation').$type<TrustCalibrationRecommendation>().notNull(),
    signals: text('signals', { mode: 'json' }).$type<JsonObject[]>().notNull().default(sql`'[]'`),
    reasons: text('reasons', { mode: 'json' }).$type<string[]>().notNull().default(sql`'[]'`),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [
    index('idx_trust_calibration_evaluations_policy').on(t.policyId, t.createdAt),
    index('idx_trust_calibration_evaluations_agent').on(t.agentProfileId, t.createdAt),
    index('idx_trust_calibration_evaluations_recommendation').on(t.recommendation, t.createdAt),
  ],
)

export const budgetPolicies = sqliteTable(
  'budget_policies',
  {
    id: text('id').primaryKey(),
    agentProfileId: text('agent_profile_id').references(() => agentProfiles.id, {
      onDelete: 'set null',
    }),
    projectId: text('project_id'),
    name: text('name').notNull(),
    scope: text('scope').$type<BudgetScope>().notNull(),
    limitType: text('limit_type').$type<BudgetLimitType>().notNull(),
    limit: real('limit_value').notNull(),
    hardCap: integer('hard_cap', { mode: 'boolean' }).notNull().default(true),
    notifyAtPercent: real('notify_at_percent').notNull().default(80),
    config: text('config', { mode: 'json' }).$type<BudgetPolicyConfig>().notNull(),
    status: text('status').$type<BudgetPolicyStatus>().notNull().default('active'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [
    index('idx_budget_policies_scope').on(t.scope, t.status),
    index('idx_budget_policies_agent').on(t.agentProfileId, t.status),
    index('idx_budget_policies_project').on(t.projectId, t.status),
  ],
)

export const budgetEvaluations = sqliteTable(
  'budget_evaluations',
  {
    id: text('id').primaryKey(),
    policyId: text('policy_id').references(() => budgetPolicies.id, {
      onDelete: 'set null',
    }),
    agentProfileId: text('agent_profile_id').references(() => agentProfiles.id, {
      onDelete: 'set null',
    }),
    employeeRunId: text('employee_run_id'),
    projectId: text('project_id'),
    scope: text('scope').$type<BudgetScope>().notNull(),
    status: text('status').$type<BudgetEvaluationStatus>().notNull(),
    action: text('action').$type<BudgetControlAction>().notNull(),
    usageSnapshot: text('usage_snapshot', { mode: 'json' })
      .$type<BudgetUsageSnapshot>()
      .notNull(),
    costBreakdown: text('cost_breakdown', { mode: 'json' })
      .$type<BudgetCostBreakdown>()
      .notNull(),
    selectedModelProfileId: text('selected_model_profile_id'),
    routedModelProfileId: text('routed_model_profile_id'),
    reason: text('reason').notNull(),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [
    index('idx_budget_evaluations_policy').on(t.policyId, t.createdAt),
    index('idx_budget_evaluations_agent').on(t.agentProfileId, t.createdAt),
    index('idx_budget_evaluations_status').on(t.status, t.createdAt),
    index('idx_budget_evaluations_project').on(t.projectId, t.createdAt),
  ],
)

export const configVersions = sqliteTable(
  'config_versions',
  {
    id: text('id').primaryKey(),
    entityType: text('entity_type').$type<ConfigEntityType>().notNull(),
    entityId: text('entity_id').notNull(),
    version: integer('version').notNull(),
    displayName: text('display_name').notNull(),
    source: text('source').$type<ConfigVersionSource>().notNull().default('manual'),
    snapshot: text('snapshot', { mode: 'json' }).$type<JsonObject>().notNull().default(sql`'{}'`),
    contentHash: text('content_hash').notNull(),
    changeSummary: text('change_summary').notNull().default(''),
    createdBy: text('created_by'),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [
    index('idx_config_versions_entity').on(t.entityType, t.entityId, t.version),
    index('idx_config_versions_hash').on(t.contentHash),
  ],
)

export const configExports = sqliteTable(
  'config_exports',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    format: text('format').$type<ConfigExportFormat>().notNull().default('gitops_bundle'),
    entityRefs: text('entity_refs', { mode: 'json' }).$type<JsonObject[]>().notNull().default(sql`'[]'`),
    bundle: text('bundle', { mode: 'json' }).$type<JsonObject>().notNull().default(sql`'{}'`),
    contentHash: text('content_hash').notNull(),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [index('idx_config_exports_created').on(t.createdAt)],
)

export const configImpactAnalyses = sqliteTable(
  'config_impact_analyses',
  {
    id: text('id').primaryKey(),
    entityType: text('entity_type').$type<ConfigEntityType>().notNull(),
    entityId: text('entity_id').notNull(),
    baseVersionId: text('base_version_id').references(() => configVersions.id, {
      onDelete: 'set null',
    }),
    proposedHash: text('proposed_hash').notNull(),
    impactLevel: text('impact_level').$type<ConfigImpactLevel>().notNull(),
    summary: text('summary').notNull(),
    impactedRefs: text('impacted_refs', { mode: 'json' }).$type<JsonObject[]>().notNull().default(sql`'[]'`),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [
    index('idx_config_impact_entity').on(t.entityType, t.entityId, t.createdAt),
    index('idx_config_impact_base').on(t.baseVersionId),
  ],
)

export const optimisticLocks = sqliteTable(
  'optimistic_locks',
  {
    id: text('id').primaryKey(),
    entityType: text('entity_type').$type<ConfigEntityType>().notNull(),
    entityId: text('entity_id').notNull(),
    displayName: text('display_name').notNull(),
    entityVersion: integer('entity_version').notNull().default(1),
    snapshot: text('snapshot', { mode: 'json' }).$type<JsonObject>().notNull().default(sql`'{}'`),
    contentHash: text('content_hash').notNull(),
    updatedBy: text('updated_by'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [index('idx_optimistic_locks_entity').on(t.entityType, t.entityId)],
)

export const editConflicts = sqliteTable(
  'edit_conflicts',
  {
    id: text('id').primaryKey(),
    lockId: text('lock_id').references(() => optimisticLocks.id, { onDelete: 'set null' }),
    entityType: text('entity_type').$type<ConfigEntityType>().notNull(),
    entityId: text('entity_id').notNull(),
    yourVersion: integer('your_version').notNull(),
    serverVersion: integer('server_version').notNull(),
    conflictingFields: text('conflicting_fields', { mode: 'json' })
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'`),
    yourSnapshot: text('your_snapshot', { mode: 'json' }).$type<JsonObject>().notNull().default(sql`'{}'`),
    serverSnapshot: text('server_snapshot', { mode: 'json' }).$type<JsonObject>().notNull().default(sql`'{}'`),
    mergedSnapshot: text('merged_snapshot', { mode: 'json' }).$type<JsonObject | null>(),
    resolution: text('resolution').$type<EditConflictResolution>().notNull().default('show_diff'),
    status: text('status').$type<EditConflictStatus>().notNull().default('open'),
    resolvedBy: text('resolved_by'),
    createdAt: integer('created_at').notNull(),
    resolvedAt: integer('resolved_at'),
  },
  (t) => [
    index('idx_edit_conflicts_entity').on(t.entityType, t.entityId),
    index('idx_edit_conflicts_status').on(t.status, t.createdAt),
  ],
)

export const exportPackages = sqliteTable(
  'export_packages',
  {
    id: text('id').primaryKey(),
    packageType: text('package_type').$type<ExportPackageType>().notNull(),
    sourceEntityType: text('source_entity_type').$type<ExportPackageType>().notNull(),
    sourceEntityId: text('source_entity_id').notNull(),
    sourceConfigVersionId: text('source_config_version_id').references(() => configVersions.id, {
      onDelete: 'set null',
    }),
    formatVersion: text('format_version').notNull().default('1.0'),
    name: text('name').notNull(),
    author: text('author').notNull().default('local-user'),
    description: text('description').notNull().default(''),
    packageVersion: text('package_version').notNull().default('1.0.0'),
    tags: text('tags', { mode: 'json' }).$type<string[]>().notNull().default(sql`'[]'`),
    includes: text('includes', { mode: 'json' }).$type<JsonObject>().notNull().default(sql`'{}'`),
    dependencies: text('dependencies', { mode: 'json' }).$type<JsonObject>().notNull().default(sql`'{}'`),
    payload: text('payload', { mode: 'json' }).$type<JsonObject>().notNull().default(sql`'{}'`),
    fileName: text('file_name').notNull(),
    contentHash: text('content_hash').notNull(),
    signature: text('signature'),
    status: text('status').$type<ExportPackageStatus>().notNull().default('ready'),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [
    index('idx_export_packages_type').on(t.packageType, t.createdAt),
    index('idx_export_packages_source').on(t.sourceEntityType, t.sourceEntityId),
  ],
)

export const packageImportChecks = sqliteTable(
  'package_import_checks',
  {
    id: text('id').primaryKey(),
    exportPackageId: text('export_package_id').references(() => exportPackages.id, {
      onDelete: 'cascade',
    }),
    sourceFileName: text('source_file_name').notNull(),
    compatibilityStatus: text('compatibility_status')
      .$type<PackageCompatibilityStatus>()
      .notNull()
      .default('compatible'),
    missingSkills: text('missing_skills', { mode: 'json' }).$type<string[]>().notNull().default(sql`'[]'`),
    missingModels: text('missing_models', { mode: 'json' }).$type<JsonObject[]>().notNull().default(sql`'[]'`),
    missingSoftware: text('missing_software', { mode: 'json' }).$type<string[]>().notNull().default(sql`'[]'`),
    sanitizedSecrets: integer('sanitized_secrets', { mode: 'boolean' }).notNull().default(true),
    summary: text('summary').notNull(),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [
    index('idx_package_import_checks_package').on(t.exportPackageId),
    index('idx_package_import_checks_status').on(t.compatibilityStatus, t.createdAt),
  ],
)

export const agentHealthScores = sqliteTable(
  'agent_health_scores',
  {
    id: text('id').primaryKey(),
    agentProfileId: text('agent_profile_id').references(() => agentProfiles.id, {
      onDelete: 'set null',
    }),
    runCount: integer('run_count').notNull().default(0),
    successRate: real('success_rate').notNull().default(0),
    failureRate: real('failure_rate').notNull().default(0),
    approvalRate: real('approval_rate').notNull().default(0),
    selfRecoveryRate: real('self_recovery_rate').notNull().default(0),
    score: real('score').notNull().default(0),
    computedAt: integer('computed_at').notNull(),
  },
  (t) => [index('idx_agent_health_scores_agent').on(t.agentProfileId, t.computedAt)],
)

export const agentReputationReviews = sqliteTable(
  'agent_reputation_reviews',
  {
    id: text('id').primaryKey(),
    agentProfileId: text('agent_profile_id')
      .notNull()
      .references(() => agentProfiles.id, { onDelete: 'cascade' }),
    taskId: text('task_id').notNull(),
    employeeRunId: text('employee_run_id').references(() => employeeRuns.id, {
      onDelete: 'set null',
    }),
    userRating: integer('user_rating').notNull(),
    autoScore: real('auto_score').notNull().default(0),
    comment: text('comment'),
    reviewer: text('reviewer').notNull().default('user'),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [
    index('idx_agent_reputation_reviews_agent').on(t.agentProfileId, t.createdAt),
    index('idx_agent_reputation_reviews_run').on(t.employeeRunId),
  ],
)

export const agentReputationSnapshots = sqliteTable(
  'agent_reputation_snapshots',
  {
    id: text('id').primaryKey(),
    agentProfileId: text('agent_profile_id')
      .notNull()
      .references(() => agentProfiles.id, { onDelete: 'cascade' }),
    monthLabel: text('month_label').notNull(),
    overallScore: real('overall_score').notNull().default(0),
    reliabilityScore: real('reliability_score').notNull().default(0),
    efficiencyScore: real('efficiency_score').notNull().default(0),
    qualityScore: real('quality_score').notNull().default(0),
    safetyScore: real('safety_score').notNull().default(0),
    learningScore: real('learning_score').notNull().default(0),
    collaborationScore: real('collaboration_score').notNull().default(0),
    trend: text('trend').$type<AgentReputationTrend>().notNull().default('stable'),
    recentReviews: text('recent_reviews', { mode: 'json' }).$type<JsonObject[]>().notNull().default(sql`'[]'`),
    badges: text('badges', { mode: 'json' }).$type<AgentReputationBadge[]>().notNull().default(sql`'[]'`),
    runCount: integer('run_count').notNull().default(0),
    completedRunCount: integer('completed_run_count').notNull().default(0),
    failedRunCount: integer('failed_run_count').notNull().default(0),
    averageCostCents: real('average_cost_cents').notNull().default(0),
    averageDurationMs: real('average_duration_ms').notNull().default(0),
    computedAt: integer('computed_at').notNull(),
  },
  (t) => [
    index('idx_agent_reputation_snapshots_agent').on(t.agentProfileId, t.computedAt),
    index('idx_agent_reputation_snapshots_month_score').on(t.monthLabel, t.overallScore),
  ],
)

export const programmaticApiKeys = sqliteTable(
  'programmatic_api_keys',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    keyPrefix: text('key_prefix').notNull(),
    keyHash: text('key_hash').notNull(),
    scopes: text('scopes', { mode: 'json' }).$type<string[]>().notNull().default(sql`'[]'`),
    status: text('status').$type<ProgrammaticApiKeyStatus>().notNull().default('active'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
    lastUsedAt: integer('last_used_at'),
    revokedAt: integer('revoked_at'),
  },
  (t) => [
    index('idx_programmatic_api_keys_status').on(t.status, t.createdAt),
    index('idx_programmatic_api_keys_prefix').on(t.keyPrefix),
  ],
)

export const sdkTasks = sqliteTable(
  'sdk_tasks',
  {
    id: text('id').primaryKey(),
    apiKeyId: text('api_key_id').references(() => programmaticApiKeys.id, {
      onDelete: 'set null',
    }),
    employeeRunId: text('employee_run_id').references(() => employeeRuns.id, {
      onDelete: 'set null',
    }),
    agentProfileId: text('agent_profile_id').references(() => agentProfiles.id, {
      onDelete: 'set null',
    }),
    agentName: text('agent_name').notNull(),
    description: text('description').notNull(),
    input: text('input', { mode: 'json' }).$type<JsonObject>().notNull().default(sql`'{}'`),
    priority: integer('priority').notNull().default(0),
    maxBudgetCents: integer('max_budget_cents'),
    webhookUrl: text('webhook_url'),
    status: text('status').$type<SdkTaskStatus>().notNull().default('queued'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
    completedAt: integer('completed_at'),
  },
  (t) => [
    index('idx_sdk_tasks_run').on(t.employeeRunId),
    index('idx_sdk_tasks_agent_status').on(t.agentProfileId, t.status),
  ],
)

export const webhookSubscriptions = sqliteTable(
  'webhook_subscriptions',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    url: text('url').notNull(),
    events: text('events', { mode: 'json' }).$type<WebhookEventType[]>().notNull().default(sql`'[]'`),
    secret: text('secret').notNull(),
    filter: text('filter', { mode: 'json' }).$type<JsonObject>().notNull().default(sql`'{}'`),
    maxRetries: integer('max_retries').notNull().default(3),
    backoffMs: integer('backoff_ms').notNull().default(30000),
    deliveryMode: text('delivery_mode').$type<WebhookDeliveryMode>().notNull().default('record_only'),
    status: text('status').$type<WebhookSubscriptionStatus>().notNull().default('active'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [
    index('idx_webhook_subscriptions_status').on(t.status, t.createdAt),
  ],
)

export const webhookDeliveries = sqliteTable(
  'webhook_deliveries',
  {
    id: text('id').primaryKey(),
    webhookSubscriptionId: text('webhook_subscription_id').references(() => webhookSubscriptions.id, {
      onDelete: 'set null',
    }),
    sdkTaskId: text('sdk_task_id').references(() => sdkTasks.id, { onDelete: 'set null' }),
    employeeRunId: text('employee_run_id').references(() => employeeRuns.id, {
      onDelete: 'set null',
    }),
    url: text('url').notNull(),
    eventType: text('event_type').$type<WebhookEventType>().notNull(),
    payload: text('payload', { mode: 'json' }).$type<JsonObject>().notNull().default(sql`'{}'`),
    signature: text('signature').notNull(),
    status: text('status').$type<WebhookDeliveryStatus>().notNull().default('queued'),
    attempt: integer('attempt').notNull().default(0),
    nextRetryAt: integer('next_retry_at'),
    error: text('error'),
    createdAt: integer('created_at').notNull(),
    deliveredAt: integer('delivered_at'),
  },
  (t) => [
    index('idx_webhook_deliveries_subscription').on(t.webhookSubscriptionId, t.createdAt),
    index('idx_webhook_deliveries_task').on(t.sdkTaskId, t.createdAt),
    index('idx_webhook_deliveries_status').on(t.status, t.createdAt),
  ],
)

export const secretVault = sqliteTable(
  'secret_vault',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    kind: text('kind').$type<SecretKind>().notNull().default('env_ref'),
    valueRef: text('value_ref').notNull(),
    nonce: text('nonce'),
    redactedPreview: text('redacted_preview').notNull().default(''),
    status: text('status').$type<SecretStatus>().notNull().default('active'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
    lastUsedAt: integer('last_used_at'),
  },
  (t) => [index('idx_secret_vault_status').on(t.status)],
)

export const credentialScopes = sqliteTable(
  'credential_scopes',
  {
    id: text('id').primaryKey(),
    secretId: text('secret_id')
      .notNull()
      .references(() => secretVault.id, { onDelete: 'cascade' }),
    resourceType: text('resource_type').$type<CredentialResourceType>().notNull(),
    resourceId: text('resource_id').notNull(),
    capability: text('capability').notNull().default('use'),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [index('idx_credential_scopes_resource').on(t.resourceType, t.resourceId)],
)

export const sandboxPolicies = sqliteTable(
  'sandbox_policies',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    level: text('level').$type<SandboxLevel>().notNull().default('strict'),
    allowedPaths: text('allowed_paths', { mode: 'json' })
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'`),
    deniedPaths: text('denied_paths', { mode: 'json' })
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'`),
    allowedCommands: text('allowed_commands', { mode: 'json' })
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'`),
    networkMode: text('network_mode').$type<SandboxNetworkMode>().notNull().default('model_only'),
    requiresApprovalForWrites: integer('requires_approval_for_writes', { mode: 'boolean' })
      .notNull()
      .default(true),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [index('idx_sandbox_policies_level').on(t.level)],
)

export const auditLogs = sqliteTable(
  'audit_logs',
  {
    id: text('id').primaryKey(),
    actorType: text('actor_type').$type<AuditActorType>().notNull(),
    actorId: text('actor_id'),
    action: text('action').notNull(),
    resourceType: text('resource_type').notNull(),
    resourceId: text('resource_id'),
    status: text('status').$type<AuditActionStatus>().notNull().default('allowed'),
    riskLevel: text('risk_level').$type<RiskLevel>().notNull().default('low'),
    message: text('message').notNull().default(''),
    metadata: text('metadata', { mode: 'json' }).$type<JsonObject>().notNull().default(sql`'{}'`),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [
    index('idx_audit_logs_resource_created').on(t.resourceType, t.resourceId, t.createdAt),
    index('idx_audit_logs_actor_created').on(t.actorType, t.actorId, t.createdAt),
  ],
)

export const securityFindings = sqliteTable(
  'security_findings',
  {
    id: text('id').primaryKey(),
    sourceType: text('source_type').notNull(),
    sourceId: text('source_id'),
    category: text('category').notNull(),
    severity: text('severity').$type<SecurityFindingSeverity>().notNull().default('medium'),
    action: text('action').$type<SecurityFindingAction>().notNull().default('log'),
    message: text('message').notNull(),
    evidence: text('evidence').notNull().default(''),
    createdAt: integer('created_at').notNull(),
    resolvedAt: integer('resolved_at'),
  },
  (t) => [
    index('idx_security_findings_source').on(t.sourceType, t.sourceId),
    index('idx_security_findings_severity').on(t.severity),
  ],
)

export const metricPoints = sqliteTable(
  'metric_points',
  {
    id: text('id').primaryKey(),
    metricName: text('metric_name').notNull(),
    resourceType: text('resource_type'),
    resourceId: text('resource_id'),
    value: real('value').notNull(),
    unit: text('unit').notNull().default('count'),
    tags: text('tags', { mode: 'json' }).$type<JsonObject>().notNull().default(sql`'{}'`),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [
    index('idx_metric_points_name_created').on(t.metricName, t.createdAt),
    index('idx_metric_points_resource').on(t.resourceType, t.resourceId, t.createdAt),
  ],
)

export const externalMonitoringConfigs = sqliteTable(
  'external_monitoring_configs',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    metricsEndpoint: text('metrics_endpoint').notNull().default('/metrics'),
    healthEndpoint: text('health_endpoint').notNull().default('/health'),
    readyEndpoint: text('ready_endpoint').notNull().default('/ready'),
    logExport: text('log_export', { mode: 'json' })
      .$type<ExternalMonitoringLogExport>()
      .notNull()
      .default(sql`'{}'`),
    status: text('status').$type<ExternalMonitoringStatus>().notNull().default('active'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [
    index('idx_external_monitoring_configs_status').on(t.status, t.updatedAt),
    index('idx_external_monitoring_configs_name').on(t.name),
  ],
)

export const alertRules = sqliteTable(
  'alert_rules',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    metricName: text('metric_name').notNull(),
    comparison: text('comparison').$type<AlertComparison>().notNull().default('gte'),
    threshold: real('threshold').notNull(),
    severity: text('severity').$type<NotificationLevel>().notNull().default('warning'),
    enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
    cooldownMs: integer('cooldown_ms').notNull().default(300000),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [index('idx_alert_rules_metric_enabled').on(t.metricName, t.enabled)],
)

export const alertEvents = sqliteTable(
  'alert_events',
  {
    id: text('id').primaryKey(),
    alertRuleId: text('alert_rule_id').references(() => alertRules.id, { onDelete: 'set null' }),
    metricPointId: text('metric_point_id').references(() => metricPoints.id, {
      onDelete: 'set null',
    }),
    resourceType: text('resource_type'),
    resourceId: text('resource_id'),
    status: text('status').$type<AlertEventStatus>().notNull().default('open'),
    severity: text('severity').$type<NotificationLevel>().notNull().default('warning'),
    message: text('message').notNull(),
    createdAt: integer('created_at').notNull(),
    resolvedAt: integer('resolved_at'),
  },
  (t) => [
    index('idx_alert_events_status').on(t.status, t.createdAt),
    index('idx_alert_events_resource').on(t.resourceType, t.resourceId, t.createdAt),
  ],
)

export const debugReplaySnapshots = sqliteTable(
  'debug_replay_snapshots',
  {
    id: text('id').primaryKey(),
    resourceType: text('resource_type').notNull(),
    resourceId: text('resource_id').notNull(),
    summary: text('summary').notNull(),
    eventCount: integer('event_count').notNull().default(0),
    checkpointId: text('checkpoint_id'),
    payload: text('payload', { mode: 'json' }).$type<JsonObject>().notNull().default(sql`'{}'`),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [index('idx_debug_replay_resource').on(t.resourceType, t.resourceId, t.createdAt)],
)

export const notifications = sqliteTable(
  'notifications',
  {
    id: text('id').primaryKey(),
    channel: text('channel').$type<NotificationChannel>().notNull().default('in_app'),
    level: text('level').$type<NotificationLevel>().notNull().default('info'),
    sourceType: text('source_type').notNull(),
    sourceId: text('source_id'),
    title: text('title').notNull(),
    message: text('message').notNull().default(''),
    payload: text('payload', { mode: 'json' }).$type<JsonObject>().notNull().default(sql`'{}'`),
    status: text('status').$type<NotificationStatus>().notNull().default('unread'),
    createdAt: integer('created_at').notNull(),
    readAt: integer('read_at'),
  },
  (t) => [
    index('idx_notifications_status_created').on(t.status, t.createdAt),
    index('idx_notifications_source').on(t.sourceType, t.sourceId),
  ],
)

export const notificationPreferences = sqliteTable(
  'notification_preferences',
  {
    id: text('id').primaryKey(),
    channel: text('channel').$type<NotificationChannel>().notNull(),
    enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
    minLevel: text('min_level').$type<NotificationLevel>().notNull().default('info'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [index('idx_notification_preferences_channel').on(t.channel)],
)

export const retentionPolicies = sqliteTable(
  'retention_policies',
  {
    id: text('id').primaryKey(),
    entity: text('entity').$type<RetentionEntity>().notNull(),
    retentionPeriod: text('retention_period').notNull(),
    onExpiry: text('on_expiry').$type<RetentionExpiryAction>().notNull().default('ask_user'),
    maxStorageBytes: integer('max_storage_bytes'),
    enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [index('idx_retention_policies_entity').on(t.entity)],
)

export const storageQuotaSnapshots = sqliteTable(
  'storage_quota_snapshots',
  {
    id: text('id').primaryKey(),
    scope: text('scope').$type<StorageQuotaScope>().notNull(),
    scopeId: text('scope_id'),
    maxTotalBytes: integer('max_total_bytes').notNull(),
    currentBytes: integer('current_bytes').notNull(),
    breakdown: text('breakdown', { mode: 'json' }).$type<JsonObject>().notNull().default(sql`'{}'`),
    warnAtPercent: real('warn_at_percent').notNull().default(80),
    blockAtPercent: real('block_at_percent').notNull().default(95),
    status: text('status').$type<StorageQuotaStatus>().notNull().default('ok'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [index('idx_storage_quota_scope').on(t.scope, t.scopeId)],
)

export const dataMaintenancePolicies = sqliteTable(
  'data_maintenance_policies',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    policy: text('policy', { mode: 'json' }).$type<DataMaintenancePolicy>().notNull().default(sql`'{}'`),
    status: text('status').$type<DataMaintenancePolicyStatus>().notNull().default('active'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [
    index('idx_data_maintenance_policies_status').on(t.status, t.updatedAt),
    index('idx_data_maintenance_policies_name').on(t.name),
  ],
)

export const dataMaintenanceRuns = sqliteTable(
  'data_maintenance_runs',
  {
    id: text('id').primaryKey(),
    policyId: text('policy_id')
      .notNull()
      .references(() => dataMaintenancePolicies.id, { onDelete: 'cascade' }),
    status: text('status').$type<DataMaintenanceRunStatus>().notNull().default('completed'),
    logRotationResult: text('log_rotation_result', { mode: 'json' })
      .$type<JsonObject>()
      .notNull()
      .default(sql`'{}'`),
    sqliteMaintenanceResult: text('sqlite_maintenance_result', { mode: 'json' })
      .$type<JsonObject>()
      .notNull()
      .default(sql`'{}'`),
    workspaceGcResult: text('workspace_gc_result', { mode: 'json' })
      .$type<JsonObject>()
      .notNull()
      .default(sql`'{}'`),
    browserProfileResult: text('browser_profile_result', { mode: 'json' })
      .$type<JsonObject>()
      .notNull()
      .default(sql`'{}'`),
    createdAt: integer('created_at').notNull(),
    completedAt: integer('completed_at'),
  },
  (t) => [
    index('idx_data_maintenance_runs_policy').on(t.policyId, t.createdAt),
    index('idx_data_maintenance_runs_status').on(t.status, t.createdAt),
  ],
)

export const memoryIntegrityPolicies = sqliteTable(
  'memory_integrity_policies',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    policy: text('policy', { mode: 'json' })
      .$type<MemoryIntegrityPolicy>()
      .notNull()
      .default(sql`'{}'`),
    status: text('status').$type<MemoryIntegrityPolicyStatus>().notNull().default('active'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [
    index('idx_memory_integrity_policies_status').on(t.status, t.updatedAt),
    index('idx_memory_integrity_policies_name').on(t.name),
  ],
)

export const memoryIntegrityEvaluations = sqliteTable(
  'memory_integrity_evaluations',
  {
    id: text('id').primaryKey(),
    policyId: text('policy_id').references(() => memoryIntegrityPolicies.id, {
      onDelete: 'set null',
    }),
    memoryItemId: text('memory_item_id').references(() => memoryItems.id, {
      onDelete: 'set null',
    }),
    agentProfileId: text('agent_profile_id').references(() => agentProfiles.id, {
      onDelete: 'set null',
    }),
    sourceType: text('source_type').$type<MemoryIntegritySourceType>().notNull(),
    decision: text('decision').$type<MemoryIntegrityDecision>().notNull(),
    confidenceApplied: real('confidence_applied').notNull().default(0),
    matchedPatterns: text('matched_patterns', { mode: 'json' }).$type<string[]>().notNull().default(sql`'[]'`),
    contradictions: text('contradictions', { mode: 'json' }).$type<JsonObject[]>().notNull().default(sql`'[]'`),
    input: text('input', { mode: 'json' }).$type<JsonObject>().notNull().default(sql`'{}'`),
    result: text('result', { mode: 'json' }).$type<JsonObject>().notNull().default(sql`'{}'`),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [
    index('idx_memory_integrity_evaluations_policy').on(t.policyId, t.createdAt),
    index('idx_memory_integrity_evaluations_memory').on(t.memoryItemId, t.createdAt),
    index('idx_memory_integrity_evaluations_decision').on(t.decision, t.createdAt),
  ],
)

export const nfrRequirements = sqliteTable(
  'nfr_requirements',
  {
    id: text('id').primaryKey(),
    requirementKey: text('requirement_key').notNull(),
    category: text('category').$type<NfrCategory>().notNull(),
    title: text('title').notNull(),
    target: text('target').notNull(),
    metricName: text('metric_name').notNull(),
    operator: text('operator').$type<NfrMetricOperator>().notNull(),
    targetValue: text('target_value', { mode: 'json' }).$type<unknown>().notNull(),
    severity: text('severity').$type<'low' | 'medium' | 'high' | 'critical'>().notNull().default('medium'),
    evidenceRefs: text('evidence_refs', { mode: 'json' }).$type<string[]>().notNull().default(sql`'[]'`),
    status: text('status').$type<NfrRequirementStatus>().notNull().default('active'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [
    index('idx_nfr_requirements_key').on(t.requirementKey),
    index('idx_nfr_requirements_category').on(t.category, t.status),
  ],
)

export const nfrEvaluations = sqliteTable(
  'nfr_evaluations',
  {
    id: text('id').primaryKey(),
    requirementId: text('requirement_id')
      .notNull()
      .references(() => nfrRequirements.id, { onDelete: 'cascade' }),
    status: text('status').$type<NfrEvaluationStatus>().notNull(),
    observedValue: text('observed_value', { mode: 'json' }).$type<unknown>(),
    details: text('details', { mode: 'json' }).$type<JsonObject>().notNull().default(sql`'{}'`),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [
    index('idx_nfr_evaluations_requirement').on(t.requirementId, t.createdAt),
    index('idx_nfr_evaluations_status').on(t.status, t.createdAt),
  ],
)

export const knownLimitations = sqliteTable(
  'known_limitations',
  {
    id: text('id').primaryKey(),
    limitationKey: text('limitation_key').notNull(),
    category: text('category').$type<KnownLimitationCategory>().notNull(),
    severity: text('severity').$type<KnownLimitationSeverity>().notNull().default('warning'),
    title: text('title').notNull(),
    description: text('description').notNull(),
    userImpact: text('user_impact').notNull(),
    workaround: text('workaround').notNull(),
    roadmap: text('roadmap').notNull(),
    capabilityTags: text('capability_tags', { mode: 'json' }).$type<string[]>().notNull().default(sql`'[]'`),
    disclosureSurfaces: text('disclosure_surfaces', { mode: 'json' })
      .$type<LimitationDisclosureSurface[]>()
      .notNull()
      .default(sql`'[]'`),
    requiresAcknowledgement: integer('requires_acknowledgement', { mode: 'boolean' })
      .notNull()
      .default(false),
    evidenceRefs: text('evidence_refs', { mode: 'json' }).$type<string[]>().notNull().default(sql`'[]'`),
    status: text('status').$type<KnownLimitationStatus>().notNull().default('active'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [
    index('idx_known_limitations_key').on(t.limitationKey),
    index('idx_known_limitations_category').on(t.category, t.status),
    index('idx_known_limitations_severity').on(t.severity, t.status),
  ],
)

export const limitationAcknowledgements = sqliteTable(
  'limitation_acknowledgements',
  {
    id: text('id').primaryKey(),
    limitationId: text('limitation_id')
      .notNull()
      .references(() => knownLimitations.id, { onDelete: 'cascade' }),
    acknowledgedBy: text('acknowledged_by').notNull(),
    surface: text('surface').$type<LimitationDisclosureSurface>().notNull(),
    note: text('note').notNull().default(''),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [
    index('idx_limitation_acknowledgements_limitation').on(t.limitationId, t.createdAt),
    index('idx_limitation_acknowledgements_user').on(t.acknowledgedBy, t.createdAt),
  ],
)

export const piiMarkers = sqliteTable(
  'pii_markers',
  {
    id: text('id').primaryKey(),
    memoryItemId: text('memory_item_id').references(() => memoryItems.id, { onDelete: 'cascade' }),
    piiType: text('pii_type').$type<PiiType>().notNull(),
    detectedBy: text('detected_by').$type<PiiDetectedBy>().notNull().default('regex'),
    location: text('location').notNull(),
    excerpt: text('excerpt').notNull().default(''),
    status: text('status').$type<PiiMarkerStatus>().notNull().default('flagged'),
    createdAt: integer('created_at').notNull(),
    reviewedAt: integer('reviewed_at'),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [
    index('idx_pii_markers_memory').on(t.memoryItemId),
    index('idx_pii_markers_status').on(t.status),
  ],
)

export const dataExportManifests = sqliteTable(
  'data_export_manifests',
  {
    id: text('id').primaryKey(),
    scope: text('scope').$type<DataExportScope>().notNull(),
    scopeId: text('scope_id'),
    format: text('format').$type<DataExportFormat>().notNull().default('zip_manifest'),
    includeSecrets: integer('include_secrets', { mode: 'boolean' }).notNull().default(false),
    status: text('status').$type<DataExportStatus>().notNull().default('ready'),
    manifest: text('manifest', { mode: 'json' }).$type<JsonObject>().notNull().default(sql`'{}'`),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [index('idx_data_export_manifests_scope').on(t.scope, t.scopeId)],
)

export const featureFlags = sqliteTable(
  'feature_flags',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    description: text('description').notNull().default(''),
    status: text('status').$type<FeatureFlagStatus>().notNull().default('development'),
    rolloutPercent: real('rollout_percent').notNull().default(0),
    targetUsers: text('target_users').$type<FeatureFlagTargetUsers>().notNull().default('internal'),
    targetUserIds: text('target_user_ids', { mode: 'json' }).$type<string[]>().notNull().default(sql`'[]'`),
    requiresFlags: text('requires_flags', { mode: 'json' }).$type<string[]>().notNull().default(sql`'[]'`),
    conflictsWith: text('conflicts_with', { mode: 'json' }).$type<string[]>().notNull().default(sql`'[]'`),
    remoteOverride: integer('remote_override', { mode: 'boolean' }).notNull().default(true),
    remoteDisabled: integer('remote_disabled', { mode: 'boolean' }).notNull().default(false),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [
    index('idx_feature_flags_status').on(t.status),
    index('idx_feature_flags_name').on(t.name),
  ],
)

export const featureFlagEvaluations = sqliteTable(
  'feature_flag_evaluations',
  {
    id: text('id').primaryKey(),
    featureFlagId: text('feature_flag_id')
      .notNull()
      .references(() => featureFlags.id, { onDelete: 'cascade' }),
    userId: text('user_id'),
    groups: text('groups', { mode: 'json' }).$type<string[]>().notNull().default(sql`'[]'`),
    status: text('status').$type<FeatureFlagEvaluationStatus>().notNull(),
    reason: text('reason').notNull(),
    bucket: real('bucket'),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [index('idx_feature_flag_evaluations_flag').on(t.featureFlagId, t.createdAt)],
)

export const degradationPolicies = sqliteTable(
  'degradation_policies',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    resourceType: text('resource_type').$type<DegradationResourceType>().notNull(),
    resourceId: text('resource_id'),
    trigger: text('trigger').$type<DegradationTrigger>().notNull().default('offline'),
    action: text('action').$type<DegradationAction>().notNull(),
    fallbackResourceIds: text('fallback_resource_ids', { mode: 'json' })
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'`),
    enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [
    index('idx_degradation_policies_resource').on(t.resourceType, t.resourceId),
    index('idx_degradation_policies_trigger').on(t.trigger),
  ],
)

export const degradationEvents = sqliteTable(
  'degradation_events',
  {
    id: text('id').primaryKey(),
    policyId: text('policy_id').references(() => degradationPolicies.id, { onDelete: 'set null' }),
    resourceType: text('resource_type').$type<DegradationResourceType>().notNull(),
    resourceId: text('resource_id'),
    trigger: text('trigger').$type<DegradationTrigger>().notNull(),
    action: text('action').$type<DegradationAction>().notNull(),
    status: text('status').$type<DegradationEventStatus>().notNull(),
    reason: text('reason').notNull(),
    fallbackResourceId: text('fallback_resource_id'),
    metadata: text('metadata', { mode: 'json' }).$type<JsonObject>().notNull().default(sql`'{}'`),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [
    index('idx_degradation_events_resource').on(t.resourceType, t.resourceId),
    index('idx_degradation_events_created').on(t.createdAt),
  ],
)

export const updatePolicies = sqliteTable(
  'update_policies',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull().default('Default update policy'),
    checkInterval: text('check_interval').$type<UpdateCheckInterval>().notNull().default('daily'),
    channel: text('channel').$type<UpdateChannel>().notNull().default('stable'),
    autoDownload: integer('auto_download', { mode: 'boolean' }).notNull().default(true),
    installOn: text('install_on').$type<UpdateInstallMode>().notNull().default('ask_user'),
    ifAgentsRunning: text('if_agents_running')
      .$type<UpdateAgentsRunningStrategy>()
      .notNull()
      .default('notify_user'),
    maxWaitMs: integer('max_wait_ms').notNull().default(2 * 60 * 60 * 1000),
    rollbackCrashOnStartup: integer('rollback_crash_on_startup', { mode: 'boolean' })
      .notNull()
      .default(true),
    rollbackAgentSuccessRateDrop: real('rollback_agent_success_rate_drop').notNull().default(20),
    lastCheckedAt: integer('last_checked_at'),
    lastCheckResult: text('last_check_result', { mode: 'json' })
      .$type<JsonObject>()
      .notNull()
      .default(sql`'{}'`),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [
    index('idx_update_policies_channel').on(t.channel, t.checkInterval),
    index('idx_update_policies_updated').on(t.updatedAt),
  ],
)

export const maintenanceWindows = sqliteTable(
  'maintenance_windows',
  {
    id: text('id').primaryKey(),
    updatePolicyId: text('update_policy_id').references(() => updatePolicies.id, {
      onDelete: 'set null',
    }),
    reason: text('reason').notNull().default('Scheduled maintenance'),
    status: text('status').$type<MaintenanceWindowStatus>().notNull().default('active'),
    blockedNewTasks: integer('blocked_new_tasks', { mode: 'boolean' }).notNull().default(true),
    runningAgentCount: integer('running_agent_count').notNull().default(0),
    queuedAgentCount: integer('queued_agent_count').notNull().default(0),
    dbMaintenanceResult: text('db_maintenance_result', { mode: 'json' })
      .$type<JsonObject>()
      .notNull()
      .default(sql`'{}'`),
    tempCleanupResult: text('temp_cleanup_result', { mode: 'json' })
      .$type<JsonObject>()
      .notNull()
      .default(sql`'{}'`),
    integrityCheckResult: text('integrity_check_result', { mode: 'json' })
      .$type<JsonObject>()
      .notNull()
      .default(sql`'{}'`),
    serviceRestartResult: text('service_restart_result', { mode: 'json' })
      .$type<JsonObject>()
      .notNull()
      .default(sql`'{}'`),
    notificationId: text('notification_id').references(() => notifications.id, {
      onDelete: 'set null',
    }),
    createdAt: integer('created_at').notNull(),
    startedAt: integer('started_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
    completedAt: integer('completed_at'),
  },
  (t) => [
    index('idx_maintenance_windows_status').on(t.status, t.createdAt),
    index('idx_maintenance_windows_policy').on(t.updatePolicyId),
  ],
)

export const customMetricProfiles = sqliteTable(
  'custom_metric_profiles',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    scope: text('scope').$type<CustomMetricScope>().notNull().default('workspace'),
    scopeId: text('scope_id'),
    optimizationTarget: text('optimization_target')
      .$type<OptimizationTarget>()
      .notNull()
      .default('balanced'),
    weights: text('weights', { mode: 'json' }).$type<JsonObject>().notNull().default(sql`'{}'`),
    constraints: text('constraints', { mode: 'json' })
      .$type<JsonObject>()
      .notNull()
      .default(sql`'{}'`),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [
    index('idx_custom_metric_profiles_scope').on(t.scope, t.scopeId),
    index('idx_custom_metric_profiles_target').on(t.optimizationTarget),
  ],
)

export const customMetricEvaluations = sqliteTable(
  'custom_metric_evaluations',
  {
    id: text('id').primaryKey(),
    customMetricProfileId: text('custom_metric_profile_id')
      .notNull()
      .references(() => customMetricProfiles.id, { onDelete: 'cascade' }),
    resourceType: text('resource_type').notNull().default('task_estimate'),
    resourceId: text('resource_id'),
    estimatedCostCents: real('estimated_cost_cents').notNull().default(0),
    estimatedDurationMs: real('estimated_duration_ms').notNull().default(0),
    qualityScore: real('quality_score').notNull().default(0),
    actionTypes: text('action_types', { mode: 'json' }).$type<string[]>().notNull().default(sql`'[]'`),
    score: real('score').notNull(),
    status: text('status').$type<CustomMetricEvaluationStatus>().notNull(),
    violations: text('violations', { mode: 'json' }).$type<string[]>().notNull().default(sql`'[]'`),
    recommendation: text('recommendation').notNull(),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [
    index('idx_custom_metric_evaluations_profile').on(t.customMetricProfileId, t.createdAt),
    index('idx_custom_metric_evaluations_status').on(t.status, t.createdAt),
  ],
)

export const agentWorkstations = sqliteTable(
  'agent_workstations',
  {
    id: text('id').primaryKey(),
    agentProfileId: text('agent_profile_id')
      .notNull()
      .references(() => agentProfiles.id, { onDelete: 'cascade' }),
    mode: text('mode').$type<WorkstationMode>().notNull().default('browser_context'),
    workspacePath: text('workspace_path').notNull(),
    browserProfilePath: text('browser_profile_path').notNull(),
    tempPath: text('temp_path').notNull(),
    displayId: text('display_id'),
    vncUrl: text('vnc_url'),
    rdpConfig: text('rdp_config'),
    status: text('status').$type<WorkstationStatus>().notNull().default('idle'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [index('idx_agent_workstations_agent').on(t.agentProfileId)],
)

export const computerSessions = sqliteTable(
  'computer_sessions',
  {
    id: text('id').primaryKey(),
    agentProfileId: text('agent_profile_id').references(() => agentProfiles.id, {
      onDelete: 'set null',
    }),
    employeeRunId: text('employee_run_id'),
    workflowRunId: text('workflow_run_id'),
    workstationId: text('workstation_id').references(() => agentWorkstations.id, {
      onDelete: 'set null',
    }),
    mode: text('mode').$type<WorkstationMode>().notNull().default('browser_context'),
    workspacePath: text('workspace_path').notNull(),
    browserProfilePath: text('browser_profile_path').notNull(),
    tempPath: text('temp_path').notNull(),
    status: text('status').$type<ComputerSessionStatus>().notNull().default('active'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
    finishedAt: integer('finished_at'),
  },
  (t) => [
    index('idx_computer_sessions_employee_run').on(t.employeeRunId),
    index('idx_computer_sessions_workflow_run').on(t.workflowRunId),
  ],
)

export const computerActionEvents = sqliteTable(
  'computer_action_events',
  {
    id: text('id').primaryKey(),
    computerSessionId: text('computer_session_id')
      .notNull()
      .references(() => computerSessions.id, { onDelete: 'cascade' }),
    employeeRunId: text('employee_run_id'),
    workflowRunId: text('workflow_run_id'),
    actionType: text('action_type').notNull(),
    target: text('target'),
    input: text('input', { mode: 'json' }).$type<JsonObject>().notNull().default(sql`'{}'`),
    output: text('output', { mode: 'json' }).$type<JsonObject>().notNull().default(sql`'{}'`),
    status: text('status').$type<ComputerActionStatus>().notNull().default('planned'),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [
    index('idx_computer_action_events_session').on(t.computerSessionId, t.createdAt),
    index('idx_computer_action_events_employee_run').on(t.employeeRunId),
  ],
)

export const browserSessions = sqliteTable(
  'browser_sessions',
  {
    id: text('id').primaryKey(),
    sessionName: text('session_name').notNull(),
    ownerAgentProfileId: text('owner_agent_profile_id').references(() => agentProfiles.id, {
      onDelete: 'set null',
    }),
    sharedWithAgentProfileIds: text('shared_with_agent_profile_ids', { mode: 'json' })
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'`),
    cookieJarRef: text('cookie_jar_ref').notNull(),
    localStorageRef: text('local_storage_ref'),
    indexedDbRef: text('indexed_db_ref'),
    encrypted: integer('encrypted', { mode: 'boolean' }).notNull().default(true),
    persistAfterTask: integer('persist_after_task', { mode: 'boolean' }).notNull().default(true),
    maxAge: text('max_age').$type<BrowserSessionMaxAge>().notNull().default('7d'),
    keepAliveEnabled: integer('keep_alive_enabled', { mode: 'boolean' }).notNull().default(false),
    keepAliveInterval: text('keep_alive_interval').$type<BrowserSessionKeepAliveInterval>(),
    keepAliveVisitUrls: text('keep_alive_visit_urls', { mode: 'json' })
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'`),
    encryptSensitiveCookies: integer('encrypt_sensitive_cookies', { mode: 'boolean' })
      .notNull()
      .default(true),
    isolateByAgent: integer('isolate_by_agent', { mode: 'boolean' }).notNull().default(true),
    exportable: integer('exportable', { mode: 'boolean' }).notNull().default(false),
    blockedDomains: text('blocked_domains', { mode: 'json' }).$type<string[]>().notNull().default(sql`'[]'`),
    expiresAt: integer('expires_at'),
    lastKeepAliveAt: integer('last_keep_alive_at'),
    nextKeepAliveAt: integer('next_keep_alive_at'),
    status: text('status').$type<BrowserSessionStatus>().notNull().default('active'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [
    index('idx_browser_sessions_owner_status').on(t.ownerAgentProfileId, t.status),
    index('idx_browser_sessions_name').on(t.sessionName),
    index('idx_browser_sessions_expires').on(t.expiresAt),
  ],
)

export const browserSessionEvents = sqliteTable(
  'browser_session_events',
  {
    id: text('id').primaryKey(),
    browserSessionId: text('browser_session_id')
      .notNull()
      .references(() => browserSessions.id, { onDelete: 'cascade' }),
    agentProfileId: text('agent_profile_id').references(() => agentProfiles.id, { onDelete: 'set null' }),
    eventType: text('event_type').$type<BrowserSessionEventType>().notNull(),
    domain: text('domain'),
    status: text('status').$type<BrowserSessionEventStatus>().notNull().default('recorded'),
    message: text('message').notNull().default(''),
    payload: text('payload', { mode: 'json' }).$type<JsonObject>().notNull().default(sql`'{}'`),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [
    index('idx_browser_session_events_session').on(t.browserSessionId, t.createdAt),
    index('idx_browser_session_events_type').on(t.eventType, t.createdAt),
  ],
)

export const memoryItems = sqliteTable(
  'memory_items',
  {
    id: text('id').primaryKey(),
    agentProfileId: text('agent_profile_id').references(() => agentProfiles.id, {
      onDelete: 'set null',
    }),
    scope: text('scope').$type<MemoryScope>().notNull(),
    type: text('type').$type<MemoryType>().notNull(),
    title: text('title').notNull(),
    content: text('content').notNull(),
    sourceRunId: text('source_run_id'),
    embedding: text('embedding', { mode: 'json' }).$type<number[]>(),
    confidence: real('confidence').notNull().default(1),
    importance: real('importance').notNull().default(0.5),
    readAccess: text('read_access').$type<MemoryPrivacyReadAccess>().notNull().default('organization'),
    writeAccess: text('write_access').$type<MemoryPrivacyWriteAccess>().notNull().default('only_me'),
    encryption: text('encryption').$type<MemoryPrivacyEncryption>().notNull().default('at_rest'),
    containsDataTypes: text('contains_data_types', { mode: 'json' })
      .$type<MemoryPrivacyDataType[]>()
      .notNull()
      .default(sql`'[]'`),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
    expiresAt: integer('expires_at'),
  },
  (t) => [index('idx_memory_agent_scope').on(t.agentProfileId, t.scope)],
)

export const memoryGraphViews = sqliteTable(
  'memory_graph_views',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    agentProfileId: text('agent_profile_id').references(() => agentProfiles.id, {
      onDelete: 'set null',
    }),
    focusAgentProfileId: text('focus_agent_profile_id').references(() => agentProfiles.id, {
      onDelete: 'set null',
    }),
    projectId: text('project_id'),
    layout: text('layout').$type<MemoryGraphLayout>().notNull().default('force'),
    includeExpired: integer('include_expired', { mode: 'boolean' }).notNull().default(false),
    filters: text('filters', { mode: 'json' }).$type<JsonObject>().notNull().default(sql`'{}'`),
    nodes: text('nodes', { mode: 'json' }).$type<MemoryGraphNode[]>().notNull().default(sql`'[]'`),
    edges: text('edges', { mode: 'json' }).$type<MemoryGraphEdge[]>().notNull().default(sql`'[]'`),
    nodeCount: integer('node_count').notNull().default(0),
    edgeCount: integer('edge_count').notNull().default(0),
    status: text('status').$type<MemoryGraphViewStatus>().notNull().default('generated'),
    exportManifest: text('export_manifest', { mode: 'json' }).$type<JsonObject>().notNull().default(sql`'{}'`),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [
    index('idx_memory_graph_views_agent').on(t.agentProfileId, t.createdAt),
    index('idx_memory_graph_views_focus').on(t.focusAgentProfileId, t.createdAt),
    index('idx_memory_graph_views_status').on(t.status, t.updatedAt),
  ],
)

export const memoryDecaySnapshots = sqliteTable(
  'memory_decay_snapshots',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    agentProfileId: text('agent_profile_id').references(() => agentProfiles.id, {
      onDelete: 'set null',
    }),
    includeExpired: integer('include_expired', { mode: 'boolean' }).notNull().default(false),
    filters: text('filters', { mode: 'json' }).$type<JsonObject>().notNull().default(sql`'{}'`),
    horizonDays: integer('horizon_days').notNull().default(180),
    staleAfterDays: integer('stale_after_days').notNull().default(45),
    expiringSoonDays: integer('expiring_soon_days').notNull().default(30),
    pinnedImportanceThreshold: real('pinned_importance_threshold').notNull().default(0.95),
    points: text('points', { mode: 'json' }).$type<MemoryDecayPoint[]>().notNull().default(sql`'[]'`),
    summary: text('summary', { mode: 'json' }).$type<JsonObject>().notNull().default(sql`'{}'`),
    actionResult: text('action_result', { mode: 'json' }).$type<JsonObject>().notNull().default(sql`'{}'`),
    pointCount: integer('point_count').notNull().default(0),
    status: text('status').$type<MemoryDecaySnapshotStatus>().notNull().default('generated'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [
    index('idx_memory_decay_snapshots_agent').on(t.agentProfileId, t.createdAt),
    index('idx_memory_decay_snapshots_status').on(t.status, t.updatedAt),
  ],
)

export const runReflections = sqliteTable(
  'run_reflections',
  {
    id: text('id').primaryKey(),
    runId: text('run_id').notNull(),
    agentProfileId: text('agent_profile_id').references(() => agentProfiles.id, {
      onDelete: 'set null',
    }),
    whatWorked: text('what_worked', { mode: 'json' }).$type<string[]>().notNull().default(sql`'[]'`),
    whatFailed: text('what_failed', { mode: 'json' }).$type<string[]>().notNull().default(sql`'[]'`),
    newKnowledge: text('new_knowledge', { mode: 'json' }).$type<string[]>().notNull().default(sql`'[]'`),
    reusableProcedure: text('reusable_procedure', { mode: 'json' }).$type<string[]>().notNull().default(sql`'[]'`),
    suggestedSkillUpdates: text('suggested_skill_updates', { mode: 'json' })
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'`),
    futureWarnings: text('future_warnings', { mode: 'json' }).$type<string[]>().notNull().default(sql`'[]'`),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [index('idx_run_reflections_run').on(t.runId)],
)

export const agentDiaryEntries = sqliteTable(
  'agent_diary_entries',
  {
    id: text('id').primaryKey(),
    agentProfileId: text('agent_profile_id').references(() => agentProfiles.id, {
      onDelete: 'set null',
    }),
    employeeRunId: text('employee_run_id'),
    workflowRunId: text('workflow_run_id'),
    entryType: text('entry_type').$type<AgentDiaryEntryType>().notNull().default('run_summary'),
    title: text('title').notNull(),
    content: text('content').notNull(),
    nextActions: text('next_actions', { mode: 'json' }).$type<string[]>().notNull().default(sql`'[]'`),
    blockers: text('blockers', { mode: 'json' }).$type<string[]>().notNull().default(sql`'[]'`),
    tags: text('tags', { mode: 'json' }).$type<string[]>().notNull().default(sql`'[]'`),
    importance: real('importance').notNull().default(0.5),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [
    index('idx_agent_diary_agent_created').on(t.agentProfileId, t.createdAt),
    index('idx_agent_diary_run').on(t.employeeRunId),
  ],
)

export const continuationPlans = sqliteTable(
  'continuation_plans',
  {
    id: text('id').primaryKey(),
    agentProfileId: text('agent_profile_id').references(() => agentProfiles.id, {
      onDelete: 'set null',
    }),
    sourceRunId: text('source_run_id'),
    workflowRunId: text('workflow_run_id'),
    status: text('status').$type<ContinuationPlanStatus>().notNull().default('open'),
    title: text('title').notNull(),
    summary: text('summary').notNull(),
    nextSteps: text('next_steps', { mode: 'json' }).$type<string[]>().notNull().default(sql`'[]'`),
    resumeInput: text('resume_input', { mode: 'json' }).$type<JsonObject>().notNull().default(sql`'{}'`),
    requiredCapabilityRefs: text('required_capability_refs', { mode: 'json' })
      .$type<JsonObject[]>()
      .notNull()
      .default(sql`'[]'`),
    dueAt: integer('due_at'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
    completedAt: integer('completed_at'),
  },
  (t) => [
    index('idx_continuation_plans_agent_status').on(t.agentProfileId, t.status),
    index('idx_continuation_plans_source_run').on(t.sourceRunId),
  ],
)

export const agentRetirementPlans = sqliteTable(
  'agent_retirement_plans',
  {
    id: text('id').primaryKey(),
    agentProfileId: text('agent_profile_id').references(() => agentProfiles.id, {
      onDelete: 'set null',
    }),
    targetAgentProfileId: text('target_agent_profile_id').references(() => agentProfiles.id, {
      onDelete: 'set null',
    }),
    status: text('status').$type<AgentRetirementStatus>().notNull().default('draft'),
    taskHandling: text('task_handling', { mode: 'json' }).$type<JsonObject>().notNull().default(sql`'{}'`),
    knowledgeExtraction: text('knowledge_extraction', { mode: 'json' })
      .$type<JsonObject>()
      .notNull()
      .default(sql`'{}'`),
    cleanupPolicy: text('cleanup_policy', { mode: 'json' }).$type<JsonObject>().notNull().default(sql`'{}'`),
    analysis: text('analysis', { mode: 'json' }).$type<JsonObject>().notNull().default(sql`'{}'`),
    retirementReport: text('retirement_report', { mode: 'json' })
      .$type<JsonObject>()
      .notNull()
      .default(sql`'{}'`),
    farewellMessage: text('farewell_message').notNull().default(''),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
    completedAt: integer('completed_at'),
  },
  (t) => [
    index('idx_agent_retirement_agent_status').on(t.agentProfileId, t.status),
    index('idx_agent_retirement_target').on(t.targetAgentProfileId),
  ],
)

export const knowledgeTransferPackages = sqliteTable(
  'knowledge_transfer_packages',
  {
    id: text('id').primaryKey(),
    retirementPlanId: text('retirement_plan_id').references(() => agentRetirementPlans.id, {
      onDelete: 'set null',
    }),
    fromAgentProfileId: text('from_agent_profile_id').references(() => agentProfiles.id, {
      onDelete: 'set null',
    }),
    toAgentProfileId: text('to_agent_profile_id').references(() => agentProfiles.id, {
      onDelete: 'set null',
    }),
    status: text('status').$type<KnowledgeTransferStatus>().notNull().default('pending_review'),
    receiverHandling: text('receiver_handling')
      .$type<KnowledgeTransferReceiverHandling>()
      .notNull()
      .default('review_each'),
    transferItems: text('transfer_items', { mode: 'json' }).$type<JsonObject>().notNull().default(sql`'{}'`),
    memoryItemIds: text('memory_item_ids', { mode: 'json' }).$type<string[]>().notNull().default(sql`'[]'`),
    playbookIds: text('playbook_ids', { mode: 'json' }).$type<string[]>().notNull().default(sql`'[]'`),
    createdMemoryItemIds: text('created_memory_item_ids', { mode: 'json' })
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'`),
    createdPlaybookIds: text('created_playbook_ids', { mode: 'json' })
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'`),
    summary: text('summary', { mode: 'json' }).$type<JsonObject>().notNull().default(sql`'{}'`),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
    completedAt: integer('completed_at'),
  },
  (t) => [
    index('idx_knowledge_transfer_from_status').on(t.fromAgentProfileId, t.status),
    index('idx_knowledge_transfer_to_status').on(t.toAgentProfileId, t.status),
    index('idx_knowledge_transfer_retirement').on(t.retirementPlanId),
  ],
)

export const organizationalKnowledgeItems = sqliteTable(
  'organizational_knowledge_items',
  {
    id: text('id').primaryKey(),
    source: text('source').$type<OrganizationalKnowledgeSource>().notNull().default('all_agents'),
    sourceRef: text('source_ref'),
    insightType: text('insight_type').$type<OrganizationalInsightType>().notNull(),
    title: text('title').notNull(),
    summary: text('summary').notNull(),
    pattern: text('pattern').notNull().default(''),
    frequency: integer('frequency').notNull().default(1),
    effectiveness: real('effectiveness').notNull().default(0),
    affectedAgentIds: text('affected_agent_ids', { mode: 'json' }).$type<string[]>().notNull().default(sql`'[]'`),
    contributedByAgentIds: text('contributed_by_agent_ids', { mode: 'json' })
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'`),
    evidence: text('evidence', { mode: 'json' }).$type<string[]>().notNull().default(sql`'[]'`),
    knownFix: text('known_fix').notNull().default(''),
    applicableTo: text('applicable_to', { mode: 'json' }).$type<string[]>().notNull().default(sql`'[]'`),
    softwareName: text('software_name'),
    status: text('status').$type<OrganizationalInsightStatus>().notNull().default('candidate'),
    promotedMemoryItemId: text('promoted_memory_item_id').references(() => memoryItems.id, {
      onDelete: 'set null',
    }),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [
    index('idx_org_knowledge_type_status').on(t.insightType, t.status),
    index('idx_org_knowledge_source').on(t.source, t.sourceRef),
  ],
)

export const organizationalLearningReports = sqliteTable(
  'organizational_learning_reports',
  {
    id: text('id').primaryKey(),
    source: text('source').$type<OrganizationalKnowledgeSource>().notNull().default('all_agents'),
    sourceRef: text('source_ref'),
    periodStartAt: integer('period_start_at'),
    periodEndAt: integer('period_end_at'),
    newDiscoveries: integer('new_discoveries').notNull().default(0),
    deprecatedKnowledge: integer('deprecated_knowledge').notNull().default(0),
    topInsight: text('top_insight').notNull().default(''),
    recommendedActions: text('recommended_actions', { mode: 'json' }).$type<string[]>().notNull().default(sql`'[]'`),
    insightIds: text('insight_ids', { mode: 'json' }).$type<string[]>().notNull().default(sql`'[]'`),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [index('idx_org_learning_reports_source_period').on(t.source, t.sourceRef, t.createdAt)],
)

export const metaAgentProfiles = sqliteTable(
  'meta_agent_profiles',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    status: text('status').$type<MetaAgentStatus>().notNull().default('active'),
    responsibilities: text('responsibilities', { mode: 'json' })
      .$type<MetaAgentResponsibility[]>()
      .notNull()
      .default(sql`'[]'`),
    specialCapabilities: text('special_capabilities', { mode: 'json' })
      .$type<JsonObject>()
      .notNull()
      .default(sql`'{}'`),
    restrictions: text('restrictions', { mode: 'json' }).$type<JsonObject>().notNull().default(sql`'{}'`),
    scheduleLocalTime: text('schedule_local_time').notNull().default('08:00'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [index('idx_meta_agent_profiles_status').on(t.status, t.createdAt)],
)

export const metaAgentDigests = sqliteTable(
  'meta_agent_digests',
  {
    id: text('id').primaryKey(),
    metaAgentProfileId: text('meta_agent_profile_id').references(() => metaAgentProfiles.id, {
      onDelete: 'set null',
    }),
    dateLabel: text('date_label').notNull(),
    summary: text('summary').notNull(),
    readyAgentCount: integer('ready_agent_count').notNull().default(0),
    warningAgentCount: integer('warning_agent_count').notNull().default(0),
    criticalAgentCount: integer('critical_agent_count').notNull().default(0),
    pendingApprovalCount: integer('pending_approval_count').notNull().default(0),
    openConflictCount: integer('open_conflict_count').notNull().default(0),
    queuedTaskCount: integer('queued_task_count').notNull().default(0),
    failedRunCount: integer('failed_run_count').notNull().default(0),
    monthlyCostCents: integer('monthly_cost_cents').notNull().default(0),
    budgetRemainingPercent: real('budget_remaining_percent'),
    anomalies: text('anomalies', { mode: 'json' }).$type<string[]>().notNull().default(sql`'[]'`),
    recommendations: text('recommendations', { mode: 'json' })
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'`),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [
    index('idx_meta_agent_digests_profile').on(t.metaAgentProfileId, t.createdAt),
    index('idx_meta_agent_digests_date').on(t.dateLabel),
  ],
)

export const metaAgentRecommendations = sqliteTable(
  'meta_agent_recommendations',
  {
    id: text('id').primaryKey(),
    metaAgentProfileId: text('meta_agent_profile_id').references(() => metaAgentProfiles.id, {
      onDelete: 'set null',
    }),
    digestId: text('digest_id').references(() => metaAgentDigests.id, { onDelete: 'cascade' }),
    recommendationType: text('recommendation_type').$type<MetaAgentRecommendationType>().notNull(),
    severity: text('severity').$type<MetaAgentRecommendationSeverity>().notNull().default('info'),
    targetType: text('target_type').notNull(),
    targetId: text('target_id'),
    title: text('title').notNull(),
    rationale: text('rationale').notNull().default(''),
    proposedAction: text('proposed_action', { mode: 'json' }).$type<JsonObject>().notNull().default(sql`'{}'`),
    requiresApproval: integer('requires_approval', { mode: 'boolean' }).notNull().default(true),
    status: text('status').$type<MetaAgentRecommendationStatus>().notNull().default('open'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [
    index('idx_meta_recommendations_digest').on(t.digestId),
    index('idx_meta_recommendations_status').on(t.status, t.severity),
  ],
)

export const learningEvents = sqliteTable(
  'learning_events',
  {
    id: text('id').primaryKey(),
    runId: text('run_id').notNull(),
    agentProfileId: text('agent_profile_id').references(() => agentProfiles.id, {
      onDelete: 'set null',
    }),
    reflectionId: text('reflection_id').references(() => runReflections.id, {
      onDelete: 'set null',
    }),
    type: text('type').notNull(),
    title: text('title').notNull(),
    summary: text('summary').notNull(),
    proposedPlaybook: text('proposed_playbook', { mode: 'json' }).$type<JsonObject>().notNull().default(sql`'{}'`),
    status: text('status').$type<LearningEventStatus>().notNull().default('pending_review'),
    reviewerNote: text('reviewer_note'),
    createdAt: integer('created_at').notNull(),
    reviewedAt: integer('reviewed_at'),
  },
  (t) => [
    index('idx_learning_events_run').on(t.runId),
    index('idx_learning_events_status').on(t.status),
  ],
)

export const playbooks = sqliteTable(
  'playbooks',
  {
    id: text('id').primaryKey(),
    agentProfileId: text('agent_profile_id').references(() => agentProfiles.id, {
      onDelete: 'set null',
    }),
    title: text('title').notNull(),
    description: text('description').notNull().default(''),
    status: text('status').$type<PlaybookStatus>().notNull().default('draft'),
    sourceLearningEventId: text('source_learning_event_id').references(() => learningEvents.id, {
      onDelete: 'set null',
    }),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [index('idx_playbooks_agent_status').on(t.agentProfileId, t.status)],
)

export const playbookVersions = sqliteTable(
  'playbook_versions',
  {
    id: text('id').primaryKey(),
    playbookId: text('playbook_id')
      .notNull()
      .references(() => playbooks.id, { onDelete: 'cascade' }),
    version: integer('version').notNull(),
    content: text('content').notNull(),
    steps: text('steps', { mode: 'json' }).$type<string[]>().notNull().default(sql`'[]'`),
    sourceRunId: text('source_run_id'),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [index('idx_playbook_versions_playbook').on(t.playbookId, t.version)],
)

export const workflows = sqliteTable('workflows', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  description: text('description').notNull().default(''),
  status: text('status').$type<WorkflowStatus>().notNull().default('draft'),
  version: integer('version').notNull().default(1),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
})

export const workflowNodes = sqliteTable(
  'workflow_nodes',
  {
    id: text('id').primaryKey(),
    workflowId: text('workflow_id')
      .notNull()
      .references(() => workflows.id, { onDelete: 'cascade' }),
    type: text('type').notNull(),
    agentProfileId: text('agent_profile_id').references(() => agentProfiles.id, {
      onDelete: 'set null',
    }),
    position: text('position', { mode: 'json' }).$type<CanvasPosition>().notNull(),
    config: text('config', { mode: 'json' }).$type<JsonObject>().notNull().default(sql`'{}'`),
    inputMapping: text('input_mapping', { mode: 'json' }).$type<JsonObject>().notNull().default(sql`'{}'`),
    outputContract: text('output_contract', { mode: 'json' }).$type<JsonObject>().notNull().default(sql`'{}'`),
    retryPolicy: text('retry_policy', { mode: 'json' }).$type<JsonObject>().notNull().default(sql`'{}'`),
    approvalPolicy: text('approval_policy', { mode: 'json' }).$type<JsonObject>().notNull().default(sql`'{}'`),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [index('idx_workflow_nodes_workflow').on(t.workflowId)],
)

export const workflowEdges = sqliteTable(
  'workflow_edges',
  {
    id: text('id').primaryKey(),
    workflowId: text('workflow_id')
      .notNull()
      .references(() => workflows.id, { onDelete: 'cascade' }),
    sourceNodeId: text('source_node_id').notNull(),
    targetNodeId: text('target_node_id').notNull(),
    sourceHandle: text('source_handle'),
    targetHandle: text('target_handle'),
    mapping: text('mapping', { mode: 'json' }).$type<JsonObject>().notNull().default(sql`'{}'`),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [index('idx_workflow_edges_workflow').on(t.workflowId)],
)

export const workflowRuns = sqliteTable(
  'workflow_runs',
  {
    id: text('id').primaryKey(),
    workflowId: text('workflow_id')
      .notNull()
      .references(() => workflows.id, { onDelete: 'cascade' }),
    status: text('status').$type<RunStatus>().notNull().default('queued'),
    input: text('input', { mode: 'json' }).$type<JsonObject>().notNull().default(sql`'{}'`),
    output: text('output', { mode: 'json' }).$type<JsonObject>(),
    error: text('error'),
    startedAt: integer('started_at').notNull(),
    finishedAt: integer('finished_at'),
  },
  (t) => [index('idx_workflow_runs_workflow').on(t.workflowId)],
)

export const workflowNodeRuns = sqliteTable(
  'workflow_node_runs',
  {
    id: text('id').primaryKey(),
    workflowRunId: text('workflow_run_id')
      .notNull()
      .references(() => workflowRuns.id, { onDelete: 'cascade' }),
    nodeId: text('node_id').notNull(),
    status: text('status').$type<RunStatus>().notNull().default('queued'),
    progressStatus: text('progress_status').notNull().default('queued'),
    currentStep: text('current_step'),
    output: text('output', { mode: 'json' }).$type<JsonObject>(),
    error: text('error'),
    startedAt: integer('started_at').notNull(),
    finishedAt: integer('finished_at'),
  },
  (t) => [index('idx_workflow_node_runs_run').on(t.workflowRunId)],
)

export const workflowPreflights = sqliteTable(
  'workflow_preflights',
  {
    id: text('id').primaryKey(),
    workflowId: text('workflow_id')
      .notNull()
      .references(() => workflows.id, { onDelete: 'cascade' }),
    status: text('status').$type<WorkflowPreflightStatus>().notNull().default('ok'),
    input: text('input', { mode: 'json' }).$type<JsonObject>().notNull().default(sql`'{}'`),
    budgetLimitCents: integer('budget_limit_cents'),
    nodeCount: integer('node_count').notNull().default(0),
    edgeCount: integer('edge_count').notNull().default(0),
    agentCount: integer('agent_count').notNull().default(0),
    softwareCommandCount: integer('software_command_count').notNull().default(0),
    approvalCount: integer('approval_count').notNull().default(0),
    estimatedCostCents: integer('estimated_cost_cents').notNull().default(0),
    estimatedDurationMs: integer('estimated_duration_ms').notNull().default(0),
    resourceRequirements: text('resource_requirements', { mode: 'json' })
      .$type<JsonObject[]>()
      .notNull()
      .default(sql`'[]'`),
    issues: text('issues', { mode: 'json' }).$type<JsonObject[]>().notNull().default(sql`'[]'`),
    riskSummary: text('risk_summary', { mode: 'json' }).$type<JsonObject>().notNull().default(sql`'{}'`),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [
    index('idx_workflow_preflights_workflow').on(t.workflowId, t.createdAt),
    index('idx_workflow_preflights_status').on(t.status),
  ],
)

export const simulationRuns = sqliteTable(
  'simulation_runs',
  {
    id: text('id').primaryKey(),
    targetType: text('target_type').$type<SimulationTargetType>().notNull(),
    agentProfileId: text('agent_profile_id').references(() => agentProfiles.id, {
      onDelete: 'set null',
    }),
    workflowId: text('workflow_id').references(() => workflows.id, {
      onDelete: 'set null',
    }),
    mode: text('mode').$type<SimulationRunMode>().notNull().default('dry_run'),
    status: text('status').$type<SimulationRunStatus>().notNull().default('awaiting_review'),
    taskTitle: text('task_title').notNull(),
    input: text('input', { mode: 'json' }).$type<JsonObject>().notNull().default(sql`'{}'`),
    simulatedEnvironment: text('simulated_environment', { mode: 'json' })
      .$type<JsonObject>()
      .notNull()
      .default(sql`'{}'`),
    simulatedToolResults: text('simulated_tool_results', { mode: 'json' })
      .$type<JsonObject[]>()
      .notNull()
      .default(sql`'[]'`),
    plannedSteps: text('planned_steps', { mode: 'json' }).$type<JsonObject[]>().notNull().default(sql`'[]'`),
    reviewAdjustments: text('review_adjustments', { mode: 'json' })
      .$type<JsonObject[]>()
      .notNull()
      .default(sql`'[]'`),
    estimatedCostCents: integer('estimated_cost_cents').notNull().default(0),
    estimatedDurationMs: integer('estimated_duration_ms').notNull().default(0),
    approvalSummary: text('approval_summary', { mode: 'json' }).$type<JsonObject>().notNull().default(sql`'{}'`),
    createdAt: integer('created_at').notNull(),
    reviewedAt: integer('reviewed_at'),
  },
  (t) => [
    index('idx_simulation_runs_agent').on(t.agentProfileId, t.createdAt),
    index('idx_simulation_runs_workflow').on(t.workflowId, t.createdAt),
    index('idx_simulation_runs_status').on(t.status, t.createdAt),
  ],
)

export const goldenTaskSets = sqliteTable(
  'golden_task_sets',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    targetType: text('target_type').$type<SimulationTargetType>().notNull().default('agent'),
    agentProfileId: text('agent_profile_id').references(() => agentProfiles.id, {
      onDelete: 'set null',
    }),
    workflowId: text('workflow_id').references(() => workflows.id, {
      onDelete: 'set null',
    }),
    tasks: text('tasks', { mode: 'json' }).$type<JsonObject[]>().notNull().default(sql`'[]'`),
    successCriteria: text('success_criteria', { mode: 'json' })
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'`),
    ciPolicy: text('ci_policy', { mode: 'json' }).$type<JsonObject>().notNull().default(sql`'{}'`),
    status: text('status').$type<GoldenTaskSetStatus>().notNull().default('active'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [
    index('idx_golden_task_sets_agent').on(t.agentProfileId, t.status),
    index('idx_golden_task_sets_workflow').on(t.workflowId, t.status),
    index('idx_golden_task_sets_status').on(t.status, t.updatedAt),
  ],
)

export const backtestRuns = sqliteTable(
  'backtest_runs',
  {
    id: text('id').primaryKey(),
    mode: text('mode').$type<BacktestRunMode>().notNull().default('historical'),
    targetType: text('target_type').$type<SimulationTargetType>().notNull(),
    agentProfileId: text('agent_profile_id').references(() => agentProfiles.id, {
      onDelete: 'set null',
    }),
    workflowId: text('workflow_id').references(() => workflows.id, {
      onDelete: 'set null',
    }),
    goldenTaskSetId: text('golden_task_set_id').references(() => goldenTaskSets.id, {
      onDelete: 'set null',
    }),
    baselineVersion: text('baseline_version').notNull().default('current'),
    candidateVersion: text('candidate_version').notNull().default('candidate'),
    candidateChanges: text('candidate_changes', { mode: 'json' })
      .$type<JsonObject>()
      .notNull()
      .default(sql`'{}'`),
    tasks: text('tasks', { mode: 'json' }).$type<JsonObject[]>().notNull().default(sql`'[]'`),
    results: text('results', { mode: 'json' }).$type<JsonObject[]>().notNull().default(sql`'[]'`),
    summary: text('summary', { mode: 'json' }).$type<JsonObject>().notNull().default(sql`'{}'`),
    gateStatus: text('gate_status').$type<BacktestGateStatus>().notNull().default('warning'),
    successRateBefore: real('success_rate_before').notNull().default(0),
    successRateAfter: real('success_rate_after').notNull().default(0),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [
    index('idx_backtest_runs_agent').on(t.agentProfileId, t.createdAt),
    index('idx_backtest_runs_workflow').on(t.workflowId, t.createdAt),
    index('idx_backtest_runs_gate').on(t.gateStatus, t.createdAt),
    index('idx_backtest_runs_golden').on(t.goldenTaskSetId, t.createdAt),
  ],
)

export const workflowOptimizations = sqliteTable(
  'workflow_optimizations',
  {
    id: text('id').primaryKey(),
    workflowId: text('workflow_id')
      .notNull()
      .references(() => workflows.id, { onDelete: 'cascade' }),
    runCount: integer('run_count').notNull().default(0),
    analysis: text('analysis', { mode: 'json' })
      .$type<WorkflowOptimizationAnalysis>()
      .notNull()
      .default(sql`'{}'`),
    autoApply: text('auto_apply', { mode: 'json' })
      .$type<WorkflowOptimizationAutoApply>()
      .notNull()
      .default(sql`'{}'`),
    appliedChanges: text('applied_changes', { mode: 'json' })
      .$type<WorkflowOptimizationAppliedChange[]>()
      .notNull()
      .default(sql`'[]'`),
    summary: text('summary').notNull(),
    status: text('status').$type<WorkflowOptimizationStatus>().notNull().default('analyzed'),
    createdAt: integer('created_at').notNull(),
    appliedAt: integer('applied_at'),
  },
  (t) => [
    index('idx_workflow_optimizations_workflow').on(t.workflowId, t.createdAt),
    index('idx_workflow_optimizations_status').on(t.status, t.createdAt),
  ],
)

export const naturalLanguageWorkflowDrafts = sqliteTable(
  'natural_language_workflow_drafts',
  {
    id: text('id').primaryKey(),
    prompt: text('prompt').notNull(),
    name: text('name').notNull(),
    intentType: text('intent_type').$type<NaturalLanguageWorkflowIntentType>().notNull(),
    parsedIntent: text('parsed_intent', { mode: 'json' }).$type<JsonObject>().notNull().default(sql`'{}'`),
    workflowPreview: text('workflow_preview', { mode: 'json' }).$type<JsonObject>().notNull().default(sql`'{}'`),
    agentMatches: text('agent_matches', { mode: 'json' }).$type<JsonObject>().notNull().default(sql`'{}'`),
    confidence: real('confidence').notNull().default(0),
    status: text('status').$type<NaturalLanguageWorkflowDraftStatus>().notNull().default('preview'),
    createdWorkflowId: text('created_workflow_id').references(() => workflows.id, {
      onDelete: 'set null',
    }),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [
    index('idx_nl_workflow_drafts_status').on(t.status, t.createdAt),
    index('idx_nl_workflow_drafts_workflow').on(t.createdWorkflowId),
  ],
)

export const taskTemplates = sqliteTable(
  'task_templates',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    description: text('description').notNull().default(''),
    category: text('category').notNull(),
    parameters: text('parameters', { mode: 'json' }).$type<JsonObject>().notNull().default(sql`'{}'`),
    agentRole: text('agent_role').notNull(),
    workflowId: text('workflow_id').references(() => workflows.id, { onDelete: 'set null' }),
    descriptionTemplate: text('description_template').notNull(),
    inputTemplate: text('input_template', { mode: 'json' }).$type<JsonObject>().notNull().default(sql`'{}'`),
    estimatedDuration: text('estimated_duration').notNull().default(''),
    estimatedCost: real('estimated_cost').notNull().default(0),
    tags: text('tags', { mode: 'json' }).$type<string[]>().notNull().default(sql`'[]'`),
    timesUsed: integer('times_used').notNull().default(0),
    avgSuccessRate: real('avg_success_rate').notNull().default(0),
    avgDuration: text('avg_duration').notNull().default(''),
    avgCost: real('avg_cost').notNull().default(0),
    lastUsed: integer('last_used'),
    relatedMemories: text('related_memories', { mode: 'json' }).$type<string[]>().notNull().default(sql`'[]'`),
    requiredSkills: text('required_skills', { mode: 'json' }).$type<string[]>().notNull().default(sql`'[]'`),
    sampleOutputs: text('sample_outputs', { mode: 'json' }).$type<string[]>().notNull().default(sql`'[]'`),
    status: text('status').$type<TaskTemplateStatus>().notNull().default('active'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [
    index('idx_task_templates_category_status').on(t.category, t.status),
    index('idx_task_templates_name').on(t.name),
  ],
)

export const taskTemplateRuns = sqliteTable(
  'task_template_runs',
  {
    id: text('id').primaryKey(),
    taskTemplateId: text('task_template_id')
      .notNull()
      .references(() => taskTemplates.id, { onDelete: 'cascade' }),
    agentProfileId: text('agent_profile_id').references(() => agentProfiles.id, { onDelete: 'set null' }),
    workflowId: text('workflow_id').references(() => workflows.id, { onDelete: 'set null' }),
    parameters: text('parameters', { mode: 'json' }).$type<JsonObject>().notNull().default(sql`'{}'`),
    renderedDescription: text('rendered_description').notNull(),
    renderedInput: text('rendered_input', { mode: 'json' }).$type<JsonObject>().notNull().default(sql`'{}'`),
    estimatedDuration: text('estimated_duration').notNull().default(''),
    estimatedCost: real('estimated_cost').notNull().default(0),
    status: text('status').$type<TaskTemplateRunStatus>().notNull().default('planned'),
    success: integer('success', { mode: 'boolean' }),
    actualDuration: text('actual_duration'),
    actualCost: real('actual_cost'),
    createdAt: integer('created_at').notNull(),
    completedAt: integer('completed_at'),
  },
  (t) => [
    index('idx_task_template_runs_template').on(t.taskTemplateId, t.createdAt),
    index('idx_task_template_runs_status').on(t.status, t.createdAt),
  ],
)

export const taskQueues = sqliteTable(
  'task_queues',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    status: text('status').$type<TaskQueueStatus>().notNull().default('active'),
    concurrencyLimit: integer('concurrency_limit').notNull().default(1),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [index('idx_task_queues_status').on(t.status)],
)

export const taskQueueItems = sqliteTable(
  'task_queue_items',
  {
    id: text('id').primaryKey(),
    queueId: text('queue_id')
      .notNull()
      .references(() => taskQueues.id, { onDelete: 'cascade' }),
    kind: text('kind').$type<TaskQueueItemKind>().notNull(),
    status: text('status').$type<TaskQueueItemStatus>().notNull().default('queued'),
    priority: integer('priority').notNull().default(0),
    payload: text('payload', { mode: 'json' }).$type<JsonObject>().notNull().default(sql`'{}'`),
    result: text('result', { mode: 'json' }).$type<JsonObject>(),
    error: text('error'),
    scheduledAt: integer('scheduled_at').notNull(),
    lockedAt: integer('locked_at'),
    startedAt: integer('started_at'),
    finishedAt: integer('finished_at'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [
    index('idx_task_queue_items_queue_status').on(t.queueId, t.status, t.scheduledAt),
    index('idx_task_queue_items_priority').on(t.queueId, t.priority, t.scheduledAt),
  ],
)

export const taskBatches = sqliteTable(
  'task_batches',
  {
    id: text('id').primaryKey(),
    queueId: text('queue_id')
      .notNull()
      .references(() => taskQueues.id, { onDelete: 'cascade' }),
    sourceItemIds: text('source_item_ids', { mode: 'json' }).$type<string[]>().notNull().default(sql`'[]'`),
    batchItemId: text('batch_item_id').references(() => taskQueueItems.id, { onDelete: 'set null' }),
    strategy: text('strategy', { mode: 'json' }).$type<TaskBatchStrategy>().notNull().default(sql`'{}'`),
    benefits: text('benefits', { mode: 'json' }).$type<TaskBatchBenefits>().notNull().default(sql`'{}'`),
    mergedPayload: text('merged_payload', { mode: 'json' }).$type<JsonObject>().notNull().default(sql`'{}'`),
    exclusionReasons: text('exclusion_reasons', { mode: 'json' })
      .$type<TaskBatchExclusionReason[]>()
      .notNull()
      .default(sql`'[]'`),
    status: text('status').$type<TaskBatchStatus>().notNull().default('planned'),
    createdAt: integer('created_at').notNull(),
    appliedAt: integer('applied_at'),
  },
  (t) => [
    index('idx_task_batches_queue_status').on(t.queueId, t.status, t.createdAt),
    index('idx_task_batches_batch_item').on(t.batchItemId),
  ],
)

export const workflowPartialRerunPlans = sqliteTable(
  'workflow_partial_rerun_plans',
  {
    id: text('id').primaryKey(),
    workflowRunId: text('workflow_run_id')
      .notNull()
      .references(() => workflowRuns.id, { onDelete: 'cascade' }),
    fromNodeId: text('from_node_id').notNull(),
    rerunNodeIds: text('rerun_node_ids', { mode: 'json' }).$type<string[]>().notNull().default(sql`'[]'`),
    cachedNodeRunIds: text('cached_node_run_ids', { mode: 'json' }).$type<string[]>().notNull().default(sql`'[]'`),
    invalidatedNodeRunIds: text('invalidated_node_run_ids', { mode: 'json' }).$type<string[]>().notNull().default(sql`'[]'`),
    inputPatch: text('input_patch', { mode: 'json' }).$type<JsonObject>().notNull().default(sql`'{}'`),
    costScope: text('cost_scope', { mode: 'json' }).$type<JsonObject>().notNull().default(sql`'{}'`),
    status: text('status').$type<WorkflowPartialRerunStatus>().notNull().default('planned'),
    createdAt: integer('created_at').notNull(),
    appliedAt: integer('applied_at'),
  },
  (t) => [
    index('idx_workflow_partial_rerun_run_status').on(t.workflowRunId, t.status, t.createdAt),
    index('idx_workflow_partial_rerun_from_node').on(t.fromNodeId),
  ],
)

export const taskMergeSuggestions = sqliteTable(
  'task_merge_suggestions',
  {
    id: text('id').primaryKey(),
    agentProfileId: text('agent_profile_id').references(() => agentProfiles.id, { onDelete: 'set null' }),
    sourceTaskIds: text('source_task_ids', { mode: 'json' }).$type<string[]>().notNull().default(sql`'[]'`),
    taskType: text('task_type').notNull().default('general'),
    mergedTitle: text('merged_title').notNull(),
    mergedPayload: text('merged_payload', { mode: 'json' }).$type<JsonObject>().notNull().default(sql`'{}'`),
    benefits: text('benefits', { mode: 'json' }).$type<JsonObject>().notNull().default(sql`'{}'`),
    requiresUserApproval: integer('requires_user_approval', { mode: 'boolean' }).notNull().default(true),
    userDecision: text('user_decision'),
    status: text('status').$type<TaskMergeSuggestionStatus>().notNull().default('suggested'),
    createdAt: integer('created_at').notNull(),
    decidedAt: integer('decided_at'),
  },
  (t) => [
    index('idx_task_merge_suggestions_agent').on(t.agentProfileId, t.status, t.createdAt),
    index('idx_task_merge_suggestions_status').on(t.status, t.createdAt),
  ],
)

export const workflowTemplateInstantiations = sqliteTable(
  'workflow_template_instantiations',
  {
    id: text('id').primaryKey(),
    sourceWorkflowId: text('source_workflow_id')
      .notNull()
      .references(() => workflows.id, { onDelete: 'cascade' }),
    instantiatedWorkflowId: text('instantiated_workflow_id').references(() => workflows.id, { onDelete: 'set null' }),
    name: text('name').notNull(),
    parameterSchema: text('parameter_schema', { mode: 'json' })
      .$type<WorkflowTemplateParameterSchema>()
      .notNull()
      .default(sql`'{}'`),
    parameters: text('parameters', { mode: 'json' }).$type<JsonObject>().notNull().default(sql`'{}'`),
    renderedWorkflow: text('rendered_workflow', { mode: 'json' }).$type<JsonObject>().notNull().default(sql`'{}'`),
    status: text('status').$type<WorkflowTemplateInstantiationStatus>().notNull().default('draft'),
    createdAt: integer('created_at').notNull(),
    instantiatedAt: integer('instantiated_at'),
  },
  (t) => [
    index('idx_workflow_template_instantiations_source').on(t.sourceWorkflowId, t.createdAt),
    index('idx_workflow_template_instantiations_status').on(t.status, t.createdAt),
  ],
)

export const taskSchedules = sqliteTable(
  'task_schedules',
  {
    id: text('id').primaryKey(),
    queueId: text('queue_id')
      .notNull()
      .references(() => taskQueues.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    kind: text('kind').$type<TaskScheduleKind>().notNull().default('task_queue_tick'),
    status: text('status').$type<TaskScheduleStatus>().notNull().default('active'),
    intervalMs: integer('interval_ms').notNull(),
    nextRunAt: integer('next_run_at').notNull(),
    lastRunAt: integer('last_run_at'),
    payload: text('payload', { mode: 'json' }).$type<JsonObject>().notNull().default(sql`'{}'`),
    lastResult: text('last_result', { mode: 'json' }).$type<JsonObject>(),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [
    index('idx_task_schedules_status_next').on(t.status, t.nextRunAt),
    index('idx_task_schedules_queue').on(t.queueId, t.status),
  ],
)

export const acceptanceScenarioRuns = sqliteTable(
  'acceptance_scenario_runs',
  {
    id: text('id').primaryKey(),
    scenarioKey: text('scenario_key').$type<AcceptanceScenarioKey>().notNull(),
    name: text('name').notNull(),
    expected: text('expected').notNull(),
    steps: text('steps', { mode: 'json' }).$type<string[]>().notNull().default(sql`'[]'`),
    status: text('status').$type<AcceptanceScenarioStatus>().notNull().default('manual_required'),
    stepResults: text('step_results', { mode: 'json' })
      .$type<AcceptanceScenarioStepResult[]>()
      .notNull()
      .default(sql`'[]'`),
    evidence: text('evidence', { mode: 'json' }).$type<string[]>().notNull().default(sql`'[]'`),
    gaps: text('gaps', { mode: 'json' }).$type<string[]>().notNull().default(sql`'[]'`),
    durationMs: integer('duration_ms').notNull().default(0),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [
    index('idx_acceptance_scenario_runs_key_created').on(t.scenarioKey, t.createdAt),
    index('idx_acceptance_scenario_runs_status').on(t.status, t.createdAt),
  ],
)

export const resourceLocks = sqliteTable(
  'resource_locks',
  {
    id: text('id').primaryKey(),
    resourceType: text('resource_type').$type<ResourceType>().notNull(),
    resourceId: text('resource_id').notNull(),
    ownerRunId: text('owner_run_id').notNull(),
    ownerAgentId: text('owner_agent_id').notNull(),
    status: text('status').$type<ResourceLockStatus>().notNull().default('held'),
    createdAt: integer('created_at').notNull(),
    expiresAt: integer('expires_at').notNull(),
    releasedAt: integer('released_at'),
  },
  (t) => [index('idx_resource_locks_resource').on(t.resourceType, t.resourceId, t.status)],
)

export const osInterferencePolicies = sqliteTable(
  'os_interference_policies',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    policy: text('policy', { mode: 'json' }).$type<OSInterferencePolicy>().notNull().default(sql`'{}'`),
    preventionChecklist: text('prevention_checklist', { mode: 'json' })
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'`),
    status: text('status').$type<'active' | 'disabled'>().notNull().default('active'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [
    index('idx_os_interference_policies_status').on(t.status, t.updatedAt),
    index('idx_os_interference_policies_name').on(t.name),
  ],
)

export const osInterferenceEvents = sqliteTable(
  'os_interference_events',
  {
    id: text('id').primaryKey(),
    policyId: text('policy_id').references(() => osInterferencePolicies.id, { onDelete: 'set null' }),
    signal: text('signal').$type<OSInterferenceSignal>().notNull(),
    sourceType: text('source_type').$type<OSInterferenceSourceType>().notNull(),
    monitorSnapshot: text('monitor_snapshot', { mode: 'json' })
      .$type<OSInterferenceMonitorSnapshot>()
      .notNull()
      .default(sql`'{}'`),
    action: text('action').$type<OSInterferenceAction>().notNull(),
    status: text('status').$type<OSInterferenceEventStatus>().notNull(),
    recommendation: text('recommendation').notNull().default(''),
    evidenceRefs: text('evidence_refs', { mode: 'json' }).$type<string[]>().notNull().default(sql`'[]'`),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [
    index('idx_os_interference_events_signal').on(t.signal, t.createdAt),
    index('idx_os_interference_events_status').on(t.status, t.createdAt),
    index('idx_os_interference_events_policy').on(t.policyId, t.createdAt),
  ],
)

export const fileSystemBoundaryPolicies = sqliteTable(
  'file_system_boundary_policies',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    policy: text('policy', { mode: 'json' }).$type<FileSystemBoundaryPolicy>().notNull().default(sql`'{}'`),
    status: text('status').$type<'active' | 'disabled'>().notNull().default('active'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [
    index('idx_file_system_boundary_policies_status').on(t.status, t.updatedAt),
    index('idx_file_system_boundary_policies_name').on(t.name),
  ],
)

export const fileSystemBoundaryEvaluations = sqliteTable(
  'file_system_boundary_evaluations',
  {
    id: text('id').primaryKey(),
    policyId: text('policy_id').references(() => fileSystemBoundaryPolicies.id, { onDelete: 'set null' }),
    requestedPath: text('requested_path').notNull().default(''),
    normalizedPath: text('normalized_path').notNull().default(''),
    operation: text('operation').$type<FileBoundaryOperation>().notNull(),
    platform: text('platform').$type<FileBoundaryPlatform>().notNull().default('windows'),
    input: text('input', { mode: 'json' }).$type<FileSystemBoundaryInput>().notNull().default(sql`'{}'`),
    risks: text('risks', { mode: 'json' }).$type<FileBoundaryRisk[]>().notNull().default(sql`'[]'`),
    actions: text('actions', { mode: 'json' }).$type<FileBoundaryAction[]>().notNull().default(sql`'[]'`),
    status: text('status').$type<FileBoundaryEvaluationStatus>().notNull(),
    recommendation: text('recommendation').notNull().default(''),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [
    index('idx_file_system_boundary_evaluations_policy').on(t.policyId, t.createdAt),
    index('idx_file_system_boundary_evaluations_status').on(t.status, t.createdAt),
    index('idx_file_system_boundary_evaluations_operation').on(t.operation, t.createdAt),
  ],
)

export const browserAutomationTrapPolicies = sqliteTable(
  'browser_automation_trap_policies',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    policy: text('policy', { mode: 'json' }).$type<BrowserAutomationTrapPolicy>().notNull().default(sql`'{}'`),
    status: text('status').$type<'active' | 'disabled'>().notNull().default('active'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [
    index('idx_browser_automation_trap_policies_status').on(t.status, t.updatedAt),
    index('idx_browser_automation_trap_policies_name').on(t.name),
  ],
)

export const browserAutomationTrapEvaluations = sqliteTable(
  'browser_automation_trap_evaluations',
  {
    id: text('id').primaryKey(),
    policyId: text('policy_id').references(() => browserAutomationTrapPolicies.id, { onDelete: 'set null' }),
    input: text('input', { mode: 'json' }).$type<BrowserAutomationTrapInput>().notNull().default(sql`'{}'`),
    risks: text('risks', { mode: 'json' }).$type<BrowserAutomationTrapRisk[]>().notNull().default(sql`'[]'`),
    actions: text('actions', { mode: 'json' }).$type<BrowserAutomationTrapAction[]>().notNull().default(sql`'[]'`),
    status: text('status').$type<BrowserAutomationTrapStatus>().notNull(),
    recommendation: text('recommendation').notNull().default(''),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [
    index('idx_browser_automation_trap_evaluations_policy').on(t.policyId, t.createdAt),
    index('idx_browser_automation_trap_evaluations_status').on(t.status, t.createdAt),
  ],
)

export const enterpriseNetworkPolicies = sqliteTable(
  'enterprise_network_policies',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    policy: text('policy', { mode: 'json' }).$type<EnterpriseNetworkPolicy>().notNull().default(sql`'{}'`),
    status: text('status').$type<'active' | 'disabled'>().notNull().default('active'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [
    index('idx_enterprise_network_policies_status').on(t.status, t.updatedAt),
    index('idx_enterprise_network_policies_name').on(t.name),
  ],
)

export const enterpriseNetworkEvaluations = sqliteTable(
  'enterprise_network_evaluations',
  {
    id: text('id').primaryKey(),
    policyId: text('policy_id').references(() => enterpriseNetworkPolicies.id, { onDelete: 'set null' }),
    input: text('input', { mode: 'json' }).$type<EnterpriseNetworkInput>().notNull().default(sql`'{}'`),
    risks: text('risks', { mode: 'json' }).$type<EnterpriseNetworkRisk[]>().notNull().default(sql`'[]'`),
    actions: text('actions', { mode: 'json' }).$type<EnterpriseNetworkAction[]>().notNull().default(sql`'[]'`),
    status: text('status').$type<EnterpriseNetworkStatus>().notNull(),
    recommendation: text('recommendation').notNull().default(''),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [
    index('idx_enterprise_network_evaluations_policy').on(t.policyId, t.createdAt),
    index('idx_enterprise_network_evaluations_status').on(t.status, t.createdAt),
  ],
)

export const outputConsistencyPolicies = sqliteTable(
  'output_consistency_policies',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    policy: text('policy', { mode: 'json' }).$type<OutputConsistencyPolicy>().notNull().default(sql`'{}'`),
    status: text('status').$type<'active' | 'disabled'>().notNull().default('active'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [
    index('idx_output_consistency_policies_status').on(t.status, t.updatedAt),
    index('idx_output_consistency_policies_name').on(t.name),
  ],
)

export const outputConsistencyEvaluations = sqliteTable(
  'output_consistency_evaluations',
  {
    id: text('id').primaryKey(),
    policyId: text('policy_id').references(() => outputConsistencyPolicies.id, { onDelete: 'set null' }),
    input: text('input', { mode: 'json' }).$type<OutputConsistencyInput>().notNull().default(sql`'{}'`),
    risks: text('risks', { mode: 'json' }).$type<OutputConsistencyRisk[]>().notNull().default(sql`'[]'`),
    actions: text('actions', { mode: 'json' }).$type<OutputConsistencyAction[]>().notNull().default(sql`'[]'`),
    status: text('status').$type<OutputConsistencyStatus>().notNull(),
    recommendation: text('recommendation').notNull().default(''),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [
    index('idx_output_consistency_evaluations_policy').on(t.policyId, t.createdAt),
    index('idx_output_consistency_evaluations_status').on(t.status, t.createdAt),
  ],
)

export const resourceGovernorPolicies = sqliteTable(
  'resource_governor_policies',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    policy: text('policy', { mode: 'json' }).$type<ResourceGovernorPolicy>().notNull().default(sql`'{}'`),
    status: text('status').$type<'active' | 'disabled'>().notNull().default('active'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [
    index('idx_resource_governor_policies_status').on(t.status, t.updatedAt),
    index('idx_resource_governor_policies_name').on(t.name),
  ],
)

export const resourceGovernorEvaluations = sqliteTable(
  'resource_governor_evaluations',
  {
    id: text('id').primaryKey(),
    policyId: text('policy_id').references(() => resourceGovernorPolicies.id, { onDelete: 'set null' }),
    snapshot: text('snapshot', { mode: 'json' }).$type<ResourceGovernorSnapshot>().notNull().default(sql`'{}'`),
    decisions: text('decisions', { mode: 'json' }).$type<ResourceGovernorDecision[]>().notNull().default(sql`'[]'`),
    actions: text('actions', { mode: 'json' }).$type<ResourceGovernorAction[]>().notNull().default(sql`'[]'`),
    status: text('status').$type<ResourceGovernorStatus>().notNull(),
    maxConcurrentAgents: integer('max_concurrent_agents').notNull().default(0),
    recommendation: text('recommendation').notNull().default(''),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [
    index('idx_resource_governor_evaluations_policy').on(t.policyId, t.createdAt),
    index('idx_resource_governor_evaluations_status').on(t.status, t.createdAt),
  ],
)

export const globalOSIntegrationPolicies = sqliteTable(
  'global_os_integration_policies',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    policy: text('policy', { mode: 'json' }).$type<GlobalOSIntegrationPolicy>().notNull().default(sql`'{}'`),
    status: text('status').$type<'active' | 'disabled'>().notNull().default('active'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [
    index('idx_global_os_integration_policies_status').on(t.status, t.updatedAt),
    index('idx_global_os_integration_policies_name').on(t.name),
  ],
)

export const globalOSIntegrationEvaluations = sqliteTable(
  'global_os_integration_evaluations',
  {
    id: text('id').primaryKey(),
    policyId: text('policy_id').references(() => globalOSIntegrationPolicies.id, { onDelete: 'set null' }),
    input: text('input', { mode: 'json' }).$type<GlobalOSIntegrationInput>().notNull().default(sql`'{}'`),
    decisions: text('decisions', { mode: 'json' }).$type<GlobalOSIntegrationDecision[]>().notNull().default(sql`'[]'`),
    actions: text('actions', { mode: 'json' }).$type<GlobalOSIntegrationAction[]>().notNull().default(sql`'[]'`),
    status: text('status').$type<GlobalOSIntegrationStatus>().notNull(),
    recommendation: text('recommendation').notNull().default(''),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [
    index('idx_global_os_integration_evaluations_policy').on(t.policyId, t.createdAt),
    index('idx_global_os_integration_evaluations_status').on(t.status, t.createdAt),
  ],
)

export const telemetryPolicies = sqliteTable(
  'telemetry_policies',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    policy: text('policy', { mode: 'json' }).$type<TelemetryPolicy>().notNull().default(sql`'{}'`),
    status: text('status').$type<'active' | 'disabled'>().notNull().default('active'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [
    index('idx_telemetry_policies_status').on(t.status, t.updatedAt),
    index('idx_telemetry_policies_name').on(t.name),
  ],
)

export const telemetryEvents = sqliteTable(
  'telemetry_events',
  {
    id: text('id').primaryKey(),
    policyId: text('policy_id').references(() => telemetryPolicies.id, { onDelete: 'set null' }),
    requestedLevel: text('requested_level').$type<TelemetryLevel>().notNull(),
    eventType: text('event_type').notNull(),
    input: text('input', { mode: 'json' }).$type<TelemetryEventInput>().notNull().default(sql`'{}'`),
    decision: text('decision', { mode: 'json' }).$type<TelemetryDecision>().notNull().default(sql`'{}'`),
    sanitizedPayload: text('sanitized_payload', { mode: 'json' }).$type<JsonObject>().notNull().default(sql`'{}'`),
    status: text('status').$type<TelemetryDecisionStatus>().notNull(),
    blockedFields: text('blocked_fields', { mode: 'json' }).$type<string[]>().notNull().default(sql`'[]'`),
    redactedFields: text('redacted_fields', { mode: 'json' }).$type<string[]>().notNull().default(sql`'[]'`),
    reason: text('reason').notNull().default(''),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [
    index('idx_telemetry_events_policy').on(t.policyId, t.createdAt),
    index('idx_telemetry_events_status').on(t.status, t.createdAt),
    index('idx_telemetry_events_type').on(t.eventType, t.createdAt),
  ],
)

export const telemetryExportManifests = sqliteTable(
  'telemetry_export_manifests',
  {
    id: text('id').primaryKey(),
    policyId: text('policy_id').references(() => telemetryPolicies.id, { onDelete: 'set null' }),
    filters: text('filters', { mode: 'json' }).$type<JsonObject>().notNull().default(sql`'{}'`),
    eventCount: integer('event_count').notNull().default(0),
    manifest: text('manifest', { mode: 'json' }).$type<JsonObject>().notNull().default(sql`'{}'`),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [
    index('idx_telemetry_export_manifests_policy').on(t.policyId, t.createdAt),
    index('idx_telemetry_export_manifests_created').on(t.createdAt),
  ],
)

export const modelInvocationOptimizationPolicies = sqliteTable(
  'model_invocation_optimization_policies',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    policy: text('policy', { mode: 'json' })
      .$type<ModelInvocationOptimizationPolicy>()
      .notNull()
      .default(sql`'{}'`),
    status: text('status').$type<'active' | 'disabled'>().notNull().default('active'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [
    index('idx_model_invocation_optimization_policies_status').on(t.status, t.updatedAt),
    index('idx_model_invocation_optimization_policies_name').on(t.name),
  ],
)

export const modelResponseCacheEntries = sqliteTable(
  'model_response_cache_entries',
  {
    id: text('id').primaryKey(),
    policyId: text('policy_id').references(() => modelInvocationOptimizationPolicies.id, {
      onDelete: 'set null',
    }),
    modelProfileId: text('model_profile_id').references(() => modelProfiles.id, { onDelete: 'set null' }),
    agentProfileId: text('agent_profile_id').references(() => agentProfiles.id, { onDelete: 'set null' }),
    taskType: text('task_type').$type<ModelInvocationTaskType>().notNull().default('other'),
    strategy: text('strategy').$type<ModelCacheStrategy>().notNull(),
    inputHash: text('input_hash').notNull(),
    semanticKey: text('semantic_key').notNull().default(''),
    inputSummary: text('input_summary').notNull().default(''),
    output: text('output', { mode: 'json' }).$type<JsonObject>().notNull().default(sql`'{}'`),
    costCents: integer('cost_cents').notNull().default(0),
    hitCount: integer('hit_count').notNull().default(0),
    expiresAt: integer('expires_at').notNull(),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [
    index('idx_model_response_cache_entries_hash').on(t.policyId, t.inputHash, t.expiresAt),
    index('idx_model_response_cache_entries_semantic').on(t.policyId, t.semanticKey, t.expiresAt),
    index('idx_model_response_cache_entries_model').on(t.modelProfileId, t.taskType, t.createdAt),
  ],
)

export const modelWarmupSessions = sqliteTable(
  'model_warmup_sessions',
  {
    id: text('id').primaryKey(),
    policyId: text('policy_id').references(() => modelInvocationOptimizationPolicies.id, {
      onDelete: 'set null',
    }),
    agentProfileId: text('agent_profile_id').references(() => agentProfiles.id, { onDelete: 'set null' }),
    modelProfileId: text('model_profile_id').references(() => modelProfiles.id, { onDelete: 'set null' }),
    status: text('status').$type<ModelWarmupStatus>().notNull().default('warming'),
    warmupRequest: text('warmup_request').notNull().default(''),
    displayStatus: text('display_status').notNull().default('Agent warming...'),
    connectionPoolPlan: text('connection_pool_plan', { mode: 'json' }).$type<JsonObject>().notNull().default(sql`'{}'`),
    result: text('result', { mode: 'json' }).$type<JsonObject>().notNull().default(sql`'{}'`),
    createdAt: integer('created_at').notNull(),
    completedAt: integer('completed_at'),
  },
  (t) => [
    index('idx_model_warmup_sessions_agent').on(t.agentProfileId, t.createdAt),
    index('idx_model_warmup_sessions_status').on(t.status, t.createdAt),
  ],
)

export const modelInvocationOptimizationEvents = sqliteTable(
  'model_invocation_optimization_events',
  {
    id: text('id').primaryKey(),
    policyId: text('policy_id').references(() => modelInvocationOptimizationPolicies.id, {
      onDelete: 'set null',
    }),
    eventType: text('event_type').$type<ModelOptimizationEventType>().notNull(),
    taskType: text('task_type').$type<ModelInvocationTaskType>().notNull().default('other'),
    status: text('status').notNull(),
    details: text('details', { mode: 'json' }).$type<JsonObject>().notNull().default(sql`'{}'`),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [
    index('idx_model_invocation_optimization_events_policy').on(t.policyId, t.createdAt),
    index('idx_model_invocation_optimization_events_type').on(t.eventType, t.createdAt),
  ],
)

export const runtimeMicroOperationPolicies = sqliteTable(
  'runtime_micro_operation_policies',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    policy: text('policy', { mode: 'json' })
      .$type<RuntimeMicroOperationPolicy>()
      .notNull()
      .default(sql`'{}'`),
    status: text('status').$type<'active' | 'disabled'>().notNull().default('active'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [
    index('idx_runtime_micro_operation_policies_status').on(t.status, t.updatedAt),
    index('idx_runtime_micro_operation_policies_name').on(t.name),
  ],
)

export const runtimeMicroOperationDecisions = sqliteTable(
  'runtime_micro_operation_decisions',
  {
    id: text('id').primaryKey(),
    policyId: text('policy_id').references(() => runtimeMicroOperationPolicies.id, {
      onDelete: 'set null',
    }),
    agentProfileId: text('agent_profile_id').references(() => agentProfiles.id, { onDelete: 'set null' }),
    decisionType: text('decision_type').$type<RuntimeMicroOperationDecisionType>().notNull(),
    action: text('action').notNull(),
    status: text('status').$type<RuntimeMicroOperationDecisionStatus>().notNull(),
    input: text('input', { mode: 'json' }).$type<JsonObject>().notNull().default(sql`'{}'`),
    result: text('result', { mode: 'json' }).$type<JsonObject>().notNull().default(sql`'{}'`),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [
    index('idx_runtime_micro_operation_decisions_policy').on(t.policyId, t.createdAt),
    index('idx_runtime_micro_operation_decisions_agent').on(t.agentProfileId, t.createdAt),
    index('idx_runtime_micro_operation_decisions_status').on(t.status, t.createdAt),
  ],
)

export const scheduledActions = sqliteTable(
  'scheduled_actions',
  {
    id: text('id').primaryKey(),
    agentProfileId: text('agent_profile_id').references(() => agentProfiles.id, { onDelete: 'set null' }),
    instruction: text('instruction').notNull(),
    dueAt: integer('due_at').notNull(),
    status: text('status').$type<ScheduledActionStatus>().notNull().default('scheduled'),
    payload: text('payload', { mode: 'json' }).$type<JsonObject>().notNull().default(sql`'{}'`),
    result: text('result', { mode: 'json' }).$type<JsonObject>().notNull().default(sql`'{}'`),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [
    index('idx_scheduled_actions_due').on(t.status, t.dueAt),
    index('idx_scheduled_actions_agent').on(t.agentProfileId, t.status),
  ],
)

export const agentInboxItems = sqliteTable(
  'agent_inbox_items',
  {
    id: text('id').primaryKey(),
    agentProfileId: text('agent_profile_id').references(() => agentProfiles.id, { onDelete: 'set null' }),
    itemType: text('item_type').$type<AgentInboxItemType>().notNull(),
    title: text('title').notNull(),
    body: text('body').notNull().default(''),
    priority: integer('priority').notNull().default(0),
    status: text('status').$type<AgentInboxItemStatus>().notNull().default('unread'),
    payload: text('payload', { mode: 'json' }).$type<JsonObject>().notNull().default(sql`'{}'`),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
    processedAt: integer('processed_at'),
  },
  (t) => [
    index('idx_agent_inbox_items_agent_status').on(t.agentProfileId, t.status, t.priority),
    index('idx_agent_inbox_items_status').on(t.status, t.priority, t.createdAt),
  ],
)

export const approvalRequests = sqliteTable(
  'approval_requests',
  {
    id: text('id').primaryKey(),
    conversationId: text('conversation_id').references(() => conversations.id, {
      onDelete: 'set null',
    }),
    runId: text('run_id'),
    nodeRunId: text('node_run_id'),
    agentProfileId: text('agent_profile_id').references(() => agentProfiles.id, {
      onDelete: 'set null',
    }),
    type: text('type').notNull(),
    status: text('status').$type<ApprovalStatus>().notNull().default('pending'),
    title: text('title').notNull(),
    description: text('description').notNull().default(''),
    riskLevel: text('risk_level').$type<RiskLevel>().notNull().default('medium'),
    payload: text('payload', { mode: 'json' }).$type<JsonObject>().notNull().default(sql`'{}'`),
    response: text('response', { mode: 'json' }).$type<JsonObject>(),
    createdAt: integer('created_at').notNull(),
    resolvedAt: integer('resolved_at'),
  },
  (t) => [index('idx_approval_requests_status').on(t.status)],
)

export const humanApprovalPolicies = sqliteTable(
  'human_approval_policies',
  {
    id: text('id').primaryKey(),
    agentProfileId: text('agent_profile_id').references(() => agentProfiles.id, {
      onDelete: 'set null',
    }),
    workflowId: text('workflow_id').references(() => workflows.id, {
      onDelete: 'set null',
    }),
    name: text('name').notNull(),
    config: text('config', { mode: 'json' })
      .$type<HumanApprovalPolicyConfig>()
      .notNull()
      .default(sql`'{}'`),
    status: text('status').$type<HumanApprovalPolicyStatus>().notNull().default('active'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [
    index('idx_human_approval_policies_agent').on(t.agentProfileId, t.status),
    index('idx_human_approval_policies_workflow').on(t.workflowId, t.status),
    index('idx_human_approval_policies_status').on(t.status),
  ],
)

export const planApprovalResults = sqliteTable(
  'plan_approval_results',
  {
    id: text('id').primaryKey(),
    approvalRequestId: text('approval_request_id').references(() => approvalRequests.id, {
      onDelete: 'set null',
    }),
    agentProfileId: text('agent_profile_id').references(() => agentProfiles.id, {
      onDelete: 'set null',
    }),
    employeeRunId: text('employee_run_id').references(() => employeeRuns.id, {
      onDelete: 'set null',
    }),
    workflowRunId: text('workflow_run_id').references(() => workflowRuns.id, {
      onDelete: 'set null',
    }),
    planId: text('plan_id'),
    stepDecisions: text('step_decisions', { mode: 'json' })
      .$type<PlanStepDecision[]>()
      .notNull()
      .default(sql`'[]'`),
    overallDecision: text('overall_decision')
      .$type<PlanApprovalOverallDecision>()
      .notNull()
      .default('approved'),
    summary: text('summary').notNull(),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [
    index('idx_plan_approval_results_request').on(t.approvalRequestId),
    index('idx_plan_approval_results_agent').on(t.agentProfileId, t.createdAt),
    index('idx_plan_approval_results_run').on(t.employeeRunId, t.workflowRunId),
  ],
)

export const takeoverSessions = sqliteTable(
  'takeover_sessions',
  {
    id: text('id').primaryKey(),
    runId: text('run_id'),
    agentProfileId: text('agent_profile_id').references(() => agentProfiles.id, {
      onDelete: 'set null',
    }),
    stepId: text('step_id').notNull(),
    resource: text('resource').$type<TakeoverResource>().notNull(),
    status: text('status').$type<TakeoverSessionStatus>().notNull().default('active'),
    userActions: text('user_actions', { mode: 'json' })
      .$type<TakeoverUserAction[]>()
      .notNull()
      .default(sql`'[]'`),
    observation: text('observation', { mode: 'json' }).$type<JsonObject>().notNull().default(sql`'{}'`),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
    completedAt: integer('completed_at'),
  },
  (t) => [
    index('idx_takeover_sessions_run').on(t.runId, t.status),
    index('idx_takeover_sessions_agent').on(t.agentProfileId, t.status),
    index('idx_takeover_sessions_resource').on(t.resource, t.status),
  ],
)

export const agentProbationRecords = sqliteTable(
  'agent_probation_records',
  {
    id: text('id').primaryKey(),
    agentProfileId: text('agent_profile_id')
      .notNull()
      .references(() => agentProfiles.id, { onDelete: 'cascade' }),
    environment: text('environment').$type<AgentDeploymentEnvironment>().notNull().default('staging'),
    status: text('status').$type<AgentProbationStatus>().notNull().default('probation'),
    riskTier: text('risk_tier').$type<AgentRiskTier>().notNull().default('high'),
    taskCount: integer('task_count').notNull().default(0),
    successCount: integer('success_count').notNull().default(0),
    successRate: real('success_rate').notNull().default(0),
    promotionTaskThreshold: integer('promotion_task_threshold').notNull().default(10),
    promotionSuccessRateThreshold: real('promotion_success_rate_threshold').notNull().default(0.8),
    restrictions: text('restrictions', { mode: 'json' }).$type<JsonObject>().notNull().default(sql`'{}'`),
    evaluation: text('evaluation', { mode: 'json' }).$type<JsonObject>().notNull().default(sql`'{}'`),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
    graduatedAt: integer('graduated_at'),
  },
  (t) => [
    index('idx_agent_probation_records_agent').on(t.agentProfileId, t.status),
    index('idx_agent_probation_records_environment').on(t.environment, t.riskTier),
  ],
)

export const agentEnvironmentPromotions = sqliteTable(
  'agent_environment_promotions',
  {
    id: text('id').primaryKey(),
    agentProfileId: text('agent_profile_id')
      .notNull()
      .references(() => agentProfiles.id, { onDelete: 'cascade' }),
    probationRecordId: text('probation_record_id').references(() => agentProbationRecords.id, {
      onDelete: 'set null',
    }),
    fromEnvironment: text('from_environment')
      .$type<AgentDeploymentEnvironment>()
      .notNull()
      .default('staging'),
    toEnvironment: text('to_environment')
      .$type<AgentDeploymentEnvironment>()
      .notNull()
      .default('production'),
    status: text('status').$type<AgentEnvironmentPromotionStatus>().notNull().default('requested'),
    approvalRequestId: text('approval_request_id').references(() => approvalRequests.id, {
      onDelete: 'set null',
    }),
    abComparison: text('ab_comparison', { mode: 'json' }).$type<JsonObject>().notNull().default(sql`'{}'`),
    decisionNote: text('decision_note').notNull().default(''),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
    decidedAt: integer('decided_at'),
  },
  (t) => [
    index('idx_agent_environment_promotions_agent').on(t.agentProfileId, t.status),
    index('idx_agent_environment_promotions_approval').on(t.approvalRequestId),
  ],
)

export const mcpToolCalls = sqliteTable(
  'mcp_tool_calls',
  {
    id: text('id').primaryKey(),
    mcpToolDefinitionId: text('mcp_tool_definition_id')
      .notNull()
      .references(() => mcpToolDefinitions.id, { onDelete: 'cascade' }),
    mcpServerId: text('mcp_server_id').references(() => mcpServers.id, {
      onDelete: 'set null',
    }),
    agentProfileId: text('agent_profile_id').references(() => agentProfiles.id, {
      onDelete: 'set null',
    }),
    employeeRunId: text('employee_run_id').references(() => employeeRuns.id, {
      onDelete: 'set null',
    }),
    workflowRunId: text('workflow_run_id').references(() => workflowRuns.id, {
      onDelete: 'set null',
    }),
    workflowNodeRunId: text('workflow_node_run_id').references(() => workflowNodeRuns.id, {
      onDelete: 'set null',
    }),
    mode: text('mode').$type<McpToolCallMode>().notNull().default('dry_run'),
    status: text('status').$type<McpToolCallStatus>().notNull().default('planned'),
    input: text('input', { mode: 'json' }).$type<JsonObject>().notNull().default(sql`'{}'`),
    output: text('output', { mode: 'json' }).$type<JsonObject>(),
    error: text('error'),
    requiresApproval: integer('requires_approval', { mode: 'boolean' }).notNull().default(true),
    autonomyDecisionId: text('autonomy_decision_id').references(() => autonomyDecisions.id, {
      onDelete: 'set null',
    }),
    approvalRequestId: text('approval_request_id').references(() => approvalRequests.id, {
      onDelete: 'set null',
    }),
    createdAt: integer('created_at').notNull(),
    finishedAt: integer('finished_at'),
  },
  (t) => [
    index('idx_mcp_tool_calls_definition_created').on(t.mcpToolDefinitionId, t.createdAt),
    index('idx_mcp_tool_calls_server').on(t.mcpServerId, t.createdAt),
    index('idx_mcp_tool_calls_employee_run').on(t.employeeRunId),
  ],
)

export const softwareCommandRuns = sqliteTable(
  'software_command_runs',
  {
    id: text('id').primaryKey(),
    softwareCommandId: text('software_command_id')
      .notNull()
      .references(() => softwareCommands.id, { onDelete: 'cascade' }),
    softwareProfileId: text('software_profile_id').references(() => softwareProfiles.id, {
      onDelete: 'set null',
    }),
    agentProfileId: text('agent_profile_id').references(() => agentProfiles.id, {
      onDelete: 'set null',
    }),
    workflowRunId: text('workflow_run_id').references(() => workflowRuns.id, {
      onDelete: 'set null',
    }),
    workflowNodeRunId: text('workflow_node_run_id').references(() => workflowNodeRuns.id, {
      onDelete: 'set null',
    }),
    mode: text('mode').$type<SoftwareCommandRunMode>().notNull().default('dry_run'),
    status: text('status').$type<SoftwareCommandRunStatus>().notNull().default('planned'),
    adapterType: text('adapter_type').$type<SoftwareAdapterType>().notNull(),
    implementationType: text('implementation_type').notNull(),
    input: text('input', { mode: 'json' }).$type<JsonObject>().notNull().default(sql`'{}'`),
    output: text('output', { mode: 'json' }).$type<JsonObject>(),
    error: text('error'),
    requiresApproval: integer('requires_approval', { mode: 'boolean' }).notNull().default(true),
    approvalRequestId: text('approval_request_id').references(() => approvalRequests.id, {
      onDelete: 'set null',
    }),
    createdAt: integer('created_at').notNull(),
    finishedAt: integer('finished_at'),
  },
  (t) => [
    index('idx_software_command_runs_command_created').on(t.softwareCommandId, t.createdAt),
    index('idx_software_command_runs_workflow').on(t.workflowRunId),
    index('idx_software_command_runs_node').on(t.workflowNodeRunId),
  ],
)

export const macroReplayRuns = sqliteTable(
  'macro_replay_runs',
  {
    id: text('id').primaryKey(),
    recordedMacroId: text('recorded_macro_id')
      .notNull()
      .references(() => recordedMacros.id, { onDelete: 'cascade' }),
    softwareProfileId: text('software_profile_id').references(() => softwareProfiles.id, {
      onDelete: 'set null',
    }),
    softwareCommandId: text('software_command_id').references(() => softwareCommands.id, {
      onDelete: 'set null',
    }),
    agentProfileId: text('agent_profile_id').references(() => agentProfiles.id, {
      onDelete: 'set null',
    }),
    mode: text('mode').$type<MacroReplayRunMode>().notNull().default('dry_run'),
    status: text('status').$type<MacroReplayRunStatus>().notNull().default('planned'),
    input: text('input', { mode: 'json' }).$type<JsonObject>().notNull().default(sql`'{}'`),
    output: text('output', { mode: 'json' }).$type<JsonObject>(),
    error: text('error'),
    requiresApproval: integer('requires_approval', { mode: 'boolean' }).notNull().default(true),
    autonomyDecisionId: text('autonomy_decision_id').references(() => autonomyDecisions.id, {
      onDelete: 'set null',
    }),
    approvalRequestId: text('approval_request_id').references(() => approvalRequests.id, {
      onDelete: 'set null',
    }),
    createdAt: integer('created_at').notNull(),
    finishedAt: integer('finished_at'),
  },
  (t) => [
    index('idx_macro_replay_runs_macro').on(t.recordedMacroId, t.createdAt),
    index('idx_macro_replay_runs_agent').on(t.agentProfileId, t.createdAt),
  ],
)

export const artifactValidations = sqliteTable(
  'artifact_validations',
  {
    id: text('id').primaryKey(),
    artifactId: text('artifact_id').references(() => artifacts.id, { onDelete: 'cascade' }),
    runId: text('run_id'),
    status: text('status', { enum: ['pending', 'passed', 'failed'] }).notNull().default('pending'),
    rules: text('rules', { mode: 'json' }).$type<string[]>().notNull().default(sql`'[]'`),
    result: text('result', { mode: 'json' }).$type<JsonObject>().notNull().default(sql`'{}'`),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [
    index('idx_artifact_validations_artifact').on(t.artifactId),
    index('idx_artifact_validations_run').on(t.runId),
  ],
)

export const employeeRuns = sqliteTable(
  'employee_runs',
  {
    id: text('id').primaryKey(),
    agentProfileId: text('agent_profile_id')
      .notNull()
      .references(() => agentProfiles.id, { onDelete: 'cascade' }),
    workflowRunId: text('workflow_run_id').references(() => workflowRuns.id, {
      onDelete: 'set null',
    }),
    goal: text('goal').notNull(),
    input: text('input', { mode: 'json' }).$type<JsonObject>().notNull().default(sql`'{}'`),
    plan: text('plan', { mode: 'json' }).$type<string[]>().notNull().default(sql`'[]'`),
    status: text('status').$type<RunStatus>().notNull().default('queued'),
    currentPhase: text('current_phase').notNull().default('queued'),
    currentStep: text('current_step'),
    output: text('output', { mode: 'json' }).$type<JsonObject>(),
    error: text('error'),
    budgetLimitCents: integer('budget_limit_cents'),
    estimatedCostCents: integer('estimated_cost_cents').notNull().default(0),
    actualCostCents: integer('actual_cost_cents').notNull().default(0),
    createdAt: integer('created_at').notNull(),
    startedAt: integer('started_at'),
    updatedAt: integer('updated_at').notNull(),
    finishedAt: integer('finished_at'),
  },
  (t) => [index('idx_employee_runs_agent_status').on(t.agentProfileId, t.status)],
)

export const onboardingSessions = sqliteTable(
  'onboarding_sessions',
  {
    id: text('id').primaryKey(),
    status: text('status').$type<OnboardingSessionStatus>().notNull().default('started'),
    currentStep: text('current_step').notNull().default('welcome'),
    selectedWorkType: text('selected_work_type'),
    createdAgentProfileId: text('created_agent_profile_id').references(() => agentProfiles.id, {
      onDelete: 'set null',
    }),
    demoEmployeeRunId: text('demo_employee_run_id').references(() => employeeRuns.id, {
      onDelete: 'set null',
    }),
    checklist: text('checklist', { mode: 'json' }).$type<JsonObject>().notNull().default(sql`'{}'`),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
    completedAt: integer('completed_at'),
  },
  (t) => [
    index('idx_onboarding_sessions_status').on(t.status, t.createdAt),
    index('idx_onboarding_sessions_agent').on(t.createdAgentProfileId),
  ],
)

export const multimodalInputs = sqliteTable(
  'multimodal_inputs',
  {
    id: text('id').primaryKey(),
    employeeRunId: text('employee_run_id').references(() => employeeRuns.id, {
      onDelete: 'cascade',
    }),
    agentProfileId: text('agent_profile_id').references(() => agentProfiles.id, {
      onDelete: 'set null',
    }),
    kind: text('kind').$type<MultimodalInputKind>().notNull(),
    mimeType: text('mime_type'),
    source: text('source').notNull().default('user'),
    dataRef: text('data_ref'),
    description: text('description'),
    metadata: text('metadata', { mode: 'json' }).$type<JsonObject>().notNull().default(sql`'{}'`),
    status: text('status').$type<MultimodalIoStatus>().notNull().default('registered'),
    validationResult: text('validation_result', { mode: 'json' }).$type<JsonObject>().notNull().default(sql`'{}'`),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [
    index('idx_multimodal_inputs_run').on(t.employeeRunId, t.createdAt),
    index('idx_multimodal_inputs_agent').on(t.agentProfileId, t.kind),
    index('idx_multimodal_inputs_kind').on(t.kind, t.status),
  ],
)

export const multimodalOutputs = sqliteTable(
  'multimodal_outputs',
  {
    id: text('id').primaryKey(),
    employeeRunId: text('employee_run_id').references(() => employeeRuns.id, {
      onDelete: 'cascade',
    }),
    agentProfileId: text('agent_profile_id').references(() => agentProfiles.id, {
      onDelete: 'set null',
    }),
    kind: text('kind').$type<MultimodalOutputKind>().notNull(),
    artifactId: text('artifact_id').references(() => artifacts.id, { onDelete: 'set null' }),
    path: text('path'),
    caption: text('caption'),
    format: text('format'),
    data: text('data', { mode: 'json' }).$type<JsonObject>().notNull().default(sql`'{}'`),
    metadata: text('metadata', { mode: 'json' }).$type<JsonObject>().notNull().default(sql`'{}'`),
    status: text('status').$type<MultimodalIoStatus>().notNull().default('registered'),
    validationResult: text('validation_result', { mode: 'json' }).$type<JsonObject>().notNull().default(sql`'{}'`),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [
    index('idx_multimodal_outputs_run').on(t.employeeRunId, t.createdAt),
    index('idx_multimodal_outputs_agent').on(t.agentProfileId, t.kind),
    index('idx_multimodal_outputs_kind').on(t.kind, t.status),
  ],
)

export const runtimeContextSnapshots = sqliteTable(
  'runtime_context_snapshots',
  {
    id: text('id').primaryKey(),
    employeeRunId: text('employee_run_id').references(() => employeeRuns.id, {
      onDelete: 'cascade',
    }),
    agentProfileId: text('agent_profile_id').references(() => agentProfiles.id, {
      onDelete: 'set null',
    }),
    promptTemplateId: text('prompt_template_id').references(() => promptTemplates.id, {
      onDelete: 'set null',
    }),
    promptTemplateVersionId: text('prompt_template_version_id').references(
      () => promptTemplateVersions.id,
      {
        onDelete: 'set null',
      },
    ),
    summary: text('summary').notNull(),
    visibleContext: text('visible_context', { mode: 'json' }).$type<JsonObject>().notNull().default(sql`'{}'`),
    tokenBudget: integer('token_budget'),
    tokenEstimate: integer('token_estimate').notNull().default(0),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [
    index('idx_runtime_context_snapshots_run').on(t.employeeRunId, t.createdAt),
    index('idx_runtime_context_snapshots_agent').on(t.agentProfileId, t.createdAt),
  ],
)

export const contextWindowVisualizations = sqliteTable(
  'context_window_visualizations',
  {
    id: text('id').primaryKey(),
    agentProfileId: text('agent_profile_id').references(() => agentProfiles.id, {
      onDelete: 'set null',
    }),
    employeeRunId: text('employee_run_id').references(() => employeeRuns.id, {
      onDelete: 'set null',
    }),
    runtimeContextSnapshotId: text('runtime_context_snapshot_id').references(
      () => runtimeContextSnapshots.id,
      { onDelete: 'set null' },
    ),
    goal: text('goal').notNull().default(''),
    tokenCapacity: integer('token_capacity').notNull(),
    tokensUsed: integer('tokens_used').notNull(),
    tokenEstimate: integer('token_estimate').notNull(),
    overflowTokens: integer('overflow_tokens').notNull().default(0),
    remainingTokens: integer('remaining_tokens').notNull(),
    usedPercent: real('used_percent').notNull(),
    segments: text('segments', { mode: 'json' })
      .$type<ContextWindowSegment[]>()
      .notNull()
      .default(sql`'[]'`),
    contentTypeBreakdown: text('content_type_breakdown', { mode: 'json' })
      .$type<ContextWindowBreakdownItem[]>()
      .notNull()
      .default(sql`'[]'`),
    importanceBreakdown: text('importance_breakdown', { mode: 'json' })
      .$type<ContextWindowBreakdownItem[]>()
      .notNull()
      .default(sql`'[]'`),
    suggestions: text('suggestions', { mode: 'json' })
      .$type<ContextWindowSuggestion[]>()
      .notNull()
      .default(sql`'[]'`),
    compressibleTokens: integer('compressible_tokens').notNull().default(0),
    summary: text('summary').notNull(),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [
    index('idx_context_window_visualizations_agent').on(t.agentProfileId, t.createdAt),
    index('idx_context_window_visualizations_run').on(t.employeeRunId, t.createdAt),
    index('idx_context_window_visualizations_snapshot').on(t.runtimeContextSnapshotId),
  ],
)

export const interAgentMessages = sqliteTable(
  'inter_agent_messages',
  {
    id: text('id').primaryKey(),
    senderAgentProfileId: text('sender_agent_profile_id').references(() => agentProfiles.id, {
      onDelete: 'set null',
    }),
    recipientAgentProfileId: text('recipient_agent_profile_id').references(
      () => agentProfiles.id,
      { onDelete: 'set null' },
    ),
    workflowRunId: text('workflow_run_id').references(() => workflowRuns.id, {
      onDelete: 'set null',
    }),
    employeeRunId: text('employee_run_id').references(() => employeeRuns.id, {
      onDelete: 'set null',
    }),
    channel: text('channel').notNull().default('default'),
    messageType: text('message_type').$type<AgentMessageType>().notNull().default('status'),
    content: text('content', { mode: 'json' }).$type<JsonObject>().notNull().default(sql`'{}'`),
    status: text('status').$type<AgentMessageStatus>().notNull().default('sent'),
    createdAt: integer('created_at').notNull(),
    readAt: integer('read_at'),
  },
  (t) => [
    index('idx_inter_agent_messages_channel_created').on(t.channel, t.createdAt),
    index('idx_inter_agent_messages_recipient').on(t.recipientAgentProfileId, t.status),
  ],
)

export const agentCommunicationProtocols = sqliteTable(
  'agent_communication_protocols',
  {
    id: text('id').primaryKey(),
    version: text('version').notNull(),
    name: text('name').notNull(),
    description: text('description').notNull().default(''),
    requiredTopLevelFields: text('required_top_level_fields', { mode: 'json' })
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'`),
    headerFields: text('header_fields', { mode: 'json' }).$type<string[]>().notNull().default(sql`'[]'`),
    bodyFields: text('body_fields', { mode: 'json' }).$type<string[]>().notNull().default(sql`'[]'`),
    contextFields: text('context_fields', { mode: 'json' }).$type<string[]>().notNull().default(sql`'[]'`),
    supportsSignature: integer('supports_signature', { mode: 'boolean' }).notNull().default(true),
    defaultTtlMs: integer('default_ttl_ms').notNull().default(3600000),
    status: text('status').$type<AgentProtocolStatus>().notNull().default('active'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [
    index('idx_agent_communication_protocols_version').on(t.version, t.status),
    index('idx_agent_communication_protocols_status').on(t.status, t.updatedAt),
  ],
)

export const agentProtocolMessages = sqliteTable(
  'agent_protocol_messages',
  {
    id: text('id').primaryKey(),
    protocolId: text('protocol_id')
      .notNull()
      .references(() => agentCommunicationProtocols.id, { onDelete: 'cascade' }),
    version: text('version').notNull(),
    messageId: text('message_id').notNull(),
    timestamp: integer('timestamp').notNull(),
    ttlMs: integer('ttl_ms').notNull(),
    expiresAt: integer('expires_at').notNull(),
    fromAgentId: text('from_agent_id'),
    toAgentId: text('to_agent_id'),
    messageType: text('message_type').$type<AgentProtocolMessageType>().notNull(),
    priority: text('priority').$type<AgentProtocolPriority>().notNull().default('normal'),
    replyTo: text('reply_to'),
    intent: text('intent').notNull(),
    detail: text('detail').notNull().default(''),
    context: text('context', { mode: 'json' }).$type<JsonObject>().notNull().default(sql`'{}'`),
    proposedAction: text('proposed_action', { mode: 'json' }).$type<JsonObject | null>(),
    signature: text('signature'),
    validationStatus: text('validation_status')
      .$type<AgentProtocolValidationStatus>()
      .notNull()
      .default('valid'),
    validationErrors: text('validation_errors', { mode: 'json' }).$type<string[]>().notNull().default(sql`'[]'`),
    envelope: text('envelope', { mode: 'json' }).$type<JsonObject>().notNull().default(sql`'{}'`),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [
    index('idx_agent_protocol_messages_message').on(t.messageId),
    index('idx_agent_protocol_messages_from').on(t.fromAgentId, t.createdAt),
    index('idx_agent_protocol_messages_to').on(t.toAgentId, t.createdAt),
    index('idx_agent_protocol_messages_type').on(t.messageType, t.priority),
  ],
)

export const streamProtocolChannels = sqliteTable(
  'stream_protocol_channels',
  {
    id: text('id').primaryKey(),
    stream: text('stream').notNull(),
    description: text('description').notNull().default(''),
    primaryTransport: text('primary_transport')
      .$type<StreamProtocolTransport>()
      .notNull()
      .default('websocket'),
    fallbackTransport: text('fallback_transport')
      .$type<StreamProtocolTransport>()
      .notNull()
      .default('sse'),
    replayRetentionMs: integer('replay_retention_ms').notNull().default(3600000),
    status: text('status').$type<OpenSourceGovernanceStatus>().notNull().default('active'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [
    index('idx_stream_protocol_channels_stream').on(t.stream),
    index('idx_stream_protocol_channels_status').on(t.status, t.updatedAt),
  ],
)

export const streamProtocolEvents = sqliteTable(
  'stream_protocol_events',
  {
    id: text('id').primaryKey(),
    channelId: text('channel_id')
      .notNull()
      .references(() => streamProtocolChannels.id, { onDelete: 'cascade' }),
    stream: text('stream').notNull(),
    sequence: integer('sequence').notNull(),
    messageType: text('message_type').$type<StreamProtocolMessageType>().notNull(),
    data: text('data', { mode: 'json' }).$type<JsonObject>().notNull().default(sql`'{}'`),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [
    index('idx_stream_protocol_events_stream_sequence').on(t.stream, t.sequence),
    index('idx_stream_protocol_events_channel_created').on(t.channelId, t.createdAt),
  ],
)

export const streamReplayCursors = sqliteTable(
  'stream_replay_cursors',
  {
    id: text('id').primaryKey(),
    channelId: text('channel_id')
      .notNull()
      .references(() => streamProtocolChannels.id, { onDelete: 'cascade' }),
    stream: text('stream').notNull(),
    clientId: text('client_id').notNull(),
    lastSequence: integer('last_sequence').notNull().default(0),
    transport: text('transport').$type<StreamProtocolTransport>().notNull().default('sse'),
    disconnectedAt: integer('disconnected_at'),
    replayedAt: integer('replayed_at'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [
    index('idx_stream_replay_cursors_client').on(t.clientId, t.stream),
    index('idx_stream_replay_cursors_channel').on(t.channelId, t.updatedAt),
  ],
)

export const blackboardEntries = sqliteTable(
  'blackboard_entries',
  {
    id: text('id').primaryKey(),
    scopeType: text('scope_type').$type<BlackboardScopeType>().notNull(),
    scopeId: text('scope_id').notNull(),
    key: text('key').notNull(),
    value: text('value', { mode: 'json' }).$type<JsonObject>().notNull().default(sql`'{}'`),
    authorAgentProfileId: text('author_agent_profile_id').references(() => agentProfiles.id, {
      onDelete: 'set null',
    }),
    version: integer('version').notNull().default(1),
    status: text('status').$type<BlackboardEntryStatus>().notNull().default('active'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [
    index('idx_blackboard_entries_scope_key').on(t.scopeType, t.scopeId, t.key, t.status),
  ],
)

export const agentTeamDashboardSnapshots = sqliteTable(
  'agent_team_dashboard_snapshots',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    workflowRunId: text('workflow_run_id').references(() => workflowRuns.id, {
      onDelete: 'set null',
    }),
    agentProfileIds: text('agent_profile_ids', { mode: 'json' })
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'`),
    cards: text('cards', { mode: 'json' })
      .$type<AgentTeamDashboardCard[]>()
      .notNull()
      .default(sql`'[]'`),
    blackboardItems: text('blackboard_items', { mode: 'json' })
      .$type<AgentTeamBlackboardItem[]>()
      .notNull()
      .default(sql`'[]'`),
    activeRunCount: integer('active_run_count').notNull().default(0),
    waitingApprovalCount: integer('waiting_approval_count').notNull().default(0),
    blockedCount: integer('blocked_count').notNull().default(0),
    failedCount: integer('failed_count').notNull().default(0),
    status: text('status').$type<AgentTeamDashboardStatus>().notNull().default('live'),
    exportManifest: text('export_manifest', { mode: 'json' }).$type<JsonObject>().notNull().default(sql`'{}'`),
    summary: text('summary').notNull(),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [
    index('idx_agent_team_dashboards_workflow').on(t.workflowRunId, t.createdAt),
    index('idx_agent_team_dashboards_status').on(t.status, t.createdAt),
  ],
)

export const agentTeamDashboardCommands = sqliteTable(
  'agent_team_dashboard_commands',
  {
    id: text('id').primaryKey(),
    dashboardSnapshotId: text('dashboard_snapshot_id')
      .notNull()
      .references(() => agentTeamDashboardSnapshots.id, { onDelete: 'cascade' }),
    commandType: text('command_type').$type<AgentTeamDashboardCommandType>().notNull(),
    status: text('status').$type<AgentTeamDashboardCommandStatus>().notNull().default('planned'),
    affectedAgentProfileIds: text('affected_agent_profile_ids', { mode: 'json' })
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'`),
    affectedEmployeeRunIds: text('affected_employee_run_ids', { mode: 'json' })
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'`),
    skippedEmployeeRunIds: text('skipped_employee_run_ids', { mode: 'json' })
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'`),
    summary: text('summary').notNull(),
    exportManifest: text('export_manifest', { mode: 'json' }).$type<JsonObject>().notNull().default(sql`'{}'`),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [
    index('idx_agent_team_dashboard_commands_snapshot').on(t.dashboardSnapshotId, t.createdAt),
    index('idx_agent_team_dashboard_commands_type').on(t.commandType, t.status),
  ],
)

export const cicdIntegrations = sqliteTable(
  'cicd_integrations',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    platform: text('platform').$type<CicdPlatform>().notNull(),
    mode: text('mode').$type<CicdMode>().notNull(),
    agentProfileId: text('agent_profile_id').references(() => agentProfiles.id, {
      onDelete: 'set null',
    }),
    agentName: text('agent_name').notNull(),
    task: text('task').notNull(),
    maxBudgetDollars: real('max_budget_dollars').notNull().default(0.5),
    failOn: text('fail_on').$type<CicdAgentConclusion>().notNull().default('security_issue_found'),
    outputArtifacts: integer('output_artifacts', { mode: 'boolean' }).notNull().default(true),
    postAsPrComment: integer('post_as_pr_comment', { mode: 'boolean' }).notNull().default(true),
    autoFix: integer('auto_fix', { mode: 'boolean' }).notNull().default(false),
    exitCodeMapping: text('exit_code_mapping', { mode: 'json' })
      .$type<Record<string, number>>()
      .notNull()
      .default(sql`'{}'`),
    workflowTemplate: text('workflow_template').notNull(),
    status: text('status').$type<CicdIntegrationStatus>().notNull().default('active'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [
    index('idx_cicd_integrations_platform').on(t.platform, t.status),
    index('idx_cicd_integrations_agent').on(t.agentProfileId, t.status),
  ],
)

export const cicdRuns = sqliteTable(
  'cicd_runs',
  {
    id: text('id').primaryKey(),
    integrationId: text('integration_id')
      .notNull()
      .references(() => cicdIntegrations.id, { onDelete: 'cascade' }),
    triggerType: text('trigger_type').$type<CicdMode>().notNull(),
    refName: text('ref_name').notNull().default(''),
    commitSha: text('commit_sha').notNull().default(''),
    pullRequestNumber: integer('pull_request_number'),
    employeeRunId: text('employee_run_id').references(() => employeeRuns.id, {
      onDelete: 'set null',
    }),
    status: text('status').$type<CicdRunStatus>().notNull().default('queued'),
    agentConclusion: text('agent_conclusion').$type<CicdAgentConclusion>().notNull().default('passed'),
    exitCode: integer('exit_code').notNull().default(0),
    artifactManifest: text('artifact_manifest', { mode: 'json' }).$type<JsonObject>().notNull().default(sql`'{}'`),
    prComment: text('pr_comment', { mode: 'json' }).$type<JsonObject>().notNull().default(sql`'{}'`),
    autoFixPlan: text('auto_fix_plan', { mode: 'json' }).$type<JsonObject>().notNull().default(sql`'{}'`),
    createdAt: integer('created_at').notNull(),
    finishedAt: integer('finished_at'),
  },
  (t) => [
    index('idx_cicd_runs_integration').on(t.integrationId, t.createdAt),
    index('idx_cicd_runs_status').on(t.status, t.createdAt),
  ],
)

export const capabilityNegotiations = sqliteTable(
  'capability_negotiations',
  {
    id: text('id').primaryKey(),
    requesterAgentProfileId: text('requester_agent_profile_id')
      .notNull()
      .references(() => agentProfiles.id, { onDelete: 'cascade' }),
    workflowRunId: text('workflow_run_id').references(() => workflowRuns.id, {
      onDelete: 'set null',
    }),
    employeeRunId: text('employee_run_id').references(() => employeeRuns.id, {
      onDelete: 'set null',
    }),
    taskGoal: text('task_goal').notNull(),
    requiredCapabilities: text('required_capabilities', { mode: 'json' })
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'`),
    availableCapabilities: text('available_capabilities', { mode: 'json' })
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'`),
    missingCapabilities: text('missing_capabilities', { mode: 'json' })
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'`),
    strategies: text('strategies', { mode: 'json' })
      .$type<CapabilityNegotiationStrategies>()
      .notNull()
      .default(sql`'{}'`),
    candidateAgentProfileIds: text('candidate_agent_profile_ids', { mode: 'json' })
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'`),
    selectedStrategy: text('selected_strategy').$type<CapabilityNegotiationStrategy>(),
    resolution: text('resolution', { mode: 'json' }).$type<CapabilityNegotiationResolution | null>(),
    status: text('status').$type<CapabilityNegotiationStatus>().notNull().default('open'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
    resolvedAt: integer('resolved_at'),
  },
  (t) => [
    index('idx_capability_negotiations_requester').on(t.requesterAgentProfileId, t.status),
    index('idx_capability_negotiations_status').on(t.status, t.updatedAt),
    index('idx_capability_negotiations_employee_run').on(t.employeeRunId),
  ],
)

export const capabilityNegotiationEvents = sqliteTable(
  'capability_negotiation_events',
  {
    id: text('id').primaryKey(),
    negotiationId: text('negotiation_id')
      .notNull()
      .references(() => capabilityNegotiations.id, { onDelete: 'cascade' }),
    eventType: text('event_type').$type<CapabilityNegotiationEventType>().notNull(),
    actorAgentProfileId: text('actor_agent_profile_id').references(() => agentProfiles.id, {
      onDelete: 'set null',
    }),
    protocolMessageId: text('protocol_message_id').references(() => agentProtocolMessages.id, {
      onDelete: 'set null',
    }),
    payload: text('payload', { mode: 'json' }).$type<JsonObject>().notNull().default(sql`'{}'`),
    summary: text('summary').notNull(),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [
    index('idx_capability_negotiation_events_negotiation').on(t.negotiationId, t.createdAt),
    index('idx_capability_negotiation_events_type').on(t.eventType, t.createdAt),
  ],
)

export const conflictResolutions = sqliteTable(
  'conflict_resolutions',
  {
    id: text('id').primaryKey(),
    resourceType: text('resource_type').notNull(),
    resourceId: text('resource_id').notNull(),
    conflictType: text('conflict_type').notNull(),
    participants: text('participants', { mode: 'json' })
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'`),
    status: text('status').$type<ConflictStatus>().notNull().default('open'),
    summary: text('summary').notNull().default(''),
    resolution: text('resolution', { mode: 'json' }).$type<JsonObject>(),
    createdAt: integer('created_at').notNull(),
    resolvedAt: integer('resolved_at'),
  },
  (t) => [index('idx_conflict_resolutions_resource').on(t.resourceType, t.resourceId, t.status)],
)

export const conflictEscalations = sqliteTable(
  'conflict_escalations',
  {
    id: text('id').primaryKey(),
    conflictResolutionId: text('conflict_resolution_id')
      .notNull()
      .references(() => conflictResolutions.id, { onDelete: 'cascade' }),
    level: integer('level').notNull(),
    name: text('name').notNull(),
    action: text('action').$type<ConflictEscalationAction>().notNull(),
    maxAttempts: integer('max_attempts'),
    attempts: integer('attempts').notNull().default(0),
    timeoutMs: integer('timeout_ms'),
    status: text('status').$type<ConflictEscalationStatus>().notNull().default('active'),
    recommendation: text('recommendation', { mode: 'json' }).$type<JsonObject>().notNull().default(sql`'{}'`),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
    dueAt: integer('due_at'),
    completedAt: integer('completed_at'),
  },
  (t) => [
    index('idx_conflict_escalations_conflict').on(t.conflictResolutionId, t.level),
    index('idx_conflict_escalations_status').on(t.status, t.dueAt),
  ],
)

export const realtimeCollabSessions = sqliteTable(
  'realtime_collab_sessions',
  {
    id: text('id').primaryKey(),
    documentPath: text('document_path').notNull(),
    protocol: text('protocol').$type<RealtimeCollabProtocol>().notNull().default('segment_lock'),
    conflictResolution: text('conflict_resolution')
      .$type<RealtimeCollabResolution>()
      .notNull()
      .default('user_wins'),
    showAgentCursor: integer('show_agent_cursor', { mode: 'boolean' }).notNull().default(true),
    showAgentSelection: integer('show_agent_selection', { mode: 'boolean' }).notNull().default(true),
    agentAwareOfUserEdits: integer('agent_aware_of_user_edits', { mode: 'boolean' }).notNull().default(true),
    status: text('status').$type<RealtimeCollabStatus>().notNull().default('active'),
    currentVersion: integer('current_version').notNull().default(1),
    createdBy: text('created_by'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [
    index('idx_realtime_collab_sessions_path').on(t.documentPath, t.status),
    index('idx_realtime_collab_sessions_status').on(t.status, t.updatedAt),
  ],
)

export const realtimeSegmentLocks = sqliteTable(
  'realtime_segment_locks',
  {
    id: text('id').primaryKey(),
    sessionId: text('session_id')
      .notNull()
      .references(() => realtimeCollabSessions.id, { onDelete: 'cascade' }),
    employeeRunId: text('employee_run_id').references(() => employeeRuns.id, {
      onDelete: 'set null',
    }),
    agentProfileId: text('agent_profile_id').references(() => agentProfiles.id, {
      onDelete: 'set null',
    }),
    participantType: text('participant_type').$type<RealtimeParticipantType>().notNull(),
    participantId: text('participant_id'),
    filePath: text('file_path').notNull(),
    startLine: integer('start_line').notNull(),
    endLine: integer('end_line').notNull(),
    cursorLine: integer('cursor_line'),
    cursorColumn: integer('cursor_column'),
    status: text('status').$type<RealtimeSegmentLockStatus>().notNull().default('active'),
    conflictId: text('conflict_id').references(() => conflictResolutions.id, {
      onDelete: 'set null',
    }),
    createdAt: integer('created_at').notNull(),
    expiresAt: integer('expires_at'),
    releasedAt: integer('released_at'),
  },
  (t) => [
    index('idx_realtime_segment_locks_session').on(t.sessionId, t.status),
    index('idx_realtime_segment_locks_file').on(t.filePath, t.startLine, t.endLine),
    index('idx_realtime_segment_locks_agent').on(t.agentProfileId, t.status),
  ],
)

export const realtimeEditOperations = sqliteTable(
  'realtime_edit_operations',
  {
    id: text('id').primaryKey(),
    sessionId: text('session_id')
      .notNull()
      .references(() => realtimeCollabSessions.id, { onDelete: 'cascade' }),
    segmentLockId: text('segment_lock_id').references(() => realtimeSegmentLocks.id, {
      onDelete: 'set null',
    }),
    participantType: text('participant_type').$type<RealtimeParticipantType>().notNull(),
    participantId: text('participant_id'),
    filePath: text('file_path').notNull(),
    operationKind: text('operation_kind').$type<RealtimeEditOperationKind>().notNull(),
    startLine: integer('start_line').notNull(),
    endLine: integer('end_line').notNull(),
    baseVersion: integer('base_version').notNull(),
    newText: text('new_text'),
    status: text('status').$type<RealtimeEditOperationStatus>().notNull().default('queued'),
    conflictId: text('conflict_id').references(() => conflictResolutions.id, {
      onDelete: 'set null',
    }),
    result: text('result', { mode: 'json' }).$type<JsonObject>().notNull().default(sql`'{}'`),
    createdAt: integer('created_at').notNull(),
    appliedAt: integer('applied_at'),
  },
  (t) => [
    index('idx_realtime_edit_operations_session').on(t.sessionId, t.createdAt),
    index('idx_realtime_edit_operations_lock').on(t.segmentLockId, t.status),
    index('idx_realtime_edit_operations_status').on(t.status, t.createdAt),
  ],
)

export const cliRuns = sqliteTable(
  'cli_runs',
  {
    id: text('id').primaryKey(),
    cliProfileId: text('cli_profile_id')
      .notNull()
      .references(() => cliProfiles.id, { onDelete: 'cascade' }),
    agentProfileId: text('agent_profile_id').references(() => agentProfiles.id, {
      onDelete: 'set null',
    }),
    employeeRunId: text('employee_run_id').references(() => employeeRuns.id, {
      onDelete: 'set null',
    }),
    mode: text('mode').$type<CliRunMode>().notNull().default('dry_run'),
    status: text('status').$type<CliRunStatus>().notNull().default('planned'),
    command: text('command').notNull(),
    renderedArgs: text('rendered_args').notNull().default(''),
    cwd: text('cwd').notNull(),
    envKeys: text('env_keys', { mode: 'json' }).$type<string[]>().notNull().default(sql`'[]'`),
    stdinPreview: text('stdin_preview'),
    output: text('output', { mode: 'json' }).$type<JsonObject>(),
    error: text('error'),
    requiresApproval: integer('requires_approval', { mode: 'boolean' }).notNull().default(true),
    approvalRequestId: text('approval_request_id').references(() => approvalRequests.id, {
      onDelete: 'set null',
    }),
    createdAt: integer('created_at').notNull(),
    finishedAt: integer('finished_at'),
  },
  (t) => [
    index('idx_cli_runs_profile_created').on(t.cliProfileId, t.createdAt),
    index('idx_cli_runs_employee_run').on(t.employeeRunId),
  ],
)

export const employeeRunEvents = sqliteTable(
  'employee_run_events',
  {
    id: text('id').primaryKey(),
    employeeRunId: text('employee_run_id')
      .notNull()
      .references(() => employeeRuns.id, { onDelete: 'cascade' }),
    type: text('type').$type<EmployeeRunEventType>().notNull(),
    phase: text('phase').notNull(),
    message: text('message').notNull(),
    payload: text('payload', { mode: 'json' }).$type<JsonObject>().notNull().default(sql`'{}'`),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [index('idx_employee_run_events_run_created').on(t.employeeRunId, t.createdAt)],
)

export const runtimeCheckpoints = sqliteTable(
  'runtime_checkpoints',
  {
    id: text('id').primaryKey(),
    employeeRunId: text('employee_run_id')
      .notNull()
      .references(() => employeeRuns.id, { onDelete: 'cascade' }),
    stepIndex: integer('step_index').notNull(),
    phase: text('phase').notNull(),
    state: text('state', { mode: 'json' }).$type<JsonObject>().notNull().default(sql`'{}'`),
    summary: text('summary').notNull(),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [index('idx_runtime_checkpoints_run_step').on(t.employeeRunId, t.stepIndex)],
)

export const recoveryEvents = sqliteTable(
  'recovery_events',
  {
    id: text('id').primaryKey(),
    resourceType: text('resource_type').notNull(),
    resourceId: text('resource_id').notNull(),
    eventType: text('event_type').$type<RecoveryEventType>().notNull(),
    status: text('status').$type<RecoveryEventStatus>().notNull().default('recorded'),
    summary: text('summary').notNull(),
    payload: text('payload', { mode: 'json' }).$type<JsonObject>().notNull().default(sql`'{}'`),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [index('idx_recovery_events_resource').on(t.resourceType, t.resourceId, t.createdAt)],
)

export const errorClassifications = sqliteTable(
  'error_classifications',
  {
    id: text('id').primaryKey(),
    resourceType: text('resource_type').notNull(),
    resourceId: text('resource_id').notNull(),
    agentProfileId: text('agent_profile_id').references(() => agentProfiles.id, {
      onDelete: 'set null',
    }),
    category: text('category').$type<ErrorTaxonomyCategory>().notNull(),
    severity: text('severity').$type<ErrorSeverity>().notNull(),
    message: text('message').notNull(),
    normalizedError: text('normalized_error').notNull(),
    context: text('context', { mode: 'json' }).$type<JsonObject>().notNull().default(sql`'{}'`),
    suggestedStrategy: text('suggested_strategy').$type<RecoveryStrategyType>().notNull(),
    suggestedStrategyConfig: text('suggested_strategy_config', { mode: 'json' })
      .$type<JsonObject>()
      .notNull()
      .default(sql`'{}'`),
    strategyRankings: text('strategy_rankings', { mode: 'json' })
      .$type<JsonObject[]>()
      .notNull()
      .default(sql`'[]'`),
    confidence: real('confidence').notNull().default(0.5),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [
    index('idx_error_classifications_resource').on(t.resourceType, t.resourceId, t.createdAt),
    index('idx_error_classifications_agent').on(t.agentProfileId, t.createdAt),
    index('idx_error_classifications_category').on(t.category, t.severity, t.createdAt),
  ],
)

export const recoveryStrategyAttempts = sqliteTable(
  'recovery_strategy_attempts',
  {
    id: text('id').primaryKey(),
    classificationId: text('classification_id')
      .notNull()
      .references(() => errorClassifications.id, { onDelete: 'cascade' }),
    agentProfileId: text('agent_profile_id').references(() => agentProfiles.id, {
      onDelete: 'set null',
    }),
    category: text('category').$type<ErrorTaxonomyCategory>().notNull(),
    strategyType: text('strategy_type').$type<RecoveryStrategyType>().notNull(),
    strategyConfig: text('strategy_config', { mode: 'json' })
      .$type<JsonObject>()
      .notNull()
      .default(sql`'{}'`),
    outcome: text('outcome').$type<RecoveryStrategyOutcome>().notNull(),
    success: integer('success', { mode: 'boolean' }).notNull().default(false),
    durationMs: integer('duration_ms').notNull().default(0),
    notes: text('notes').notNull().default(''),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [
    index('idx_recovery_strategy_attempts_classification').on(t.classificationId, t.createdAt),
    index('idx_recovery_strategy_attempts_agent').on(t.agentProfileId, t.createdAt),
    index('idx_recovery_strategy_attempts_category_strategy').on(t.category, t.strategyType, t.createdAt),
  ],
)

export const recoveryStrategyStats = sqliteTable(
  'recovery_strategy_stats',
  {
    id: text('id').primaryKey(),
    agentProfileId: text('agent_profile_id').references(() => agentProfiles.id, {
      onDelete: 'set null',
    }),
    category: text('category').$type<ErrorTaxonomyCategory>().notNull(),
    strategyType: text('strategy_type').$type<RecoveryStrategyType>().notNull(),
    attemptCount: integer('attempt_count').notNull().default(0),
    successCount: integer('success_count').notNull().default(0),
    failureCount: integer('failure_count').notNull().default(0),
    successRate: real('success_rate').notNull().default(0),
    lastOutcome: text('last_outcome').$type<RecoveryStrategyOutcome>(),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [
    index('idx_recovery_strategy_stats_agent_category').on(t.agentProfileId, t.category),
    index('idx_recovery_strategy_stats_category_strategy').on(t.category, t.strategyType),
  ],
)

export const idempotencyRecords = sqliteTable(
  'idempotency_records',
  {
    id: text('id').primaryKey(),
    key: text('key').notNull().unique(),
    scope: text('scope').notNull().default('global'),
    resourceType: text('resource_type').notNull(),
    resourceId: text('resource_id'),
    requestHash: text('request_hash').notNull(),
    status: text('status').$type<IdempotencyStatus>().notNull().default('started'),
    result: text('result', { mode: 'json' }).$type<JsonObject>(),
    error: text('error'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
    expiresAt: integer('expires_at'),
  },
  (t) => [
    index('idx_idempotency_records_scope').on(t.scope, t.status),
    index('idx_idempotency_records_resource').on(t.resourceType, t.resourceId),
  ],
)

export const budgetEvents = sqliteTable(
  'budget_events',
  {
    id: text('id').primaryKey(),
    employeeRunId: text('employee_run_id')
      .notNull()
      .references(() => employeeRuns.id, { onDelete: 'cascade' }),
    eventType: text('event_type', { enum: ['estimate', 'spend', 'warning', 'limit_reached'] }).notNull(),
    amountCents: integer('amount_cents').notNull().default(0),
    message: text('message').notNull(),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [index('idx_budget_events_run').on(t.employeeRunId)],
)

export const decisionAuditTrails = sqliteTable(
  'decision_audit_trails',
  {
    id: text('id').primaryKey(),
    employeeRunId: text('employee_run_id')
      .notNull()
      .references(() => employeeRuns.id, { onDelete: 'cascade' }),
    decisionType: text('decision_type').notNull(),
    inputHash: text('input_hash').notNull(),
    decision: text('decision').notNull(),
    rationale: text('rationale').notNull(),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [index('idx_decision_audit_run').on(t.employeeRunId)],
)

// ─── Conversation context summaries ────────────────────────────────────────
export const decisionRollbacks = sqliteTable(
  'decision_rollbacks',
  {
    id: text('id').primaryKey(),
    employeeRunId: text('employee_run_id')
      .notNull()
      .references(() => employeeRuns.id, { onDelete: 'cascade' }),
    agentProfileId: text('agent_profile_id').references(() => agentProfiles.id, {
      onDelete: 'set null',
    }),
    targetDecisionId: text('target_decision_id').references(() => decisionAuditTrails.id, {
      onDelete: 'set null',
    }),
    granularity: text('granularity').$type<DecisionRollbackGranularity>().notNull(),
    rollbackScope: text('rollback_scope', { mode: 'json' })
      .$type<DecisionRollbackScope>()
      .notNull()
      .default(sql`'{}'`),
    reasonType: text('reason_type').$type<DecisionRollbackReasonType>().notNull(),
    reasonDescription: text('reason_description').notNull(),
    reasonTimestamp: integer('reason_timestamp').notNull(),
    affectedDecisionIds: text('affected_decision_ids', { mode: 'json' })
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'`),
    affectedMemoryIds: text('affected_memory_ids', { mode: 'json' })
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'`),
    affectedPeerAgentIds: text('affected_peer_agent_ids', { mode: 'json' })
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'`),
    whatWasLost: text('what_was_lost', { mode: 'json' })
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'`),
    costOfRollbackCents: integer('cost_of_rollback_cents').notNull().default(0),
    rollbackHistory: text('rollback_history', { mode: 'json' })
      .$type<DecisionRollbackHistoryItem[]>()
      .notNull()
      .default(sql`'[]'`),
    restartPlan: text('restart_plan', { mode: 'json' })
      .$type<DecisionRollbackRestartPlan>()
      .notNull()
      .default(sql`'{}'`),
    status: text('status').$type<DecisionRollbackStatus>().notNull().default('planned'),
    createdAt: integer('created_at').notNull(),
    appliedAt: integer('applied_at'),
  },
  (t) => [
    index('idx_decision_rollbacks_run').on(t.employeeRunId, t.status),
    index('idx_decision_rollbacks_target').on(t.targetDecisionId),
    index('idx_decision_rollbacks_reason').on(t.reasonType, t.createdAt),
  ],
)

export const contextSummaries = sqliteTable(
  'conversation_context_summaries',
  {
    id: text('id').primaryKey(),
    conversationId: text('conversation_id')
      .notNull()
      .references(() => conversations.id, { onDelete: 'cascade' }),
    summary: text('summary').notNull(),
    coveredUntilMessageId: text('covered_until_message_id').notNull(),
    coveredUntilCreatedAt: integer('covered_until_created_at').notNull(),
    sourceMessageCount: integer('source_message_count').notNull(),
    tokenEstimate: integer('token_estimate').notNull(),
    modelProvider: text('model_provider').$type<ModelProvider>(),
    modelId: text('model_id'),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [index('idx_context_summaries_conv_created').on(t.conversationId, t.createdAt)],
)

// ─── AppSettings (全局 API key / endpoint) ──────────────────
/**
 * 全局应用设置。单行表（PK 固定 'singleton'），存用户在「设置」面板填写的
 * API key / base URL。优先级高于 process.env，让用户不必编辑 .env.local。
 *
 * 桌面版 Electron 模式下也是这张表（不引入 keychain / safeStorage 等额外存储）。
 */
export const appSettings = sqliteTable('app_settings', {
  id: text('id').primaryKey(),                      // 永远 = 'singleton'
  anthropicApiKey: text('anthropic_api_key'),       // ANTHROPIC_API_KEY 等价
  anthropicBaseUrl: text('anthropic_base_url'),     // 第三方网关（anyrouter 等）；非空时 anthropicApiKey 作 AUTH_TOKEN
  openaiApiKey: text('openai_api_key'),
  deepseekApiKey: text('deepseek_api_key'),
  arkApiKey: text('ark_api_key'),
  companionMode: text('companion_mode', { enum: ['off', 'lan', 'tailnet'] }).notNull().default('off'),
  mobileDeviceToken: text('mobile_device_token'),
  deploymentPublishEnabled: integer('deployment_publish_enabled', { mode: 'boolean' })
    .notNull()
    .default(false),
  deploymentPublishDir: text('deployment_publish_dir'),
  deploymentPublicBaseUrl: text('deployment_public_base_url'),
  updatedAt: integer('updated_at').notNull(),
})

export type AppSettingsRow = typeof appSettings.$inferSelect
export type AppSettingsInsert = typeof appSettings.$inferInsert

// ─── 类型导出（推断行类型）─────────────────────────────────
export type AgentRow = typeof agents.$inferSelect
export type AgentInsert = typeof agents.$inferInsert

export type ConversationRow = typeof conversations.$inferSelect
export type ConversationInsert = typeof conversations.$inferInsert

/**
 * Conversation 行 + 关联 workspace 的 mode / boundPath（前端需要在多处显示
 * 「本地工作目录」标识，每次 lazy fetch workspace 太啰嗦，listConversations
 * 一次 JOIN 出来）。
 */
export interface ConversationWithMeta extends ConversationRow {
  workspaceMode: 'sandbox' | 'local'
  workspaceBoundPath: string | null
}

export type MessageRow = typeof messages.$inferSelect
export type MessageInsert = typeof messages.$inferInsert

export type ArtifactRow = typeof artifacts.$inferSelect
export type ArtifactInsert = typeof artifacts.$inferInsert

export type ArtifactSemanticDiffRow = typeof artifactSemanticDiffs.$inferSelect
export type ArtifactSemanticDiffInsert = typeof artifactSemanticDiffs.$inferInsert

export type WorkspaceRow = typeof workspaces.$inferSelect
export type WorkspaceInsert = typeof workspaces.$inferInsert

export type AttachmentRow = typeof attachments.$inferSelect
export type AttachmentInsert = typeof attachments.$inferInsert

export type AgentRunRow = typeof agentRuns.$inferSelect
export type AgentRunInsert = typeof agentRuns.$inferInsert

export type ContextSummaryRow = typeof contextSummaries.$inferSelect
export type ContextSummaryInsert = typeof contextSummaries.$inferInsert

export type NetworkProfileRow = typeof networkProfiles.$inferSelect
export type NetworkProfileInsert = typeof networkProfiles.$inferInsert

export type ModelProfileRow = typeof modelProfiles.$inferSelect
export type ModelProfileInsert = typeof modelProfiles.$inferInsert

export type ModelConnectionTestRow = typeof modelConnectionTests.$inferSelect
export type ModelConnectionTestInsert = typeof modelConnectionTests.$inferInsert

export type ModelRouteDecisionRow = typeof modelRouteDecisions.$inferSelect
export type ModelRouteDecisionInsert = typeof modelRouteDecisions.$inferInsert

export type CliProfileRow = typeof cliProfiles.$inferSelect
export type CliProfileInsert = typeof cliProfiles.$inferInsert

export type CliRunRow = typeof cliRuns.$inferSelect
export type CliRunInsert = typeof cliRuns.$inferInsert

export type ToolConnectionRow = typeof toolConnections.$inferSelect
export type ToolConnectionInsert = typeof toolConnections.$inferInsert

export type McpServerRow = typeof mcpServers.$inferSelect
export type McpServerInsert = typeof mcpServers.$inferInsert

export type McpToolDefinitionRow = typeof mcpToolDefinitions.$inferSelect
export type McpToolDefinitionInsert = typeof mcpToolDefinitions.$inferInsert

export type ToolProtocolManifestRow = typeof toolProtocolManifests.$inferSelect
export type ToolProtocolManifestInsert = typeof toolProtocolManifests.$inferInsert

export type ToolProtocolInvocationRow = typeof toolProtocolInvocations.$inferSelect
export type ToolProtocolInvocationInsert = typeof toolProtocolInvocations.$inferInsert

export type ToolProtocolResultRow = typeof toolProtocolResults.$inferSelect
export type ToolProtocolResultInsert = typeof toolProtocolResults.$inferInsert

export type McpToolCallRow = typeof mcpToolCalls.$inferSelect
export type McpToolCallInsert = typeof mcpToolCalls.$inferInsert

export type PromptTemplateRow = typeof promptTemplates.$inferSelect
export type PromptTemplateInsert = typeof promptTemplates.$inferInsert

export type PromptTemplateVersionRow = typeof promptTemplateVersions.$inferSelect
export type PromptTemplateVersionInsert = typeof promptTemplateVersions.$inferInsert

export type ContextCompressorPolicyRow = typeof contextCompressorPolicies.$inferSelect
export type ContextCompressorPolicyInsert = typeof contextCompressorPolicies.$inferInsert

export type ContextCompressionPlanRow = typeof contextCompressionPlans.$inferSelect
export type ContextCompressionPlanInsert = typeof contextCompressionPlans.$inferInsert

export type PromptDriftMonitorRow = typeof promptDriftMonitors.$inferSelect
export type PromptDriftMonitorInsert = typeof promptDriftMonitors.$inferInsert

export type ModelBehaviorSnapshotRow = typeof modelBehaviorSnapshots.$inferSelect
export type ModelBehaviorSnapshotInsert = typeof modelBehaviorSnapshots.$inferInsert

export type PromptDriftRunRow = typeof promptDriftRuns.$inferSelect
export type PromptDriftRunInsert = typeof promptDriftRuns.$inferInsert

export type DualModelVerificationRow = typeof dualModelVerifications.$inferSelect
export type DualModelVerificationInsert = typeof dualModelVerifications.$inferInsert

export type AgentConsensusVoteRow = typeof agentConsensusVotes.$inferSelect
export type AgentConsensusVoteInsert = typeof agentConsensusVotes.$inferInsert

export type AdversarialReviewRow = typeof adversarialReviews.$inferSelect
export type AdversarialReviewInsert = typeof adversarialReviews.$inferInsert

export type ContentSafetyPolicyRow = typeof contentSafetyPolicies.$inferSelect
export type ContentSafetyPolicyInsert = typeof contentSafetyPolicies.$inferInsert

export type ContentSafetyScanRow = typeof contentSafetyScans.$inferSelect
export type ContentSafetyScanInsert = typeof contentSafetyScans.$inferInsert

export type CopyrightCheckRow = typeof copyrightChecks.$inferSelect
export type CopyrightCheckInsert = typeof copyrightChecks.$inferInsert

export type TrustCalibrationPolicyRow = typeof trustCalibrationPolicies.$inferSelect
export type TrustCalibrationPolicyInsert = typeof trustCalibrationPolicies.$inferInsert

export type TrustCalibrationEvaluationRow = typeof trustCalibrationEvaluations.$inferSelect
export type TrustCalibrationEvaluationInsert = typeof trustCalibrationEvaluations.$inferInsert

export type BudgetPolicyRow = typeof budgetPolicies.$inferSelect
export type BudgetPolicyInsert = typeof budgetPolicies.$inferInsert

export type BudgetEvaluationRow = typeof budgetEvaluations.$inferSelect
export type BudgetEvaluationInsert = typeof budgetEvaluations.$inferInsert

export type ConfigVersionRow = typeof configVersions.$inferSelect
export type ConfigVersionInsert = typeof configVersions.$inferInsert

export type ConfigExportRow = typeof configExports.$inferSelect
export type ConfigExportInsert = typeof configExports.$inferInsert

export type ConfigImpactAnalysisRow = typeof configImpactAnalyses.$inferSelect
export type ConfigImpactAnalysisInsert = typeof configImpactAnalyses.$inferInsert

export type OptimisticLockRow = typeof optimisticLocks.$inferSelect
export type OptimisticLockInsert = typeof optimisticLocks.$inferInsert

export type EditConflictRow = typeof editConflicts.$inferSelect
export type EditConflictInsert = typeof editConflicts.$inferInsert

export type ExportPackageRow = typeof exportPackages.$inferSelect
export type ExportPackageInsert = typeof exportPackages.$inferInsert

export type PackageImportCheckRow = typeof packageImportChecks.$inferSelect
export type PackageImportCheckInsert = typeof packageImportChecks.$inferInsert

export type SecretVaultRow = typeof secretVault.$inferSelect
export type SecretVaultInsert = typeof secretVault.$inferInsert

export type CredentialScopeRow = typeof credentialScopes.$inferSelect
export type CredentialScopeInsert = typeof credentialScopes.$inferInsert

export type SandboxPolicyRow = typeof sandboxPolicies.$inferSelect
export type SandboxPolicyInsert = typeof sandboxPolicies.$inferInsert

export type AuditLogRow = typeof auditLogs.$inferSelect
export type AuditLogInsert = typeof auditLogs.$inferInsert

export type SecurityFindingRow = typeof securityFindings.$inferSelect
export type SecurityFindingInsert = typeof securityFindings.$inferInsert

export type MetricPointRow = typeof metricPoints.$inferSelect
export type MetricPointInsert = typeof metricPoints.$inferInsert

export type ExternalMonitoringConfigRow = typeof externalMonitoringConfigs.$inferSelect
export type ExternalMonitoringConfigInsert = typeof externalMonitoringConfigs.$inferInsert

export type AlertRuleRow = typeof alertRules.$inferSelect
export type AlertRuleInsert = typeof alertRules.$inferInsert

export type AlertEventRow = typeof alertEvents.$inferSelect
export type AlertEventInsert = typeof alertEvents.$inferInsert

export type DebugReplaySnapshotRow = typeof debugReplaySnapshots.$inferSelect
export type DebugReplaySnapshotInsert = typeof debugReplaySnapshots.$inferInsert

export type AgentHealthScoreRow = typeof agentHealthScores.$inferSelect
export type AgentHealthScoreInsert = typeof agentHealthScores.$inferInsert

export type AgentReputationReviewRow = typeof agentReputationReviews.$inferSelect
export type AgentReputationReviewInsert = typeof agentReputationReviews.$inferInsert

export type AgentReputationSnapshotRow = typeof agentReputationSnapshots.$inferSelect
export type AgentReputationSnapshotInsert = typeof agentReputationSnapshots.$inferInsert

export type ProgrammaticApiKeyRow = typeof programmaticApiKeys.$inferSelect
export type ProgrammaticApiKeyInsert = typeof programmaticApiKeys.$inferInsert

export type SdkTaskRow = typeof sdkTasks.$inferSelect
export type SdkTaskInsert = typeof sdkTasks.$inferInsert

export type WebhookSubscriptionRow = typeof webhookSubscriptions.$inferSelect
export type WebhookSubscriptionInsert = typeof webhookSubscriptions.$inferInsert

export type WebhookDeliveryRow = typeof webhookDeliveries.$inferSelect
export type WebhookDeliveryInsert = typeof webhookDeliveries.$inferInsert

export type NotificationRow = typeof notifications.$inferSelect
export type NotificationInsert = typeof notifications.$inferInsert

export type NotificationPreferenceRow = typeof notificationPreferences.$inferSelect
export type NotificationPreferenceInsert = typeof notificationPreferences.$inferInsert

export type RetentionPolicyRow = typeof retentionPolicies.$inferSelect
export type RetentionPolicyInsert = typeof retentionPolicies.$inferInsert

export type StorageQuotaSnapshotRow = typeof storageQuotaSnapshots.$inferSelect
export type StorageQuotaSnapshotInsert = typeof storageQuotaSnapshots.$inferInsert

export type DataMaintenancePolicyRow = typeof dataMaintenancePolicies.$inferSelect
export type DataMaintenancePolicyInsert = typeof dataMaintenancePolicies.$inferInsert

export type DataMaintenanceRunRow = typeof dataMaintenanceRuns.$inferSelect
export type DataMaintenanceRunInsert = typeof dataMaintenanceRuns.$inferInsert

export type MemoryIntegrityPolicyRow = typeof memoryIntegrityPolicies.$inferSelect
export type MemoryIntegrityPolicyInsert = typeof memoryIntegrityPolicies.$inferInsert

export type MemoryIntegrityEvaluationRow = typeof memoryIntegrityEvaluations.$inferSelect
export type MemoryIntegrityEvaluationInsert = typeof memoryIntegrityEvaluations.$inferInsert

export type NfrRequirementRow = typeof nfrRequirements.$inferSelect
export type NfrRequirementInsert = typeof nfrRequirements.$inferInsert

export type NfrEvaluationRow = typeof nfrEvaluations.$inferSelect
export type NfrEvaluationInsert = typeof nfrEvaluations.$inferInsert

export type KnownLimitationRow = typeof knownLimitations.$inferSelect
export type KnownLimitationInsert = typeof knownLimitations.$inferInsert

export type LimitationAcknowledgementRow = typeof limitationAcknowledgements.$inferSelect
export type LimitationAcknowledgementInsert = typeof limitationAcknowledgements.$inferInsert

export type PiiMarkerRow = typeof piiMarkers.$inferSelect
export type PiiMarkerInsert = typeof piiMarkers.$inferInsert

export type DataExportManifestRow = typeof dataExportManifests.$inferSelect
export type DataExportManifestInsert = typeof dataExportManifests.$inferInsert

export type FeatureFlagRow = typeof featureFlags.$inferSelect
export type FeatureFlagInsert = typeof featureFlags.$inferInsert

export type FeatureFlagEvaluationRow = typeof featureFlagEvaluations.$inferSelect
export type FeatureFlagEvaluationInsert = typeof featureFlagEvaluations.$inferInsert

export type DegradationPolicyRow = typeof degradationPolicies.$inferSelect
export type DegradationPolicyInsert = typeof degradationPolicies.$inferInsert

export type DegradationEventRow = typeof degradationEvents.$inferSelect
export type DegradationEventInsert = typeof degradationEvents.$inferInsert

export type UpdatePolicyRow = typeof updatePolicies.$inferSelect
export type UpdatePolicyInsert = typeof updatePolicies.$inferInsert

export type MaintenanceWindowRow = typeof maintenanceWindows.$inferSelect
export type MaintenanceWindowInsert = typeof maintenanceWindows.$inferInsert

export type CustomMetricProfileRow = typeof customMetricProfiles.$inferSelect
export type CustomMetricProfileInsert = typeof customMetricProfiles.$inferInsert

export type CustomMetricEvaluationRow = typeof customMetricEvaluations.$inferSelect
export type CustomMetricEvaluationInsert = typeof customMetricEvaluations.$inferInsert

export type CapabilityIndexEntryRow = typeof capabilityIndexEntries.$inferSelect
export type CapabilityIndexEntryInsert = typeof capabilityIndexEntries.$inferInsert

export type KnowledgeGraphNodeRow = typeof knowledgeGraphNodes.$inferSelect
export type KnowledgeGraphNodeInsert = typeof knowledgeGraphNodes.$inferInsert

export type KnowledgeGraphEdgeRow = typeof knowledgeGraphEdges.$inferSelect
export type KnowledgeGraphEdgeInsert = typeof knowledgeGraphEdges.$inferInsert

export type CapabilityRecommendationRow = typeof capabilityRecommendations.$inferSelect
export type CapabilityRecommendationInsert = typeof capabilityRecommendations.$inferInsert

export type AutonomyDecisionRow = typeof autonomyDecisions.$inferSelect
export type AutonomyDecisionInsert = typeof autonomyDecisions.$inferInsert

export type DynamicPermissionGrantRow = typeof dynamicPermissionGrants.$inferSelect
export type DynamicPermissionGrantInsert = typeof dynamicPermissionGrants.$inferInsert

export type VoiceInterfaceProfileRow = typeof voiceInterfaceProfiles.$inferSelect
export type VoiceInterfaceProfileInsert = typeof voiceInterfaceProfiles.$inferInsert

export type VoiceConversationTurnRow = typeof voiceConversationTurns.$inferSelect
export type VoiceConversationTurnInsert = typeof voiceConversationTurns.$inferInsert

export type E2EEncryptionPolicyRow = typeof e2eEncryptionPolicies.$inferSelect
export type E2EEncryptionPolicyInsert = typeof e2eEncryptionPolicies.$inferInsert

export type E2EEncryptionCheckRow = typeof e2eEncryptionChecks.$inferSelect
export type E2EEncryptionCheckInsert = typeof e2eEncryptionChecks.$inferInsert

export type ConcurrencyProfileRow = typeof concurrencyProfiles.$inferSelect
export type ConcurrencyProfileInsert = typeof concurrencyProfiles.$inferInsert

export type ConcurrencyEvaluationRow = typeof concurrencyEvaluations.$inferSelect
export type ConcurrencyEvaluationInsert = typeof concurrencyEvaluations.$inferInsert

export type AbusePreventionPolicyRow = typeof abusePreventionPolicies.$inferSelect
export type AbusePreventionPolicyInsert = typeof abusePreventionPolicies.$inferInsert

export type AbuseDetectionEventRow = typeof abuseDetectionEvents.$inferSelect
export type AbuseDetectionEventInsert = typeof abuseDetectionEvents.$inferInsert

export type AbuseAppealRow = typeof abuseAppeals.$inferSelect
export type AbuseAppealInsert = typeof abuseAppeals.$inferInsert

export type FutureTechInterfaceRow = typeof futureTechInterfaces.$inferSelect
export type FutureTechInterfaceInsert = typeof futureTechInterfaces.$inferInsert

export type FutureTechRadarItemRow = typeof futureTechRadarItems.$inferSelect
export type FutureTechRadarItemInsert = typeof futureTechRadarItems.$inferInsert

export type CommercialPlanRow = typeof commercialPlans.$inferSelect
export type CommercialPlanInsert = typeof commercialPlans.$inferInsert

export type MonetizationRevenueStreamRow = typeof monetizationRevenueStreams.$inferSelect
export type MonetizationRevenueStreamInsert = typeof monetizationRevenueStreams.$inferInsert

export type CommercialPolicyRuleRow = typeof commercialPolicyRules.$inferSelect
export type CommercialPolicyRuleInsert = typeof commercialPolicyRules.$inferInsert

export type OpenSourceComponentRow = typeof openSourceComponents.$inferSelect
export type OpenSourceComponentInsert = typeof openSourceComponents.$inferInsert

export type CommunityGovernanceRoleRow = typeof communityGovernanceRoles.$inferSelect
export type CommunityGovernanceRoleInsert = typeof communityGovernanceRoles.$inferInsert

export type GovernanceRfcDecisionRow = typeof governanceRfcDecisions.$inferSelect
export type GovernanceRfcDecisionInsert = typeof governanceRfcDecisions.$inferInsert

export type ContributorPrerequisiteRow = typeof contributorPrerequisites.$inferSelect
export type ContributorPrerequisiteInsert = typeof contributorPrerequisites.$inferInsert

export type ContributionPolicyRow = typeof contributionPolicies.$inferSelect
export type ContributionPolicyInsert = typeof contributionPolicies.$inferInsert

export type ArchitecturePatternRow = typeof architecturePatterns.$inferSelect
export type ArchitecturePatternInsert = typeof architecturePatterns.$inferInsert

export type ArchitectureInterfaceRow = typeof architectureInterfaces.$inferSelect
export type ArchitectureInterfaceInsert = typeof architectureInterfaces.$inferInsert

export type TechnicalArchitectureEvaluationRow = typeof technicalArchitectureEvaluations.$inferSelect
export type TechnicalArchitectureEvaluationInsert = typeof technicalArchitectureEvaluations.$inferInsert

export type ErrorCodeCatalogRow = typeof errorCodeCatalog.$inferSelect
export type ErrorCodeCatalogInsert = typeof errorCodeCatalog.$inferInsert

export type EntityStateMachineRow = typeof entityStateMachines.$inferSelect
export type EntityStateMachineInsert = typeof entityStateMachines.$inferInsert

export type EntityStateTransitionRow = typeof entityStateTransitions.$inferSelect
export type EntityStateTransitionInsert = typeof entityStateTransitions.$inferInsert

export type PromptEngineeringGuideRow = typeof promptEngineeringGuides.$inferSelect
export type PromptEngineeringGuideInsert = typeof promptEngineeringGuides.$inferInsert

export type PromptAntiPatternRuleRow = typeof promptAntiPatternRules.$inferSelect
export type PromptAntiPatternRuleInsert = typeof promptAntiPatternRules.$inferInsert

export type SkillRow = typeof skills.$inferSelect
export type SkillInsert = typeof skills.$inferInsert

export type SkillInstallFlowRow = typeof skillInstallFlows.$inferSelect
export type SkillInstallFlowInsert = typeof skillInstallFlows.$inferInsert

export type SkillSdkManifestRow = typeof skillSdkManifests.$inferSelect
export type SkillSdkManifestInsert = typeof skillSdkManifests.$inferInsert

export type SkillMarketplacePublicationRow = typeof skillMarketplacePublications.$inferSelect
export type SkillMarketplacePublicationInsert = typeof skillMarketplacePublications.$inferInsert

export type PluginPackageRow = typeof pluginPackages.$inferSelect
export type PluginPackageInsert = typeof pluginPackages.$inferInsert

export type PluginLifecycleEventRow = typeof pluginLifecycleEvents.$inferSelect
export type PluginLifecycleEventInsert = typeof pluginLifecycleEvents.$inferInsert

export type TeamUserRow = typeof teamUsers.$inferSelect
export type TeamUserInsert = typeof teamUsers.$inferInsert

export type TeamRow = typeof teams.$inferSelect
export type TeamInsert = typeof teams.$inferInsert

export type TeamMembershipRow = typeof teamMemberships.$inferSelect
export type TeamMembershipInsert = typeof teamMemberships.$inferInsert

export type TeamResourceShareRow = typeof teamResourceShares.$inferSelect
export type TeamResourceShareInsert = typeof teamResourceShares.$inferInsert

export type TeamApprovalPolicyRow = typeof teamApprovalPolicies.$inferSelect
export type TeamApprovalPolicyInsert = typeof teamApprovalPolicies.$inferInsert

export type TeamApprovalDecisionRow = typeof teamApprovalDecisions.$inferSelect
export type TeamApprovalDecisionInsert = typeof teamApprovalDecisions.$inferInsert

export type AgentTemplatePackageRow = typeof agentTemplatePackages.$inferSelect
export type AgentTemplatePackageInsert = typeof agentTemplatePackages.$inferInsert

export type AgentTemplateInstallRow = typeof agentTemplateInstalls.$inferSelect
export type AgentTemplateInstallInsert = typeof agentTemplateInstalls.$inferInsert

export type TestStrategyItemRow = typeof testStrategyItems.$inferSelect
export type TestStrategyItemInsert = typeof testStrategyItems.$inferInsert

export type TestFixtureSpecRow = typeof testFixtureSpecs.$inferSelect
export type TestFixtureSpecInsert = typeof testFixtureSpecs.$inferInsert

export type TestFixtureGenerationRunRow = typeof testFixtureGenerationRuns.$inferSelect
export type TestFixtureGenerationRunInsert = typeof testFixtureGenerationRuns.$inferInsert

export type BenchmarkSuiteRow = typeof benchmarkSuites.$inferSelect
export type BenchmarkSuiteInsert = typeof benchmarkSuites.$inferInsert

export type BenchmarkCaseRow = typeof benchmarkCases.$inferSelect
export type BenchmarkCaseInsert = typeof benchmarkCases.$inferInsert

export type BenchmarkRunRow = typeof benchmarkRuns.$inferSelect
export type BenchmarkRunInsert = typeof benchmarkRuns.$inferInsert

export type BenchmarkCaseResultRow = typeof benchmarkCaseResults.$inferSelect
export type BenchmarkCaseResultInsert = typeof benchmarkCaseResults.$inferInsert

export type LocalizationSettingsRow = typeof localizationSettings.$inferSelect
export type LocalizationSettingsInsert = typeof localizationSettings.$inferInsert

export type LocalizationResourceRow = typeof localizationResources.$inferSelect
export type LocalizationResourceInsert = typeof localizationResources.$inferInsert

export type AgentLocalizationPolicyRow = typeof agentLocalizationPolicies.$inferSelect
export type AgentLocalizationPolicyInsert = typeof agentLocalizationPolicies.$inferInsert

export type I18nContractCheckRow = typeof i18nContractChecks.$inferSelect
export type I18nContractCheckInsert = typeof i18nContractChecks.$inferInsert

export type ArchitectureEvolutionReservationRow = typeof architectureEvolutionReservations.$inferSelect
export type ArchitectureEvolutionReservationInsert = typeof architectureEvolutionReservations.$inferInsert

export type ThemeProfileRow = typeof themeProfiles.$inferSelect
export type ThemeProfileInsert = typeof themeProfiles.$inferInsert

export type KeyboardShortcutRow = typeof keyboardShortcuts.$inferSelect
export type KeyboardShortcutInsert = typeof keyboardShortcuts.$inferInsert

export type AccessibilityProfileRow = typeof accessibilityProfiles.$inferSelect
export type AccessibilityProfileInsert = typeof accessibilityProfiles.$inferInsert

export type ReasonixFileFormatSpecRow = typeof reasonixFileFormatSpecs.$inferSelect
export type ReasonixFileFormatSpecInsert = typeof reasonixFileFormatSpecs.$inferInsert

export type ReasonixFileValidationRow = typeof reasonixFileValidations.$inferSelect
export type ReasonixFileValidationInsert = typeof reasonixFileValidations.$inferInsert

export type MigrationWizardSessionRow = typeof migrationWizardSessions.$inferSelect
export type MigrationWizardSessionInsert = typeof migrationWizardSessions.$inferInsert

export type MigrationImportRecordRow = typeof migrationImportRecords.$inferSelect
export type MigrationImportRecordInsert = typeof migrationImportRecords.$inferInsert

export type PerformanceAnalysisRunRow = typeof performanceAnalysisRuns.$inferSelect
export type PerformanceAnalysisRunInsert = typeof performanceAnalysisRuns.$inferInsert

export type PerformanceOptimizationRecommendationRow = typeof performanceOptimizationRecommendations.$inferSelect
export type PerformanceOptimizationRecommendationInsert =
  typeof performanceOptimizationRecommendations.$inferInsert

export type SecurityAuditChecklistItemRow = typeof securityAuditChecklistItems.$inferSelect
export type SecurityAuditChecklistItemInsert = typeof securityAuditChecklistItems.$inferInsert

export type SecurityAuditRunRow = typeof securityAuditRuns.$inferSelect
export type SecurityAuditRunInsert = typeof securityAuditRuns.$inferInsert

export type SecurityAuditRunItemRow = typeof securityAuditRunItems.$inferSelect
export type SecurityAuditRunItemInsert = typeof securityAuditRunItems.$inferInsert

export type IncidentResponsePlanRow = typeof incidentResponsePlans.$inferSelect
export type IncidentResponsePlanInsert = typeof incidentResponsePlans.$inferInsert

export type IncidentReportRow = typeof incidentReports.$inferSelect
export type IncidentReportInsert = typeof incidentReports.$inferInsert

export type IncidentResponseActionRow = typeof incidentResponseActions.$inferSelect
export type IncidentResponseActionInsert = typeof incidentResponseActions.$inferInsert

export type CapacityPlanningProfileRow = typeof capacityPlanningProfiles.$inferSelect
export type CapacityPlanningProfileInsert = typeof capacityPlanningProfiles.$inferInsert

export type CapacityPlanningEvaluationRow = typeof capacityPlanningEvaluations.$inferSelect
export type CapacityPlanningEvaluationInsert = typeof capacityPlanningEvaluations.$inferInsert

export type DeprecationPolicyStageRow = typeof deprecationPolicyStages.$inferSelect
export type DeprecationPolicyStageInsert = typeof deprecationPolicyStages.$inferInsert

export type FeatureDeprecationRow = typeof featureDeprecations.$inferSelect
export type FeatureDeprecationInsert = typeof featureDeprecations.$inferInsert

export type DeprecationMigrationRunRow = typeof deprecationMigrationRuns.$inferSelect
export type DeprecationMigrationRunInsert = typeof deprecationMigrationRuns.$inferInsert

export type DocumentationSectionRow = typeof documentationSections.$inferSelect
export type DocumentationSectionInsert = typeof documentationSections.$inferInsert

export type DocumentationPageRow = typeof documentationPages.$inferSelect
export type DocumentationPageInsert = typeof documentationPages.$inferInsert

export type HelpCenterSurfaceRow = typeof helpCenterSurfaces.$inferSelect
export type HelpCenterSurfaceInsert = typeof helpCenterSurfaces.$inferInsert

export type HelpCenterItemRow = typeof helpCenterItems.$inferSelect
export type HelpCenterItemInsert = typeof helpCenterItems.$inferInsert

export type HelpOnboardingFlowRow = typeof helpOnboardingFlows.$inferSelect
export type HelpOnboardingFlowInsert = typeof helpOnboardingFlows.$inferInsert

export type GlossaryTermRow = typeof glossaryTerms.$inferSelect
export type GlossaryTermInsert = typeof glossaryTerms.$inferInsert

export type FaqEntryRow = typeof faqEntries.$inferSelect
export type FaqEntryInsert = typeof faqEntries.$inferInsert

export type TroubleshootingEntryRow = typeof troubleshootingEntries.$inferSelect
export type TroubleshootingEntryInsert = typeof troubleshootingEntries.$inferInsert

export type QuickReferenceItemRow = typeof quickReferenceItems.$inferSelect
export type QuickReferenceItemInsert = typeof quickReferenceItems.$inferInsert

export type NonGoalPolicyRow = typeof nonGoalPolicies.$inferSelect
export type NonGoalPolicyInsert = typeof nonGoalPolicies.$inferInsert

export type BrandCandidateRow = typeof brandCandidates.$inferSelect
export type BrandCandidateInsert = typeof brandCandidates.$inferInsert

export type BrandGuidelineRow = typeof brandGuidelines.$inferSelect
export type BrandGuidelineInsert = typeof brandGuidelines.$inferInsert

export type CompetitivePositioningReportRow = typeof competitivePositioningReports.$inferSelect
export type CompetitivePositioningReportInsert = typeof competitivePositioningReports.$inferInsert

export type EcosystemRoadmapPhaseRow = typeof ecosystemRoadmapPhases.$inferSelect
export type EcosystemRoadmapPhaseInsert = typeof ecosystemRoadmapPhases.$inferInsert

export type EthicalAlignmentPolicyRow = typeof ethicalAlignmentPolicies.$inferSelect
export type EthicalAlignmentPolicyInsert = typeof ethicalAlignmentPolicies.$inferInsert

export type EthicalAlignmentEvaluationRow = typeof ethicalAlignmentEvaluations.$inferSelect
export type EthicalAlignmentEvaluationInsert = typeof ethicalAlignmentEvaluations.$inferInsert

export type LegalComplianceFrameworkRow = typeof legalComplianceFrameworks.$inferSelect
export type LegalComplianceFrameworkInsert = typeof legalComplianceFrameworks.$inferInsert

export type LegalDisclaimerNoticeRow = typeof legalDisclaimerNotices.$inferSelect
export type LegalDisclaimerNoticeInsert = typeof legalDisclaimerNotices.$inferInsert

export type LicenseComplianceCheckRow = typeof licenseComplianceChecks.$inferSelect
export type LicenseComplianceCheckInsert = typeof licenseComplianceChecks.$inferInsert

export type EmotionalUxGuidelineRow = typeof emotionalUxGuidelines.$inferSelect
export type EmotionalUxGuidelineInsert = typeof emotionalUxGuidelines.$inferInsert

export type SystemBootstrapCheckRow = typeof systemBootstrapChecks.$inferSelect
export type SystemBootstrapCheckInsert = typeof systemBootstrapChecks.$inferInsert

export type SuccessMetricDefinitionRow = typeof successMetricDefinitions.$inferSelect
export type SuccessMetricDefinitionInsert = typeof successMetricDefinitions.$inferInsert

export type SuccessMetricSnapshotRow = typeof successMetricSnapshots.$inferSelect
export type SuccessMetricSnapshotInsert = typeof successMetricSnapshots.$inferInsert

export type ReadinessChecklistItemRow = typeof readinessChecklistItems.$inferSelect
export type ReadinessChecklistItemInsert = typeof readinessChecklistItems.$inferInsert

export type SoftwareProfileRow = typeof softwareProfiles.$inferSelect
export type SoftwareProfileInsert = typeof softwareProfiles.$inferInsert

export type SoftwareCommandRow = typeof softwareCommands.$inferSelect
export type SoftwareCommandInsert = typeof softwareCommands.$inferInsert

export type SoftwareCommandRunRow = typeof softwareCommandRuns.$inferSelect
export type SoftwareCommandRunInsert = typeof softwareCommandRuns.$inferInsert

export type RecordedMacroRow = typeof recordedMacros.$inferSelect
export type RecordedMacroInsert = typeof recordedMacros.$inferInsert

export type MacroReplayRunRow = typeof macroReplayRuns.$inferSelect
export type MacroReplayRunInsert = typeof macroReplayRuns.$inferInsert

export type AgentProfileRow = typeof agentProfiles.$inferSelect
export type AgentProfileInsert = typeof agentProfiles.$inferInsert

export type AgentCloneRecordRow = typeof agentCloneRecords.$inferSelect
export type AgentCloneRecordInsert = typeof agentCloneRecords.$inferInsert

export type AgentComparisonReportRow = typeof agentComparisonReports.$inferSelect
export type AgentComparisonReportInsert = typeof agentComparisonReports.$inferInsert

export type AgentWhatIfAnalysisRow = typeof agentWhatIfAnalyses.$inferSelect
export type AgentWhatIfAnalysisInsert = typeof agentWhatIfAnalyses.$inferInsert

export type AgentScheduleRow = typeof agentSchedules.$inferSelect
export type AgentScheduleInsert = typeof agentSchedules.$inferInsert

export type AgentCertificationExamRow = typeof agentCertificationExams.$inferSelect
export type AgentCertificationExamInsert = typeof agentCertificationExams.$inferInsert

export type AgentCertificationRunRow = typeof agentCertificationRuns.$inferSelect
export type AgentCertificationRunInsert = typeof agentCertificationRuns.$inferInsert

export type StyleGuideRow = typeof styleGuides.$inferSelect
export type StyleGuideInsert = typeof styleGuides.$inferInsert

export type AgentStyleGuideBindingRow = typeof agentStyleGuideBindings.$inferSelect
export type AgentStyleGuideBindingInsert = typeof agentStyleGuideBindings.$inferInsert

export type AgentDiversityProfileRow = typeof agentDiversityProfiles.$inferSelect
export type AgentDiversityProfileInsert = typeof agentDiversityProfiles.$inferInsert

export type DiversityAnalysisRow = typeof diversityAnalyses.$inferSelect
export type DiversityAnalysisInsert = typeof diversityAnalyses.$inferInsert

export type AgentInterviewRow = typeof agentInterviews.$inferSelect
export type AgentInterviewInsert = typeof agentInterviews.$inferInsert

export type PerformanceReviewRow = typeof performanceReviews.$inferSelect
export type PerformanceReviewInsert = typeof performanceReviews.$inferInsert

export type AgentMentorshipRow = typeof agentMentorships.$inferSelect
export type AgentMentorshipInsert = typeof agentMentorships.$inferInsert

export type AgentMentoringEventRow = typeof agentMentoringEvents.$inferSelect
export type AgentMentoringEventInsert = typeof agentMentoringEvents.$inferInsert

export type UserOverrideRow = typeof userOverrides.$inferSelect
export type UserOverrideInsert = typeof userOverrides.$inferInsert

export type AgentWorkstationRow = typeof agentWorkstations.$inferSelect
export type AgentWorkstationInsert = typeof agentWorkstations.$inferInsert

export type ComputerSessionRow = typeof computerSessions.$inferSelect
export type ComputerSessionInsert = typeof computerSessions.$inferInsert

export type ComputerActionEventRow = typeof computerActionEvents.$inferSelect
export type ComputerActionEventInsert = typeof computerActionEvents.$inferInsert

export type BrowserSessionRow = typeof browserSessions.$inferSelect
export type BrowserSessionInsert = typeof browserSessions.$inferInsert

export type BrowserSessionEventRow = typeof browserSessionEvents.$inferSelect
export type BrowserSessionEventInsert = typeof browserSessionEvents.$inferInsert

export type MemoryItemRow = typeof memoryItems.$inferSelect
export type MemoryItemInsert = typeof memoryItems.$inferInsert

export type MemoryGraphViewRow = typeof memoryGraphViews.$inferSelect
export type MemoryGraphViewInsert = typeof memoryGraphViews.$inferInsert

export type MemoryDecaySnapshotRow = typeof memoryDecaySnapshots.$inferSelect
export type MemoryDecaySnapshotInsert = typeof memoryDecaySnapshots.$inferInsert

export type RunReflectionRow = typeof runReflections.$inferSelect
export type RunReflectionInsert = typeof runReflections.$inferInsert

export type AgentDiaryEntryRow = typeof agentDiaryEntries.$inferSelect
export type AgentDiaryEntryInsert = typeof agentDiaryEntries.$inferInsert

export type ContinuationPlanRow = typeof continuationPlans.$inferSelect
export type ContinuationPlanInsert = typeof continuationPlans.$inferInsert

export type AgentRetirementPlanRow = typeof agentRetirementPlans.$inferSelect
export type AgentRetirementPlanInsert = typeof agentRetirementPlans.$inferInsert

export type KnowledgeTransferPackageRow = typeof knowledgeTransferPackages.$inferSelect
export type KnowledgeTransferPackageInsert = typeof knowledgeTransferPackages.$inferInsert

export type OrganizationalKnowledgeItemRow = typeof organizationalKnowledgeItems.$inferSelect
export type OrganizationalKnowledgeItemInsert = typeof organizationalKnowledgeItems.$inferInsert

export type OrganizationalLearningReportRow = typeof organizationalLearningReports.$inferSelect
export type OrganizationalLearningReportInsert = typeof organizationalLearningReports.$inferInsert

export type MetaAgentProfileRow = typeof metaAgentProfiles.$inferSelect
export type MetaAgentProfileInsert = typeof metaAgentProfiles.$inferInsert

export type MetaAgentDigestRow = typeof metaAgentDigests.$inferSelect
export type MetaAgentDigestInsert = typeof metaAgentDigests.$inferInsert

export type MetaAgentRecommendationRow = typeof metaAgentRecommendations.$inferSelect
export type MetaAgentRecommendationInsert = typeof metaAgentRecommendations.$inferInsert

export type LearningEventRow = typeof learningEvents.$inferSelect
export type LearningEventInsert = typeof learningEvents.$inferInsert

export type PlaybookRow = typeof playbooks.$inferSelect
export type PlaybookInsert = typeof playbooks.$inferInsert

export type PlaybookVersionRow = typeof playbookVersions.$inferSelect
export type PlaybookVersionInsert = typeof playbookVersions.$inferInsert

export type WorkflowRow = typeof workflows.$inferSelect
export type WorkflowInsert = typeof workflows.$inferInsert

export type WorkflowNodeRow = typeof workflowNodes.$inferSelect
export type WorkflowNodeInsert = typeof workflowNodes.$inferInsert

export type WorkflowEdgeRow = typeof workflowEdges.$inferSelect
export type WorkflowEdgeInsert = typeof workflowEdges.$inferInsert

export type WorkflowRunRow = typeof workflowRuns.$inferSelect
export type WorkflowRunInsert = typeof workflowRuns.$inferInsert

export type WorkflowNodeRunRow = typeof workflowNodeRuns.$inferSelect
export type WorkflowNodeRunInsert = typeof workflowNodeRuns.$inferInsert

export type WorkflowPreflightRow = typeof workflowPreflights.$inferSelect
export type WorkflowPreflightInsert = typeof workflowPreflights.$inferInsert

export type SimulationRunRow = typeof simulationRuns.$inferSelect
export type SimulationRunInsert = typeof simulationRuns.$inferInsert

export type GoldenTaskSetRow = typeof goldenTaskSets.$inferSelect
export type GoldenTaskSetInsert = typeof goldenTaskSets.$inferInsert

export type BacktestRunRow = typeof backtestRuns.$inferSelect
export type BacktestRunInsert = typeof backtestRuns.$inferInsert

export type WorkflowOptimizationRow = typeof workflowOptimizations.$inferSelect
export type WorkflowOptimizationInsert = typeof workflowOptimizations.$inferInsert

export type NaturalLanguageWorkflowDraftRow = typeof naturalLanguageWorkflowDrafts.$inferSelect
export type NaturalLanguageWorkflowDraftInsert = typeof naturalLanguageWorkflowDrafts.$inferInsert

export type TaskTemplateRow = typeof taskTemplates.$inferSelect
export type TaskTemplateInsert = typeof taskTemplates.$inferInsert

export type TaskTemplateRunRow = typeof taskTemplateRuns.$inferSelect
export type TaskTemplateRunInsert = typeof taskTemplateRuns.$inferInsert

export type TaskQueueRow = typeof taskQueues.$inferSelect
export type TaskQueueInsert = typeof taskQueues.$inferInsert

export type TaskQueueItemRow = typeof taskQueueItems.$inferSelect
export type TaskQueueItemInsert = typeof taskQueueItems.$inferInsert

export type TaskBatchRow = typeof taskBatches.$inferSelect
export type TaskBatchInsert = typeof taskBatches.$inferInsert

export type WorkflowPartialRerunPlanRow = typeof workflowPartialRerunPlans.$inferSelect
export type WorkflowPartialRerunPlanInsert = typeof workflowPartialRerunPlans.$inferInsert

export type TaskMergeSuggestionRow = typeof taskMergeSuggestions.$inferSelect
export type TaskMergeSuggestionInsert = typeof taskMergeSuggestions.$inferInsert

export type WorkflowTemplateInstantiationRow = typeof workflowTemplateInstantiations.$inferSelect
export type WorkflowTemplateInstantiationInsert = typeof workflowTemplateInstantiations.$inferInsert

export type TaskScheduleRow = typeof taskSchedules.$inferSelect
export type TaskScheduleInsert = typeof taskSchedules.$inferInsert

export type AcceptanceScenarioRunRow = typeof acceptanceScenarioRuns.$inferSelect
export type AcceptanceScenarioRunInsert = typeof acceptanceScenarioRuns.$inferInsert

export type ResourceLockRow = typeof resourceLocks.$inferSelect
export type ResourceLockInsert = typeof resourceLocks.$inferInsert

export type OSInterferencePolicyRow = typeof osInterferencePolicies.$inferSelect
export type OSInterferencePolicyInsert = typeof osInterferencePolicies.$inferInsert

export type OSInterferenceEventRow = typeof osInterferenceEvents.$inferSelect
export type OSInterferenceEventInsert = typeof osInterferenceEvents.$inferInsert

export type FileSystemBoundaryPolicyRow = typeof fileSystemBoundaryPolicies.$inferSelect
export type FileSystemBoundaryPolicyInsert = typeof fileSystemBoundaryPolicies.$inferInsert

export type FileSystemBoundaryEvaluationRow = typeof fileSystemBoundaryEvaluations.$inferSelect
export type FileSystemBoundaryEvaluationInsert = typeof fileSystemBoundaryEvaluations.$inferInsert

export type BrowserAutomationTrapPolicyRow = typeof browserAutomationTrapPolicies.$inferSelect
export type BrowserAutomationTrapPolicyInsert = typeof browserAutomationTrapPolicies.$inferInsert

export type BrowserAutomationTrapEvaluationRow = typeof browserAutomationTrapEvaluations.$inferSelect
export type BrowserAutomationTrapEvaluationInsert = typeof browserAutomationTrapEvaluations.$inferInsert

export type EnterpriseNetworkPolicyRow = typeof enterpriseNetworkPolicies.$inferSelect
export type EnterpriseNetworkPolicyInsert = typeof enterpriseNetworkPolicies.$inferInsert

export type EnterpriseNetworkEvaluationRow = typeof enterpriseNetworkEvaluations.$inferSelect
export type EnterpriseNetworkEvaluationInsert = typeof enterpriseNetworkEvaluations.$inferInsert

export type OutputConsistencyPolicyRow = typeof outputConsistencyPolicies.$inferSelect
export type OutputConsistencyPolicyInsert = typeof outputConsistencyPolicies.$inferInsert

export type OutputConsistencyEvaluationRow = typeof outputConsistencyEvaluations.$inferSelect
export type OutputConsistencyEvaluationInsert = typeof outputConsistencyEvaluations.$inferInsert

export type ResourceGovernorPolicyRow = typeof resourceGovernorPolicies.$inferSelect
export type ResourceGovernorPolicyInsert = typeof resourceGovernorPolicies.$inferInsert

export type ResourceGovernorEvaluationRow = typeof resourceGovernorEvaluations.$inferSelect
export type ResourceGovernorEvaluationInsert = typeof resourceGovernorEvaluations.$inferInsert

export type GlobalOSIntegrationPolicyRow = typeof globalOSIntegrationPolicies.$inferSelect
export type GlobalOSIntegrationPolicyInsert = typeof globalOSIntegrationPolicies.$inferInsert

export type GlobalOSIntegrationEvaluationRow = typeof globalOSIntegrationEvaluations.$inferSelect
export type GlobalOSIntegrationEvaluationInsert = typeof globalOSIntegrationEvaluations.$inferInsert

export type TelemetryPolicyRow = typeof telemetryPolicies.$inferSelect
export type TelemetryPolicyInsert = typeof telemetryPolicies.$inferInsert

export type TelemetryEventRow = typeof telemetryEvents.$inferSelect
export type TelemetryEventInsert = typeof telemetryEvents.$inferInsert

export type TelemetryExportManifestRow = typeof telemetryExportManifests.$inferSelect
export type TelemetryExportManifestInsert = typeof telemetryExportManifests.$inferInsert

export type ModelInvocationOptimizationPolicyRow =
  typeof modelInvocationOptimizationPolicies.$inferSelect
export type ModelInvocationOptimizationPolicyInsert =
  typeof modelInvocationOptimizationPolicies.$inferInsert

export type ModelResponseCacheEntryRow = typeof modelResponseCacheEntries.$inferSelect
export type ModelResponseCacheEntryInsert = typeof modelResponseCacheEntries.$inferInsert

export type ModelWarmupSessionRow = typeof modelWarmupSessions.$inferSelect
export type ModelWarmupSessionInsert = typeof modelWarmupSessions.$inferInsert

export type ModelInvocationOptimizationEventRow =
  typeof modelInvocationOptimizationEvents.$inferSelect
export type ModelInvocationOptimizationEventInsert =
  typeof modelInvocationOptimizationEvents.$inferInsert

export type RuntimeMicroOperationPolicyRow = typeof runtimeMicroOperationPolicies.$inferSelect
export type RuntimeMicroOperationPolicyInsert = typeof runtimeMicroOperationPolicies.$inferInsert

export type RuntimeMicroOperationDecisionRow = typeof runtimeMicroOperationDecisions.$inferSelect
export type RuntimeMicroOperationDecisionInsert = typeof runtimeMicroOperationDecisions.$inferInsert

export type ScheduledActionRow = typeof scheduledActions.$inferSelect
export type ScheduledActionInsert = typeof scheduledActions.$inferInsert

export type AgentInboxItemRow = typeof agentInboxItems.$inferSelect
export type AgentInboxItemInsert = typeof agentInboxItems.$inferInsert

export type ApprovalRequestRow = typeof approvalRequests.$inferSelect
export type ApprovalRequestInsert = typeof approvalRequests.$inferInsert

export type HumanApprovalPolicyRow = typeof humanApprovalPolicies.$inferSelect
export type HumanApprovalPolicyInsert = typeof humanApprovalPolicies.$inferInsert

export type PlanApprovalResultRow = typeof planApprovalResults.$inferSelect
export type PlanApprovalResultInsert = typeof planApprovalResults.$inferInsert

export type TakeoverSessionRow = typeof takeoverSessions.$inferSelect
export type TakeoverSessionInsert = typeof takeoverSessions.$inferInsert

export type AgentProbationRecordRow = typeof agentProbationRecords.$inferSelect
export type AgentProbationRecordInsert = typeof agentProbationRecords.$inferInsert

export type AgentEnvironmentPromotionRow = typeof agentEnvironmentPromotions.$inferSelect
export type AgentEnvironmentPromotionInsert = typeof agentEnvironmentPromotions.$inferInsert

export type ArtifactValidationRow = typeof artifactValidations.$inferSelect
export type ArtifactValidationInsert = typeof artifactValidations.$inferInsert

export type EmployeeRunRow = typeof employeeRuns.$inferSelect
export type EmployeeRunInsert = typeof employeeRuns.$inferInsert

export type OnboardingSessionRow = typeof onboardingSessions.$inferSelect
export type OnboardingSessionInsert = typeof onboardingSessions.$inferInsert

export type MultimodalInputRow = typeof multimodalInputs.$inferSelect
export type MultimodalInputInsert = typeof multimodalInputs.$inferInsert

export type MultimodalOutputRow = typeof multimodalOutputs.$inferSelect
export type MultimodalOutputInsert = typeof multimodalOutputs.$inferInsert

export type EmployeeRunEventRow = typeof employeeRunEvents.$inferSelect
export type EmployeeRunEventInsert = typeof employeeRunEvents.$inferInsert

export type RuntimeContextSnapshotRow = typeof runtimeContextSnapshots.$inferSelect
export type RuntimeContextSnapshotInsert = typeof runtimeContextSnapshots.$inferInsert

export type ContextWindowVisualizationRow = typeof contextWindowVisualizations.$inferSelect
export type ContextWindowVisualizationInsert = typeof contextWindowVisualizations.$inferInsert

export type InterAgentMessageRow = typeof interAgentMessages.$inferSelect
export type InterAgentMessageInsert = typeof interAgentMessages.$inferInsert

export type AgentTeamDashboardSnapshotRow = typeof agentTeamDashboardSnapshots.$inferSelect
export type AgentTeamDashboardSnapshotInsert = typeof agentTeamDashboardSnapshots.$inferInsert

export type AgentTeamDashboardCommandRow = typeof agentTeamDashboardCommands.$inferSelect
export type AgentTeamDashboardCommandInsert = typeof agentTeamDashboardCommands.$inferInsert

export type CicdIntegrationRow = typeof cicdIntegrations.$inferSelect
export type CicdIntegrationInsert = typeof cicdIntegrations.$inferInsert

export type CicdRunRow = typeof cicdRuns.$inferSelect
export type CicdRunInsert = typeof cicdRuns.$inferInsert

export type CapabilityNegotiationRow = typeof capabilityNegotiations.$inferSelect
export type CapabilityNegotiationInsert = typeof capabilityNegotiations.$inferInsert

export type CapabilityNegotiationEventRow = typeof capabilityNegotiationEvents.$inferSelect
export type CapabilityNegotiationEventInsert = typeof capabilityNegotiationEvents.$inferInsert

export type AgentCommunicationProtocolRow = typeof agentCommunicationProtocols.$inferSelect
export type AgentCommunicationProtocolInsert = typeof agentCommunicationProtocols.$inferInsert

export type AgentProtocolMessageRow = typeof agentProtocolMessages.$inferSelect
export type AgentProtocolMessageInsert = typeof agentProtocolMessages.$inferInsert

export type StreamProtocolChannelRow = typeof streamProtocolChannels.$inferSelect
export type StreamProtocolChannelInsert = typeof streamProtocolChannels.$inferInsert

export type StreamProtocolEventRow = typeof streamProtocolEvents.$inferSelect
export type StreamProtocolEventInsert = typeof streamProtocolEvents.$inferInsert

export type StreamReplayCursorRow = typeof streamReplayCursors.$inferSelect
export type StreamReplayCursorInsert = typeof streamReplayCursors.$inferInsert

export type BlackboardEntryRow = typeof blackboardEntries.$inferSelect
export type BlackboardEntryInsert = typeof blackboardEntries.$inferInsert

export type ConflictResolutionRow = typeof conflictResolutions.$inferSelect
export type ConflictResolutionInsert = typeof conflictResolutions.$inferInsert
export type ConflictEscalationRow = typeof conflictEscalations.$inferSelect
export type ConflictEscalationInsert = typeof conflictEscalations.$inferInsert

export type RealtimeCollabSessionRow = typeof realtimeCollabSessions.$inferSelect
export type RealtimeCollabSessionInsert = typeof realtimeCollabSessions.$inferInsert

export type RealtimeSegmentLockRow = typeof realtimeSegmentLocks.$inferSelect
export type RealtimeSegmentLockInsert = typeof realtimeSegmentLocks.$inferInsert

export type RealtimeEditOperationRow = typeof realtimeEditOperations.$inferSelect
export type RealtimeEditOperationInsert = typeof realtimeEditOperations.$inferInsert

export type RuntimeCheckpointRow = typeof runtimeCheckpoints.$inferSelect
export type RuntimeCheckpointInsert = typeof runtimeCheckpoints.$inferInsert

export type RecoveryEventRow = typeof recoveryEvents.$inferSelect
export type RecoveryEventInsert = typeof recoveryEvents.$inferInsert

export type ErrorClassificationRow = typeof errorClassifications.$inferSelect
export type ErrorClassificationInsert = typeof errorClassifications.$inferInsert

export type RecoveryStrategyAttemptRow = typeof recoveryStrategyAttempts.$inferSelect
export type RecoveryStrategyAttemptInsert = typeof recoveryStrategyAttempts.$inferInsert

export type RecoveryStrategyStatsRow = typeof recoveryStrategyStats.$inferSelect
export type RecoveryStrategyStatsInsert = typeof recoveryStrategyStats.$inferInsert

export type IdempotencyRecordRow = typeof idempotencyRecords.$inferSelect
export type IdempotencyRecordInsert = typeof idempotencyRecords.$inferInsert

export type BudgetEventRow = typeof budgetEvents.$inferSelect
export type BudgetEventInsert = typeof budgetEvents.$inferInsert

export type DecisionAuditTrailRow = typeof decisionAuditTrails.$inferSelect
export type DecisionAuditTrailInsert = typeof decisionAuditTrails.$inferInsert

export type DecisionRollbackRow = typeof decisionRollbacks.$inferSelect
export type DecisionRollbackInsert = typeof decisionRollbacks.$inferInsert

export type OAuthCredentialRow = typeof oauthCredentials.$inferSelect
export type OAuthCredentialInsert = typeof oauthCredentials.$inferInsert
export type OAuthRefreshEventRow = typeof oauthRefreshEvents.$inferSelect
export type OAuthRefreshEventInsert = typeof oauthRefreshEvents.$inferInsert

export type WorkspaceTemplateRow = typeof workspaceTemplates.$inferSelect
export type WorkspaceTemplateInsert = typeof workspaceTemplates.$inferInsert
export type WorkspaceInitRunRow = typeof workspaceInitRuns.$inferSelect
export type WorkspaceInitRunInsert = typeof workspaceInitRuns.$inferInsert

export type CustomModelRow = typeof customModels.$inferSelect
export type CustomModelInsert = typeof customModels.$inferInsert
export type FinetuneDatasetExportRow = typeof finetuneDatasetExports.$inferSelect
export type FinetuneDatasetExportInsert = typeof finetuneDatasetExports.$inferInsert

export type ProjectContextRow = typeof projectContexts.$inferSelect
export type ProjectContextInsert = typeof projectContexts.$inferInsert
export type ProjectAgentRoleRow = typeof projectAgentRoles.$inferSelect
export type ProjectAgentRoleInsert = typeof projectAgentRoles.$inferInsert
export type ProjectSwitchEventRow = typeof projectSwitchEvents.$inferSelect
export type ProjectSwitchEventInsert = typeof projectSwitchEvents.$inferInsert

export type BehaviorSnapshotRow = typeof behaviorSnapshots.$inferSelect
export type BehaviorSnapshotInsert = typeof behaviorSnapshots.$inferInsert
export type BehaviorDriftAnalysisRow = typeof behaviorDriftAnalyses.$inferSelect
export type BehaviorDriftAnalysisInsert = typeof behaviorDriftAnalyses.$inferInsert
export type BehaviorStabilizationRunRow = typeof behaviorStabilizationRuns.$inferSelect
export type BehaviorStabilizationRunInsert = typeof behaviorStabilizationRuns.$inferInsert

export type SkillSynthesisRecordRow = typeof skillSynthesisRecords.$inferSelect
export type SkillSynthesisRecordInsert = typeof skillSynthesisRecords.$inferInsert
export type ToolPipelineRow = typeof toolPipelines.$inferSelect
export type ToolPipelineInsert = typeof toolPipelines.$inferInsert

export type UnifiedSearchIndexRow = typeof unifiedSearchIndex.$inferSelect
export type UnifiedSearchIndexInsert = typeof unifiedSearchIndex.$inferInsert
export type ContextCacheRow = typeof contextCaches.$inferSelect
export type ContextCacheInsert = typeof contextCaches.$inferInsert
