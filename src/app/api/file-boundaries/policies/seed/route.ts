import { NextResponse } from 'next/server'

import { errorResponse } from '@/app/api/control-plane-utils'
import { seedFileSystemBoundaryPolicy } from '@/server/file-system-boundary-service'

export async function POST() {
  try {
    return NextResponse.json({ policy: await seedFileSystemBoundaryPolicy() }, { status: 201 })
  } catch (err) {
    return errorResponse(err)
  }
}
