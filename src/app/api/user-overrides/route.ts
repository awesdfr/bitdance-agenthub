import { NextRequest, NextResponse } from 'next/server'

import { errorResponse, parseJsonBody } from '@/app/api/control-plane-utils'
import type {
  UserOverrideCommand,
  UserOverrideTargetType,
} from '@/db/schema'
import { UserOverrideBody } from '@/server/control-plane-validators'
import {
  applyUserOverride,
  listUserOverrides,
} from '@/server/user-override-service'

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  return NextResponse.json({
    userOverrides: await listUserOverrides({
      command: normalizeCommand(searchParams.get('command')),
      targetType: normalizeTargetType(searchParams.get('targetType')),
      targetId: searchParams.get('targetId'),
    }),
  })
}

export async function POST(req: NextRequest) {
  const parsed = await parseJsonBody(req, UserOverrideBody)
  if (!parsed.ok) return parsed.response
  try {
    const userOverride = await applyUserOverride(parsed.data)
    return NextResponse.json({ userOverride }, { status: 201 })
  } catch (err) {
    return errorResponse(err)
  }
}

function normalizeCommand(value: string | null): UserOverrideCommand | null {
  return value === 'STOP' ||
    value === 'UNDO' ||
    value === 'PAUSE' ||
    value === 'NEVER_DO_THIS_AGAIN' ||
    value === 'IGNORE_PREVIOUS_INSTRUCTION'
    ? value
    : null
}

function normalizeTargetType(value: string | null): UserOverrideTargetType | null {
  return value === 'global' ||
    value === 'workspace' ||
    value === 'agent_profile' ||
    value === 'employee_run' ||
    value === 'workflow_run' ||
    value === 'task_queue' ||
    value === 'resource'
    ? value
    : null
}
