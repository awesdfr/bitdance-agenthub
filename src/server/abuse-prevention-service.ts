import { and, desc, eq, inArray } from 'drizzle-orm'

import { db, schema } from '@/db/client'
import type {
  AbuseAppealRow,
  AbuseDetectionEventRow,
  AbusePreventionAction,
  AbusePreventionPolicyRow,
  AbusePreventionPolicyStatus,
  AbusePreventionSeverity,
  JsonObject,
} from '@/db/schema'
import {
  newAbuseAppealId,
  newAbuseDetectionEventId,
  newAbusePreventionPolicyId,
} from '@/server/ids'
import { createNotification } from '@/server/notification-service'
import { recordAuditLog } from '@/server/security-service'

export interface CreateAbusePreventionPolicyArgs {
  name: string
  detectionRules?: {
    agentCreationBurst?: { max: number; windowMs: number }
    outboundRequestBurst?: { max: number; windowMs: number }
    scrapingDetection?: { maxRequestsPerDomain: number }
    spamDetection?: { similarOutputRatio: number }
    intrusionAttempt?: { pattern: string[] }
  }
  onAbuseDetected?: {
    light?: 'warn_user'
    moderate?: 'pause_agent_and_warn'
    severe?: 'stop_and_quarantine_agent'
    critical?: 'stop_all_and_notify_admin'
  }
  status?: AbusePreventionPolicyStatus
}

export interface AbuseSignals {
  agentCreations?: number
  outboundRequests?: Array<{ domain: string }>
  generatedOutputs?: string[]
  intrusionText?: string
  unauthorizedAccessAttempts?: number
}

export interface EvaluateAbuseArgs {
  policyId: string
  agentProfileId?: string | null
  employeeRunId?: string | null
  signals?: AbuseSignals
}

export async function createAbusePreventionPolicy(
  args: CreateAbusePreventionPolicyArgs,
): Promise<AbusePreventionPolicyRow> {
  const now = Date.now()
  const row: AbusePreventionPolicyRow = {
    id: newAbusePreventionPolicyId(),
    name: args.name.trim(),
    agentCreationBurstMax: args.detectionRules?.agentCreationBurst?.max ?? 10,
    agentCreationBurstWindowMs: args.detectionRules?.agentCreationBurst?.windowMs ?? 60 * 60 * 1000,
    outboundRequestBurstMax: args.detectionRules?.outboundRequestBurst?.max ?? 100,
    outboundRequestBurstWindowMs: args.detectionRules?.outboundRequestBurst?.windowMs ?? 60 * 1000,
    maxRequestsPerDomain: args.detectionRules?.scrapingDetection?.maxRequestsPerDomain ?? 30,
    spamSimilarOutputRatio: args.detectionRules?.spamDetection?.similarOutputRatio ?? 0.85,
    intrusionPatterns: args.detectionRules?.intrusionAttempt?.pattern?.length
      ? args.detectionRules.intrusionAttempt.pattern
      : ['bypass approval', 'steal token', 'ignore previous instructions'],
    lightAction: args.onAbuseDetected?.light ?? 'warn_user',
    moderateAction: args.onAbuseDetected?.moderate ?? 'pause_agent_and_warn',
    severeAction: args.onAbuseDetected?.severe ?? 'stop_and_quarantine_agent',
    criticalAction: args.onAbuseDetected?.critical ?? 'stop_all_and_notify_admin',
    status: args.status ?? 'active',
    createdAt: now,
    updatedAt: now,
  }
  await db.insert(schema.abusePreventionPolicies).values(row)
  await recordAuditLog({
    actorType: 'system',
    action: 'abuse_prevention.policy.create',
    resourceType: 'abuse_prevention_policy',
    resourceId: row.id,
    status: 'allowed',
    riskLevel: 'low',
    message: 'Abuse prevention policy created.',
    metadata: policySnapshot(row),
  })
  return row
}

export async function listAbusePreventionPolicies(args: {
  status?: AbusePreventionPolicyStatus
  limit?: number
} = {}): Promise<AbusePreventionPolicyRow[]> {
  return db.query.abusePreventionPolicies.findMany({
    where: args.status ? eq(schema.abusePreventionPolicies.status, args.status) : undefined,
    orderBy: [desc(schema.abusePreventionPolicies.createdAt)],
    limit: Math.min(Math.max(args.limit ?? 50, 1), 200),
  })
}

export async function evaluateAbuseSignals(
  args: EvaluateAbuseArgs,
): Promise<AbuseDetectionEventRow> {
  const policy = await getRequiredPolicy(args.policyId)
  const signals = normalizeSignals(args.signals)
  const detectedRules = detectedRulesForSignals(policy, signals)
  const severity = severityForRules(detectedRules, signals)
  const action = actionForSeverity(policy, severity)
  const result = await applyAbuseAction({
    action,
    severity,
    agentProfileId: normalizeNullable(args.agentProfileId),
    employeeRunId: normalizeNullable(args.employeeRunId),
  })
  const row: AbuseDetectionEventRow = {
    id: newAbuseDetectionEventId(),
    policyId: policy.id,
    agentProfileId: normalizeNullable(args.agentProfileId),
    employeeRunId: normalizeNullable(args.employeeRunId),
    severity,
    action,
    detectedRules,
    signals: signals as unknown as JsonObject,
    result,
    createdAt: Date.now(),
  }
  await db.insert(schema.abuseDetectionEvents).values(row)
  await createNotification({
    level: notificationLevel(severity),
    sourceType: 'abuse_detection_event',
    sourceId: row.id,
    title: severity === 'none' ? 'Abuse check passed' : `Abuse prevention ${severity}`,
    message: row.detectedRules.length > 0 ? row.detectedRules.join(', ') : 'No abuse pattern detected.',
    payload: {
      abuseDetectionEventId: row.id,
      policyId: policy.id,
      action,
      result,
    },
  })
  await recordAuditLog({
    actorType: row.agentProfileId ? 'agent' : 'system',
    actorId: row.agentProfileId,
    action: 'abuse_prevention.evaluate',
    resourceType: 'abuse_detection_event',
    resourceId: row.id,
    status: severity === 'none' || severity === 'light' ? 'allowed' : severity === 'moderate' ? 'warning' : 'blocked',
    riskLevel: severity === 'critical' || severity === 'severe' ? 'high' : severity === 'moderate' ? 'medium' : 'low',
    message: row.detectedRules.length > 0 ? row.detectedRules.join(', ') : 'No abuse pattern detected.',
    metadata: { policyId: policy.id, severity, action, result },
  })
  return row
}

export async function listAbuseDetectionEvents(args: {
  policyId?: string
  agentProfileId?: string
  severity?: AbusePreventionSeverity
  limit?: number
} = {}): Promise<AbuseDetectionEventRow[]> {
  const filters = [
    args.policyId ? eq(schema.abuseDetectionEvents.policyId, args.policyId) : undefined,
    args.agentProfileId ? eq(schema.abuseDetectionEvents.agentProfileId, args.agentProfileId) : undefined,
    args.severity ? eq(schema.abuseDetectionEvents.severity, args.severity) : undefined,
  ].filter(Boolean)
  return db.query.abuseDetectionEvents.findMany({
    where: filters.length > 0 ? and(...filters) : undefined,
    orderBy: [desc(schema.abuseDetectionEvents.createdAt)],
    limit: Math.min(Math.max(args.limit ?? 50, 1), 200),
  })
}

export async function submitAbuseAppeal(args: {
  abuseDetectionEventId: string
  agentProfileId?: string | null
  reason: string
}): Promise<AbuseAppealRow> {
  const event = await getRequiredEvent(args.abuseDetectionEventId)
  const row: AbuseAppealRow = {
    id: newAbuseAppealId(),
    abuseDetectionEventId: event.id,
    agentProfileId: normalizeNullable(args.agentProfileId) ?? event.agentProfileId,
    reason: args.reason.trim(),
    status: 'submitted',
    reviewNote: '',
    createdAt: Date.now(),
    reviewedAt: null,
  }
  await db.insert(schema.abuseAppeals).values(row)
  await createNotification({
    level: 'warning',
    sourceType: 'abuse_appeal',
    sourceId: row.id,
    title: 'Abuse appeal submitted',
    message: row.reason,
    payload: { abuseDetectionEventId: event.id, agentProfileId: row.agentProfileId },
  })
  return row
}

export async function reviewAbuseAppeal(
  id: string,
  approved: boolean,
  reviewNote = '',
): Promise<AbuseAppealRow> {
  const appeal = await getRequiredAppeal(id)
  const now = Date.now()
  await db
    .update(schema.abuseAppeals)
    .set({
      status: approved ? 'approved' : 'rejected',
      reviewNote: reviewNote.trim(),
      reviewedAt: now,
    })
    .where(eq(schema.abuseAppeals.id, id))
  if (approved && appeal.agentProfileId) {
    await db
      .update(schema.agentProfiles)
      .set({ status: 'active', updatedAt: now })
      .where(eq(schema.agentProfiles.id, appeal.agentProfileId))
  }
  const updated = await getRequiredAppeal(id)
  await recordAuditLog({
    actorType: 'system',
    action: 'abuse_prevention.appeal.review',
    resourceType: 'abuse_appeal',
    resourceId: updated.id,
    status: approved ? 'allowed' : 'blocked',
    riskLevel: 'medium',
    message: updated.reviewNote || (approved ? 'Appeal approved.' : 'Appeal rejected.'),
    metadata: {
      abuseDetectionEventId: updated.abuseDetectionEventId,
      agentProfileId: updated.agentProfileId,
      approved,
    },
  })
  return updated
}

export async function listAbuseAppeals(args: {
  status?: AbuseAppealRow['status']
  agentProfileId?: string
  limit?: number
} = {}): Promise<AbuseAppealRow[]> {
  const filters = [
    args.status ? eq(schema.abuseAppeals.status, args.status) : undefined,
    args.agentProfileId ? eq(schema.abuseAppeals.agentProfileId, args.agentProfileId) : undefined,
  ].filter(Boolean)
  return db.query.abuseAppeals.findMany({
    where: filters.length > 0 ? and(...filters) : undefined,
    orderBy: [desc(schema.abuseAppeals.createdAt)],
    limit: Math.min(Math.max(args.limit ?? 50, 1), 200),
  })
}

async function applyAbuseAction(args: {
  action: AbusePreventionAction
  severity: AbusePreventionSeverity
  agentProfileId: string | null
  employeeRunId: string | null
}): Promise<JsonObject> {
  const result: JsonObject = {
    action: args.action,
    pausedRunIds: [],
    stoppedRunIds: [],
    quarantinedAgentId: null,
    adminNotified: false,
  }
  if (args.action === 'none' || args.action === 'warn_user') return result
  if (args.action === 'pause_agent_and_warn') {
    const runIds = await targetRunIds(args)
    for (const runId of runIds) {
      await db
        .update(schema.employeeRuns)
        .set({
          status: 'paused',
          currentPhase: 'paused',
          currentStep: 'Paused by abuse prevention.',
          updatedAt: Date.now(),
        })
        .where(eq(schema.employeeRuns.id, runId))
    }
    result.pausedRunIds = runIds
    return result
  }
  if (args.action === 'stop_and_quarantine_agent') {
    const runIds = await targetRunIds(args)
    for (const runId of runIds) {
      await stopRun(runId)
    }
    result.stoppedRunIds = runIds
    if (args.agentProfileId) {
      await quarantineAgent(args.agentProfileId)
      result.quarantinedAgentId = args.agentProfileId
    }
    return result
  }
  const activeRuns = await db.query.employeeRuns.findMany({
    where: inArray(schema.employeeRuns.status, ['queued', 'running', 'paused']),
  })
  for (const run of activeRuns) {
    await stopRun(run.id)
  }
  result.stoppedRunIds = activeRuns.map((run) => run.id)
  if (args.agentProfileId) {
    await quarantineAgent(args.agentProfileId)
    result.quarantinedAgentId = args.agentProfileId
  }
  result.adminNotified = true
  return result
}

async function targetRunIds(args: {
  agentProfileId: string | null
  employeeRunId: string | null
}): Promise<string[]> {
  if (args.employeeRunId) return [args.employeeRunId]
  if (!args.agentProfileId) return []
  const runs = await db.query.employeeRuns.findMany({
    where: and(
      eq(schema.employeeRuns.agentProfileId, args.agentProfileId),
      inArray(schema.employeeRuns.status, ['queued', 'running', 'paused']),
    ),
  })
  return runs.map((run) => run.id)
}

async function stopRun(runId: string): Promise<void> {
  await db
    .update(schema.employeeRuns)
    .set({
      status: 'aborted',
      currentPhase: 'aborted',
      currentStep: 'Stopped by abuse prevention.',
      updatedAt: Date.now(),
      finishedAt: Date.now(),
    })
    .where(eq(schema.employeeRuns.id, runId))
}

async function quarantineAgent(agentProfileId: string): Promise<void> {
  await db
    .update(schema.agentProfiles)
    .set({ status: 'archived', updatedAt: Date.now() })
    .where(eq(schema.agentProfiles.id, agentProfileId))
}

async function getRequiredPolicy(id: string): Promise<AbusePreventionPolicyRow> {
  const row = await db.query.abusePreventionPolicies.findFirst({
    where: eq(schema.abusePreventionPolicies.id, id),
  })
  if (!row) throw new Error(`Abuse prevention policy not found: ${id}`)
  return row
}

async function getRequiredEvent(id: string): Promise<AbuseDetectionEventRow> {
  const row = await db.query.abuseDetectionEvents.findFirst({
    where: eq(schema.abuseDetectionEvents.id, id),
  })
  if (!row) throw new Error(`Abuse detection event not found: ${id}`)
  return row
}

async function getRequiredAppeal(id: string): Promise<AbuseAppealRow> {
  const row = await db.query.abuseAppeals.findFirst({
    where: eq(schema.abuseAppeals.id, id),
  })
  if (!row) throw new Error(`Abuse appeal not found: ${id}`)
  return row
}

function detectedRulesForSignals(policy: AbusePreventionPolicyRow, signals: Required<AbuseSignals>): string[] {
  const rules: string[] = []
  if (signals.agentCreations > policy.agentCreationBurstMax) rules.push('agent_creation_burst')
  if (signals.outboundRequests.length > policy.outboundRequestBurstMax) rules.push('outbound_request_burst')
  const perDomain = new Map<string, number>()
  for (const request of signals.outboundRequests) {
    perDomain.set(request.domain, (perDomain.get(request.domain) ?? 0) + 1)
  }
  if ([...perDomain.values()].some((count) => count > policy.maxRequestsPerDomain)) {
    rules.push('scraping_detection')
  }
  if (similarOutputRatio(signals.generatedOutputs) >= policy.spamSimilarOutputRatio) {
    rules.push('spam_detection')
  }
  const intrusionText = signals.intrusionText.toLowerCase()
  if (
    policy.intrusionPatterns.some((pattern) => intrusionText.includes(pattern.toLowerCase())) ||
    signals.unauthorizedAccessAttempts > 0
  ) {
    rules.push('intrusion_attempt')
  }
  return rules
}

function severityForRules(
  rules: string[],
  signals: Required<AbuseSignals>,
): AbusePreventionSeverity {
  if (rules.length === 0) return 'none'
  if (rules.includes('intrusion_attempt') && signals.unauthorizedAccessAttempts >= 3) return 'critical'
  if (rules.includes('intrusion_attempt') || rules.includes('scraping_detection')) return 'severe'
  if (rules.includes('outbound_request_burst') || rules.includes('spam_detection')) return 'moderate'
  return 'light'
}

function actionForSeverity(
  policy: AbusePreventionPolicyRow,
  severity: AbusePreventionSeverity,
): AbusePreventionAction {
  if (severity === 'light') return policy.lightAction
  if (severity === 'moderate') return policy.moderateAction
  if (severity === 'severe') return policy.severeAction
  if (severity === 'critical') return policy.criticalAction
  return 'none'
}

function similarOutputRatio(outputs: string[]): number {
  const normalized = outputs.map((output) => output.trim().toLowerCase()).filter(Boolean)
  if (normalized.length < 2) return 0
  const mostCommon = Math.max(
    ...[...new Set(normalized)].map((value) => normalized.filter((item) => item === value).length),
  )
  return mostCommon / normalized.length
}

function notificationLevel(severity: AbusePreventionSeverity): 'info' | 'warning' | 'critical' {
  if (severity === 'critical' || severity === 'severe') return 'critical'
  if (severity === 'moderate' || severity === 'light') return 'warning'
  return 'info'
}

function normalizeSignals(signals: AbuseSignals = {}): Required<AbuseSignals> {
  return {
    agentCreations: Math.max(0, signals.agentCreations ?? 0),
    outboundRequests: signals.outboundRequests ?? [],
    generatedOutputs: signals.generatedOutputs ?? [],
    intrusionText: signals.intrusionText ?? '',
    unauthorizedAccessAttempts: Math.max(0, signals.unauthorizedAccessAttempts ?? 0),
  }
}

function policySnapshot(policy: AbusePreventionPolicyRow): JsonObject {
  return {
    detectionRules: {
      agentCreationBurst: {
        max: policy.agentCreationBurstMax,
        windowMs: policy.agentCreationBurstWindowMs,
      },
      outboundRequestBurst: {
        max: policy.outboundRequestBurstMax,
        windowMs: policy.outboundRequestBurstWindowMs,
      },
      scrapingDetection: { maxRequestsPerDomain: policy.maxRequestsPerDomain },
      spamDetection: { similarOutputRatio: policy.spamSimilarOutputRatio },
      intrusionAttempt: { pattern: policy.intrusionPatterns },
    },
    onAbuseDetected: {
      light: policy.lightAction,
      moderate: policy.moderateAction,
      severe: policy.severeAction,
      critical: policy.criticalAction,
    },
  }
}

function normalizeNullable(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? ''
  return trimmed ? trimmed : null
}
