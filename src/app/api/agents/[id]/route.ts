import { NextResponse } from 'next/server'

import { deleteCustomAgent } from '@/server/agent-service'

interface RouteContext {
  params: Promise<{ id: string }>
}

export async function DELETE(_req: Request, ctx: RouteContext) {
  const { id } = await ctx.params
  try {
    await deleteCustomAgent(id)
    return NextResponse.json({ ok: true })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
