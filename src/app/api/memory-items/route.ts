import { NextRequest, NextResponse } from 'next/server'

import { errorResponse, parseJsonBody } from '@/app/api/control-plane-utils'
import type { MemoryScope, MemoryType } from '@/db/schema'
import { MemoryItemBody } from '@/server/control-plane-validators'
import {
  createMemoryItem,
  listMemoryItems,
} from '@/server/agent-memory-service'

const scopes = new Set(['agent', 'project', 'workspace', 'global'])
const types = new Set([
  'episodic',
  'semantic',
  'procedural',
  'project',
  'customer',
  'software',
  'mistake',
  'success',
])

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const scope = searchParams.get('scope')
  const type = searchParams.get('type')
  const limit = Number(searchParams.get('limit') ?? 100)
  return NextResponse.json({
    memoryItems: await listMemoryItems({
      agentProfileId: searchParams.get('agentProfileId') ?? undefined,
      sourceRunId: searchParams.get('sourceRunId') ?? undefined,
      scope: scope && scopes.has(scope) ? (scope as MemoryScope) : undefined,
      type: type && types.has(type) ? (type as MemoryType) : undefined,
      limit: Number.isFinite(limit) ? limit : 100,
    }),
  })
}

export async function POST(req: NextRequest) {
  try {
    const parsed = await parseJsonBody(req, MemoryItemBody)
    if (!parsed.ok) return parsed.response
    const memoryItem = await createMemoryItem(parsed.data)
    return NextResponse.json({ memoryItem }, { status: 201 })
  } catch (err) {
    return errorResponse(err)
  }
}
