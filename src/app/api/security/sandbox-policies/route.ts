import { NextRequest, NextResponse } from 'next/server'

import { errorResponse, parseJsonBody } from '@/app/api/control-plane-utils'
import { SandboxPolicyBody } from '@/server/control-plane-validators'
import { createSandboxPolicy, listSandboxPolicies } from '@/server/security-service'

export async function GET() {
  return NextResponse.json({ sandboxPolicies: await listSandboxPolicies() })
}

export async function POST(req: NextRequest) {
  const parsed = await parseJsonBody(req, SandboxPolicyBody)
  if (!parsed.ok) return parsed.response
  try {
    const sandboxPolicy = await createSandboxPolicy(parsed.data)
    return NextResponse.json({ sandboxPolicy }, { status: 201 })
  } catch (err) {
    return errorResponse(err)
  }
}
