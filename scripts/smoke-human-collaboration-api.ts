import { NextRequest } from 'next/server'

import { GET as getAudit } from '../src/app/api/implementation-audit/route'
import {
  GET as listPolicies,
  POST as createPolicy,
} from '../src/app/api/human-collaboration/approval-policies/route'
import { POST as evaluatePolicy } from '../src/app/api/human-collaboration/approval-policies/[id]/evaluate/route'
import {
  GET as listPlanApprovals,
  POST as recordPlanApproval,
} from '../src/app/api/human-collaboration/plan-approvals/route'
import {
  GET as listTakeovers,
  POST as startTakeover,
} from '../src/app/api/human-collaboration/takeovers/route'
import { POST as recordTakeoverAction } from '../src/app/api/human-collaboration/takeovers/[id]/actions/route'
import { POST as completeTakeover } from '../src/app/api/human-collaboration/takeovers/[id]/complete/route'

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
  const policyResponse = await readJson(
    await createPolicy(
      new NextRequest('http://local/api/human-collaboration/approval-policies', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: 'Smoke human collaboration policy',
          config: {
            timeoutSeconds: 60,
            onTimeout: 'escalate_to_admin',
            batching: {
              enabled: true,
              maxBatchSize: 5,
              maxWaitSeconds: 30,
              mergeSimilar: true,
            },
            autoApproveConditions: [{
              condition: "changed_files < 3 AND risk_level == 'low'",
              maxAutoApprovalsPerRun: 2,
            }],
            escalationChain: [
              { level: 1, approver: 'user', escalateAfterSeconds: 0 },
              { level: 2, approver: 'project_owner', escalateAfterSeconds: 45 },
              { level: 3, approver: 'admin', escalateAfterSeconds: 60 },
            ],
          },
        }),
      }),
    ),
  )
  const autoApproved = await readJson(
    await evaluatePolicy(
      new NextRequest(`http://local/api/human-collaboration/approval-policies/${policyResponse.policy.id}/evaluate`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          facts: { changed_files: 2, risk_level: 'low' },
          elapsedSeconds: 10,
          autoApprovalsUsedInRun: 1,
          approvalType: 'file_write',
        }),
      }),
      { params: Promise.resolve({ id: policyResponse.policy.id }) },
    ),
  )
  const escalated = await readJson(
    await evaluatePolicy(
      new NextRequest(`http://local/api/human-collaboration/approval-policies/${policyResponse.policy.id}/evaluate`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          facts: { changed_files: 9, risk_level: 'high' },
          elapsedSeconds: 65,
          approvalType: 'desktop_operation',
        }),
      }),
      { params: Promise.resolve({ id: policyResponse.policy.id }) },
    ),
  )
  const planApproval = await readJson(
    await recordPlanApproval(
      new NextRequest('http://local/api/human-collaboration/plan-approvals', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          planId: 'smoke-plan',
          stepDecisions: [
            { stepId: 'step-1', decision: 'approved' },
            { stepId: 'step-2', decision: 'modified', modification: 'Use read-only mode.' },
            { stepId: 'step-3', decision: 'skipped', reason: 'No longer needed.' },
          ],
        }),
      }),
    ),
  )
  const takeover = await readJson(
    await startTakeover(
      new NextRequest('http://local/api/human-collaboration/takeovers', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          runId: 'smoke-run',
          stepId: 'fill-form',
          resource: 'browser',
          observation: { before: 'selector missing' },
        }),
      }),
    ),
  )
  const withAction = await readJson(
    await recordTakeoverAction(
      new NextRequest(`http://local/api/human-collaboration/takeovers/${takeover.session.id}/actions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          type: 'click',
          payload: { selector: '#submit' },
        }),
      }),
      { params: Promise.resolve({ id: takeover.session.id }) },
    ),
  )
  const completed = await readJson(
    await completeTakeover(
      new NextRequest(`http://local/api/human-collaboration/takeovers/${takeover.session.id}/complete`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          observation: { after: 'form submitted' },
        }),
      }),
      { params: Promise.resolve({ id: takeover.session.id }) },
    ),
  )
  const policies = await readJson(
    await listPolicies(new NextRequest('http://local/api/human-collaboration/approval-policies?status=active')),
  )
  const planApprovals = await readJson(
    await listPlanApprovals(new NextRequest('http://local/api/human-collaboration/plan-approvals?planId=smoke-plan')),
  )
  const takeovers = await readJson(
    await listTakeovers(new NextRequest('http://local/api/human-collaboration/takeovers?status=completed')),
  )
  const audit = await readJson(await getAudit())

  assert(policyResponse.policy.config.timeoutSeconds === 60, 'Expected approval timeout policy.')
  assert(autoApproved.evaluation.autoApproved === true, 'Expected low-risk auto approval.')
  assert(autoApproved.evaluation.recommendation === 'approve', 'Expected approve recommendation.')
  assert(escalated.evaluation.recommendation === 'escalate', 'Expected escalation recommendation.')
  assert(escalated.evaluation.escalationTarget.approver === 'admin', 'Expected admin escalation.')
  assert(planApproval.result.overallDecision === 'approved_with_changes', 'Expected partial plan approval.')
  assert(withAction.session.userActions.length === 1, 'Expected takeover action to be recorded.')
  assert(completed.session.status === 'completed', 'Expected takeover completion.')
  assert(policies.policies.some((row: { id: string }) => row.id === policyResponse.policy.id), 'Policy list missing row.')
  assert(
    planApprovals.results.some((row: { id: string }) => row.id === planApproval.result.id),
    'Plan approval list missing row.',
  )
  assert(
    takeovers.sessions.some((row: { id: string }) => row.id === takeover.session.id),
    'Takeover list missing row.',
  )
  assert(
    audit.summary.implementedBaselineSections === 210 &&
      audit.summary.partialSections === 0 &&
      audit.summary.pendingSections === 0,
    `Unexpected audit summary: ${JSON.stringify(audit.summary)}`,
  )
  assert(
    audit.sections[31]?.implementationStatus === 'baseline_plus',
    `Section 32 was not promoted: ${JSON.stringify(audit.sections[31])}`,
  )

  console.log(
    JSON.stringify(
      {
        policyId: policyResponse.policy.id,
        autoRecommendation: autoApproved.evaluation.recommendation,
        escalationTarget: escalated.evaluation.escalationTarget,
        planDecision: planApproval.result.overallDecision,
        takeoverStatus: completed.session.status,
        auditSummary: audit.summary,
        section32Status: audit.sections[31]?.implementationStatus,
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
