import { NextRequest } from 'next/server'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

import { POST as discoverMobile } from '../src/app/api/production-integrations/mobile/devices/route'
import { POST as runtimeControl } from '../src/app/api/computer-sessions/[id]/runtime-control/route'
import { createAgentProfile } from '../src/server/control-plane-service'
import { getEmployeeRunSnapshot, startEmployeeRun } from '../src/server/employee-runtime-service'
import { ADB_ARGS_PREFIX_ENV, ADB_PATH_ENV } from '../src/server/runtime-control-service'

const ADB_PATH_MARKER = 'AGENTHUB_ADB_PATH'
const ADB_ARGS_PREFIX_MARKER = 'AGENTHUB_ADB_ARGS_PREFIX_JSON'

async function readJson(response: Response) {
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${await response.text()}`)
  }
  return response.json()
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function postRequest(routePath: string, body: unknown) {
  return new NextRequest(`http://local${routePath}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

async function main() {
  const previousAdbPath = process.env[ADB_PATH_ENV]
  const previousAdbArgsPrefix = process.env[ADB_ARGS_PREFIX_ENV]
  const previousLogPath = process.env.AGENTHUB_SMOKE_ADB_LOG
  const fixtureAdb = path.resolve(process.cwd(), 'scripts/fixtures/smoke-adb.mjs')
  const logPath = path.resolve(process.cwd(), 'output/smoke-runtime-adb.log')

  assert(existsSync(fixtureAdb), `Expected smoke adb fixture at ${fixtureAdb}`)
  assert(ADB_PATH_ENV === ADB_PATH_MARKER, `Expected adb path marker to match ${ADB_PATH_MARKER}.`)
  assert(
    ADB_ARGS_PREFIX_ENV === ADB_ARGS_PREFIX_MARKER,
    `Expected adb args prefix marker to match ${ADB_ARGS_PREFIX_MARKER}.`,
  )
  process.env[ADB_PATH_ENV] = process.execPath
  process.env[ADB_ARGS_PREFIX_ENV] = JSON.stringify([fixtureAdb])
  process.env.AGENTHUB_SMOKE_ADB_LOG = logPath

  try {
    const agent = await createAgentProfile({
      name: 'Smoke Runtime ADB Agent',
      role: 'runtime-adb-smoke',
      outputContract: { artifactType: 'report' },
      permissionPolicy: { mobile: { operate: true } },
      status: 'active',
    })
    const run = await startEmployeeRun({
      agentProfileId: agent.id,
      goal: 'Verify configured ADB runtime execution path.',
      autoComplete: true,
    })
    const snapshot = await getEmployeeRunSnapshot(run.id)
    const session = snapshot.computerSessions[0]
    assert(session, 'Expected employee runtime to create a computer session.')

    const mobileDiscoveryPayload = await readJson(
      await discoverMobile(postRequest('/api/production-integrations/mobile/devices', { live: true })),
    )
    const runtimePayload = await readJson(
      await runtimeControl(
        postRequest(`/api/computer-sessions/${session.id}/runtime-control`, {
          scope: 'mobile',
          actionType: 'list_devices',
          live: true,
        }),
        { params: Promise.resolve({ id: session.id }) },
      ),
    )

    const mobile = mobileDiscoveryPayload.mobile
    const runtimeResult = runtimePayload.result
    const log = existsSync(logPath) ? readFileSync(logPath, 'utf8') : ''

    assert(mobile.adb.available === true, `Expected configured adb to be available: ${JSON.stringify(mobile.adb)}`)
    assert(
      mobile.evidence.some((item: string) => item.includes(ADB_PATH_ENV) && item.includes('已配置')),
      `Expected mobile discovery evidence to mention configured ${ADB_PATH_ENV}: ${JSON.stringify(mobile.evidence)}`,
    )
    assert(
      mobile.evidence.some((item: string) => item.includes(ADB_ARGS_PREFIX_ENV) && item.includes('已配置')),
      `Expected mobile discovery evidence to mention configured ${ADB_ARGS_PREFIX_ENV}: ${JSON.stringify(mobile.evidence)}`,
    )
    assert(
      mobile.devices.some((device: { id: string; status: string }) =>
        device.id === 'smoke-device' && device.status === 'device',
      ),
      `Expected smoke adb device discovery: ${JSON.stringify(mobile.devices)}`,
    )
    assert(runtimeResult.status === 'complete', `Expected runtime-control list_devices to complete: ${JSON.stringify(runtimeResult)}`)
    assert(runtimeResult.liveExecuted === true, 'Expected runtime-control read-only live action to execute.')
    assert(runtimeResult.output?.adb?.configured === true, `Expected runtime output to mark configured adb: ${JSON.stringify(runtimeResult.output)}`)
    assert(
      runtimeResult.output?.adb?.argsPrefixConfigured === true,
      `Expected runtime output to mark configured adb wrapper args: ${JSON.stringify(runtimeResult.output)}`,
    )
    assert(
      runtimeResult.output?.devices?.some((device: { id: string; status: string }) =>
        device.id === 'smoke-device' && device.status === 'device',
      ),
      `Expected runtime output to include smoke adb device: ${JSON.stringify(runtimeResult.output)}`,
    )
    assert(log.includes('["version"]'), `Expected smoke adb version call in log: ${log}`)
    assert(log.includes('["devices","-l"]'), `Expected smoke adb devices call in log: ${log}`)

    console.log(JSON.stringify({
      agentId: agent.id,
      employeeRunId: run.id,
      computerSessionId: session.id,
      adbPathConfigured: mobile.adb.command === process.execPath,
      adbArgsPrefixConfigured: runtimeResult.output?.adb?.argsPrefixConfigured === true,
      discoveryDevices: mobile.devices.length,
      runtimeStatus: runtimeResult.status,
      runtimeLiveExecuted: runtimeResult.liveExecuted,
      logPath,
    }, null, 2))
  } finally {
    if (previousAdbPath === undefined) delete process.env[ADB_PATH_ENV]
    else process.env[ADB_PATH_ENV] = previousAdbPath
    if (previousAdbArgsPrefix === undefined) delete process.env[ADB_ARGS_PREFIX_ENV]
    else process.env[ADB_ARGS_PREFIX_ENV] = previousAdbArgsPrefix
    if (previousLogPath === undefined) delete process.env.AGENTHUB_SMOKE_ADB_LOG
    else process.env.AGENTHUB_SMOKE_ADB_LOG = previousLogPath
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
