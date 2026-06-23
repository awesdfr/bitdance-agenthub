import { NextRequest, NextResponse } from 'next/server'

import { errorResponse, parseJsonBody } from '@/app/api/control-plane-utils'
import { StyleGuideBody } from '@/server/control-plane-validators'
import { createStyleGuide, listStyleGuides } from '@/server/style-guide-service'

export async function GET() {
  return NextResponse.json({ styleGuides: await listStyleGuides() })
}

export async function POST(req: NextRequest) {
  const parsed = await parseJsonBody(req, StyleGuideBody)
  if (!parsed.ok) return parsed.response
  try {
    const styleGuide = await createStyleGuide(parsed.data)
    return NextResponse.json({ styleGuide }, { status: 201 })
  } catch (err) {
    return errorResponse(err)
  }
}
