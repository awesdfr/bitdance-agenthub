import { NextRequest, NextResponse } from 'next/server'

import { errorResponse, parseJsonBody } from '@/app/api/control-plane-utils'
import {
  KnowledgeEdgeTypeSchema,
  KnowledgeGraphRebuildBody,
  KnowledgeNodeTypeSchema,
} from '@/server/control-plane-validators'
import {
  getStructuredKnowledgeGraph,
  rebuildStructuredKnowledgeGraph,
} from '@/server/knowledge-graph-service'

export async function GET(req: NextRequest) {
  try {
    const nodeTypeParam = req.nextUrl.searchParams.get('nodeType') ?? undefined
    const relationParam = req.nextUrl.searchParams.get('relation') ?? undefined
    const limitNodesParam = req.nextUrl.searchParams.get('limitNodes')
    const limitEdgesParam = req.nextUrl.searchParams.get('limitEdges')
    return NextResponse.json({
      graph: await getStructuredKnowledgeGraph({
        nodeType: nodeTypeParam ? KnowledgeNodeTypeSchema.parse(nodeTypeParam) : undefined,
        relation: relationParam ? KnowledgeEdgeTypeSchema.parse(relationParam) : undefined,
        limitNodes: limitNodesParam ? Number(limitNodesParam) : undefined,
        limitEdges: limitEdgesParam ? Number(limitEdgesParam) : undefined,
      }),
    })
  } catch (err) {
    return errorResponse(err)
  }
}

export async function POST(req: NextRequest) {
  try {
    const parsed = await parseJsonBody(req, KnowledgeGraphRebuildBody)
    if (!parsed.ok) return parsed.response
    return NextResponse.json(
      { graph: await rebuildStructuredKnowledgeGraph(parsed.data) },
      { status: 201 },
    )
  } catch (err) {
    return errorResponse(err)
  }
}
