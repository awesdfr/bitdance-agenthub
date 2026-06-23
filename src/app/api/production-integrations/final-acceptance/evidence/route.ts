import { NextRequest, NextResponse } from 'next/server'

import {
  getProductionOnsiteEvidenceReport,
  recordProductionOnsiteEvidence,
  type CreateProductionOnsiteEvidenceArgs,
} from '@/server/production-integration-service'

export async function GET() {
  try {
    return NextResponse.json({ report: await getProductionOnsiteEvidenceReport() })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Unknown error' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as CreateProductionOnsiteEvidenceArgs
    const evidence = await recordProductionOnsiteEvidence(body)
    return NextResponse.json({ evidence }, { status: 201 })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Unknown error' }, { status: 400 })
  }
}
