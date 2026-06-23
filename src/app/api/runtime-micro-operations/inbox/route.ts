import { NextRequest, NextResponse } from 'next/server'

import { errorResponse, parseJsonBody } from '@/app/api/control-plane-utils'
import type { AgentInboxItemStatus, AgentInboxItemType } from '@/db/schema'
import { AgentInboxItemBody } from '@/server/control-plane-validators'
import { createInboxItem, listInboxItems } from '@/server/runtime-micro-operation-service'

export async function GET(req: NextRequest) {
  try {
    return NextResponse.json({
      inboxItems: await listInboxItems({
        status: (req.nextUrl.searchParams.get('status') ?? undefined) as
          | AgentInboxItemStatus
          | undefined,
        itemType: (req.nextUrl.searchParams.get('itemType') ?? undefined) as
          | AgentInboxItemType
          | undefined,
        limit: Number(req.nextUrl.searchParams.get('limit') ?? 50),
      }),
    })
  } catch (err) {
    return errorResponse(err)
  }
}

export async function POST(req: NextRequest) {
  const parsed = await parseJsonBody(req, AgentInboxItemBody)
  if (!parsed.ok) return parsed.response
  try {
    return NextResponse.json({ inboxItem: await createInboxItem(parsed.data) }, { status: 201 })
  } catch (err) {
    return errorResponse(err)
  }
}
