import { NextRequest } from 'next/server'

import { POST as probeModelCapability } from '../src/app/api/model-profiles/[id]/capability-probe/route'
import { createModelProfile } from '../src/server/control-plane-service'

async function readJson<T>(response: Response): Promise<T> {
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${await response.text()}`)
  return response.json() as Promise<T>
}

function postJson(path: string, body: unknown): NextRequest {
  return new NextRequest(
    new Request(`http://localhost${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  )
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

async function main() {
  const openAiCompatible = await createModelProfile({
    name: 'Smoke streaming tool model',
    provider: 'openai-compatible',
    baseUrl: 'https://example.invalid/v1',
    apiKeyRef: 'env:SMOKE_MODEL_KEY',
    model: 'smoke-tool-model',
    supportsToolCalling: true,
    supportsJsonMode: true,
    supportsVision: true,
  })
  const google = await createModelProfile({
    name: 'Smoke streaming vision Gemini',
    provider: 'google',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    apiKeyRef: 'env:SMOKE_MODEL_KEY',
    model: 'gemini-2.5-pro',
    supportsToolCalling: true,
    supportsJsonMode: true,
    supportsVision: true,
  })

  const toolProbe = await readJson<{
    modelConnectionTest: {
      status: string
      mode: string
      capabilityChecks: Record<string, unknown>
    }
  }>(
    await probeModelCapability(
      postJson(`/api/model-profiles/${openAiCompatible.id}/capability-probe`, {
        kind: 'tool_calling',
        stream: true,
        live: false,
      }),
      { params: Promise.resolve({ id: openAiCompatible.id }) },
    ),
  )

  assert(toolProbe.modelConnectionTest.status === 'ok', 'Expected streaming tool probe dry-run to be ok.')
  assert(toolProbe.modelConnectionTest.mode === 'dry_run', 'Expected streaming tool probe to remain non-live.')
  assert(
    toolProbe.modelConnectionTest.capabilityChecks.requestFamily === 'openai_chat_completions',
    `Expected OpenAI-compatible request family: ${JSON.stringify(toolProbe.modelConnectionTest.capabilityChecks)}`,
  )
  assert(
    toolProbe.modelConnectionTest.capabilityChecks.streamRequested === true &&
      toolProbe.modelConnectionTest.capabilityChecks.streamProtocol === 'sse' &&
      toolProbe.modelConnectionTest.capabilityChecks.streamHandshakePlanned === true,
    `Expected SSE streaming handshake metadata: ${JSON.stringify(toolProbe.modelConnectionTest.capabilityChecks)}`,
  )
  assert(
    toolProbe.modelConnectionTest.capabilityChecks.toolCallingHandshakePlanned === true,
    `Expected tool-calling handshake metadata: ${JSON.stringify(toolProbe.modelConnectionTest.capabilityChecks)}`,
  )

  const visionProbe = await readJson<{
    modelConnectionTest: {
      status: string
      mode: string
      capabilityChecks: Record<string, unknown>
    }
  }>(
    await probeModelCapability(
      postJson(`/api/model-profiles/${google.id}/capability-probe`, {
        kind: 'vision',
        stream: true,
        live: false,
        visionImageDataUrl: 'data:image/png;base64,iVBORw0KGgo=',
      }),
      { params: Promise.resolve({ id: google.id }) },
    ),
  )

  assert(visionProbe.modelConnectionTest.status === 'ok', 'Expected streaming vision probe dry-run to be ok.')
  assert(visionProbe.modelConnectionTest.mode === 'dry_run', 'Expected streaming vision probe to remain non-live.')
  assert(
    visionProbe.modelConnectionTest.capabilityChecks.requestFamily === 'google_generate_content',
    `Expected Gemini request family: ${JSON.stringify(visionProbe.modelConnectionTest.capabilityChecks)}`,
  )
  assert(
    String(visionProbe.modelConnectionTest.capabilityChecks.endpoint).includes(':streamGenerateContent?alt=sse'),
    `Expected Gemini streaming endpoint: ${JSON.stringify(visionProbe.modelConnectionTest.capabilityChecks)}`,
  )
  assert(
    visionProbe.modelConnectionTest.capabilityChecks.streamRequested === true &&
      visionProbe.modelConnectionTest.capabilityChecks.streamProtocol === 'sse' &&
      visionProbe.modelConnectionTest.capabilityChecks.streamHandshakePlanned === true,
    `Expected Gemini SSE handshake metadata: ${JSON.stringify(visionProbe.modelConnectionTest.capabilityChecks)}`,
  )
  assert(
    visionProbe.modelConnectionTest.capabilityChecks.hasVisionImage === true &&
      visionProbe.modelConnectionTest.capabilityChecks.visionHandshakePlanned === true,
    `Expected vision handshake metadata: ${JSON.stringify(visionProbe.modelConnectionTest.capabilityChecks)}`,
  )

  console.log(
    JSON.stringify(
      {
        openAiCompatibleModelId: openAiCompatible.id,
        googleModelId: google.id,
        toolStreamProtocol: toolProbe.modelConnectionTest.capabilityChecks.streamProtocol,
        visionStreamProtocol: visionProbe.modelConnectionTest.capabilityChecks.streamProtocol,
      },
      null,
      2,
    ),
  )
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
