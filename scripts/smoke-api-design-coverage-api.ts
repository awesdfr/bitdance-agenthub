import { GET as getApiDesignCoverageReport } from '../src/app/api/api-design/coverage-report/route'
import { GET as getAudit } from '../src/app/api/implementation-audit/route'

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
  const payload = await readJson(await getApiDesignCoverageReport())
  const audit = await readJson(await getAudit())
  const report = payload.report

  assert(report.readiness === 'ready', `Expected ready API design report, got ${report.readiness}`)
  assert(report.requiredEndpoints === 36, `Expected 36 required endpoints, got ${report.requiredEndpoints}`)
  assert(report.coveredEndpoints === 36, `Expected 36 covered endpoints, got ${report.coveredEndpoints}`)
  assert(report.exactEndpoints === 33, `Expected 33 exact endpoints, got ${report.exactEndpoints}`)
  assert(report.compatibleEndpoints === 3, `Expected 3 compatible endpoints, got ${report.compatibleEndpoints}`)
  assert(report.missingEndpoints === 0, `Expected no missing endpoints, got ${report.missingEndpoints}`)
  assert(report.items.some(
    (item: { method: string; path: string; status: string }) =>
      item.method === 'PATCH' &&
      item.path === '/api/agent-profiles/:id' &&
      item.status === 'implemented',
  ), 'Expected exact Agent profile PATCH coverage.')
  assert(report.items.some(
    (item: { id: string; status: string; alternativeRoute?: { apiPath: string } }) =>
      item.id === 'workflow_runs_pause' &&
      item.status === 'compatible' &&
      item.alternativeRoute?.apiPath === '/api/employee-runs/:id/pause',
  ), 'Expected workflow-run pause compatible employee-run route.')
  assert(
    audit.summary.implementedBaselineSections === 210 &&
      audit.summary.partialSections === 0 &&
      audit.summary.pendingSections === 0,
    `Unexpected audit summary: ${JSON.stringify(audit.summary)}`,
  )
  assert(
    audit.sections.find((section: { sectionNumber: number }) => section.sectionNumber === 20)
      ?.implementationStatus === 'baseline_plus',
    'Expected section 20 to be promoted.',
  )

  console.log(JSON.stringify({
    readiness: report.readiness,
    requiredEndpoints: report.requiredEndpoints,
    coveredEndpoints: report.coveredEndpoints,
    exactEndpoints: report.exactEndpoints,
    compatibleEndpoints: report.compatibleEndpoints,
    auditSummary: audit.summary,
  }, null, 2))
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
