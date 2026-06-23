import type { NextRequest } from 'next/server'
import { z } from 'zod'

import { requireMobileAuth } from '@/server/mobile-auth'
import { mobileJson, mobileOptions } from '@/server/mobile-cors'
import { respondApprovalRequest } from '@/server/control-plane-service'

interface RouteContext {
  params: Promise<{ id: string }>
}

const Body = z.object({
  approved: z.boolean(),
  response: z.record(z.string(), z.unknown()).default({}),
})

export const OPTIONS = mobileOptions

export async function POST(req: NextRequest, ctx: RouteContext) {
  const authError = requireMobileAuth(req)
  if (authError) return authError

  const raw = await req.json().catch(() => null)
  const parsed = Body.safeParse(raw)
  if (!parsed.success) {
    return mobileJson(req, { error: 'Invalid body', issues: parsed.error.issues }, { status: 400 })
  }

  try {
    const { id } = await ctx.params
    const approvalRequest = await respondApprovalRequest(
      id,
      parsed.data.approved,
      parsed.data.response,
    )
    return mobileJson(req, { approvalRequest })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return mobileJson(req, { error: message }, { status: 400 })
  }
}
