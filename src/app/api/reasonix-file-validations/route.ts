import { NextRequest, NextResponse } from 'next/server'

import { errorResponse } from '@/app/api/control-plane-utils'
import { ReasonixFileFormatKindSchema } from '@/server/control-plane-validators'
import { listReasonixFileValidations } from '@/server/reasonix-file-format-service'

export async function GET(req: NextRequest) {
  try {
    const formatKind = req.nextUrl.searchParams.get('formatKind')
    return NextResponse.json({
      validations: await listReasonixFileValidations({
        formatKind: formatKind ? ReasonixFileFormatKindSchema.parse(formatKind) : undefined,
      }),
    })
  } catch (err) {
    return errorResponse(err)
  }
}
