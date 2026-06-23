import { NextResponse } from 'next/server'

import { errorResponse } from '@/app/api/control-plane-utils'
import { seedToolInvocationProtocol } from '@/server/tool-invocation-protocol-service'

export async function POST() {
  try {
    return NextResponse.json(await seedToolInvocationProtocol(), { status: 201 })
  } catch (err) {
    return errorResponse(err)
  }
}
