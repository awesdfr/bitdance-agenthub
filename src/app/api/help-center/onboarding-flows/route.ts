import { NextRequest, NextResponse } from 'next/server'

import { errorResponse } from '@/app/api/control-plane-utils'
import { HelpOnboardingFlowBody } from '@/server/control-plane-validators'
import { createHelpOnboardingFlow, listHelpOnboardingFlows } from '@/server/help-center-service'

export async function GET(req: NextRequest) {
  try {
    const flowKey = req.nextUrl.searchParams.get('flowKey') ?? undefined
    const statusParam = req.nextUrl.searchParams.get('status')
    const limitParam = req.nextUrl.searchParams.get('limit')
    return NextResponse.json({
      onboardingFlows: await listHelpOnboardingFlows({
        flowKey,
        status: statusParam === 'active' || statusParam === 'archived' ? statusParam : undefined,
        limit: limitParam ? Number(limitParam) : undefined,
      }),
    })
  } catch (err) {
    return errorResponse(err)
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = HelpOnboardingFlowBody.parse(await req.json())
    const onboardingFlow = await createHelpOnboardingFlow(body)
    return NextResponse.json({ onboardingFlow }, { status: 201 })
  } catch (err) {
    return errorResponse(err)
  }
}
