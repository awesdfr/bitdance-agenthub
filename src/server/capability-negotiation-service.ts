import { and, desc, eq, inArray, ne } from 'drizzle-orm'

import { db, schema } from '@/db/client'
import type {
  AgentProfileRow,
  CapabilityNegotiationEventRow,
  CapabilityNegotiationEventType,
  CapabilityNegotiationResolution,
  CapabilityNegotiationRow,
  CapabilityNegotiationStatus,
  CapabilityNegotiationStrategies,
  CapabilityNegotiationStrategy,
  JsonObject,
} from '@/db/schema'
import {
  newCapabilityNegotiationEventId,
  newCapabilityNegotiationId,
} from '@/server/ids'
import { createAgentProtocolMessage } from '@/server/agent-communication-protocol-service'
import { recordAuditLog } from '@/server/security-service'

export interface CreateCapabilityNegotiationArgs {
  requesterAgentProfileId: string
  workflowRunId?: string | null
  employeeRunId?: string | null
  taskGoal: string
  requiredCapabilities: string[]
  availableCapabilities?: string[]
  strategies?: Partial<CapabilityNegotiationStrategies>
  candidateAgentProfileIds?: string[]
}

export interface ResolveCapabilityNegotiationArgs {
  negotiationId: string
  strategy: CapabilityNegotiationStrategy
  explanation?: string
  installRequest?: CapabilityNegotiationResolution['installRequest']
  delegation?: CapabilityNegotiationResolution['delegation']
  alternative?: CapabilityNegotiationResolution['alternative']
  degradedScope?: CapabilityNegotiationResolution['degradedScope']
}

export interface CapabilityNegotiationSnapshot {
  negotiation: CapabilityNegotiationRow
  events: CapabilityNegotiationEventRow[]
}

const DEFAULT_STRATEGIES: CapabilityNegotiationStrategies = {
  findAlternative: true,
  requestSkillInstall: true,
  delegateToPeer: true,
  degradeTask: true,
  refuseTask: true,
}

const STRATEGY_TO_EVENT: Record<CapabilityNegotiationStrategy, CapabilityNegotiationEventType> = {
  find_alternative: 'alternative_found',
  request_skill_install: 'skill_install_requested',
  delegate_to_peer: 'delegation_proposed',
  degrade_task: 'task_degraded',
  refuse_task: 'refused',
}

const STRATEGY_TO_FLAG: Record<CapabilityNegotiationStrategy, keyof CapabilityNegotiationStrategies> = {
  find_alternative: 'findAlternative',
  request_skill_install: 'requestSkillInstall',
  delegate_to_peer: 'delegateToPeer',
  degrade_task: 'degradeTask',
  refuse_task: 'refuseTask',
}

export async function createCapabilityNegotiation(
  args: CreateCapabilityNegotiationArgs,
): Promise<CapabilityNegotiationSnapshot> {
  const requester = await getRequiredAgentProfile(args.requesterAgentProfileId)
  const required = normalizeCapabilities(args.requiredCapabilities)
  if (required.length === 0) throw new Error('Capability negotiation requires at least one required capability.')

  const inferred = args.availableCapabilities
    ? normalizeCapabilities(args.availableCapabilities)
    : await inferAgentCapabilities(requester)
  const missing = required.filter((capability) => !capabilitySatisfied(capability, inferred))
  const candidateIds = await resolveCandidateAgentIds(
    requester.id,
    missing,
    args.candidateAgentProfileIds,
  )
  const strategies = { ...DEFAULT_STRATEGIES, ...(args.strategies ?? {}) }
  const now = Date.now()
  const row: CapabilityNegotiationRow = {
    id: newCapabilityNegotiationId(),
    requesterAgentProfileId: requester.id,
    workflowRunId: normalizeOptional(args.workflowRunId),
    employeeRunId: normalizeOptional(args.employeeRunId),
    taskGoal: args.taskGoal.trim(),
    requiredCapabilities: required,
    availableCapabilities: inferred,
    missingCapabilities: missing,
    strategies,
    candidateAgentProfileIds: candidateIds,
    selectedStrategy: null,
    resolution: null,
    status: missing.length === 0 ? 'resolved' : 'open',
    createdAt: now,
    updatedAt: now,
    resolvedAt: missing.length === 0 ? now : null,
  }
  await db.insert(schema.capabilityNegotiations).values(row)
  const selfCheckEvent = await recordCapabilityNegotiationEvent({
    negotiation: row,
    eventType: 'self_check',
    actorAgentProfileId: requester.id,
    summary:
      missing.length === 0
        ? 'All required capabilities are already available.'
        : `Missing capabilities: ${missing.join(', ')}.`,
    payload: {
      required,
      available: inferred,
      missing,
      strategies,
      candidateAgentProfileIds: candidateIds,
    },
    toAgentId: null,
  })
  await recordAuditLog({
    actorType: 'agent',
    actorId: requester.id,
    action: 'capability_negotiation.create',
    resourceType: 'capability_negotiation',
    resourceId: row.id,
    status: missing.length === 0 ? 'allowed' : 'warning',
    riskLevel: missing.length === 0 ? 'low' : 'medium',
    message: `Capability negotiation ${row.id} created with ${missing.length} missing capability entries.`,
    metadata: {
      taskGoal: row.taskGoal,
      required,
      missing,
      candidateAgentProfileIds: candidateIds,
    },
  })
  return { negotiation: row, events: [selfCheckEvent] }
}

export async function resolveCapabilityNegotiation(
  args: ResolveCapabilityNegotiationArgs,
): Promise<CapabilityNegotiationSnapshot> {
  const negotiation = await getRequiredCapabilityNegotiation(args.negotiationId)
  if (negotiation.status !== 'open') {
    throw new Error(`Capability negotiation ${negotiation.id} is ${negotiation.status}.`)
  }
  const flag = STRATEGY_TO_FLAG[args.strategy]
  if (!negotiation.strategies[flag]) {
    throw new Error(`Capability negotiation strategy is disabled: ${args.strategy}`)
  }

  const resolution = await buildResolution(negotiation, args)
  const status: CapabilityNegotiationStatus = args.strategy === 'refuse_task' ? 'failed' : 'resolved'
  const now = Date.now()
  await db
    .update(schema.capabilityNegotiations)
    .set({
      selectedStrategy: args.strategy,
      resolution,
      status,
      updatedAt: now,
      resolvedAt: now,
    })
    .where(eq(schema.capabilityNegotiations.id, negotiation.id))

  const updated = await getRequiredCapabilityNegotiation(negotiation.id)
  const event = await recordCapabilityNegotiationEvent({
    negotiation: updated,
    eventType: STRATEGY_TO_EVENT[args.strategy],
    actorAgentProfileId: updated.requesterAgentProfileId,
    summary: resolution.explanation,
    payload: { resolution: resolution as unknown as JsonObject },
    toAgentId: resolution.delegation?.toAgentId ?? null,
  })
  const finalEvent = await recordCapabilityNegotiationEvent({
    negotiation: updated,
    eventType: 'resolved',
    actorAgentProfileId: updated.requesterAgentProfileId,
    summary: `Negotiation finished with ${args.strategy}.`,
    payload: {
      status,
      selectedStrategy: args.strategy,
      resolution: resolution as unknown as JsonObject,
    },
    toAgentId: null,
  })

  await recordAuditLog({
    actorType: 'agent',
    actorId: updated.requesterAgentProfileId,
    action: 'capability_negotiation.resolve',
    resourceType: 'capability_negotiation',
    resourceId: updated.id,
    status: status === 'resolved' ? 'allowed' : 'blocked',
    riskLevel: args.strategy === 'delegate_to_peer' ? 'medium' : 'low',
    message: `Capability negotiation ${updated.id} resolved via ${args.strategy}.`,
    metadata: {
      status,
      selectedStrategy: args.strategy,
      missingCapabilities: updated.missingCapabilities,
      resolution: resolution as unknown as JsonObject,
    },
  })

  return {
    negotiation: updated,
    events: [event, finalEvent],
  }
}

export async function listCapabilityNegotiations(args: {
  requesterAgentProfileId?: string
  status?: CapabilityNegotiationStatus
  limit?: number
} = {}): Promise<CapabilityNegotiationRow[]> {
  const filters = [
    args.requesterAgentProfileId
      ? eq(schema.capabilityNegotiations.requesterAgentProfileId, args.requesterAgentProfileId)
      : undefined,
    args.status ? eq(schema.capabilityNegotiations.status, args.status) : undefined,
  ].filter(Boolean)
  return db.query.capabilityNegotiations.findMany({
    where: filters.length > 0 ? and(...filters) : undefined,
    orderBy: [desc(schema.capabilityNegotiations.updatedAt)],
    limit: Math.min(Math.max(args.limit ?? 100, 1), 300),
  })
}

export async function listCapabilityNegotiationEvents(args: {
  negotiationId?: string
  eventType?: CapabilityNegotiationEventType
  limit?: number
} = {}): Promise<CapabilityNegotiationEventRow[]> {
  const filters = [
    args.negotiationId ? eq(schema.capabilityNegotiationEvents.negotiationId, args.negotiationId) : undefined,
    args.eventType ? eq(schema.capabilityNegotiationEvents.eventType, args.eventType) : undefined,
  ].filter(Boolean)
  return db.query.capabilityNegotiationEvents.findMany({
    where: filters.length > 0 ? and(...filters) : undefined,
    orderBy: [desc(schema.capabilityNegotiationEvents.createdAt)],
    limit: Math.min(Math.max(args.limit ?? 100, 1), 300),
  })
}

async function buildResolution(
  negotiation: CapabilityNegotiationRow,
  args: ResolveCapabilityNegotiationArgs,
): Promise<CapabilityNegotiationResolution> {
  if (args.strategy === 'request_skill_install') {
    return {
      strategy: args.strategy,
      explanation:
        args.explanation?.trim() ||
        `Request installing a Skill for ${firstMissing(negotiation)} before continuing.`,
      installRequest: args.installRequest ?? {
        skillName: firstMissing(negotiation),
        reason: `The task requires ${firstMissing(negotiation)}, which the Agent does not currently have.`,
        riskLevel: 'medium',
      },
    }
  }
  if (args.strategy === 'delegate_to_peer') {
    const delegation = args.delegation ?? {
      toAgentId: negotiation.candidateAgentProfileIds[0],
      subtask: `Handle missing capability ${firstMissing(negotiation)} for: ${negotiation.taskGoal}`,
      expectedResult: `Return a verifiable result for ${firstMissing(negotiation)}.`,
    }
    if (!delegation.toAgentId) throw new Error('No peer Agent candidate is available for delegation.')
    await getRequiredAgentProfile(delegation.toAgentId)
    return {
      strategy: args.strategy,
      explanation:
        args.explanation?.trim() ||
        `Delegate the missing capability work to Agent ${delegation.toAgentId}.`,
      delegation,
    }
  }
  if (args.strategy === 'find_alternative') {
    return {
      strategy: args.strategy,
      explanation:
        args.explanation?.trim() ||
        `Use an available substitute for ${firstMissing(negotiation)} and record the limitation.`,
      alternative: args.alternative ?? {
        capability: firstMissing(negotiation),
        substituteWith: negotiation.availableCapabilities[0] ?? 'manual_review',
        limitation: 'The substitute may require narrower verification than the requested capability.',
      },
    }
  }
  if (args.strategy === 'degrade_task') {
    return {
      strategy: args.strategy,
      explanation:
        args.explanation?.trim() ||
        'Continue only with the scope that the Agent can complete safely.',
      degradedScope: args.degradedScope ?? {
        canDo: negotiation.availableCapabilities,
        cannotDo: negotiation.missingCapabilities,
      },
    }
  }
  return {
    strategy: args.strategy,
    explanation:
      args.explanation?.trim() ||
      `Refuse the task because required capabilities are missing: ${negotiation.missingCapabilities.join(', ')}.`,
  }
}

async function recordCapabilityNegotiationEvent(args: {
  negotiation: CapabilityNegotiationRow
  eventType: CapabilityNegotiationEventType
  actorAgentProfileId: string | null
  toAgentId: string | null
  summary: string
  payload: JsonObject
}): Promise<CapabilityNegotiationEventRow> {
  const protocolMessage = await createAgentProtocolMessage({
    header: {
      from: args.actorAgentProfileId ?? 'system',
      to: args.toAgentId,
      type: args.eventType === 'refused' ? 'warning' : args.eventType === 'resolved' ? 'response' : 'proposal',
      priority: args.eventType === 'refused' ? 'high' : 'normal',
      replyTo: null,
    },
    body: {
      intent: `capability_negotiation.${args.eventType}`,
      detail: args.summary,
      context: {
        artifacts: [],
        memories: [],
        files: [],
      },
      proposedAction: {
        negotiationId: args.negotiation.id,
        eventType: args.eventType,
        payload: args.payload,
      },
    },
  })
  const row: CapabilityNegotiationEventRow = {
    id: newCapabilityNegotiationEventId(),
    negotiationId: args.negotiation.id,
    eventType: args.eventType,
    actorAgentProfileId: args.actorAgentProfileId,
    protocolMessageId: protocolMessage.id,
    payload: args.payload,
    summary: args.summary,
    createdAt: Date.now(),
  }
  await db.insert(schema.capabilityNegotiationEvents).values(row)
  return row
}

async function resolveCandidateAgentIds(
  requesterAgentProfileId: string,
  missingCapabilities: string[],
  explicitCandidateIds?: string[],
): Promise<string[]> {
  if (explicitCandidateIds && explicitCandidateIds.length > 0) {
    const ids = Array.from(new Set(explicitCandidateIds.map((id) => id.trim()).filter(Boolean)))
    const rows = await db.query.agentProfiles.findMany({
      where: inArray(schema.agentProfiles.id, ids),
      limit: 50,
    })
    const foundIds = new Set(rows.map((row) => row.id))
    const missingIds = ids.filter((id) => !foundIds.has(id))
    if (missingIds.length > 0) throw new Error(`Peer Agent candidates not found: ${missingIds.join(', ')}`)
    return rows.filter((row) => row.id !== requesterAgentProfileId).map((row) => row.id)
  }
  if (missingCapabilities.length === 0) return []
  const peers = await db.query.agentProfiles.findMany({
    where: ne(schema.agentProfiles.id, requesterAgentProfileId),
    limit: 200,
  })
  const scored: Array<{ id: string; score: number }> = []
  for (const peer of peers) {
    if (peer.status === 'archived') continue
    const available = await inferAgentCapabilities(peer)
    const haystack = normalizeCapability([
      peer.name,
      peer.role,
      peer.description,
      peer.systemPrompt,
      peer.behaviorRules.join(' '),
      peer.successCriteria.join(' '),
      JSON.stringify(peer.outputContract),
      available.join(' '),
    ].join(' '))
    const score = missingCapabilities.reduce((sum, capability) => {
      if (capabilitySatisfied(capability, available)) return sum + 5
      const tokens = capabilityTokens(capability)
      return sum + tokens.filter((token) => haystack.includes(token)).length
    }, 0)
    if (score > 0) scored.push({ id: peer.id, score })
  }
  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, 5)
    .map((row) => row.id)
}

async function inferAgentCapabilities(agent: AgentProfileRow): Promise<string[]> {
  const capabilities = [
    'agent_employee',
    `role:${agent.role}`,
    ...extractLooseCapabilities(agent.name, agent.role, agent.description, agent.systemPrompt),
    ...agent.skillIds.map((id) => `skill:${id}`),
    ...agent.mcpServerIds.map((id) => `mcp:${id}`),
    ...agent.cliProfileIds.map((id) => `cli:${id}`),
    ...agent.softwareProfileIds.map((id) => `software:${id}`),
  ]
  const [skills, cliProfiles, softwareProfiles, modelProfile] = await Promise.all([
    agent.skillIds.length
      ? db.query.skills.findMany({ where: inArray(schema.skills.id, agent.skillIds), limit: 100 })
      : [],
    agent.cliProfileIds.length
      ? db.query.cliProfiles.findMany({ where: inArray(schema.cliProfiles.id, agent.cliProfileIds), limit: 100 })
      : [],
    agent.softwareProfileIds.length
      ? db.query.softwareProfiles.findMany({
          where: inArray(schema.softwareProfiles.id, agent.softwareProfileIds),
          limit: 100,
        })
      : [],
    agent.modelProfileId
      ? db.query.modelProfiles.findFirst({ where: eq(schema.modelProfiles.id, agent.modelProfileId) })
      : null,
  ])
  for (const skill of skills) {
    capabilities.push(
      `skill:${skill.name}`,
      ...extractLooseCapabilities(skill.name, skill.description, skill.source, JSON.stringify(skill.manifest)),
    )
  }
  for (const cli of cliProfiles) {
    capabilities.push(
      `cli:${cli.name}`,
      'run:cli',
      ...extractLooseCapabilities(cli.name, cli.command, cli.argsTemplate),
    )
  }
  for (const software of softwareProfiles) {
    capabilities.push(
      `software:${software.name}`,
      `software:${software.appType}`,
      ...extractLooseCapabilities(software.name, software.appType, software.adapterType),
    )
  }
  if (modelProfile) {
    capabilities.push(
      `model:${modelProfile.provider}`,
      `model:${modelProfile.model}`,
      ...(modelProfile.supportsVision ? ['vision', 'read:image', 'read:screenshot'] : []),
      ...(modelProfile.supportsToolCalling ? ['tool_calling', 'use:tools'] : []),
      ...(modelProfile.supportsJsonMode ? ['json_mode', 'output:json'] : []),
    )
  }
  const artifactType = readStringProperty(agent.outputContract, 'artifactType')
  if (artifactType) capabilities.push(`produce:${artifactType}`, artifactType)
  return normalizeCapabilities(capabilities)
}

async function getRequiredAgentProfile(id: string): Promise<AgentProfileRow> {
  const row = await db.query.agentProfiles.findFirst({ where: eq(schema.agentProfiles.id, id) })
  if (!row) throw new Error(`Agent profile not found: ${id}`)
  return row
}

async function getRequiredCapabilityNegotiation(id: string): Promise<CapabilityNegotiationRow> {
  const row = await db.query.capabilityNegotiations.findFirst({
    where: eq(schema.capabilityNegotiations.id, id),
  })
  if (!row) throw new Error(`Capability negotiation not found: ${id}`)
  return row
}

function normalizeCapabilities(values: string[]): string[] {
  return Array.from(new Set(values.map(normalizeCapability).filter(Boolean))).sort()
}

function normalizeCapability(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, '_')
}

function capabilitySatisfied(required: string, available: string[]): boolean {
  if (available.includes(required)) return true
  const requiredTokens = capabilityTokens(required)
  return available.some((capability) => {
    if (capability.includes(required) || required.includes(capability)) return true
    const availableTokens = capabilityTokens(capability)
    return requiredTokens.length > 0 && requiredTokens.every((token) => availableTokens.includes(token))
  })
}

function capabilityTokens(value: string): string[] {
  return normalizeCapability(value)
    .split(/[^a-z0-9]+/i)
    .map((token) => token.trim())
    .filter((token) => token.length > 1)
}

function extractLooseCapabilities(...values: unknown[]): string[] {
  return values
    .flatMap((value) => JSON.stringify(value ?? '').split(/[^a-zA-Z0-9:_-]+/))
    .map((token) => token.trim())
    .filter((token) => token.length > 2 && token.length < 80)
}

function firstMissing(negotiation: CapabilityNegotiationRow): string {
  return negotiation.missingCapabilities[0] ?? negotiation.requiredCapabilities[0] ?? 'missing_capability'
}

function readStringProperty(value: JsonObject, key: string): string | null {
  const raw = value[key]
  return typeof raw === 'string' && raw.trim() ? raw.trim() : null
}

function normalizeOptional(value: string | null | undefined): string | null {
  const trimmed = value?.trim()
  return trimmed ? trimmed : null
}
