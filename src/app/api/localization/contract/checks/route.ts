import { NextRequest, NextResponse } from 'next/server'

import { errorResponse } from '@/app/api/control-plane-utils'
import {
  I18nContractAreaSchema,
  I18nContractStatusSchema,
} from '@/server/control-plane-validators'
import { listI18nContractChecks } from '@/server/localization-service'

export async function GET(req: NextRequest) {
  try {
    const area = req.nextUrl.searchParams.get('area')
    const status = req.nextUrl.searchParams.get('status')
    const limit = req.nextUrl.searchParams.get('limit')
    return NextResponse.json({
      checks: await listI18nContractChecks({
        area: area ? I18nContractAreaSchema.parse(area) : undefined,
        status: status ? I18nContractStatusSchema.parse(status) : undefined,
        limit: limit ? Number(limit) : undefined,
      }),
    })
  } catch (err) {
    return errorResponse(err)
  }
}
