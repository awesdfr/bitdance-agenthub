import { NextRequest, NextResponse } from 'next/server'

import { errorResponse, parseJsonBody } from '@/app/api/control-plane-utils'
import type { GovernanceRoleType, OpenSourceGovernanceStatus } from '@/db/schema'
import { CommunityGovernanceRoleBody } from '@/server/control-plane-validators'
import {
  createCommunityGovernanceRole,
  listCommunityGovernanceRoles,
} from '@/server/open-source-governance-service'

export async function GET(req: NextRequest) {
  return NextResponse.json({
    communityGovernanceRoles: await listCommunityGovernanceRoles({
      roleType: (req.nextUrl.searchParams.get('roleType') ?? undefined) as
        | GovernanceRoleType
        | undefined,
      status: (req.nextUrl.searchParams.get('status') ?? undefined) as
        | OpenSourceGovernanceStatus
        | undefined,
      limit: Number(req.nextUrl.searchParams.get('limit') ?? 50),
    }),
  })
}

export async function POST(req: NextRequest) {
  const parsed = await parseJsonBody(req, CommunityGovernanceRoleBody)
  if (!parsed.ok) return parsed.response
  try {
    const communityGovernanceRole = await createCommunityGovernanceRole(parsed.data)
    return NextResponse.json({ communityGovernanceRole }, { status: 201 })
  } catch (err) {
    return errorResponse(err)
  }
}
