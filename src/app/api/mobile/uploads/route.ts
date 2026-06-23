import type { NextRequest } from 'next/server'
import { z } from 'zod'

import { requireMobileAuth } from '@/server/mobile-auth'
import { mobileJson, mobileOptions } from '@/server/mobile-cors'
import { registerMobileUpload } from '@/server/mobile-service'

const Body = z.object({
  employeeRunId: z.string().min(1).nullable().optional(),
  agentProfileId: z.string().min(1).nullable().optional(),
  kind: z.enum(['text', 'image', 'screenshot', 'audio', 'structured']),
  mimeType: z.string().min(1).nullable().optional(),
  dataRef: z.string().min(1),
  description: z.string().nullable().optional(),
  fileName: z.string().nullable().optional(),
  sizeBytes: z.number().int().nonnegative().nullable().optional(),
  metadata: z.record(z.string(), z.unknown()).default({}),
})

export const OPTIONS = mobileOptions

export async function POST(req: NextRequest) {
  const authError = requireMobileAuth(req)
  if (authError) return authError

  const raw = await req.json().catch(() => null)
  const parsed = Body.safeParse(raw)
  if (!parsed.success) {
    return mobileJson(req, { error: 'Invalid body', issues: parsed.error.issues }, { status: 400 })
  }

  try {
    const upload = await registerMobileUpload(parsed.data)
    return mobileJson(req, { upload }, { status: 201 })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return mobileJson(req, { error: message }, { status: 400 })
  }
}
