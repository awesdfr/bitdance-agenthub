import { NextRequest } from 'next/server'
import { eq } from 'drizzle-orm'

import { GET as getNetworkEgressReport } from '../src/app/api/network-profiles/egress-report/route'
import { POST as testNetworkEgressLive } from '../src/app/api/network-profiles/[id]/egress-live-test/route'
import { GET as getNetworkProfileEgressReport } from '../src/app/api/network-profiles/[id]/egress-report/route'
import { GET as getAudit } from '../src/app/api/implementation-audit/route'
import {
  createAgentProfile,
  createCliProfile,
  createModelProfile,
  createNetworkProfile,
  testNetworkProfile,
} from '../src/server/control-plane-service'
import { db, schema } from '../src/db/client'

async function readJson(response: Response) {
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${await response.text()}`)
  }
  return response.json()
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function postRequest(path: string, body: unknown) {
  return new NextRequest(`http://local${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

async function main() {
  const previousFetch = globalThis.fetch
  const previousNetworkEgressGate = process.env.AGENTHUB_ENABLE_REAL_NETWORK_EGRESS_TEST
  let egressProbeRequests = 0
  globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
    const url = String(_input instanceof Request ? _input.url : _input)
    assert(url.includes('api.ipify.org'), `Expected egress probe URL, got ${url}`)
    assert(
      Boolean((init as RequestInit & { dispatcher?: unknown } | undefined)?.dispatcher),
      'Expected proxy network egress probe to include an undici dispatcher.',
    )
    egressProbeRequests += 1
    return new Response(JSON.stringify({ ip: '203.0.113.42' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  }) as typeof fetch
  delete process.env.AGENTHUB_ENABLE_REAL_NETWORK_EGRESS_TEST
  const network = await createNetworkProfile({
    name: 'Smoke US proxy outlet',
    mode: 'http_proxy',
    proxyUrl: 'http://127.0.0.1:8080',
    regionLabel: 'us-east',
    appliesTo: 'model_only',
  })
  await testNetworkProfile(network.id)
  const blockedLiveEgressPayload = await readJson(
    await testNetworkEgressLive(
      postRequest(`/api/network-profiles/${network.id}/egress-live-test`, {
        live: true,
        confirmExternalCall: true,
      }),
      { params: Promise.resolve({ id: network.id }) },
    ),
  )
  process.env.AGENTHUB_ENABLE_REAL_NETWORK_EGRESS_TEST = '1'
  const liveEgressPayload = await readJson(
    await testNetworkEgressLive(
      postRequest(`/api/network-profiles/${network.id}/egress-live-test`, {
        live: true,
        confirmExternalCall: true,
      }),
      { params: Promise.resolve({ id: network.id }) },
    ),
  )
  const model = await createModelProfile({
    name: 'Smoke routed model',
    provider: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    apiKeyRef: 'env:OPENAI_API_KEY',
    model: 'gpt-5',
    networkProfileId: network.id,
  })
  const agent = await createAgentProfile({
    name: 'Smoke Network Agent',
    role: 'Research operator',
    modelProfileId: model.id,
    workstationPolicy: { mode: 'browser_context', networkProfileId: network.id },
    permissionPolicy: { canUseBrowser: true, canUseNetwork: true },
    outputContract: { artifactType: 'report' },
    successCriteria: ['Report is complete.'],
    status: 'active',
  })
  const cli = await createCliProfile({
    name: 'Smoke Network CLI',
    command: 'node',
    argsTemplate: '--version',
    cwdPolicy: 'agent_workspace',
    env: { NETWORK_PROFILE_ID: network.id },
  })

  const reportPayload = await readJson(await getNetworkEgressReport())
  const profilePayload = await readJson(
    await getNetworkProfileEgressReport(
      new NextRequest(`http://local/api/network-profiles/${network.id}/egress-report`),
      { params: Promise.resolve({ id: network.id }) },
    ),
  )
  const audit = await readJson(await getAudit())
  const testedNetwork = await db.query.networkProfiles.findFirst({
    where: eq(schema.networkProfiles.id, network.id),
  })

  assert(reportPayload.report.routes.some(
    (route: { targetType: string; targetId: string; networkProfileId: string }) =>
      route.targetType === 'model' &&
      route.targetId === model.id &&
      route.networkProfileId === network.id,
  ), 'Expected model route through network profile.')
  assert(reportPayload.report.routes.some(
    (route: { targetType: string; targetId: string; networkProfileId: string }) =>
      route.targetType === 'agent_browser' &&
      route.targetId === agent.id &&
      route.networkProfileId === network.id,
  ), 'Expected Agent browser route through network profile.')
  assert(reportPayload.report.routes.some(
    (route: { targetType: string; targetId: string; networkProfileId: string }) =>
      route.targetType === 'cli' &&
      route.targetId === cli.id &&
      route.networkProfileId === network.id,
  ), 'Expected CLI route through network profile.')
  assert(profilePayload.report.networkProfiles.length === 1, 'Expected single-profile report.')
  assert(profilePayload.report.networkProfiles[0].id === network.id, 'Expected requested network profile.')
  assert(
    blockedLiveEgressPayload.result.status === 'failed' &&
      blockedLiveEgressPayload.result.message.includes('AGENTHUB_ENABLE_REAL_NETWORK_EGRESS_TEST'),
    `Expected live egress probe to be env-gated: ${JSON.stringify(blockedLiveEgressPayload.result)}`,
  )
  assert(
    liveEgressPayload.result.status === 'ok' &&
      liveEgressPayload.result.observedIp === '203.0.113.42' &&
      liveEgressPayload.result.proxyApplied === 'http_proxy' &&
      egressProbeRequests === 1,
    `Expected live egress probe to return observed proxy IP: ${JSON.stringify(liveEgressPayload.result)}`,
  )
  assert(
    testedNetwork?.lastTestResult?.includes('203.0.113.42'),
    'Expected live egress test to persist observed IP into Network Profile test result.',
  )
  assert(
    audit.summary.implementedBaselineSections === 210 &&
      audit.summary.partialSections === 0 &&
      audit.summary.pendingSections === 0,
    `Unexpected audit summary: ${JSON.stringify(audit.summary)}`,
  )
  assert(
    audit.sections.find((section: { sectionNumber: number }) => section.sectionNumber === 12)
      ?.implementationStatus === 'baseline_plus',
    'Expected section 12 to be promoted.',
  )

  console.log(JSON.stringify({
    networkProfileId: network.id,
    blockedLiveEgressStatus: blockedLiveEgressPayload.result.status,
    observedEgressIp: liveEgressPayload.result.observedIp,
    routeCount: reportPayload.report.routes.length,
    profileRouteCount: profilePayload.report.routes.length,
    auditSummary: audit.summary,
  }, null, 2))

  globalThis.fetch = previousFetch
  if (previousNetworkEgressGate === undefined) {
    delete process.env.AGENTHUB_ENABLE_REAL_NETWORK_EGRESS_TEST
  } else {
    process.env.AGENTHUB_ENABLE_REAL_NETWORK_EGRESS_TEST = previousNetworkEgressGate
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
