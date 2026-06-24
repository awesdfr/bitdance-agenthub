import { existsSync } from 'node:fs'
import path from 'node:path'

import { eq } from 'drizzle-orm'

import { db, schema } from '../src/db/client'
import type { CliProfileRow, SoftwareCommandRow, SoftwareProfileRow } from '../src/db/schema'
import {
  createCliProfile,
  createSoftwareCommand,
  createSoftwareProfile,
  listAllSoftwareCommands,
  listCliProfiles,
  listSoftwareProfiles,
} from '../src/server/control-plane-service'

const DEFAULT_EXTERNAL_CLI_PATH =
  'C:\\Users\\九思\\AppData\\Local\\Programs\\Python\\Python312\\Scripts\\cli-anything-wechat.exe'
const DEFAULT_WECHAT_EXE = 'D:\\微信\\Weixin\\Weixin.exe'

interface CliBinding {
  command: string
  argsPrefix: string
  mode: 'external_cli_anything' | 'agenthub_builtin'
  externalCliPath: string
  builtinScriptPath: string
  commandReadableFromNode: boolean
}

function quote(value: string): string {
  return `"${value.replace(/"/g, '\\"')}"`
}

function resolveCliBinding(): CliBinding {
  const externalCliPath = process.env.WECHAT_CLI_PATH ?? DEFAULT_EXTERNAL_CLI_PATH
  const builtinScriptPath = path.resolve(process.cwd(), 'scripts', 'local-desktop-app-cli.mjs')
  if (safeExists(externalCliPath)) {
    return {
      command: externalCliPath,
      argsPrefix: '--json',
      mode: 'external_cli_anything',
      externalCliPath,
      builtinScriptPath,
      commandReadableFromNode: true,
    }
  }
  return {
    command: process.execPath,
    argsPrefix: `${quote(builtinScriptPath)} --app wechat --json`,
    mode: 'agenthub_builtin',
    externalCliPath,
    builtinScriptPath,
    commandReadableFromNode: safeExists(process.execPath) && safeExists(builtinScriptPath),
  }
}

function cliProfileMatchesBinding(profile: CliProfileRow, binding: CliBinding): boolean {
  if (profile.name === '微信桌面版 CLI') return true
  if (binding.mode === 'external_cli_anything') {
    return profile.command === binding.command && profile.argsTemplate === '--json {{command}}'
  }
  return (
    profile.command === binding.command &&
    profile.argsTemplate.includes('local-desktop-app-cli.mjs') &&
    profile.argsTemplate.includes('--app wechat')
  )
}

async function main() {
  const binding = resolveCliBinding()
  const executablePath = process.env.WECHAT_EXE_PATH ?? process.env.WECHAT_EXE ?? DEFAULT_WECHAT_EXE
  const executableReadableFromNode = safeExists(executablePath)

  const existingCli = (await listCliProfiles()).find((profile) =>
    cliProfileMatchesBinding(profile, binding),
  )
  const cliProfile =
    existingCli
      ? await updateCliProfile(existingCli.id, {
          command: binding.command,
          argsTemplate: `${binding.argsPrefix} {{command}}`,
          requiresApproval: true,
        })
      : await createCliProfile({
          name: '微信桌面版 CLI',
          command: binding.command,
          argsTemplate: `${binding.argsPrefix} {{command}}`,
          cwdPolicy: 'agent_workspace',
          timeoutMs: 60000,
          inputMode: 'args',
          outputMode: 'json',
          env: cliEnv(),
          requiresApproval: true,
        })

  const launchCommand = `${quote(binding.command)} ${binding.argsPrefix} launch`
  const existingSoftware = (await listSoftwareProfiles()).find(
    (profile) => profile.name === '微信桌面版' || profile.executablePath === executablePath,
  )
  const softwareProfile =
    existingSoftware
      ? await updateSoftwareProfile(existingSoftware.id, {
          launchCommand,
          executablePath,
        })
      : await createSoftwareProfile({
          name: '微信桌面版',
          appType: 'native_app',
          adapterType: 'cli',
          launchCommand,
          executablePath,
          defaultWorkstationMode: 'physical_desktop',
        })

  const existingCommands = await listAllSoftwareCommands()
  const safeStatusCommand = `${quote(binding.command)} ${binding.argsPrefix} status`
  const desiredCommands = [
    {
      name: '定位微信',
      description: 'Locate the real Windows WeChat executable.',
      commandTemplate: `${quote(binding.command)} ${binding.argsPrefix} locate`,
      riskLevel: 'low' as const,
      requiresApproval: false,
      outputSchema: { type: 'object', required: ['path', 'source'] },
    },
    {
      name: '查看微信状态',
      description: 'Inspect process and window status for the local WeChat client.',
      commandTemplate: `${quote(binding.command)} ${binding.argsPrefix} status`,
      riskLevel: 'low' as const,
      requiresApproval: false,
      outputSchema: { type: 'object', required: ['running', 'process_count', 'window_count'] },
    },
    {
      name: '聚焦微信窗口',
      description: 'Focus the active WeChat window without sending messages.',
      commandTemplate: `${quote(binding.command)} ${binding.argsPrefix} focus`,
      riskLevel: 'medium' as const,
      requiresApproval: false,
      outputSchema: { type: 'object' },
    },
    {
      name: '截图微信窗口',
      description: 'Capture the currently visible WeChat window to PNG.',
      commandTemplate: `${quote(binding.command)} ${binding.argsPrefix} screenshot -o "{{outputPath}}"`,
      testCommandTemplate: safeStatusCommand,
      riskLevel: 'high' as const,
      requiresApproval: true,
      inputSchema: {
        type: 'object',
        properties: {
          outputPath: { type: 'string' },
        },
        required: ['outputPath'],
      },
      outputSchema: { type: 'object', required: ['output'] },
    },
    {
      name: '读取微信可见文字',
      description: 'Read only currently visible WeChat UI text through Windows UI Automation.',
      commandTemplate: `${quote(binding.command)} ${binding.argsPrefix} visible-text --ack-privacy --max-items {{maxItems}}`,
      testCommandTemplate: safeStatusCommand,
      riskLevel: 'high' as const,
      requiresApproval: true,
      inputSchema: {
        type: 'object',
        properties: {
          maxItems: { type: 'number', default: 80 },
        },
      },
      outputSchema: { type: 'array' },
    },
    {
      name: '起草当前聊天消息',
      description: 'Draft one message in the currently active chat without sending it.',
      commandTemplate: `${quote(binding.command)} ${binding.argsPrefix} message draft-current --ack-current-chat --text "{{text}}"`,
      testCommandTemplate: safeStatusCommand,
      riskLevel: 'high' as const,
      requiresApproval: true,
      inputSchema: {
        type: 'object',
        properties: {
          text: { type: 'string' },
        },
        required: ['text'],
      },
      outputSchema: { type: 'object' },
    },
  ]

  const softwareCommands = []
  for (const desired of desiredCommands) {
    const existing = existingCommands.find(
      (command) => command.softwareProfileId === softwareProfile.id && command.name === desired.name,
    )
    if (existing) {
      softwareCommands.push(await updateSoftwareCommand(existing.id, desired))
      continue
    }
    softwareCommands.push(
      await createSoftwareCommand({
        softwareProfileId: softwareProfile.id,
        name: desired.name,
        description: desired.description,
        inputSchema: desired.inputSchema ?? {},
        outputSchema: desired.outputSchema,
        implementation: {
          type: 'cli',
          commandTemplate: desired.commandTemplate,
          testCommandTemplate: desired.testCommandTemplate,
        },
        riskLevel: desired.riskLevel,
        requiresApproval: desired.requiresApproval,
      }),
    )
  }

  console.log(
    JSON.stringify(
      {
        usingFallback: binding.mode === 'agenthub_builtin',
        binding,
        cliProfile: {
          id: cliProfile.id,
          name: cliProfile.name,
          command: cliProfile.command,
          argsTemplate: cliProfile.argsTemplate,
          pathReadableFromNode: binding.commandReadableFromNode,
        },
        softwareProfile: {
          id: softwareProfile.id,
          name: softwareProfile.name,
          executablePath: softwareProfile.executablePath,
          launchCommand: softwareProfile.launchCommand,
          executableReadableFromNode,
        },
        softwareCommands: softwareCommands.map((command) => ({
          id: command.id,
          name: command.name,
          riskLevel: command.riskLevel,
          requiresApproval: command.requiresApproval,
        })),
      },
      null,
      2,
    ),
  )
}

async function updateCliProfile(
  id: string,
  patch: Pick<CliProfileRow, 'command' | 'argsTemplate' | 'requiresApproval'>,
): Promise<CliProfileRow> {
  await db
    .update(schema.cliProfiles)
    .set({
      command: patch.command,
      argsTemplate: patch.argsTemplate,
      cwdPolicy: 'agent_workspace',
      timeoutMs: 60000,
      inputMode: 'args',
      outputMode: 'json',
      env: cliEnv(),
      requiresApproval: patch.requiresApproval,
      updatedAt: Date.now(),
    })
    .where(eq(schema.cliProfiles.id, id))
  return getCliProfile(id)
}

async function updateSoftwareProfile(
  id: string,
  patch: Pick<SoftwareProfileRow, 'launchCommand' | 'executablePath'>,
): Promise<SoftwareProfileRow> {
  await db
    .update(schema.softwareProfiles)
    .set({
      launchCommand: patch.launchCommand,
      executablePath: patch.executablePath,
      adapterType: 'cli',
      defaultWorkstationMode: 'physical_desktop',
      updatedAt: Date.now(),
    })
    .where(eq(schema.softwareProfiles.id, id))
  return getSoftwareProfile(id)
}

async function updateSoftwareCommand(
  id: string,
  desired: {
    name: string
    description: string
    commandTemplate: string
    testCommandTemplate?: string
    inputSchema?: Record<string, unknown>
    outputSchema: Record<string, unknown>
    riskLevel: SoftwareCommandRow['riskLevel']
    requiresApproval: boolean
  },
): Promise<SoftwareCommandRow> {
  await db
    .update(schema.softwareCommands)
    .set({
      description: desired.description,
      inputSchema: desired.inputSchema ?? {},
      outputSchema: desired.outputSchema,
      implementation: {
        type: 'cli',
        commandTemplate: desired.commandTemplate,
        testCommandTemplate: desired.testCommandTemplate,
      },
      riskLevel: desired.riskLevel,
      requiresApproval: desired.requiresApproval,
      updatedAt: Date.now(),
    })
    .where(eq(schema.softwareCommands.id, id))
  return getSoftwareCommand(id)
}

async function getCliProfile(id: string): Promise<CliProfileRow> {
  const row = await db.query.cliProfiles.findFirst({ where: eq(schema.cliProfiles.id, id) })
  if (!row) throw new Error(`CLI profile not found after update: ${id}`)
  return row
}

async function getSoftwareProfile(id: string): Promise<SoftwareProfileRow> {
  const row = await db.query.softwareProfiles.findFirst({ where: eq(schema.softwareProfiles.id, id) })
  if (!row) throw new Error(`Software profile not found after update: ${id}`)
  return row
}

async function getSoftwareCommand(id: string): Promise<SoftwareCommandRow> {
  const row = await db.query.softwareCommands.findFirst({ where: eq(schema.softwareCommands.id, id) })
  if (!row) throw new Error(`Software command not found after update: ${id}`)
  return row
}

function safeExists(value: string): boolean {
  try {
    return existsSync(value)
  } catch {
    return false
  }
}

function cliEnv(): Record<string, string> {
  return {
    PYTHONUTF8: '1',
    PYTHONIOENCODING: 'utf-8',
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
