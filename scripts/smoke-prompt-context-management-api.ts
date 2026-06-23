import { NextRequest } from 'next/server'

import { GET as getAudit } from '../src/app/api/implementation-audit/route'
import {
  GET as listPolicies,
  POST as createPolicy,
} from '../src/app/api/context-compressors/policies/route'
import { POST as seedPolicies } from '../src/app/api/context-compressors/policies/seed/route'
import { POST as createPlan } from '../src/app/api/context-compressors/plan/route'
import { GET as listPlans } from '../src/app/api/context-compressors/plans/route'
import { POST as createPromptTemplate } from '../src/app/api/prompt-templates/route'
import { POST as renderPromptTemplate } from '../src/app/api/prompt-templates/[id]/render/route'

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
  const promptResponse = await readJson(
    await createPromptTemplate(
      new NextRequest('http://local/api/prompt-templates', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: 'Smoke section 31 prompt template',
          engine: 'handlebars',
          template: 'Serve {{customer}} with {{staticRule}}.',
          variables: {
            customer: { source: 'task_input', path: 'customer' },
            staticRule: { source: 'static', path: 'verified context packing' },
          },
          conditionalBlocks: [{
            condition: 'task.needsCompression == true',
            block: 'Compression is enabled for {{customer}}.',
          }],
          content: 'Smoke version content.',
          contextRules: ['Render before model calls.', 'Compress above 80 percent.'],
          abTest: {
            experimentId: 'smoke-section-31',
            variant: 'A',
            trafficPercent: 50,
            metrics: ['success_rate', 'step_efficiency'],
          },
        }),
      }),
    ),
  )
  const rendered = await readJson(
    await renderPromptTemplate(
      new NextRequest(`http://local/api/prompt-templates/${promptResponse.promptTemplate.id}/render`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          taskInput: { customer: 'SmokeCo', needsCompression: true },
        }),
      }),
      { params: Promise.resolve({ id: promptResponse.promptTemplate.id }) },
    ),
  )

  const seeded = await readJson(await seedPolicies())
  const policyResponse = await readJson(
    await createPolicy(
      new NextRequest('http://local/api/context-compressors/policies', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: 'Smoke context compressor',
          config: {
            triggerThreshold: 0.8,
            strategy: 'hierarchical',
            preserveAlways: ['current_goal', 'plan', 'user_instructions'],
            summarizerModel: 'cheap_local',
          },
          tokenBudgetConfig: {
            totalWindow: 128000,
            systemPromptMax: 3000,
            currentPlanMax: 2000,
            relevantMemoriesMax: 3000,
            recentStepSummariesMax: 5000,
            toolDefinitionsMax: 2000,
            safetyMargin: 2000,
            fullRecentStepsCount: 3,
          },
        }),
      }),
    ),
  )
  const planResponse = await readJson(
    await createPlan(
      new NextRequest('http://local/api/context-compressors/plan', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          policyId: policyResponse.policy.id,
          goal: 'Smoke long employee Agent run',
          input: { currentPlan: 'Keep critical context and compress older sections.' },
          tokenBudget: 128000,
          tokenEstimate: 110000,
          sections: [
            { id: 'system_prompt', title: 'System prompt and user instructions', kind: 'system_prompt', tokenEstimate: 3000 },
            { id: 'current_goal', title: 'Current goal', kind: 'goal', tokenEstimate: 1000 },
            { id: 'current_plan', title: 'Current plan', kind: 'plan', tokenEstimate: 2000 },
            { id: 'recent_step_summaries', title: 'Recent step summaries', kind: 'memory', tokenEstimate: 6000 },
            { id: 'tool_definitions', title: 'Tool definitions', kind: 'tool', tokenEstimate: 3000 },
          ],
        }),
      }),
    ),
  )
  const policies = await readJson(
    await listPolicies(new NextRequest('http://local/api/context-compressors/policies?status=active')),
  )
  const plans = await readJson(
    await listPlans(new NextRequest(`http://local/api/context-compressors/plans?policyId=${policyResponse.policy.id}`)),
  )
  const audit = await readJson(await getAudit())

  assert(rendered.render.rendered.includes('Serve SmokeCo'), 'Rendered template should include task input.')
  assert(
    rendered.render.rendered.includes('Compression is enabled for SmokeCo.'),
    'Conditional block should render.',
  )
  assert(rendered.render.abTest.variant === 'A', 'Prompt A/B metadata should survive rendering.')
  assert(seeded.policies.length >= 1, 'Expected seeded compressor policies.')
  assert(policyResponse.policy.config.strategy === 'hierarchical', 'Expected hierarchical compressor policy.')
  assert(planResponse.plan.status === 'compressed', 'Expected compression plan to compress.')
  assert(planResponse.plan.allocation.systemPrompt === 3000, 'Expected system prompt allocation.')
  assert(planResponse.plan.allocation.safetyMargin === 2000, 'Expected safety margin allocation.')
  assert(
    policies.policies.some((row: { id: string }) => row.id === policyResponse.policy.id),
    'Policy should be listable.',
  )
  assert(
    plans.plans.some((row: { id: string }) => row.id === planResponse.plan.id),
    'Plan should be listable.',
  )
  assert(
    audit.summary.implementedBaselineSections === 210 &&
      audit.summary.partialSections === 0 &&
      audit.summary.pendingSections === 0,
    `Unexpected audit summary: ${JSON.stringify(audit.summary)}`,
  )
  assert(
    audit.sections[30]?.implementationStatus === 'baseline_plus',
    `Section 31 was not promoted: ${JSON.stringify(audit.sections[30])}`,
  )

  console.log(
    JSON.stringify(
      {
        renderedTokens: rendered.render.tokenEstimate,
        seededPolicies: seeded.policies.length,
        planStatus: planResponse.plan.status,
        compressedSections: planResponse.plan.compressedSections.length,
        auditSummary: audit.summary,
        section31Status: audit.sections[30]?.implementationStatus,
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
