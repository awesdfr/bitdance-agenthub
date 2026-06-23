import { NextRequest, NextResponse } from 'next/server'

import { errorResponse, parseJsonBody } from '@/app/api/control-plane-utils'
import { CustomMetricProfileBody } from '@/server/control-plane-validators'
import {
  createCustomMetricProfile,
  listCustomMetricProfiles,
} from '@/server/custom-metrics-service'

export async function GET() {
  return NextResponse.json({ customMetricProfiles: await listCustomMetricProfiles() })
}

export async function POST(req: NextRequest) {
  const parsed = await parseJsonBody(req, CustomMetricProfileBody)
  if (!parsed.ok) return parsed.response
  try {
    const customMetricProfile = await createCustomMetricProfile(parsed.data)
    return NextResponse.json({ customMetricProfile }, { status: 201 })
  } catch (err) {
    return errorResponse(err)
  }
}
