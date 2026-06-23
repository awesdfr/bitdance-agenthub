import { NextResponse } from 'next/server'

import { errorResponse } from '@/app/api/control-plane-utils'
import { seedContributorGuide } from '@/server/contributor-guide-service'

export async function POST() {
  try {
    const contributorGuide = await seedContributorGuide()
    return NextResponse.json(contributorGuide, { status: 201 })
  } catch (err) {
    return errorResponse(err)
  }
}
