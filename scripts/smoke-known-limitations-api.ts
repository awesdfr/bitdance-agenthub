import { NextRequest } from 'next/server'

import { GET as getAudit } from '../src/app/api/implementation-audit/route'
import { GET as listAcknowledgements } from '../src/app/api/known-limitations/acknowledgements/route'
import { POST as acknowledgeLimitation } from '../src/app/api/known-limitations/[id]/acknowledge/route'
import { POST as evaluateLimitations } from '../src/app/api/known-limitations/evaluate/route'
import { GET as listLimitations } from '../src/app/api/known-limitations/route'
import { POST as seedLimitations } from '../src/app/api/known-limitations/seed/route'

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
  const seed = await readJson(await seedLimitations())
  const browser = await readJson(
    await listLimitations(
      new NextRequest('http://local/api/known-limitations?category=browser_automation&status=active'),
    ),
  )
  const agentFactory = await readJson(
    await listLimitations(
      new NextRequest('http://local/api/known-limitations?surface=agent_factory&status=active'),
    ),
  )
  const evaluated = await readJson(
    await evaluateLimitations(
      new NextRequest('http://local/api/known-limitations/evaluate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          requestedCapabilities: ['mobile phone', 'captcha', 'native_dialog', 'cluster'],
          surface: 'run_preflight',
        }),
      }),
    ),
  )
  const mobile = seed.limitations.find(
    (limitation: { limitationKey: string }) => limitation.limitationKey === 'mobile_operation_v2',
  )
  assert(mobile, 'Expected mobile_operation_v2 limitation')
  const acknowledgement = await readJson(
    await acknowledgeLimitation(
      new NextRequest(`http://local/api/known-limitations/${mobile.id}/acknowledge`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          acknowledgedBy: 'smoke_user',
          surface: 'run_preflight',
          note: 'Smoke acknowledgement.',
        }),
      }),
      { params: Promise.resolve({ id: mobile.id }) },
    ),
  )
  const acknowledgements = await readJson(
    await listAcknowledgements(
      new NextRequest(
        `http://local/api/known-limitations/acknowledgements?limitationId=${mobile.id}&acknowledgedBy=smoke_user`,
      ),
    ),
  )
  const audit = await readJson(await getAudit())

  assert(seed.limitations.length === 10, `Expected 10 limitations, got ${seed.limitations.length}`)
  assert(browser.limitations.length === 1, `Expected one browser limitation, got ${browser.limitations.length}`)
  assert(
    agentFactory.limitations.length >= 4,
    `Expected at least four Agent Factory limitations, got ${agentFactory.limitations.length}`,
  )
  assert(
    evaluated.summary.total === 4 &&
      evaluated.summary.blocking === 4 &&
      evaluated.summary.requiresAcknowledgement === 4 &&
      evaluated.summary.canProceedWithoutUserAcknowledgement === false,
    `Unexpected limitation preflight summary: ${JSON.stringify(evaluated.summary)}`,
  )
  assert(
    acknowledgement.acknowledgement.limitationId === mobile.id,
    'Expected acknowledgement to reference mobile limitation',
  )
  assert(
    acknowledgements.acknowledgements.some((row: { id: string }) => row.id === acknowledgement.acknowledgement.id),
    'Expected acknowledgement to be listable',
  )
  assert(
    audit.summary.implementedBaselineSections === 210 &&
      audit.summary.partialSections === 0 &&
      audit.summary.pendingSections === 0,
    `Unexpected audit summary: ${JSON.stringify(audit.summary)}`,
  )
  assert(
    audit.sections[111]?.implementationStatus === 'baseline_plus',
    `Section 112 was not promoted: ${JSON.stringify(audit.sections[111])}`,
  )

  console.log(
    JSON.stringify(
      {
        seededLimitations: seed.limitations.length,
        browserLimitations: browser.limitations.length,
        agentFactoryLimitations: agentFactory.limitations.length,
        evaluationSummary: evaluated.summary,
        acknowledgementId: acknowledgement.acknowledgement.id,
        auditSummary: audit.summary,
        section112Status: audit.sections[111]?.implementationStatus,
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
