import { NextRequest, NextResponse } from 'next/server'

import { errorResponse, parseJsonBody } from '@/app/api/control-plane-utils'
import { PromptTemplateBody } from '@/server/control-plane-validators'
import {
  createPromptTemplate,
  listPromptTemplateCatalog,
} from '@/server/prompt-context-service'

export async function GET() {
  return NextResponse.json(await listPromptTemplateCatalog())
}

export async function POST(req: NextRequest) {
  const parsed = await parseJsonBody(req, PromptTemplateBody)
  if (!parsed.ok) return parsed.response
  try {
    const { template, version } = await createPromptTemplate(parsed.data)
    return NextResponse.json({ promptTemplate: template, promptTemplateVersion: version }, { status: 201 })
  } catch (err) {
    return errorResponse(err)
  }
}
