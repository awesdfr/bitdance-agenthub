import { NextRequest, NextResponse } from 'next/server'

import { errorResponse, parseJsonBody } from '@/app/api/control-plane-utils'
import type { TaskMergeSuggestionStatus } from '@/db/schema'
import { TaskMergeSuggestionBody } from '@/server/control-plane-validators'
import {
  listTaskMergeSuggestions,
  suggestTaskMerge,
} from '@/server/workflow-advanced-operation-service'

export async function GET(req: NextRequest) {
  try {
    return NextResponse.json({
      taskMergeSuggestions: await listTaskMergeSuggestions({
        agentProfileId: req.nextUrl.searchParams.get('agentProfileId') ?? undefined,
        status: (req.nextUrl.searchParams.get('status') ?? undefined) as
          | TaskMergeSuggestionStatus
          | undefined,
        limit: Number(req.nextUrl.searchParams.get('limit') ?? 50),
      }),
    })
  } catch (err) {
    return errorResponse(err)
  }
}

export async function POST(req: NextRequest) {
  const parsed = await parseJsonBody(req, TaskMergeSuggestionBody)
  if (!parsed.ok) return parsed.response
  try {
    return NextResponse.json({
      taskMergeSuggestion: await suggestTaskMerge(parsed.data),
    }, { status: 201 })
  } catch (err) {
    return errorResponse(err)
  }
}
