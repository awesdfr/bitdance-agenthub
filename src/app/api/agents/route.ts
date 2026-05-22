import { NextResponse } from 'next/server'

import { db } from '@/db/client'

export async function GET() {
  const agents = await db.query.agents.findMany()
  return NextResponse.json({ agents })
}
