import { NextRequest, NextResponse } from 'next/server'

import { errorResponse, parseJsonBody } from '@/app/api/control-plane-utils'
import { DiversityAnalysisBody } from '@/server/control-plane-validators'
import {
  analyzeAgentDiversity,
  listDiversityAnalyses,
} from '@/server/agent-diversity-service'
import type { DiversityScopeType } from '@/db/schema'

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  return NextResponse.json({
    diversityAnalyses: await listDiversityAnalyses({
      scopeType: normalizeScopeType(searchParams.get('scopeType')),
      scopeId: searchParams.get('scopeId'),
    }),
  })
}

export async function POST(req: NextRequest) {
  const parsed = await parseJsonBody(req, DiversityAnalysisBody)
  if (!parsed.ok) return parsed.response
  try {
    const diversityAnalysis = await analyzeAgentDiversity(parsed.data)
    return NextResponse.json({ diversityAnalysis }, { status: 201 })
  } catch (err) {
    return errorResponse(err)
  }
}

function normalizeScopeType(value: string | null): DiversityScopeType | null {
  return value === 'team' || value === 'workflow' || value === 'project' || value === 'workspace'
    ? value
    : null
}
