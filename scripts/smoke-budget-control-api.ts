import { NextRequest } from 'next/server'

import { GET as getAudit } from '../src/app/api/implementation-audit/route'
import { POST as evaluateBudget } from '../src/app/api/budget-control/evaluate/route'
import { GET as listEvaluations } from '../src/app/api/budget-control/evaluations/route'
import {
  GET as listPolicies,
  POST as createPolicy,
} from '../src/app/api/budget-control/policies/route'
import { POST as seedPolicies } from '../src/app/api/budget-control/policies/seed/route'
import { GET as getUsageReport } from '../src/app/api/budget-control/usage-report/route'

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
  const seeded = await readJson(await seedPolicies())
  const policyResponse = await readJson(
    await createPolicy(
      new NextRequest('http://local/api/budget-control/policies', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: 'Smoke budget policy',
          scope: 'per_task',
          limitType: 'usd_amount',
          limit: 1,
          hardCap: true,
          notifyAtPercent: 80,
          config: {
            routingRules: [{
              condition: 'estimated_steps',
              operator: 'lt',
              value: 3,
              routeTo: 'smoke-cheap-model',
            }],
          },
        }),
      }),
    ),
  )
  const policy = policyResponse.policy
  const warning = await readJson(
    await evaluateBudget(
      new NextRequest('http://local/api/budget-control/evaluate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          policyId: policy.id,
          projectId: 'smoke-budget-project',
          observedUsd: 0.7,
          estimatedAdditionalUsd: 0.15,
          observedTokens: 12000,
          estimatedAdditionalTokens: 3000,
          selectedModelProfileId: 'smoke-premium-model',
          task: {
            estimatedSteps: 2,
            projectId: 'smoke-budget-project',
          },
        }),
      }),
    ),
  )
  const blocked = await readJson(
    await evaluateBudget(
      new NextRequest('http://local/api/budget-control/evaluate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          policyId: policy.id,
          projectId: 'smoke-budget-project',
          observedUsd: 1.2,
          estimatedAdditionalUsd: 0.05,
          task: {
            estimatedSteps: 5,
            projectId: 'smoke-budget-project',
          },
        }),
      }),
    ),
  )
  const policies = await readJson(
    await listPolicies(new NextRequest('http://local/api/budget-control/policies?scope=per_task&status=active')),
  )
  const blockedEvaluations = await readJson(
    await listEvaluations(new NextRequest('http://local/api/budget-control/evaluations?status=blocked')),
  )
  const report = await readJson(
    await getUsageReport(
      new NextRequest('http://local/api/budget-control/usage-report?groupBy=project&projectId=smoke-budget-project'),
    ),
  )
  const audit = await readJson(await getAudit())

  assert(seeded.policies.length >= 4, 'Expected seeded budget policies')
  assert(warning.evaluation.status === 'notify', `Unexpected warning evaluation: ${JSON.stringify(warning)}`)
  assert(warning.evaluation.action === 'notify_user', 'Expected warning action')
  assert(warning.evaluation.routedModelProfileId === 'smoke-cheap-model', 'Expected routing hint')
  assert(blocked.evaluation.status === 'blocked', 'Expected hard cap block')
  assert(blocked.evaluation.action === 'stop_task', 'Expected stop-task action')
  assert(policies.policies.some((row: { id: string }) => row.id === policy.id), 'Policy should be listable')
  assert(
    blockedEvaluations.evaluations.some((row: { id: string }) => row.id === blocked.evaluation.id),
    'Blocked evaluation should be listable',
  )
  assert(report.report.csv.includes('blockedCount'), 'Usage report should include CSV export')
  assert(
    audit.summary.implementedBaselineSections === 210 &&
      audit.summary.partialSections === 0 &&
      audit.summary.pendingSections === 0,
    `Unexpected audit summary: ${JSON.stringify(audit.summary)}`,
  )
  assert(
    audit.sections[26]?.implementationStatus === 'baseline_plus',
    `Section 27 was not promoted: ${JSON.stringify(audit.sections[26])}`,
  )

  console.log(
    JSON.stringify(
      {
        seededPolicies: seeded.policies.length,
        warningAction: warning.evaluation.action,
        blockedAction: blocked.evaluation.action,
        reportRows: report.report.rows.length,
        auditSummary: audit.summary,
        section27Status: audit.sections[26]?.implementationStatus,
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
