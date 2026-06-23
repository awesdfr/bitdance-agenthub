import { NextRequest } from 'next/server'

import { GET as getRunSnapshot } from '../src/app/api/employee-runs/[id]/route'
import { GET as getAudit } from '../src/app/api/implementation-audit/route'
import { createAgentProfile } from '../src/server/control-plane-service'
import { startEmployeeRun } from '../src/server/employee-runtime-service'

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
  const agent = await createAgentProfile({
    name: 'Smoke Runtime Loop Employee',
    role: 'Runtime Verifier',
    description: 'Verifies deterministic employee runtime loop traces.',
    memoryPolicy: { scope: 'project' },
    autonomyPolicy: { level: 'execute_low_risk' },
    workstationPolicy: { mode: 'browser_context' },
    permissionPolicy: { canReadFiles: true },
    inputContract: { goal: { type: 'string' } },
    outputContract: {
      artifactType: 'report',
      requiredFiles: ['runtime-loop.md'],
      validationRules: ['loop trace exists'],
    },
    systemPrompt: 'Run deterministic runtime smoke checks.',
    behaviorRules: ['Keep actions observable.'],
    successCriteria: ['Loop trace is present.'],
    status: 'active',
  })
  const run = await startEmployeeRun({
    agentProfileId: agent.id,
    goal: 'Verify the runtime employee loop trace',
    input: { smoke: true },
  })
  const snapshot = await readJson(
    await getRunSnapshot(
      new NextRequest(`http://local/api/employee-runs/${run.id}`),
      { params: Promise.resolve({ id: run.id }) },
    ),
  )
  const audit = await readJson(await getAudit())
  const output = snapshot.run.output
  const retrieveEvent = snapshot.events.find((event: { phase: string }) => event.phase === 'retrieve_memory')

  assert(snapshot.run.status === 'complete', 'Expected completed employee run.')
  assert(Array.isArray(output.loopTrace), 'Expected output.loopTrace array.')
  assert(output.loopTrace.length === 5, `Expected five loop trace steps, got ${output.loopTrace.length}.`)
  assert(
    output.loopTrace.some((step: { phase: string; selectedAction: string }) =>
      step.phase === 'verify_output_contract' && step.selectedAction === 'verify_output_contract',
    ),
    'Expected output contract verification trace.',
  )
  assert(output.nextRuntimeAction.action === 'handoff_to_executor', 'Expected executor handoff next action.')
  assert(retrieveEvent?.payload?.loopTrace?.phase === 'retrieve_memory', 'Expected retrieve event loop trace.')
  assert(
    audit.summary.implementedBaselineSections === 210 &&
      audit.summary.partialSections === 0 &&
      audit.summary.pendingSections === 0,
    `Unexpected audit summary: ${JSON.stringify(audit.summary)}`,
  )
  assert(
    audit.sections.find((section: { sectionNumber: number }) => section.sectionNumber === 4)
      ?.implementationStatus === 'baseline_plus',
    'Expected section 4 to be promoted.',
  )

  console.log(JSON.stringify({
    runId: run.id,
    status: snapshot.run.status,
    loopTraceSteps: output.loopTrace.length,
    nextRuntimeAction: output.nextRuntimeAction,
    retrieveLoopTrace: retrieveEvent.payload.loopTrace,
    auditSummary: audit.summary,
    section4Status: audit.sections.find((section: { sectionNumber: number }) => section.sectionNumber === 4)
      ?.implementationStatus,
  }, null, 2))
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
