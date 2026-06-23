import { NextRequest, NextResponse } from 'next/server'
import { desc, eq } from 'drizzle-orm'

import { db, schema } from '@/db/client'

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const employeeRunId = searchParams.get('employeeRunId')
  const limit = Number(searchParams.get('limit') ?? 100)
  return NextResponse.json({
    decisionAuditTrails: await db.query.decisionAuditTrails.findMany({
      where: employeeRunId ? eq(schema.decisionAuditTrails.employeeRunId, employeeRunId) : undefined,
      orderBy: [desc(schema.decisionAuditTrails.createdAt)],
      limit: Number.isFinite(limit) ? limit : 100,
    }),
  })
}
