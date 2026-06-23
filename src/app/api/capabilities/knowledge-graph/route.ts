import { NextResponse } from 'next/server'

import { getCapabilityKnowledgeGraph } from '@/server/capability-graph-service'

export async function GET() {
  return NextResponse.json(await getCapabilityKnowledgeGraph())
}
