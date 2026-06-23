import { NextResponse } from 'next/server'

import { errorResponse } from '@/app/api/control-plane-utils'
import { listPlugins } from '@/server/plugin-framework-service'

export async function GET() {
  try {
    return NextResponse.json({ plugins: await listPlugins() })
  } catch (err) {
    return errorResponse(err)
  }
}
