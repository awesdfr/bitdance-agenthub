import { NextResponse } from 'next/server'

import { errorResponse } from '@/app/api/control-plane-utils'
import { seedDefaultTaskTemplates } from '@/server/task-template-service'

export async function POST() {
  try {
    return NextResponse.json({ taskTemplates: await seedDefaultTaskTemplates() })
  } catch (err) {
    return errorResponse(err)
  }
}
