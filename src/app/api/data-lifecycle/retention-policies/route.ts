import { NextRequest, NextResponse } from 'next/server'

import { errorResponse, parseJsonBody } from '@/app/api/control-plane-utils'
import { RetentionPolicyBody } from '@/server/control-plane-validators'
import {
  createRetentionPolicy,
  listRetentionPolicies,
} from '@/server/data-lifecycle-service'

export async function GET() {
  try {
    return NextResponse.json({ retentionPolicies: await listRetentionPolicies() })
  } catch (err) {
    return errorResponse(err)
  }
}

export async function POST(req: NextRequest) {
  try {
    const parsed = await parseJsonBody(req, RetentionPolicyBody)
    if (!parsed.ok) return parsed.response
    const retentionPolicy = await createRetentionPolicy(parsed.data)
    return NextResponse.json({ retentionPolicy }, { status: 201 })
  } catch (err) {
    return errorResponse(err)
  }
}
