import assert from 'node:assert/strict'

import { GET as getImplementationAudit } from '../src/app/api/implementation-audit/route'
import { GET as getPhasePlanCoverageReport } from '../src/app/api/phase-plan/coverage-report/route'

async function readJson<T>(response: Response): Promise<T> {
  assert.equal(response.ok, true)
  return response.json() as Promise<T>
}

async function main() {
  const { report } = await readJson<{
    report: {
      readiness: string
      requiredPhases: number
      coveredPhases: number
      baselineReadyPhases: number
      reservedPhases: number
      missingPhases: number
      gaps: string[]
      warnings: string[]
      items: Array<{
        phase: number
        title: string
        status: string
        warnings: string[]
        files: Array<{ path: string; exists: boolean; missingMarkers: string[] }>
      }>
    }
  }>(await getPhasePlanCoverageReport())

  assert.equal(report.readiness, 'ready')
  assert.equal(report.requiredPhases, 7)
  assert.equal(report.coveredPhases, 7)
  assert.equal(report.baselineReadyPhases, 7)
  assert.equal(report.reservedPhases, 0)
  assert.equal(report.missingPhases, 0)
  assert.deepEqual(report.gaps, [])
  assert.equal(report.items.map((item) => item.phase).join(','), '1,2,3,4,5,6,7')

  const phaseSeven = report.items.find((item) => item.phase === 7)
  assert.ok(phaseSeven)
  assert.equal(phaseSeven.status, 'baseline_ready')
  assert.equal(phaseSeven.title, 'Virtual workstations')
  assert.equal(phaseSeven.warnings.length, 0)
  assert.deepEqual(
    phaseSeven.files.map((file) => file.path),
    [
      'src/db/schema.ts',
      'src/server/agent-isolation-service.ts',
      'src/server/runtime-control-service.ts',
      'src/server/production-integration-service.ts',
    ],
  )
  assert.ok(phaseSeven.files.every((file) => file.exists))
  assert.ok(phaseSeven.files.every((file) => file.missingMarkers.length === 0))

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

  const section = audit.sections.find((item) => item.sectionNumber === 22)
  assert.ok(section)
  assert.equal(section.implementationStatus, 'baseline_plus')
  assert.ok(section.evidence.join(' ').toLowerCase().includes('phase-plan coverage'))
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
