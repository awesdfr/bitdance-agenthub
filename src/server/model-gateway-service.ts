import { desc, eq } from 'drizzle-orm'
import type { Dispatcher } from 'undici'

import { db, schema } from '@/db/client'
import type {
  AgentProfileRow,
  HealthStatus,
  JsonObject,
  ModelConnectionTestMode,
  ModelConnectionTestRow,
  ModelProfileRow,
  ModelRouteDecisionRow,
  ModelRouteStatus,
  NetworkProfileRow,
} from '@/db/schema'
import { evaluateProductionGoLiveRuntimeGate } from '@/server/go-live-enforcement-service'
import { newModelConnectionTestId, newModelRouteDecisionId } from '@/server/ids'
import { checkCredentialScope, recordAuditLog, resolveSecretValue } from '@/server/security-service'

export const MODEL_ENDPOINT_HOST_ALLOWLIST_ENV = 'AGENTHUB_ALLOWED_MODEL_ENDPOINT_HOSTS'

export interface TestModelConnectionArgs {
  modelProfileId: string
  live?: boolean
  confirmExternalCall?: boolean
}

export type ModelCapabilityProbeKind = 'text' | 'json' | 'tool_calling' | 'vision'

export interface RunModelCapabilityProbeArgs {
  modelProfileId: string
  kind?: ModelCapabilityProbeKind
  live?: boolean
  confirmExternalCall?: boolean
  stream?: boolean
  prompt?: string
  visionImageDataUrl?: string | null
}

export interface PreviewModelRouteArgs {
  agentProfileId?: string | null
  requestedCapabilities?: JsonObject
  estimatedInputTokens?: number
  estimatedOutputTokens?: number
}

export async function testModelConnection(
  args: TestModelConnectionArgs,
): Promise<ModelConnectionTestRow> {
  const profile = await getRequiredModelProfile(args.modelProfileId)
  const mode: ModelConnectionTestMode = args.live ? 'live' : 'dry_run'
  const startedAt = Date.now()
  const structuralError = validateModelProfile(profile)
  const credential = await resolveModelCredential(profile, {
    resolveValue: Boolean(args.live),
    capability: 'model.connect',
  })
  const networkRoute = await resolveModelNetworkRoute(profile)
  const gate = evaluateModelConnectionGate(args)
  const endpointGate = evaluateModelEndpointHostGate(profile.baseUrl, args.live)

  let status: HealthStatus =
    structuralError || credential.error || networkRoute.error || (args.live && (!gate.allowed || !endpointGate.allowed))
      ? 'failed'
      : 'ok'
  let message =
    structuralError ??
    credential.error ??
    networkRoute.error ??
    (args.live && !gate.allowed ? gate.reason : null) ??
    (args.live && !endpointGate.allowed ? endpointGate.reason : null) ??
    'Model profile is structurally valid; no live request was made.'

  if (!structuralError && !networkRoute.error && args.live) {
    if (!credential.value) {
      status = 'failed'
      message = `Live test requested but apiKeyRef ${profile.apiKeyRef} could not be resolved from ${credential.source}.`
    } else if (!gate.allowed) {
      status = 'failed'
      message = gate.reason
    } else if (!endpointGate.allowed) {
      status = 'failed'
      message = endpointGate.reason
    } else {
      const liveResult = await tryLiveModelsRequest(profile, credential.value, networkRoute)
      status = liveResult.status
      message = liveResult.message
    }
  }

  const row: ModelConnectionTestRow = {
    id: newModelConnectionTestId(),
    modelProfileId: profile.id,
    mode,
    status,
    latencyMs: Date.now() - startedAt,
    message,
    capabilityChecks: {
      provider: profile.provider,
      model: profile.model,
      supportsVision: profile.supportsVision,
      supportsToolCalling: profile.supportsToolCalling,
      supportsJsonMode: profile.supportsJsonMode,
      contextWindow: profile.contextWindow,
      apiKeyResolved: Boolean(credential.value),
      credentialSource: credential.source,
      credentialScopeStatus: credential.scopeStatus,
      credentialScopeId: credential.scopeId,
      credentialSecretId: credential.secretId,
      credentialScopeMessage: credential.scopeMessage,
      liveRequested: Boolean(args.live),
      externalCallConfirmed: Boolean(args.confirmExternalCall),
      envGate: process.env.AGENTHUB_ENABLE_REAL_MODEL_CONNECTION === '1',
      modelConnectionGateAllowed: gate.allowed,
      modelConnectionGateReason: gate.reason,
      modelEndpointAllowlistEnvVar: endpointGate.envVar,
      modelEndpointAllowlistConfigured: endpointGate.configured,
      modelEndpointHost: endpointGate.host,
      modelEndpointAllowed: endpointGate.allowed,
      modelEndpointGateReason: endpointGate.reason,
      ...networkRoute.metadata,
    },
    networkProfileId: profile.networkProfileId,
    createdAt: Date.now(),
  }
  await db.insert(schema.modelConnectionTests).values(row)
  await db
    .update(schema.modelProfiles)
    .set({
      healthStatus: status,
      lastTestResult: message,
      lastCheckedAt: row.createdAt,
      updatedAt: row.createdAt,
    })
    .where(eq(schema.modelProfiles.id, profile.id))
  if (args.live) {
    await recordModelGatewayAudit({
      action: 'model.connect.live',
      capability: 'model.connect',
      profile,
      row,
      credential,
      networkRoute,
      extra: {
        endpointFamily: 'models_list',
        externalCallConfirmed: Boolean(args.confirmExternalCall),
        envGate: process.env.AGENTHUB_ENABLE_REAL_MODEL_CONNECTION === '1',
        gateAllowed: gate.allowed,
      },
    })
  }
  return row
}

export async function runModelCapabilityProbe(
  args: RunModelCapabilityProbeArgs,
): Promise<ModelConnectionTestRow> {
  const profile = await getRequiredModelProfile(args.modelProfileId)
  const kind = args.kind ?? 'json'
  const mode: ModelConnectionTestMode = args.live ? 'live' : 'dry_run'
  const startedAt = Date.now()
  const structuralError = validateModelProfile(profile)
  const credential = await resolveModelCredential(profile, {
    resolveValue: Boolean(args.live),
    capability: 'model.invoke',
  })
  const networkRoute = await resolveModelNetworkRoute(profile)
  const plan = buildModelCapabilityProbePlan(profile, kind, {
    prompt: args.prompt,
    stream: args.stream,
    visionImageDataUrl: args.visionImageDataUrl,
  })
  const gate = await evaluateModelInvocationGate(args)
  const endpointGate = evaluateModelEndpointHostGate(plan.endpoint, args.live)

  let status: HealthStatus =
    structuralError ||
    credential.error ||
    networkRoute.error ||
    plan.error ||
    (args.live && !endpointGate.allowed)
      ? 'failed'
      : 'ok'
  let message =
    structuralError ??
    credential.error ??
    networkRoute.error ??
    plan.error ??
    (args.live && !gate.allowed ? gate.reason : null) ??
    (args.live && !endpointGate.allowed ? endpointGate.reason : null) ??
    `Capability probe dry run prepared for ${kind} using ${plan.requestFamily}.`
  let liveMetadata: JsonObject = {}

  if (!structuralError && !networkRoute.error && !plan.error && args.live) {
    if (!credential.value) {
      status = 'failed'
      message = `Live capability probe requested but apiKeyRef ${profile.apiKeyRef} could not be resolved from ${credential.source}.`
    } else if (!gate.allowed) {
      status = 'failed'
      message = gate.reason
    } else if (!endpointGate.allowed) {
      status = 'failed'
      message = endpointGate.reason
    } else {
      const liveResult = await tryLiveCapabilityProbe(plan, credential.value, networkRoute)
      status = liveResult.status
      message = liveResult.message
      liveMetadata = liveResult.metadata
    }
  }

  const row: ModelConnectionTestRow = {
    id: newModelConnectionTestId(),
    modelProfileId: profile.id,
    mode,
    status,
    latencyMs: Date.now() - startedAt,
    message,
    capabilityChecks: {
      provider: profile.provider,
      model: profile.model,
      supportsVision: profile.supportsVision,
      supportsToolCalling: profile.supportsToolCalling,
      supportsJsonMode: profile.supportsJsonMode,
      contextWindow: profile.contextWindow,
      apiKeyResolved: Boolean(credential.value),
      credentialSource: credential.source,
      credentialScopeStatus: credential.scopeStatus,
      credentialScopeId: credential.scopeId,
      credentialSecretId: credential.secretId,
      credentialScopeMessage: credential.scopeMessage,
      liveRequested: Boolean(args.live),
      capabilityProbeKind: kind,
      requestFamily: plan.requestFamily,
      endpoint: plan.endpoint,
      streamRequested: plan.streamRequested,
      streamProtocol: plan.streamProtocol,
      streamHandshakePlanned: plan.streamRequested && plan.streamProtocol !== 'none' && !plan.error,
      jsonModeHandshakePlanned: kind === 'json' && !plan.error,
      toolCallingHandshakePlanned: kind === 'tool_calling' && !plan.error,
      visionHandshakePlanned: kind === 'vision' && !plan.error,
      modelEndpointAllowlistEnvVar: endpointGate.envVar,
      modelEndpointAllowlistConfigured: endpointGate.configured,
      modelEndpointHost: endpointGate.host,
      modelEndpointAllowed: endpointGate.allowed,
      modelEndpointGateReason: endpointGate.reason,
      externalCallConfirmed: Boolean(args.confirmExternalCall),
      envGate: process.env.AGENTHUB_ENABLE_REAL_MODEL_INVOCATION === '1',
      goLiveRequired: gate.goLiveRequired,
      goLiveDecisionHash: gate.goLiveDecisionHash,
      goLiveLatestDecisionHash: gate.goLiveLatestDecisionHash,
      goLiveDecisionSatisfied: gate.goLiveDecisionSatisfied,
      goLiveLatestDecisionCustomerAuthorizationEvidenceHash:
        gate.goLiveLatestDecisionCustomerAuthorizationEvidenceHash,
      goLiveLatestDecisionCustomerAuthorizationEvidenceMatched:
        gate.goLiveLatestDecisionCustomerAuthorizationEvidenceMatched,
      goLiveLatestDecisionEnvironmentFingerprintPresent:
        gate.goLiveLatestDecisionEnvironmentFingerprintPresent,
      goLiveLatestDecisionEnvironmentFingerprintMatched:
        gate.goLiveLatestDecisionEnvironmentFingerprintMatched,
      goLiveLatestDecisionEnvironmentFingerprintMismatches:
        gate.goLiveLatestDecisionEnvironmentFingerprintMismatches,
      goLiveCustomerAuthorizationRequired: gate.goLiveCustomerAuthorizationRequired,
      goLiveCustomerAuthorized: gate.goLiveCustomerAuthorized,
      goLiveCustomerAuthorizationSwitchEnabled: gate.goLiveCustomerAuthorizationSwitchEnabled,
      goLiveCustomerAuthorizationEvidenceHashRequired: gate.goLiveCustomerAuthorizationEvidenceHashRequired,
      goLiveCustomerAuthorizationEvidenceHash: gate.goLiveCustomerAuthorizationEvidenceHash,
      goLiveCustomerAuthorizationEvidenceMatched: gate.goLiveCustomerAuthorizationEvidenceMatched,
      goLiveCustomerAuthorizationEvidenceBoundToDecision: gate.goLiveCustomerAuthorizationEvidenceBoundToDecision,
      goLiveLivePilotLeaseRequired: gate.goLiveLivePilotLeaseRequired,
      goLiveLivePilotLeaseHash: gate.goLiveLivePilotLeaseHash,
      goLiveLatestLivePilotLeaseHash: gate.goLiveLatestLivePilotLeaseHash,
      goLiveLatestLivePilotLeaseActive: gate.goLiveLatestLivePilotLeaseActive,
      goLiveLatestLivePilotLeaseExpiresAt: gate.goLiveLatestLivePilotLeaseExpiresAt,
      goLiveLivePilotLeaseMatched: gate.goLiveLivePilotLeaseMatched,
      goLiveLivePilotLeaseExpired: gate.goLiveLivePilotLeaseExpired,
      goLiveLivePilotLeaseBoundToDecision: gate.goLiveLivePilotLeaseBoundToDecision,
      goLiveLivePilotLeaseBoundToCustomerAuthorization:
        gate.goLiveLivePilotLeaseBoundToCustomerAuthorization,
      goLiveLivePilotLeaseBoundToEnvironmentFingerprint:
        gate.goLiveLivePilotLeaseBoundToEnvironmentFingerprint,
      goLiveLivePilotSessionRequired: gate.goLiveLivePilotSessionRequired,
      goLiveLatestLivePilotSessionId: gate.goLiveLatestLivePilotSessionId,
      goLiveLatestLivePilotSessionHash: gate.goLiveLatestLivePilotSessionHash,
      goLiveLatestLivePilotSessionStatus: gate.goLiveLatestLivePilotSessionStatus,
      goLiveLatestLivePilotSessionActive: gate.goLiveLatestLivePilotSessionActive,
      goLiveLatestLivePilotSessionExpiresAt: gate.goLiveLatestLivePilotSessionExpiresAt,
      goLiveLivePilotSessionBoundToLease: gate.goLiveLivePilotSessionBoundToLease,
      goLiveLivePilotSessionBoundToDecision: gate.goLiveLivePilotSessionBoundToDecision,
      goLiveLivePilotSessionBoundToCustomerAuthorization:
        gate.goLiveLivePilotSessionBoundToCustomerAuthorization,
      goLiveLivePilotSessionBoundToEnvironmentFingerprint:
        gate.goLiveLivePilotSessionBoundToEnvironmentFingerprint,
      promptBytes: Buffer.byteLength(plan.prompt, 'utf8'),
      hasVisionImage: Boolean(args.visionImageDataUrl),
      ...networkRoute.metadata,
      ...liveMetadata,
    },
    networkProfileId: profile.networkProfileId,
    createdAt: Date.now(),
  }
  await db.insert(schema.modelConnectionTests).values(row)
  await db
    .update(schema.modelProfiles)
    .set({
      healthStatus: status,
      lastTestResult: message,
      lastCheckedAt: row.createdAt,
      updatedAt: row.createdAt,
    })
    .where(eq(schema.modelProfiles.id, profile.id))
  if (args.live) {
    await recordModelGatewayAudit({
      action: 'model.invoke.live',
      capability: 'model.invoke',
      profile,
      row,
      credential,
      networkRoute,
      extra: {
        capabilityProbeKind: kind,
        requestFamily: plan.requestFamily,
        endpoint: plan.endpoint,
        streamRequested: plan.streamRequested,
        streamProtocol: plan.streamProtocol,
        streamHandshakePlanned: plan.streamRequested && plan.streamProtocol !== 'none' && !plan.error,
        externalCallConfirmed: Boolean(args.confirmExternalCall),
        gateAllowed: gate.allowed,
        goLiveRequired: gate.goLiveRequired ?? null,
        goLiveDecisionSatisfied: gate.goLiveDecisionSatisfied ?? null,
        goLiveLatestDecisionCustomerAuthorizationEvidenceHash:
          gate.goLiveLatestDecisionCustomerAuthorizationEvidenceHash ?? null,
        goLiveLatestDecisionCustomerAuthorizationEvidenceMatched:
          gate.goLiveLatestDecisionCustomerAuthorizationEvidenceMatched ?? null,
        goLiveLatestDecisionEnvironmentFingerprintPresent:
          gate.goLiveLatestDecisionEnvironmentFingerprintPresent ?? null,
        goLiveLatestDecisionEnvironmentFingerprintMatched:
          gate.goLiveLatestDecisionEnvironmentFingerprintMatched ?? null,
        goLiveLatestDecisionEnvironmentFingerprintMismatches:
          gate.goLiveLatestDecisionEnvironmentFingerprintMismatches ?? null,
        goLiveCustomerAuthorized: gate.goLiveCustomerAuthorized ?? null,
        goLiveCustomerAuthorizationSwitchEnabled: gate.goLiveCustomerAuthorizationSwitchEnabled ?? null,
        goLiveCustomerAuthorizationEvidenceHashRequired:
          gate.goLiveCustomerAuthorizationEvidenceHashRequired ?? null,
        goLiveCustomerAuthorizationEvidenceMatched: gate.goLiveCustomerAuthorizationEvidenceMatched ?? null,
        goLiveCustomerAuthorizationEvidenceBoundToDecision:
          gate.goLiveCustomerAuthorizationEvidenceBoundToDecision ?? null,
        goLiveLivePilotLeaseRequired: gate.goLiveLivePilotLeaseRequired ?? null,
        goLiveLivePilotLeaseMatched: gate.goLiveLivePilotLeaseMatched ?? null,
        goLiveLivePilotLeaseExpired: gate.goLiveLivePilotLeaseExpired ?? null,
        goLiveLatestLivePilotLeaseExpiresAt: gate.goLiveLatestLivePilotLeaseExpiresAt ?? null,
        goLiveLivePilotLeaseBoundToDecision: gate.goLiveLivePilotLeaseBoundToDecision ?? null,
        goLiveLivePilotLeaseBoundToCustomerAuthorization:
          gate.goLiveLivePilotLeaseBoundToCustomerAuthorization ?? null,
        goLiveLivePilotLeaseBoundToEnvironmentFingerprint:
          gate.goLiveLivePilotLeaseBoundToEnvironmentFingerprint ?? null,
        goLiveLivePilotSessionRequired: gate.goLiveLivePilotSessionRequired ?? null,
        goLiveLatestLivePilotSessionStatus: gate.goLiveLatestLivePilotSessionStatus ?? null,
        goLiveLatestLivePilotSessionActive: gate.goLiveLatestLivePilotSessionActive ?? null,
        goLiveLatestLivePilotSessionExpiresAt: gate.goLiveLatestLivePilotSessionExpiresAt ?? null,
        goLiveLivePilotSessionBoundToLease: gate.goLiveLivePilotSessionBoundToLease ?? null,
        goLiveLivePilotSessionBoundToDecision: gate.goLiveLivePilotSessionBoundToDecision ?? null,
        goLiveLivePilotSessionBoundToCustomerAuthorization:
          gate.goLiveLivePilotSessionBoundToCustomerAuthorization ?? null,
        goLiveLivePilotSessionBoundToEnvironmentFingerprint:
          gate.goLiveLivePilotSessionBoundToEnvironmentFingerprint ?? null,
      },
    })
  }
  return row
}

export async function listModelConnectionTests(
  modelProfileId?: string,
): Promise<ModelConnectionTestRow[]> {
  return db.query.modelConnectionTests.findMany({
    where: modelProfileId
      ? eq(schema.modelConnectionTests.modelProfileId, modelProfileId)
      : undefined,
    orderBy: [desc(schema.modelConnectionTests.createdAt)],
    limit: 100,
  })
}

export async function previewModelRoute(
  args: PreviewModelRouteArgs,
): Promise<ModelRouteDecisionRow> {
  const agent = args.agentProfileId ? await getOptionalAgentProfile(args.agentProfileId) : null
  const candidates = await getRouteCandidates(agent)
  const requestedCapabilities = args.requestedCapabilities ?? {}
  const selected = candidates.find((profile) => modelMatchesRequestedCapabilities(profile, requestedCapabilities))
  const primaryId = agent?.modelProfileId ?? candidates[0]?.id ?? null
  const status: ModelRouteStatus = selected
    ? selected.id === primaryId
      ? 'selected'
      : 'fallback_selected'
    : 'no_match'
  const estimatedInputTokens = Math.max(0, Math.round(args.estimatedInputTokens ?? 0))
  const estimatedOutputTokens = Math.max(0, Math.round(args.estimatedOutputTokens ?? 0))
  const row: ModelRouteDecisionRow = {
    id: newModelRouteDecisionId(),
    agentProfileId: agent?.id ?? args.agentProfileId ?? null,
    requestedCapabilities,
    selectedModelProfileId: selected?.id ?? null,
    fallbackModelProfileIds: candidates
      .filter((profile) => profile.id !== primaryId)
      .map((profile) => profile.id),
    status,
    reason: buildRouteReason({ agent, selected, status, requestedCapabilities, candidateCount: candidates.length }),
    estimatedInputTokens,
    estimatedOutputTokens,
    estimatedCostCents: estimateModelCostCents(estimatedInputTokens, estimatedOutputTokens),
    createdAt: Date.now(),
  }
  await db.insert(schema.modelRouteDecisions).values(row)
  return row
}

export async function listModelRouteDecisions(
  agentProfileId?: string,
): Promise<ModelRouteDecisionRow[]> {
  return db.query.modelRouteDecisions.findMany({
    where: agentProfileId
      ? eq(schema.modelRouteDecisions.agentProfileId, agentProfileId)
      : undefined,
    orderBy: [desc(schema.modelRouteDecisions.createdAt)],
    limit: 100,
  })
}

async function getRouteCandidates(agent: AgentProfileRow | null): Promise<ModelProfileRow[]> {
  if (!agent) {
    return db.query.modelProfiles.findMany({ orderBy: [desc(schema.modelProfiles.updatedAt)] })
  }
  const ids = unique(
    [agent.modelProfileId, ...agent.fallbackModelProfileIds].filter((id): id is string => Boolean(id)),
  )
  if (ids.length === 0) {
    return db.query.modelProfiles.findMany({ orderBy: [desc(schema.modelProfiles.updatedAt)] })
  }
  const rows: ModelProfileRow[] = []
  for (const id of ids) {
    const row = await db.query.modelProfiles.findFirst({ where: eq(schema.modelProfiles.id, id) })
    if (row) rows.push(row)
  }
  return rows
}

function modelMatchesRequestedCapabilities(profile: ModelProfileRow, requested: JsonObject): boolean {
  if (getBoolean(requested, 'supportsVision') && !profile.supportsVision) return false
  if (getBoolean(requested, 'vision') && !profile.supportsVision) return false
  if (getBoolean(requested, 'supportsToolCalling') && !profile.supportsToolCalling) return false
  if (getBoolean(requested, 'toolCalling') && !profile.supportsToolCalling) return false
  if (getBoolean(requested, 'tools') && !profile.supportsToolCalling) return false
  if (getBoolean(requested, 'supportsJsonMode') && !profile.supportsJsonMode) return false
  if (getBoolean(requested, 'jsonMode') && !profile.supportsJsonMode) return false
  if (getBoolean(requested, 'json') && !profile.supportsJsonMode) return false
  return true
}

function buildRouteReason(args: {
  agent: AgentProfileRow | null
  selected: ModelProfileRow | undefined
  status: ModelRouteStatus
  requestedCapabilities: JsonObject
  candidateCount: number
}): string {
  const requested = Object.entries(args.requestedCapabilities)
    .filter(([, value]) => value === true)
    .map(([key]) => key)
  if (!args.selected) {
    return `No model matched requested capabilities: ${requested.join(', ') || 'none'} across ${args.candidateCount} candidates.`
  }
  const prefix =
    args.status === 'fallback_selected'
      ? 'Fallback model selected'
      : args.agent
        ? 'Primary model selected'
        : 'Model selected'
  return `${prefix}: ${args.selected.name} satisfies ${requested.join(', ') || 'basic text'} requirements.`
}

function estimateModelCostCents(inputTokens: number, outputTokens: number): number {
  if (inputTokens + outputTokens === 0) return 0
  return Math.max(1, Math.ceil((inputTokens * 0.002 + outputTokens * 0.006) / 1000))
}

async function tryLiveModelsRequest(
  profile: ModelProfileRow,
  apiKey: string,
  networkRoute: ModelNetworkRoute,
): Promise<{ status: HealthStatus; message: string }> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 8000)
  try {
    const endpoint = new URL(
      'models',
      profile.baseUrl.endsWith('/') ? profile.baseUrl : `${profile.baseUrl}/`,
    )
    const headers = buildModelListHeaders(profile, apiKey)
    const res = await fetchWithNetworkRoute(endpoint, { headers, signal: controller.signal }, networkRoute)
    if (!res.ok) return { status: 'failed', message: `Live model test failed with HTTP ${res.status}.` }
    return { status: 'ok', message: 'Live model endpoint responded successfully.' }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return { status: 'failed', message: `Live model test failed: ${message}` }
  } finally {
    clearTimeout(timeout)
  }
}

interface CapabilityProbePlan {
  requestFamily:
    | 'openai_chat_completions'
    | 'anthropic_messages'
    | 'google_generate_content'
    | 'ollama_chat'
    | 'unsupported'
  endpoint: string
  prompt: string
  requestBody: JsonObject
  headers: Record<string, string>
  streamRequested: boolean
  streamProtocol: 'none' | 'sse' | 'ndjson'
  error?: string
}

function buildModelCapabilityProbePlan(
  profile: ModelProfileRow,
  kind: ModelCapabilityProbeKind,
  options: { prompt?: string; stream?: boolean; visionImageDataUrl?: string | null },
): CapabilityProbePlan {
  const basePrompt =
    options.prompt?.trim() ||
    'Return a compact JSON object with ok=true and capability="agenthub_model_probe".'
  const endpointBase = profile.baseUrl.endsWith('/') ? profile.baseUrl : `${profile.baseUrl}/`
  const streamRequested = Boolean(options.stream)
  const unsupported = (error: string): CapabilityProbePlan => ({
    requestFamily: 'unsupported',
    endpoint: profile.baseUrl,
    prompt: basePrompt,
    requestBody: {},
    headers: {},
    streamRequested,
    streamProtocol: 'none',
    error,
  })

  if (kind === 'json' && !profile.supportsJsonMode) {
    return unsupported('JSON capability probe requested but this model profile does not advertise JSON mode.')
  }
  if (kind === 'tool_calling' && !profile.supportsToolCalling) {
    return unsupported('Tool-calling capability probe requested but this model profile does not advertise tool calling.')
  }
  if (kind === 'vision' && !profile.supportsVision) {
    return unsupported('Vision capability probe requested but this model profile does not advertise vision support.')
  }
  if (kind === 'vision' && !options.visionImageDataUrl?.trim()) {
    return unsupported('Vision capability probe needs a small data URL image so the provider receives an actual vision request.')
  }

  if (profile.provider === 'anthropic') {
    const body: JsonObject = {
      model: profile.model,
      max_tokens: 64,
      messages: [{ role: 'user', content: basePrompt }],
    }
    if (kind === 'tool_calling') {
      body.tools = [
        {
          name: 'agenthub_probe',
          description: 'Return whether the model can produce a tool call.',
          input_schema: {
            type: 'object',
            properties: { ok: { type: 'boolean' } },
            required: ['ok'],
          },
        },
      ]
    }
    if (streamRequested) body.stream = true
    return {
      requestFamily: 'anthropic_messages',
      endpoint: new URL('messages', endpointBase).toString(),
      prompt: basePrompt,
      requestBody: body,
      headers: { 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      streamRequested,
      streamProtocol: streamRequested ? 'sse' : 'none',
    }
  }

  if (profile.provider === 'ollama') {
    return {
      requestFamily: 'ollama_chat',
      endpoint: new URL('api/chat', endpointBase).toString(),
      prompt: basePrompt,
      requestBody: {
        model: profile.model,
        stream: streamRequested,
        messages: [{ role: 'user', content: basePrompt }],
        format: kind === 'json' ? 'json' : undefined,
      },
      headers: { 'content-type': 'application/json' },
      streamRequested,
      streamProtocol: streamRequested ? 'ndjson' : 'none',
    }
  }

  if (
    profile.provider === 'openai' ||
    profile.provider === 'deepseek' ||
    profile.provider === 'openrouter' ||
    profile.provider === 'custom' ||
    profile.provider === 'volcano-ark' ||
    profile.provider === 'openai-compatible'
  ) {
    const userContent =
      kind === 'vision'
        ? [
            { type: 'text', text: basePrompt },
            { type: 'image_url', image_url: { url: options.visionImageDataUrl } },
          ]
        : basePrompt
    const body: JsonObject = {
      model: profile.model,
      messages: [
        {
          role: 'system',
          content: 'You are running an AgentHub production readiness probe. Keep the response tiny.',
        },
        { role: 'user', content: userContent },
      ],
      max_tokens: 64,
    }
    if (kind === 'json') body.response_format = { type: 'json_object' }
    if (streamRequested) body.stream = true
    if (kind === 'tool_calling') {
      body.tools = [
        {
          type: 'function',
          function: {
            name: 'agenthub_probe',
            description: 'Report whether the tool calling path works.',
            parameters: {
              type: 'object',
              properties: { ok: { type: 'boolean' } },
              required: ['ok'],
            },
          },
        },
      ]
      body.tool_choice = { type: 'function', function: { name: 'agenthub_probe' } }
    }
    return {
      requestFamily: 'openai_chat_completions',
      endpoint: new URL('chat/completions', endpointBase).toString(),
      prompt: basePrompt,
      requestBody: body,
      headers: { 'content-type': 'application/json' },
      streamRequested,
      streamProtocol: streamRequested ? 'sse' : 'none',
    }
  }

  if (profile.provider === 'google') {
    const endpoint = new URL(
      `models/${normalizeGeminiModelName(profile.model)}:${streamRequested ? 'streamGenerateContent?alt=sse' : 'generateContent'}`,
      endpointBase,
    )
    const parts =
      kind === 'vision'
        ? [
            { text: basePrompt },
            geminiInlineDataPart(options.visionImageDataUrl ?? ''),
          ]
        : [{ text: basePrompt }]
    const body: JsonObject = {
      contents: [{ role: 'user', parts }],
      generationConfig: {
        maxOutputTokens: 64,
        ...(kind === 'json' ? { responseMimeType: 'application/json' } : {}),
      },
    }
    if (kind === 'tool_calling') {
      body.tools = [
        {
          functionDeclarations: [
            {
              name: 'agenthub_probe',
              description: 'Report whether the Gemini function-calling path works.',
              parameters: {
                type: 'object',
                properties: { ok: { type: 'boolean' } },
                required: ['ok'],
              },
            },
          ],
        },
      ]
    }
    return {
      requestFamily: 'google_generate_content',
      endpoint: endpoint.toString(),
      prompt: basePrompt,
      requestBody: body,
      headers: { 'content-type': 'application/json' },
      streamRequested,
      streamProtocol: streamRequested ? 'sse' : 'none',
    }
  }

  return unsupported(`Provider ${profile.provider} is not supported by capability probes yet.`)
}

async function evaluateModelInvocationGate(args: RunModelCapabilityProbeArgs): Promise<{
  allowed: boolean
  reason: string
  goLiveRequired?: boolean
  goLiveDecisionHash?: string | null
  goLiveLatestDecisionHash?: string | null
  goLiveDecisionSatisfied?: boolean
  goLiveLatestDecisionCustomerAuthorizationEvidenceHash?: string | null
  goLiveLatestDecisionCustomerAuthorizationEvidenceMatched?: boolean
  goLiveLatestDecisionEnvironmentFingerprintPresent?: boolean
  goLiveLatestDecisionEnvironmentFingerprintMatched?: boolean
  goLiveLatestDecisionEnvironmentFingerprintMismatches?: string[]
  goLiveCustomerAuthorizationRequired?: boolean
  goLiveCustomerAuthorized?: boolean
  goLiveCustomerAuthorizationSwitchEnabled?: boolean
  goLiveCustomerAuthorizationEvidenceHashRequired?: boolean
  goLiveCustomerAuthorizationEvidenceHash?: string | null
  goLiveCustomerAuthorizationEvidenceMatched?: boolean
  goLiveCustomerAuthorizationEvidenceBoundToDecision?: boolean
  goLiveLivePilotLeaseRequired?: boolean
  goLiveLivePilotLeaseHash?: string | null
  goLiveLatestLivePilotLeaseHash?: string | null
  goLiveLatestLivePilotLeaseActive?: boolean
  goLiveLatestLivePilotLeaseExpiresAt?: number | null
  goLiveLivePilotLeaseMatched?: boolean
  goLiveLivePilotLeaseExpired?: boolean
  goLiveLivePilotLeaseBoundToDecision?: boolean
  goLiveLivePilotLeaseBoundToCustomerAuthorization?: boolean
  goLiveLivePilotLeaseBoundToEnvironmentFingerprint?: boolean
  goLiveLivePilotSessionRequired?: boolean
  goLiveLatestLivePilotSessionId?: string | null
  goLiveLatestLivePilotSessionHash?: string | null
  goLiveLatestLivePilotSessionStatus?: 'active' | 'blocked' | 'expired' | 'stopped' | null
  goLiveLatestLivePilotSessionActive?: boolean
  goLiveLatestLivePilotSessionExpiresAt?: number | null
  goLiveLivePilotSessionBoundToLease?: boolean
  goLiveLivePilotSessionBoundToDecision?: boolean
  goLiveLivePilotSessionBoundToCustomerAuthorization?: boolean
  goLiveLivePilotSessionBoundToEnvironmentFingerprint?: boolean
}> {
  if (!args.live) return { allowed: true, reason: 'dry_run' }
  if (!args.confirmExternalCall) {
    return {
      allowed: false,
      reason: 'Live model invocation requires confirmExternalCall=true because the probe sends a prompt to an external provider.',
    }
  }
  if (process.env.AGENTHUB_ENABLE_REAL_MODEL_INVOCATION !== '1') {
    return {
      allowed: false,
      reason:
        'Live model invocation is blocked because AGENTHUB_ENABLE_REAL_MODEL_INVOCATION is not set to 1.',
    }
  }
  const goLive = await evaluateProductionGoLiveRuntimeGate()
  if (!goLive.allowed) {
    return {
      allowed: false,
      reason: goLive.reason.replace('High-risk runtime control', 'Live model invocation'),
      goLiveRequired: goLive.required,
      goLiveDecisionHash: goLive.requiredDecisionHash,
      goLiveLatestDecisionHash: goLive.latestDecisionHash,
      goLiveDecisionSatisfied: false,
      goLiveLatestDecisionCustomerAuthorizationEvidenceHash:
        goLive.latestDecisionCustomerAuthorizationEvidenceHash,
      goLiveLatestDecisionCustomerAuthorizationEvidenceMatched:
        goLive.latestDecisionCustomerAuthorizationEvidenceMatched,
      goLiveLatestDecisionEnvironmentFingerprintPresent: goLive.latestDecisionEnvironmentFingerprintPresent,
      goLiveLatestDecisionEnvironmentFingerprintMatched: goLive.latestDecisionEnvironmentFingerprintMatched,
      goLiveLatestDecisionEnvironmentFingerprintMismatches: goLive.latestDecisionEnvironmentFingerprintMismatches,
      goLiveCustomerAuthorizationRequired: goLive.customerAuthorizationRequired,
      goLiveCustomerAuthorized: goLive.customerAuthorized,
      goLiveCustomerAuthorizationSwitchEnabled: goLive.customerAuthorizationSwitchEnabled,
      goLiveCustomerAuthorizationEvidenceHashRequired: goLive.customerAuthorizationEvidenceHashRequired,
      goLiveCustomerAuthorizationEvidenceHash: goLive.customerAuthorizationEvidenceHash,
      goLiveCustomerAuthorizationEvidenceMatched: goLive.customerAuthorizationEvidenceMatched,
      goLiveCustomerAuthorizationEvidenceBoundToDecision: goLive.customerAuthorizationEvidenceBoundToDecision,
      goLiveLivePilotLeaseRequired: goLive.livePilotLeaseRequired,
      goLiveLivePilotLeaseHash: goLive.livePilotLeaseHash,
      goLiveLatestLivePilotLeaseHash: goLive.latestLivePilotLeaseHash,
      goLiveLatestLivePilotLeaseActive: goLive.latestLivePilotLeaseActive,
      goLiveLatestLivePilotLeaseExpiresAt: goLive.latestLivePilotLeaseExpiresAt,
      goLiveLivePilotLeaseMatched: goLive.livePilotLeaseMatched,
      goLiveLivePilotLeaseExpired: goLive.livePilotLeaseExpired,
      goLiveLivePilotLeaseBoundToDecision: goLive.livePilotLeaseBoundToDecision,
      goLiveLivePilotLeaseBoundToCustomerAuthorization: goLive.livePilotLeaseBoundToCustomerAuthorization,
      goLiveLivePilotLeaseBoundToEnvironmentFingerprint: goLive.livePilotLeaseBoundToEnvironmentFingerprint,
      goLiveLivePilotSessionRequired: goLive.livePilotSessionRequired,
      goLiveLatestLivePilotSessionId: goLive.latestLivePilotSessionId,
      goLiveLatestLivePilotSessionHash: goLive.latestLivePilotSessionHash,
      goLiveLatestLivePilotSessionStatus: goLive.latestLivePilotSessionStatus,
      goLiveLatestLivePilotSessionActive: goLive.latestLivePilotSessionActive,
      goLiveLatestLivePilotSessionExpiresAt: goLive.latestLivePilotSessionExpiresAt,
      goLiveLivePilotSessionBoundToLease: goLive.livePilotSessionBoundToLease,
      goLiveLivePilotSessionBoundToDecision: goLive.livePilotSessionBoundToDecision,
      goLiveLivePilotSessionBoundToCustomerAuthorization: goLive.livePilotSessionBoundToCustomerAuthorization,
      goLiveLivePilotSessionBoundToEnvironmentFingerprint: goLive.livePilotSessionBoundToEnvironmentFingerprint,
    }
  }
  return {
    allowed: true,
    reason: 'allowed',
    goLiveRequired: goLive.required,
    goLiveDecisionHash: goLive.requiredDecisionHash,
    goLiveLatestDecisionHash: goLive.latestDecisionHash,
    goLiveDecisionSatisfied: true,
    goLiveLatestDecisionCustomerAuthorizationEvidenceHash: goLive.latestDecisionCustomerAuthorizationEvidenceHash,
    goLiveLatestDecisionCustomerAuthorizationEvidenceMatched: goLive.latestDecisionCustomerAuthorizationEvidenceMatched,
    goLiveLatestDecisionEnvironmentFingerprintPresent: goLive.latestDecisionEnvironmentFingerprintPresent,
    goLiveLatestDecisionEnvironmentFingerprintMatched: goLive.latestDecisionEnvironmentFingerprintMatched,
    goLiveLatestDecisionEnvironmentFingerprintMismatches: goLive.latestDecisionEnvironmentFingerprintMismatches,
    goLiveCustomerAuthorizationRequired: goLive.customerAuthorizationRequired,
    goLiveCustomerAuthorized: goLive.customerAuthorized,
    goLiveCustomerAuthorizationSwitchEnabled: goLive.customerAuthorizationSwitchEnabled,
    goLiveCustomerAuthorizationEvidenceHashRequired: goLive.customerAuthorizationEvidenceHashRequired,
    goLiveCustomerAuthorizationEvidenceHash: goLive.customerAuthorizationEvidenceHash,
    goLiveCustomerAuthorizationEvidenceMatched: goLive.customerAuthorizationEvidenceMatched,
    goLiveCustomerAuthorizationEvidenceBoundToDecision: goLive.customerAuthorizationEvidenceBoundToDecision,
    goLiveLivePilotLeaseRequired: goLive.livePilotLeaseRequired,
    goLiveLivePilotLeaseHash: goLive.livePilotLeaseHash,
    goLiveLatestLivePilotLeaseHash: goLive.latestLivePilotLeaseHash,
    goLiveLatestLivePilotLeaseActive: goLive.latestLivePilotLeaseActive,
    goLiveLatestLivePilotLeaseExpiresAt: goLive.latestLivePilotLeaseExpiresAt,
    goLiveLivePilotLeaseMatched: goLive.livePilotLeaseMatched,
    goLiveLivePilotLeaseExpired: goLive.livePilotLeaseExpired,
    goLiveLivePilotLeaseBoundToDecision: goLive.livePilotLeaseBoundToDecision,
    goLiveLivePilotLeaseBoundToCustomerAuthorization: goLive.livePilotLeaseBoundToCustomerAuthorization,
    goLiveLivePilotLeaseBoundToEnvironmentFingerprint: goLive.livePilotLeaseBoundToEnvironmentFingerprint,
    goLiveLivePilotSessionRequired: goLive.livePilotSessionRequired,
    goLiveLatestLivePilotSessionId: goLive.latestLivePilotSessionId,
    goLiveLatestLivePilotSessionHash: goLive.latestLivePilotSessionHash,
    goLiveLatestLivePilotSessionStatus: goLive.latestLivePilotSessionStatus,
    goLiveLatestLivePilotSessionActive: goLive.latestLivePilotSessionActive,
    goLiveLatestLivePilotSessionExpiresAt: goLive.latestLivePilotSessionExpiresAt,
    goLiveLivePilotSessionBoundToLease: goLive.livePilotSessionBoundToLease,
    goLiveLivePilotSessionBoundToDecision: goLive.livePilotSessionBoundToDecision,
    goLiveLivePilotSessionBoundToCustomerAuthorization: goLive.livePilotSessionBoundToCustomerAuthorization,
    goLiveLivePilotSessionBoundToEnvironmentFingerprint: goLive.livePilotSessionBoundToEnvironmentFingerprint,
  }
}

function evaluateModelConnectionGate(args: TestModelConnectionArgs): {
  allowed: boolean
  reason: string
} {
  if (!args.live) return { allowed: true, reason: 'dry_run' }
  if (!args.confirmExternalCall) {
    return {
      allowed: false,
      reason:
        'Live model connection requires confirmExternalCall=true because the test sends a credentialed request to an external provider.',
    }
  }
  if (process.env.AGENTHUB_ENABLE_REAL_MODEL_CONNECTION !== '1') {
    return {
      allowed: false,
      reason:
        'Live model connection is blocked because AGENTHUB_ENABLE_REAL_MODEL_CONNECTION is not set to 1.',
    }
  }
  return { allowed: true, reason: 'allowed' }
}

function evaluateModelEndpointHostGate(endpoint: string, live?: boolean): {
  allowed: boolean
  reason: string
  envVar: string
  configured: boolean
  host: string | null
} {
  const host = endpointHost(endpoint)
  const allowlist = parseModelEndpointHostAllowlist()
  if (!live) {
    return {
      allowed: true,
      reason: 'dry_run',
      envVar: MODEL_ENDPOINT_HOST_ALLOWLIST_ENV,
      configured: allowlist.configured,
      host,
    }
  }
  if (!host) {
    return {
      allowed: false,
      reason: `Live model endpoint host could not be resolved from endpoint ${endpoint}.`,
      envVar: MODEL_ENDPOINT_HOST_ALLOWLIST_ENV,
      configured: allowlist.configured,
      host,
    }
  }
  if (!allowlist.configured) {
    return {
      allowed: false,
      reason: `Live model endpoint ${host} requires ${MODEL_ENDPOINT_HOST_ALLOWLIST_ENV} to list customer-approved provider hosts.`,
      envVar: MODEL_ENDPOINT_HOST_ALLOWLIST_ENV,
      configured: false,
      host,
    }
  }
  const allowed = allowlist.patterns.some((pattern) => modelEndpointHostMatches(host, pattern))
  return {
    allowed,
    reason: allowed
      ? `Live model endpoint ${host} is allowed by ${MODEL_ENDPOINT_HOST_ALLOWLIST_ENV}.`
      : `Live model endpoint ${host} is not in ${MODEL_ENDPOINT_HOST_ALLOWLIST_ENV}.`,
    envVar: MODEL_ENDPOINT_HOST_ALLOWLIST_ENV,
    configured: allowlist.configured,
    host,
  }
}

function endpointHost(endpoint: string): string | null {
  try {
    return new URL(endpoint).hostname.trim().toLowerCase() || null
  } catch {
    return null
  }
}

function parseModelEndpointHostAllowlist(): {
  configured: boolean
  patterns: string[]
} {
  const patterns = (process.env[MODEL_ENDPOINT_HOST_ALLOWLIST_ENV] ?? '')
    .split(/[\s,;]+/u)
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean)
  return { configured: patterns.length > 0, patterns }
}

function modelEndpointHostMatches(host: string, pattern: string): boolean {
  if (pattern === '*') return true
  if (pattern === host) return true
  if (pattern.startsWith('*.')) {
    const suffix = pattern.slice(2)
    return host === suffix || host.endsWith(`.${suffix}`)
  }
  return false
}

async function tryLiveCapabilityProbe(
  plan: CapabilityProbePlan,
  apiKey: string,
  networkRoute: ModelNetworkRoute,
): Promise<{ status: HealthStatus; message: string; metadata: JsonObject }> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 12000)
  try {
    const headers = buildCapabilityProbeHeaders(plan, apiKey)
    const res = await fetchWithNetworkRoute(plan.endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(stripUndefined(plan.requestBody)),
      signal: controller.signal,
    }, networkRoute)
    const responseText = await safeReadResponseText(res)
    if (!res.ok) {
      return {
        status: 'failed',
        message: `Live capability probe failed with HTTP ${res.status}.`,
        metadata: {
          httpStatus: res.status,
          streamHandshakeObserved: false,
          streamResponseContentType: res.headers.get('content-type'),
          responsePreview: redactResponsePreview(responseText),
        },
      }
    }
    return {
      status: 'ok',
      message: 'Live model capability probe completed successfully.',
      metadata: {
        httpStatus: res.status,
        streamHandshakeObserved:
          plan.streamRequested &&
          (res.headers.get('content-type')?.toLowerCase().includes('text/event-stream') ||
            res.headers.get('content-type')?.toLowerCase().includes('application/x-ndjson') ||
            responseText.includes('data:')),
        streamResponseContentType: res.headers.get('content-type'),
        responsePreview: redactResponsePreview(responseText),
      },
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return {
      status: 'failed',
      message: `Live capability probe failed: ${message}`,
      metadata: { error: message },
    }
  } finally {
    clearTimeout(timeout)
  }
}

interface ModelNetworkRoute {
  networkProfile: NetworkProfileRow | null
  metadata: JsonObject
  error?: string
}

async function resolveModelNetworkRoute(profile: ModelProfileRow): Promise<ModelNetworkRoute> {
  if (!profile.networkProfileId) {
    return {
      networkProfile: null,
      metadata: {
        networkRouteMode: 'direct',
        networkEgressApplied: 'direct',
      },
    }
  }
  const networkProfile = await db.query.networkProfiles.findFirst({
    where: eq(schema.networkProfiles.id, profile.networkProfileId),
  })
  if (!networkProfile) {
    return {
      networkProfile: null,
      metadata: {
        networkProfileId: profile.networkProfileId,
        networkRouteMode: 'missing',
        networkEgressApplied: 'blocked',
      },
      error: `Network profile not found: ${profile.networkProfileId}`,
    }
  }

  const metadata: JsonObject = {
    networkProfileId: networkProfile.id,
    networkProfileName: networkProfile.name,
    networkRouteMode: networkProfile.mode,
    networkRegionLabel: networkProfile.regionLabel,
    networkAppliesTo: networkProfile.appliesTo,
  }

  if (networkProfile.mode === 'direct') {
    return {
      networkProfile,
      metadata: { ...metadata, networkEgressApplied: 'direct' },
    }
  }
  if (networkProfile.mode === 'http_proxy' || networkProfile.mode === 'custom_gateway') {
    if (!networkProfile.proxyUrl?.trim()) {
      return {
        networkProfile,
        metadata: { ...metadata, networkEgressApplied: 'blocked' },
        error: `${networkProfile.mode} requires proxyUrl before model traffic can use this outlet.`,
      }
    }
    return {
      networkProfile,
      metadata: {
        ...metadata,
        networkEgressApplied: networkProfile.mode === 'http_proxy' ? 'http_proxy' : 'custom_gateway',
        proxyUrlConfigured: true,
      },
    }
  }
  if (networkProfile.mode === 'socks5_proxy') {
    return {
      networkProfile,
      metadata: { ...metadata, networkEgressApplied: 'blocked', proxyUrlConfigured: Boolean(networkProfile.proxyUrl) },
      error: 'SOCKS5 model egress is not enabled in the Node fetch adapter yet; use an HTTP proxy or custom gateway for model traffic.',
    }
  }
  return {
    networkProfile,
    metadata: { ...metadata, networkEgressApplied: 'blocked' },
    error: `Unsupported network profile mode: ${networkProfile.mode}`,
  }
}

async function fetchWithNetworkRoute(
  input: string | URL,
  init: RequestInit,
  route: ModelNetworkRoute,
): Promise<Response> {
  const dispatcher = await createNetworkDispatcher(route.networkProfile)
  if (!dispatcher) return fetch(input, init)
  const routedInit = { ...init, dispatcher } as RequestInit & { dispatcher: Dispatcher }
  return fetch(input, routedInit)
}

async function recordModelGatewayAudit(args: {
  action: 'model.connect.live' | 'model.invoke.live'
  capability: 'model.connect' | 'model.invoke'
  profile: ModelProfileRow
  row: ModelConnectionTestRow
  credential: Awaited<ReturnType<typeof resolveModelCredential>>
  networkRoute: ModelNetworkRoute
  extra?: JsonObject
}): Promise<void> {
  await recordAuditLog({
    actorType: 'system',
    action: args.action,
    resourceType: 'model_profile',
    resourceId: args.profile.id,
    status: args.row.status === 'ok' ? 'allowed' : 'blocked',
    riskLevel: args.capability === 'model.invoke' ? 'high' : 'medium',
    message: args.row.message,
    metadata: {
      modelConnectionTestId: args.row.id,
      provider: args.profile.provider,
      model: args.profile.model,
      capability: args.capability,
      mode: args.row.mode,
      credentialSource: args.credential.source,
      credentialScopeStatus: args.credential.scopeStatus,
      credentialScopeId: args.credential.scopeId,
      credentialSecretId: args.credential.secretId,
      apiKeyResolved: Boolean(args.credential.value),
      networkRouteMode: args.networkRoute.metadata.networkRouteMode ?? null,
      networkEgressApplied: args.networkRoute.metadata.networkEgressApplied ?? null,
      networkProfileId: args.networkRoute.metadata.networkProfileId ?? null,
      networkProfileName: args.networkRoute.metadata.networkProfileName ?? null,
      networkRegionLabel: args.networkRoute.metadata.networkRegionLabel ?? null,
      modelEndpointAllowlistEnvVar: args.row.capabilityChecks.modelEndpointAllowlistEnvVar ?? null,
      modelEndpointAllowlistConfigured: args.row.capabilityChecks.modelEndpointAllowlistConfigured ?? null,
      modelEndpointHost: args.row.capabilityChecks.modelEndpointHost ?? null,
      modelEndpointAllowed: args.row.capabilityChecks.modelEndpointAllowed ?? null,
      networkError: args.networkRoute.error ?? null,
      redacted: true,
      ...(args.extra ?? {}),
    },
  })
}

async function createNetworkDispatcher(networkProfile: NetworkProfileRow | null): Promise<Dispatcher | null> {
  if (!networkProfile) return null
  if (networkProfile.mode !== 'http_proxy' && networkProfile.mode !== 'custom_gateway') return null
  const proxyUrl = networkProfile.proxyUrl?.trim()
  if (!proxyUrl) return null
  if (!/^https?:\/\//i.test(proxyUrl)) {
    throw new Error(`${networkProfile.mode} proxyUrl must start with http:// or https:// for model fetch routing.`)
  }
  const { ProxyAgent } = await import('undici')
  return new ProxyAgent(proxyUrl)
}

function buildCapabilityProbeHeaders(plan: CapabilityProbePlan, apiKey: string): Record<string, string> {
  if (plan.requestFamily === 'anthropic_messages') {
    return { ...plan.headers, 'x-api-key': apiKey }
  }
  if (plan.requestFamily === 'google_generate_content') {
    return { ...plan.headers, 'x-goog-api-key': apiKey }
  }
  if (plan.requestFamily === 'ollama_chat') return plan.headers
  return { ...plan.headers, Authorization: `Bearer ${apiKey}` }
}

function buildModelListHeaders(profile: ModelProfileRow, apiKey: string): Record<string, string> {
  if (profile.provider === 'anthropic') {
    return { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' }
  }
  if (profile.provider === 'google') return { 'x-goog-api-key': apiKey }
  if (profile.provider === 'ollama') return {}
  return { Authorization: `Bearer ${apiKey}` }
}

function normalizeGeminiModelName(model: string): string {
  const trimmed = model.trim().replace(/^models\//, '')
  return trimmed
    .split('/')
    .filter(Boolean)
    .map((part) => encodeURIComponent(part))
    .join('/')
}

function geminiInlineDataPart(dataUrl: string): JsonObject {
  const match = /^data:([^;,]+);base64,(.+)$/i.exec(dataUrl.trim())
  if (!match) {
    return {
      inlineData: {
        mimeType: 'image/png',
        data: dataUrl.trim(),
      },
    }
  }
  return {
    inlineData: {
      mimeType: match[1],
      data: match[2],
    },
  }
}

function stripUndefined(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripUndefined)
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [key, nested] of Object.entries(value)) {
      if (nested !== undefined) out[key] = stripUndefined(nested)
    }
    return out
  }
  return value
}

async function safeReadResponseText(res: Response): Promise<string> {
  try {
    return await res.text()
  } catch {
    return ''
  }
}

function redactResponsePreview(value: string): string {
  return value.replace(/[A-Za-z0-9_-]{24,}/g, '[redacted]').slice(0, 500)
}

function validateModelProfile(profile: ModelProfileRow): string | null {
  if (!profile.name.trim()) return 'Model profile name is required.'
  if (!profile.model.trim()) return 'Model id is required.'
  if (!profile.apiKeyRef.trim()) return 'apiKeyRef is required so secrets stay indirect.'
  try {
    new URL(profile.baseUrl)
  } catch {
    return 'baseUrl must be a valid URL.'
  }
  return null
}

async function resolveModelCredential(
  profile: ModelProfileRow,
  args: {
    resolveValue: boolean
    capability: 'model.connect' | 'model.invoke'
  },
): Promise<{
  value: string | null
  source: 'env' | 'secret_vault' | 'unresolved'
  secretId: string | null
  scopeStatus: 'not_applicable' | 'dry_checked' | 'allowed' | 'blocked'
  scopeId: string | null
  scopeMessage: string | null
  error: string | null
}> {
  const trimmed = profile.apiKeyRef.trim()
  if (!trimmed) {
    return {
      value: null,
      source: 'unresolved',
      secretId: null,
      scopeStatus: 'not_applicable',
      scopeId: null,
      scopeMessage: null,
      error: null,
    }
  }
  const secretId = parseSecretId(trimmed)
  if (secretId) {
    if (!args.resolveValue) {
      const scope = await checkCredentialScope({
        secretId,
        resourceType: 'model_profile',
        resourceId: profile.id,
        capability: args.capability,
      })
      return {
        value: null,
        source: 'secret_vault',
        secretId,
        scopeStatus: scope.allowed ? 'dry_checked' : 'blocked',
        scopeId: scope.credentialScopeId,
        scopeMessage: scope.reason,
        error: scope.allowed ? null : scope.reason,
      }
    }
    const scope = await checkCredentialScope({
      secretId,
      resourceType: 'model_profile',
      resourceId: profile.id,
      capability: args.capability,
    })
    if (!scope.allowed) {
      return {
        value: null,
        source: 'secret_vault',
        secretId,
        scopeStatus: 'blocked',
        scopeId: null,
        scopeMessage: scope.reason,
        error: scope.reason,
      }
    }
    return {
      value: await resolveSecretValue(secretId),
      source: 'secret_vault',
      secretId,
      scopeStatus: 'allowed',
      scopeId: scope.credentialScopeId,
      scopeMessage: scope.reason,
      error: null,
    }
  }
  if (trimmed.startsWith('env:')) {
    return {
      value: args.resolveValue ? process.env[trimmed.slice(4)] ?? null : null,
      source: 'env',
      secretId: null,
      scopeStatus: 'not_applicable',
      scopeId: null,
      scopeMessage: 'Environment references are not scoped by Credential Scope; production should prefer Secret Vault refs.',
      error: null,
    }
  }
  if (/^[A-Z0-9_]+$/.test(trimmed)) {
    return {
      value: args.resolveValue ? process.env[trimmed] ?? null : null,
      source: 'env',
      secretId: null,
      scopeStatus: 'not_applicable',
      scopeId: null,
      scopeMessage: 'Environment references are not scoped by Credential Scope; production should prefer Secret Vault refs.',
      error: null,
    }
  }
  return {
    value: null,
    source: 'unresolved',
    secretId: null,
    scopeStatus: 'not_applicable',
    scopeId: null,
    scopeMessage: null,
    error: null,
  }
}

function parseSecretId(apiKeyRef: string): string | null {
  if (apiKeyRef.startsWith('secret:')) return apiKeyRef.slice('secret:'.length)
  if (apiKeyRef.startsWith('vault:')) return apiKeyRef.slice('vault:'.length)
  if (apiKeyRef.startsWith('sec_')) return apiKeyRef
  return null
}

async function getRequiredModelProfile(id: string): Promise<ModelProfileRow> {
  const row = await db.query.modelProfiles.findFirst({ where: eq(schema.modelProfiles.id, id) })
  if (!row) throw new Error(`Model profile not found: ${id}`)
  return row
}

async function getOptionalAgentProfile(id: string): Promise<AgentProfileRow | null> {
  return (await db.query.agentProfiles.findFirst({ where: eq(schema.agentProfiles.id, id) })) ?? null
}

function getBoolean(value: JsonObject, key: string): boolean {
  return value[key] === true
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)]
}
