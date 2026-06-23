import { NextRequest, NextResponse } from 'next/server'

import { errorResponse, parseJsonBody } from '@/app/api/control-plane-utils'
import { NotificationPreferenceBody } from '@/server/control-plane-validators'
import {
  listNotificationPreferences,
  upsertNotificationPreference,
} from '@/server/notification-service'

export async function GET() {
  return NextResponse.json({ notificationPreferences: await listNotificationPreferences() })
}

export async function POST(req: NextRequest) {
  const parsed = await parseJsonBody(req, NotificationPreferenceBody)
  if (!parsed.ok) return parsed.response
  try {
    const notificationPreference = await upsertNotificationPreference(parsed.data)
    return NextResponse.json({ notificationPreference }, { status: 201 })
  } catch (err) {
    return errorResponse(err)
  }
}
