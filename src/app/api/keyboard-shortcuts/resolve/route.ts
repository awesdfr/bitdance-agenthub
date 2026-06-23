import { NextRequest, NextResponse } from 'next/server'

import { errorResponse, parseJsonBody } from '@/app/api/control-plane-utils'
import { KeyboardShortcutResolveBody } from '@/server/control-plane-validators'
import { resolveKeyboardShortcut } from '@/server/keyboard-shortcut-service'

export async function POST(req: NextRequest) {
  const parsed = await parseJsonBody(req, KeyboardShortcutResolveBody)
  if (!parsed.ok) return parsed.response
  try {
    return NextResponse.json(await resolveKeyboardShortcut(parsed.data))
  } catch (err) {
    return errorResponse(err)
  }
}
