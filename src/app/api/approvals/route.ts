import { NextRequest, NextResponse } from 'next/server'

import { listApprovalRequests } from '@/server/control-plane-service'

export async function GET(req: NextRequest) {
  const limit = Number.parseInt(req.nextUrl.searchParams.get('limit') ?? '100', 10)
  const status = req.nextUrl.searchParams.get('status')
  return NextResponse.json({
    approvalRequests: await listApprovalRequests({
      status:
        status === 'pending' || status === 'approved' || status === 'rejected'
          ? status
          : undefined,
      agentProfileId: req.nextUrl.searchParams.get('agentProfileId') ?? undefined,
      runId: req.nextUrl.searchParams.get('runId') ?? undefined,
      limit: Number.isFinite(limit) ? limit : 100,
    }),
  })
}
