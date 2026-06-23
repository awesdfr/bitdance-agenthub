import { NextRequest, NextResponse } from 'next/server'

import { errorResponse, parseJsonBody } from '@/app/api/control-plane-utils'
import { ProcessNextInboxItemBody } from '@/server/control-plane-validators'
import { processNextInboxItem } from '@/server/runtime-micro-operation-service'

export async function POST(req: NextRequest) {
  const parsed = await parseJsonBody(req, ProcessNextInboxItemBody)
  if (!parsed.ok) return parsed.response
  try {
    return NextResponse.json({ inboxItem: await processNextInboxItem(parsed.data) }, { status: 201 })
  } catch (err) {
    return errorResponse(err)
  }
}
