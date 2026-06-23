import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

import { errorResponse, parseJsonBody } from '@/app/api/control-plane-utils'
import {
  applyProductionModelCredentialIntake,
  getProductionModelCredentialIntakeReport,
} from '@/server/production-integration-service'

const ModelCredentialIntakeBody = z.object({
  modelProfileId: z.string().min(1),
  envVar: z.string().min(1).nullable().optional(),
  secretId: z.string().min(1).nullable().optional(),
  grantConnect: z.boolean().optional(),
  grantInvoke: z.boolean().optional(),
  confirmMigrate: z.boolean().optional(),
})

export async function GET() {
  try {
    return NextResponse.json({ report: await getProductionModelCredentialIntakeReport() })
  } catch (err) {
    return errorResponse(err)
  }
}

export async function POST(req: NextRequest) {
  const parsed = await parseJsonBody(req, ModelCredentialIntakeBody)
  if (!parsed.ok) return parsed.response
  try {
    return NextResponse.json(
      { result: await applyProductionModelCredentialIntake(parsed.data) },
      { status: parsed.data.confirmMigrate ? 201 : 200 },
    )
  } catch (err) {
    return errorResponse(err)
  }
}
