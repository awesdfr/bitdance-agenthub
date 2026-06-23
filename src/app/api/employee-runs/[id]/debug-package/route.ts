import { NextRequest, NextResponse } from 'next/server'
import JSZip from 'jszip'

import { errorResponse, getRouteId } from '@/app/api/control-plane-utils'
import { buildEmployeeRunDebugPackage } from '@/server/observability-service'

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const debugPackage = await buildEmployeeRunDebugPackage(await getRouteId(ctx))
    if (req.nextUrl.searchParams.get('format') === 'json') {
      return NextResponse.json({
        debugPackage: {
          ...debugPackage,
          files: debugPackage.files.map((file) => ({
            path: file.path,
            contentType: file.contentType,
            bytes: file.bytes,
          })),
        },
      })
    }

    const zip = new JSZip()
    for (const file of debugPackage.files) {
      zip.file(file.path, file.content)
    }
    const body = await zip.generateAsync({ type: 'arraybuffer', compression: 'DEFLATE' })
    return new NextResponse(new Blob([body], { type: 'application/zip' }), {
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="${debugPackage.fileName}"`,
      },
    })
  } catch (err) {
    return errorResponse(err, 404)
  }
}
