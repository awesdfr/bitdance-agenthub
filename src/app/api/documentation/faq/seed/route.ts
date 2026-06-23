import { NextResponse } from 'next/server'

import { errorResponse } from '@/app/api/control-plane-utils'
import { seedFaqEntries } from '@/server/faq-service'

export async function POST() {
  try {
    return NextResponse.json({ entries: await seedFaqEntries() }, { status: 201 })
  } catch (err) {
    return errorResponse(err)
  }
}
