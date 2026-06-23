import { asc, desc, eq } from 'drizzle-orm'

import { db, schema } from '@/db/client'
import type {
  JsonObject,
  SecurityAuditCadence,
  SecurityAuditChecklistItemRow,
  SecurityAuditItemStatus,
  SecurityAuditRunItemRow,
  SecurityAuditRunRow,
} from '@/db/schema'
import {
  newSecurityAuditChecklistItemId,
  newSecurityAuditRunId,
  newSecurityAuditRunItemId,
} from '@/server/ids'

interface DefaultSecurityAuditItem {
  cadence: SecurityAuditCadence
  itemKey: string
  category: string
  title: string
  description: string
  required?: boolean
}

const defaultSecurityAuditItems: DefaultSecurityAuditItem[] = [
  item('quarterly_or_major', 'dependency_audit', 'supply_chain', 'Dependency audit', 'Audit dependencies for known vulnerabilities.'),
  item('quarterly_or_major', 'hardcoded_secrets', 'secrets', 'Hardcoded secret scan', 'Search code/config for hardcoded credentials.'),
  item('quarterly_or_major', 'permission_bypass', 'permissions', 'Permission bypass review', 'Verify approval/autonomy checks cannot be bypassed.'),
  item('quarterly_or_major', 'sandbox_escape', 'sandbox', 'Sandbox escape review', 'Review filesystem, command, and network sandbox escape paths.'),
  item('quarterly_or_major', 'prompt_injection_full_suite', 'prompt_security', 'Prompt Injection full suite', 'Run the full prompt-injection regression suite.'),
  item('quarterly_or_major', 'content_scan_false_positive_negative', 'content_safety', 'Content scan FP/FN review', 'Review content scanning false positives and false negatives.'),
  item('quarterly_or_major', 'encryption_algorithm_review', 'encryption', 'Encryption algorithm review', 'Review local IPC, export, and transport encryption choices.'),
  item('quarterly_or_major', 'audit_log_integrity', 'audit_logs', 'Audit log integrity', 'Verify append-only integrity and coverage of sensitive actions.'),
  item('quarterly_or_major', 'data_export_delete_verification', 'data_lifecycle', 'Data export/delete verification', 'Verify data export and deletion behavior.'),
  item('quarterly_or_major', 'multi_user_isolation', 'isolation', 'Multi-user isolation', 'Verify user/team/workspace data isolation.'),
  item('quarterly_or_major', 'external_penetration_test', 'external_review', 'External penetration test', 'Record external penetration-test evidence or deferral.'),
  item('continuous', 'security_label', 'process', 'Security label', 'Apply security labels to security-impacting changes.'),
  item('continuous', 'vulnerability_disclosure_process', 'process', 'Vulnerability disclosure process', 'Maintain disclosure and triage process.'),
  item('continuous', 'cve_monitoring', 'supply_chain', 'CVE monitoring', 'Continuously monitor CVEs for dependencies and runtime components.'),
]

export function getDefaultSecurityAuditChecklistCount(): number {
  return defaultSecurityAuditItems.length
}

export async function seedSecurityAuditChecklist(): Promise<SecurityAuditChecklistItemRow[]> {
  const now = Date.now()
  for (const entry of defaultSecurityAuditItems) {
    const existing = await db.query.securityAuditChecklistItems.findFirst({
      where: eq(schema.securityAuditChecklistItems.itemKey, entry.itemKey),
    })
    if (existing) continue
    await db.insert(schema.securityAuditChecklistItems).values({
      id: newSecurityAuditChecklistItemId(),
      cadence: entry.cadence,
      itemKey: entry.itemKey,
      category: entry.category,
      title: entry.title,
      description: entry.description,
      required: entry.required ?? true,
      status: 'active',
      createdAt: now,
      updatedAt: now,
    })
  }
  return listSecurityAuditChecklistItems()
}

export async function listSecurityAuditChecklistItems(args: {
  cadence?: SecurityAuditCadence
} = {}): Promise<SecurityAuditChecklistItemRow[]> {
  return db.query.securityAuditChecklistItems.findMany({
    where: args.cadence ? eq(schema.securityAuditChecklistItems.cadence, args.cadence) : undefined,
    orderBy: [asc(schema.securityAuditChecklistItems.cadence), asc(schema.securityAuditChecklistItems.itemKey)],
    limit: 100,
  })
}

export async function runSecurityAudit(args: {
  cadence: Exclude<SecurityAuditCadence, 'quarterly_or_major'>
  releaseLabel?: string
  evidence?: JsonObject
}): Promise<{
  run: SecurityAuditRunRow
  items: SecurityAuditRunItemRow[]
}> {
  await seedSecurityAuditChecklist()
  const checklist = await checklistForRunCadence(args.cadence)
  const now = Date.now()
  const runId = newSecurityAuditRunId()
  const evaluated = checklist.map((entry) => evaluateChecklistItem(entry, args.evidence ?? {}))
  const summary = summarize(evaluated)
  const runStatus = summary.failed > 0 ? 'failed' : summary.pending > 0 ? 'draft' : 'completed'
  await db.insert(schema.securityAuditRuns).values({
    id: runId,
    cadence: args.cadence,
    releaseLabel: args.releaseLabel?.trim() ?? '',
    status: runStatus,
    summary,
    createdAt: now,
    completedAt: runStatus === 'draft' ? null : now,
  })
  const items: SecurityAuditRunItemRow[] = []
  for (const result of evaluated) {
    const row = {
      id: newSecurityAuditRunItemId(),
      runId,
      checklistItemId: result.item.id,
      itemKey: result.item.itemKey,
      status: result.status,
      evidence: result.evidence,
      notes: result.notes,
      createdAt: now,
      updatedAt: now,
    }
    await db.insert(schema.securityAuditRunItems).values(row)
    items.push(row)
  }
  const run = await getRequiredSecurityAuditRun(runId)
  return { run, items }
}

export async function listSecurityAuditRuns(args: {
  cadence?: SecurityAuditCadence
} = {}): Promise<SecurityAuditRunRow[]> {
  return db.query.securityAuditRuns.findMany({
    where: args.cadence ? eq(schema.securityAuditRuns.cadence, args.cadence) : undefined,
    orderBy: [desc(schema.securityAuditRuns.createdAt)],
    limit: 100,
  })
}

export async function listSecurityAuditRunItems(args: {
  runId?: string
} = {}): Promise<SecurityAuditRunItemRow[]> {
  return db.query.securityAuditRunItems.findMany({
    where: args.runId ? eq(schema.securityAuditRunItems.runId, args.runId) : undefined,
    orderBy: [asc(schema.securityAuditRunItems.createdAt)],
    limit: 200,
  })
}

async function getRequiredSecurityAuditRun(id: string): Promise<SecurityAuditRunRow> {
  const row = await db.query.securityAuditRuns.findFirst({
    where: eq(schema.securityAuditRuns.id, id),
  })
  if (!row) throw new Error(`Security audit run not found: ${id}`)
  return row
}

async function checklistForRunCadence(
  cadence: Exclude<SecurityAuditCadence, 'quarterly_or_major'>,
): Promise<SecurityAuditChecklistItemRow[]> {
  const all = await listSecurityAuditChecklistItems()
  return all.filter((item) => {
    if (cadence === 'continuous') return item.cadence === 'continuous'
    return item.cadence === 'quarterly_or_major' || item.cadence === cadence
  })
}

function evaluateChecklistItem(
  item: SecurityAuditChecklistItemRow,
  evidence: JsonObject,
): {
  item: SecurityAuditChecklistItemRow
  status: SecurityAuditItemStatus
  evidence: JsonObject
  notes: string
} {
  const raw = evidence[item.itemKey]
  if (raw === true) {
    return { item, status: 'passed', evidence: { value: true }, notes: 'Evidence marked passed.' }
  }
  if (raw === false) {
    return { item, status: 'failed', evidence: { value: false }, notes: 'Evidence marked failed.' }
  }
  if (isPlainObject(raw)) {
    const status = parseStatus(raw.status)
    return {
      item,
      status,
      evidence: raw,
      notes: stringAt(raw.notes) ?? stringAt(raw.summary) ?? '',
    }
  }
  if (typeof raw === 'string' && raw.trim()) {
    return { item, status: 'passed', evidence: { note: raw.trim() }, notes: raw.trim() }
  }
  return { item, status: 'pending', evidence: {}, notes: 'No evidence supplied.' }
}

function summarize(
  items: Array<{ status: SecurityAuditItemStatus }>,
): JsonObject & { total: number; passed: number; failed: number; pending: number; notApplicable: number } {
  const total = items.length
  const passed = items.filter((item) => item.status === 'passed').length
  const failed = items.filter((item) => item.status === 'failed').length
  const pending = items.filter((item) => item.status === 'pending').length
  const notApplicable = items.filter((item) => item.status === 'not_applicable').length
  return { total, passed, failed, pending, notApplicable }
}

function parseStatus(value: unknown): SecurityAuditItemStatus {
  if (value === 'passed' || value === 'failed' || value === 'pending' || value === 'not_applicable') {
    return value
  }
  return 'pending'
}

function item(
  cadence: SecurityAuditCadence,
  itemKey: string,
  category: string,
  title: string,
  description: string,
  required = true,
): DefaultSecurityAuditItem {
  return { cadence, itemKey, category, title, description, required }
}

function isPlainObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function stringAt(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}
