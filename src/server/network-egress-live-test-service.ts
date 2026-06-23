import { eq } from 'drizzle-orm'
import type { Dispatcher } from 'undici'

import { db, schema } from '@/db/client'
import type { HealthStatus, JsonObject, NetworkProfileRow } from '@/db/schema'
import { recordAuditLog } from '@/server/security-service'

const DEFAULT_EGRESS_PROBE_URL = 'https://api.ipify.org?format=json'
export const NETWORK_EGRESS_ENV_GATE = 'AGENTHUB_ENABLE_REAL_NETWORK_EGRESS_TEST'

export interface TestNetworkEgressArgs {
  networkProfileId: string
  live?: boolean
  confirmExternalCall?: boolean
  probeUrl?: string | null
}

export interface NetworkEgressLiveTestResult {
  networkProfileId: string
  networkProfileName: string
  mode: NetworkProfileRow['mode']
  regionLabel: string | null
  appliesTo: NetworkProfileRow['appliesTo']
  status: Exclude<HealthStatus, 'unknown'>
  live: boolean
  probeUrl: string
  probeHost: string
  proxyApplied: 'direct' | 'http_proxy' | 'custom_gateway' | 'blocked'
  observedIp: string | null
  responseStatus: number | null
  latencyMs: number
  message: string
  externalCallConfirmed: boolean
  envGate: boolean
  gateAllowed: boolean
  checkedAt: number
}

export async function testNetworkEgress(args: TestNetworkEgressArgs): Promise<NetworkEgressLiveTestResult> {
  const profile = await getRequiredNetworkProfile(args.networkProfileId)
  const checkedAt = Date.now()
  const probeUrl = normalizeProbeUrl(args.probeUrl)
  const gate = evaluateNetworkEgressGate(args)
  const route = await resolveNetworkEgressRoute(profile)
  let status: Exclude<HealthStatus, 'unknown'> = route.error || (args.live && !gate.allowed) ? 'failed' : 'ok'
  let message =
    route.error ??
    (args.live && !gate.allowed ? gate.reason : null) ??
    'Network egress dry-run is ready; no external IP probe was made.'
  let observedIp: string | null = null
  let responseStatus: number | null = null
  const startedAt = Date.now()

  if (args.live && !route.error && gate.allowed) {
    const live = await tryLiveEgressProbe({ profile, probeUrl, route })
    status = live.status
    message = live.message
    observedIp = live.observedIp
    responseStatus = live.responseStatus
  }

  const result: NetworkEgressLiveTestResult = {
    networkProfileId: profile.id,
    networkProfileName: profile.name,
    mode: profile.mode,
    regionLabel: profile.regionLabel,
    appliesTo: profile.appliesTo,
    status,
    live: Boolean(args.live),
    probeUrl,
    probeHost: new URL(probeUrl).host,
    proxyApplied: route.proxyApplied,
    observedIp,
    responseStatus,
    latencyMs: Date.now() - startedAt,
    message,
    externalCallConfirmed: Boolean(args.confirmExternalCall),
    envGate: process.env[NETWORK_EGRESS_ENV_GATE] === '1',
    gateAllowed: gate.allowed,
    checkedAt,
  }

  await db
    .update(schema.networkProfiles)
    .set({
      healthStatus: result.status,
      lastTestResult: result.observedIp
        ? `${result.message} Observed egress IP: ${result.observedIp}.`
        : result.message,
      lastCheckedAt: checkedAt,
      updatedAt: checkedAt,
    })
    .where(eq(schema.networkProfiles.id, profile.id))

  await recordAuditLog({
    actorType: 'system',
    action: args.live ? 'network.egress.live_test' : 'network.egress.dry_run',
    resourceType: 'network_profile',
    resourceId: profile.id,
    status: result.status === 'ok' ? 'allowed' : 'blocked',
    riskLevel: args.live ? 'medium' : 'low',
    message: result.message,
    metadata: {
      networkProfileName: profile.name,
      mode: profile.mode,
      regionLabel: profile.regionLabel,
      appliesTo: profile.appliesTo,
      probeHost: result.probeHost,
      proxyApplied: result.proxyApplied,
      observedIp: result.observedIp,
      responseStatus: result.responseStatus,
      externalCallConfirmed: result.externalCallConfirmed,
      envGate: result.envGate,
      gateAllowed: result.gateAllowed,
      redacted: true,
    },
  })

  return result
}

async function tryLiveEgressProbe(args: {
  profile: NetworkProfileRow
  probeUrl: string
  route: NetworkEgressRouteResolution
}): Promise<{
  status: Exclude<HealthStatus, 'unknown'>
  message: string
  observedIp: string | null
  responseStatus: number | null
}> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 15_000)
  try {
    const dispatcher = await createNetworkDispatcher(args.profile)
    const init = dispatcher
      ? ({ signal: controller.signal, dispatcher } as RequestInit & { dispatcher: Dispatcher })
      : { signal: controller.signal }
    const response = await fetch(args.probeUrl, init)
    const text = await response.text()
    const observedIp = parseObservedIp(text)
    if (!response.ok) {
      return {
        status: 'failed',
        message: `Network egress probe returned HTTP ${response.status}.`,
        observedIp,
        responseStatus: response.status,
      }
    }
    if (!observedIp) {
      return {
        status: 'failed',
        message: 'Network egress probe responded but did not expose an IP address.',
        observedIp: null,
        responseStatus: response.status,
      }
    }
    return {
      status: 'ok',
      message: `Network egress probe succeeded through ${args.route.proxyApplied}.`,
      observedIp,
      responseStatus: response.status,
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return {
      status: 'failed',
      message: `Network egress probe failed: ${message}`,
      observedIp: null,
      responseStatus: null,
    }
  } finally {
    clearTimeout(timeout)
  }
}

interface NetworkEgressRouteResolution {
  proxyApplied: NetworkEgressLiveTestResult['proxyApplied']
  error?: string
}

async function resolveNetworkEgressRoute(profile: NetworkProfileRow): Promise<NetworkEgressRouteResolution> {
  if (profile.mode === 'direct') return { proxyApplied: 'direct' }
  if (profile.mode === 'http_proxy' || profile.mode === 'custom_gateway') {
    if (!profile.proxyUrl?.trim()) {
      return {
        proxyApplied: 'blocked',
        error: `${profile.mode} requires proxyUrl before a live egress IP probe can run.`,
      }
    }
    if (!/^https?:\/\//i.test(profile.proxyUrl.trim())) {
      return {
        proxyApplied: 'blocked',
        error: `${profile.mode} proxyUrl must start with http:// or https://.`,
      }
    }
    return { proxyApplied: profile.mode }
  }
  if (profile.mode === 'socks5_proxy') {
    return {
      proxyApplied: 'blocked',
      error: 'SOCKS5 live egress probing is not enabled in the Node fetch adapter yet; use HTTP proxy or custom gateway.',
    }
  }
  return { proxyApplied: 'blocked', error: `Unsupported network profile mode: ${profile.mode}` }
}

async function createNetworkDispatcher(profile: NetworkProfileRow): Promise<Dispatcher | null> {
  if (profile.mode !== 'http_proxy' && profile.mode !== 'custom_gateway') return null
  const proxyUrl = profile.proxyUrl?.trim()
  if (!proxyUrl) return null
  const { ProxyAgent } = await import('undici')
  return new ProxyAgent(proxyUrl)
}

function evaluateNetworkEgressGate(args: TestNetworkEgressArgs): { allowed: boolean; reason: string } {
  if (!args.live) return { allowed: true, reason: 'Dry-run network egress checks do not make external calls.' }
  if (!args.confirmExternalCall) {
    return { allowed: false, reason: 'confirmExternalCall=true is required before live network egress probing.' }
  }
  if (process.env[NETWORK_EGRESS_ENV_GATE] !== '1') {
    return { allowed: false, reason: `${NETWORK_EGRESS_ENV_GATE}=1 is required before live network egress probing.` }
  }
  return { allowed: true, reason: 'Live network egress probe gate is satisfied.' }
}

function normalizeProbeUrl(value: string | null | undefined): string {
  const raw = value?.trim() || DEFAULT_EGRESS_PROBE_URL
  const url = new URL(raw)
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error('probeUrl must use http:// or https://.')
  }
  return url.toString()
}

function parseObservedIp(text: string): string | null {
  const trimmed = text.trim()
  try {
    const parsed = JSON.parse(trimmed) as JsonObject
    const candidates = [parsed.ip, parsed.origin, parsed.query, parsed.address]
    for (const candidate of candidates) {
      if (typeof candidate === 'string') {
        const ip = firstIp(candidate)
        if (ip) return ip
      }
    }
  } catch {
    // Probe services often return plain text; fall through to regex parsing.
  }
  return firstIp(trimmed)
}

function firstIp(value: string): string | null {
  const ipv4 = value.match(/\b(?:\d{1,3}\.){3}\d{1,3}\b/)
  if (ipv4) return ipv4[0]
  const ipv6 = value.match(/\b[0-9a-fA-F]{0,4}:[0-9a-fA-F:]{2,}\b/)
  return ipv6?.[0] ?? null
}

async function getRequiredNetworkProfile(id: string): Promise<NetworkProfileRow> {
  const row = await db.query.networkProfiles.findFirst({
    where: eq(schema.networkProfiles.id, id),
  })
  if (!row) throw new Error(`Network profile not found: ${id}`)
  return row
}
