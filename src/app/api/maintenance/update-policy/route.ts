import { NextRequest, NextResponse } from 'next/server'

import { errorResponse, parseJsonBody } from '@/app/api/control-plane-utils'
import { UpdatePolicyBody } from '@/server/control-plane-validators'
import { getUpdatePolicy, saveUpdatePolicy } from '@/server/maintenance-service'

export async function GET() {
  return NextResponse.json({ updatePolicy: await getUpdatePolicy() })
}

export async function PUT(req: NextRequest) {
  const parsed = await parseJsonBody(req, UpdatePolicyBody)
  if (!parsed.ok) return parsed.response
  try {
    return NextResponse.json({ updatePolicy: await saveUpdatePolicy(parsed.data) })
  } catch (err) {
    return errorResponse(err)
  }
}
