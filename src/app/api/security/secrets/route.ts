import { NextRequest, NextResponse } from 'next/server'

import { errorResponse, parseJsonBody } from '@/app/api/control-plane-utils'
import { SecretBody } from '@/server/control-plane-validators'
import { createSecret, listSecrets } from '@/server/security-service'

export async function GET() {
  return NextResponse.json({ secrets: await listSecrets() })
}

export async function POST(req: NextRequest) {
  const parsed = await parseJsonBody(req, SecretBody)
  if (!parsed.ok) return parsed.response
  try {
    const secret = await createSecret(parsed.data)
    return NextResponse.json({ secret }, { status: 201 })
  } catch (err) {
    return errorResponse(err)
  }
}
