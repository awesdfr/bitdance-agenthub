import { NextRequest, NextResponse } from 'next/server'

import { errorResponse, getRouteId, parseJsonBody } from '@/app/api/control-plane-utils'
import { TestFixtureGenerateBody } from '@/server/control-plane-validators'
import { generateTestFixture } from '@/server/test-fixture-service'

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const parsed = await parseJsonBody(req, TestFixtureGenerateBody)
  if (!parsed.ok) return parsed.response
  try {
    return NextResponse.json(
      {
        run: await generateTestFixture({
          fixtureId: await getRouteId(ctx),
          targetPath: parsed.data.targetPath,
        }),
      },
      { status: 201 },
    )
  } catch (err) {
    return errorResponse(err)
  }
}
