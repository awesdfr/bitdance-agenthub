import { NextRequest, NextResponse } from 'next/server'

import { errorResponse, parseJsonBody } from '@/app/api/control-plane-utils'
import { WebhookSubscriptionBody } from '@/server/control-plane-validators'
import {
  createWebhookSubscription,
  listWebhookSubscriptions,
} from '@/server/programmatic-api-service'

export async function GET() {
  return NextResponse.json({ webhookSubscriptions: await listWebhookSubscriptions() })
}

export async function POST(req: NextRequest) {
  try {
    const parsed = await parseJsonBody(req, WebhookSubscriptionBody)
    if (!parsed.ok) return parsed.response
    const webhookSubscription = await createWebhookSubscription(parsed.data)
    return NextResponse.json({ webhookSubscription }, { status: 201 })
  } catch (err) {
    return errorResponse(err)
  }
}
