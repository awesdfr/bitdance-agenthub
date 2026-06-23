import type { NextRequest } from 'next/server'

import { pauseEmployeeRun } from '@/server/employee-runtime-service'
import { requireMobileAuth } from '@/server/mobile-auth'
import { mobileJson, mobileOptions } from '@/server/mobile-cors'

interface RouteContext {
  params: Promise<{ id: string }>
}

export const OPTIONS = mobileOptions

export async function POST(req: NextRequest, ctx: RouteContext) {
  const authError = requireMobileAuth(req)
  if (authError) return authError

  try {
    const { id } = await ctx.params
    const employeeRun = await pauseEmployeeRun(id)
    return mobileJson(req, { employeeRun })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return mobileJson(req, { error: message }, { status: 400 })
  }
}
