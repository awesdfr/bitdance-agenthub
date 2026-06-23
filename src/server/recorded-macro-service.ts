import { and, desc, eq } from 'drizzle-orm'

import { db, schema } from '@/db/client'
import type {
  ApprovalRequestRow,
  JsonObject,
  MacroReplayRunMode,
  MacroReplayRunRow,
  RecordedMacroRow,
  RiskLevel,
  SoftwareProfileRow,
} from '@/db/schema'
import { evaluateAutonomyAction } from '@/server/autonomy-policy-service'
import { newApprovalRequestId, newMacroReplayRunId, newRecordedMacroId } from '@/server/ids'

export interface CreateRecordedMacroArgs {
  softwareProfileId: string
  name: string
  description?: string
  steps: JsonObject[]
  inputSchema?: JsonObject
  outputSchema?: JsonObject
  parameterBindings?: JsonObject
  riskLevel?: RiskLevel
  status?: RecordedMacroRow['status']
}

export interface ReplayRecordedMacroArgs {
  recordedMacroId: string
  softwareCommandId?: string | null
  agentProfileId?: string | null
  input?: JsonObject
  mode?: MacroReplayRunMode
}

export async function createRecordedMacro(args: CreateRecordedMacroArgs): Promise<RecordedMacroRow> {
  await getRequiredSoftwareProfile(args.softwareProfileId)
  if (args.steps.length === 0) throw new Error('Recorded macro requires at least one step.')
  const now = Date.now()
  const row: RecordedMacroRow = {
    id: newRecordedMacroId(),
    softwareProfileId: args.softwareProfileId,
    name: normalizeRequired(args.name, 'name'),
    description: args.description?.trim() ?? '',
    steps: args.steps,
    inputSchema: args.inputSchema ?? {},
    outputSchema: args.outputSchema ?? {},
    parameterBindings: args.parameterBindings ?? {},
    riskLevel: args.riskLevel ?? 'medium',
    status: args.status ?? 'active',
    createdAt: now,
    updatedAt: now,
  }
  await db.insert(schema.recordedMacros).values(row)
  return row
}

export async function listRecordedMacros(softwareProfileId?: string): Promise<RecordedMacroRow[]> {
  return db.query.recordedMacros.findMany({
    where: softwareProfileId ? eq(schema.recordedMacros.softwareProfileId, softwareProfileId) : undefined,
    orderBy: [desc(schema.recordedMacros.updatedAt)],
    limit: 200,
  })
}

export async function replayRecordedMacro(args: ReplayRecordedMacroArgs): Promise<MacroReplayRunRow> {
  const macro = await getRequiredRecordedMacro(args.recordedMacroId)
  const profile = await getRequiredSoftwareProfile(macro.softwareProfileId)
  const mode = args.mode ?? 'dry_run'
  const input = args.input ?? {}
  const structuralError = getMacroStructuralError(macro)
  const autonomy = await evaluateAutonomyAction({
    agentProfileId: args.agentProfileId ?? null,
    actionType: 'software_command',
    resourceType: 'recorded_macro',
    resourceId: macro.id,
    requestedMode: mode,
    riskLevel: macro.riskLevel,
    payload: {
      softwareProfileId: profile.id,
      softwareName: profile.name,
      macroName: macro.name,
      stepCount: macro.steps.length,
      input,
    },
  })
  const policyError = autonomy.decision.status === 'blocked' ? autonomy.decision.reason : null
  const approvalRequest =
    mode === 'execute' && !structuralError && !policyError
      ? await createMacroReplayApprovalRequest({
          macro,
          profile,
          softwareCommandId: args.softwareCommandId ?? null,
          agentProfileId: args.agentProfileId ?? null,
          input,
          autonomyDecisionId: autonomy.decision.id,
          riskLevel: autonomy.decision.riskLevel,
        })
      : null
  const executeError =
    mode === 'execute'
      ? 'Recorded macro execution is waiting for approval; live desktop/browser macro replay is not enabled in this runtime slice.'
      : null
  const error = structuralError ?? policyError ?? executeError
  const now = Date.now()
  const row: MacroReplayRunRow = {
    id: newMacroReplayRunId(),
    recordedMacroId: macro.id,
    softwareProfileId: profile.id,
    softwareCommandId: args.softwareCommandId ?? null,
    agentProfileId: args.agentProfileId ?? null,
    mode,
    status: error ? 'blocked' : 'planned',
    input,
    output: error
      ? null
      : {
          dryRun: true,
          recordedMacroId: macro.id,
          softwareProfileId: profile.id,
          softwareName: profile.name,
          macroName: macro.name,
          stepCount: macro.steps.length,
          parameterBindings: macro.parameterBindings,
          riskLevel: macro.riskLevel,
        },
    error,
    requiresApproval: macro.riskLevel !== 'low' || autonomy.decision.requiresApproval || mode === 'execute',
    autonomyDecisionId: autonomy.decision.id,
    approvalRequestId: approvalRequest?.id ?? null,
    createdAt: now,
    finishedAt: now,
  }
  await db.insert(schema.macroReplayRuns).values(row)
  return row
}

export async function listMacroReplayRuns(args: {
  recordedMacroId?: string
  agentProfileId?: string
} = {}): Promise<MacroReplayRunRow[]> {
  const filters = [
    args.recordedMacroId ? eq(schema.macroReplayRuns.recordedMacroId, args.recordedMacroId) : undefined,
    args.agentProfileId ? eq(schema.macroReplayRuns.agentProfileId, args.agentProfileId) : undefined,
  ].filter(Boolean)
  return db.query.macroReplayRuns.findMany({
    where: filters.length > 0 ? and(...filters) : undefined,
    orderBy: [desc(schema.macroReplayRuns.createdAt)],
    limit: 200,
  })
}

async function createMacroReplayApprovalRequest(args: {
  macro: RecordedMacroRow
  profile: SoftwareProfileRow
  softwareCommandId: string | null
  agentProfileId: string | null
  input: JsonObject
  autonomyDecisionId: string
  riskLevel: ApprovalRequestRow['riskLevel']
}): Promise<ApprovalRequestRow> {
  const now = Date.now()
  const row: ApprovalRequestRow = {
    id: newApprovalRequestId(),
    conversationId: null,
    runId: null,
    nodeRunId: null,
    agentProfileId: args.agentProfileId,
    type: 'recorded_macro_execute',
    status: 'pending',
    title: `Approve macro replay: ${args.macro.name}`,
    description: 'A recorded macro requested live replay. Approval is recorded before any real desktop/browser automation can run.',
    riskLevel: args.riskLevel,
    payload: {
      autonomyDecisionId: args.autonomyDecisionId,
      recordedMacroId: args.macro.id,
      softwareProfileId: args.profile.id,
      softwareCommandId: args.softwareCommandId,
      macroName: args.macro.name,
      stepCount: args.macro.steps.length,
      input: args.input,
    },
    response: null,
    createdAt: now,
    resolvedAt: null,
  }
  await db.insert(schema.approvalRequests).values(row)
  return row
}

function getMacroStructuralError(macro: RecordedMacroRow): string | null {
  if (macro.status === 'archived') return 'Recorded macro is archived.'
  if (macro.steps.length === 0) return 'Recorded macro requires at least one step.'
  return null
}

async function getRequiredRecordedMacro(id: string): Promise<RecordedMacroRow> {
  const row = await db.query.recordedMacros.findFirst({ where: eq(schema.recordedMacros.id, id) })
  if (!row) throw new Error(`Recorded macro not found: ${id}`)
  return row
}

async function getRequiredSoftwareProfile(id: string): Promise<SoftwareProfileRow> {
  const row = await db.query.softwareProfiles.findFirst({ where: eq(schema.softwareProfiles.id, id) })
  if (!row) throw new Error(`Software profile not found: ${id}`)
  return row
}

function normalizeRequired(value: string | null | undefined, label: string): string {
  const trimmed = value?.trim() ?? ''
  if (!trimmed) throw new Error(`${label} is required.`)
  return trimmed
}
