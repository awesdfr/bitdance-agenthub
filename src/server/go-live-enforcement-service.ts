import { createHash } from 'node:crypto'

import { desc } from 'drizzle-orm'

import { db, schema } from '@/db/client'

const PRODUCTION_AUDIT_LOOKBACK_LIMIT = 1000
const CUSTOMER_AUTHORIZATION_ENV = 'AGENTHUB_CUSTOMER_ENVIRONMENT_AUTHORIZED'
const CUSTOMER_AUTHORIZATION_EVIDENCE_HASH_ENV = 'AGENTHUB_CUSTOMER_AUTHORIZATION_EVIDENCE_HASH'
export const LIVE_PILOT_LEASE_HASH_ENV = 'AGENTHUB_LIVE_PILOT_LEASE_HASH'
const GO_LIVE_BOUND_ENV_VARS = [
  CUSTOMER_AUTHORIZATION_ENV,
  CUSTOMER_AUTHORIZATION_EVIDENCE_HASH_ENV,
  'AGENTHUB_ADB_ARGS_PREFIX_JSON',
  'AGENTHUB_ADB_PATH',
  'AGENTHUB_ALLOWED_DESKTOP_TARGETS',
  'AGENTHUB_ALLOWED_MOBILE_APP_PACKAGES',
  'AGENTHUB_ALLOWED_MOBILE_DEVICE_IDS',
  'AGENTHUB_ALLOWED_MODEL_ENDPOINT_HOSTS',
  'AGENTHUB_ALLOWED_WORKSTATION_TARGETS',
  'AGENTHUB_ENABLE_REAL_DESKTOP_CAPTURE',
  'AGENTHUB_ENABLE_REAL_DESKTOP_CONTROL',
  'AGENTHUB_ENABLE_REAL_MOBILE_CAPTURE',
  'AGENTHUB_ENABLE_REAL_MOBILE_CONTROL',
  'AGENTHUB_ENABLE_REAL_MODEL_CONNECTION',
  'AGENTHUB_ENABLE_REAL_MODEL_INVOCATION',
  'AGENTHUB_ENABLE_REAL_NETWORK_EGRESS_TEST',
  'AGENTHUB_ENABLE_REAL_WORKSTATION_LAUNCH',
  'AGENTHUB_RUNTIME_CONTROL_KILL_SWITCH',
] as const

export interface EvaluateProductionGoLiveRuntimeGateOptions {
  requireLivePilotLease?: boolean
  requireLivePilotSession?: boolean
}

interface GoLiveEnvironmentFingerprint {
  envVar: string
  configured: boolean
  valueHash: string | null
}

export interface ProductionGoLiveRuntimeGate {
  required: boolean
  requiredDecisionHash: string | null
  latestDecisionHash: string | null
  latestDecisionApproved: boolean
  latestDecisionCustomerAuthorizationEvidenceHash: string | null
  latestDecisionCustomerAuthorizationEvidenceMatched: boolean
  latestDecisionEnvironmentFingerprintPresent: boolean
  latestDecisionEnvironmentFingerprintMatched: boolean
  latestDecisionEnvironmentFingerprintMismatches: string[]
  customerAuthorizationRequired: boolean
  customerAuthorized: boolean
  customerAuthorizationSwitchEnabled: boolean
  customerAuthorizationEvidenceHashRequired: boolean
  customerAuthorizationEvidenceHash: string | null
  customerAuthorizationEvidenceMatched: boolean
  customerAuthorizationEvidenceBoundToDecision: boolean
  customerAuthorizationEvidenceId: string | null
  customerAuthorizationEvidenceTitle: string | null
  livePilotLeaseRequired: boolean
  livePilotLeaseHash: string | null
  latestLivePilotLeaseHash: string | null
  latestLivePilotLeaseActive: boolean
  latestLivePilotLeaseExpiresAt: number | null
  livePilotLeaseMatched: boolean
  livePilotLeaseExpired: boolean
  livePilotLeaseBoundToDecision: boolean
  livePilotLeaseBoundToCustomerAuthorization: boolean
  livePilotLeaseBoundToEnvironmentFingerprint: boolean
  livePilotSessionRequired: boolean
  latestLivePilotSessionId: string | null
  latestLivePilotSessionHash: string | null
  latestLivePilotSessionStatus: 'active' | 'blocked' | 'expired' | 'stopped' | null
  latestLivePilotSessionActive: boolean
  latestLivePilotSessionExpiresAt: number | null
  livePilotSessionBoundToLease: boolean
  livePilotSessionBoundToDecision: boolean
  livePilotSessionBoundToCustomerAuthorization: boolean
  livePilotSessionBoundToEnvironmentFingerprint: boolean
  allowed: boolean
  reason: string
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null'
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  const record = value as Record<string, unknown>
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
    .join(',')}}`
}

function fingerprintHash(fingerprint: GoLiveEnvironmentFingerprint[]): string | null {
  if (fingerprint.length === 0) return null
  return `sha256:${sha256(stableStringify(fingerprint))}`
}

function currentGoLiveEnvironmentFingerprint(): GoLiveEnvironmentFingerprint[] {
  return [...GO_LIVE_BOUND_ENV_VARS]
    .sort((a, b) => a.localeCompare(b))
    .map((envVar) => {
      const value = process.env[envVar]?.trim() ?? ''
      return {
        envVar,
        configured: value.length > 0,
        valueHash: value ? `sha256:${sha256(value)}` : null,
      }
    })
}

function environmentFingerprintFromMetadata(value: unknown): GoLiveEnvironmentFingerprint[] {
  if (!Array.isArray(value)) return []
  return value
    .map((item) => {
      if (!item || typeof item !== 'object') return null
      const record = item as Record<string, unknown>
      const envVar = typeof record.envVar === 'string' ? record.envVar : null
      if (!envVar || !GO_LIVE_BOUND_ENV_VARS.includes(envVar as (typeof GO_LIVE_BOUND_ENV_VARS)[number])) {
        return null
      }
      return {
        envVar,
        configured: record.configured === true,
        valueHash: typeof record.valueHash === 'string' ? record.valueHash : null,
      }
    })
    .filter((item): item is GoLiveEnvironmentFingerprint => Boolean(item))
}

function environmentFingerprintMismatches(
  expected: GoLiveEnvironmentFingerprint[],
  actual: GoLiveEnvironmentFingerprint[],
): string[] {
  const expectedByEnv = new Map(expected.map((item) => [item.envVar, item]))
  const actualByEnv = new Map(actual.map((item) => [item.envVar, item]))
  return [...GO_LIVE_BOUND_ENV_VARS]
    .filter((envVar) => {
      const expectedItem = expectedByEnv.get(envVar)
      const actualItem = actualByEnv.get(envVar)
      return (
        !expectedItem ||
        !actualItem ||
        expectedItem.configured !== actualItem.configured ||
        expectedItem.valueHash !== actualItem.valueHash
      )
    })
    .map((envVar) => String(envVar))
}

export async function evaluateProductionGoLiveRuntimeGate(
  options: EvaluateProductionGoLiveRuntimeGateOptions = {},
): Promise<ProductionGoLiveRuntimeGate> {
  const livePilotLeaseRequired = options.requireLivePilotLease ?? true
  const livePilotSessionRequired = options.requireLivePilotSession ?? true
  const requiredDecisionHash = process.env.AGENTHUB_APPROVED_GO_LIVE_DECISION_HASH?.trim() || null
  const customerAuthorizationSwitchEnabled = process.env[CUSTOMER_AUTHORIZATION_ENV] === '1'
  const customerAuthorizationEvidenceHash = process.env[CUSTOMER_AUTHORIZATION_EVIDENCE_HASH_ENV]?.trim() || null
  const livePilotLeaseHash = process.env[LIVE_PILOT_LEASE_HASH_ENV]?.trim() || null
  const decisionLogs = await db.query.auditLogs.findMany({
    orderBy: [desc(schema.auditLogs.createdAt)],
    limit: PRODUCTION_AUDIT_LOOKBACK_LIMIT,
  })
  const latestDecision = decisionLogs.find((log) => log.action === 'production.go_live.decision') ?? null
  const latestDecisionHash =
    typeof latestDecision?.metadata.contentHash === 'string' ? latestDecision.metadata.contentHash : null
  const latestDecisionCustomerAuthorizationEvidenceHash =
    typeof latestDecision?.metadata.customerAuthorizationEvidenceHash === 'string'
      ? latestDecision.metadata.customerAuthorizationEvidenceHash
      : null
  const latestDecisionCustomerAuthorizationEvidenceMatched =
    latestDecision?.metadata.customerAuthorizationEvidenceMatched === true
  const latestDecisionEnvironmentFingerprint = environmentFingerprintFromMetadata(
    latestDecision?.metadata.environmentFingerprint,
  )
  const currentEnvironmentFingerprint = currentGoLiveEnvironmentFingerprint()
  const latestDecisionEnvironmentFingerprintPresent =
    latestDecisionEnvironmentFingerprint.length === GO_LIVE_BOUND_ENV_VARS.length
  const latestDecisionEnvironmentFingerprintMismatches = environmentFingerprintMismatches(
    latestDecisionEnvironmentFingerprint,
    currentEnvironmentFingerprint,
  )
  const latestDecisionEnvironmentFingerprintMatched =
    latestDecisionEnvironmentFingerprintPresent && latestDecisionEnvironmentFingerprintMismatches.length === 0
  const latestDecisionEnvironmentFingerprintHash = fingerprintHash(latestDecisionEnvironmentFingerprint)
  const latestDecisionApproved =
    latestDecision?.metadata.decision === 'approved' &&
    latestDecision?.metadata.canActivateLive === true &&
    Boolean(latestDecisionHash)
  const customerAuthorizationEvidence =
    customerAuthorizationEvidenceHash
      ? decisionLogs.find(
          (log) =>
            log.action === 'production.final_acceptance.evidence' &&
            log.metadata.category === 'customer_authorization' &&
            log.metadata.contentHash === customerAuthorizationEvidenceHash,
        ) ?? null
      : null
  const customerAuthorizationEvidenceMatched = Boolean(customerAuthorizationEvidence)
  const customerAuthorizationEvidenceBoundToDecision = Boolean(
    customerAuthorizationEvidenceHash &&
      latestDecisionCustomerAuthorizationEvidenceHash &&
      customerAuthorizationEvidenceHash === latestDecisionCustomerAuthorizationEvidenceHash,
  )
  const customerAuthorized = customerAuthorizationSwitchEnabled && customerAuthorizationEvidenceMatched
  const latestLivePilotLease =
    decisionLogs.find((log) => log.action === 'production.live_pilot.lease') ?? null
  const latestLivePilotLeaseHash =
    typeof latestLivePilotLease?.metadata.contentHash === 'string'
      ? latestLivePilotLease.metadata.contentHash
      : null
  const latestLivePilotLeaseExpiresAt =
    typeof latestLivePilotLease?.metadata.expiresAt === 'number'
      ? latestLivePilotLease.metadata.expiresAt
      : null
  const latestLivePilotLeaseActive = Boolean(
    latestLivePilotLease?.metadata.canActivateLivePilot === true &&
      latestLivePilotLeaseExpiresAt !== null &&
      latestLivePilotLeaseExpiresAt > Date.now(),
  )
  const livePilotLease =
    livePilotLeaseHash
      ? decisionLogs.find(
          (log) =>
            log.action === 'production.live_pilot.lease' &&
            log.metadata.contentHash === livePilotLeaseHash,
        ) ?? null
      : null
  const livePilotLeaseExpiresAt =
    typeof livePilotLease?.metadata.expiresAt === 'number' ? livePilotLease.metadata.expiresAt : null
  const livePilotLeaseExpired = livePilotLeaseExpiresAt !== null && livePilotLeaseExpiresAt <= Date.now()
  const livePilotLeaseBoundToDecision = Boolean(
    livePilotLease &&
      latestDecisionHash &&
      livePilotLease.metadata.goLiveDecisionHash === latestDecisionHash,
  )
  const livePilotLeaseBoundToCustomerAuthorization = Boolean(
    livePilotLease &&
      latestDecisionCustomerAuthorizationEvidenceHash &&
      livePilotLease.metadata.customerAuthorizationEvidenceHash ===
        latestDecisionCustomerAuthorizationEvidenceHash,
  )
  const livePilotLeaseBoundToEnvironmentFingerprint = Boolean(
    livePilotLease &&
      latestDecisionEnvironmentFingerprintHash &&
      livePilotLease.metadata.environmentFingerprintHash === latestDecisionEnvironmentFingerprintHash,
  )
  const livePilotLeaseMatched = Boolean(
    livePilotLeaseHash &&
      livePilotLeaseHash === latestLivePilotLeaseHash &&
      livePilotLease?.metadata.canActivateLivePilot === true &&
      !livePilotLeaseExpired &&
      livePilotLeaseBoundToDecision &&
      livePilotLeaseBoundToCustomerAuthorization &&
      livePilotLeaseBoundToEnvironmentFingerprint,
  )
  const livePilotSessionCandidates = decisionLogs.filter(
    (log) => log.action === 'production.live_pilot.session_started',
  )
  const latestLivePilotSession =
    livePilotSessionCandidates.find((log) => {
      if (livePilotLeaseHash && log.metadata.livePilotLeaseHash !== livePilotLeaseHash) return false
      if (latestDecisionHash && log.metadata.goLiveDecisionHash !== latestDecisionHash) return false
      if (
        latestDecisionCustomerAuthorizationEvidenceHash &&
        log.metadata.customerAuthorizationEvidenceHash !== latestDecisionCustomerAuthorizationEvidenceHash
      ) {
        return false
      }
      if (
        latestDecisionEnvironmentFingerprintHash &&
        log.metadata.environmentFingerprintHash !== latestDecisionEnvironmentFingerprintHash
      ) {
        return false
      }
      return true
    }) ?? null
  const latestLivePilotSessionId =
    typeof latestLivePilotSession?.metadata.id === 'string'
      ? latestLivePilotSession.metadata.id
      : null
  const latestLivePilotSessionHash =
    typeof latestLivePilotSession?.metadata.contentHash === 'string'
      ? latestLivePilotSession.metadata.contentHash
      : null
  const latestLivePilotSessionExpiresAt =
    typeof latestLivePilotSession?.metadata.expiresAt === 'number'
      ? latestLivePilotSession.metadata.expiresAt
      : null
  const latestLivePilotSessionStop =
    latestLivePilotSessionId
      ? decisionLogs.find(
          (log) =>
            log.action === 'production.live_pilot.session_stopped' &&
            log.metadata.sessionId === latestLivePilotSessionId,
        ) ?? null
      : null
  const latestLivePilotSessionExpired =
    latestLivePilotSessionExpiresAt !== null && latestLivePilotSessionExpiresAt <= Date.now()
  const livePilotSessionBoundToLease = Boolean(
    latestLivePilotSession &&
      livePilotLeaseHash &&
      latestLivePilotSession.metadata.livePilotLeaseHash === livePilotLeaseHash,
  )
  const livePilotSessionBoundToDecision = Boolean(
    latestLivePilotSession &&
      latestDecisionHash &&
      latestLivePilotSession.metadata.goLiveDecisionHash === latestDecisionHash,
  )
  const livePilotSessionBoundToCustomerAuthorization = Boolean(
    latestLivePilotSession &&
      latestDecisionCustomerAuthorizationEvidenceHash &&
      latestLivePilotSession.metadata.customerAuthorizationEvidenceHash ===
        latestDecisionCustomerAuthorizationEvidenceHash,
  )
  const livePilotSessionBoundToEnvironmentFingerprint = Boolean(
    latestLivePilotSession &&
      latestDecisionEnvironmentFingerprintHash &&
      latestLivePilotSession.metadata.environmentFingerprintHash === latestDecisionEnvironmentFingerprintHash,
  )
  const latestLivePilotSessionStatus: ProductionGoLiveRuntimeGate['latestLivePilotSessionStatus'] =
    latestLivePilotSessionStop
      ? 'stopped'
      : latestLivePilotSessionExpired
        ? 'expired'
        : latestLivePilotSession?.metadata.canRunLivePilot === true
          ? 'active'
          : latestLivePilotSession
            ? 'blocked'
            : null
  const latestLivePilotSessionActive = Boolean(
    latestLivePilotSession &&
      latestLivePilotSessionStatus === 'active' &&
      livePilotSessionBoundToLease &&
      livePilotSessionBoundToDecision &&
      livePilotSessionBoundToCustomerAuthorization &&
      livePilotSessionBoundToEnvironmentFingerprint,
  )

  const blocked = (reason: string): ProductionGoLiveRuntimeGate => ({
    required: true,
    requiredDecisionHash,
    latestDecisionHash,
    latestDecisionApproved,
    latestDecisionCustomerAuthorizationEvidenceHash,
    latestDecisionCustomerAuthorizationEvidenceMatched,
    latestDecisionEnvironmentFingerprintPresent,
    latestDecisionEnvironmentFingerprintMatched,
    latestDecisionEnvironmentFingerprintMismatches,
    customerAuthorizationRequired: true,
    customerAuthorized,
    customerAuthorizationSwitchEnabled,
    customerAuthorizationEvidenceHashRequired: true,
    customerAuthorizationEvidenceHash,
    customerAuthorizationEvidenceMatched,
    customerAuthorizationEvidenceBoundToDecision,
    customerAuthorizationEvidenceId:
      typeof customerAuthorizationEvidence?.metadata.id === 'string'
        ? customerAuthorizationEvidence.metadata.id
        : null,
    customerAuthorizationEvidenceTitle:
      typeof customerAuthorizationEvidence?.metadata.title === 'string'
        ? customerAuthorizationEvidence.metadata.title
        : null,
    livePilotLeaseRequired,
    livePilotLeaseHash,
    latestLivePilotLeaseHash,
    latestLivePilotLeaseActive,
    latestLivePilotLeaseExpiresAt,
    livePilotLeaseMatched,
    livePilotLeaseExpired,
    livePilotLeaseBoundToDecision,
    livePilotLeaseBoundToCustomerAuthorization,
    livePilotLeaseBoundToEnvironmentFingerprint,
    livePilotSessionRequired,
    latestLivePilotSessionId,
    latestLivePilotSessionHash,
    latestLivePilotSessionStatus,
    latestLivePilotSessionActive,
    latestLivePilotSessionExpiresAt,
    livePilotSessionBoundToLease,
    livePilotSessionBoundToDecision,
    livePilotSessionBoundToCustomerAuthorization,
    livePilotSessionBoundToEnvironmentFingerprint,
    allowed: false,
    reason,
  })

  if (!requiredDecisionHash) {
    return blocked(
      'High-risk runtime control requires AGENTHUB_APPROVED_GO_LIVE_DECISION_HASH to match the latest approved go-live decision.',
    )
  }
  if (!latestDecisionHash) {
    return blocked('High-risk runtime control requires an audited approved go-live decision before live execution.')
  }
  if (!latestDecisionApproved) {
    return blocked('The latest go-live decision is not approved; high-risk runtime control remains blocked.')
  }
  if (requiredDecisionHash !== latestDecisionHash) {
    return blocked('AGENTHUB_APPROVED_GO_LIVE_DECISION_HASH does not match the latest approved go-live decision.')
  }
  if (!customerAuthorizationSwitchEnabled) {
    return blocked(
      'High-risk runtime control requires AGENTHUB_CUSTOMER_ENVIRONMENT_AUTHORIZED=1 for the current customer environment.',
    )
  }
  if (!customerAuthorizationEvidenceHash) {
    return blocked(
      'High-risk runtime control requires AGENTHUB_CUSTOMER_AUTHORIZATION_EVIDENCE_HASH to bind live execution to redacted onsite customer authorization evidence.',
    )
  }
  if (!customerAuthorizationEvidenceMatched) {
    return blocked(
      'AGENTHUB_CUSTOMER_AUTHORIZATION_EVIDENCE_HASH does not match any audited customer_authorization onsite evidence record.',
    )
  }
  if (!latestDecisionCustomerAuthorizationEvidenceHash) {
    return blocked(
      'The latest approved go-live decision is not bound to a customer authorization evidence hash.',
    )
  }
  if (!latestDecisionCustomerAuthorizationEvidenceMatched) {
    return blocked(
      'The latest approved go-live decision did not record a matched customer authorization evidence hash.',
    )
  }
  if (!customerAuthorizationEvidenceBoundToDecision) {
    return blocked(
      'AGENTHUB_CUSTOMER_AUTHORIZATION_EVIDENCE_HASH does not match the customer authorization evidence hash bound to the latest approved go-live decision.',
    )
  }
  if (!latestDecisionEnvironmentFingerprintPresent) {
    return blocked(
      'The latest approved go-live decision is not bound to a complete runtime environment fingerprint.',
    )
  }
  if (!latestDecisionEnvironmentFingerprintMatched) {
    return blocked(
      `Current runtime environment fingerprint does not match the latest approved go-live decision: ${latestDecisionEnvironmentFingerprintMismatches.join(', ')}.`,
    )
  }
  if (livePilotLeaseRequired && !livePilotLeaseHash) {
    return blocked(
      `High-risk runtime control requires ${LIVE_PILOT_LEASE_HASH_ENV} to match a non-expired live pilot lease bound to the latest approved go-live decision.`,
    )
  }
  if (livePilotLeaseRequired && !livePilotLease) {
    return blocked(`${LIVE_PILOT_LEASE_HASH_ENV} does not match any audited live pilot lease record.`)
  }
  if (livePilotLeaseRequired && livePilotLeaseHash !== latestLivePilotLeaseHash) {
    return blocked(`${LIVE_PILOT_LEASE_HASH_ENV} does not match the latest audited live pilot lease.`)
  }
  if (livePilotLeaseRequired && livePilotLeaseExpired) {
    return blocked(`${LIVE_PILOT_LEASE_HASH_ENV} is expired; generate a fresh live pilot lease before live execution.`)
  }
  if (livePilotLeaseRequired && livePilotLease?.metadata.canActivateLivePilot !== true) {
    return blocked(`${LIVE_PILOT_LEASE_HASH_ENV} is not marked as safe to activate live pilot execution.`)
  }
  if (livePilotLeaseRequired && !livePilotLeaseBoundToDecision) {
    return blocked(`${LIVE_PILOT_LEASE_HASH_ENV} is not bound to the latest approved go-live decision hash.`)
  }
  if (livePilotLeaseRequired && !livePilotLeaseBoundToCustomerAuthorization) {
    return blocked(`${LIVE_PILOT_LEASE_HASH_ENV} is not bound to the customer authorization evidence hash.`)
  }
  if (livePilotLeaseRequired && !livePilotLeaseBoundToEnvironmentFingerprint) {
    return blocked(`${LIVE_PILOT_LEASE_HASH_ENV} is not bound to the approved runtime environment fingerprint.`)
  }
  if (livePilotSessionRequired && !latestLivePilotSession) {
    return blocked(
      'High-risk runtime control requires an active audited live pilot session before live execution.',
    )
  }
  if (livePilotSessionRequired && latestLivePilotSessionStatus === 'stopped') {
    return blocked('The latest live pilot session has been stopped; start a fresh session before live execution.')
  }
  if (livePilotSessionRequired && latestLivePilotSessionStatus === 'expired') {
    return blocked('The latest live pilot session has expired; start a fresh session before live execution.')
  }
  if (livePilotSessionRequired && !livePilotSessionBoundToLease) {
    return blocked('The latest live pilot session is not bound to the active live pilot lease.')
  }
  if (livePilotSessionRequired && !livePilotSessionBoundToDecision) {
    return blocked('The latest live pilot session is not bound to the latest approved go-live decision.')
  }
  if (livePilotSessionRequired && !livePilotSessionBoundToCustomerAuthorization) {
    return blocked('The latest live pilot session is not bound to the customer authorization evidence hash.')
  }
  if (livePilotSessionRequired && !livePilotSessionBoundToEnvironmentFingerprint) {
    return blocked('The latest live pilot session is not bound to the approved runtime environment fingerprint.')
  }
  if (livePilotSessionRequired && !latestLivePilotSessionActive) {
    return blocked('The latest live pilot session is not active; live execution remains blocked.')
  }
  return {
    required: true,
    requiredDecisionHash,
    latestDecisionHash,
    latestDecisionApproved,
    latestDecisionCustomerAuthorizationEvidenceHash,
    latestDecisionCustomerAuthorizationEvidenceMatched,
    latestDecisionEnvironmentFingerprintPresent,
    latestDecisionEnvironmentFingerprintMatched,
    latestDecisionEnvironmentFingerprintMismatches,
    customerAuthorizationRequired: true,
    customerAuthorized,
    customerAuthorizationSwitchEnabled,
    customerAuthorizationEvidenceHashRequired: true,
    customerAuthorizationEvidenceHash,
    customerAuthorizationEvidenceMatched,
    customerAuthorizationEvidenceBoundToDecision,
    customerAuthorizationEvidenceId:
      typeof customerAuthorizationEvidence?.metadata.id === 'string'
        ? customerAuthorizationEvidence.metadata.id
        : null,
    customerAuthorizationEvidenceTitle:
      typeof customerAuthorizationEvidence?.metadata.title === 'string'
        ? customerAuthorizationEvidence.metadata.title
        : null,
    livePilotLeaseRequired,
    livePilotLeaseHash,
    latestLivePilotLeaseHash,
    latestLivePilotLeaseActive,
    latestLivePilotLeaseExpiresAt,
    livePilotLeaseMatched,
    livePilotLeaseExpired,
    livePilotLeaseBoundToDecision,
    livePilotLeaseBoundToCustomerAuthorization,
    livePilotLeaseBoundToEnvironmentFingerprint,
    livePilotSessionRequired,
    latestLivePilotSessionId,
    latestLivePilotSessionHash,
    latestLivePilotSessionStatus,
    latestLivePilotSessionActive,
    latestLivePilotSessionExpiresAt,
    livePilotSessionBoundToLease,
    livePilotSessionBoundToDecision,
    livePilotSessionBoundToCustomerAuthorization,
    livePilotSessionBoundToEnvironmentFingerprint,
    allowed: true,
    reason:
      livePilotLeaseRequired && livePilotSessionRequired
        ? 'Approved go-live decision hash, customer authorization evidence hash, environment fingerprint, live pilot lease, and live pilot session matched; high-risk runtime control may continue to approval binding.'
        : livePilotLeaseRequired
          ? 'Approved go-live decision hash, customer authorization evidence hash, environment fingerprint, and live pilot lease matched; a live pilot session may be started.'
        : 'Approved go-live decision hash, customer authorization evidence hash, and environment fingerprint matched; live pilot lease may be generated.',
  }
}
