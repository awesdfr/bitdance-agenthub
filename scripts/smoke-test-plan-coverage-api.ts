import assert from 'node:assert/strict'

import { GET as getImplementationAudit } from '../src/app/api/implementation-audit/route'
import { GET as getTestPlanCoverageReport } from '../src/app/api/test-plan/coverage-report/route'

async function readJson<T>(response: Response): Promise<T> {
  assert.equal(response.ok, true)
  return response.json() as Promise<T>
}

async function main() {
  const { report } = await readJson<{
    report: {
      readiness: string
      requiredItems: number
      coveredItems: number
      missingItems: number
      gaps: string[]
      categories: Record<string, { requiredItems: number; coveredItems: number; missingItems: number }>
      items: Array<{
        key: string
        category: string
        status: string
        evidenceFiles: Array<{ path: string; exists: boolean; missingMarkers: string[] }>
      }>
    }
  }>(await getTestPlanCoverageReport())

  assert.equal(report.readiness, 'ready')
  assert.equal(report.requiredItems, 18)
  assert.equal(report.coveredItems, 18)
  assert.equal(report.missingItems, 0)
  assert.deepEqual(report.gaps, [])
  assert.equal(report.categories.tools.coveredItems, 4)
  assert.equal(report.categories.isolation.coveredItems, 4)
  assert.equal(report.categories.runtime.coveredItems, 3)

  const requiredKeys = [
    'model_connection',
    'network_egress',
    'agent_permission_interception',
    'cli_profile_execution',
    'mcp_tool_invocation',
    'skills_install_enable',
    'agent_runtime_loop',
    'artifact_validation',
    'multi_agent_parallel',
    'resource_lock_conflict',
    'browser_session_isolation',
    'file_write_isolation',
    'memory_write_retrieval',
    'learning_review',
    'software_macro_record_replay',
    'canvas_node_status',
    'approval_pause_resume',
    'failure_recovery_retry',
  ]
  assert.deepEqual(
    [...report.items.map((item) => item.key)].sort(),
    [...requiredKeys].sort(),
  )
  assert.ok(report.items.every((item) => item.status === 'covered'))
  assert.ok(report.items.every((item) => item.evidenceFiles.every((file) => file.exists)))
  assert.ok(report.items.every((item) => item.evidenceFiles.every((file) => file.missingMarkers.length === 0)))

  const audit = await readJson<{
    summary: {
      totalSections: number
      implementedBaselineSections: number
      partialSections: number
      pendingSections: number
    }
    sections: Array<{ sectionNumber: number; implementationStatus: string; evidence: string[] }>
  }>(await getImplementationAudit())

  assert.equal(audit.summary.totalSections, 210)
  assert.equal(audit.summary.implementedBaselineSections, 210)
  assert.equal(audit.summary.partialSections, 0)
  assert.equal(audit.summary.pendingSections, 0)

  const section = audit.sections.find((item) => item.sectionNumber === 23)
  assert.ok(section)
  assert.equal(section.implementationStatus, 'baseline_plus')
  assert.ok(section.evidence.join(' ').includes('Test-plan coverage'))
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
