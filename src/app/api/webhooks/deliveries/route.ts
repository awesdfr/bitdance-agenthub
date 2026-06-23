import { NextRequest, NextResponse } from 'next/server'

import { listWebhookDeliveries } from '@/server/programmatic-api-service'

export async function GET(req: NextRequest) {
  return NextResponse.json({
    webhookDeliveries: await listWebhookDeliveries({
      subscriptionId: req.nextUrl.searchParams.get('subscriptionId') ?? undefined,
      sdkTaskId: req.nextUrl.searchParams.get('sdkTaskId') ?? undefined,
    }),
  })
}
