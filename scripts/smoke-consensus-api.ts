import { NextRequest } from 'next/server'

import { GET as getAudit } from '../src/app/api/implementation-audit/route'
import {
  GET as listVotes,
  POST as createVote,
} from '../src/app/api/consensus/agent-votes/route'
import {
  GET as listReviews,
  POST as createReview,
} from '../src/app/api/consensus/adversarial-reviews/route'
import {
  GET as listVerifications,
  POST as createVerification,
} from '../src/app/api/consensus/dual-model-verifications/route'

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
  const verificationResponse = await readJson(
    await createVerification(
      new NextRequest('http://local/api/consensus/dual-model-verifications', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          appliesTo: 'security_analysis',
          secondaryModel: 'different_provider',
          primaryResult: { decision: 'approve', risk: 'medium', confidence: 0.72 },
          secondaryResult: { decision: 'revise', risk: 'high', confidence: 0.91 },
        }),
      }),
    ),
  )
  const voteResponse = await readJson(
    await createVote(
      new NextRequest('http://local/api/consensus/agent-votes', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          question: 'Should this workflow ship?',
          quorum: 3,
          requiredMajority: 0.6,
          voters: [
            { agentId: 'agent-security', vote: 'approve', reasoning: 'Controls pass.', confidence: 0.8 },
            { agentId: 'agent-code', vote: 'approve', reasoning: 'Patch is small.', confidence: 0.7 },
            { agentId: 'agent-ops', vote: 'reject', reasoning: 'Rollback weak.', confidence: 0.6 },
          ],
        }),
      }),
    ),
  )
  const reviewResponse = await readJson(
    await createReview(
      new NextRequest('http://local/api/consensus/adversarial-reviews', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          targetTitle: 'Payment workflow launch plan',
          skepticism: 0.95,
          targetContent: {
            summary: 'We assume provider callbacks are reliable and launch without extra evidence.',
            plan: 'Ship fast after happy-path tests.',
          },
        }),
      }),
    ),
  )
  const verification = verificationResponse.verification
  const vote = voteResponse.vote
  const review = reviewResponse.review
  const verifications = await readJson(
    await listVerifications(
      new NextRequest('http://local/api/consensus/dual-model-verifications?recommendedAction=use_secondary'),
    ),
  )
  const votes = await readJson(
    await listVotes(new NextRequest('http://local/api/consensus/agent-votes?decision=accepted')),
  )
  const reviews = await readJson(
    await listReviews(new NextRequest('http://local/api/consensus/adversarial-reviews?status=needs_revision')),
  )
  const audit = await readJson(await getAudit())

  assert(verification.recommendedAction === 'use_secondary', `Unexpected dual-model action: ${verification.recommendedAction}`)
  assert(verification.disagreementPoints.length >= 2, 'Expected dual-model disagreement points')
  assert(vote.decision === 'accepted' && vote.winningVote === 'approve', `Unexpected vote result: ${JSON.stringify(vote)}`)
  assert(review.status === 'needs_revision' && review.issues.length >= 4, `Unexpected review: ${JSON.stringify(review)}`)
  assert(verifications.verifications.some((row: { id: string }) => row.id === verification.id), 'Verification should be listable')
  assert(votes.votes.some((row: { id: string }) => row.id === vote.id), 'Vote should be listable')
  assert(reviews.reviews.some((row: { id: string }) => row.id === review.id), 'Review should be listable')
  assert(
    audit.summary.implementedBaselineSections === 210 &&
      audit.summary.partialSections === 0 &&
      audit.summary.pendingSections === 0,
    `Unexpected audit summary: ${JSON.stringify(audit.summary)}`,
  )
  assert(
    audit.sections[118]?.implementationStatus === 'baseline_plus',
    `Section 119 was not promoted: ${JSON.stringify(audit.sections[118])}`,
  )

  console.log(
    JSON.stringify(
      {
        verificationAction: verification.recommendedAction,
        disagreementCount: verification.disagreementPoints.length,
        voteDecision: vote.decision,
        reviewStatus: review.status,
        reviewIssueCount: review.issues.length,
        auditSummary: audit.summary,
        section119Status: audit.sections[118]?.implementationStatus,
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
