import { NextResponse } from 'next/server'

import { errorResponse } from '@/app/api/control-plane-utils'
import { seedDefaultAgentTemplates } from '@/server/agent-template-marketplace-service'

export async function POST() {
  try {
    return NextResponse.json({ agentTemplates: await seedDefaultAgentTemplates() })
  } catch (err) {
    return errorResponse(err)
  }
}
