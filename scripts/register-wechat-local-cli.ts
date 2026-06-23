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
  'C:\\Users\\九思\\AppData\\Local\\Programs\\Python\\Python312\\Scripts\\cli-anything-wechat.exe'
const DEFAULT_WECHAT_EXE = 'D:\\微信\\Weixin\\Weixin.exe'

function quote(value: string): string {
  return `"${value.replace(/"/g, '\\"')}"`
}

async function main() {
  const cliPath = process.env.WECHAT_CLI_PATH ?? DEFAULT_CLI_PATH
  const executablePath = process.env.WECHAT_EXE_PATH ?? DEFAULT_WECHAT_EXE
  const cliPathReadableFromNode = safeExists(cliPath)
  const executableReadableFromNode = safeExists(executablePath)

  const existingCli = (await listCliProfiles()).find(
    (profile) => profile.name === '微信桌面版 CLI' || profile.command === cliPath,
  )
  const cliProfile =
    existingCli ??
    (await createCliProfile({
      name: '微信桌面版 CLI',
      command: cliPath,
      argsTemplate: '--json {{command}}',
      cwdPolicy: 'agent_workspace',
      timeoutMs: 60000,
      inputMode: 'args',
      outputMode: 'json',
      requiresApproval: true,
    }))

  const existingSoftware = (await listSoftwareProfiles()).find(
    (profile) => profile.name === '微信桌面版' || profile.executablePath === executablePath,
  )
  const softwareProfile =
    existingSoftware ??
    (await createSoftwareProfile({
      name: '微信桌面版',
      appType: 'native_app',
      adapterType: 'cli',
      launchCommand: `${quote(cliPath)} --json launch`,
      executablePath,
      defaultWorkstationMode: 'physical_desktop',
    }))

  const existingCommands = await listAllSoftwareCommands()
  const desiredCommands = [
    {
      name: '定位微信',
      description: 'Locate the real Windows WeChat executable.',
      commandTemplate: `${quote(cliPath)} --json locate`,
      riskLevel: 'low' as const,
      requiresApproval: false,
      outputSchema: { type: 'object', required: ['path', 'source'] },
    },
    {
      name: '查看微信状态',
      description: 'Inspect process and window status for the local WeChat client.',
      commandTemplate: `${quote(cliPath)} --json status`,
      riskLevel: 'low' as const,
      requiresApproval: false,
      outputSchema: { type: 'object', required: ['running', 'process_count', 'window_count'] },
    },
    {
      name: '聚焦微信窗口',
      description: 'Focus the active WeChat window without sending messages.',
      commandTemplate: `${quote(cliPath)} --json focus`,
      riskLevel: 'medium' as const,
      requiresApproval: false,
      outputSchema: { type: 'object' },
    },
    {
      name: '截图微信窗口',
      description: 'Capture the currently visible WeChat window to PNG.',
      commandTemplate: `${quote(cliPath)} --json screenshot -o "{{outputPath}}"`,
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
      commandTemplate: `${quote(cliPath)} --json visible-text --ack-privacy --max-items {{maxItems}}`,
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
      commandTemplate: `${quote(cliPath)} --json message draft-current --ack-current-chat --text "{{text}}"`,
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
        riskLevel: desired.riskLevel,
        requiresApproval: desired.requiresApproval,
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
