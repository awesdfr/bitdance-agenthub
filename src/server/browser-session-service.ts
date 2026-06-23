import { and, desc, eq, type SQL } from 'drizzle-orm'

import { db, schema } from '@/db/client'
import type {
  BrowserSessionEventRow,
  BrowserSessionEventStatus,
  BrowserSessionEventType,
  BrowserSessionKeepAliveInterval,
  BrowserSessionMaxAge,
  BrowserSessionRow,
  BrowserSessionStatus,
  JsonObject,
} from '@/db/schema'
import { newBrowserSessionEventId, newBrowserSessionId } from '@/server/ids'

export interface BrowserSessionAccessEvaluation {
  allowed: boolean
  reasons: string[]
  cookieAccess: 'owner' | 'shared' | 'unisolated' | 'blocked'
  session: BrowserSessionRow
  event: BrowserSessionEventRow
}

export interface BrowserSessionKeepAlivePlan {
  shouldRun: boolean
  interval: BrowserSessionKeepAliveInterval | null
  visitUrls: string[]
  nextRunAt: number | null
  session: BrowserSessionRow
  event: BrowserSessionEventRow
}

export interface BrowserSessionExportPlan {
  status: 'planned' | 'blocked'
  reasons: string[]
  manifest: JsonObject
  event: BrowserSessionEventRow
}

export async function registerBrowserSession(args: {
  sessionName: string
  ownerAgentProfileId?: string | null
  sharedWithAgentProfileIds?: string[]
  cookieJarRef: string
  localStorageRef?: string | null
  indexedDbRef?: string | null
  encrypted?: boolean
  persistAfterTask?: boolean
  maxAge?: BrowserSessionMaxAge
  keepAlive?: {
    enabled?: boolean
    interval?: BrowserSessionKeepAliveInterval
    visitUrls?: string[]
  }
  security?: {
    encryptSensitiveCookies?: boolean
    isolateByAgent?: boolean
    exportable?: boolean
    blockedDomains?: string[]
  }
  now?: number
}): Promise<BrowserSessionRow> {
  const now = args.now ?? Date.now()
  const maxAge = args.maxAge ?? '7d'
  const keepAliveEnabled = args.keepAlive?.enabled ?? false
  const keepAliveInterval = keepAliveEnabled ? (args.keepAlive?.interval ?? '4h') : null
  const row: BrowserSessionRow = {
    id: newBrowserSessionId(),
    sessionName: normalizeRequired(args.sessionName, 'sessionName'),
    ownerAgentProfileId: normalizeOptional(args.ownerAgentProfileId),
    sharedWithAgentProfileIds: normalizeList(args.sharedWithAgentProfileIds),
    cookieJarRef: normalizeRequired(args.cookieJarRef, 'cookieJarRef'),
    localStorageRef: normalizeOptional(args.localStorageRef),
    indexedDbRef: normalizeOptional(args.indexedDbRef),
    encrypted: args.encrypted ?? true,
    persistAfterTask: args.persistAfterTask ?? true,
    maxAge,
    keepAliveEnabled,
    keepAliveInterval,
    keepAliveVisitUrls: normalizeList(args.keepAlive?.visitUrls),
    encryptSensitiveCookies: args.security?.encryptSensitiveCookies ?? true,
    isolateByAgent: args.security?.isolateByAgent ?? true,
    exportable: args.security?.exportable ?? false,
    blockedDomains: normalizeList(args.security?.blockedDomains).map(normalizeDomain),
    expiresAt: expiresAtFor(maxAge, now),
    lastKeepAliveAt: null,
    nextKeepAliveAt: keepAliveInterval ? now + intervalMs(keepAliveInterval) : null,
    status: 'active',
    createdAt: now,
    updatedAt: now,
  }
  await db.insert(schema.browserSessions).values(row)
  await recordBrowserSessionEvent({
    browserSessionId: row.id,
    agentProfileId: row.ownerAgentProfileId,
    eventType: 'created',
    status: 'recorded',
    message: 'Browser session metadata registered with encrypted state references.',
    payload: {
      cookieJarRef: row.cookieJarRef,
      localStorageRef: row.localStorageRef,
      indexedDbRef: row.indexedDbRef,
      encrypted: row.encrypted,
      persistAfterTask: row.persistAfterTask,
      maxAge: row.maxAge,
    },
    now,
  })
  return row
}

export async function listBrowserSessions(args: {
  ownerAgentProfileId?: string
  status?: BrowserSessionStatus
  limit?: number
} = {}): Promise<BrowserSessionRow[]> {
  const conditions: SQL[] = []
  if (args.ownerAgentProfileId) {
    conditions.push(eq(schema.browserSessions.ownerAgentProfileId, args.ownerAgentProfileId))
  }
  if (args.status) conditions.push(eq(schema.browserSessions.status, args.status))
  return db.query.browserSessions.findMany({
    where: conditions.length ? and(...conditions) : undefined,
    orderBy: [desc(schema.browserSessions.updatedAt)],
    limit: args.limit ?? 100,
  })
}

export async function evaluateBrowserSessionAccess(
  browserSessionId: string,
  args: {
    agentProfileId?: string | null
    domain?: string | null
    now?: number
  } = {},
): Promise<BrowserSessionAccessEvaluation> {
  const now = args.now ?? Date.now()
  const session = await resolveSessionExpiry(await getRequiredBrowserSession(browserSessionId), now)
  const agentProfileId = normalizeOptional(args.agentProfileId)
  const rawDomain = normalizeOptional(args.domain)
  const domain = rawDomain ? normalizeDomain(rawDomain) : null
  const reasons: string[] = []

  if (session.status !== 'active') reasons.push(`session_${session.status}`)
  if (domain && isBlockedDomain(domain, session.blockedDomains)) {
    reasons.push(`domain_blocked:${domain}`)
  }

  let cookieAccess: BrowserSessionAccessEvaluation['cookieAccess'] = 'unisolated'
  if (session.isolateByAgent) {
    if (!agentProfileId) {
      reasons.push('agent_required_for_isolated_session')
      cookieAccess = 'blocked'
    } else if (agentProfileId === session.ownerAgentProfileId) {
      cookieAccess = 'owner'
    } else if (session.sharedWithAgentProfileIds.includes(agentProfileId)) {
      cookieAccess = 'shared'
    } else {
      reasons.push('agent_not_allowed')
      cookieAccess = 'blocked'
    }
  }

  const allowed = reasons.length === 0
  if (!allowed) cookieAccess = 'blocked'
  const event = await recordBrowserSessionEvent({
    browserSessionId: session.id,
    agentProfileId,
    eventType: 'access_evaluated',
    domain,
    status: allowed ? 'allowed' : 'blocked',
    message: allowed ? 'Browser session access allowed.' : `Browser session access blocked: ${reasons.join(', ')}`,
    payload: {
      cookieAccess,
      reasons,
      encrypted: session.encrypted,
      cookieJarRef: session.cookieJarRef,
    },
    now,
  })

  return { allowed, reasons, cookieAccess, session, event }
}

export async function planBrowserSessionKeepAlive(
  browserSessionId: string,
  args: { now?: number } = {},
): Promise<BrowserSessionKeepAlivePlan> {
  const now = args.now ?? Date.now()
  const session = await resolveSessionExpiry(await getRequiredBrowserSession(browserSessionId), now)
  const reasons: string[] = []
  if (session.status !== 'active') reasons.push(`session_${session.status}`)
  if (!session.keepAliveEnabled || !session.keepAliveInterval) reasons.push('keep_alive_disabled')
  const shouldRun = reasons.length === 0 && (session.nextKeepAliveAt === null || session.nextKeepAliveAt <= now)
  const nextRunAt =
    session.keepAliveEnabled && session.keepAliveInterval
      ? now + intervalMs(session.keepAliveInterval)
      : session.nextKeepAliveAt

  let updated = session
  if (shouldRun) {
    await db
      .update(schema.browserSessions)
      .set({
        lastKeepAliveAt: now,
        nextKeepAliveAt: nextRunAt,
        updatedAt: now,
      })
      .where(eq(schema.browserSessions.id, session.id))
    updated = await getRequiredBrowserSession(session.id)
  }

  const event = await recordBrowserSessionEvent({
    browserSessionId: session.id,
    agentProfileId: session.ownerAgentProfileId,
    eventType: 'keep_alive_planned',
    status: shouldRun ? 'planned' : 'blocked',
    message: shouldRun ? 'Keep-alive visit is due.' : `Keep-alive not due: ${reasons.join(', ') || 'not_due'}`,
    payload: {
      shouldRun,
      interval: session.keepAliveInterval,
      visitUrls: session.keepAliveVisitUrls,
      nextRunAt,
      reasons,
    },
    now,
  })

  return {
    shouldRun,
    interval: updated.keepAliveInterval,
    visitUrls: updated.keepAliveVisitUrls,
    nextRunAt: updated.nextKeepAliveAt,
    session: updated,
    event,
  }
}

export async function planBrowserSessionExport(
  browserSessionId: string,
  args: {
    requestedByAgentProfileId?: string | null
    format?: 'encrypted_bundle_manifest'
  } = {},
): Promise<BrowserSessionExportPlan> {
  const now = Date.now()
  const session = await resolveSessionExpiry(await getRequiredBrowserSession(browserSessionId), now)
  const requestedByAgentProfileId = normalizeOptional(args.requestedByAgentProfileId)
  const reasons: string[] = []
  if (session.status !== 'active') reasons.push(`session_${session.status}`)
  if (!session.exportable) reasons.push('export_disabled')
  if (!session.encrypted || !session.encryptSensitiveCookies) reasons.push('encrypted_export_required')
  if (
    requestedByAgentProfileId &&
    session.isolateByAgent &&
    requestedByAgentProfileId !== session.ownerAgentProfileId &&
    !session.sharedWithAgentProfileIds.includes(requestedByAgentProfileId)
  ) {
    reasons.push('requesting_agent_not_allowed')
  }
  const status = reasons.length ? 'blocked' : 'planned'
  const manifest: JsonObject = {
    format: args.format ?? 'encrypted_bundle_manifest',
    browserSessionId: session.id,
    sessionName: session.sessionName,
    encrypted: true,
    includesRefsOnly: true,
    cookieJarRef: session.cookieJarRef,
    localStorageRef: session.localStorageRef,
    indexedDbRef: session.indexedDbRef,
    blockedDomains: session.blockedDomains,
  }
  const event = await recordBrowserSessionEvent({
    browserSessionId: session.id,
    agentProfileId: requestedByAgentProfileId,
    eventType: 'export_planned',
    status: status === 'planned' ? 'planned' : 'blocked',
    message: status === 'planned' ? 'Encrypted browser session export manifest planned.' : `Export blocked: ${reasons.join(', ')}`,
    payload: { manifest, reasons },
    now,
  })
  return { status, reasons, manifest, event }
}

export async function listBrowserSessionEvents(args: {
  browserSessionId?: string
  limit?: number
} = {}): Promise<BrowserSessionEventRow[]> {
  return db.query.browserSessionEvents.findMany({
    where: args.browserSessionId
      ? eq(schema.browserSessionEvents.browserSessionId, args.browserSessionId)
      : undefined,
    orderBy: [desc(schema.browserSessionEvents.createdAt)],
    limit: args.limit ?? 100,
  })
}

async function resolveSessionExpiry(
  session: BrowserSessionRow,
  now: number,
): Promise<BrowserSessionRow> {
  if (session.status === 'active' && session.expiresAt !== null && session.expiresAt <= now) {
    await db
      .update(schema.browserSessions)
      .set({ status: 'expired', updatedAt: now })
      .where(eq(schema.browserSessions.id, session.id))
    await recordBrowserSessionEvent({
      browserSessionId: session.id,
      agentProfileId: session.ownerAgentProfileId,
      eventType: 'expired',
      status: 'recorded',
      message: 'Browser session exceeded maxAge.',
      payload: { expiresAt: session.expiresAt },
      now,
    })
    return getRequiredBrowserSession(session.id)
  }
  return session
}

async function getRequiredBrowserSession(id: string): Promise<BrowserSessionRow> {
  const row = await db.query.browserSessions.findFirst({
    where: eq(schema.browserSessions.id, id),
  })
  if (!row) throw new Error(`Browser session not found: ${id}`)
  return row
}

async function recordBrowserSessionEvent(args: {
  browserSessionId: string
  agentProfileId?: string | null
  eventType: BrowserSessionEventType
  domain?: string | null
  status?: BrowserSessionEventStatus
  message?: string
  payload?: JsonObject
  now?: number
}): Promise<BrowserSessionEventRow> {
  const event: BrowserSessionEventRow = {
    id: newBrowserSessionEventId(),
    browserSessionId: args.browserSessionId,
    agentProfileId: normalizeOptional(args.agentProfileId),
    eventType: args.eventType,
    domain: normalizeOptional(args.domain),
    status: args.status ?? 'recorded',
    message: args.message ?? '',
    payload: args.payload ?? {},
    createdAt: args.now ?? Date.now(),
  }
  await db.insert(schema.browserSessionEvents).values(event)
  return event
}

function expiresAtFor(maxAge: BrowserSessionMaxAge, now: number): number | null {
  if (maxAge === 'forever') return null
  const days = maxAge === '1d' ? 1 : maxAge === '7d' ? 7 : 30
  return now + days * 24 * 60 * 60 * 1000
}

function intervalMs(interval: BrowserSessionKeepAliveInterval): number {
  if (interval === '1h') return 60 * 60 * 1000
  if (interval === '4h') return 4 * 60 * 60 * 1000
  return 12 * 60 * 60 * 1000
}

function isBlockedDomain(domain: string, blockedDomains: string[]): boolean {
  return blockedDomains.some((blocked) => domain === blocked || domain.endsWith(`.${blocked}`))
}

function normalizeDomain(value: string): string {
  const trimmed = value.trim().toLowerCase()
  try {
    const parsed = new URL(trimmed.includes('://') ? trimmed : `https://${trimmed}`)
    return parsed.hostname.replace(/^www\./, '')
  } catch {
    return trimmed.replace(/^www\./, '').split('/')[0]
  }
}

function normalizeList(values: string[] | undefined): string[] {
  return Array.from(new Set((values ?? []).map((value) => value.trim()).filter(Boolean)))
}

function normalizeOptional(value: string | null | undefined): string | null {
  const trimmed = value?.trim()
  return trimmed ? trimmed : null
}

function normalizeRequired(value: string, field: string): string {
  const trimmed = value.trim()
  if (!trimmed) throw new Error(`${field} is required`)
  return trimmed
}
