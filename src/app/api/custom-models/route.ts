import { NextRequest, NextResponse } from 'next/server'

import { errorResponse, parseJsonBody } from '@/app/api/control-plane-utils'
import type { CustomModelSourceType, CustomModelStatus } from '@/db/schema'
import { CustomModelBody } from '@/server/control-plane-validators'
import { createCustomModel, listCustomModels } from '@/server/custom-model-service'

export async function GET(req: NextRequest) {
  try {
    const sourceType = req.nextUrl.searchParams.get('sourceType') ?? undefined
    const status = req.nextUrl.searchParams.get('status') ?? undefined
    const compatibleSkill = req.nextUrl.searchParams.get('compatibleSkill') ?? undefined
    const limitParam = req.nextUrl.searchParams.get('limit')
    return NextResponse.json({
      customModels: await listCustomModels({
        sourceType: sourceType as CustomModelSourceType | undefined,
        status: status as CustomModelStatus | undefined,
        compatibleSkill,
        limit: limitParam ? Number(limitParam) : undefined,
      }),
    })
  } catch (err) {
    return errorResponse(err)
  }
}

export async function POST(req: NextRequest) {
  try {
    const parsed = await parseJsonBody(req, CustomModelBody)
    if (!parsed.ok) return parsed.response
    return NextResponse.json(
      { customModel: await createCustomModel(parsed.data) },
      { status: 201 },
    )
  } catch (err) {
    return errorResponse(err)
  }
}
