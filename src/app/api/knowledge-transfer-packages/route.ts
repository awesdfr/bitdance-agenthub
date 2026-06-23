import { NextRequest, NextResponse } from 'next/server'

import { errorResponse, parseJsonBody } from '@/app/api/control-plane-utils'
import type { KnowledgeTransferStatus } from '@/db/schema'
import {
  createKnowledgeTransferPackage,
  listKnowledgeTransferPackages,
} from '@/server/agent-continuity-service'
import { KnowledgeTransferPackageBody } from '@/server/control-plane-validators'

const statuses = new Set(['pending_review', 'completed', 'rejected'])

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const status = searchParams.get('status')
  const limit = Number(searchParams.get('limit') ?? 100)
  return NextResponse.json({
    knowledgeTransferPackages: await listKnowledgeTransferPackages({
      fromAgentProfileId: searchParams.get('fromAgentProfileId') ?? undefined,
      toAgentProfileId: searchParams.get('toAgentProfileId') ?? undefined,
      retirementPlanId: searchParams.get('retirementPlanId') ?? undefined,
      status: status && statuses.has(status) ? (status as KnowledgeTransferStatus) : undefined,
      limit: Number.isFinite(limit) ? limit : 100,
    }),
  })
}

export async function POST(req: NextRequest) {
  try {
    const parsed = await parseJsonBody(req, KnowledgeTransferPackageBody)
    if (!parsed.ok) return parsed.response
    const knowledgeTransferPackage = await createKnowledgeTransferPackage(parsed.data)
    return NextResponse.json({ knowledgeTransferPackage }, { status: 201 })
  } catch (err) {
    return errorResponse(err)
  }
}
