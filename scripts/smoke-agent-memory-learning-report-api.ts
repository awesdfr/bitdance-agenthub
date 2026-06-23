import { NextRequest } from 'next/server'

import { GET as getMemoryLearningReport } from '../src/app/api/agent-profiles/[id]/memory-learning-report/route'
import { GET as getAudit } from '../src/app/api/implementation-audit/route'
import { createAgentProfile } from '../src/server/control-plane-service'
import { createMemoryItem, createRunReflection } from '../src/server/agent-memory-service'
import {
  approveLearningEvent,
  proposeLearningEventFromReflection,
} from '../src/server/learning-service'

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
  const agent = await createAgentProfile({
    name: 'Smoke Memory Learning Employee',
    role: 'Launch Strategist',
    memoryPolicy: { enabled: true, projectId: 'smoke_launch' },
    outputContract: { artifactType: 'document' },
    successCriteria: ['Launch document is complete.'],
    status: 'active',
  })
  await createMemoryItem({
    agentProfileId: agent.id,
    scope: 'agent',
    type: 'semantic',
    title: 'Customer prefers concise launch briefs',
    content: 'Launch briefs should be concise and evidence-backed.',
    confidence: 0.95,
    importance: 0.9,
    containsDataTypes: ['customer_data'],
  })
  await createMemoryItem({
    agentProfileId: agent.id,
    scope: 'agent',
    type: 'procedural',
    title: 'Launch brief procedure',
    content: 'Retrieve preference, draft concise sections, verify claims.',
    confidence: 0.88,
    importance: 0.82,
  })
  const reflection = await createRunReflection({
    runId: 'smoke_memory_learning_run',
    agentProfileId: agent.id,
    whatWorked: ['Used customer preference memory.'],
    reusableProcedure: ['Retrieve preference, draft concise launch brief, verify claims.'],
    futureWarnings: ['Check pricing caveats.'],
  })
  const proposal = await proposeLearningEventFromReflection({
    reflection,
    agent,
  })
  assert(proposal.learningEvent, 'Expected learning event proposal.')
  await approveLearningEvent(proposal.learningEvent.id, 'approved by smoke')

  const reportPayload = await readJson(
    await getMemoryLearningReport(
      new NextRequest(
        `http://local/api/agent-profiles/${agent.id}/memory-learning-report?q=concise%20launch%20brief`,
      ),
      { params: Promise.resolve({ id: agent.id }) },
    ),
  )
  const audit = await readJson(await getAudit())

  assert(reportPayload.report.readiness === 'ready', 'Expected ready memory report.')
  assert(reportPayload.report.memorySummary.ownedTotal === 2, 'Expected two owned memories.')
  assert(reportPayload.report.memorySummary.semanticCount === 1, 'Expected semantic memory count.')
  assert(reportPayload.report.memorySummary.proceduralCount === 1, 'Expected procedural memory count.')
  assert(reportPayload.report.retrieval.candidates.length > 0, 'Expected retrieval candidates.')
  assert(reportPayload.report.learningSummary.approved === 1, 'Expected approved learning event.')
  assert(reportPayload.report.learningSummary.activePlaybooks === 1, 'Expected active Playbook.')
  assert(
    audit.summary.implementedBaselineSections === 210 &&
      audit.summary.partialSections === 0 &&
      audit.summary.pendingSections === 0,
    `Unexpected audit summary: ${JSON.stringify(audit.summary)}`,
  )
  assert(
    audit.sections.find((section: { sectionNumber: number }) => section.sectionNumber === 5)
      ?.implementationStatus === 'baseline_plus',
    'Expected section 5 to be promoted.',
  )

  console.log(JSON.stringify({
    agentProfileId: agent.id,
    readiness: reportPayload.report.readiness,
    ownedMemories: reportPayload.report.memorySummary.ownedTotal,
    retrievalCandidates: reportPayload.report.retrieval.candidates.length,
    activePlaybooks: reportPayload.report.learningSummary.activePlaybooks,
    auditSummary: audit.summary,
  }, null, 2))
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
