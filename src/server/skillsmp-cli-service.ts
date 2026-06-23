import { execFile } from 'node:child_process'
import path from 'node:path'
import { promisify } from 'node:util'

import type { JsonObject } from '@/db/schema'

const execFileAsync = promisify(execFile)
const DEFAULT_TIMEOUT_MS = 20_000

export interface SkillsMpCliSearchArgs {
  query: string
  page?: number
  limit?: number
  sortBy?: 'stars' | 'recent'
  category?: string
  occupation?: string
}

export interface SkillsMpCliSkillResult {
  id: string
  name: string
  description: string
  repository: string | null
  creator: string | null
  sourceUrl: string | null
  skillUrl: string | null
  stars: number | null
  downloads: number | null
  category: string | null
  occupation: string | null
  updatedAt: string | null
  tags: string[]
  manifest: JsonObject
}

export interface SkillsMpCliSearchResult {
  ok: true
  cli: 'skillsmp'
  command: 'search'
  source: 'live' | 'fixture'
  baseUrl: string
  query: string
  page: number
  limit: number
  sortBy: string
  category: string | null
  occupation: string | null
  total: number
  rateLimit: {
    dailyLimit: string | null
    dailyRemaining: string | null
  } | null
  items: SkillsMpCliSkillResult[]
  rawShape: JsonObject
}

export interface SkillsMpCliHealthResult {
  ok: true
  cli: 'skillsmp'
  baseUrl: string
  supports: string[]
  source: 'live' | 'fixture'
}

export async function getSkillsMpCliHealth(): Promise<SkillsMpCliHealthResult> {
  return runSkillsMpCli<SkillsMpCliHealthResult>(['health'])
}

export async function searchSkillsMpCli(args: SkillsMpCliSearchArgs): Promise<SkillsMpCliSearchResult> {
  const query = args.query.trim()
  if (!query) throw new Error('请输入要搜索的技能关键词')

  const cliArgs = ['search', '--q', query]
  if (args.page) cliArgs.push('--page', String(args.page))
  if (args.limit) cliArgs.push('--limit', String(args.limit))
  if (args.sortBy) cliArgs.push('--sort-by', args.sortBy)
  if (args.category?.trim()) cliArgs.push('--category', args.category.trim())
  if (args.occupation?.trim()) cliArgs.push('--occupation', args.occupation.trim())

  return runSkillsMpCli<SkillsMpCliSearchResult>(cliArgs)
}

async function runSkillsMpCli<T>(args: string[]): Promise<T> {
  const scriptPath = path.resolve(process.cwd(), 'scripts', 'skillsmp-cli.mjs')
  const env = {
    ...process.env,
    SKILLSMP_API_KEY: process.env.SKILLSMP_API_KEY ?? process.env.AGENTHUB_SKILLSMP_API_KEY ?? '',
    SKILLSMP_BASE_URL: process.env.SKILLSMP_BASE_URL ?? 'https://skillsmp.com',
  }
  const { stdout, stderr } = await execFileAsync(process.execPath, [scriptPath, ...args], {
    cwd: process.cwd(),
    env,
    timeout: Number(process.env.AGENTHUB_SKILLSMP_CLI_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS,
    maxBuffer: 1024 * 1024 * 4,
    windowsHide: true,
  }).catch((error: unknown) => {
    throw normalizeCliExecutionError(error)
  })
  const parsed = parseCliJson(stdout)
  if (isCliError(parsed)) {
    throw new Error(parsed.error.message)
  }
  if (stderr.trim() && typeof parsed === 'object' && parsed !== null) {
    return {
      ...parsed,
      stderr: stderr.trim(),
    } as T
  }
  return parsed as T
}

function parseCliJson(stdout: string): unknown {
  const trimmed = stdout.trim()
  if (!trimmed) throw new Error('SkillsMP CLI 没有返回内容')
  try {
    return JSON.parse(trimmed)
  } catch {
    throw new Error(`SkillsMP CLI 返回了无法解析的内容：${trimmed.slice(0, 300)}`)
  }
}

function isCliError(value: unknown): value is { ok: false; error: { message: string } } {
  return (
    typeof value === 'object' &&
    value !== null &&
    'ok' in value &&
    (value as { ok?: unknown }).ok === false &&
    typeof (value as { error?: { message?: unknown } }).error?.message === 'string'
  )
}

function normalizeCliExecutionError(error: unknown): Error {
  const maybe = error as {
    stdout?: string
    stderr?: string
    message?: string
  }
  if (maybe.stdout) {
    try {
      const parsed = JSON.parse(maybe.stdout)
      if (isCliError(parsed)) return new Error(parsed.error.message)
    } catch {
      // Fall through to stderr/message.
    }
  }
  return new Error(maybe.stderr?.trim() || maybe.message || 'SkillsMP CLI 执行失败')
}
