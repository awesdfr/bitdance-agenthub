import { NextResponse } from 'next/server'

import { errorResponse } from '@/app/api/control-plane-utils'
import { buildTechnicalArchitectureManifest } from '@/server/technical-architecture-service'

export async function GET() {
  try {
    return NextResponse.json({ manifest: buildTechnicalArchitectureManifest() })
  } catch (err) {
    return errorResponse(err)
  }
}
