import { NextRequest, NextResponse } from 'next/server'

import { listModelConnectionTests } from '@/server/model-gateway-service'

export async function GET(req: NextRequest) {
  return NextResponse.json({
    modelConnectionTests: await listModelConnectionTests(
      req.nextUrl.searchParams.get('modelProfileId') ?? undefined,
    ),
  })
}
