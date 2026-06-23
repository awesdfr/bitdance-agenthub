import { NextRequest, NextResponse } from 'next/server'

import { errorResponse, parseJsonBody } from '@/app/api/control-plane-utils'
import { CredentialScopeBody } from '@/server/control-plane-validators'
import { createCredentialScope, listCredentialScopes } from '@/server/security-service'

export async function GET() {
  return NextResponse.json({ credentialScopes: await listCredentialScopes() })
}

export async function POST(req: NextRequest) {
  const parsed = await parseJsonBody(req, CredentialScopeBody)
  if (!parsed.ok) return parsed.response
  try {
    const credentialScope = await createCredentialScope(parsed.data)
    return NextResponse.json({ credentialScope }, { status: 201 })
  } catch (err) {
    return errorResponse(err)
  }
}
