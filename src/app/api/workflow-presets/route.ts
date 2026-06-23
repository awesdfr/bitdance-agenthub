import { NextResponse } from 'next/server'

import { listWorkflowPresets } from '@/server/workflow-preset-service'

export async function GET() {
  return NextResponse.json({ workflowPresets: listWorkflowPresets() })
}
