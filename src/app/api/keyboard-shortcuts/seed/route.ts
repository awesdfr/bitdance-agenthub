import { NextResponse } from 'next/server'

import { errorResponse } from '@/app/api/control-plane-utils'
import { seedKeyboardShortcuts } from '@/server/keyboard-shortcut-service'

export async function POST() {
  try {
    return NextResponse.json({ shortcuts: await seedKeyboardShortcuts() }, { status: 201 })
  } catch (err) {
    return errorResponse(err)
  }
}
