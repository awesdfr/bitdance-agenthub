import { and, desc, eq, type SQL } from 'drizzle-orm'

import { db, schema } from '@/db/client'
import type {
  OAuthActingAs,
  OAuthCredentialRow,
  OAuthGrantType,
  OAuthProvider,
  OAuthRefreshEventRow,
} from '@/db/schema'
import { newOAuthCredentialId, newOAuthRefreshEventId } from '@/server/ids'

export interface CreateOAuthCredentialArgs {
  provider: OAuthProvider
  grantType: OAuthGrantType
  accessTokenSecretRef: string
  refreshTokenSecretRef?: string | null
  expiresAt: number
  scopes?: string[]
  actingAs: OAuthActingAs
  autoRefresh?: boolean
  refreshBeforeExpiry?: number
  allowedOperations?: string[]
  requiresUserConsent?: boolean
  shared?: boolean
  agentProfileId?: string | null
}

export interface OAuthOperationEvaluation {
  credentialId: string
  allowed: boolean
  status:
    | 'allowed'
    | 'allowed_with_refresh'
    | 'requires_user_consent'
    | 'refresh_required'
    | 'reauthorization_required'
    | 'denied'
  reasons: string[]
  nextAction: 'execute' | 'refresh_token' | 'request_user_consent' | 'request_reauthorization' | 'block'
  provider: OAuthProvider
  actingAs: OAuthActingAs
  shared: boolean
}

export async function createOAuthCredential(
  args: CreateOAuthCredentialArgs,
): Promise<OAuthCredentialRow> {
  const now = Date.now()
  const row: OAuthCredentialRow = {
    id: newOAuthCredentialId(),
    provider: args.provider,
    grantType: args.grantType,
    accessTokenSecretRef: normalizeRequired(args.accessTokenSecretRef, 'accessTokenSecretRef'),
    refreshTokenSecretRef: args.refreshTokenSecretRef?.trim() || null,
    expiresAt: args.expiresAt,
    scopes: normalizeList(args.scopes),
    actingAs: args.actingAs,
    autoRefresh: args.autoRefresh ?? true,
    refreshBeforeExpiry: Math.max(0, args.refreshBeforeExpiry ?? 300),
    allowedOperations: normalizeList(args.allowedOperations),
    requiresUserConsent: args.requiresUserConsent ?? false,
    shared: args.shared ?? false,
    agentProfileId: args.agentProfileId?.trim() || null,
    status: 'active',
    lastRefreshStatus: null,
    lastRefreshError: null,
    pausedRunId: null,
    reauthorizationUrl: null,
    createdAt: now,
    updatedAt: now,
  }
  await db.insert(schema.oauthCredentials).values(row)
  return row
}

export async function listOAuthCredentials(args: {
  provider?: OAuthProvider
  agentProfileId?: string
  shared?: boolean
  status?: OAuthCredentialRow['status']
  limit?: number
} = {}): Promise<OAuthCredentialRow[]> {
  const conditions: SQL[] = []
  if (args.provider) conditions.push(eq(schema.oauthCredentials.provider, args.provider))
  if (args.status) conditions.push(eq(schema.oauthCredentials.status, args.status))
  if (args.agentProfileId) conditions.push(eq(schema.oauthCredentials.agentProfileId, args.agentProfileId))
  if (args.shared !== undefined) conditions.push(eq(schema.oauthCredentials.shared, args.shared))
  return db.query.oauthCredentials.findMany({
    where: conditions.length ? and(...conditions) : undefined,
    orderBy: [desc(schema.oauthCredentials.updatedAt)],
    limit: args.limit ?? 100,
  })
}

export async function evaluateOAuthOperation(args: {
  credentialId: string
  operation: string
  requiredScope?: string | null
  agentProfileId?: string | null
  now?: number
}): Promise<OAuthOperationEvaluation> {
  const credential = await getRequiredOAuthCredential(args.credentialId)
  const now = args.now ?? Date.now()
  const operation = normalizeRequired(args.operation, 'operation')
  const requiredScope = args.requiredScope?.trim() || null
  const reasons: string[] = []

  if (credential.status === 'revoked') reasons.push('credential_revoked')
  if (credential.status === 'reauth_required') reasons.push('reauthorization_required')
  if (credential.status === 'expired') reasons.push('credential_expired')
  if (!credential.shared && credential.agentProfileId && credential.agentProfileId !== (args.agentProfileId ?? '')) {
    reasons.push('agent_scope_mismatch')
  }
  if (!operationMatches(credential.allowedOperations, operation)) {
    reasons.push(`operation_not_allowed:${operation}`)
  }
  if (requiredScope && !credential.scopes.includes(requiredScope)) {
    reasons.push(`scope_missing:${requiredScope}`)
  }

  if (reasons.length) {
    return {
      credentialId: credential.id,
      allowed: false,
      status: reasons.includes('reauthorization_required') ? 'reauthorization_required' : 'denied',
      reasons,
      nextAction: reasons.includes('reauthorization_required') ? 'request_reauthorization' : 'block',
      provider: credential.provider,
      actingAs: credential.actingAs,
      shared: credential.shared,
    }
  }

  const secondsUntilExpiry = Math.floor((credential.expiresAt - now) / 1000)
  if (secondsUntilExpiry <= 0) {
    if (credential.autoRefresh && credential.refreshTokenSecretRef) {
      return {
        credentialId: credential.id,
        allowed: false,
        status: 'refresh_required',
        reasons: ['token_expired_refresh_required'],
        nextAction: 'refresh_token',
        provider: credential.provider,
        actingAs: credential.actingAs,
        shared: credential.shared,
      }
    }
    return {
      credentialId: credential.id,
      allowed: false,
      status: 'reauthorization_required',
      reasons: ['token_expired_reauthorization_required'],
      nextAction: 'request_reauthorization',
      provider: credential.provider,
      actingAs: credential.actingAs,
      shared: credential.shared,
    }
  }

  if (credential.requiresUserConsent) {
    return {
      credentialId: credential.id,
      allowed: false,
      status: 'requires_user_consent',
      reasons: ['user_consent_required'],
      nextAction: 'request_user_consent',
      provider: credential.provider,
      actingAs: credential.actingAs,
      shared: credential.shared,
    }
  }

  if (credential.autoRefresh && secondsUntilExpiry <= credential.refreshBeforeExpiry) {
    return {
      credentialId: credential.id,
      allowed: true,
      status: 'allowed_with_refresh',
      reasons: ['token_near_expiry_auto_refresh'],
      nextAction: 'refresh_token',
      provider: credential.provider,
      actingAs: credential.actingAs,
      shared: credential.shared,
    }
  }

  return {
    credentialId: credential.id,
    allowed: true,
    status: 'allowed',
    reasons: [],
    nextAction: 'execute',
    provider: credential.provider,
    actingAs: credential.actingAs,
    shared: credential.shared,
  }
}

export async function recordOAuthRefreshFailure(args: {
  credentialId: string
  message: string
  pausedRunId?: string | null
  reauthorizationUrl?: string | null
}): Promise<{ credential: OAuthCredentialRow; event: OAuthRefreshEventRow }> {
  await getRequiredOAuthCredential(args.credentialId)
  const now = Date.now()
  await db
    .update(schema.oauthCredentials)
    .set({
      status: 'reauth_required',
      lastRefreshStatus: 'failed',
      lastRefreshError: normalizeRequired(args.message, 'message'),
      pausedRunId: args.pausedRunId?.trim() || null,
      reauthorizationUrl: args.reauthorizationUrl?.trim() || null,
      updatedAt: now,
    })
    .where(eq(schema.oauthCredentials.id, args.credentialId))
  const event = await recordOAuthRefreshEvent({
    credentialId: args.credentialId,
    status: 'failed',
    message: args.message,
    pausedRunId: args.pausedRunId,
  })
  return { credential: await getRequiredOAuthCredential(args.credentialId), event }
}

export async function completeOAuthReauthorization(args: {
  credentialId: string
  accessTokenSecretRef?: string
  refreshTokenSecretRef?: string | null
  expiresAt: number
  scopes?: string[]
  resumedRunId?: string | null
}): Promise<{ credential: OAuthCredentialRow; event: OAuthRefreshEventRow }> {
  const credential = await getRequiredOAuthCredential(args.credentialId)
  const now = Date.now()
  const nextAccessTokenSecretRef =
    args.accessTokenSecretRef?.trim() || credential.accessTokenSecretRef
  const nextRefreshTokenSecretRef =
    args.refreshTokenSecretRef === undefined
      ? credential.refreshTokenSecretRef
      : args.refreshTokenSecretRef?.trim() || null
  await db
    .update(schema.oauthCredentials)
    .set({
      accessTokenSecretRef: nextAccessTokenSecretRef,
      refreshTokenSecretRef: nextRefreshTokenSecretRef,
      expiresAt: args.expiresAt,
      scopes: args.scopes ? normalizeList(args.scopes) : credential.scopes,
      status: 'active',
      lastRefreshStatus: 'reauthorized',
      lastRefreshError: null,
      pausedRunId: null,
      reauthorizationUrl: null,
      updatedAt: now,
    })
    .where(eq(schema.oauthCredentials.id, args.credentialId))
  const event = await recordOAuthRefreshEvent({
    credentialId: args.credentialId,
    status: 'reauthorized',
    message: args.resumedRunId
      ? `User reauthorized OAuth credential and run ${args.resumedRunId} may resume.`
      : 'User reauthorized OAuth credential.',
    pausedRunId: args.resumedRunId,
  })
  return { credential: await getRequiredOAuthCredential(args.credentialId), event }
}

export async function listOAuthRefreshEvents(args: {
  credentialId?: string
  status?: OAuthRefreshEventRow['status']
  limit?: number
} = {}): Promise<OAuthRefreshEventRow[]> {
  const conditions: SQL[] = []
  if (args.credentialId) conditions.push(eq(schema.oauthRefreshEvents.credentialId, args.credentialId))
  if (args.status) conditions.push(eq(schema.oauthRefreshEvents.status, args.status))
  return db.query.oauthRefreshEvents.findMany({
    where: conditions.length ? and(...conditions) : undefined,
    orderBy: [desc(schema.oauthRefreshEvents.createdAt)],
    limit: args.limit ?? 100,
  })
}

async function getRequiredOAuthCredential(id: string): Promise<OAuthCredentialRow> {
  const credential = await db.query.oauthCredentials.findFirst({
    where: eq(schema.oauthCredentials.id, id),
  })
  if (!credential) throw new Error(`OAuth credential not found: ${id}`)
  return credential
}

async function recordOAuthRefreshEvent(args: {
  credentialId: string
  status: OAuthRefreshEventRow['status']
  message: string
  pausedRunId?: string | null
}): Promise<OAuthRefreshEventRow> {
  const now = Date.now()
  const row: OAuthRefreshEventRow = {
    id: newOAuthRefreshEventId(),
    credentialId: args.credentialId,
    status: args.status,
    message: args.message.trim(),
    pausedRunId: args.pausedRunId?.trim() || null,
    createdAt: now,
    updatedAt: now,
  }
  await db.insert(schema.oauthRefreshEvents).values(row)
  return row
}

function operationMatches(allowedOperations: string[], operation: string): boolean {
  return allowedOperations.includes('*') || allowedOperations.includes(operation)
}

function normalizeList(values: string[] | undefined): string[] {
  return Array.from(new Set((values ?? []).map((value) => value.trim()).filter(Boolean)))
}

function normalizeRequired(value: string, field: string): string {
  const trimmed = value.trim()
  if (!trimmed) throw new Error(`${field} is required`)
  return trimmed
}
