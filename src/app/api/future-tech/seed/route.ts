import { NextResponse } from 'next/server'

import { errorResponse } from '@/app/api/control-plane-utils'
import { seedFutureTechRoadmap } from '@/server/future-tech-adapter-service'

export async function POST() {
  try {
    const roadmap = await seedFutureTechRoadmap()
    return NextResponse.json(roadmap, { status: 201 })
  } catch (err) {
    return errorResponse(err)
  }
}
