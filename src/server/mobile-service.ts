import { and, desc, eq, inArray } from 'drizzle-orm'

import { db, schema } from '@/db/client'
import type {
  AgentRunRow,
  ApprovalRequestRow,
  ConversationWithMeta,
  EmployeeRunRow,
  JsonObject,
  MultimodalInputKind,
  MultimodalInputRow,
} from '@/db/schema'
import { listAgentsOrdered } from '@/server/agent-service'
import {
  editAndResendLatestUserMessage,
  listConversations,
  listMessages,
  regenerateLatestResponse,
  sendMessage,
  withdrawLatestUserMessage,
} from '@/server/conversation-service'
import { pendingQuestions } from '@/server/pending-questions'
import { pendingWrites } from '@/server/pending-writes'
import { registerMultimodalInput } from '@/server/multimodal-io-service'
import {
  MOBILE_APP_ALLOWLIST_ENV,
  MOBILE_DEVICE_ALLOWLIST_ENV,
  RUNTIME_CONTROL_KILL_SWITCH_ENV,
} from '@/server/runtime-control-service'
import { getAppSettings } from '@/server/settings-service'
import type {
  ArtifactContent,
  ArtifactType,
  DeployCandidateRecord,
  MessagePart,
  PendingQuestion,
  PendingWrite,
} from '@/shared/types'

import packageJson from '../../package.json'

const MOBILE_UPLOAD_SOURCE = 'mobile_companion_upload'

export type MobileCompanionReadiness = 'ready' | 'needs_configuration' | 'empty'

export interface MobileConversationSummary {
  id: string
  title: string
  mode: 'single' | 'group'
  updatedAt: number
  runningRunCount: number
  pendingWriteCount: number
  pendingQuestionCount: number
}

export interface MobileAgent {
  id: string
  name: string
  avatar: string
  description: string
  isOrchestrator: boolean
}

export interface MobileRun {
  id: string
  conversationId: string
  agentId: string
  status: 'queued' | 'running' | 'complete' | 'failed' | 'aborted'
  startedAt: number
}

export interface MobileEmployeeRun {
  id: string
  agentProfileId: string
  workflowRunId: string | null
  goal: string
  status: EmployeeRunRow['status']
  currentPhase: string
  currentStep: string | null
  updatedAt: number
  finishedAt: number | null
}

export interface MobileApprovalRequest {
  id: string
  agentProfileId: string | null
  type: string
  title: string
  description: string
  riskLevel: ApprovalRequestRow['riskLevel']
  payload: JsonObject
  createdAt: number
}

export interface MobileUploadSummary {
  id: string
  employeeRunId: string | null
  agentProfileId: string | null
  kind: MultimodalInputKind
  mimeType: string | null
  dataRef: string | null
  description: string | null
  fileName: string | null
  sizeBytes: number | null
  status: MultimodalInputRow['status']
  createdAt: number
}

export interface RegisterMobileUploadArgs {
  employeeRunId?: string | null
  agentProfileId?: string | null
  kind: Extract<MultimodalInputKind, 'text' | 'image' | 'screenshot' | 'audio' | 'structured'>
  mimeType?: string | null
  dataRef: string
  description?: string | null
  fileName?: string | null
  sizeBytes?: number | null
  metadata?: JsonObject
}

export interface MobileCompanionReport {
  readiness: MobileCompanionReadiness
  readinessScore: number
  companion: {
    mode: 'off' | 'lan' | 'tailnet'
    version: string
    tokenConfigured: boolean
    authRequired: boolean
    corsOrigins: string[]
  }
  endpointContract: Array<{
    method: 'GET' | 'POST'
    path: string
    purpose: string
    requiresAuth: boolean
  }>
  v1Capabilities: Array<{
    key: string
    label: string
    status: 'implemented' | 'needs_configuration'
    evidence: string[]
  }>
  v2DeviceAutomationReservations: Array<{
    key: string
    label: string
    status: 'guarded_available' | 'needs_configuration' | 'reserved_not_enabled'
    reason: string
    runtimeActions: string[]
    requiredEnvVars: string[]
    requiredAllowlists: Array<{
      envVar: string
      configured: boolean
      purpose: string
    }>
    safetyGates: string[]
    evidence: string[]
  }>
  snapshotSummary: {
    conversations: number
    agents: number
    activeChatRuns: number
    employeeRuns: number
    approvalRequests: number
    pendingWrites: number
    pendingQuestions: number
    recentUploads: number
  }
  recentUploads: MobileUploadSummary[]
  gaps: string[]
  warnings: string[]
  recommendations: string[]
  generatedAt: number
}

export type MobileMessagePart =
  | { type: 'text'; content: string }
  | { type: 'code'; language: string; content: string }
  | { type: 'thinking'; content: string }
  | { type: 'tool_use'; callId: string; toolName: string }
  | { type: 'tool_result'; callId: string; isError: boolean }
  | { type: 'artifact_ref'; artifactId: string }
  | {
      type: 'deploy_status'
      title: string
      version: number
      sourceType?: 'artifact' | 'workspace'
      workspacePath?: string
      previewPath: string
      status: 'ready' | 'failed'
      error?: string
    }
  | { type: 'deploy_candidates'; candidates: DeployCandidateRecord[] }
  | { type: 'attachment'; fileName: string; kind: 'image' | 'file' }

export interface MobileArtifactSummary {
  id: string
  type: ArtifactType
  title: string
  version: number
  createdAt: number
}

export interface MobileArtifact extends MobileArtifactSummary {
  conversationId: string
  content: ArtifactContent
  parentArtifactId?: string
  createdByAgentId: string
}

export interface MobileMessage {
  id: string
  role: 'user' | 'agent' | 'system'
  agentId: string | null
  parts: MobileMessagePart[]
  status: 'streaming' | 'complete' | 'error' | 'aborted'
  createdAt: number
}

export interface MobileConversationDetail {
  conversation: {
    id: string
    title: string
    mode: 'single' | 'group'
    agentIds: string[]
    updatedAt: number
  }
  messages: MobileMessage[]
  artifacts: MobileArtifactSummary[]
  runningRuns: MobileRun[]
  pendingWrites: MobilePendingWrite[]
  pendingQuestions: MobilePendingQuestion[]
}

export interface MobilePendingWrite {
  id: string
  conversationId: string
  agentId: string
  runId: string
  path: string
  oldContent: string | null
  newContent: string
  createdAt: number
}

export interface MobilePendingQuestion {
  id: string
  conversationId: string
  agentId: string
  runId: string
  questions: Array<{
    question: string
    header: string
    options: Array<{ label: string; description?: string }>
    multiSelect?: boolean
  }>
  createdAt: number
}

export interface MobileSnapshot {
  conversations: MobileConversationSummary[]
  agents: MobileAgent[]
  runningRuns: MobileRun[]
  employeeRuns: MobileEmployeeRun[]
  approvalRequests: MobileApprovalRequest[]
  recentUploads: MobileUploadSummary[]
  pendingWrites: MobilePendingWrite[]
  pendingQuestions: MobilePendingQuestion[]
  server: {
    version: string
    companionMode: 'lan' | 'tailnet'
  }
}

export async function getMobileSnapshot(): Promise<MobileSnapshot> {
  const [conversations, agents, employeeRuns, approvalRequests, recentUploads] = await Promise.all([
    listConversations(),
    listAgentsOrdered(),
    listMobileEmployeeRuns(),
    listPendingApprovalRequests(),
    listRecentMobileUploads(),
  ])

  const runningRuns = await listActiveRuns(conversations.map((conversation) => conversation.id))
  const pendingWritesByConversation = collectPendingWrites(conversations)
  const pendingQuestionsByConversation = collectPendingQuestions(conversations)

  return {
    conversations: conversations.map((conversation) =>
      toMobileConversation(
        conversation,
        runningRuns,
        pendingWritesByConversation.get(conversation.id) ?? [],
        pendingQuestionsByConversation.get(conversation.id) ?? [],
      ),
    ),
    agents: agents.map((agent) => ({
      id: agent.id,
      name: agent.name,
      avatar: agent.avatar,
      description: agent.description,
      isOrchestrator: agent.isOrchestrator,
    })),
    runningRuns: runningRuns.map(toMobileRun),
    employeeRuns: employeeRuns.map(toMobileEmployeeRun),
    approvalRequests: approvalRequests.map(toMobileApprovalRequest),
    recentUploads,
    pendingWrites: Array.from(pendingWritesByConversation.values())
      .flat()
      .map(toMobilePendingWrite),
    pendingQuestions: Array.from(pendingQuestionsByConversation.values())
      .flat()
      .map(toMobilePendingQuestion),
    server: {
      version: packageJson.version,
      companionMode: process.env.AGENTHUB_COMPANION_MODE === 'tailnet' ? 'tailnet' : 'lan',
    },
  }
}

export async function getMobileCompanionReport(): Promise<MobileCompanionReport> {
  const [settings, snapshot] = await Promise.all([getAppSettings(), getMobileSnapshot()])
  const mode = resolveCompanionMode(settings.companionMode)
  const tokenConfigured = Boolean(
    settings.mobileDeviceToken ||
      process.env.AGENTHUB_MOBILE_TOKEN?.trim() ||
      process.env.AGENTHUB_MOBILE_DEV_TOKEN?.trim(),
  )
  const companion = {
    mode,
    version: packageJson.version,
    tokenConfigured,
    authRequired: true,
    corsOrigins: resolveAllowedMobileOrigins(),
  }
  const endpointContract = buildMobileEndpointContract()
  const snapshotSummary = {
    conversations: snapshot.conversations.length,
    agents: snapshot.agents.length,
    activeChatRuns: snapshot.runningRuns.length,
    employeeRuns: snapshot.employeeRuns.length,
    approvalRequests: snapshot.approvalRequests.length,
    pendingWrites: snapshot.pendingWrites.length,
    pendingQuestions: snapshot.pendingQuestions.length,
    recentUploads: snapshot.recentUploads.length,
  }
  const v1Capabilities = buildV1Capabilities({ tokenConfigured })
  const gaps = buildMobileGaps({ companion, endpointContract })
  const warnings = buildMobileWarnings({ companion, snapshotSummary })
  const readiness = resolveMobileReadiness({ tokenConfigured, mode, snapshotSummary, gaps })
  return {
    readiness,
    readinessScore: scoreMobileReadiness(readiness, gaps, warnings, snapshotSummary),
    companion,
    endpointContract,
    v1Capabilities,
    v2DeviceAutomationReservations: buildV2DeviceAutomationReservations(),
    snapshotSummary,
    recentUploads: snapshot.recentUploads,
    gaps,
    warnings,
    recommendations: buildMobileRecommendations({ readiness, companion, snapshotSummary }),
    generatedAt: Date.now(),
  }
}

export async function registerMobileUpload(args: RegisterMobileUploadArgs): Promise<MobileUploadSummary> {
  const input = await registerMultimodalInput({
    employeeRunId: args.employeeRunId,
    agentProfileId: args.agentProfileId,
    kind: args.kind,
    mimeType: args.mimeType,
    source: MOBILE_UPLOAD_SOURCE,
    dataRef: args.dataRef,
    description: args.description,
    metadata: {
      ...(args.metadata ?? {}),
      client: 'mobile_companion',
      fileName: args.fileName ?? null,
      sizeBytes: args.sizeBytes ?? null,
      uploadedAt: Date.now(),
    },
  })
  return toMobileUploadSummary(input)
}

export async function getMobileConversationDetail(
  conversationId: string,
): Promise<MobileConversationDetail> {
  const conversations = await listConversations()
  const conversation = conversations.find((item) => item.id === conversationId)
  if (!conversation) throw new Error(`Conversation not found: ${conversationId}`)

  const [messages, runningRuns] = await Promise.all([
    listMessages(conversationId),
    listActiveRuns([conversationId]),
  ])
  const artifacts = await listMobileArtifactSummaries(extractArtifactIds(messages.flatMap((message) => message.parts)))
  const writes = pendingWrites.listByConversation(conversationId)
  const questions = pendingQuestions.listByConversation(conversationId)

  return {
    conversation: {
      id: conversation.id,
      title: conversation.title,
      mode: conversation.mode,
      agentIds: conversation.agentIds,
      updatedAt: conversation.updatedAt,
    },
    messages: messages.map((message) => ({
      id: message.id,
      role: message.role,
      agentId: message.agentId,
      parts: message.parts.map(toMobileMessagePart),
      status: message.status,
      createdAt: message.createdAt,
    })),
    artifacts,
    runningRuns: runningRuns.map(toMobileRun),
    pendingWrites: writes.map(toMobilePendingWrite),
    pendingQuestions: questions.map(toMobilePendingQuestion),
  }
}

export async function getMobileArtifact(artifactId: string): Promise<MobileArtifact> {
  const artifact = await db.query.artifacts.findFirst({
    where: eq(schema.artifacts.id, artifactId),
  })
  if (!artifact) throw new Error(`Artifact not found: ${artifactId}`)

  return {
    id: artifact.id,
    conversationId: artifact.conversationId,
    type: artifact.type,
    title: artifact.title,
    content: artifact.content as ArtifactContent,
    version: artifact.version,
    parentArtifactId: artifact.parentArtifactId ?? undefined,
    createdByAgentId: artifact.createdByAgentId,
    createdAt: artifact.createdAt,
  }
}

export async function sendMobileMessage(args: {
  conversationId: string
  content: string
}): Promise<{ messageId: string; runIds: string[] }> {
  return sendMessage({
    conversationId: args.conversationId,
    content: args.content,
  })
}

// 撤回 / 编辑 / 重新生成：复用桌面的服务函数（仅作用于最新可操作消息）。删除会经
// message.removed 广播给其它客户端；移动端自身靠操作后 refetch 收敛。
export async function withdrawMobileMessage(args: { conversationId: string; messageId: string }) {
  return withdrawLatestUserMessage(args.conversationId, args.messageId)
}

export async function editMobileMessage(args: {
  conversationId: string
  messageId: string
  content: string
}) {
  return editAndResendLatestUserMessage(args.conversationId, args.messageId, args.content)
}

export async function regenerateMobileResponse(args: { conversationId: string }) {
  return regenerateLatestResponse(args.conversationId)
}

async function listActiveRuns(conversationIds: string[]): Promise<AgentRunRow[]> {
  if (conversationIds.length === 0) return []
  return db.query.agentRuns.findMany({
    where: and(
      inArray(schema.agentRuns.conversationId, conversationIds),
      inArray(schema.agentRuns.status, ['queued', 'running']),
    ),
    orderBy: [desc(schema.agentRuns.startedAt)],
  })
}

async function listMobileEmployeeRuns(): Promise<EmployeeRunRow[]> {
  return db.query.employeeRuns.findMany({
    where: inArray(schema.employeeRuns.status, ['queued', 'running', 'paused']),
    orderBy: [desc(schema.employeeRuns.updatedAt)],
    limit: 50,
  })
}

async function listPendingApprovalRequests(): Promise<ApprovalRequestRow[]> {
  return db.query.approvalRequests.findMany({
    where: eq(schema.approvalRequests.status, 'pending'),
    orderBy: [desc(schema.approvalRequests.createdAt)],
    limit: 50,
  })
}

async function listRecentMobileUploads(): Promise<MobileUploadSummary[]> {
  const rows = await db.query.multimodalInputs.findMany({
    where: eq(schema.multimodalInputs.source, MOBILE_UPLOAD_SOURCE),
    orderBy: [desc(schema.multimodalInputs.createdAt)],
    limit: 20,
  })
  return rows.map(toMobileUploadSummary)
}

function collectPendingWrites(
  conversations: ConversationWithMeta[],
): Map<string, PendingWrite[]> {
  return new Map(
    conversations.map((conversation) => [
      conversation.id,
      pendingWrites.listByConversation(conversation.id),
    ]),
  )
}

function collectPendingQuestions(
  conversations: ConversationWithMeta[],
): Map<string, PendingQuestion[]> {
  return new Map(
    conversations.map((conversation) => [
      conversation.id,
      pendingQuestions.listByConversation(conversation.id),
    ]),
  )
}

function toMobileConversation(
  conversation: ConversationWithMeta,
  runningRuns: AgentRunRow[],
  writes: PendingWrite[],
  questions: PendingQuestion[],
): MobileConversationSummary {
  return {
    id: conversation.id,
    title: conversation.title,
    mode: conversation.mode,
    updatedAt: conversation.updatedAt,
    runningRunCount: runningRuns.filter((run) => run.conversationId === conversation.id).length,
    pendingWriteCount: writes.length,
    pendingQuestionCount: questions.length,
  }
}

function toMobileRun(run: AgentRunRow): MobileRun {
  return {
    id: run.id,
    conversationId: run.conversationId,
    agentId: run.agentId,
    status: run.status,
    startedAt: run.startedAt,
  }
}

function toMobileEmployeeRun(run: EmployeeRunRow): MobileEmployeeRun {
  return {
    id: run.id,
    agentProfileId: run.agentProfileId,
    workflowRunId: run.workflowRunId,
    goal: run.goal,
    status: run.status,
    currentPhase: run.currentPhase,
    currentStep: run.currentStep,
    updatedAt: run.updatedAt,
    finishedAt: run.finishedAt,
  }
}

function toMobileApprovalRequest(row: ApprovalRequestRow): MobileApprovalRequest {
  return {
    id: row.id,
    agentProfileId: row.agentProfileId,
    type: row.type,
    title: row.title,
    description: row.description,
    riskLevel: row.riskLevel,
    payload: row.payload,
    createdAt: row.createdAt,
  }
}

function toMobileUploadSummary(row: MultimodalInputRow): MobileUploadSummary {
  const metadata = isJsonObject(row.metadata) ? row.metadata : {}
  return {
    id: row.id,
    employeeRunId: row.employeeRunId,
    agentProfileId: row.agentProfileId,
    kind: row.kind,
    mimeType: row.mimeType,
    dataRef: row.dataRef,
    description: row.description,
    fileName: readString(metadata.fileName),
    sizeBytes: readNumber(metadata.sizeBytes),
    status: row.status,
    createdAt: row.createdAt,
  }
}

function resolveCompanionMode(settingsMode: 'off' | 'lan' | 'tailnet'): 'off' | 'lan' | 'tailnet' {
  if (settingsMode !== 'off') return settingsMode
  if (process.env.AGENTHUB_COMPANION_MODE === 'tailnet') return 'tailnet'
  if (process.env.AGENTHUB_COMPANION_MODE === 'lan') return 'lan'
  return 'off'
}

function resolveAllowedMobileOrigins(): string[] {
  const builtin = [
    'capacitor://localhost',
    'ionic://localhost',
    'https://localhost',
    'http://localhost',
    'http://localhost:*',
    'http://127.0.0.1:*',
    'http://[::1]:*',
  ]
  const configured = (process.env.AGENTHUB_MOBILE_ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
  return [...builtin, ...configured]
}

function buildMobileEndpointContract(): MobileCompanionReport['endpointContract'] {
  return [
    endpoint('GET', '/api/mobile/snapshot', 'View conversations, Agents, active runs, approvals, pending writes/questions, and recent uploads.'),
    endpoint('GET', '/api/mobile/conversations/:id', 'Open a conversation detail with messages, artifact cards, pending writes, and pending questions.'),
    endpoint('GET', '/api/mobile/artifacts/:id', 'View a produced artifact from the mobile companion.'),
    endpoint('POST', '/api/mobile/conversations/:id/messages', 'Send a user instruction from the phone to the desktop Agent workspace.'),
    endpoint('POST', '/api/mobile/approvals/:id', 'Approve or reject an Agent approval request.'),
    endpoint('POST', '/api/mobile/pending-writes/:id', 'Approve or reject a pending file-write request.'),
    endpoint('POST', '/api/mobile/pending-questions/:id', 'Answer a structured Agent question.'),
    endpoint('POST', '/api/mobile/employee-runs/:id/pause', 'Pause an employee run.'),
    endpoint('POST', '/api/mobile/employee-runs/:id/resume', 'Resume a paused employee run.'),
    endpoint('POST', '/api/mobile/employee-runs/:id/cancel', 'Cancel an employee run.'),
    endpoint('POST', '/api/mobile/uploads', 'Register phone-provided images, screenshots, audio, text, or structured files as Agent-visible multimodal inputs.'),
    endpoint('GET', '/api/mobile/companion-report', 'Inspect the mobile companion readiness and v1/v2 capability boundary.'),
  ]
}

function endpoint(
  method: 'GET' | 'POST',
  path: string,
  purpose: string,
): MobileCompanionReport['endpointContract'][number] {
  return { method, path, purpose, requiresAuth: true }
}

function buildV1Capabilities(args: { tokenConfigured: boolean }): MobileCompanionReport['v1Capabilities'] {
  const status = args.tokenConfigured ? 'implemented' : 'needs_configuration'
  return [
    capability('view_task_progress', 'View task and run progress', status, ['/api/mobile/snapshot', 'getMobileSnapshot']),
    capability('view_agent_status', 'View Agent status', status, ['/api/mobile/snapshot', 'employeeRuns/currentPhase/currentStep']),
    capability('view_artifacts', 'View produced artifacts', status, ['/api/mobile/artifacts/:id', 'getMobileArtifact']),
    capability('approval_control', 'Approve and reject Agent requests', status, ['/api/mobile/approvals/:id', '/api/mobile/pending-writes/:id', '/api/mobile/pending-questions/:id']),
    capability('run_control', 'Pause, resume, and cancel employee runs', status, ['/api/mobile/employee-runs/:id/pause', '/api/mobile/employee-runs/:id/resume', '/api/mobile/employee-runs/:id/cancel']),
    capability('agent_message', 'Send instructions back to Agents', status, ['/api/mobile/conversations/:id/messages', 'sendMobileMessage']),
    capability('upload_handoff_material', 'Upload phone-provided handoff material', status, ['/api/mobile/uploads', 'multimodal_inputs source=mobile_companion_upload']),
  ]
}

function capability(
  key: string,
  label: string,
  status: 'implemented' | 'needs_configuration',
  evidence: string[],
): MobileCompanionReport['v1Capabilities'][number] {
  return { key, label, status, evidence }
}

function buildV2DeviceAutomationReservations(): MobileCompanionReport['v2DeviceAutomationReservations'] {
  return [
    guardedDeviceAutomation({
      key: 'android_adb',
      label: 'Android ADB 设备操作',
      runtimeActions: [
        'runtime_control.mobile.list_devices',
        'runtime_control.mobile.mobile_tap',
        'runtime_control.mobile.mobile_swipe',
        'runtime_control.mobile.mobile_text',
        'runtime_control.mobile.mobile_keyevent',
        'runtime_control.mobile.mobile_screenshot',
      ],
      requiredEnvVars: ['AGENTHUB_ENABLE_REAL_MOBILE_CONTROL', 'AGENTHUB_ENABLE_REAL_MOBILE_CAPTURE'],
      reason: 'Android ADB 已接入 runtime-control；真实点击、输入、按键和截图必须经过生产门禁、设备白名单、应用包名白名单、审批和审计。',
    }),
    deviceReservation(
      'ios_shortcuts',
      'iOS Shortcuts 操作',
      'iOS Shortcuts 尚未接入 runtime-control。当前只保留能力边界，避免误导用户以为已经可以真实控制 iPhone。',
    ),
    deviceReservation(
      'appium',
      'Appium App 自动化',
      'Appium 工具链会在生产集成里探测，但完整 Appium 动作执行尚未接入 runtime-control。',
    ),
    deviceReservation(
      'screen_mirroring',
      '手机屏幕镜像',
      '手机屏幕镜像尚未作为可观看的远程画面接入；当前只支持受保护的 ADB 截图动作。',
    ),
    guardedDeviceAutomation({
      key: 'mobile_click_input',
      label: '手机点击/输入自动化',
      runtimeActions: [
        'runtime_control.mobile.mobile_tap',
        'runtime_control.mobile.mobile_swipe',
        'runtime_control.mobile.mobile_text',
        'runtime_control.mobile.mobile_keyevent',
      ],
      requiredEnvVars: ['AGENTHUB_ENABLE_REAL_MOBILE_CONTROL'],
      reason: '手机点击/输入已经通过 runtime-control 接入；真实执行需要客户授权、go-live、live pilot、设备白名单、应用包名白名单和运行时审批。',
    }),
  ]
}

function deviceReservation(
  key: string,
  label: string,
  reason: string,
): MobileCompanionReport['v2DeviceAutomationReservations'][number] {
  return {
    key,
    label,
    status: 'reserved_not_enabled',
    reason,
    runtimeActions: [],
    requiredEnvVars: [],
    requiredAllowlists: [],
    safetyGates: ['客户授权', 'go-live 批准', '资源锁', '审计日志'],
    evidence: ['该能力尚未接入真实设备控制执行器。'],
  }
}

function guardedDeviceAutomation(args: {
  key: string
  label: string
  runtimeActions: string[]
  requiredEnvVars: string[]
  reason: string
}): MobileCompanionReport['v2DeviceAutomationReservations'][number] {
  const requiredAllowlists = mobileRuntimeAllowlists()
  return {
    key: args.key,
    label: args.label,
    status: 'guarded_available',
    reason: args.reason,
    runtimeActions: args.runtimeActions,
    requiredEnvVars: args.requiredEnvVars,
    requiredAllowlists,
    safetyGates: [
      'AGENTHUB_CUSTOMER_ENVIRONMENT_AUTHORIZED',
      'AGENTHUB_CUSTOMER_AUTHORIZATION_EVIDENCE_HASH',
      'AGENTHUB_APPROVED_GO_LIVE_DECISION_HASH',
      'AGENTHUB_LIVE_PILOT_LEASE_HASH',
      RUNTIME_CONTROL_KILL_SWITCH_ENV,
      '运行时审批 inputHash 绑定',
      'mobile_device 资源锁',
      '审计日志',
    ],
    evidence: [
      'runtime-control 支持 list_devices、mobile_tap、mobile_swipe、mobile_text、mobile_keyevent 和 mobile_screenshot。',
      `${MOBILE_DEVICE_ALLOWLIST_ENV}=${process.env[MOBILE_DEVICE_ALLOWLIST_ENV]?.trim() ? '已配置' : '缺失'}`,
      `${MOBILE_APP_ALLOWLIST_ENV}=${process.env[MOBILE_APP_ALLOWLIST_ENV]?.trim() ? '已配置' : '缺失'}`,
      `AGENTHUB_ENABLE_REAL_MOBILE_CONTROL=${process.env.AGENTHUB_ENABLE_REAL_MOBILE_CONTROL === '1' ? '已开启' : '关闭'}`,
      `AGENTHUB_ENABLE_REAL_MOBILE_CAPTURE=${process.env.AGENTHUB_ENABLE_REAL_MOBILE_CAPTURE === '1' ? '已开启' : '关闭'}`,
    ],
  }
}

function mobileRuntimeAllowlists(): MobileCompanionReport['v2DeviceAutomationReservations'][number]['requiredAllowlists'] {
  return [
    {
      envVar: MOBILE_DEVICE_ALLOWLIST_ENV,
      configured: Boolean(process.env[MOBILE_DEVICE_ALLOWLIST_ENV]?.trim()),
      purpose: '只允许客户批准的测试手机设备 ID 接收真实手机动作。',
    },
    {
      envVar: MOBILE_APP_ALLOWLIST_ENV,
      configured: Boolean(process.env[MOBILE_APP_ALLOWLIST_ENV]?.trim()),
      purpose: '只允许客户批准的 Android 包名接收真实点按、输入、滑动或按键动作。',
    },
  ]
}

function buildMobileGaps(args: {
  companion: MobileCompanionReport['companion']
  endpointContract: MobileCompanionReport['endpointContract']
}): string[] {
  const gaps: string[] = []
  if (args.companion.mode === 'off') gaps.push('Mobile companion mode is off.')
  if (!args.companion.tokenConfigured) gaps.push('Mobile companion token is not configured.')
  if (!args.endpointContract.some((endpoint) => endpoint.path === '/api/mobile/uploads')) {
    gaps.push('Mobile upload handoff endpoint is missing.')
  }
  return gaps
}

function buildMobileWarnings(args: {
  companion: MobileCompanionReport['companion']
  snapshotSummary: MobileCompanionReport['snapshotSummary']
}): string[] {
  const warnings: string[] = []
  if (args.companion.mode === 'lan') {
    warnings.push('LAN companion mode should stay on trusted networks or behind a tailnet.')
  }
  if (args.snapshotSummary.recentUploads === 0) {
    warnings.push('No phone-provided upload handoff material has been registered yet.')
  }
  return warnings
}

function resolveMobileReadiness(args: {
  tokenConfigured: boolean
  mode: 'off' | 'lan' | 'tailnet'
  snapshotSummary: MobileCompanionReport['snapshotSummary']
  gaps: string[]
}): MobileCompanionReadiness {
  if (args.gaps.length > 0) return 'needs_configuration'
  if (
    args.snapshotSummary.employeeRuns === 0 &&
    args.snapshotSummary.approvalRequests === 0 &&
    args.snapshotSummary.recentUploads === 0
  ) {
    return 'empty'
  }
  return args.tokenConfigured && args.mode !== 'off' ? 'ready' : 'needs_configuration'
}

function scoreMobileReadiness(
  readiness: MobileCompanionReadiness,
  gaps: string[],
  warnings: string[],
  snapshotSummary: MobileCompanionReport['snapshotSummary'],
): number {
  const base = readiness === 'ready' ? 78 : readiness === 'empty' ? 55 : 45
  const activityBonus = Math.min(12, snapshotSummary.employeeRuns * 2 + snapshotSummary.approvalRequests * 2)
  const uploadBonus = Math.min(6, snapshotSummary.recentUploads * 2)
  const questionBonus = Math.min(4, snapshotSummary.pendingQuestions + snapshotSummary.pendingWrites)
  return Math.max(0, Math.min(100, base + activityBonus + uploadBonus + questionBonus - gaps.length * 12 - warnings.length * 2))
}

function buildMobileRecommendations(args: {
  readiness: MobileCompanionReadiness
  companion: MobileCompanionReport['companion']
  snapshotSummary: MobileCompanionReport['snapshotSummary']
}): string[] {
  const recommendations: string[] = []
  if (args.companion.mode === 'off') {
    recommendations.push('Enable LAN or tailnet companion mode before pairing a phone.')
  }
  if (!args.companion.tokenConfigured) {
    recommendations.push('Generate a mobile device token and use it as a Bearer token from the phone.')
  }
  if (args.snapshotSummary.recentUploads === 0) {
    recommendations.push('Register at least one phone-provided image, screenshot, audio, text, or structured file to verify upload handoff.')
  }
  if (args.readiness === 'ready') {
    recommendations.push('Mobile companion v1 is ready for progress monitoring, approvals, messaging, run control, and upload handoff.')
  }
  return recommendations
}

function isJsonObject(value: unknown): value is JsonObject {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null
}

function readNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function toMobileMessagePart(part: MessagePart): MobileMessagePart {
  switch (part.type) {
    case 'text':
      return { type: 'text', content: part.content }
    case 'code':
      return { type: 'code', language: part.language, content: part.content }
    case 'thinking':
      return { type: 'thinking', content: part.content }
    case 'tool_use':
      return { type: 'tool_use', callId: part.callId, toolName: part.toolName }
    case 'tool_result':
      return { type: 'tool_result', callId: part.callId, isError: part.isError }
    case 'artifact_ref':
      return { type: 'artifact_ref', artifactId: part.artifactId }
    case 'deploy_status':
      return {
        type: 'deploy_status',
        title: part.deployment.title,
        version: part.deployment.version,
        sourceType: part.deployment.sourceType,
        workspacePath: part.deployment.workspacePath,
        previewPath: part.deployment.previewPath,
        status: part.deployment.status,
        error: part.deployment.error,
      }
    case 'deploy_candidates':
      return { type: 'deploy_candidates', candidates: part.candidates }
    case 'image_attachment':
      return { type: 'attachment', fileName: part.fileName, kind: 'image' }
    case 'file_attachment':
      return { type: 'attachment', fileName: part.fileName, kind: 'file' }
  }
}

function extractArtifactIds(parts: MessagePart[]): string[] {
  return Array.from(
    new Set(
      parts.flatMap((part) => (part.type === 'artifact_ref' ? [part.artifactId] : [])),
    ),
  )
}

async function listMobileArtifactSummaries(artifactIds: string[]): Promise<MobileArtifactSummary[]> {
  if (artifactIds.length === 0) return []
  const rows = await db.query.artifacts.findMany({
    where: inArray(schema.artifacts.id, artifactIds),
  })
  const order = new Map(artifactIds.map((id, index) => [id, index]))
  return rows
    .map((artifact) => ({
      id: artifact.id,
      type: artifact.type,
      title: artifact.title,
      version: artifact.version,
      createdAt: artifact.createdAt,
    }))
    .sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0))
}

function toMobilePendingWrite(write: PendingWrite): MobilePendingWrite {
  return {
    id: write.id,
    conversationId: write.conversationId,
    agentId: write.agentId,
    runId: write.runId,
    path: write.path,
    oldContent: write.oldContent,
    newContent: write.newContent,
    createdAt: write.createdAt,
  }
}

function toMobilePendingQuestion(question: PendingQuestion): MobilePendingQuestion {
  return {
    id: question.id,
    conversationId: question.conversationId,
    agentId: question.agentId,
    runId: question.runId,
    questions: question.questions.map((item) => ({
      question: item.question,
      header: item.header,
      options: item.options.map((option) => ({
        label: option.label,
        description: option.description,
      })),
      multiSelect: item.multiSelect,
    })),
    createdAt: question.createdAt,
  }
}
