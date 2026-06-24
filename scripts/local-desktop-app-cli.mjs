#!/usr/bin/env node
import { spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const args = parseArgs(process.argv.slice(2))
const app = normalizeApp(args.app ?? args._[0] ?? process.env.AGENTHUB_DESKTOP_APP)
const command = app && normalizeApp(args._[0]) === app ? args._[1] : args._[0]

if (!app || !command || args.help) {
  write({
    ok: true,
    cli: 'agenthub-local-desktop-app',
    usage: [
      'node scripts/local-desktop-app-cli.mjs --app wechat --json locate',
      'node scripts/local-desktop-app-cli.mjs --app wechat --json status',
      'node scripts/local-desktop-app-cli.mjs --app wechat --json screenshot -o output.png',
      'node scripts/local-desktop-app-cli.mjs --app jianying --json launch',
      'node scripts/local-desktop-app-cli.mjs --app jianying --json drafts',
    ],
  })
  process.exit(command ? 0 : 1)
}

try {
  const result = await runCommand(app, command, args)
  write({ ok: true, cli: 'agenthub-local-desktop-app', app, command, ...result })
} catch (err) {
  writeError(err)
  process.exit(1)
}

async function runCommand(appName, action, options) {
  if (action === 'locate') return locateApp(appName)
  if (action === 'status') return statusApp(appName)
  if (action === 'launch') return launchApp(appName)
  if (action === 'focus') return focusApp(appName)
  if (action === 'screenshot') return screenshotApp(appName, options.output ?? options.o)
  if (action === 'drafts' && appName === 'jianying') return { draft_roots: listJianyingDraftRoots() }
  if (action === 'visible-text' && appName === 'wechat') {
    return { items: readVisibleText(appName, Number(options['max-items'] ?? 80)) }
  }
  if (action === 'message' && appName === 'wechat') return runWechatMessageCommand(options)
  throw new CliError(`Unsupported command for ${appName}: ${action}`, 'UNSUPPORTED_COMMAND')
}

function locateApp(appName) {
  const candidates = appDefinition(appName).candidatePaths()
  const found = candidates.find((candidate) => safeExists(candidate))
  if (found) {
    return {
      path: found,
      source: 'known_path',
      candidatesChecked: candidates.length,
      found: true,
    }
  }
  const processMatch = statusApp(appName).processes[0]
  if (processMatch?.path && safeExists(processMatch.path)) {
    return {
      path: processMatch.path,
      source: 'running_process',
      candidatesChecked: candidates.length,
      found: true,
    }
  }
  return {
    path: null,
    source: 'not_found',
    candidatesChecked: candidates.length,
    found: false,
    installHint: appDefinition(appName).installHint,
  }
}

function statusApp(appName) {
  const definition = appDefinition(appName)
  const processes = getProcesses(definition.processNames)
  const windows = processes
    .filter((item) => item.mainWindowHandle && item.mainWindowHandle !== 0)
    .map((item) => ({
      processId: item.id,
      processName: item.processName,
      title: item.mainWindowTitle,
      handle: item.mainWindowHandle,
    }))
  return {
    running: processes.length > 0,
    process_count: processes.length,
    window_count: windows.length,
    processes,
    windows,
    draft_roots: appName === 'jianying' ? listJianyingDraftRoots() : undefined,
  }
}

function launchApp(appName) {
  const current = statusApp(appName)
  const located = locateApp(appName)
  if (current.running) {
    return {
      alreadyRunning: true,
      executable: located.path,
      process_count: current.process_count,
      window_count: current.window_count,
    }
  }
  if (!located.path) {
    throw new CliError(`${appDefinition(appName).displayName} executable not found.`, 'APP_NOT_FOUND', located)
  }
  const child = spawn(located.path, [], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  })
  child.unref()
  return {
    alreadyRunning: false,
    launched: true,
    executable: located.path,
    pid: child.pid ?? null,
  }
}

function focusApp(appName) {
  const definition = appDefinition(appName)
  const ps = `
$names = $env:AGENTHUB_PROCESS_NAMES -split ','
$candidates = Get-Process | Where-Object {
  $_.MainWindowHandle -ne 0 -and ($names -contains $_.ProcessName)
} | Sort-Object StartTime -Descending
$target = $candidates | Select-Object -First 1
if (-not $target) { throw "No matching window" }
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class AgentHubWindow {
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool ShowWindowAsync(IntPtr hWnd, int nCmdShow);
}
"@
[AgentHubWindow]::ShowWindowAsync($target.MainWindowHandle, 5) | Out-Null
[AgentHubWindow]::SetForegroundWindow($target.MainWindowHandle) | Out-Null
[PSCustomObject]@{
  processId = $target.Id
  processName = $target.ProcessName
  title = $target.MainWindowTitle
  handle = [int64]$target.MainWindowHandle
} | ConvertTo-Json -Compress
`
  return {
    focused: true,
    window: powershellJson(ps, {
      AGENTHUB_PROCESS_NAMES: definition.processNames.join(','),
    }),
  }
}

function screenshotApp(appName, outputPath) {
  if (!outputPath) {
    throw new CliError('screenshot requires -o/--output.', 'OUTPUT_REQUIRED')
  }
  const absoluteOutput = path.resolve(outputPath)
  fs.mkdirSync(path.dirname(absoluteOutput), { recursive: true })
  let focusResult = null
  try {
    focusResult = focusApp(appName)
  } catch {
    focusResult = null
  }
  const ps = `
Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Windows.Forms
$path = $env:AGENTHUB_SCREENSHOT_PATH
$bounds = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
$bitmap = New-Object System.Drawing.Bitmap $bounds.Width, $bounds.Height
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$graphics.CopyFromScreen($bounds.Location, [System.Drawing.Point]::Empty, $bounds.Size)
$bitmap.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
$graphics.Dispose()
$bitmap.Dispose()
[PSCustomObject]@{
  output = $path
  width = $bounds.Width
  height = $bounds.Height
} | ConvertTo-Json -Compress
`
  const result = powershellJson(ps, { AGENTHUB_SCREENSHOT_PATH: absoluteOutput })
  const stat = fs.statSync(absoluteOutput)
  return {
    ...result,
    output: absoluteOutput,
    file_size: stat.size,
    captureMode: 'primary_screen_after_focus',
    focusedWindow: focusResult?.window ?? null,
  }
}

function readVisibleText(appName, maxItems) {
  const definition = appDefinition(appName)
  const limit = Number.isFinite(maxItems) && maxItems > 0 ? Math.min(Math.floor(maxItems), 200) : 80
  const ps = `
$names = $env:AGENTHUB_PROCESS_NAMES -split ','
$limit = [int]$env:AGENTHUB_MAX_ITEMS
$target = Get-Process | Where-Object {
  $_.MainWindowHandle -ne 0 -and ($names -contains $_.ProcessName)
} | Sort-Object StartTime -Descending | Select-Object -First 1
if (-not $target) { throw "No matching window" }
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
$root = [System.Windows.Automation.AutomationElement]::FromHandle([IntPtr]$target.MainWindowHandle)
$results = New-Object System.Collections.Generic.List[object]
function Walk($node) {
  if ($null -eq $node -or $results.Count -ge $limit) { return }
  $name = $node.Current.Name
  if ($name -and $name.Trim().Length -gt 0) {
    $results.Add([PSCustomObject]@{
      name = $name
      controlType = $node.Current.ControlType.ProgrammaticName
    }) | Out-Null
  }
  $walker = [System.Windows.Automation.TreeWalker]::ControlViewWalker
  $child = $walker.GetFirstChild($node)
  while ($child -ne $null -and $results.Count -lt $limit) {
    Walk $child
    $child = $walker.GetNextSibling($child)
  }
}
Walk $root
$results | ConvertTo-Json -Depth 4 -Compress
`
  return asArray(powershellJson(ps, {
    AGENTHUB_PROCESS_NAMES: definition.processNames.join(','),
    AGENTHUB_MAX_ITEMS: String(limit),
  }))
}

function runWechatMessageCommand(options) {
  const subcommand = options._[1]
  const action = options._[2]
  if (subcommand !== 'message' || action !== 'draft-current') {
    throw new CliError('Only message draft-current is supported by the built-in WeChat CLI.', 'UNSUPPORTED_COMMAND')
  }
  if (!options['ack-current-chat']) {
    throw new CliError('Drafting requires --ack-current-chat.', 'ACK_REQUIRED')
  }
  const text = String(options.text ?? '')
  if (!text.trim()) throw new CliError('Drafting requires --text.', 'TEXT_REQUIRED')
  focusApp('wechat')
  const ps = `
Add-Type -AssemblyName System.Windows.Forms
$text = $env:AGENTHUB_DRAFT_TEXT
[System.Windows.Forms.SendKeys]::SendWait($text)
[PSCustomObject]@{
  drafted = $true
  sent = $false
  chars = $text.Length
} | ConvertTo-Json -Compress
`
  return powershellJson(ps, { AGENTHUB_DRAFT_TEXT: text })
}

function getProcesses(processNames) {
  if (process.platform !== 'win32') return []
  const ps = `
$names = $env:AGENTHUB_PROCESS_NAMES -split ','
Get-Process | Where-Object {
  $names -contains $_.ProcessName
} | ForEach-Object {
  $path = $null
  try { $path = $_.Path } catch {}
  [PSCustomObject]@{
    id = $_.Id
    processName = $_.ProcessName
    mainWindowTitle = $_.MainWindowTitle
    mainWindowHandle = [int64]$_.MainWindowHandle
    path = $path
    startTime = try { $_.StartTime.ToString("o") } catch { $null }
  }
} | ConvertTo-Json -Depth 4 -Compress
`
  return asArray(powershellJson(ps, { AGENTHUB_PROCESS_NAMES: processNames.join(',') }))
}

function listJianyingDraftRoots() {
  const home = os.homedir()
  const configured = splitPathEnv(process.env.JIANYING_DRAFT_ROOTS)
  const candidates = [
    ...configured,
    path.join(home, 'Documents', 'JianyingPro', 'User Data', 'Projects', 'com.lveditor.draft'),
    path.join(process.env.LOCALAPPDATA ?? '', 'JianyingPro', 'User Data', 'Projects', 'com.lveditor.draft'),
    path.join(process.env.APPDATA ?? '', 'JianyingPro', 'User Data', 'Projects', 'com.lveditor.draft'),
    'D:\\JianyingProDrafts',
    'D:\\JianyingDrafts',
  ].filter(Boolean)
  return candidates.map((root) => {
    const exists = safeExists(root)
    const drafts = exists ? safeList(root).slice(0, 20) : []
    return {
      path: root,
      exists,
      draftCount: drafts.length,
      sampleDrafts: drafts,
    }
  })
}

function appDefinition(appName) {
  if (appName === 'wechat') {
    return {
      displayName: 'WeChat desktop',
      processNames: ['Weixin', 'WeChat'],
      installHint: 'Install Windows WeChat or set WECHAT_EXE_PATH to Weixin.exe.',
      candidatePaths: () => uniquePaths([
        process.env.WECHAT_EXE_PATH,
        process.env.WECHAT_EXE,
        'D:\\微信\\Weixin\\Weixin.exe',
        'D:\\WeChat\\Weixin\\Weixin.exe',
        'C:\\Program Files\\Tencent\\Weixin\\Weixin.exe',
        'C:\\Program Files (x86)\\Tencent\\Weixin\\Weixin.exe',
        'C:\\Program Files\\Tencent\\WeChat\\WeChat.exe',
        'C:\\Program Files (x86)\\Tencent\\WeChat\\WeChat.exe',
        path.join(process.env.LOCALAPPDATA ?? '', 'Tencent', 'Weixin', 'Weixin.exe'),
      ]),
    }
  }
  if (appName === 'jianying') {
    return {
      displayName: 'Jianying Pro',
      processNames: ['JianyingPro', 'Jianying', 'CapCut'],
      installHint: 'Install Jianying Pro/CapCut or set JIANYING_EXE_PATH to the executable.',
      candidatePaths: () => uniquePaths([
        process.env.JIANYING_EXE_PATH,
        process.env.JIANYING_EXE,
        'D:\\JianyingPro\\JianyingPro.exe',
        'D:\\CapCut\\CapCut.exe',
        'C:\\Program Files\\JianyingPro\\JianyingPro.exe',
        'C:\\Program Files (x86)\\JianyingPro\\JianyingPro.exe',
        'C:\\Program Files\\CapCut\\CapCut.exe',
        path.join(process.env.LOCALAPPDATA ?? '', 'JianyingPro', 'Apps', 'JianyingPro.exe'),
        path.join(process.env.LOCALAPPDATA ?? '', 'CapCut', 'Apps', 'CapCut.exe'),
      ]),
    }
  }
  throw new CliError(`Unsupported app: ${appName}`, 'UNSUPPORTED_APP')
}

function powershellJson(script, env = {}) {
  if (process.platform !== 'win32') {
    throw new CliError('Windows PowerShell is required for this desktop command.', 'WINDOWS_REQUIRED')
  }
  const utf8Script = `
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new()
$OutputEncoding = [System.Text.UTF8Encoding]::new()
${script}
`
  const result = spawnSync(
    'powershell.exe',
    ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', utf8Script],
    {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 15000,
      maxBuffer: 8 * 1024 * 1024,
      env: { ...process.env, ...env },
    },
  )
  if (result.error) throw result.error
  if (result.status !== 0) {
    throw new CliError(
      firstLine(result.stderr) ?? firstLine(result.stdout) ?? 'PowerShell command failed.',
      'POWERSHELL_FAILED',
      { status: result.status, stderr: result.stderr, stdout: result.stdout },
    )
  }
  const text = result.stdout.trim()
  if (!text) return []
  try {
    return JSON.parse(text)
  } catch {
    throw new CliError('PowerShell did not return valid JSON.', 'INVALID_JSON', { stdout: text })
  }
}

function parseArgs(argv) {
  const parsed = { _: [] }
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i]
    if (token === '--json') {
      parsed.json = true
      continue
    }
    if (token === '--help' || token === '-h') {
      parsed.help = true
      continue
    }
    if (token.startsWith('--')) {
      const eq = token.indexOf('=')
      if (eq > 0) {
        parsed[token.slice(2, eq)] = token.slice(eq + 1)
      } else {
        const key = token.slice(2)
        const next = argv[i + 1]
        if (!next || next.startsWith('-')) parsed[key] = true
        else {
          parsed[key] = next
          i += 1
        }
      }
      continue
    }
    if (token === '-o') {
      parsed.o = argv[i + 1]
      i += 1
      continue
    }
    parsed._.push(token)
  }
  return parsed
}

function normalizeApp(value) {
  const text = String(value ?? '').trim().toLowerCase()
  if (['wechat', 'weixin', 'wx'].includes(text)) return 'wechat'
  if (['jianying', 'capcut', 'jy'].includes(text)) return 'jianying'
  return text || null
}

function write(payload) {
  if (args.json) {
    process.stdout.write(`${JSON.stringify(payload)}\n`)
    return
  }
  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`)
}

function writeError(err) {
  const error = err instanceof CliError
    ? { code: err.code, message: err.message, details: err.details ?? null }
    : { code: 'CLI_ERROR', message: err instanceof Error ? err.message : String(err), details: null }
  write({ ok: false, cli: 'agenthub-local-desktop-app', app, command, error })
}

function asArray(value) {
  if (!value) return []
  return Array.isArray(value) ? value : [value]
}

function safeExists(value) {
  try {
    return Boolean(value) && fs.existsSync(value)
  } catch {
    return false
  }
}

function safeList(root) {
  try {
    return fs.readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
  } catch {
    return []
  }
}

function splitPathEnv(value) {
  return String(value ?? '')
    .split(';')
    .map((item) => item.trim())
    .filter(Boolean)
}

function uniquePaths(values) {
  return [...new Set(values.filter((value) => typeof value === 'string' && value.trim()).map((value) => path.normalize(value)))]
}

function firstLine(value) {
  return String(value ?? '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean) ?? null
}

class CliError extends Error {
  constructor(message, code = 'CLI_ERROR', details = null) {
    super(message)
    this.name = 'CliError'
    this.code = code
    this.details = details
  }
}
