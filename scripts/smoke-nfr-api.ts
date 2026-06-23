import { NextRequest } from 'next/server'

import { GET as getAudit } from '../src/app/api/implementation-audit/route'
import { POST as evaluateNfr } from '../src/app/api/nfr/evaluate/route'
import { GET as listNfrEvaluations } from '../src/app/api/nfr/evaluations/route'
import { GET as listNfrRequirements } from '../src/app/api/nfr/requirements/route'
import { POST as seedNfr } from '../src/app/api/nfr/requirements/seed/route'

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
  const seed = await readJson(await seedNfr())
  const security = await readJson(
    await listNfrRequirements(
      new NextRequest('http://local/api/nfr/requirements?category=security&status=active'),
    ),
  )
  const evaluated = await readJson(
    await evaluateNfr(
      new NextRequest('http://local/api/nfr/evaluate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          observed: {
            reliability: {
              memoryGrowthPercent24h: 3,
              singleAgentHoursWithoutCrash: 9,
              modelCallMemoryGrowthPercent: 7,
            },
            usability: {
              uiResponseMsP95: 180,
              agentStatusUpdateMsP95: 450,
              stackTraceShownToNormalUsers: false,
            },
            compatibility: {
              windows10_21h2Plus: true,
              macos13Plus: false,
              minRamGb: 16,
              minFreeDiskGb: 1,
            },
            security: {
              secretResidencyMinimized: true,
              memoryDumpPlaintextSecrets: false,
              coreDumpPlaintextSecrets: false,
              dependencyScanFreshDays: 3,
            },
            maintainability: {
              serviceUnitTestCoveragePercent: 85,
              criticalPathIntegrationCoverage: true,
              swallowedExceptionFindings: 1,
              moduleReadmeCoveragePercent: 90,
            },
          },
        }),
      }),
    ),
  )
  const failed = await readJson(
    await listNfrEvaluations(
      new NextRequest('http://local/api/nfr/evaluations?status=failed&limit=20'),
    ),
  )
  const audit = await readJson(await getAudit())
  const section111 = audit.sections[110]

  assert(seed.requirements.length === 18, `Expected 18 NFR requirements, got ${seed.requirements.length}`)
  assert(
    security.requirements.length >= 4,
    `Expected at least 4 security requirements, got ${security.requirements.length}`,
  )
  assert(
    evaluated.summary.total === 18 &&
      evaluated.summary.failed === 4 &&
      evaluated.summary.unknown === 0,
    `Unexpected NFR summary: ${JSON.stringify(evaluated.summary)}`,
  )
  assert(
    failed.evaluations.length >= 4,
    `Expected failed evaluation rows, got ${failed.evaluations.length}`,
  )
  assert(
    audit.summary.implementedBaselineSections === 210 &&
      audit.summary.partialSections === 0 &&
      audit.summary.pendingSections === 0,
    `Unexpected audit summary: ${JSON.stringify(audit.summary)}`,
  )

  console.log(
    JSON.stringify(
      {
        seededRequirements: seed.requirements.length,
        securityRequirements: security.requirements.length,
        evaluationSummary: evaluated.summary,
        failedEvaluationRows: failed.evaluations.length,
        auditSummary: audit.summary,
      section111Status: section111?.implementationStatus ?? null,
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
