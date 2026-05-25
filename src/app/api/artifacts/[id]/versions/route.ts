import { eq } from 'drizzle-orm'
import { NextResponse } from 'next/server'

import { db, schema } from '@/db/client'

interface RouteContext {
  params: Promise<{ id: string }>
}

/**
 * GET /api/artifacts/:id/versions
 *
 * 返回该 artifact 所在的版本链 —— 从最远祖先 root 开始 BFS 收集所有后代，按 version 升序。
 * 当前 artifact 也包含在内。
 */
export async function GET(_req: Request, ctx: RouteContext) {
  const { id } = await ctx.params

  // 1) 找 root：从当前 artifact 向上爬 parentArtifactId
  let cursorId = id
  let root = await db.query.artifacts.findFirst({
    where: eq(schema.artifacts.id, cursorId),
  })
  if (!root) {
    return NextResponse.json({ error: 'Artifact not found' }, { status: 404 })
  }
  const climbed = new Set<string>([cursorId])
  while (root.parentArtifactId && !climbed.has(root.parentArtifactId)) {
    cursorId = root.parentArtifactId
    climbed.add(cursorId)
    const parent = await db.query.artifacts.findFirst({
      where: eq(schema.artifacts.id, cursorId),
    })
    if (!parent) break
    root = parent
  }

  // 2) 从 root 向下 BFS 收集所有后代（独立 visited，避免和「爬过」混淆 —— 之前的 bug 在这）
  const collected: (typeof root)[] = [root]
  const visited = new Set<string>([root.id])
  const queue: string[] = [root.id]
  while (queue.length > 0) {
    const parentId = queue.shift()!
    const children = await db.query.artifacts.findMany({
      where: eq(schema.artifacts.parentArtifactId, parentId),
    })
    for (const c of children) {
      if (visited.has(c.id)) continue
      visited.add(c.id)
      collected.push(c)
      queue.push(c.id)
    }
  }

  collected.sort((a, b) => a.version - b.version)
  return NextResponse.json({ versions: collected })
}
