import { NextResponse } from 'next/server'

import { errorResponse } from '@/app/api/control-plane-utils'
import { evaluateI18nContract } from '@/server/localization-service'

export async function POST() {
  try {
    return NextResponse.json(await evaluateI18nContract())
  } catch (err) {
    return errorResponse(err)
  }
}
