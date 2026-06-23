import { NextRequest, NextResponse } from 'next/server'

import { errorResponse, parseJsonBody } from '@/app/api/control-plane-utils'
import { ArtifactSemanticDiffBody } from '@/server/control-plane-validators'
import {
  compareArtifactSemanticDiff,
  listArtifactSemanticDiffs,
} from '@/server/artifact-semantic-diff-service'

export async function GET(req: NextRequest) {
  try {
    return NextResponse.json({
      semanticDiffs: await listArtifactSemanticDiffs({
        artifactId: req.nextUrl.searchParams.get('artifactId') ?? undefined,
        limit: Number(req.nextUrl.searchParams.get('limit') ?? 100),
      }),
    })
  } catch (err) {
    return errorResponse(err)
  }
}

export async function POST(req: NextRequest) {
  try {
    const parsed = await parseJsonBody(req, ArtifactSemanticDiffBody)
    if (!parsed.ok) return parsed.response
    return NextResponse.json({ semanticDiff: await compareArtifactSemanticDiff(parsed.data) }, { status: 201 })
  } catch (err) {
    return errorResponse(err)
  }
}
