import { and, asc, desc, eq } from 'drizzle-orm'
import { createHash } from 'node:crypto'

import { db, schema } from '@/db/client'
import type {
  ApprovalRequestRow,
  JsonObject,
  SoftwareCommandRow,
  SoftwareCommandRunMode,
  SoftwareCommandRunRow,
  SoftwareProfileRow,
} from '@/db/schema'
import { evaluateAutonomyAction } from '@/server/autonomy-policy-service'
import { newApprovalRequestId, newSoftwareCommandRunId } from '@/server/ids'
import {
  buildRuntimeControlApprovalInput,
  executeRuntimeControlAction,
  runtimeControlInputHash,
  type RuntimeControlActionType,
  type RuntimeControlScope,
} from '@/server/runtime-control-service'

export interface RunSoftwareCommandArgs {
  softwareCommandId: string
  agentProfileId?: string | null
  workflowRunId?: string | null
  workflowNodeRunId?: string | null
  input?: JsonObject
  mode?: SoftwareCommandRunMode
  computerSessionId?: string | null
  live?: boolean
  confirmRisk?: boolean
  approvalRequestId?: string | null
}

export async function runSoftwareCommand(args: RunSoftwareCommandArgs): Promise<SoftwareCommandRunRow> {
  const command = await getRequiredSoftwareCommand(args.softwareCommandId)
  const profile = await getRequiredSoftwareProfile(command.softwareProfileId)
  const mode = args.mode ?? 'dry_run'
  const requestedInput = args.input ?? {}
  const implementationType =
    typeof command.implementation.type === 'string' ? command.implementation.type : ''
  const structuralError = implementationType ? null : 'Software command requires implementation.type.'
  const autonomy = await evaluateAutonomyAction({
    agentProfileId: args.agentProfileId ?? null,
    actionType: 'software_command',
    resourceType: 'software_command',
    resourceId: command.id,
    requestedMode: mode,
    riskLevel: command.riskLevel,
    payload: {
      softwareProfileId: profile.id,
      softwareName: profile.name,
      softwareCommandName: command.name,
      adapterType: profile.adapterType,
      implementationType,
      input: requestedInput,
    },
  })
  const policyError =
    autonomy.decision.status === 'blocked' ? autonomy.decision.reason : null
  const runtimeControl = buildRuntimeControlArgs({
    implementation: command.implementation,
    input: requestedInput,
  })
  const approvalBinding = await buildSoftwareCommandApprovalBinding({
    input: requestedInput,
    runtimeControl,
    live: args.live ?? true,
  })
  const suppliedApproval = args.approvalRequestId
    ? await getRequiredApprovalRequest(args.approvalRequestId)
    : null
  const approvalSatisfied = suppliedApproval
    ? await validateApprovedSoftwareCommandApproval({
        approval: suppliedApproval,
        command,
        profile,
        agentProfileId: args.agentProfileId ?? null,
        approvalBinding,
        workflowRunId: args.workflowRunId ?? null,
        workflowNodeRunId: args.workflowNodeRunId ?? null,
      })
    : false
  const requiresApproval = command.requiresApproval || autonomy.decision.requiresApproval
  const approvalRequest =
    mode === 'execute' && !structuralError && !policyError && requiresApproval && !approvalSatisfied
      ? await createSoftwareCommandExecutionApprovalRequest({
          command,
          profile,
          agentProfileId: args.agentProfileId ?? null,
          workflowRunId: args.workflowRunId ?? null,
          workflowNodeRunId: args.workflowNodeRunId ?? null,
          input: requestedInput,
          approvalBinding,
          implementationType,
          autonomyDecisionId: autonomy.decision.id,
          riskLevel: autonomy.decision.riskLevel,
        })
      : null
  const execution = mode === 'execute' && !structuralError && !policyError && !approvalRequest
    ? await maybeExecuteRuntimeControl({
        runtimeControl,
        computerSessionId: args.computerSessionId ?? null,
        live: args.live ?? true,
        confirmRisk: args.confirmRisk ?? false,
        approvalRequestId: suppliedApproval?.id ?? null,
        trustedApprovalAlreadyValidated: approvalSatisfied,
      })
    : null
  const executeError = mode === 'execute'
    ? approvalRequest
      ? 'Software command execution is waiting for approval.'
      : execution?.error ?? null
    : null
  const error = structuralError ?? policyError ?? executeError
  const runStatus =
    execution?.status === 'complete'
      ? 'complete'
      : error
        ? 'blocked'
        : 'planned'
  const now = Date.now()
  const row = {
    id: newSoftwareCommandRunId(),
    softwareCommandId: command.id,
    softwareProfileId: profile.id,
    agentProfileId: args.agentProfileId ?? null,
    workflowRunId: args.workflowRunId ?? null,
    workflowNodeRunId: args.workflowNodeRunId ?? null,
    mode,
    status: runStatus,
    adapterType: profile.adapterType,
    implementationType: implementationType || 'unknown',
    input: requestedInput,
    output: error
      ? execution?.output ?? null
      : {
          dryRun: true,
          softwareProfileId: profile.id,
          softwareName: profile.name,
          softwareCommandId: command.id,
          softwareCommandName: command.name,
          adapterType: profile.adapterType,
          implementationType,
          riskLevel: command.riskLevel,
          approvalBinding: approvalBinding as unknown as JsonObject,
          runtimeControl: execution?.output ?? null,
        },
    error,
    requiresApproval: requiresApproval || mode === 'execute',
    approvalRequestId: approvalRequest?.id ?? suppliedApproval?.id ?? null,
    createdAt: now,
    finishedAt: now,
  } satisfies SoftwareCommandRunRow

  await db.insert(schema.softwareCommandRuns).values(row)
  return row
}

interface RuntimeControlSoftwareCommand {
  scope: RuntimeControlScope
  actionType: RuntimeControlActionType
  target?: string | null
  input: JsonObject
}

interface SoftwareCommandApprovalBinding {
  inputHash: string
  runtimeControl: {
    scope: RuntimeControlScope
    actionType: RuntimeControlActionType
    target: string | null
    inputHash: string
    approvalInput: JsonObject
    approvalInputHash: string
  } | null
}

async function maybeExecuteRuntimeControl(args: {
  runtimeControl: RuntimeControlSoftwareCommand | null
  computerSessionId: string | null
  live: boolean
  confirmRisk: boolean
  approvalRequestId: string | null
  trustedApprovalAlreadyValidated: boolean
}): Promise<{
  status: SoftwareCommandRunRow['status']
  output: JsonObject
  error: string | null
} | null> {
  if (!args.runtimeControl) {
    return {
      status: 'blocked',
      output: {
        runtimeControl: null,
        error: 'Software command implementation is not mapped to runtime-control.',
      },
      error: 'Software command implementation is not mapped to runtime-control.',
    }
  }
  if (!args.computerSessionId) {
    return {
      status: 'blocked',
      output: {
        runtimeControl: args.runtimeControl as unknown as JsonObject,
        error: 'Software command execute requires computerSessionId.',
      },
      error: 'Software command execute requires computerSessionId.',
    }
  }
  const result = await executeRuntimeControlAction({
    computerSessionId: args.computerSessionId,
    scope: args.runtimeControl.scope,
    actionType: args.runtimeControl.actionType,
    target: args.runtimeControl.target,
    input: args.runtimeControl.input,
    live: args.live,
    confirmRisk: args.confirmRisk,
    approvalRequestId: args.approvalRequestId,
    trustedApprovalAlreadyValidated: args.trustedApprovalAlreadyValidated,
  })
  return {
    status: result.status === 'complete' ? 'complete' : result.status === 'failed' ? 'failed' : 'blocked',
    output: {
      runtimeControlActionId: result.action.id,
      resourceLockId: result.resourceLock?.id ?? null,
      releasedResourceLockId: result.releasedResourceLock?.id ?? null,
      liveExecuted: result.liveExecuted,
      gate: result.gate as unknown as JsonObject,
      output: result.output,
    },
    error: result.status === 'complete' ? null : result.gate.reason,
  }
}

function buildRuntimeControlArgs(args: {
  implementation: JsonObject
  input: JsonObject
}): RuntimeControlSoftwareCommand | null {
  const type = stringValue(args.implementation.type)
  if (!type) return null
  const mergedInput = {
    ...(objectValue(args.implementation.input) ?? {}),
    ...args.input,
  }
  if (type === 'runtime_control') {
    const scope = runtimeScope(args.implementation.scope)
    const actionType = runtimeActionType(args.implementation.actionType ?? args.implementation.action)
    if (!scope || !actionType) return null
    return {
      scope,
      actionType,
      target: stringValue(args.implementation.target),
      input: mergedInput,
    }
  }
  if (type === 'desktop') {
    const actionType = runtimeActionType(args.implementation.actionType ?? args.implementation.action) ?? 'observe_windows'
    return {
      scope: 'desktop',
      actionType,
      target: stringValue(args.implementation.target),
      input: mergedInput,
    }
  }
  if (type === 'mobile') {
    const actionType = runtimeActionType(args.implementation.actionType ?? args.implementation.action) ?? 'list_devices'
    return {
      scope: 'mobile',
      actionType,
      target: stringValue(args.implementation.target),
      input: mergedInput,
    }
  }
  if (type === 'workstation') {
    const actionType = runtimeActionType(args.implementation.actionType ?? args.implementation.action) ?? 'validate_workstation'
    return {
      scope: 'workstation',
      actionType,
      target: stringValue(args.implementation.target),
      input: mergedInput,
    }
  }
  return null
}

async function validateApprovedSoftwareCommandApproval(args: {
  approval: ApprovalRequestRow
  command: SoftwareCommandRow
  profile: SoftwareProfileRow
  agentProfileId: string | null
  approvalBinding: SoftwareCommandApprovalBinding
  workflowRunId: string | null
  workflowNodeRunId: string | null
}): Promise<boolean> {
  if (args.approval.status !== 'approved') return false
  if (args.approval.type !== 'software_command_execute') return false
  if (args.approval.agentProfileId !== args.agentProfileId) return false
  if (args.approval.payload.softwareCommandId !== args.command.id) return false
  if (args.approval.payload.softwareProfileId !== args.profile.id) return false
  if (typeof args.approval.payload.softwareCommandConsumedAt === 'number') return false
  if (args.approval.payload.inputHash !== args.approvalBinding.inputHash) return false
  const runtimeBinding = args.approvalBinding.runtimeControl
  if (!runtimeBinding) {
    if (args.approval.payload.runtimeControl !== null) return Promise.resolve(false)
    return markSoftwareCommandApprovalConsumed(args.approval, args)
  }
  const approvedRuntime = objectValue(args.approval.payload.runtimeControl)
  if (!approvedRuntime) return Promise.resolve(false)
  const matched =
    approvedRuntime.scope === runtimeBinding.scope &&
    approvedRuntime.actionType === runtimeBinding.actionType &&
    (approvedRuntime.target ?? null) === runtimeBinding.target &&
    approvedRuntime.inputHash === runtimeBinding.inputHash &&
    approvedRuntime.approvalInputHash === runtimeBinding.approvalInputHash
  return matched ? markSoftwareCommandApprovalConsumed(args.approval, args) : Promise.resolve(false)
}

async function markSoftwareCommandApprovalConsumed(
  approval: ApprovalRequestRow,
  args: {
    workflowRunId: string | null
    workflowNodeRunId: string | null
    approvalBinding: SoftwareCommandApprovalBinding
  },
): Promise<boolean> {
  await db
    .update(schema.approvalRequests)
    .set({
      payload: {
        ...approval.payload,
        softwareCommandConsumedAt: Date.now(),
        softwareCommandConsumedWorkflowRunId: args.workflowRunId,
        softwareCommandConsumedWorkflowNodeRunId: args.workflowNodeRunId,
        softwareCommandConsumedInputHash: args.approvalBinding.inputHash,
        softwareCommandConsumedRuntimeApprovalInputHash:
          args.approvalBinding.runtimeControl?.approvalInputHash ?? null,
      },
    })
    .where(eq(schema.approvalRequests.id, approval.id))
  return true
}

async function createSoftwareCommandExecutionApprovalRequest(args: {
  command: SoftwareCommandRow
  profile: SoftwareProfileRow
  agentProfileId: string | null
  workflowRunId: string | null
  workflowNodeRunId: string | null
  input: JsonObject
  approvalBinding: SoftwareCommandApprovalBinding
  implementationType: string
  autonomyDecisionId: string
  riskLevel: ApprovalRequestRow['riskLevel']
}): Promise<ApprovalRequestRow> {
  const now = Date.now()
  const row: ApprovalRequestRow = {
    id: newApprovalRequestId(),
    conversationId: null,
    runId: args.workflowRunId,
    nodeRunId: args.workflowNodeRunId,
    agentProfileId: args.agentProfileId,
    type: 'software_command_execute',
    status: 'pending',
    title: `Approve software command: ${args.command.name}`,
    description:
      'A Software Command requested live automation. Approval is recorded before any real software control can run.',
    riskLevel: args.riskLevel,
    payload: {
      autonomyDecisionId: args.autonomyDecisionId,
      softwareProfileId: args.profile.id,
      softwareName: args.profile.name,
      softwareCommandId: args.command.id,
      softwareCommandName: args.command.name,
      adapterType: args.profile.adapterType,
      implementationType: args.implementationType,
      input: args.input,
      inputHash: args.approvalBinding.inputHash,
      runtimeControl: args.approvalBinding.runtimeControl as unknown as JsonObject | null,
    },
    response: null,
    createdAt: now,
    resolvedAt: null,
  }
  await db.insert(schema.approvalRequests).values(row)
  return row
}

async function getRequiredApprovalRequest(id: string): Promise<ApprovalRequestRow> {
  const row = await db.query.approvalRequests.findFirst({
    where: eq(schema.approvalRequests.id, id),
  })
  if (!row) throw new Error(`Approval request not found: ${id}`)
  return row
}

export async function listSoftwareCommandRunsForWorkflowRun(
  workflowRunId: string,
): Promise<SoftwareCommandRunRow[]> {
  return db.query.softwareCommandRuns.findMany({
    where: eq(schema.softwareCommandRuns.workflowRunId, workflowRunId),
    orderBy: [asc(schema.softwareCommandRuns.createdAt)],
  })
}

export async function listSoftwareCommandRuns(args: {
  softwareCommandId?: string
  softwareProfileId?: string
  agentProfileId?: string
  workflowRunId?: string
} = {}): Promise<SoftwareCommandRunRow[]> {
  const filters = [
    args.softwareCommandId
      ? eq(schema.softwareCommandRuns.softwareCommandId, args.softwareCommandId)
      : undefined,
    args.softwareProfileId
      ? eq(schema.softwareCommandRuns.softwareProfileId, args.softwareProfileId)
      : undefined,
    args.agentProfileId
      ? eq(schema.softwareCommandRuns.agentProfileId, args.agentProfileId)
      : undefined,
    args.workflowRunId ? eq(schema.softwareCommandRuns.workflowRunId, args.workflowRunId) : undefined,
  ].filter(Boolean)
  return db.query.softwareCommandRuns.findMany({
    where: filters.length > 0 ? and(...filters) : undefined,
    orderBy: [desc(schema.softwareCommandRuns.createdAt)],
    limit: 200,
  })
}

async function getRequiredSoftwareCommand(id: string): Promise<SoftwareCommandRow> {
  const row = await db.query.softwareCommands.findFirst({
    where: eq(schema.softwareCommands.id, id),
  })
  if (!row) throw new Error(`Software command not found: ${id}`)
  return row
}

async function getRequiredSoftwareProfile(id: string): Promise<SoftwareProfileRow> {
  const row = await db.query.softwareProfiles.findFirst({
    where: eq(schema.softwareProfiles.id, id),
  })
  if (!row) throw new Error(`Software profile not found: ${id}`)
  return row
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function objectValue(value: unknown): JsonObject | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : null
}

function runtimeScope(value: unknown): RuntimeControlScope | null {
  return value === 'desktop' || value === 'mobile' || value === 'workstation' ? value : null
}

function runtimeActionType(value: unknown): RuntimeControlActionType | null {
  return (
    value === 'observe_windows' ||
    value === 'capture_screenshot' ||
    value === 'focus_window' ||
    value === 'click' ||
    value === 'scroll' ||
    value === 'type_text' ||
    value === 'key_press' ||
    value === 'list_devices' ||
    value === 'mobile_tap' ||
    value === 'mobile_swipe' ||
    value === 'mobile_text' ||
    value === 'mobile_keyevent' ||
    value === 'mobile_screenshot' ||
    value === 'validate_workstation' ||
    value === 'launch_remote_session' ||
    value === 'release_workstation'
  )
    ? value
    : null
}

async function buildSoftwareCommandApprovalBinding(args: {
  input: JsonObject
  runtimeControl: RuntimeControlSoftwareCommand | null
  live: boolean
}): Promise<SoftwareCommandApprovalBinding> {
  if (!args.runtimeControl) {
    return {
      inputHash: stableJsonHash(args.input),
      runtimeControl: null,
    }
  }
  const approvalInput = await buildRuntimeControlApprovalInput({
    scope: args.runtimeControl.scope,
    actionType: args.runtimeControl.actionType,
    target: args.runtimeControl.target,
    input: args.runtimeControl.input,
    live: args.live,
  })
  return {
    inputHash: stableJsonHash(args.input),
    runtimeControl: {
      scope: args.runtimeControl.scope,
      actionType: args.runtimeControl.actionType,
      target: args.runtimeControl.target ?? null,
      inputHash: stableJsonHash(args.runtimeControl.input),
      approvalInput,
      approvalInputHash: runtimeControlInputHash(approvalInput),
    },
  }
}

function stableJsonHash(value: unknown): string {
  return `sha256:${createHash('sha256').update(stableStringify(value)).digest('hex')}`
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null'
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  const record = value as Record<string, unknown>
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
    .join(',')}}`
}
