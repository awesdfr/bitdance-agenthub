import { NextRequest, NextResponse } from 'next/server'

import { errorResponse } from '@/app/api/control-plane-utils'
import { HelpCenterItemBody, HelpCenterItemTypeSchema } from '@/server/control-plane-validators'
import { createHelpCenterItem, listHelpCenterItems } from '@/server/help-center-service'

export async function GET(req: NextRequest) {
  try {
    const surfaceId = req.nextUrl.searchParams.get('surfaceId') ?? undefined
    const surfaceKey = req.nextUrl.searchParams.get('surfaceKey') ?? undefined
    const itemTypeParam = req.nextUrl.searchParams.get('itemType') ?? undefined
    const itemType = itemTypeParam ? HelpCenterItemTypeSchema.parse(itemTypeParam) : undefined
    const query = req.nextUrl.searchParams.get('query') ?? undefined
    const limitParam = req.nextUrl.searchParams.get('limit')
    return NextResponse.json({
      items: await listHelpCenterItems({
        surfaceId,
        surfaceKey,
        itemType,
        query,
        limit: limitParam ? Number(limitParam) : undefined,
      }),
    })
  } catch (err) {
    return errorResponse(err)
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = HelpCenterItemBody.parse(await req.json())
    const item = await createHelpCenterItem(body)
    return NextResponse.json({ item }, { status: 201 })
  } catch (err) {
    return errorResponse(err)
  }
}
