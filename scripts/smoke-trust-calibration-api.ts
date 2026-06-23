import { NextRequest } from 'next/server'

import { GET as getAudit } from '../src/app/api/implementation-audit/route'
import { POST as evaluateTrust } from '../src/app/api/trust-calibration/evaluate/route'
import {
  GET as listEvaluations,
} from '../src/app/api/trust-calibration/evaluations/route'
import {
  GET as listPolicies,
  POST as createPolicy,
} from '../src/app/api/trust-calibration/policies/route'
import { POST as seedPolicies } from '../src/app/api/trust-calibration/policies/seed/route'

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
      new NextRequest('http://local/api/trust-calibration/policies', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: 'Smoke trust calibration policy',
          config: {
            highConfidenceIndicators: {
              showConfidenceBadge: true,
              showEvidence: true,
              showVerifiedCheck: true,
            },
            lowConfidenceIndicators: {
              showWarningBadge: true,
              showUncertaintyReason: true,
              suggestHumanReview: true,
            },
            antiOverTrust: {
              streakWarning: 8,
              periodicRealityCheck: true,
            },
          },
        }),
      }),
    ),
  )
  const policy = policyResponse.policy
  const highTrust = await readJson(
    await evaluateTrust(
      new NextRequest('http://local/api/trust-calibration/evaluate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          policyId: policy.id,
          currentAutonomyLevel: 'execute_with_approval',
          metrics: {
            daysActive: 45,
            runCount: 48,
            successRate: 0.92,
            approvalsApproved: 20,
            approvalsRejected: 1,
            takeoverCount: 0,
            modificationRate: 0.04,
            similarTaskCount: 47,
            verifiedArtifactCount: 39,
            highConfidenceSuccessStreak: 5,
          },
        }),
      }),
    ),
  )
  const lowTrust = await readJson(
    await evaluateTrust(
      new NextRequest('http://local/api/trust-calibration/evaluate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          policyId: policy.id,
          currentAutonomyLevel: 'fully_autonomous',
          metrics: {
            daysActive: 4,
            runCount: 3,
            successRate: 0.33,
            approvalsApproved: 1,
            approvalsRejected: 3,
            takeoverCount: 4,
            modificationRate: 0.55,
            similarTaskCount: 0,
            verifiedArtifactCount: 0,
            highConfidenceSuccessStreak: 0,
          },
        }),
      }),
    ),
  )
  const policies = await readJson(
    await listPolicies(new NextRequest('http://local/api/trust-calibration/policies?status=active')),
  )
  const increaseEvaluations = await readJson(
    await listEvaluations(
      new NextRequest('http://local/api/trust-calibration/evaluations?recommendation=increase_autonomy'),
    ),
  )
  const audit = await readJson(await getAudit())

  assert(seeded.policies.length >= 1, 'Expected seeded trust policy')
  assert(highTrust.evaluation.recommendedTrustLevel === 'high', `Unexpected high trust: ${JSON.stringify(highTrust.evaluation)}`)
  assert(highTrust.evaluation.recommendedAutonomyLevel === 'fully_autonomous', 'Expected high trust to map to full autonomy')
  assert(highTrust.evaluation.recommendation === 'increase_autonomy', 'Expected autonomy increase recommendation')
  assert(highTrust.evaluation.signals.some((signal: { kind: string }) => signal.kind === 'high_confidence_badge'), 'Expected high-confidence signal')
  assert(lowTrust.evaluation.recommendation === 'decrease_autonomy', 'Expected autonomy decrease recommendation')
  assert(lowTrust.evaluation.signals.some((signal: { kind: string }) => signal.kind === 'warning_badge'), 'Expected warning signal')
  assert(policies.policies.some((row: { id: string }) => row.id === policy.id), 'Policy should be listable')
  assert(
    increaseEvaluations.evaluations.some((row: { id: string }) => row.id === highTrust.evaluation.id),
    'Increase evaluation should be listable',
  )
  assert(
    audit.summary.implementedBaselineSections === 210 &&
      audit.summary.partialSections === 0 &&
      audit.summary.pendingSections === 0,
    `Unexpected audit summary: ${JSON.stringify(audit.summary)}`,
  )
  assert(
    audit.sections[120]?.implementationStatus === 'baseline_plus',
    `Section 121 was not promoted: ${JSON.stringify(audit.sections[120])}`,
  )

  console.log(
    JSON.stringify(
      {
        seededPolicies: seeded.policies.length,
        highTrustRecommendation: highTrust.evaluation.recommendation,
        highTrustLevel: highTrust.evaluation.recommendedTrustLevel,
        lowTrustRecommendation: lowTrust.evaluation.recommendation,
        auditSummary: audit.summary,
        section121Status: audit.sections[120]?.implementationStatus,
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
