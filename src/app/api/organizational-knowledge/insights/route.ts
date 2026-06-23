import { NextRequest, NextResponse } from 'next/server'

import { errorResponse, parseJsonBody } from '@/app/api/control-plane-utils'
import type {
  OrganizationalInsightStatus,
  OrganizationalInsightType,
  OrganizationalKnowledgeSource,
} from '@/db/schema'
import { OrganizationalKnowledgeBuildBody } from '@/server/control-plane-validators'
import {
  buildOrganizationalKnowledge,
  listOrganizationalKnowledgeItems,
} from '@/server/organizational-learning-service'

const insightTypes = new Set([
  'failure_pattern',
  'best_practice',
  'software_tip',
  'customer_preference',
])
const statuses = new Set(['candidate', 'promoted', 'deprecated'])
const sources = new Set(['all_agents', 'specific_project', 'specific_role'])

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const insightType = searchParams.get('insightType')
  const status = searchParams.get('status')
  const source = searchParams.get('source')
  const limit = Number(searchParams.get('limit') ?? 100)
  return NextResponse.json({
    organizationalKnowledgeItems: await listOrganizationalKnowledgeItems({
      insightType: insightType && insightTypes.has(insightType)
        ? (insightType as OrganizationalInsightType)
        : undefined,
      status: status && statuses.has(status) ? (status as OrganizationalInsightStatus) : undefined,
      source: source && sources.has(source) ? (source as OrganizationalKnowledgeSource) : undefined,
      limit: Number.isFinite(limit) ? limit : 100,
    }),
  })
}

export async function POST(req: NextRequest) {
  try {
    const parsed = await parseJsonBody(req, OrganizationalKnowledgeBuildBody)
    if (!parsed.ok) return parsed.response
    return NextResponse.json(await buildOrganizationalKnowledge(parsed.data), { status: 201 })
  } catch (err) {
    return errorResponse(err)
  }
}
