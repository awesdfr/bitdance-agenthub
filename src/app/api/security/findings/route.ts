import { NextRequest, NextResponse } from 'next/server'

import { errorResponse, parseJsonBody } from '@/app/api/control-plane-utils'
import { SecurityFindingBody } from '@/server/control-plane-validators'
import { createSecurityFinding, listSecurityFindings } from '@/server/security-service'

export async function GET(req: NextRequest) {
  const limit = Number(req.nextUrl.searchParams.get('limit') ?? '100')
  return NextResponse.json({
    securityFindings: await listSecurityFindings(Number.isFinite(limit) ? limit : 100),
  })
}

export async function POST(req: NextRequest) {
  const parsed = await parseJsonBody(req, SecurityFindingBody)
  if (!parsed.ok) return parsed.response
  try {
    const securityFinding = await createSecurityFinding(parsed.data)
    return NextResponse.json({ securityFinding }, { status: 201 })
  } catch (err) {
    return errorResponse(err)
  }
}
