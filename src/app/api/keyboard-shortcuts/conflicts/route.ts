import { NextResponse } from 'next/server'

import { errorResponse } from '@/app/api/control-plane-utils'
import { detectKeyboardShortcutConflicts } from '@/server/keyboard-shortcut-service'

export async function GET() {
  try {
    return NextResponse.json({ conflicts: await detectKeyboardShortcutConflicts() })
  } catch (err) {
    return errorResponse(err, 500)
  }
}
