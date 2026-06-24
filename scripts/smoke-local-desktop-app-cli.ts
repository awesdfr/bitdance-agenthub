import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, rmSync } from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const node = process.execPath
const tsx = path.join(root, 'node_modules', 'tsx', 'dist', 'cli.mjs')
const builtinCli = path.join(root, 'scripts', 'local-desktop-app-cli.mjs')
const dataRoot = path.join(root, 'tmp', `smoke-local-desktop-app-cli-${Date.now()}`)

type JsonRecord = Record<string, unknown>

interface LocateResult extends JsonRecord {
  ok: boolean
  app: string
  command: string
  found: boolean
}

interface DraftsResult extends JsonRecord {
  ok: boolean
  app: string
  draft_roots: unknown[]
}

interface RegisterResult extends JsonRecord {
  usingFallback: boolean
  binding: {
    command: string
    argsPrefix: string
  }
  cliProfile: {
    id: string
    name: string
    argsTemplate: string
  }
  softwareCommands: unknown[]
}

mkdirSync(dataRoot, { recursive: true })

try {
  const wechatLocate = runJson<LocateResult>(node, [
    builtinCli,
    '--app',
    'wechat',
    '--json',
    'locate',
  ])
  assert.equal(wechatLocate.ok, true)
  assert.equal(wechatLocate.app, 'wechat')
  assert.equal(wechatLocate.command, 'locate')
  assert.equal(typeof wechatLocate.found, 'boolean')

  const jianyingDrafts = runJson<DraftsResult>(node, [
    builtinCli,
    '--app',
    'jianying',
    '--json',
    'drafts',
  ])
  assert.equal(jianyingDrafts.ok, true)
  assert.equal(jianyingDrafts.app, 'jianying')
  assert(Array.isArray(jianyingDrafts.draft_roots))

  const isolatedEnv = {
    ...process.env,
    AGENTHUB_DATA_DIR: dataRoot,
    WECHAT_CLI_PATH: path.join(root, 'tmp', 'missing-cli-anything-wechat.exe'),
    JIANYING_CLI_PATH: path.join(root, 'tmp', 'missing-cli-anything-jianying.exe'),
  }

  const wechatRegister = runJson<RegisterResult>(
    node,
    [tsx, 'scripts/register-wechat-local-cli.ts'],
    isolatedEnv,
  )
  assert.equal(wechatRegister.usingFallback, true)
  assert.equal(wechatRegister.binding.command, node)
  assert(wechatRegister.binding.argsPrefix.includes('local-desktop-app-cli.mjs'))
  assert.equal(wechatRegister.softwareCommands.length, 6)

  const jianyingRegister = runJson<RegisterResult>(
    node,
    [tsx, 'scripts/register-jianying-local-cli.ts'],
    isolatedEnv,
  )
  assert.equal(jianyingRegister.usingFallback, true)
  assert.equal(jianyingRegister.binding.command, node)
  assert(jianyingRegister.binding.argsPrefix.includes('local-desktop-app-cli.mjs'))
  assert.equal(jianyingRegister.softwareCommands.length, 5)
  assert.notEqual(wechatRegister.cliProfile.id, jianyingRegister.cliProfile.id)
  assert(wechatRegister.cliProfile.argsTemplate.includes('--app wechat'))
  assert(jianyingRegister.cliProfile.argsTemplate.includes('--app jianying'))

  console.log(
    JSON.stringify(
      {
        ok: true,
        checks: {
          builtinWechatLocate: wechatLocate.found,
          builtinJianyingDraftRoots: jianyingDrafts.draft_roots.length,
          fallbackWechatCommands: wechatRegister.softwareCommands.length,
          fallbackJianyingCommands: jianyingRegister.softwareCommands.length,
        },
      },
      null,
      2,
    ),
  )
} finally {
  rmSync(dataRoot, { recursive: true, force: true })
}

function runJson<T extends JsonRecord = JsonRecord>(
  command: string,
  args: string[],
  env: NodeJS.ProcessEnv = process.env,
): T {
  const result = spawnSync(command, args, {
    cwd: root,
    env,
    encoding: 'utf8',
    windowsHide: true,
    timeout: 120000,
    maxBuffer: 4 * 1024 * 1024,
  })
  if (result.error) throw result.error
  if (result.status !== 0) {
    throw new Error(
      `Command failed (${result.status}): ${command} ${args.join(' ')}\n${result.stderr}\n${result.stdout}`,
    )
  }
  return JSON.parse(result.stdout) as T
}
