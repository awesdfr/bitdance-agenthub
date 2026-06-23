import { NextResponse } from 'next/server'

import {
  getProductionLivePilotSessionReport,
  startProductionLivePilotSession,
  stopProductionLivePilotSession,
} from '@/server/production-integration-service'

export async function GET() {
  try {
    return NextResponse.json({ report: await getProductionLivePilotSessionReport() })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    )
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}))
    const durationMinutes =
      body && typeof body === 'object' && typeof body.durationMinutes === 'number'
        ? body.durationMinutes
        : undefined
    return NextResponse.json(
      { session: await startProductionLivePilotSession({ durationMinutes }) },
      { status: 201 },
    )
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    )
  }
}

export async function DELETE(request: Request) {
  try {
    const body = await request.json().catch(() => ({}))
    const reason =
      body && typeof body === 'object' && typeof body.reason === 'string' ? body.reason : undefined
    return NextResponse.json({ session: await stopProductionLivePilotSession({ reason }) })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    )
  }
}
