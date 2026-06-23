import { NextRequest } from 'next/server'

import { GET as getAudit } from '../src/app/api/implementation-audit/route'
import { GET as getMobileCompanionReport } from '../src/app/api/mobile/companion-report/route'
import { GET as getMobileSnapshot } from '../src/app/api/mobile/snapshot/route'
import { POST as postMobileUpload } from '../src/app/api/mobile/uploads/route'
import {
  createAgentProfile,
  createApprovalRequest,
} from '../src/server/control-plane-service'
import { startEmployeeRun } from '../src/server/employee-runtime-service'

const TOKEN = 'smoke-mobile-token'

async function readJson(response: Response) {
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${await response.text()}`)
  }
  return response.json()
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function mobileRequest(
  path: string,
  init: {
    method?: string
    body?: string
    headers?: Record<string, string>
  } = {},
) {
  return new NextRequest(`http://local${path}`, {
    method: init.method,
    body: init.body,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...(init.headers ?? {}),
    },
  })
}

async function main() {
  const previousToken = process.env.AGENTHUB_MOBILE_TOKEN
  const previousMode = process.env.AGENTHUB_COMPANION_MODE
  process.env.AGENTHUB_MOBILE_TOKEN = TOKEN
  process.env.AGENTHUB_COMPANION_MODE = 'lan'

  try {
    const agent = await createAgentProfile({
      name: 'Smoke Mobile Worker',
      role: 'Mobile companion visible executor',
      outputContract: { artifactType: 'report' },
      status: 'active',
    })
    const run = await startEmployeeRun({
      agentProfileId: agent.id,
      goal: 'Wait for mobile companion smoke verification',
      autoComplete: false,
    })
    const approval = await createApprovalRequest({
      agentProfileId: agent.id,
      runId: run.id,
      type: 'mobile_smoke_approval',
      title: 'Smoke mobile approval',
      description: 'Mobile companion should surface this approval.',
      riskLevel: 'medium',
      payload: { employeeRunId: run.id },
    })
    const uploadPayload = await readJson(
      await postMobileUpload(
        mobileRequest('/api/mobile/uploads', {
          method: 'POST',
          body: JSON.stringify({
            employeeRunId: run.id,
            agentProfileId: agent.id,
            kind: 'image',
            mimeType: 'image/png',
            dataRef: 'mobile://smoke/screenshot.png',
            description: 'Smoke screenshot handoff.',
            fileName: 'screenshot.png',
            sizeBytes: 2048,
          }),
        }),
      ),
    )
    const snapshot = await readJson(await getMobileSnapshot(mobileRequest('/api/mobile/snapshot')))
    const reportPayload = await readJson(
      await getMobileCompanionReport(mobileRequest('/api/mobile/companion-report')),
    )
    const audit = await readJson(await getAudit())
    const report = reportPayload.report

    assert(snapshot.employeeRuns.some(
      (row: { id: string; agentProfileId: string }) => row.id === run.id && row.agentProfileId === agent.id,
    ), 'Expected mobile snapshot to include employee run.')
    assert(snapshot.approvalRequests.some(
      (row: { id: string; title: string }) => row.id === approval.id && row.title === 'Smoke mobile approval',
    ), 'Expected mobile snapshot to include approval.')
    assert(snapshot.recentUploads.some(
      (row: { id: string }) => row.id === uploadPayload.upload.id,
    ), 'Expected mobile snapshot to include upload handoff.')
    assert(report.readiness === 'ready', `Expected ready mobile report, got ${report.readiness}`)
    assert(report.companion.tokenConfigured === true, 'Expected configured mobile token.')
    assert(report.endpointContract.some(
      (endpoint: { path: string }) => endpoint.path === '/api/mobile/uploads',
    ), 'Expected upload endpoint in report.')
    assert(report.v1Capabilities.some(
      (capability: { key: string; status: string }) =>
        capability.key === 'upload_handoff_material' && capability.status === 'implemented',
    ), 'Expected upload handoff capability.')
    assert(report.v2DeviceAutomationReservations.some(
      (reservation: {
        key: string
        status: string
        runtimeActions: string[]
        requiredEnvVars: string[]
        requiredAllowlists: Array<{ envVar: string; configured: boolean }>
        safetyGates: string[]
      }) =>
        reservation.key === 'android_adb' &&
        reservation.status === 'guarded_available' &&
        reservation.runtimeActions.includes('runtime_control.mobile.mobile_tap') &&
        reservation.runtimeActions.includes('runtime_control.mobile.mobile_screenshot') &&
        reservation.requiredEnvVars.includes('AGENTHUB_ENABLE_REAL_MOBILE_CONTROL') &&
        reservation.requiredEnvVars.includes('AGENTHUB_ENABLE_REAL_MOBILE_CAPTURE') &&
        reservation.requiredAllowlists.some(
          (allowlist) =>
            allowlist.envVar === 'AGENTHUB_ALLOWED_MOBILE_DEVICE_IDS' &&
            allowlist.configured === false,
        ) &&
        reservation.requiredAllowlists.some(
          (allowlist) =>
            allowlist.envVar === 'AGENTHUB_ALLOWED_MOBILE_APP_PACKAGES' &&
            allowlist.configured === false,
        ) &&
        reservation.safetyGates.includes('运行时审批 inputHash 绑定'),
    ), 'Expected guarded Android ADB runtime-control automation boundary.')
    assert(report.v2DeviceAutomationReservations.some(
      (reservation: { key: string; status: string; runtimeActions: string[] }) =>
        reservation.key === 'mobile_click_input' &&
        reservation.status === 'guarded_available' &&
        reservation.runtimeActions.includes('runtime_control.mobile.mobile_text'),
    ), 'Expected guarded phone click/input automation boundary.')
    assert(report.v2DeviceAutomationReservations.some(
      (reservation: { key: string; status: string }) =>
        reservation.key === 'ios_shortcuts' && reservation.status === 'reserved_not_enabled',
    ), 'Expected unsupported iOS automation to remain explicitly reserved.')
    assert(
      audit.summary.implementedBaselineSections === 210 &&
        audit.summary.partialSections === 0 &&
        audit.summary.pendingSections === 0,
      `Unexpected audit summary: ${JSON.stringify(audit.summary)}`,
    )
    assert(
      audit.sections.find((section: { sectionNumber: number }) => section.sectionNumber === 17)
        ?.implementationStatus === 'baseline_plus',
      'Expected section 17 to be promoted.',
    )

    console.log(JSON.stringify({
      agentId: agent.id,
      employeeRunId: run.id,
      approvalId: approval.id,
      uploadId: uploadPayload.upload.id,
      readiness: report.readiness,
      readinessScore: report.readinessScore,
      auditSummary: audit.summary,
    }, null, 2))
  } finally {
    if (previousToken === undefined) delete process.env.AGENTHUB_MOBILE_TOKEN
    else process.env.AGENTHUB_MOBILE_TOKEN = previousToken
    if (previousMode === undefined) delete process.env.AGENTHUB_COMPANION_MODE
    else process.env.AGENTHUB_COMPANION_MODE = previousMode
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
