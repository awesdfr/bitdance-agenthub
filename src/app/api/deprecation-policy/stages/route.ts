import { NextResponse } from 'next/server'

import { errorResponse } from '@/app/api/control-plane-utils'
import { listDeprecationPolicyStages } from '@/server/deprecation-policy-service'

export async function GET() {
  try {
    return NextResponse.json({ stages: await listDeprecationPolicyStages() })
  } catch (err) {
    return errorResponse(err)
  }
}
