import { existsSync } from 'node:fs'

import {
  createCliProfile,
  createSoftwareCommand,
  createSoftwareProfile,
  listAllSoftwareCommands,
  listCliProfiles,
  listSoftwareProfiles,
} from '../src/server/control-plane-service'

const DEFAULT_CLI_PATH =
  'C:\\Users\\九思\\AppData\\Local\\Programs\\Python\\Python312\\Scripts\\cli-anything-jianying.exe'
const DEFAULT_JIANYING_EXE = 'D:\\JianyingPro\\JianyingPro.exe'

function quote(value: string): string {
  return `"${value.replace(/"/g, '\\"')}"`
}

async function main() {
  const cliPath = process.env.JIANYING_CLI_PATH ?? DEFAULT_CLI_PATH
  const executablePath = process.env.JIANYING_EXE_PATH ?? DEFAULT_JIANYING_EXE

  const cliPathReadableFromNode = safeExists(cliPath)
  const executablePathReadableFromNode = safeExists(executablePath)

  const existingCli = (await listCliProfiles()).find(
    (profile) => profile.name === '剪映专业版 CLI' || profile.command === cliPath,
  )
  const cliProfile =
    existingCli ??
    (await createCliProfile({
      name: '剪映专业版 CLI',
      command: cliPath,
      argsTemplate: '--json {{command}}',
      cwdPolicy: 'agent_workspace',
      timeoutMs: 60000,
      inputMode: 'args',
      outputMode: 'json',
      requiresApproval: false,
    }))

  const existingSoftware = (await listSoftwareProfiles()).find(
    (profile) => profile.name === '剪映专业版' || profile.executablePath === executablePath,
  )
  const softwareProfile =
    existingSoftware ??
    (await createSoftwareProfile({
      name: '剪映专业版',
      appType: 'native_app',
      adapterType: 'cli',
      launchCommand: `${quote(cliPath)} --json launch`,
      executablePath,
      defaultWorkstationMode: 'physical_desktop',
    }))

  const existingCommands = await listAllSoftwareCommands()
  const desiredCommands = [
    {
      name: '定位剪映',
      description: 'Locate the real Jianying Pro executable.',
      commandTemplate: `${quote(cliPath)} --json locate`,
      outputSchema: { type: 'object', required: ['path', 'source'] },
    },
    {
      name: '查看剪映状态',
      description: 'Inspect process, windows, and draft roots.',
      commandTemplate: `${quote(cliPath)} --json status`,
      outputSchema: { type: 'object', required: ['running', 'process_count', 'window_count', 'draft_roots'] },
    },
    {
      name: '启动剪映',
      description: 'Launch Jianying Pro or reuse the running process.',
      commandTemplate: `${quote(cliPath)} --json launch`,
      outputSchema: { type: 'object', required: ['executable'] },
    },
    {
      name: '截图剪映主窗口',
      description: 'Capture the visible Jianying Pro main window to PNG.',
      commandTemplate: `${quote(cliPath)} --json screenshot -o "{{outputPath}}"`,
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
      commandTemplate: `${quote(cliPath)} --json drafts`,
      outputSchema: { type: 'array' },
    },
  ]

  const softwareCommands = []
  for (const desired of desiredCommands) {
    const existing = existingCommands.find(
      (command) => command.softwareProfileId === softwareProfile.id && command.name === desired.name,
    )
    if (existing) {
      softwareCommands.push(existing)
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
        },
        riskLevel: desired.name.includes('启动') || desired.name.includes('截图') ? 'medium' : 'low',
        requiresApproval: false,
      }),
    )
  }

  console.log(
    JSON.stringify(
      {
        cliProfile: {
          id: cliProfile.id,
          name: cliProfile.name,
          command: cliProfile.command,
          argsTemplate: cliProfile.argsTemplate,
          pathReadableFromNode: cliPathReadableFromNode,
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

function safeExists(path: string): boolean {
  try {
    return existsSync(path)
  } catch {
    return false
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
