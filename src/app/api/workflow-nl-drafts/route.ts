import { NextRequest, NextResponse } from 'next/server'

import { errorResponse, parseJsonBody } from '@/app/api/control-plane-utils'
import type { NaturalLanguageWorkflowDraftStatus } from '@/db/schema'
import {
  NaturalLanguageWorkflowDraftBody,
} from '@/server/control-plane-validators'
import {
  createNaturalLanguageWorkflowDraft,
  listNaturalLanguageWorkflowDrafts,
} from '@/server/natural-language-workflow-service'

export async function GET(req: NextRequest) {
  try {
    return NextResponse.json({
      drafts: await listNaturalLanguageWorkflowDrafts({
        status: (req.nextUrl.searchParams.get('status') ?? undefined) as
          | NaturalLanguageWorkflowDraftStatus
          | undefined,
        limit: Number(req.nextUrl.searchParams.get('limit') ?? 50),
      }),
    })
  } catch (err) {
    return errorResponse(err)
  }
}

export async function POST(req: NextRequest) {
  const parsed = await parseJsonBody(req, NaturalLanguageWorkflowDraftBody)
  if (!parsed.ok) return parsed.response
  try {
    return NextResponse.json(
      { draft: await createNaturalLanguageWorkflowDraft(parsed.data) },
      { status: 201 },
    )
  } catch (err) {
    return errorResponse(err)
  }
}
