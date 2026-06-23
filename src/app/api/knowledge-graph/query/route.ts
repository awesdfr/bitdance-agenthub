import { NextRequest, NextResponse } from 'next/server'

import { errorResponse, parseJsonBody } from '@/app/api/control-plane-utils'
import { KnowledgeGraphQueryBody } from '@/server/control-plane-validators'
import { queryStructuredKnowledgeGraph } from '@/server/knowledge-graph-service'

export async function POST(req: NextRequest) {
  try {
    const parsed = await parseJsonBody(req, KnowledgeGraphQueryBody)
    if (!parsed.ok) return parsed.response
    return NextResponse.json({ result: await queryStructuredKnowledgeGraph(parsed.data) })
  } catch (err) {
    return errorResponse(err)
  }
}
