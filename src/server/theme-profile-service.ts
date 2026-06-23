import { asc, eq } from 'drizzle-orm'

import { db, schema } from '@/db/client'
import type {
  JsonObject,
  ThemeModePreference,
  ThemePresetKey,
  ThemeProfileRow,
  ThemeSpacingScale,
} from '@/db/schema'
import { newThemeProfileId } from '@/server/ids'

const defaultFonts = {
  ui: 'Inter',
  code: 'JetBrains Mono',
  agentOutput: 'Inter',
}

const presetProfiles: Array<{
  presetKey: ThemePresetKey
  name: string
  followSystem: boolean
  modePreference: ThemeModePreference
  radiusPx: number
  spacingScale: ThemeSpacingScale
  colorTokens: JsonObject
}> = [
  {
    presetKey: 'light',
    name: 'Light',
    followSystem: true,
    modePreference: 'system',
    radiusPx: 8,
    spacingScale: 'comfortable',
    colorTokens: colorTokens({
      surface: '#FFFFFF',
      text: '#111827',
      accent: '#2563EB',
      node: '#DBEAFE',
      confidence: '#16A34A',
    }),
  },
  {
    presetKey: 'dark',
    name: 'Dark',
    followSystem: false,
    modePreference: 'dark',
    radiusPx: 8,
    spacingScale: 'comfortable',
    colorTokens: colorTokens({
      surface: '#111827',
      text: '#F9FAFB',
      accent: '#60A5FA',
      node: '#1E3A8A',
      confidence: '#22C55E',
    }),
  },
  {
    presetKey: 'highContrast',
    name: 'High Contrast',
    followSystem: false,
    modePreference: 'dark',
    radiusPx: 4,
    spacingScale: 'comfortable',
    colorTokens: colorTokens({
      surface: '#000000',
      text: '#FFFFFF',
      accent: '#FFFF00',
      node: '#FFFFFF',
      confidence: '#00FF66',
    }),
  },
  {
    presetKey: 'cozy',
    name: 'Cozy',
    followSystem: false,
    modePreference: 'light',
    radiusPx: 10,
    spacingScale: 'spacious',
    colorTokens: colorTokens({
      surface: '#FAFAF7',
      text: '#1F2937',
      accent: '#0F766E',
      node: '#CCFBF1',
      confidence: '#15803D',
    }),
  },
]

export async function seedThemeProfiles(): Promise<ThemeProfileRow[]> {
  const now = Date.now()
  for (const profile of presetProfiles) {
    const existing = await db.query.themeProfiles.findFirst({
      where: eq(schema.themeProfiles.presetKey, profile.presetKey),
    })
    if (existing) continue
    await db.insert(schema.themeProfiles).values({
      id: newThemeProfileId(),
      name: profile.name,
      presetKey: profile.presetKey,
      followSystem: profile.followSystem,
      modePreference: profile.modePreference,
      colorTokens: profile.colorTokens,
      fontTokens: defaultFonts,
      radiusPx: profile.radiusPx,
      spacingScale: profile.spacingScale,
      status: 'active',
      createdAt: now,
      updatedAt: now,
    })
  }
  return listThemeProfiles()
}

export async function listThemeProfiles(): Promise<ThemeProfileRow[]> {
  return db.query.themeProfiles.findMany({
    orderBy: [asc(schema.themeProfiles.presetKey)],
    limit: 50,
  })
}

export async function createThemeProfile(args: {
  name: string
  presetKey?: ThemePresetKey
  followSystem?: boolean
  modePreference?: ThemeModePreference
  colorTokens?: JsonObject
  fontTokens?: JsonObject
  radiusPx?: number
  spacingScale?: ThemeSpacingScale
}): Promise<ThemeProfileRow> {
  const now = Date.now()
  const preset = presetProfiles.find((item) => item.presetKey === (args.presetKey ?? 'light')) ?? presetProfiles[0]
  const row: ThemeProfileRow = {
    id: newThemeProfileId(),
    name: args.name.trim(),
    presetKey: args.presetKey ?? 'light',
    followSystem: args.followSystem ?? false,
    modePreference: args.modePreference ?? preset.modePreference,
    colorTokens: mergeJson(preset.colorTokens, args.colorTokens),
    fontTokens: mergeJson(defaultFonts, args.fontTokens),
    radiusPx: args.radiusPx ?? preset.radiusPx,
    spacingScale: args.spacingScale ?? preset.spacingScale,
    status: 'active',
    createdAt: now,
    updatedAt: now,
  }
  await db.insert(schema.themeProfiles).values(row)
  return row
}

export async function resolveThemeProfile(args: {
  profileId?: string | null
  systemTheme?: 'light' | 'dark'
} = {}): Promise<{
  profile: ThemeProfileRow
  effectiveMode: 'light' | 'dark'
  cssVariables: JsonObject
}> {
  const profiles = await seedThemeProfiles()
  const profile = args.profileId
    ? await db.query.themeProfiles.findFirst({ where: eq(schema.themeProfiles.id, args.profileId) })
    : profiles.find((item) => item.followSystem) ?? profiles[0]
  if (!profile) throw new Error(`Theme profile not found: ${args.profileId ?? 'default'}`)
  const effectiveMode = profile.followSystem
    ? args.systemTheme ?? 'light'
    : profile.modePreference === 'dark'
      ? 'dark'
      : 'light'
  return {
    profile,
    effectiveMode,
    cssVariables: buildCssVariables(profile, effectiveMode),
  }
}

function colorTokens(args: {
  surface: string
  text: string
  accent: string
  node: string
  confidence: string
}): JsonObject {
  return {
    surface: args.surface,
    text: args.text,
    accent: args.accent,
    agentStatus: {
      idle: '#6B7280',
      busy: args.accent,
      paused: '#F59E0B',
      error: '#DC2626',
      complete: '#16A34A',
    },
    canvasNode: {
      agent: args.node,
      tool: '#E0F2FE',
      approval: '#FEF3C7',
      merge: '#EDE9FE',
    },
    confidence: {
      low: '#DC2626',
      medium: '#F59E0B',
      high: args.confidence,
    },
  }
}

function buildCssVariables(profile: ThemeProfileRow, mode: 'light' | 'dark'): JsonObject {
  const colors = profile.colorTokens
  const fonts = profile.fontTokens
  return {
    '--reasonix-theme-mode': mode,
    '--radius': `${profile.radiusPx}px`,
    '--spacing-scale': profile.spacingScale,
    '--font-ui': readString(fonts.ui) || defaultFonts.ui,
    '--font-code': readString(fonts.code) || defaultFonts.code,
    '--font-agent-output': readString(fonts.agentOutput) || defaultFonts.agentOutput,
    '--color-surface': readString(colors.surface),
    '--color-text': readString(colors.text),
    '--color-accent': readString(colors.accent),
    '--agent-status-idle': readNestedString(colors, 'agentStatus', 'idle'),
    '--agent-status-busy': readNestedString(colors, 'agentStatus', 'busy'),
    '--agent-status-paused': readNestedString(colors, 'agentStatus', 'paused'),
    '--agent-status-error': readNestedString(colors, 'agentStatus', 'error'),
    '--agent-status-complete': readNestedString(colors, 'agentStatus', 'complete'),
    '--canvas-node-agent': readNestedString(colors, 'canvasNode', 'agent'),
    '--canvas-node-tool': readNestedString(colors, 'canvasNode', 'tool'),
    '--confidence-low': readNestedString(colors, 'confidence', 'low'),
    '--confidence-medium': readNestedString(colors, 'confidence', 'medium'),
    '--confidence-high': readNestedString(colors, 'confidence', 'high'),
  }
}

function mergeJson(base: JsonObject, override: JsonObject | undefined): JsonObject {
  return { ...base, ...(override ?? {}) }
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function readNestedString(source: JsonObject, group: string, key: string): string {
  const groupValue = source[group]
  if (!groupValue || typeof groupValue !== 'object' || Array.isArray(groupValue)) return ''
  return readString((groupValue as Record<string, unknown>)[key])
}
