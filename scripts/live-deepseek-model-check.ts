import { eq } from 'drizzle-orm'

import { db, schema } from '../src/db/client'
import { createModelProfile } from '../src/server/control-plane-service'
import {
  runModelCapabilityProbe,
  testModelConnection,
} from '../src/server/model-gateway-service'

async function main() {
  const apiKeyPresent = Boolean(process.env.DEEPSEEK_API_KEY?.trim())
  const previousConnectionGate = process.env.AGENTHUB_ENABLE_REAL_MODEL_CONNECTION
  const previousEndpointAllowlist = process.env.AGENTHUB_ALLOWED_MODEL_ENDPOINT_HOSTS

  process.env.AGENTHUB_ENABLE_REAL_MODEL_CONNECTION = '1'
  process.env.AGENTHUB_ALLOWED_MODEL_ENDPOINT_HOSTS = 'api.deepseek.com'

  try {
    let profile = await db.query.modelProfiles.findFirst({
      where: eq(schema.modelProfiles.name, 'DeepSeek OpenAI Live'),
    })
    if (!profile) {
      profile = await createModelProfile({
        name: 'DeepSeek OpenAI Live',
        provider: 'deepseek',
        baseUrl: 'https://api.deepseek.com',
        apiKeyRef: 'env:DEEPSEEK_API_KEY',
        model: 'deepseek-chat',
        supportsToolCalling: true,
        supportsJsonMode: true,
        supportsVision: false,
      })
    }

    const connection = await testModelConnection({
      modelProfileId: profile.id,
      live: true,
      confirmExternalCall: true,
    })
    const jsonProbe = await runModelCapabilityProbe({
      modelProfileId: profile.id,
      kind: 'json',
      live: true,
      confirmExternalCall: true,
      stream: false,
      prompt: 'Return {"ok":true,"provider":"deepseek"} as compact JSON.',
    })

    console.log(JSON.stringify({
      modelProfileId: profile.id,
      provider: profile.provider,
      baseUrl: profile.baseUrl,
      model: profile.model,
      apiKeyPresent,
      connectionStatus: connection.status,
      connectionMessage: connection.message,
      connectionLatencyMs: connection.latencyMs,
      jsonProbeStatus: jsonProbe.status,
      jsonProbeMessage: jsonProbe.message,
      jsonProbeLatencyMs: jsonProbe.latencyMs,
      keyRedacted: true,
    }, null, 2))
  } finally {
    if (previousConnectionGate === undefined) delete process.env.AGENTHUB_ENABLE_REAL_MODEL_CONNECTION
    else process.env.AGENTHUB_ENABLE_REAL_MODEL_CONNECTION = previousConnectionGate
    if (previousEndpointAllowlist === undefined) delete process.env.AGENTHUB_ALLOWED_MODEL_ENDPOINT_HOSTS
    else process.env.AGENTHUB_ALLOWED_MODEL_ENDPOINT_HOSTS = previousEndpointAllowlist
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
