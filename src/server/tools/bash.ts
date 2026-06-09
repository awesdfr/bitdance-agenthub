import { spawn, type ChildProcess } from 'node:child_process'

import { eq } from 'drizzle-orm'
import { z } from 'zod'

import { classifyBashApproval, waitForBashApproval } from '@/server/bash-command-approval'
import { db, schema } from '@/db/client'
import { currentPlatform, type Platform } from '@/server/platform'
import { findBannedPattern } from '@/server/security'
import { getEffectiveCwd } from '@/server/workspace-utils'

import type { ToolDef, ToolResult } from './types'

const ArgsSchema = z.object({
  command: z.string().min(1),
})

const TIMEOUT_MS = 30_000
const MAX_OUTPUT_CHARS = 10_000

interface ShellInvocation {
  cmd: string
  args: string[]
}

function buildShellInvocation(command: string, platform: Platform): ShellInvocation {
  if (platform === 'windows') {
    // 设置 Console 与 $OutputEncoding 为 UTF-8。比 `chcp 65001` 更彻底——chcp 在
    // PowerShell 初始化输出流之后才生效，导致命令本身的错误信息仍是 GBK。
    const preamble =
      "$OutputEncoding = [Console]::OutputEncoding = [System.Text.UTF8Encoding]::new();"
    return {
      cmd: 'powershell.exe',
      args: ['-NoProfile', '-NonInteractive', '-Command', `${preamble} ${command}`],
    }
  }
  return { cmd: 'sh', args: ['-c', command] }
}

function killProcessTree(child: ChildProcess, platform: Platform) {
  if (platform === 'windows' && typeof child.pid === 'number') {
    const killer = spawn('taskkill', ['/F', '/T', '/PID', String(child.pid)], { windowsHide: true })
    // 极少数 Win 镜像（Server Core 缩减版）没 taskkill.exe，吃 ENOENT 防 unhandled error 崩 worker
    killer.on('error', () => {})
    return
  }
  child.kill('SIGTERM')
}

const PLATFORM = currentPlatform()

const DESCRIPTION_POSIX =
  'Run a shell command (sh -c) inside the workspace (cwd is set automatically). Use POSIX syntax: ls, grep, cat, git, npm, python, etc. Output is stdout + stderr combined, truncated to 10000 chars, 30s timeout. Destructive commands (rm -rf /, sudo, fork bombs, curl | sh) are blocked. No interactive stdin.'

const DESCRIPTION_WINDOWS =
  'Run a Windows PowerShell 5.1 command inside the workspace (cwd is set automatically). ' +
  'CRITICAL: this is Windows, not Linux/macOS. You MUST use PowerShell syntax — POSIX flags like `-la`, `-rf` do not work. ' +
  'Examples of correct commands: `Get-ChildItem -Force` (NOT `ls -la`), `Get-Content file.txt` (NOT `cat`), ' +
  '`Select-String pattern file.txt` (NOT `grep`), `Remove-Item path` (NOT `rm`), `New-Item -ItemType Directory` (NOT `mkdir -p`), ' +
  '`Copy-Item src dst` (NOT `cp`), `Move-Item src dst` (NOT `mv`). git/npm/python/node work as usual. ' +
  'Output is UTF-8, stdout + stderr combined, truncated to 10000 chars, 30s timeout. ' +
  'Destructive commands (Remove-Item -Recurse -Force, format, shutdown, iex(iwr ...), reg delete, Set-ExecutionPolicy Unrestricted) are blocked. No interactive stdin.'

/**
 * bash —— 在 workspace 内跑 shell 命令。详见 specs/07-tools.md, specs/11-platform.md。
 *
 * cwd 强制为 workspace effective cwd（local → boundPath，sandbox → rootPath）；
 * 命令前匹配双平台黑名单；30s 超时；stdout + stderr 合并截断 10000 字符。
 * AbortSignal 触发立即 kill 进程树（Windows 走 taskkill /F /T，POSIX 走 SIGTERM）。
 */
export const bashTool: ToolDef = {
  name: 'bash',
  description: PLATFORM === 'windows' ? DESCRIPTION_WINDOWS : DESCRIPTION_POSIX,
  parameters: {
    type: 'object',
    required: ['command'],
    properties: {
      command: {
        type: 'string',
        description:
          PLATFORM === 'windows'
            ? 'PowerShell command to execute. cwd is the workspace; do not Set-Location elsewhere.'
            : 'Shell command to execute. cwd is the workspace; do not cd elsewhere.',
      },
    },
  },
  async handler(args, ctx) {
    const parsed = ArgsSchema.safeParse(args)
    if (!parsed.success) {
      return { ok: false, error: `Invalid args: ${parsed.error.message}` }
    }

    const command = parsed.data.command
    const banned = findBannedPattern(command, PLATFORM)
    if (banned) {
      return { ok: false, error: `Command rejected by safety policy: ${banned.source}` }
    }

    const workspace = await db.query.workspaces.findFirst({
      where: eq(schema.workspaces.conversationId, ctx.conversationId),
    })
    if (!workspace) return { ok: false, error: 'Workspace not found' }

    const cwd = getEffectiveCwd(workspace)
    const approval = classifyBashApproval(command, PLATFORM)
    if (approval.required) {
      const approved = await waitForBashApproval({
        conversationId: ctx.conversationId,
        agentId: ctx.agentId,
        runId: ctx.runId,
        command,
        cwd,
        reason: approval.reason,
        signal: ctx.abortSignal,
      })
      if (!approved) {
        return { ok: false, error: `User rejected command execution: ${approval.reason}` }
      }
    }

    return runShellCommand(command, cwd, PLATFORM, ctx.abortSignal)
  },
}

function runShellCommand(
  command: string,
  cwd: string,
  platform: Platform,
  signal: AbortSignal,
): Promise<ToolResult> {
  const shell = buildShellInvocation(command, platform)

  return new Promise((resolve) => {
    const child = spawn(shell.cmd, shell.args, {
      cwd,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    })

    let buffer = ''
    let truncated = false
    const append = (chunk: Buffer) => {
      if (truncated) return
      const text = chunk.toString('utf8')
      if (buffer.length + text.length <= MAX_OUTPUT_CHARS) {
        buffer += text
      } else {
        buffer = (buffer + text).slice(0, MAX_OUTPUT_CHARS)
        truncated = true
      }
    }

    child.stdout?.on('data', append)
    child.stderr?.on('data', append)

    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      killProcessTree(child, platform)
    }, TIMEOUT_MS)

    const onAbort = () => killProcessTree(child, platform)
    signal.addEventListener('abort', onAbort, { once: true })

    child.on('error', (err) => {
      clearTimeout(timer)
      signal.removeEventListener('abort', onAbort)
      resolve({
        ok: false,
        error: `Spawn failed: ${err instanceof Error ? err.message : String(err)}`,
      })
    })

    child.on('close', (exitCode, closeSignal) => {
      clearTimeout(timer)
      signal.removeEventListener('abort', onAbort)
      const note = timedOut
        ? `\n\n[KILLED after ${TIMEOUT_MS / 1000}s timeout]`
        : closeSignal
          ? `\n\n[KILLED by signal ${closeSignal}]`
          : ''
      const truncNote = truncated ? `\n\n[TRUNCATED at ${MAX_OUTPUT_CHARS} chars]` : ''
      resolve({
        ok: true,
        value: {
          cwd,
          command,
          exitCode: exitCode ?? null,
          output: buffer + truncNote + note,
          truncated,
          timedOut,
        },
      })
    })
  })
}
