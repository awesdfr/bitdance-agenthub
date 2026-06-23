import { NextRequest, NextResponse } from 'next/server'

import { listAuditLogs } from '@/server/security-service'

export async function GET(req: NextRequest) {
  const limit = Number(req.nextUrl.searchParams.get('limit') ?? '100')
  return NextResponse.json({ auditLogs: await listAuditLogs(Number.isFinite(limit) ? limit : 100) })
}
