import path from 'node:path'

import { GET as getSkillsMapReport } from '../src/app/api/skills/skillsmap-report/route'
import { POST as searchSkillsMpCli } from '../src/app/api/skills/skillsmp-cli/route'
import { GET as getAudit } from '../src/app/api/implementation-audit/route'
import {
  installSkill,
  publishSkillToMarketplace,
  scaffoldSkillSdkProject,
} from '../src/server/skills-service'

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
  process.env.SKILLSMP_FIXTURE_PATH = path.resolve('scripts/fixtures/skillsmp-search.json')

  const { skill, installFlow } = await installSkill({
    source: 'skillsmp',
    url: 'https://skillsmp.com/skills/smoke-research',
    name: 'smoke-research',
    description: 'Smoke-test Skill for SkillsMap integration readiness.',
    manifest: {
      name: 'smoke-research',
      version: '0.1.0',
      capabilities: ['web_research'],
    },
  })
  const scaffold = await scaffoldSkillSdkProject({
    name: 'smoke-research-plus',
    version: '0.1.0',
    capabilities: ['web_research', 'source_summarization'],
    dependencies: {
      python_packages: [],
      node_packages: ['playwright'],
      system_tools: [],
    },
    permissions: ['network'],
  })
  const publication = await publishSkillToMarketplace({
    manifestId: scaffold.manifest.id,
    marketplaceUrl: 'https://skillsmp.com/publish',
  })

  const payload = await readJson(await getSkillsMapReport())
  const searchPayload = await readJson(
    await searchSkillsMpCli(
      new Request('http://localhost/api/skills/skillsmp-cli', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: 'research', limit: 5, sortBy: 'recent' }),
      }) as never,
    ),
  )
  const audit = await readJson(await getAudit())
  const report = payload.report
  const searchResult = searchPayload.result

  assert(report.readiness === 'ready', `Expected ready SkillsMap report, got ${report.readiness}`)
  assert(report.marketplace.isHttps === true, 'Expected HTTPS marketplace URL.')
  assert(report.marketplace.isSkillsMapLike === true, 'Expected SkillsMap-like marketplace host.')
  assert(report.marketplace.embedSurface === 'skillsmp_cli_api', 'Expected SkillsMP CLI/API surface.')
  assert(
    report.marketplace.expectedPanels.includes('skillsmp_cli_search'),
    'Expected SkillsMP CLI search panel.',
  )
  assert(searchResult.cli === 'skillsmp', 'Expected SkillsMP CLI result.')
  assert(searchResult.source === 'fixture', 'Expected fixture-backed SkillsMP search.')
  assert(searchResult.items[0]?.name === 'smoke-research-plus', 'Expected smoke SkillsMP search result.')
  assert(report.summary.installedSkills >= 1, 'Expected installed local Skills.')
  assert(report.summary.enabledSkills >= 1, 'Expected enabled local Skills.')
  assert(report.summary.skillsMapInstallFlows >= 1, 'Expected SkillsMap install-flow history.')
  assert(report.summary.validSdkManifests >= 1, 'Expected valid Skill SDK manifest.')
  assert(report.summary.marketplacePublications >= 1, 'Expected marketplace publication metadata.')
  assert(
    report.localSkills.some((row: { id: string }) => row.id === skill.id),
    'Expected smoke Skill in local Skills.',
  )
  assert(
    report.recentInstallFlows.some((row: { id: string }) => row.id === installFlow.id),
    'Expected smoke install flow in recent flows.',
  )
  assert(
    report.sdkManifests.some((row: { id: string }) => row.id === scaffold.manifest.id),
    'Expected smoke SDK manifest in report.',
  )
  assert(
    report.marketplacePublications.some((row: { id: string }) => row.id === publication.id),
    'Expected smoke marketplace publication in report.',
  )
  assert(
    audit.summary.implementedBaselineSections === 210 &&
      audit.summary.partialSections === 0 &&
      audit.summary.pendingSections === 0,
    `Unexpected audit summary: ${JSON.stringify(audit.summary)}`,
  )
  assert(
    audit.sections.find((section: { sectionNumber: number }) => section.sectionNumber === 16)
      ?.implementationStatus === 'baseline_plus',
    'Expected section 16 to be promoted.',
  )

  console.log(JSON.stringify({
    skillId: skill.id,
    installFlowId: installFlow.id,
    sdkManifestId: scaffold.manifest.id,
    marketplacePublicationId: publication.id,
    readiness: report.readiness,
    readinessScore: report.readinessScore,
    skillsMpSearchItems: searchResult.items.length,
    auditSummary: audit.summary,
  }, null, 2))
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
