import { NextRequest, NextResponse } from 'next/server'

import { errorResponse, parseJsonBody } from '@/app/api/control-plane-utils'
import {
  LocalizationNamespaceSchema,
  LocalizationResourceBody,
  SupportedLocaleSchema,
} from '@/server/control-plane-validators'
import { createLocalizationResource, listLocalizationResources } from '@/server/localization-service'

export async function GET(req: NextRequest) {
  try {
    const locale = req.nextUrl.searchParams.get('locale')
    const namespace = req.nextUrl.searchParams.get('namespace')
    return NextResponse.json({
      resources: await listLocalizationResources({
        locale: locale ? SupportedLocaleSchema.parse(locale) : undefined,
        namespace: namespace ? LocalizationNamespaceSchema.parse(namespace) : undefined,
      }),
    })
  } catch (err) {
    return errorResponse(err)
  }
}

export async function POST(req: NextRequest) {
  const parsed = await parseJsonBody(req, LocalizationResourceBody)
  if (!parsed.ok) return parsed.response
  try {
    return NextResponse.json({ resource: await createLocalizationResource(parsed.data) }, { status: 201 })
  } catch (err) {
    return errorResponse(err)
  }
}
