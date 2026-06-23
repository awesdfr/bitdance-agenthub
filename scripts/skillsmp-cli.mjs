#!/usr/bin/env node
import { readFile } from 'node:fs/promises'

const DEFAULT_BASE_URL = 'https://skillsmp.com'
const DEFAULT_LIMIT = 12
const MAX_LIMIT = 100

async function main() {
  const { command, flags } = parseArgs(process.argv.slice(2))
  if (!command || flags.help) {
    printHelp()
    return
  }

  if (command === 'health') {
    writeJson({
      ok: true,
      cli: 'skillsmp',
      baseUrl: resolveBaseUrl(flags),
      supports: ['search'],
      source: process.env.SKILLSMP_FIXTURE_PATH ? 'fixture' : 'live',
    })
    return
  }

  if (command === 'search') {
    const result = await searchSkills(flags)
    writeJson(result)
    return
  }

  throw new CliError(`Unknown command: ${command}`, 'UNKNOWN_COMMAND')
}

async function searchSkills(flags) {
  const query = stringFlag(flags, 'q') ?? stringFlag(flags, 'query')
  if (!query?.trim()) throw new CliError('Missing search query. Use: search --q <keywords>', 'MISSING_QUERY')

  const page = clampNumber(numberFlag(flags, 'page') ?? 1, 1, 10_000)
  const limit = clampNumber(numberFlag(flags, 'limit') ?? DEFAULT_LIMIT, 1, MAX_LIMIT)
  const sortBy = stringFlag(flags, 'sort-by') ?? stringFlag(flags, 'sortBy') ?? 'recent'
  const category = stringFlag(flags, 'category')
  const occupation = stringFlag(flags, 'occupation')

  const fixturePath = process.env.SKILLSMP_FIXTURE_PATH?.trim()
  if (fixturePath) {
    return normalizeResponse({
      raw: JSON.parse(await readFile(fixturePath, 'utf8')),
      query,
      page,
      limit,
      sortBy,
      category,
      occupation,
      source: 'fixture',
      baseUrl: resolveBaseUrl(flags),
      rateLimit: null,
    })
  }

  const baseUrl = resolveBaseUrl(flags)
  const url = new URL('/api/v1/skills/search', baseUrl)
  url.searchParams.set('q', query)
  url.searchParams.set('page', String(page))
  url.searchParams.set('limit', String(limit))
  url.searchParams.set('sortBy', sortBy)
  if (category) url.searchParams.set('category', category)
  if (occupation) url.searchParams.set('occupation', occupation)

  const headers = { accept: 'application/json' }
  const apiKey = process.env.SKILLSMP_API_KEY?.trim() || process.env.AGENTHUB_SKILLSMP_API_KEY?.trim()
  if (apiKey) headers.authorization = `Bearer ${apiKey}`

  const response = await fetch(url, { headers })
  const text = await response.text()
  let raw = null
  try {
    raw = text ? JSON.parse(text) : null
  } catch {
    raw = { text }
  }

  if (!response.ok) {
    const message = readErrorMessage(raw) ?? `SkillsMP API failed with HTTP ${response.status}`
    throw new CliError(message, readErrorCode(raw) ?? 'SKILLSMP_HTTP_ERROR', response.status)
  }

  return normalizeResponse({
    raw,
    query,
    page,
    limit,
    sortBy,
    category,
    occupation,
    source: 'live',
    baseUrl,
    rateLimit: {
      dailyLimit: response.headers.get('x-ratelimit-daily-limit'),
      dailyRemaining: response.headers.get('x-ratelimit-daily-remaining'),
    },
  })
}

function normalizeResponse({ raw, query, page, limit, sortBy, category, occupation, source, baseUrl, rateLimit }) {
  const items = readItems(raw).slice(0, limit).map((item, index) => normalizeSkill(item, index, baseUrl))
  return {
    ok: true,
    cli: 'skillsmp',
    command: 'search',
    source,
    baseUrl,
    query,
    page,
    limit,
    sortBy,
    category: category ?? null,
    occupation: occupation ?? null,
    total: readTotal(raw, items.length),
    rateLimit,
    items,
    rawShape: summarizeShape(raw),
  }
}

function normalizeSkill(item, index, baseUrl) {
  const source = isRecord(item) ? item : {}
  const name = firstString(source.name, source.title, source.slug, source.skillName) ?? `skill-${index + 1}`
  const repository = firstString(
    source.repository,
    source.repo,
    source.repoName,
    source.githubRepo,
    source.github_repository,
  )
  const sourceUrl = normalizeUrl(
    firstString(
      source.sourceUrl,
      source.source_url,
      source.githubUrl,
      source.github_url,
      source.url,
      source.href,
      source.skillUrl,
      source.skill_url,
    ),
    baseUrl,
  )
  const skillUrl = normalizeUrl(firstString(source.skillUrl, source.skill_url, source.url, source.href), baseUrl)
  return {
    id: firstString(source.id, source.slug, source.key) ?? slugify(name),
    name,
    description: firstString(source.description, source.summary, source.readme, source.content) ?? '',
    repository,
    creator: firstString(source.creator, source.owner, source.author, source.organization),
    sourceUrl: sourceUrl ?? skillUrl ?? repositoryToUrl(repository),
    skillUrl,
    stars: numberValue(source.stars, source.starCount, source.githubStars),
    downloads: numberValue(source.downloads, source.usageCount, source.popularity),
    category: firstString(source.category, source.categorySlug, source.category_slug),
    occupation: firstString(source.occupation, source.occupationSlug, source.occupation_slug),
    updatedAt: firstString(source.updatedAt, source.updated_at, source.lastUpdated, source.indexedAt),
    tags: readStringArray(source.tags ?? source.capabilities ?? source.keywords),
    manifest: {
      name,
      description: firstString(source.description, source.summary) ?? '',
      repository,
      sourceUrl: sourceUrl ?? skillUrl ?? repositoryToUrl(repository),
      skillsmp: {
        id: firstString(source.id, source.slug, source.key) ?? null,
        skillUrl,
        category: firstString(source.category, source.categorySlug, source.category_slug) ?? null,
        occupation: firstString(source.occupation, source.occupationSlug, source.occupation_slug) ?? null,
      },
    },
  }
}

function readItems(raw) {
  if (Array.isArray(raw)) return raw
  if (!isRecord(raw)) return []
  for (const key of ['items', 'skills', 'data', 'results', 'records']) {
    if (Array.isArray(raw[key])) return raw[key]
  }
  if (isRecord(raw.data)) return readItems(raw.data)
  return []
}

function readTotal(raw, fallback) {
  if (!isRecord(raw)) return fallback
  const value = numberValue(raw.total, raw.totalCount, raw.count)
  if (typeof value === 'number') return value
  if (isRecord(raw.meta)) return numberValue(raw.meta.total, raw.meta.totalCount) ?? fallback
  if (isRecord(raw.pagination)) return numberValue(raw.pagination.total, raw.pagination.totalCount) ?? fallback
  return fallback
}

function parseArgs(argv) {
  const flags = {}
  let command = ''
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]
    if (!command && !token.startsWith('-')) {
      command = token
      continue
    }
    if (!token.startsWith('--')) continue
    const eqIndex = token.indexOf('=')
    const key = token.slice(2, eqIndex > -1 ? eqIndex : undefined)
    if (eqIndex > -1) {
      flags[key] = token.slice(eqIndex + 1)
      continue
    }
    const next = argv[index + 1]
    if (!next || next.startsWith('--')) {
      flags[key] = true
    } else {
      flags[key] = next
      index += 1
    }
  }
  return { command, flags }
}

function resolveBaseUrl(flags) {
  return stringFlag(flags, 'base-url') ?? process.env.SKILLSMP_BASE_URL ?? DEFAULT_BASE_URL
}

function stringFlag(flags, key) {
  const value = flags[key]
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function numberFlag(flags, key) {
  const value = flags[key]
  const number = typeof value === 'string' ? Number(value) : typeof value === 'number' ? value : Number.NaN
  return Number.isFinite(number) ? number : null
}

function clampNumber(value, min, max) {
  return Math.max(min, Math.min(max, Math.trunc(value)))
}

function writeJson(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`)
}

function printHelp() {
  writeJson({
    cli: 'skillsmp',
    usage: [
      'node scripts/skillsmp-cli.mjs health',
      'node scripts/skillsmp-cli.mjs search --q "code review" --limit 10 --sort-by recent',
    ],
    env: ['SKILLSMP_API_KEY', 'SKILLSMP_BASE_URL', 'SKILLSMP_FIXTURE_PATH'],
  })
}

function firstString(...values) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim()
    if (typeof value === 'number') return String(value)
  }
  return null
}

function numberValue(...values) {
  for (const value of values) {
    const number = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN
    if (Number.isFinite(number)) return number
  }
  return null
}

function readStringArray(value) {
  if (!Array.isArray(value)) return []
  return value.map((item) => firstString(item)).filter(Boolean)
}

function normalizeUrl(value, baseUrl) {
  if (!value) return null
  try {
    return new URL(value, baseUrl).toString()
  } catch {
    return value
  }
}

function repositoryToUrl(repository) {
  if (!repository) return null
  if (/^https?:\/\//i.test(repository)) return repository
  if (/^[\w.-]+\/[\w.-]+/.test(repository)) return `https://github.com/${repository}`
  return null
}

function slugify(value) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'skill'
}

function summarizeShape(raw) {
  if (Array.isArray(raw)) return { type: 'array', length: raw.length }
  if (!isRecord(raw)) return { type: typeof raw }
  return { type: 'object', keys: Object.keys(raw).slice(0, 20) }
}

function readErrorMessage(raw) {
  if (!isRecord(raw)) return null
  if (typeof raw.message === 'string') return raw.message
  if (isRecord(raw.error) && typeof raw.error.message === 'string') return raw.error.message
  return null
}

function readErrorCode(raw) {
  if (!isRecord(raw)) return null
  if (typeof raw.code === 'string') return raw.code
  if (isRecord(raw.error) && typeof raw.error.code === 'string') return raw.error.code
  return null
}

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

class CliError extends Error {
  constructor(message, code = 'CLI_ERROR', status = 400) {
    super(message)
    this.code = code
    this.status = status
  }
}

main().catch((error) => {
  const status = error instanceof CliError ? error.status : 500
  const code = error instanceof CliError ? error.code : 'UNEXPECTED_ERROR'
  writeJson({ ok: false, cli: 'skillsmp', error: { code, message: error.message, status } })
  process.exit(status >= 500 ? 1 : 2)
})
