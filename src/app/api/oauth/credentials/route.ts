import { NextRequest, NextResponse } from 'next/server'

import { errorResponse, parseJsonBody } from '@/app/api/control-plane-utils'
import type { OAuthCredentialStatus } from '@/db/schema'
import { OAuthCredentialBody, OAuthProviderSchema } from '@/server/control-plane-validators'
import { createOAuthCredential, listOAuthCredentials } from '@/server/oauth-service'

export async function GET(req: NextRequest) {
  try {
    const providerParam = req.nextUrl.searchParams.get('provider') ?? undefined
    const provider = providerParam ? OAuthProviderSchema.parse(providerParam) : undefined
    const agentProfileId = req.nextUrl.searchParams.get('agentProfileId') ?? undefined
    const sharedParam = req.nextUrl.searchParams.get('shared')
    const status = req.nextUrl.searchParams.get('status') ?? undefined
    const limitParam = req.nextUrl.searchParams.get('limit')
    return NextResponse.json({
      credentials: await listOAuthCredentials({
        provider,
        agentProfileId,
        shared: sharedParam === null ? undefined : sharedParam === 'true',
        status: status as OAuthCredentialStatus | undefined,
        limit: limitParam ? Number(limitParam) : undefined,
      }),
    })
  } catch (err) {
    return errorResponse(err)
  }
}

export async function POST(req: NextRequest) {
  try {
    const parsed = await parseJsonBody(req, OAuthCredentialBody)
    if (!parsed.ok) return parsed.response
    return NextResponse.json(
      { credential: await createOAuthCredential(parsed.data) },
      { status: 201 },
    )
  } catch (err) {
    return errorResponse(err)
  }
}
