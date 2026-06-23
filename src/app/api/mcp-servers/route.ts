import { NextRequest, NextResponse } from 'next/server'

import { errorResponse, parseJsonBody } from '@/app/api/control-plane-utils'
import { McpServerBody } from '@/server/control-plane-validators'
import { createMcpServer, listMcpServers } from '@/server/control-plane-service'

export async function GET() {
  return NextResponse.json({ mcpServers: await listMcpServers() })
}

export async function POST(req: NextRequest) {
  const parsed = await parseJsonBody(req, McpServerBody)
  if (!parsed.ok) return parsed.response
  try {
    const mcpServer = await createMcpServer(parsed.data)
    return NextResponse.json({ mcpServer }, { status: 201 })
  } catch (err) {
    return errorResponse(err)
  }
}
