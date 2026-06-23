import { asc, eq } from 'drizzle-orm'

import { db, schema } from '@/db/client'
import type {
  AccessibilityColorScheme,
  AccessibilityProfileRow,
  JsonObject,
} from '@/db/schema'
import { newAccessibilityProfileId } from '@/server/ids'
import { seedKeyboardShortcuts } from '@/server/keyboard-shortcut-service'
import { seedThemeProfiles } from '@/server/theme-profile-service'

const DEFAULT_ACCESSIBILITY_PROFILE_KEY = 'accessible_default'

type AccessibilityRequirementKey =
  | 'keyboard_navigation'
  | 'screen_reader_support'
  | 'high_contrast_mode'
  | 'font_size_adjustment'
  | 'color_scheme'

export interface CreateAccessibilityProfileArgs {
  profileKey: string
  name: string
  keyboardNavigation?: boolean
  screenReaderSupport?: boolean
  highContrastMode?: boolean
  fontScale?: number
  colorScheme?: AccessibilityColorScheme
  themeProfileId?: string | null
}

export function getDefaultAccessibilityRequirementCount(): number {
  return 5
}

export async function seedAccessibilityProfiles(): Promise<AccessibilityProfileRow[]> {
  const themes = await seedThemeProfiles()
  await seedKeyboardShortcuts()
  const highContrastTheme = themes.find((theme) => theme.presetKey === 'highContrast')
  const existing = await db.query.accessibilityProfiles.findFirst({
    where: eq(schema.accessibilityProfiles.profileKey, DEFAULT_ACCESSIBILITY_PROFILE_KEY),
  })
  if (existing) {
    await evaluateAccessibilityProfile(existing.id)
    return listAccessibilityProfiles()
  }
  const profile = await createAccessibilityProfile({
    profileKey: DEFAULT_ACCESSIBILITY_PROFILE_KEY,
    name: 'Accessible Default',
    keyboardNavigation: true,
    screenReaderSupport: true,
    highContrastMode: true,
    fontScale: 1.15,
    colorScheme: 'system',
    themeProfileId: highContrastTheme?.id ?? null,
  })
  await evaluateAccessibilityProfile(profile.id)
  return listAccessibilityProfiles()
}

export async function createAccessibilityProfile(
  args: CreateAccessibilityProfileArgs,
): Promise<AccessibilityProfileRow> {
  await seedThemeProfiles()
  await seedKeyboardShortcuts()
  const now = Date.now()
  const row: AccessibilityProfileRow = {
    id: newAccessibilityProfileId(),
    profileKey: normalizeKey(args.profileKey),
    name: normalizeRequired(args.name, 'name'),
    keyboardNavigation: args.keyboardNavigation ?? true,
    screenReaderSupport: args.screenReaderSupport ?? true,
    highContrastMode: args.highContrastMode ?? false,
    fontScale: normalizeFontScale(args.fontScale ?? 1),
    colorScheme: args.colorScheme ?? 'system',
    themeProfileId: args.themeProfileId ?? null,
    checkResults: [],
    status: 'active',
    createdAt: now,
    updatedAt: now,
  }
  row.checkResults = await buildAccessibilityChecks(row)
  await db.insert(schema.accessibilityProfiles).values(row)
  return row
}

export async function listAccessibilityProfiles(args: {
  status?: 'active' | 'disabled'
  limit?: number
} = {}): Promise<AccessibilityProfileRow[]> {
  return db.query.accessibilityProfiles.findMany({
    where: args.status ? eq(schema.accessibilityProfiles.status, args.status) : undefined,
    orderBy: [asc(schema.accessibilityProfiles.profileKey)],
    limit: Math.min(Math.max(args.limit ?? 100, 1), 500),
  })
}

export async function evaluateAccessibilityProfile(profileId: string): Promise<{
  profile: AccessibilityProfileRow
  summary: {
    total: number
    passing: number
    failing: number
  }
}> {
  const existing = await db.query.accessibilityProfiles.findFirst({
    where: eq(schema.accessibilityProfiles.id, profileId),
  })
  if (!existing) throw new Error(`Accessibility profile not found: ${profileId}`)
  const checkResults = await buildAccessibilityChecks(existing)
  const profile: AccessibilityProfileRow = {
    ...existing,
    checkResults,
    updatedAt: Date.now(),
  }
  await db
    .update(schema.accessibilityProfiles)
    .set({ checkResults: profile.checkResults, updatedAt: profile.updatedAt })
    .where(eq(schema.accessibilityProfiles.id, profile.id))
  return {
    profile,
    summary: {
      total: checkResults.length,
      passing: checkResults.filter((check) => check.passed === true).length,
      failing: checkResults.filter((check) => check.passed !== true).length,
    },
  }
}

async function buildAccessibilityChecks(profile: AccessibilityProfileRow): Promise<JsonObject[]> {
  const shortcuts = await seedKeyboardShortcuts()
  const themes = await seedThemeProfiles()
  const highContrastTheme = themes.find((theme) => theme.presetKey === 'highContrast')
  const lightTheme = themes.find((theme) => theme.presetKey === 'light')
  const darkTheme = themes.find((theme) => theme.presetKey === 'dark')
  return [
    check('keyboard_navigation', profile.keyboardNavigation && shortcuts.length > 0, {
      shortcutCount: shortcuts.length,
      globalShortcutCount: shortcuts.filter((row) => row.scope === 'global').length,
      requirement: 'Keyboard navigation is backed by active shortcut registry entries.',
    }),
    check('screen_reader_support', profile.screenReaderSupport, {
      semanticHtmlRequired: true,
      ariaNamesRequired: true,
      liveRegionCompatible: true,
      requirement: 'Screen-reader mode requires semantic HTML, ARIA names, and non-visual labels.',
    }),
    check('high_contrast_mode', Boolean(highContrastTheme), {
      enabledForProfile: profile.highContrastMode,
      themeProfileId: highContrastTheme?.id ?? null,
      requirement: 'A highContrast theme preset must be available.',
    }),
    check('font_size_adjustment', profile.fontScale >= 0.85 && profile.fontScale <= 1.6, {
      fontScale: profile.fontScale,
      cssVariable: '--a11y-font-scale',
      requirement: 'Font scale is configurable inside the supported range.',
    }),
    check('color_scheme', Boolean(lightTheme && darkTheme), {
      selected: profile.colorScheme,
      supported: ['system', 'light', 'dark'],
      lightThemeId: lightTheme?.id ?? null,
      darkThemeId: darkTheme?.id ?? null,
      requirement: 'Light, dark, and system-following color schemes are supported.',
    }),
  ]
}

function check(key: AccessibilityRequirementKey, passed: boolean, evidence: JsonObject): JsonObject {
  return {
    key,
    passed,
    evidence,
  }
}

function normalizeRequired(value: string, field: string): string {
  const trimmed = value.trim()
  if (!trimmed) throw new Error(`${field} is required`)
  return trimmed
}

function normalizeKey(value: string): string {
  return normalizeRequired(value, 'profileKey')
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '')
}

function normalizeFontScale(value: number): number {
  if (value < 0.85 || value > 1.6) throw new Error('fontScale must be between 0.85 and 1.6')
  return Number(value.toFixed(2))
}
