import { NextRequest, NextResponse } from 'next/server'

import { errorResponse, parseJsonBody } from '@/app/api/control-plane-utils'
import { createToolConnection, listToolConnections } from '@/server/control-plane-service'
import { ToolConnectionBody } from '@/server/control-plane-validators'

export async function GET() {
  return NextResponse.json({ toolConnections: await listToolConnections() })
}

export async function POST(req: NextRequest) {
  const parsed = await parseJsonBody(req, ToolConnectionBody)
  if (!parsed.ok) return parsed.response
  try {
    const toolConnection = await createToolConnection(parsed.data)
    return NextResponse.json({ toolConnection }, { status: 201 })
  } catch (err) {
    return errorResponse(err)
  }
}
