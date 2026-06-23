import { NextRequest, NextResponse } from 'next/server'

import { errorResponse, parseJsonBody } from '@/app/api/control-plane-utils'
import type { ContributorTool, OpenSourceGovernanceStatus } from '@/db/schema'
import { ContributorPrerequisiteBody } from '@/server/control-plane-validators'
import {
  createContributorPrerequisite,
  listContributorPrerequisites,
} from '@/server/contributor-guide-service'

export async function GET(req: NextRequest) {
  return NextResponse.json({
    contributorPrerequisites: await listContributorPrerequisites({
      tool: (req.nextUrl.searchParams.get('tool') ?? undefined) as ContributorTool | undefined,
      status: (req.nextUrl.searchParams.get('status') ?? undefined) as
        | OpenSourceGovernanceStatus
        | undefined,
      limit: Number(req.nextUrl.searchParams.get('limit') ?? 50),
    }),
  })
}

export async function POST(req: NextRequest) {
  const parsed = await parseJsonBody(req, ContributorPrerequisiteBody)
  if (!parsed.ok) return parsed.response
  try {
    const contributorPrerequisite = await createContributorPrerequisite(parsed.data)
    return NextResponse.json({ contributorPrerequisite }, { status: 201 })
  } catch (err) {
    return errorResponse(err)
  }
}
