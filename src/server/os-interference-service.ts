import { and, desc, eq, type SQL } from 'drizzle-orm'

import { db, schema } from '@/db/client'
import type {
  OSInterferenceAction,
  OSInterferenceEventRow,
  OSInterferenceEventStatus,
  OSInterferenceMonitorSnapshot,
  OSInterferencePolicy,
  OSInterferencePolicyRow,
  OSInterferenceSignal,
  OSInterferenceSourceType,
} from '@/db/schema'
import { newOSInterferenceEventId, newOSInterferencePolicyId } from '@/server/ids'

export interface EvaluateOSInterferenceArgs {
  policyId?: string
  signal?: OSInterferenceSignal
  sourceType?: OSInterferenceSourceType
  monitors: OSInterferenceMonitorSnapshot
}

export interface OSInterferenceEvaluation {
  policy: OSInterferencePolicyRow
  event: OSInterferenceEventRow
  preventionChecklist: string[]
}

const DEFAULT_POLICY_NAME = 'Default Windows OS interference policy'

const defaultPolicy: OSInterferencePolicy = {
  onScreenLocked: 'pause_all_agents',
  onUacPrompt: 'notify_user',
  onSystemDialog: 'take_screenshot_and_ask',
  onLowBattery: 'pause_all_agents',
  onRemoteSession: 'pause_ui_agents',
  nativeFilePickerStrategy: 'use_cli_or_api_instead',
}

const defaultPreventionChecklist = [
  'Prefer headless browser or virtual display for automation that should not depend on the physical screen.',
  'Route native file-picker workflows through CLI/API file paths instead of clicking OS dialogs.',
  'Keep core Agent runtime able to run without an unlocked interactive desktop session.',
  'Before long desktop runs, warn about updates, low battery, firewall prompts, and disk-space pressure.',
]

export async function seedOSInterferencePolicy(): Promise<OSInterferencePolicyRow> {
  const existing = await db.query.osInterferencePolicies.findFirst({
    where: eq(schema.osInterferencePolicies.name, DEFAULT_POLICY_NAME),
  })
  if (existing) return existing
  const now = Date.now()
  const row: OSInterferencePolicyRow = {
    id: newOSInterferencePolicyId(),
    name: DEFAULT_POLICY_NAME,
    policy: defaultPolicy,
    preventionChecklist: defaultPreventionChecklist,
    status: 'active',
    createdAt: now,
    updatedAt: now,
  }
  await db.insert(schema.osInterferencePolicies).values(row)
  return row
}

export async function listOSInterferencePolicies(args: {
  status?: OSInterferencePolicyRow['status']
  limit?: number
} = {}): Promise<OSInterferencePolicyRow[]> {
  const filters: SQL[] = []
  if (args.status) filters.push(eq(schema.osInterferencePolicies.status, args.status))
  return db.query.osInterferencePolicies.findMany({
    where: filters.length ? and(...filters) : undefined,
    orderBy: [desc(schema.osInterferencePolicies.updatedAt)],
    limit: Math.min(Math.max(args.limit ?? 25, 1), 100),
  })
}

export async function evaluateOSInterference(
  args: EvaluateOSInterferenceArgs,
): Promise<OSInterferenceEvaluation> {
  const policy = args.policyId
    ? await getRequiredPolicy(args.policyId)
    : await seedOSInterferencePolicy()
  if (policy.status !== 'active') throw new Error(`OS interference policy is ${policy.status}: ${policy.id}`)

  const signal = args.signal ?? detectSignal(args.monitors)
  const sourceType = args.sourceType ?? sourceTypeForSignal(signal)
  const action = actionForSignal(signal, policy.policy)
  const status = statusForAction(signal, action)
  const event: OSInterferenceEventRow = {
    id: newOSInterferenceEventId(),
    policyId: policy.id,
    signal,
    sourceType,
    monitorSnapshot: args.monitors,
    action,
    status,
    recommendation: recommendationFor(signal, action),
    evidenceRefs: evidenceFor(signal),
    createdAt: Date.now(),
  }
  await db.insert(schema.osInterferenceEvents).values(event)
  return { policy, event, preventionChecklist: policy.preventionChecklist }
}

export async function listOSInterferenceEvents(args: {
  signal?: OSInterferenceSignal
  status?: OSInterferenceEventStatus
  limit?: number
} = {}): Promise<OSInterferenceEventRow[]> {
  const filters: SQL[] = []
  if (args.signal) filters.push(eq(schema.osInterferenceEvents.signal, args.signal))
  if (args.status) filters.push(eq(schema.osInterferenceEvents.status, args.status))
  return db.query.osInterferenceEvents.findMany({
    where: filters.length ? and(...filters) : undefined,
    orderBy: [desc(schema.osInterferenceEvents.createdAt)],
    limit: Math.min(Math.max(args.limit ?? 50, 1), 200),
  })
}

function detectSignal(monitors: OSInterferenceMonitorSnapshot): OSInterferenceSignal {
  if (monitors.uacPromptVisible) return 'uac_prompt'
  if (monitors.nativeFilePickerVisible) return 'native_file_picker'
  if (monitors.screenLocked) return 'screen_locked'
  if (monitors.screenSaverActive) return 'screen_saver'
  if (monitors.rdpDisconnected || monitors.remoteSessionActive === false) return 'rdp_disconnected'
  if (monitors.remoteSessionActive === true) return 'rdp_reconnected'
  if (monitors.powerState === 'critical' || monitors.powerState === 'low_battery') return 'low_battery'
  if (monitors.diskSpaceLow) return 'disk_space_low'
  if (monitors.systemDialogDetected) return dialogSignal(monitors.applicationDialog)
  return 'none'
}

function dialogSignal(dialog: string | undefined): OSInterferenceSignal {
  const normalized = dialog?.toLowerCase() ?? ''
  if (/save/.test(normalized)) return 'save_changes_dialog'
  if (/update/.test(normalized)) return 'app_update_dialog'
  if (/modified|reload/.test(normalized)) return 'file_modified_dialog'
  if (/print/.test(normalized)) return 'print_dialog'
  if (/crash|report/.test(normalized)) return 'crash_report_dialog'
  if (/firewall/.test(normalized)) return 'firewall_prompt'
  if (/system update|restart/.test(normalized)) return 'system_update_prompt'
  return 'crash_report_dialog'
}

function sourceTypeForSignal(signal: OSInterferenceSignal): OSInterferenceSourceType {
  if (
    signal === 'uac_prompt' ||
    signal === 'firewall_prompt' ||
    signal === 'system_update_prompt' ||
    signal === 'low_battery' ||
    signal === 'disk_space_low'
  ) {
    return 'system_popup'
  }
  if (
    signal === 'screen_saver' ||
    signal === 'screen_locked' ||
    signal === 'display_sleep' ||
    signal === 'fast_user_switch' ||
    signal === 'rdp_disconnected' ||
    signal === 'rdp_reconnected' ||
    signal === 'none'
  ) {
    return 'screen_state'
  }
  return 'application_popup'
}

function actionForSignal(signal: OSInterferenceSignal, policy: OSInterferencePolicy): OSInterferenceAction {
  if (signal === 'none' || signal === 'rdp_reconnected') return 'continue'
  if (signal === 'screen_locked' || signal === 'screen_saver' || signal === 'display_sleep') {
    return policy.onScreenLocked
  }
  if (signal === 'uac_prompt') return policy.onUacPrompt
  if (signal === 'low_battery') return policy.onLowBattery
  if (signal === 'rdp_disconnected' || signal === 'fast_user_switch') return policy.onRemoteSession
  if (signal === 'native_file_picker') return policy.nativeFilePickerStrategy
  if (signal === 'disk_space_low' || signal === 'firewall_prompt' || signal === 'system_update_prompt') {
    return 'notify_user'
  }
  return policy.onSystemDialog
}

function statusForAction(
  signal: OSInterferenceSignal,
  action: OSInterferenceAction,
): OSInterferenceEventStatus {
  if (signal === 'none' || action === 'continue') return 'handled'
  if (action === 'notify_user' || action === 'take_screenshot_and_ask' || action === 'escalate') {
    return 'needs_user'
  }
  if (signal === 'uac_prompt' || signal === 'screen_locked') return 'blocked'
  return 'handled'
}

function recommendationFor(signal: OSInterferenceSignal, action: OSInterferenceAction): string {
  if (signal === 'none') return 'No OS-level interference detected; continue normal Agent execution.'
  if (signal === 'native_file_picker') return 'Bypass the native dialog and pass the target file path through CLI or API.'
  if (signal === 'uac_prompt') return 'Agent cannot click UAC safely; pause and ask the user to handle elevation.'
  if (signal === 'screen_locked') return 'Pause UI/desktop Agents until the session is unlocked or continue only headless work.'
  if (signal === 'rdp_disconnected') return 'Pause UI Agents and keep headless/browser/CLI work only if the task permits it.'
  if (signal === 'low_battery') return 'Pause or hibernate Agents before long-running desktop operations continue.'
  if (signal === 'disk_space_low') return 'Notify the user and avoid generating large artifacts until free space is restored.'
  return `Apply ${action} and capture enough evidence before retrying the desktop step.`
}

function evidenceFor(signal: OSInterferenceSignal): string[] {
  if (signal === 'none') return ['monitors.no_interference']
  return [
    'docs/reference/os-interference.md',
    `signal:${signal}`,
    'section_89_record_only_desktop_safety',
  ]
}

async function getRequiredPolicy(id: string): Promise<OSInterferencePolicyRow> {
  const row = await db.query.osInterferencePolicies.findFirst({
    where: eq(schema.osInterferencePolicies.id, id),
  })
  if (!row) throw new Error(`OS interference policy not found: ${id}`)
  return row
}
