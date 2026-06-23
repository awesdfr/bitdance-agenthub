import { GET as getDatabaseCoverageReport } from '../src/app/api/database/coverage-report/route'
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
  const payload = await readJson(await getDatabaseCoverageReport())
  const audit = await readJson(await getAudit())
  const report = payload.report

  assert(report.readiness === 'ready', `Expected ready database coverage report, got ${report.readiness}`)
  assert(report.requiredItems === 26, `Expected 26 required items, got ${report.requiredItems}`)
  assert(report.coveredItems === 26, `Expected 26 covered items, got ${report.coveredItems}`)
  assert(report.missingItems === 0, `Expected no missing items, got ${report.missingItems}`)
  assert(report.physicalTables === 24, `Expected 24 physical table items, got ${report.physicalTables}`)
  assert(report.embeddedPolicyItems === 2, `Expected 2 embedded policy items, got ${report.embeddedPolicyItems}`)
  assert(report.items.some(
    (item: { key: string; storageKind: string; physicalTable: string; status: string }) =>
      item.key === 'agent_permissions' &&
      item.storageKind === 'embedded_json_policy' &&
      item.physicalTable === 'agent_profiles' &&
      item.status === 'covered',
  ), 'Expected agent_permissions embedded policy coverage.')
  assert(report.items.some(
    (item: { key: string; storageKind: string; physicalTable: string; status: string }) =>
      item.key === 'agent_memory_policies' &&
      item.storageKind === 'embedded_json_policy' &&
      item.physicalTable === 'agent_profiles' &&
      item.status === 'covered',
  ), 'Expected agent_memory_policies embedded policy coverage.')
  assert(report.currentTables.includes('agent_workstations'), 'Expected live SQLite agent_workstations table.')
  assert(
    audit.summary.implementedBaselineSections === 210 &&
      audit.summary.partialSections === 0 &&
      audit.summary.pendingSections === 0,
    `Unexpected audit summary: ${JSON.stringify(audit.summary)}`,
  )
  assert(
    audit.sections.find((section: { sectionNumber: number }) => section.sectionNumber === 18)
      ?.implementationStatus === 'baseline_plus',
    'Expected section 18 to be promoted.',
  )

  console.log(JSON.stringify({
    readiness: report.readiness,
    requiredItems: report.requiredItems,
    coveredItems: report.coveredItems,
    physicalTables: report.physicalTables,
    embeddedPolicyItems: report.embeddedPolicyItems,
    auditSummary: audit.summary,
  }, null, 2))
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
