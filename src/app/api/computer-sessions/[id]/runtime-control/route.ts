import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

import { errorResponse, getRouteId, parseJsonBody } from '@/app/api/control-plane-utils'
import {
  executeRuntimeControlAction,
  type RuntimeControlActionType,
  type RuntimeControlScope,
} from '@/server/runtime-control-service'

const RuntimeControlBody = z.object({
  scope: z.enum(['desktop', 'mobile', 'workstation']),
  actionType: z.enum([
    'observe_windows',
    'capture_screenshot',
    'focus_window',
    'click',
    'scroll',
    'type_text',
    'key_press',
    'list_devices',
    'mobile_tap',
    'mobile_swipe',
    'mobile_text',
    'mobile_keyevent',
    'mobile_screenshot',
    'validate_workstation',
    'launch_remote_session',
    'release_workstation',
  ]),
  target: z.string().optional().nullable(),
  input: z.record(z.string(), z.unknown()).optional(),
  live: z.boolean().optional(),
  confirmRisk: z.boolean().optional(),
  approvalRequestId: z.string().optional().nullable(),
})

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const parsed = await parseJsonBody(req, RuntimeControlBody)
  if (!parsed.ok) return parsed.response
  try {
    const result = await executeRuntimeControlAction({
      computerSessionId: await getRouteId(ctx),
      scope: parsed.data.scope as RuntimeControlScope,
      actionType: parsed.data.actionType as RuntimeControlActionType,
      target: parsed.data.target,
      input: parsed.data.input,
      live: parsed.data.live,
      confirmRisk: parsed.data.confirmRisk,
      approvalRequestId: parsed.data.approvalRequestId,
    })
    return NextResponse.json({ result }, { status: 201 })
  } catch (err) {
    return errorResponse(err)
  }
}
