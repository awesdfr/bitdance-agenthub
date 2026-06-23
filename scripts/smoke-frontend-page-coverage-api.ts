import { GET as getFrontendPageCoverageReport } from '../src/app/api/frontend-pages/coverage-report/route'
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
  const payload = await readJson(await getFrontendPageCoverageReport())
  const audit = await readJson(await getAudit())
  const report = payload.report

  assert(report.readiness === 'ready', `Expected ready frontend report, got ${report.readiness}`)
  assert(report.requiredPages === 8, `Expected 8 required pages, got ${report.requiredPages}`)
  assert(report.coveredPages === 8, `Expected 8 covered pages, got ${report.coveredPages}`)
  assert(report.partialPages === 0, `Expected no partial pages, got ${report.partialPages}`)
  assert(report.missingPages === 0, `Expected no missing pages, got ${report.missingPages}`)
  assert(report.dedicatedPages === 6, `Expected 6 dedicated pages, got ${report.dedicatedPages}`)
  assert(report.compositePages === 2, `Expected 2 composite pages, got ${report.compositePages}`)
  assert(report.items.some(
    (item: { key: string; status: string; sidebar: { componentName: string } }) =>
      item.key === 'skills_center' &&
      item.status === 'covered' &&
      item.sidebar.componentName === 'SkillsCenter',
  ), 'Expected Skills Center coverage.')
  assert(report.items.some(
    (item: { key: string; surfaceKind: string; status: string }) =>
      item.key === 'software_cli_ization' &&
      item.surfaceKind === 'composite' &&
      item.status === 'covered',
  ), 'Expected Software CLI-ization composite coverage.')
  assert(
    audit.summary.implementedBaselineSections === 210 &&
      audit.summary.partialSections === 0 &&
      audit.summary.pendingSections === 0,
    `Unexpected audit summary: ${JSON.stringify(audit.summary)}`,
  )
  assert(
    audit.sections.find((section: { sectionNumber: number }) => section.sectionNumber === 21)
      ?.implementationStatus === 'baseline_plus',
    'Expected section 21 to be promoted.',
  )

  console.log(JSON.stringify({
    readiness: report.readiness,
    requiredPages: report.requiredPages,
    coveredPages: report.coveredPages,
    dedicatedPages: report.dedicatedPages,
    compositePages: report.compositePages,
    auditSummary: audit.summary,
  }, null, 2))
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
