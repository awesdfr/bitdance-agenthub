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
  'C:\\Users\\九思\\AppData\\Local\\Programs\\Python\\Python312\\Scripts\\cli-anything-jianying.exe'
const DEFAULT_JIANYING_EXE = 'D:\\JianyingPro\\JianyingPro.exe'

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
  const externalCliPath = process.env.JIANYING_CLI_PATH ?? DEFAULT_EXTERNAL_CLI_PATH
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
    argsPrefix: `${quote(builtinScriptPath)} --app jianying --json`,
    mode: 'agenthub_builtin',
    externalCliPath,
    builtinScriptPath,
    commandReadableFromNode: safeExists(process.execPath) && safeExists(builtinScriptPath),
  }
}

function cliProfileMatchesBinding(profile: CliProfileRow, binding: CliBinding): boolean {
  if (profile.name === '剪映专业版 CLI') return true
  if (binding.mode === 'external_cli_anything') {
    return profile.command === binding.command && profile.argsTemplate === '--json {{command}}'
  }
  return (
    profile.command === binding.command &&
    profile.argsTemplate.includes('local-desktop-app-cli.mjs') &&
    profile.argsTemplate.includes('--app jianying')
  )
}

async function main() {
  const binding = resolveCliBinding()
  const executablePath = process.env.JIANYING_EXE_PATH ?? process.env.JIANYING_EXE ?? DEFAULT_JIANYING_EXE
  const executablePathReadableFromNode = safeExists(executablePath)

  const existingCli = (await listCliProfiles()).find((profile) =>
    cliProfileMatchesBinding(profile, binding),
  )
  const cliProfile =
    existingCli
      ? await updateCliProfile(existingCli.id, {
          command: binding.command,
          argsTemplate: `${binding.argsPrefix} {{command}}`,
          requiresApproval: false,
        })
      : await createCliProfile({
          name: '剪映专业版 CLI',
          command: binding.command,
          argsTemplate: `${binding.argsPrefix} {{command}}`,
          cwdPolicy: 'agent_workspace',
          timeoutMs: 60000,
          inputMode: 'args',
          outputMode: 'json',
          env: cliEnv(),
          requiresApproval: false,
        })

  const launchCommand = `${quote(binding.command)} ${binding.argsPrefix} launch`
  const existingSoftware = (await listSoftwareProfiles()).find(
    (profile) => profile.name === '剪映专业版' || profile.executablePath === executablePath,
  )
  const softwareProfile =
    existingSoftware
      ? await updateSoftwareProfile(existingSoftware.id, {
          launchCommand,
          executablePath,
        })
      : await createSoftwareProfile({
          name: '剪映专业版',
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
      name: '定位剪映',
      description: 'Locate the real Jianying Pro executable.',
      commandTemplate: `${quote(binding.command)} ${binding.argsPrefix} locate`,
      outputSchema: { type: 'object', required: ['path', 'source'] },
    },
    {
      name: '查看剪映状态',
      description: 'Inspect process, windows, and draft roots.',
      commandTemplate: `${quote(binding.command)} ${binding.argsPrefix} status`,
      outputSchema: { type: 'object', required: ['running', 'process_count', 'window_count', 'draft_roots'] },
    },
    {
      name: '启动剪映',
      description: 'Launch Jianying Pro or reuse the running process.',
      commandTemplate: `${quote(binding.command)} ${binding.argsPrefix} launch`,
      outputSchema: { type: 'object', required: ['executable'] },
    },
    {
      name: '截图剪映主窗口',
      description: 'Capture the visible Jianying Pro main window to PNG.',
      commandTemplate: `${quote(binding.command)} ${binding.argsPrefix} screenshot -o "{{outputPath}}"`,
      testCommandTemplate: safeStatusCommand,
      inputSchema: {
        type: 'object',
        properties: {
          outputPath: { type: 'string' },
        },
        required: ['outputPath'],
      },
      outputSchema: { type: 'object', required: ['output', 'width', 'height', 'file_size'] },
    },
    {
      name: '列出剪映草稿目录',
      description: 'List known local Jianying draft root folders.',
      commandTemplate: `${quote(binding.command)} ${binding.argsPrefix} drafts`,
      outputSchema: { type: 'array' },
    },
  ]

  const softwareCommands = []
  for (const desired of desiredCommands) {
    const existing = existingCommands.find(
      (command) => command.softwareProfileId === softwareProfile.id && command.name === desired.name,
    )
    const riskLevel = desired.name.includes('启动') || desired.name.includes('截图') ? 'medium' as const : 'low' as const
    if (existing) {
      softwareCommands.push(await updateSoftwareCommand(existing.id, { ...desired, riskLevel }))
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
        riskLevel,
        requiresApproval: false,
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
          executableReadableFromNode: executablePathReadableFromNode,
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
      requiresApproval: false,
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
