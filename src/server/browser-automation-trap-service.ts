import { and, desc, eq, type SQL } from 'drizzle-orm'

import { db, schema } from '@/db/client'
import type {
  BrowserAutomationSignal,
  BrowserAutomationTrapAction,
  BrowserAutomationTrapEvaluationRow,
  BrowserAutomationTrapInput,
  BrowserAutomationTrapPolicy,
  BrowserAutomationTrapPolicyRow,
  BrowserAutomationTrapRisk,
  BrowserAutomationTrapStatus,
} from '@/db/schema'
import { newBrowserAutomationTrapEvaluationId, newBrowserAutomationTrapPolicyId } from '@/server/ids'

export interface EvaluateBrowserAutomationTrapsArgs extends BrowserAutomationTrapInput {
  policyId?: string
}

export interface BrowserAutomationTrapEvaluationResult {
  policy: BrowserAutomationTrapPolicyRow
  evaluation: BrowserAutomationTrapEvaluationRow
  summary: {
    riskCount: number
    needsUser: number
    warnings: number
    actions: BrowserAutomationTrapAction[]
  }
}

const DEFAULT_POLICY_NAME = 'Default browser automation trap policy'

const defaultPolicy: BrowserAutomationTrapPolicy = {
  extensionPolicy: {
    cleanProfileRequired: true,
    disableExtensionsByDefault: true,
    knownInterferingExtensions: [
      'adblock',
      'ublock',
      'adguard',
      'lastpass',
      '1password',
      'bitwarden',
      'google translate',
      'deepl',
      'grammarly',
    ],
  },
  renderingPolicy: {
    zoomPercent: 100,
    viewport: { width: 1280, height: 720 },
    deviceScaleFactor: 1,
    comparisonStrategy: 'ssim',
    locatorPreference: 'selector_first',
    colorScheme: 'light',
  },
  botDetectionPolicy: {
    onCaptcha: 'pause_and_notify_user',
    allowThirdPartySolvers: false,
    allowSessionReuseWithApproval: true,
    minHumanDelayMs: 400,
    maxHumanDelayMs: 1800,
    bypassProhibited: true,
  },
}

export async function seedBrowserAutomationTrapPolicy(): Promise<BrowserAutomationTrapPolicyRow> {
  const existing = await db.query.browserAutomationTrapPolicies.findFirst({
    where: eq(schema.browserAutomationTrapPolicies.name, DEFAULT_POLICY_NAME),
  })
  if (existing) return existing
  const now = Date.now()
  const row: BrowserAutomationTrapPolicyRow = {
    id: newBrowserAutomationTrapPolicyId(),
    name: DEFAULT_POLICY_NAME,
    policy: defaultPolicy,
    status: 'active',
    createdAt: now,
    updatedAt: now,
  }
  await db.insert(schema.browserAutomationTrapPolicies).values(row)
  return row
}

export async function listBrowserAutomationTrapPolicies(args: {
  status?: BrowserAutomationTrapPolicyRow['status']
  limit?: number
} = {}): Promise<BrowserAutomationTrapPolicyRow[]> {
  const filters: SQL[] = []
  if (args.status) filters.push(eq(schema.browserAutomationTrapPolicies.status, args.status))
  return db.query.browserAutomationTrapPolicies.findMany({
    where: filters.length ? and(...filters) : undefined,
    orderBy: [desc(schema.browserAutomationTrapPolicies.updatedAt)],
    limit: Math.min(Math.max(args.limit ?? 25, 1), 100),
  })
}

export async function evaluateBrowserAutomationTraps(
  args: EvaluateBrowserAutomationTrapsArgs,
): Promise<BrowserAutomationTrapEvaluationResult> {
  const policy = args.policyId
    ? await getRequiredPolicy(args.policyId)
    : await seedBrowserAutomationTrapPolicy()
  if (policy.status !== 'active') throw new Error(`Browser automation trap policy is ${policy.status}: ${policy.id}`)

  const input = normalizeInput(args)
  const risks = collectRisks(input, policy.policy)
  const actions = uniqueActions(risks, policy.policy)
  if (!actions.length) actions.push('continue')
  const status = statusFromRisks(risks)
  const evaluation: BrowserAutomationTrapEvaluationRow = {
    id: newBrowserAutomationTrapEvaluationId(),
    policyId: policy.id,
    input,
    risks,
    actions,
    status,
    recommendation: recommendationFor(status, risks, actions, policy.policy),
    createdAt: Date.now(),
  }
  await db.insert(schema.browserAutomationTrapEvaluations).values(evaluation)
  return {
    policy,
    evaluation,
    summary: {
      riskCount: risks.length,
      needsUser: risks.filter((risk) => risk.severity === 'needs_user').length,
      warnings: risks.filter((risk) => risk.severity === 'warning').length,
      actions,
    },
  }
}

export async function listBrowserAutomationTrapEvaluations(args: {
  status?: BrowserAutomationTrapStatus
  limit?: number
} = {}): Promise<BrowserAutomationTrapEvaluationRow[]> {
  const filters: SQL[] = []
  if (args.status) filters.push(eq(schema.browserAutomationTrapEvaluations.status, args.status))
  return db.query.browserAutomationTrapEvaluations.findMany({
    where: filters.length ? and(...filters) : undefined,
    orderBy: [desc(schema.browserAutomationTrapEvaluations.createdAt)],
    limit: Math.min(Math.max(args.limit ?? 50, 1), 200),
  })
}

function normalizeInput(args: EvaluateBrowserAutomationTrapsArgs): BrowserAutomationTrapInput {
  return {
    extensionsDetected: args.extensionsDetected?.map((name) => name.trim()).filter(Boolean) ?? [],
    browserZoom: args.browserZoom,
    deviceScaleFactor: args.deviceScaleFactor,
    viewport: args.viewport,
    colorScheme: args.colorScheme,
    gpuAcceleration: args.gpuAcceleration,
    captchaDetected: args.captchaDetected,
    botDetectionMessage: args.botDetectionMessage,
    locatorStrategy: args.locatorStrategy,
    screenshotComparison: args.screenshotComparison,
  }
}

function collectRisks(
  input: BrowserAutomationTrapInput,
  policy: BrowserAutomationTrapPolicy,
): BrowserAutomationTrapRisk[] {
  const risks: BrowserAutomationTrapRisk[] = []
  for (const extension of input.extensionsDetected ?? []) {
    risks.push({
      type: 'extension_interference',
      signal: extensionSignal(extension),
      severity: 'warning',
      message: `Detected browser extension "${extension}" that can hide elements, inject UI, or mutate page text.`,
      action: policy.extensionPolicy.cleanProfileRequired ? 'use_clean_profile' : 'disable_extensions',
    })
  }

  if (input.browserZoom !== undefined && input.browserZoom !== policy.renderingPolicy.zoomPercent) {
    risks.push(renderingRisk(
      'browser_zoom',
      `Browser zoom ${input.browserZoom}% differs from the required ${policy.renderingPolicy.zoomPercent}%.`,
      'set_zoom_100',
    ))
  }
  if (
    input.deviceScaleFactor !== undefined &&
    input.deviceScaleFactor !== policy.renderingPolicy.deviceScaleFactor
  ) {
    risks.push(renderingRisk(
      'dpi_scaling',
      `Device scale factor ${input.deviceScaleFactor} can make OCR and screenshots drift.`,
      'set_fixed_viewport',
    ))
  }
  if (
    input.viewport &&
    (input.viewport.width !== policy.renderingPolicy.viewport.width ||
      input.viewport.height !== policy.renderingPolicy.viewport.height)
  ) {
    risks.push(renderingRisk(
      'dpi_scaling',
      `Viewport ${input.viewport.width}x${input.viewport.height} differs from fixed ${policy.renderingPolicy.viewport.width}x${policy.renderingPolicy.viewport.height}.`,
      'set_fixed_viewport',
    ))
  }
  if (input.colorScheme && input.colorScheme !== policy.renderingPolicy.colorScheme) {
    risks.push(renderingRisk(
      'dark_mode',
      `Color scheme ${input.colorScheme} can change screenshots and OCR results.`,
      'set_fixed_viewport',
    ))
  }
  if (input.gpuAcceleration) {
    risks.push(renderingRisk(
      'gpu_rendering',
      'GPU rendering can change pixel-level screenshots across machines.',
      'use_ssim_comparison',
    ))
  }
  if (input.screenshotComparison === 'pixel') {
    risks.push(renderingRisk(
      'pixel_comparison',
      'Pixel-perfect screenshot comparison is brittle across font, DPI, color profile, and GPU differences.',
      'use_ssim_comparison',
    ))
  }
  if (input.locatorStrategy === 'image' || input.locatorStrategy === 'ocr') {
    risks.push(renderingRisk(
      'image_locator_only',
      'Image/OCR-only locators should be fallback paths after CSS selector or XPath checks.',
      'prefer_selector_locator',
    ))
  }

  const captchaSignal = captchaSignalFor(input.captchaDetected)
  if (captchaSignal !== 'none') {
    risks.push({
      type: 'captcha_or_bot_detection',
      signal: captchaSignal,
      severity: 'needs_user',
      message: `Detected ${captchaSignal}; pause browser automation and ask the user to complete the challenge.`,
      action: policy.botDetectionPolicy.onCaptcha,
    })
  } else if (input.botDetectionMessage?.trim()) {
    risks.push({
      type: 'captcha_or_bot_detection',
      signal: 'bot_detection',
      severity: 'needs_user',
      message: `Detected bot-detection message: ${input.botDetectionMessage.trim()}`,
      action: policy.botDetectionPolicy.onCaptcha,
    })
  }

  return risks
}

function renderingRisk(
  signal: BrowserAutomationSignal,
  message: string,
  action: BrowserAutomationTrapAction,
): BrowserAutomationTrapRisk {
  return {
    type: 'rendering_difference',
    signal,
    severity: 'warning',
    message,
    action,
  }
}

function extensionSignal(extension: string): BrowserAutomationSignal {
  const normalized = extension.toLowerCase()
  if (/adblock|ublock|adguard/.test(normalized)) return 'ad_blocker_extension'
  if (/lastpass|1password|bitwarden|dashlane|password/.test(normalized)) return 'password_manager_extension'
  if (/translate|deepl/.test(normalized)) return 'translation_extension'
  if (/grammarly|writing|spell/.test(normalized)) return 'writing_assistant_extension'
  return 'unknown_extension'
}

function captchaSignalFor(
  captcha: BrowserAutomationTrapInput['captchaDetected'],
): BrowserAutomationSignal {
  if (captcha === 'cloudflare') return 'cloudflare_challenge'
  if (captcha === 'recaptcha') return 'recaptcha'
  if (captcha === 'hcaptcha') return 'hcaptcha'
  if (captcha === 'generic') return 'bot_detection'
  return 'none'
}

function uniqueActions(
  risks: BrowserAutomationTrapRisk[],
  policy: BrowserAutomationTrapPolicy,
): BrowserAutomationTrapAction[] {
  const actions = new Set<BrowserAutomationTrapAction>(risks.map((risk) => risk.action))
  if (risks.some((risk) => risk.type === 'extension_interference') && policy.extensionPolicy.disableExtensionsByDefault) {
    actions.add('disable_extensions')
  }
  if (
    risks.some((risk) => risk.type === 'captcha_or_bot_detection') &&
    policy.botDetectionPolicy.allowSessionReuseWithApproval
  ) {
    actions.add('reuse_session_after_user_approval')
  }
  return Array.from(actions)
}

function statusFromRisks(risks: BrowserAutomationTrapRisk[]): BrowserAutomationTrapStatus {
  if (risks.some((risk) => risk.severity === 'blocked')) return 'blocked'
  if (risks.some((risk) => risk.severity === 'needs_user')) return 'needs_user'
  if (risks.some((risk) => risk.severity === 'warning')) return 'warning'
  return 'safe'
}

function recommendationFor(
  status: BrowserAutomationTrapStatus,
  risks: BrowserAutomationTrapRisk[],
  actions: BrowserAutomationTrapAction[],
  policy: BrowserAutomationTrapPolicy,
): string {
  if (!risks.length) return 'No browser automation trap detected; continue with the current clean browser session.'
  if (status === 'needs_user') {
    return policy.botDetectionPolicy.bypassProhibited
      ? 'Pause and notify the user. Do not bypass CAPTCHA or bot-detection challenges.'
      : 'Pause and notify the user before any challenge handling.'
  }
  if (actions.includes('use_clean_profile')) {
    return 'Switch to an isolated Agent browser profile with extensions disabled before retrying.'
  }
  if (actions.includes('use_ssim_comparison')) {
    return 'Normalize zoom/viewport and prefer SSIM or structural assertions over pixel-perfect screenshots.'
  }
  return 'Apply the browser stabilization actions before retrying the automation step.'
}

async function getRequiredPolicy(id: string): Promise<BrowserAutomationTrapPolicyRow> {
  const row = await db.query.browserAutomationTrapPolicies.findFirst({
    where: eq(schema.browserAutomationTrapPolicies.id, id),
  })
  if (!row) throw new Error(`Browser automation trap policy not found: ${id}`)
  return row
}
