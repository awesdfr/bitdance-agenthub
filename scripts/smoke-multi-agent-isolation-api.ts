import { NextRequest } from 'next/server'

import { GET as getIsolationReport } from '../src/app/api/agent-profiles/[id]/isolation-report/route'
import { GET as getAudit } from '../src/app/api/implementation-audit/route'
import {
  acquireResourceLock,
  createAgentProfile,
  createDefaultWorkstation,
} from '../src/server/control-plane-service'

async function readJson(response: Response) {
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${await response.text()}`)
  }
  return response.json()
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

async function main() {
  const browserAgent = await createAgentProfile({
    name: 'Smoke Parallel Browser Employee',
    role: 'Browser worker',
    workstationPolicy: { mode: 'browser_context', isolateWorkspace: true },
    permissionPolicy: {
      canUseBrowser: true,
      canReadFiles: true,
      canWriteFiles: true,
    },
    outputContract: { artifactType: 'browser_state' },
    successCriteria: ['Browser state is captured.'],
    status: 'active',
  })
  await createDefaultWorkstation(browserAgent.id)

  const desktopAgent = await createAgentProfile({
    name: 'Smoke Physical Desktop Employee',
    role: 'Desktop worker',
    workstationPolicy: { mode: 'physical_desktop' },
    permissionPolicy: { canUseDesktop: true },
    outputContract: { artifactType: 'desktop_result' },
    successCriteria: ['Desktop result is captured.'],
    status: 'active',
  })
  const competingAgent = await createAgentProfile({
    name: 'Smoke Competing Desktop Employee',
    role: 'Desktop worker',
    workstationPolicy: { mode: 'physical_desktop' },
    permissionPolicy: { canUseDesktop: true },
    outputContract: { artifactType: 'desktop_result' },
    successCriteria: ['Competing desktop result is captured.'],
    status: 'active',
  })
  await acquireResourceLock({
    resourceType: 'physical_mouse_keyboard',
    resourceId: 'default',
    ownerRunId: 'smoke_desktop_conflict_run',
    ownerAgentId: competingAgent.id,
    ttlMs: 60_000,
  })

  const browserPayload = await readJson(
    await getIsolationReport(
      new NextRequest(`http://local/api/agent-profiles/${browserAgent.id}/isolation-report`),
      { params: Promise.resolve({ id: browserAgent.id }) },
    ),
  )
  const desktopPayload = await readJson(
    await getIsolationReport(
      new NextRequest(`http://local/api/agent-profiles/${desktopAgent.id}/isolation-report`),
      { params: Promise.resolve({ id: desktopAgent.id }) },
    ),
  )
  const audit = await readJson(await getAudit())

  assert(browserPayload.report.concurrency.verdict === 'isolated', 'Expected browser Agent to be isolated.')
  assert(browserPayload.report.concurrency.parallelSafe === true, 'Expected browser Agent to be parallel safe.')
  assert(
    browserPayload.report.resourceLocks.required.some(
      (row: { resourceType: string; resourceId: string }) =>
        row.resourceType === 'browser_profile' &&
        row.resourceId === `agent:${browserAgent.id}:browser`,
    ),
    'Expected browser profile lock plan.',
  )
  assert(desktopPayload.report.concurrency.verdict === 'conflict', 'Expected desktop lock conflict.')
  assert(
    desktopPayload.report.resourceLocks.heldConflicts.some(
      (row: { resourceType: string; ownerAgentId: string }) =>
        row.resourceType === 'physical_mouse_keyboard' &&
        row.ownerAgentId === competingAgent.id,
    ),
    'Expected physical desktop conflict owner.',
  )
  assert(
    audit.summary.implementedBaselineSections === 210 &&
      audit.summary.partialSections === 0 &&
      audit.summary.pendingSections === 0,
    `Unexpected audit summary: ${JSON.stringify(audit.summary)}`,
  )
  assert(
    audit.sections.find((section: { sectionNumber: number }) => section.sectionNumber === 6)
      ?.implementationStatus === 'baseline_plus',
    'Expected section 6 to be promoted.',
  )

  console.log(JSON.stringify({
    browserAgentId: browserAgent.id,
    browserVerdict: browserPayload.report.concurrency.verdict,
    desktopAgentId: desktopAgent.id,
    desktopVerdict: desktopPayload.report.concurrency.verdict,
    desktopConflicts: desktopPayload.report.resourceLocks.heldConflicts.length,
    auditSummary: audit.summary,
  }, null, 2))
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
