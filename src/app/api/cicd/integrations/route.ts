import { NextRequest, NextResponse } from 'next/server'

import { errorResponse, parseJsonBody } from '@/app/api/control-plane-utils'
import { CicdIntegrationBody } from '@/server/control-plane-validators'
import { createCicdIntegration, listCicdIntegrations } from '@/server/cicd-integration-service'

export async function GET(req: NextRequest) {
  try {
    const platformParam = req.nextUrl.searchParams.get('platform')
    const platform =
      platformParam === 'github_actions' ||
      platformParam === 'gitlab_ci' ||
      platformParam === 'jenkins' ||
      platformParam === 'circleci' ||
      platformParam === 'azure_devops'
        ? platformParam
        : undefined
    return NextResponse.json({ integrations: await listCicdIntegrations(platform) })
  } catch (err) {
    return errorResponse(err)
  }
}

export async function POST(req: NextRequest) {
  try {
    const parsed = await parseJsonBody(req, CicdIntegrationBody)
    if (!parsed.ok) return parsed.response
    return NextResponse.json({ integration: await createCicdIntegration(parsed.data) }, { status: 201 })
  } catch (err) {
    return errorResponse(err)
  }
}
