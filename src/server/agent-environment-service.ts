import { mkdirSync } from 'node:fs'
import path from 'node:path'
import posixPath from 'node:path/posix'

import { eq } from 'drizzle-orm'

import { db, schema } from '@/db/client'
import type {
  AgentEnvironment,
  AgentEnvironmentMount,
  AgentEnvironmentMountMode,
  AgentProfileRow,
  JsonObject,
} from '@/db/schema'

const DEFAULT_ENV_WHITELIST = ['PATH', 'HOME', 'LANG', 'LC_ALL', 'TZ']

export async function buildAgentEnvironment(args: {
  agentProfileId: string
  employeeRunId?: string | null
}): Promise<AgentEnvironment> {
  const agent = await db.query.agentProfiles.findFirst({
    where: eq(schema.agentProfiles.id, args.agentProfileId),
  })
  if (!agent) throw new Error(`Agent profile not found: ${args.agentProfileId}`)

  const policy = readEnvironmentPolicy(agent)
  const paths = await resolveAgentEnvironmentPaths(agent, args.employeeRunId ?? null)
  const modelProfile = agent.modelProfileId
    ? await db.query.modelProfiles.findFirst({
        where: eq(schema.modelProfiles.id, agent.modelProfileId),
      })
    : null
  const networkProfile = modelProfile?.networkProfileId
    ? await db.query.networkProfiles.findFirst({
        where: eq(schema.networkProfiles.id, modelProfile.networkProfileId),
      })
    : null

  mkdirSync(paths.home, { recursive: true })
  mkdirSync(paths.workspace, { recursive: true })
  mkdirSync(paths.temp, { recursive: true })

  const envWhitelist = uniqueStrings([
    ...DEFAULT_ENV_WHITELIST,
    ...readStringArray(policy.env, 'whitelist'),
  ])
  const visibleEnv = buildVisibleEnvironment(envWhitelist, paths)
  const customEnv = {
    AGENTHUB_AGENT_ID: agent.id,
    ...(args.employeeRunId ? { AGENTHUB_RUN_ID: args.employeeRunId } : {}),
    AGENTHUB_WORKSPACE: paths.workspace,
    AGENTHUB_TEMP: paths.temp,
    ...readStringMap(policy.env, 'custom'),
  }
  const secrets = {
    ...readStringMap(policy.env, 'secrets'),
    ...(modelProfile?.apiKeyRef ? { AGENT_MODEL_API_KEY: modelProfile.apiKeyRef } : {}),
  }
  const networkPolicy = readObject(policy.network)
  const proxy = readString(networkPolicy, 'proxy') ?? networkProfile?.proxyUrl ?? undefined
  const dns = readString(networkPolicy, 'dns') ?? undefined
  const allowedDomains = uniqueStrings([
    ...readStringArray(networkPolicy, 'allowedDomains'),
    ...readStringArray(readObject(agent.permissionPolicy.network), 'allowedDomains'),
  ])

  return {
    fs: {
      home: paths.home,
      workspace: paths.workspace,
      mounts: normalizeMounts(policy.fs),
      userHomeVisible: false,
    },
    env: {
      whitelist: envWhitelist,
      visible: visibleEnv,
      custom: customEnv,
      secrets,
      redactedSecretNames: Object.keys(secrets).sort(),
    },
    network: {
      ...(proxy ? { proxy } : {}),
      ...(dns ? { dns } : {}),
      allowedDomains,
    },
    isolation: {
      globalEnvVisible: false,
      userHomeVisible: false,
      secretValuesExposed: false,
    },
  }
}

function readEnvironmentPolicy(agent: AgentProfileRow): {
  fs: JsonObject
  env: JsonObject
  network: JsonObject
} {
  const root = readObject(agent.workstationPolicy.environment)
  return {
    fs: readObject(root.fs ?? agent.workstationPolicy.fs),
    env: readObject(root.env ?? agent.workstationPolicy.env),
    network: readObject(root.network ?? agent.workstationPolicy.network),
  }
}

async function resolveAgentEnvironmentPaths(
  agent: AgentProfileRow,
  employeeRunId: string | null,
): Promise<{ home: string; workspace: string; temp: string }> {
  const dataDir = process.env.AGENTHUB_DATA_DIR ?? path.resolve(process.cwd(), '.agenthub-data')
  const safeAgentId = safeSegment(agent.id)
  const home = path.join(dataDir, 'agent-environments', safeAgentId, 'home')
  if (employeeRunId) {
    const session = await db.query.computerSessions.findFirst({
      where: eq(schema.computerSessions.employeeRunId, employeeRunId),
    })
    if (session) {
      return {
        home,
        workspace: session.workspacePath,
        temp: session.tempPath,
      }
    }
    return {
      home,
      workspace: path.join(dataDir, 'agent-environments', safeAgentId, 'runs', safeSegment(employeeRunId), 'workspace'),
      temp: path.join(dataDir, 'agent-environments', safeAgentId, 'runs', safeSegment(employeeRunId), 'tmp'),
    }
  }
  return {
    home,
    workspace: path.join(dataDir, 'agent-environments', safeAgentId, 'preview', 'workspace'),
    temp: path.join(dataDir, 'agent-environments', safeAgentId, 'preview', 'tmp'),
  }
}

function buildVisibleEnvironment(
  whitelist: string[],
  paths: { home: string; workspace: string; temp: string },
): Record<string, string> {
  const visible: Record<string, string> = {}
  for (const key of whitelist) {
    if (key === 'HOME' || key === 'USERPROFILE') {
      visible[key] = paths.home
      continue
    }
    if (key === 'PWD' || key === 'AGENTHUB_WORKSPACE') {
      visible[key] = paths.workspace
      continue
    }
    if (key === 'TMP' || key === 'TEMP' || key === 'AGENTHUB_TEMP') {
      visible[key] = paths.temp
      continue
    }
    const value = process.env[key]
    if (value !== undefined) visible[key] = value
  }
  return visible
}

function normalizeMounts(fsPolicy: JsonObject): AgentEnvironmentMount[] {
  const rawMounts = Array.isArray(fsPolicy.mounts) ? fsPolicy.mounts : []
  return rawMounts.filter(isPlainObject).flatMap((mount) => {
    const agentPath = normalizeAgentPath(readString(mount, 'agentPath') ?? readString(mount, 'path'))
    const realPath = readString(mount, 'realPath')
    if (!agentPath || !realPath) return []
    return [{
      agentPath,
      realPath: path.resolve(realPath),
      mode: readMountMode(mount.mode),
    }]
  })
}

function normalizeAgentPath(value: string | null): string | null {
  if (!value) return null
  const normalized = posixPath.normalize(value.startsWith('/') ? value : `/${value}`)
  if (normalized.includes('..')) return null
  return normalized
}

function readMountMode(value: unknown): AgentEnvironmentMountMode {
  return value === 'rw' ? 'rw' : 'ro'
}

function readObject(value: unknown): JsonObject {
  return isPlainObject(value) ? value : {}
}

function readString(obj: JsonObject, key: string): string | null {
  const value = obj[key]
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function readStringArray(obj: JsonObject, key: string): string[] {
  const value = obj[key]
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    : []
}

function readStringMap(obj: JsonObject, key: string): Record<string, string> {
  const value = obj[key]
  if (!isPlainObject(value)) return {}
  return Object.fromEntries(
    Object.entries(value)
      .filter((entry): entry is [string, string] => typeof entry[1] === 'string')
      .map(([name, val]) => [name.trim(), val.trim()])
      .filter(([name, val]) => Boolean(name && val)),
  )
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))].sort()
}

function safeSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, '_')
}

function isPlainObject(value: unknown): value is JsonObject {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}
