import { NextResponse } from 'next/server'

import { errorResponse } from '@/app/api/control-plane-utils'
import { seedI18nContractChecks } from '@/server/localization-service'

export async function POST() {
  try {
    return NextResponse.json({ checks: await seedI18nContractChecks() }, { status: 201 })
  } catch (err) {
    return errorResponse(err)
  }
}
