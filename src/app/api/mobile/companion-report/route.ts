import type { NextRequest } from 'next/server'

import { requireMobileAuth } from '@/server/mobile-auth'
import { mobileJson, mobileOptions } from '@/server/mobile-cors'
import { getMobileCompanionReport } from '@/server/mobile-service'

export const OPTIONS = mobileOptions

export async function GET(req: NextRequest) {
  const authError = requireMobileAuth(req)
  if (authError) return authError

  const report = await getMobileCompanionReport()
  return mobileJson(req, { report })
}
