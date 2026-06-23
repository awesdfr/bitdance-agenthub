import { NextRequest, NextResponse } from 'next/server'

import type { CapabilitySourceType } from '@/db/schema'
import { errorResponse } from '@/app/api/control-plane-utils'
import {
  listCapabilityIndexEntries,
  rebuildCapabilityIndex,
} from '@/server/capability-graph-service'

const SOURCE_TYPES: CapabilitySourceType[] = [
  'skill',
  'mcp_server',
  'mcp_tool',
  'tool_connection',
  'cli_profile',
  'software_profile',
  'software_command',
  'recorded_macro',
  'model_profile',
  'agent_profile',
  'playbook',
]

export async function GET(req: NextRequest) {
  const rawSourceType = req.nextUrl.searchParams.get('sourceType')
  const sourceType = SOURCE_TYPES.find((value) => value === rawSourceType)
  return NextResponse.json({
    capabilityIndexEntries: await listCapabilityIndexEntries(sourceType),
  })
}

export async function POST() {
  try {
    const capabilityIndexEntries = await rebuildCapabilityIndex()
    return NextResponse.json({ capabilityIndexEntries }, { status: 201 })
  } catch (err) {
    return errorResponse(err)
  }
}
