import { NextResponse } from 'next/server'

import { errorResponse } from '@/app/api/control-plane-utils'
import { seedGlossaryTerms } from '@/server/glossary-service'

export async function POST() {
  try {
    return NextResponse.json({ terms: await seedGlossaryTerms() }, { status: 201 })
  } catch (err) {
    return errorResponse(err)
  }
}
