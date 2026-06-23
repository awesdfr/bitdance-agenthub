import { NextRequest } from 'next/server'

import { GET as getCapabilityReport } from '../src/app/api/agent-profiles/[id]/capability-report/route'
import { GET as getAudit } from '../src/app/api/implementation-audit/route'
import {
  createAgentProfile,
  createCliProfile,
  createMcpServer,
  createModelProfile,
  createSoftwareCommand,
  createSoftwareProfile,
} from '../src/server/control-plane-service'
import { installSkill } from '../src/server/skills-service'

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
  const model = await createModelProfile({
    name: 'Smoke Agent Factory Model',
    provider: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    apiKeyRef: 'env:OPENAI_API_KEY',
    model: 'gpt-5',
    contextWindow: 128000,
    supportsToolCalling: true,
    supportsJsonMode: true,
  })
  const { skill } = await installSkill({
    source: 'local',
    url: 'file:///skills/smoke-agent-factory',
    name: 'Smoke Agent Factory Skill',
    description: 'Smoke skill for Agent capability report.',
    manifest: { capabilities: ['smoke_capability_report'] },
  })
  const mcp = await createMcpServer({
    displayName: 'Smoke MCP',
    transport: 'stdio',
    command: 'node',
    args: ['server.js'],
  })
  const cli = await createCliProfile({
    name: 'Smoke CLI',
    command: 'node',
    argsTemplate: '--version',
    cwdPolicy: 'agent_workspace',
    requiresApproval: true,
  })
  const software = await createSoftwareProfile({
    name: 'Smoke Software',
    appType: 'cli_app',
    adapterType: 'cli',
    defaultWorkstationMode: 'browser_context',
  })
  const command = await createSoftwareCommand({
    softwareProfileId: software.id,
    name: 'Smoke command',
    implementation: { type: 'cli', commandTemplate: 'echo smoke' },
    riskLevel: 'low',
    requiresApproval: true,
  })
  const agent = await createAgentProfile({
    name: 'Smoke Agent Factory Employee',
    role: 'Verification Employee',
    description: 'Checks Agent Profile capability report wiring.',
    modelProfileId: model.id,
    skillIds: [skill.id],
    mcpServerIds: [mcp.id],
    cliProfileIds: [cli.id],
    softwareProfileIds: [software.id],
    memoryPolicy: { scope: 'project' },
    autonomyPolicy: { level: 'execute_low_risk' },
    workstationPolicy: { mode: 'browser_context' },
    permissionPolicy: {
      canReadFiles: true,
      canWriteFiles: true,
      canRunCommands: true,
      canUseNetwork: true,
    },
    inputContract: { goal: { type: 'string' } },
    outputContract: {
      artifactType: 'report',
      requiredFiles: ['summary.md'],
      validationRules: ['has evidence'],
    },
    systemPrompt: 'You are a smoke-test employee.',
    behaviorRules: ['Report evidence clearly.'],
    successCriteria: ['Capability report is complete.'],
    status: 'active',
  })

  const reportResponse = await readJson(
    await getCapabilityReport(
      new NextRequest(`http://local/api/agent-profiles/${agent.id}/capability-report`),
      { params: Promise.resolve({ id: agent.id }) },
    ),
  )
  const audit = await readJson(await getAudit())

  assert(reportResponse.report.readiness === 'ready', 'Expected ready capability report.')
  assert(reportResponse.report.primaryModel.id === model.id, 'Expected primary model in report.')
  assert(reportResponse.report.skills.some((row: { id: string }) => row.id === skill.id), 'Skill missing from report.')
  assert(reportResponse.report.mcpServers.some((row: { id: string }) => row.id === mcp.id), 'MCP missing from report.')
  assert(reportResponse.report.cliProfiles.some((row: { id: string }) => row.id === cli.id), 'CLI missing from report.')
  assert(
    reportResponse.report.softwareCommands.some((row: { id: string }) => row.id === command.id),
    'Software command missing from report.',
  )
  assert(reportResponse.report.permissionMatrix.canRunCommands === true, 'Expected command permission.')
  assert(reportResponse.report.contractSummary.artifactType === 'report', 'Expected output contract summary.')
  assert(reportResponse.report.gaps.length === 0, `Unexpected gaps: ${reportResponse.report.gaps.join('; ')}`)
  assert(
    audit.summary.implementedBaselineSections === 210 &&
      audit.summary.partialSections === 0 &&
      audit.summary.pendingSections === 0,
    `Unexpected audit summary: ${JSON.stringify(audit.summary)}`,
  )
  assert(
    audit.sections.find((section: { sectionNumber: number }) => section.sectionNumber === 1)
      ?.implementationStatus === 'baseline_plus',
    'Expected section 1 to be promoted.',
  )

  console.log(JSON.stringify({
    agentProfileId: agent.id,
    readiness: reportResponse.report.readiness,
    readinessScore: reportResponse.report.readinessScore,
    capabilityKinds: {
      skills: reportResponse.report.skills.length,
      mcpServers: reportResponse.report.mcpServers.length,
      cliProfiles: reportResponse.report.cliProfiles.length,
      softwareCommands: reportResponse.report.softwareCommands.length,
    },
    auditSummary: audit.summary,
    section1Status: audit.sections.find((section: { sectionNumber: number }) => section.sectionNumber === 1)
      ?.implementationStatus,
  }, null, 2))
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
