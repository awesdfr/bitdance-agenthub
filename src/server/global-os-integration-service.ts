import { and, desc, eq, type SQL } from 'drizzle-orm'

import { db, schema } from '@/db/client'
import type {
  GlobalOSIntegrationAction,
  GlobalOSIntegrationDecision,
  GlobalOSIntegrationEvaluationRow,
  GlobalOSIntegrationInput,
  GlobalOSIntegrationPolicy,
  GlobalOSIntegrationPolicyRow,
  GlobalOSIntegrationStatus,
} from '@/db/schema'
import { newGlobalOSIntegrationEvaluationId, newGlobalOSIntegrationPolicyId } from '@/server/ids'

export interface EvaluateGlobalOSIntegrationArgs extends GlobalOSIntegrationInput {
  policyId?: string
}

export interface GlobalOSIntegrationEvaluationResult {
  policy: GlobalOSIntegrationPolicyRow
  evaluation: GlobalOSIntegrationEvaluationRow
  summary: {
    decisionCount: number
    needsUser: number
    warnings: number
    actions: GlobalOSIntegrationAction[]
  }
}

const DEFAULT_POLICY_NAME = 'Default global OS integration safety policy'

const defaultPolicy: GlobalOSIntegrationPolicy = {
  clipboard: {
    preferVirtualClipboard: true,
    preferDirectInputDispatch: true,
    allowSystemClipboardWithBackup: true,
    maxSystemClipboardUseMs: 5000,
  },
  focus: {
    preferHeadless: true,
    preferBackground: true,
    recentUserInputThresholdMs: 30000,
    foregroundDelayWhenUserActive: true,
  },
  nativeDialogs: {
    filePickerStrategy: 'inject_file_input',
    printStrategy: 'use_pdf_generation_api',
    colorPickerStrategy: 'use_css_color_injection',
    unknownDialogStrategy: 'mark_needs_user',
  },
}

export async function seedGlobalOSIntegrationPolicy(): Promise<GlobalOSIntegrationPolicyRow> {
  const existing = await db.query.globalOSIntegrationPolicies.findFirst({
    where: eq(schema.globalOSIntegrationPolicies.name, DEFAULT_POLICY_NAME),
  })
  if (existing) return existing
  const now = Date.now()
  const row: GlobalOSIntegrationPolicyRow = {
    id: newGlobalOSIntegrationPolicyId(),
    name: DEFAULT_POLICY_NAME,
    policy: defaultPolicy,
    status: 'active',
    createdAt: now,
    updatedAt: now,
  }
  await db.insert(schema.globalOSIntegrationPolicies).values(row)
  return row
}

export async function listGlobalOSIntegrationPolicies(args: {
  status?: GlobalOSIntegrationPolicyRow['status']
  limit?: number
} = {}): Promise<GlobalOSIntegrationPolicyRow[]> {
  const filters: SQL[] = []
  if (args.status) filters.push(eq(schema.globalOSIntegrationPolicies.status, args.status))
  return db.query.globalOSIntegrationPolicies.findMany({
    where: filters.length ? and(...filters) : undefined,
    orderBy: [desc(schema.globalOSIntegrationPolicies.updatedAt)],
    limit: Math.min(Math.max(args.limit ?? 25, 1), 100),
  })
}

export async function evaluateGlobalOSIntegration(
  args: EvaluateGlobalOSIntegrationArgs,
): Promise<GlobalOSIntegrationEvaluationResult> {
  const policy = args.policyId
    ? await getRequiredPolicy(args.policyId)
    : await seedGlobalOSIntegrationPolicy()
  if (policy.status !== 'active') throw new Error(`Global OS integration policy is ${policy.status}: ${policy.id}`)

  const input = normalizeInput(args)
  const decisions = collectDecisions(input, policy.policy)
  const actions = uniqueActions(decisions)
  if (!actions.length) actions.push('continue')
  const status = statusFromDecisions(decisions)
  const evaluation: GlobalOSIntegrationEvaluationRow = {
    id: newGlobalOSIntegrationEvaluationId(),
    policyId: policy.id,
    input,
    decisions,
    actions,
    status,
    recommendation: recommendationFor(status, actions),
    createdAt: Date.now(),
  }
  await db.insert(schema.globalOSIntegrationEvaluations).values(evaluation)
  return {
    policy,
    evaluation,
    summary: {
      decisionCount: decisions.length,
      needsUser: decisions.filter((decision) => decision.severity === 'needs_user').length,
      warnings: decisions.filter((decision) => decision.severity === 'warning').length,
      actions,
    },
  }
}

export async function listGlobalOSIntegrationEvaluations(args: {
  status?: GlobalOSIntegrationStatus
  limit?: number
} = {}): Promise<GlobalOSIntegrationEvaluationRow[]> {
  const filters: SQL[] = []
  if (args.status) filters.push(eq(schema.globalOSIntegrationEvaluations.status, args.status))
  return db.query.globalOSIntegrationEvaluations.findMany({
    where: filters.length ? and(...filters) : undefined,
    orderBy: [desc(schema.globalOSIntegrationEvaluations.createdAt)],
    limit: Math.min(Math.max(args.limit ?? 50, 1), 200),
  })
}

function normalizeInput(args: EvaluateGlobalOSIntegrationArgs): GlobalOSIntegrationInput {
  return {
    operation: args.operation,
    requiresSystemClipboard: args.requiresSystemClipboard,
    canUseVirtualClipboard: args.canUseVirtualClipboard,
    canDispatchDirectInput: args.canDispatchDirectInput,
    foregroundRequired: args.foregroundRequired,
    headlessAvailable: args.headlessAvailable,
    backgroundAvailable: args.backgroundAvailable,
    userIdleMs: Math.max(args.userIdleMs ?? 0, 0),
    nativeDialogKind: args.nativeDialogKind,
    canInjectFileInput: args.canInjectFileInput,
    canUsePdfApi: args.canUsePdfApi,
    canUseCssInjection: args.canUseCssInjection,
  }
}

function collectDecisions(
  input: GlobalOSIntegrationInput,
  policy: GlobalOSIntegrationPolicy,
): GlobalOSIntegrationDecision[] {
  if (input.operation === 'clipboard') return clipboardDecisions(input, policy)
  if (input.operation === 'window_focus') return focusDecisions(input, policy)
  return nativeDialogDecisions(input, policy)
}

function clipboardDecisions(
  input: GlobalOSIntegrationInput,
  policy: GlobalOSIntegrationPolicy,
): GlobalOSIntegrationDecision[] {
  const decisions: GlobalOSIntegrationDecision[] = []
  if (policy.clipboard.preferVirtualClipboard && input.canUseVirtualClipboard) {
    decisions.push(decision(
      'clipboard_can_be_virtualized',
      'info',
      'Use an Agent virtual clipboard instead of touching the system clipboard.',
      'use_virtual_clipboard',
    ))
  }
  if (policy.clipboard.preferDirectInputDispatch && input.canDispatchDirectInput) {
    decisions.push(decision(
      'clipboard_can_be_virtualized',
      'info',
      'Use direct input dispatch instead of Ctrl+C/Ctrl+V where possible.',
      'dispatch_direct_input',
    ))
  }
  if (input.requiresSystemClipboard && policy.clipboard.allowSystemClipboardWithBackup) {
    decisions.push(decision(
      'system_clipboard_required',
      'warning',
      `System clipboard is required; backup and restore it within ${policy.clipboard.maxSystemClipboardUseMs}ms.`,
      'backup_and_restore_clipboard',
    ))
  } else if (input.requiresSystemClipboard) {
    decisions.push(decision(
      'system_clipboard_required',
      'needs_user',
      'System clipboard use is required but not allowed by policy.',
      'ask_user_assistance',
    ))
  }
  return decisions
}

function focusDecisions(
  input: GlobalOSIntegrationInput,
  policy: GlobalOSIntegrationPolicy,
): GlobalOSIntegrationDecision[] {
  const decisions: GlobalOSIntegrationDecision[] = []
  if (policy.focus.preferHeadless && input.headlessAvailable) {
    decisions.push(decision(
      'headless_available',
      'info',
      'Run the browser/workflow headless to avoid stealing user focus.',
      'run_headless',
    ))
  } else if (policy.focus.preferBackground && input.backgroundAvailable) {
    decisions.push(decision(
      'foreground_required',
      'info',
      'Run the automation in the background or minimized where supported.',
      'run_in_background',
    ))
  }
  if (
    input.foregroundRequired &&
    policy.focus.foregroundDelayWhenUserActive &&
    (input.userIdleMs ?? 0) < policy.focus.recentUserInputThresholdMs
  ) {
    decisions.push(decision(
      'user_active_focus_risk',
      'warning',
      `User input was seen ${input.userIdleMs ?? 0}ms ago; delay foreground automation.`,
      'delay_until_user_idle',
    ))
  }
  if (input.foregroundRequired && !input.headlessAvailable && !input.backgroundAvailable) {
    decisions.push(decision(
      'foreground_required',
      'needs_user',
      'Foreground automation is required; ask before taking focus.',
      'ask_user_assistance',
    ))
  }
  return decisions
}

function nativeDialogDecisions(
  input: GlobalOSIntegrationInput,
  policy: GlobalOSIntegrationPolicy,
): GlobalOSIntegrationDecision[] {
  if (input.nativeDialogKind === 'file_picker') {
    return [
      decision(
        'native_file_picker',
        input.canInjectFileInput ? 'warning' : 'needs_user',
        'Native file picker should be bypassed with controlled file-input injection when possible.',
        input.canInjectFileInput && policy.nativeDialogs.filePickerStrategy === 'inject_file_input'
          ? 'inject_file_input'
          : 'ask_user_assistance',
      ),
    ]
  }
  if (input.nativeDialogKind === 'print_dialog') {
    return [
      decision(
        'native_print_dialog',
        input.canUsePdfApi ? 'warning' : 'needs_user',
        'Native print dialog should be replaced with a PDF generation API where possible.',
        input.canUsePdfApi && policy.nativeDialogs.printStrategy === 'use_pdf_generation_api'
          ? 'use_pdf_generation_api'
          : 'ask_user_assistance',
      ),
    ]
  }
  if (input.nativeDialogKind === 'color_picker') {
    return [
      decision(
        'native_color_picker',
        input.canUseCssInjection ? 'warning' : 'needs_user',
        'Native color picker should be replaced with CSS value injection where possible.',
        input.canUseCssInjection && policy.nativeDialogs.colorPickerStrategy === 'use_css_color_injection'
          ? 'use_css_color_injection'
          : 'ask_user_assistance',
      ),
    ]
  }
  return [
    decision(
      'native_dialog_unknown',
      'needs_user',
      'Unknown native dialog cannot be safely automated.',
      policy.nativeDialogs.unknownDialogStrategy,
    ),
  ]
}

function decision(
  signal: GlobalOSIntegrationDecision['signal'],
  severity: GlobalOSIntegrationDecision['severity'],
  message: string,
  action: GlobalOSIntegrationAction,
): GlobalOSIntegrationDecision {
  return { signal, severity, message, action }
}

function uniqueActions(decisions: GlobalOSIntegrationDecision[]): GlobalOSIntegrationAction[] {
  return Array.from(new Set(decisions.map((decision) => decision.action)))
}

function statusFromDecisions(decisions: GlobalOSIntegrationDecision[]): GlobalOSIntegrationStatus {
  if (decisions.some((decision) => decision.severity === 'blocked' || decision.action === 'mark_needs_user')) {
    return 'blocked'
  }
  if (decisions.some((decision) => decision.severity === 'needs_user' || decision.action === 'ask_user_assistance')) {
    return 'needs_user'
  }
  if (decisions.some((decision) => decision.action === 'delay_until_user_idle')) return 'delayed'
  return 'safe'
}

function recommendationFor(
  status: GlobalOSIntegrationStatus,
  actions: GlobalOSIntegrationAction[],
): string {
  if (status === 'safe') return 'OS integration check is safe; use virtualized or background paths where available.'
  if (status === 'delayed') return 'Delay foreground automation until the user has been idle long enough.'
  if (actions.includes('backup_and_restore_clipboard')) return 'Backup and restore the clipboard if system clipboard use is unavoidable.'
  if (actions.includes('inject_file_input')) return 'Use controlled file-input injection instead of automating the native file picker.'
  if (actions.includes('use_pdf_generation_api')) return 'Use a PDF generation API instead of the native print dialog.'
  if (actions.includes('use_css_color_injection')) return 'Inject CSS color values instead of automating the native color picker.'
  return 'Ask the user for help before touching global OS state.'
}

async function getRequiredPolicy(id: string): Promise<GlobalOSIntegrationPolicyRow> {
  const row = await db.query.globalOSIntegrationPolicies.findFirst({
    where: eq(schema.globalOSIntegrationPolicies.id, id),
  })
  if (!row) throw new Error(`Global OS integration policy not found: ${id}`)
  return row
}
