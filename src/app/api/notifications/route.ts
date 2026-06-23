import { NextRequest, NextResponse } from 'next/server'

import { errorResponse, parseJsonBody } from '@/app/api/control-plane-utils'
import { NotificationBody } from '@/server/control-plane-validators'
import { createNotification, listNotifications } from '@/server/notification-service'

export async function GET(req: NextRequest) {
  const status = req.nextUrl.searchParams.get('status')
  return NextResponse.json({
    notifications: await listNotifications(
      status === 'unread' || status === 'read' || status === 'archived' ? status : undefined,
    ),
  })
}

export async function POST(req: NextRequest) {
  const parsed = await parseJsonBody(req, NotificationBody)
  if (!parsed.ok) return parsed.response
  try {
    const notification = await createNotification(parsed.data)
    return NextResponse.json({ notification }, { status: 201 })
  } catch (err) {
    return errorResponse(err)
  }
}
