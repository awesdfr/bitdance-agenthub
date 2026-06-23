import { GET as getBackendServiceCoverageReport } from '../src/app/api/backend-services/coverage-report/route'
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
  const payload = await readJson(await getBackendServiceCoverageReport())
  const audit = await readJson(await getAudit())
  const report = payload.report

  assert(report.readiness === 'ready', `Expected ready backend service report, got ${report.readiness}`)
  assert(report.requiredServices === 17, `Expected 17 required services, got ${report.requiredServices}`)
  assert(report.coveredServices === 17, `Expected 17 covered services, got ${report.coveredServices}`)
  assert(report.weakServices === 0, `Expected no weak services, got ${report.weakServices}`)
  assert(report.missingServices === 0, `Expected no missing services, got ${report.missingServices}`)
  assert(report.dedicatedServices === 11, `Expected 11 dedicated services, got ${report.dedicatedServices}`)
  assert(report.compositeServices === 6, `Expected 6 composite services, got ${report.compositeServices}`)
  assert(report.criticalServices === 5, `Expected 5 critical services, got ${report.criticalServices}`)
  assert(report.coveredCriticalServices === 5, `Expected 5 covered critical services, got ${report.coveredCriticalServices}`)
  assert(report.items.some(
    (item: { key: string; priority: string; status: string }) =>
      item.key === 'AgentEmployeeRuntime' &&
      item.priority === 'critical' &&
      item.status === 'covered',
  ), 'Expected AgentEmployeeRuntime critical coverage.')
  assert(report.items.some(
    (item: { key: string; implementationKind: string; apiEvidence: string[] }) =>
      item.key === 'ApprovalService' &&
      item.implementationKind === 'composite' &&
      item.apiEvidence.includes('/api/approvals/:id/approve'),
  ), 'Expected ApprovalService composite API evidence.')
  assert(
    audit.summary.implementedBaselineSections === 210 &&
      audit.summary.partialSections === 0 &&
      audit.summary.pendingSections === 0,
    `Unexpected audit summary: ${JSON.stringify(audit.summary)}`,
  )
  assert(
    audit.sections.find((section: { sectionNumber: number }) => section.sectionNumber === 19)
      ?.implementationStatus === 'baseline_plus',
    'Expected section 19 to be promoted.',
  )

  console.log(JSON.stringify({
    readiness: report.readiness,
    requiredServices: report.requiredServices,
    coveredServices: report.coveredServices,
    dedicatedServices: report.dedicatedServices,
    compositeServices: report.compositeServices,
    criticalServices: report.criticalServices,
    auditSummary: audit.summary,
  }, null, 2))
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
