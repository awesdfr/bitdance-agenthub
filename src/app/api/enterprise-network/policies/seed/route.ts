import { NextResponse } from 'next/server'

import { errorResponse } from '@/app/api/control-plane-utils'
import { seedEnterpriseNetworkPolicy } from '@/server/enterprise-network-service'

export async function POST() {
  try {
    return NextResponse.json({ policy: await seedEnterpriseNetworkPolicy() }, { status: 201 })
  } catch (err) {
    return errorResponse(err)
  }
}
