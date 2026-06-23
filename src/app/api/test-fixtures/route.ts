import { NextRequest, NextResponse } from 'next/server'

import { errorResponse } from '@/app/api/control-plane-utils'
import { TestFixtureTypeSchema } from '@/server/control-plane-validators'
import { listTestFixtureSpecs } from '@/server/test-fixture-service'

export async function GET(req: NextRequest) {
  try {
    const type = req.nextUrl.searchParams.get('type')
    const parsedType = type ? TestFixtureTypeSchema.parse(type) : undefined
    return NextResponse.json({ fixtures: await listTestFixtureSpecs({ fixtureType: parsedType }) })
  } catch (err) {
    return errorResponse(err)
  }
}
