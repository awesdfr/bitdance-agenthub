import assert from 'node:assert/strict'

import { GET as getImplementationAudit } from '../src/app/api/implementation-audit/route'
import { GET as getProductEffectsCoverageReport } from '../src/app/api/product-effects/coverage-report/route'

async function readJson<T>(response: Response): Promise<T> {
  assert.equal(response.ok, true)
  return response.json() as Promise<T>
}

async function main() {
  const { report } = await readJson<{
    report: {
      readiness: string
      requiredEffects: number
      coveredEffects: number
      availableEffects: number
      guardedEffects: number
      reservedEffects: number
      missingEffects: number
      gaps: string[]
      warnings: string[]
      items: Array<{
        key: string
        status: string
        evidenceFiles: Array<{ path: string; exists: boolean; missingMarkers: string[] }>
      }>
    }
  }>(await getProductEffectsCoverageReport())

  assert.equal(report.readiness, 'ready')
  assert.equal(report.requiredEffects, 13)
  assert.equal(report.coveredEffects, 13)
  assert.equal(report.availableEffects, 10)
  assert.equal(report.guardedEffects, 3)
  assert.equal(report.reservedEffects, 0)
  assert.equal(report.missingEffects, 0)
  assert.deepEqual(report.gaps, [])
  assert.ok(report.warnings.join(' ').includes('Live desktop control'))
  assert.ok(report.warnings.join(' ').includes('VM/RDP/VNC workstation infrastructure'))

  const keys = report.items.map((item) => item.key)
  for (const key of [
    'agent_employee_factory',
    'self_planning_runtime',
    'memory_learning',
    'cli_orchestration',
    'computer_browser_operation',
    'canvas_team_workflow',
    'progress_visibility',
    'verifiable_artifacts',
    'multi_agent_parallel',
    'software_cli_ization',
    'local_ai_employee_os',
  ]) {
    assert.ok(keys.includes(key), `Missing product effect ${key}`)
  }
  assert.ok(report.items.every((item) => item.status !== 'missing'))
  assert.ok(report.items.every((item) => item.status !== 'reserved'))
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

  const section = audit.sections.find((item) => item.sectionNumber === 24)
  assert.ok(section)
  assert.equal(section.implementationStatus, 'baseline_plus')
  assert.ok(section.evidence.join(' ').includes('Product-effects coverage'))
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
