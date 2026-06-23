import { NextResponse } from 'next/server'

import { errorResponse, getRouteId } from '@/app/api/control-plane-utils'
import { dispatchWebhookTest } from '@/server/programmatic-api-service'

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const webhookDelivery = await dispatchWebhookTest(await getRouteId(ctx))
    return NextResponse.json({ webhookDelivery }, { status: 201 })
  } catch (err) {
    return errorResponse(err)
  }
}
