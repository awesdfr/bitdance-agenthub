import { NextResponse } from 'next/server'

import { errorResponse } from '@/app/api/control-plane-utils'
import { getAcceptanceCriteriaDefinitions } from '@/server/acceptance-test-service'

export async function GET() {
  try {
    return NextResponse.json({ scenarios: getAcceptanceCriteriaDefinitions() })
  } catch (err) {
    return errorResponse(err)
  }
}
