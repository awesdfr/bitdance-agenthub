import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

import { errorResponse, parseJsonBody } from '@/app/api/control-plane-utils'
import { getSkillsMpCliHealth, searchSkillsMpCli } from '@/server/skillsmp-cli-service'

const SkillsMpCliSearchBody = z.object({
  query: z.string().trim().min(1, '请输入要搜索的技能关键词'),
  page: z.number().int().positive().optional(),
  limit: z.number().int().positive().max(100).optional(),
  sortBy: z.enum(['stars', 'recent']).optional(),
  category: z.string().trim().optional(),
  occupation: z.string().trim().optional(),
})

export async function GET() {
  try {
    return NextResponse.json({ health: await getSkillsMpCliHealth() })
  } catch (err) {
    return errorResponse(err)
  }
}

export async function POST(req: NextRequest) {
  const parsed = await parseJsonBody(req, SkillsMpCliSearchBody)
  if (!parsed.ok) return parsed.response
  try {
    return NextResponse.json({
      result: await searchSkillsMpCli({
        query: parsed.data.query,
        page: parsed.data.page,
        limit: parsed.data.limit ?? 12,
        sortBy: parsed.data.sortBy ?? 'recent',
        category: parsed.data.category,
        occupation: parsed.data.occupation,
      }),
    })
  } catch (err) {
    return errorResponse(err)
  }
}
