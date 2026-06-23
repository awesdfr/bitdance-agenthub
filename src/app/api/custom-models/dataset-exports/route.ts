import { NextRequest, NextResponse } from 'next/server'

import { errorResponse, parseJsonBody } from '@/app/api/control-plane-utils'
import type { FinetuneDatasetConsentStatus, FinetuneDatasetSourceScope } from '@/db/schema'
import { FinetuneDatasetExportBody } from '@/server/control-plane-validators'
import {
  createFinetuneDatasetExport,
  listFinetuneDatasetExports,
} from '@/server/custom-model-service'

export async function GET(req: NextRequest) {
  try {
    const customModelId = req.nextUrl.searchParams.get('customModelId') ?? undefined
    const consentStatus = req.nextUrl.searchParams.get('consentStatus') ?? undefined
    const sourceScope = req.nextUrl.searchParams.get('sourceScope') ?? undefined
    const limitParam = req.nextUrl.searchParams.get('limit')
    return NextResponse.json({
      exports: await listFinetuneDatasetExports({
        customModelId,
        consentStatus: consentStatus as FinetuneDatasetConsentStatus | undefined,
        sourceScope: sourceScope as FinetuneDatasetSourceScope | undefined,
        limit: limitParam ? Number(limitParam) : undefined,
      }),
    })
  } catch (err) {
    return errorResponse(err)
  }
}

export async function POST(req: NextRequest) {
  try {
    const parsed = await parseJsonBody(req, FinetuneDatasetExportBody)
    if (!parsed.ok) return parsed.response
    return NextResponse.json(
      { exportRecord: await createFinetuneDatasetExport(parsed.data) },
      { status: 201 },
    )
  } catch (err) {
    return errorResponse(err)
  }
}
