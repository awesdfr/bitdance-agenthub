import { NextRequest } from 'next/server'

import { POST as discoverWorkstationProviders } from '../src/app/api/production-integrations/workstations/providers/route'
import { GET as getAudit } from '../src/app/api/implementation-audit/route'

async function readJson(response: Response) {
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${await response.text()}`)
  }
  return response.json()
}

function postRequest(url: string, body: unknown): NextRequest {
  return new NextRequest(`http://local${url}`, {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  })
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

async function main() {
  const dryRunPayload = await readJson(
    await discoverWorkstationProviders(
      postRequest('/api/production-integrations/workstations/providers', { live: false }),
    ),
  )
  const livePayload = await readJson(
    await discoverWorkstationProviders(
      postRequest('/api/production-integrations/workstations/providers', { live: true }),
    ),
  )
  const audit = await readJson(await getAudit())

  const dryRunProviders = dryRunPayload.workstations.providers as Array<{
    key: string
    available: boolean
    evidence: string[]
    warnings: string[]
  }>
  const liveProviders = livePayload.workstations.providers as Array<{
    key: string
    available: boolean
    evidence: string[]
    warnings: string[]
  }>
  const expectedKeys = ['rdp', 'virtualbox', 'vmware', 'hyperv', 'docker', 'wsl', 'vnc']

  for (const key of expectedKeys) {
    assert(dryRunProviders.some((provider) => provider.key === key), `Missing dry-run provider: ${key}`)
    assert(liveProviders.some((provider) => provider.key === key), `Missing live provider: ${key}`)
  }

  const rdp = dryRunProviders.find((provider) => provider.key === 'rdp')
  const docker = liveProviders.find((provider) => provider.key === 'docker')
  const wsl = liveProviders.find((provider) => provider.key === 'wsl')

  assert(rdp?.evidence.some((line) => line.includes('mstsc.exe')), 'Expected RDP evidence to mention mstsc.exe.')
  assert(docker?.evidence.length, 'Expected Docker provider evidence.')
  assert(wsl?.evidence.length, 'Expected WSL provider evidence.')
  assert(
    livePayload.workstations.evidence.some((line: string) => line.includes('docker')) ||
      livePayload.workstations.evidence.some((line: string) => line.includes('wsl')) ||
      livePayload.workstations.evidence.some((line: string) => line.includes('mstsc.exe')),
    'Expected aggregated workstation evidence from real local probes.',
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
        dryRun: {
          status: dryRunPayload.workstations.status,
          providerCount: dryRunProviders.length,
          availableProviders: dryRunProviders.filter((provider) => provider.available).map((provider) => provider.key),
        },
        live: {
          status: livePayload.workstations.status,
          providerCount: liveProviders.length,
          availableProviders: liveProviders.filter((provider) => provider.available).map((provider) => provider.key),
          dockerEvidence: docker?.evidence,
          dockerWarnings: docker?.warnings,
          wslEvidence: wsl?.evidence,
          wslWarnings: wsl?.warnings,
        },
        auditSummary: audit.summary,
      },
      null,
      2,
    ),
  )
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
