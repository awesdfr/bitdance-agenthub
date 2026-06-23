import { NextRequest, NextResponse } from 'next/server'

import { errorResponse } from '@/app/api/control-plane-utils'
import { KeyboardShortcutScopeSchema } from '@/server/control-plane-validators'
import { listKeyboardShortcuts } from '@/server/keyboard-shortcut-service'

export async function GET(req: NextRequest) {
  try {
    const scope = req.nextUrl.searchParams.get('scope')
    return NextResponse.json({
      shortcuts: await listKeyboardShortcuts({
        scope: scope ? KeyboardShortcutScopeSchema.parse(scope) : undefined,
      }),
    })
  } catch (err) {
    return errorResponse(err)
  }
}
