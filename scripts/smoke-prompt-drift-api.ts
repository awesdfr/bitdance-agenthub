import { NextRequest } from 'next/server'

import { GET as getAudit } from '../src/app/api/implementation-audit/route'
import { POST as runCheck } from '../src/app/api/prompt-drift/checks/route'
import { GET as listMonitors, POST as createMonitor } from '../src/app/api/prompt-drift/monitors/route'
import { GET as listRuns } from '../src/app/api/prompt-drift/runs/route'
import { GET as listSnapshots, POST as createSnapshot } from '../src/app/api/prompt-drift/snapshots/route'

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
  const monitorResponse = await readJson(
    await createMonitor(
      new NextRequest('http://local/api/prompt-drift/monitors', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: 'Smoke prompt drift monitor',
          schedule: '7d',
          onDriftDetected: 'create_incident',
        }),
      }),
    ),
  )
  const monitor = monitorResponse.monitor
  const baselineResponse = await readJson(
    await createSnapshot(
      new NextRequest('http://local/api/prompt-drift/snapshots', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          monitorId: monitor.id,
          modelName: 'gpt-4o',
          modelDate: '2025-01-15',
          providerVersion: 'baseline',
          pinned: true,
          benchmarkResults: {
            output_format_schema_score: 0.99,
            refusal_rate: 0.02,
            avg_output_tokens: 700,
            tool_call_accuracy: 0.98,
            reasoning_quality_score: 0.95,
            latency_ms_p95: 1000,
            cost_usd_per_task: 0.02,
          },
        }),
      }),
    ),
  )
  const candidateResponse = await readJson(
    await createSnapshot(
      new NextRequest('http://local/api/prompt-drift/snapshots', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          monitorId: monitor.id,
          modelName: 'gpt-4o',
          modelDate: '2025-02-15',
          providerVersion: 'candidate',
          benchmarkResults: {
            output_format_schema_score: 0.9,
            refusal_rate: 0.2,
            avg_output_tokens: 1200,
            tool_call_accuracy: 0.8,
            reasoning_quality_score: 0.78,
            latency_ms_p95: 1600,
            cost_usd_per_task: 0.04,
          },
        }),
      }),
    ),
  )
  const baseline = baselineResponse.snapshot
  const candidate = candidateResponse.snapshot
  const driftRunResponse = await readJson(
    await runCheck(
      new NextRequest('http://local/api/prompt-drift/checks', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          monitorId: monitor.id,
          baselineSnapshotId: baseline.id,
          candidateSnapshotId: candidate.id,
        }),
      }),
    ),
  )
  const driftRun = driftRunResponse.run
  const monitors = await readJson(
    await listMonitors(
      new NextRequest(`http://local/api/prompt-drift/monitors?status=active&schedule=7d`),
    ),
  )
  const pinnedSnapshots = await readJson(
    await listSnapshots(
      new NextRequest(`http://local/api/prompt-drift/snapshots?monitorId=${monitor.id}&pinned=true`),
    ),
  )
  const driftRuns = await readJson(
    await listRuns(
      new NextRequest(`http://local/api/prompt-drift/runs?monitorId=${monitor.id}&status=drift_detected`),
    ),
  )
  const audit = await readJson(await getAudit())

  assert(monitors.monitors.some((row: { id: string }) => row.id === monitor.id), 'Monitor should be listable')
  assert(pinnedSnapshots.snapshots.some((row: { id: string }) => row.id === baseline.id), 'Pinned baseline should be listable')
  assert(driftRun.status === 'drift_detected', `Expected drift_detected, got ${driftRun.status}`)
  assert(driftRun.recommendedAction === 'create_incident', `Expected create_incident, got ${driftRun.recommendedAction}`)
  assert(driftRun.driftSignals.length >= 7, `Expected at least 7 drift signals, got ${driftRun.driftSignals.length}`)
  assert(driftRuns.runs.some((row: { id: string }) => row.id === driftRun.id), 'Drift run should be listable')
  assert(
    audit.summary.implementedBaselineSections === 210 &&
      audit.summary.partialSections === 0 &&
      audit.summary.pendingSections === 0,
    `Unexpected audit summary: ${JSON.stringify(audit.summary)}`,
  )
  assert(
    audit.sections[117]?.implementationStatus === 'baseline_plus',
    `Section 118 was not promoted: ${JSON.stringify(audit.sections[117])}`,
  )

  console.log(
    JSON.stringify(
      {
        monitorId: monitor.id,
        baselineSnapshotId: baseline.id,
        candidateSnapshotId: candidate.id,
        driftRunStatus: driftRun.status,
        driftSignalCount: driftRun.driftSignals.length,
        recommendedAction: driftRun.recommendedAction,
        auditSummary: audit.summary,
        section118Status: audit.sections[117]?.implementationStatus,
      },
      null,
      2,
    ),
  )
}

main().catch((err) => {
  console.error(err)
  process.exitCode = 1
})
