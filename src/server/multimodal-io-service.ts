import { asc, desc, eq } from 'drizzle-orm'

import { db, schema } from '@/db/client'
import type {
  AgentProfileRow,
  EmployeeRunRow,
  JsonObject,
  MultimodalInputKind,
  MultimodalInputRow,
  MultimodalOutputKind,
  MultimodalOutputRow,
} from '@/db/schema'
import { newMultimodalInputId, newMultimodalOutputId } from '@/server/ids'
import { recordAuditLog } from '@/server/security-service'

const IMAGE_MIME_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp']
const AUDIO_MIME_TYPES = ['audio/wav', 'audio/mpeg', 'audio/mp3']
const STRUCTURED_TYPES = ['json', 'csv', 'xml', 'yaml']

export interface RegisterMultimodalInputArgs {
  employeeRunId?: string | null
  agentProfileId?: string | null
  kind: MultimodalInputKind
  mimeType?: string | null
  source?: string
  dataRef?: string | null
  description?: string | null
  metadata?: JsonObject
}

export interface RegisterMultimodalOutputArgs {
  employeeRunId?: string | null
  agentProfileId?: string | null
  kind: MultimodalOutputKind
  artifactId?: string | null
  path?: string | null
  caption?: string | null
  format?: string | null
  data?: JsonObject
  metadata?: JsonObject
}

export interface MultimodalRunSummary {
  inputIds: string[]
  outputIds: string[]
  inputKinds: MultimodalInputKind[]
  outputKinds: MultimodalOutputKind[]
  rejectedInputIds: string[]
  rejectedOutputIds: string[]
  requiredInputKinds: MultimodalInputKind[]
  requiredOutputKinds: MultimodalOutputKind[]
}

interface MultimodalValidationResult extends JsonObject {
  ok: boolean
  errors: string[]
}

export async function registerMultimodalInput(
  args: RegisterMultimodalInputArgs,
): Promise<MultimodalInputRow> {
  const validation = validateInput(args)
  const now = Date.now()
  const row: MultimodalInputRow = {
    id: newMultimodalInputId(),
    employeeRunId: normalizeNullable(args.employeeRunId),
    agentProfileId: normalizeNullable(args.agentProfileId),
    kind: args.kind,
    mimeType: normalizeNullable(args.mimeType),
    source: normalizeRequired(args.source ?? 'user', 'source'),
    dataRef: normalizeNullable(args.dataRef),
    description: normalizeNullable(args.description),
    metadata: args.metadata ?? {},
    status: validation.errors.length ? 'rejected' : 'validated',
    validationResult: validation,
    createdAt: now,
  }
  await db.insert(schema.multimodalInputs).values(row)
  await recordAuditLog({
    actorType: row.agentProfileId ? 'agent' : 'system',
    actorId: row.agentProfileId,
    action: 'multimodal_input.register',
    resourceType: 'multimodal_input',
    resourceId: row.id,
    status: row.status === 'validated' ? 'allowed' : 'blocked',
    riskLevel: row.status === 'validated' ? 'low' : 'medium',
    message: `Multimodal input ${row.kind} registered for run ${row.employeeRunId ?? 'unscoped'}.`,
    metadata: { kind: row.kind, mimeType: row.mimeType, validation },
  })
  return row
}

export async function registerMultimodalOutput(
  args: RegisterMultimodalOutputArgs,
): Promise<MultimodalOutputRow> {
  const validation = validateOutput(args)
  const now = Date.now()
  const row: MultimodalOutputRow = {
    id: newMultimodalOutputId(),
    employeeRunId: normalizeNullable(args.employeeRunId),
    agentProfileId: normalizeNullable(args.agentProfileId),
    kind: args.kind,
    artifactId: normalizeNullable(args.artifactId),
    path: normalizeNullable(args.path),
    caption: normalizeNullable(args.caption),
    format: normalizeNullable(args.format),
    data: args.data ?? {},
    metadata: args.metadata ?? {},
    status: validation.errors.length ? 'rejected' : 'validated',
    validationResult: validation,
    createdAt: now,
  }
  await db.insert(schema.multimodalOutputs).values(row)
  await recordAuditLog({
    actorType: row.agentProfileId ? 'agent' : 'system',
    actorId: row.agentProfileId,
    action: 'multimodal_output.register',
    resourceType: 'multimodal_output',
    resourceId: row.id,
    status: row.status === 'validated' ? 'allowed' : 'blocked',
    riskLevel: row.status === 'validated' ? 'low' : 'medium',
    message: `Multimodal output ${row.kind} registered for run ${row.employeeRunId ?? 'unscoped'}.`,
    metadata: { kind: row.kind, format: row.format, validation },
  })
  return row
}

export async function listMultimodalInputs(args: {
  employeeRunId?: string
  agentProfileId?: string
} = {}): Promise<MultimodalInputRow[]> {
  return db.query.multimodalInputs.findMany({
    where: args.employeeRunId
      ? eq(schema.multimodalInputs.employeeRunId, args.employeeRunId)
      : args.agentProfileId
        ? eq(schema.multimodalInputs.agentProfileId, args.agentProfileId)
        : undefined,
    orderBy: [desc(schema.multimodalInputs.createdAt)],
    limit: 100,
  })
}

export async function listMultimodalOutputs(args: {
  employeeRunId?: string
  agentProfileId?: string
} = {}): Promise<MultimodalOutputRow[]> {
  return db.query.multimodalOutputs.findMany({
    where: args.employeeRunId
      ? eq(schema.multimodalOutputs.employeeRunId, args.employeeRunId)
      : args.agentProfileId
        ? eq(schema.multimodalOutputs.agentProfileId, args.agentProfileId)
        : undefined,
    orderBy: [desc(schema.multimodalOutputs.createdAt)],
    limit: 100,
  })
}

export async function listMultimodalInputsForRun(runId: string): Promise<MultimodalInputRow[]> {
  return db.query.multimodalInputs.findMany({
    where: eq(schema.multimodalInputs.employeeRunId, runId),
    orderBy: [asc(schema.multimodalInputs.createdAt)],
  })
}

export async function listMultimodalOutputsForRun(runId: string): Promise<MultimodalOutputRow[]> {
  return db.query.multimodalOutputs.findMany({
    where: eq(schema.multimodalOutputs.employeeRunId, runId),
    orderBy: [asc(schema.multimodalOutputs.createdAt)],
  })
}

export async function materializeRunMultimodalIO(args: {
  run: EmployeeRunRow
  agent: AgentProfileRow
  output: JsonObject
}): Promise<MultimodalRunSummary> {
  let inputs = await listMultimodalInputsForRun(args.run.id)
  if (inputs.length === 0) {
    const extractedInputs = extractMultimodalInputs(args.run.input)
    inputs = await Promise.all(
      extractedInputs.map((input) =>
        registerMultimodalInput({
          ...input,
          employeeRunId: args.run.id,
          agentProfileId: args.agent.id,
          source: input.source ?? 'employee_run_input',
        }),
      ),
    )
  }

  let outputs = await listMultimodalOutputsForRun(args.run.id)
  if (outputs.length === 0) {
    const explicitOutputs = extractMultimodalOutputs(args.output)
    const requiredOutputs = getRequiredMultimodalOutputKinds(args.agent.outputContract)
      .filter((kind) => !explicitOutputs.some((output) => output.kind === kind))
      .map(
        (kind): RegisterMultimodalOutputArgs => ({
          kind,
          employeeRunId: args.run.id,
          agentProfileId: args.agent.id,
          caption: `Required ${kind} output placeholder for ${args.agent.name}.`,
          metadata: {
            source: 'output_contract',
            outputContract: args.agent.outputContract,
            readyForExecutor: true,
          },
        }),
      )
    outputs = await Promise.all(
      [...explicitOutputs, ...requiredOutputs].map((output) =>
        registerMultimodalOutput({
          ...output,
          employeeRunId: args.run.id,
          agentProfileId: args.agent.id,
        }),
      ),
    )
  }

  return summarizeMultimodalRun({
    inputs,
    outputs,
    agent: args.agent,
  })
}

export function summarizeMultimodalRun(args: {
  inputs: MultimodalInputRow[]
  outputs: MultimodalOutputRow[]
  agent: AgentProfileRow
}): MultimodalRunSummary {
  return {
    inputIds: args.inputs.map((row) => row.id),
    outputIds: args.outputs.map((row) => row.id),
    inputKinds: uniqueKinds(args.inputs.map((row) => row.kind)),
    outputKinds: uniqueKinds(args.outputs.map((row) => row.kind)),
    rejectedInputIds: args.inputs.filter((row) => row.status === 'rejected').map((row) => row.id),
    rejectedOutputIds: args.outputs.filter((row) => row.status === 'rejected').map((row) => row.id),
    requiredInputKinds: getRequiredMultimodalInputKinds(args.agent.inputContract),
    requiredOutputKinds: getRequiredMultimodalOutputKinds(args.agent.outputContract),
  }
}

export function getRequiredMultimodalInputKinds(contract: JsonObject): MultimodalInputKind[] {
  return normalizeInputKinds([
    ...getStringArray(contract, 'requiredModalities'),
    ...getStringArray(contract, 'requiredKinds'),
    ...getStringArray(getObject(contract, 'multimodal'), 'requiredKinds'),
    ...getStringArray(getObject(contract, 'multimodal'), 'requiredModalities'),
  ])
}

export function getRequiredMultimodalOutputKinds(contract: JsonObject): MultimodalOutputKind[] {
  const explicit = normalizeOutputKinds([
    ...getStringArray(contract, 'requiredModalities'),
    ...getStringArray(contract, 'requiredKinds'),
    ...getStringArray(getObject(contract, 'multimodal'), 'requiredKinds'),
    ...getStringArray(getObject(contract, 'multimodal'), 'requiredModalities'),
  ])
  if (explicit.length) return explicit
  const artifactType = getString(contract, 'artifactType')
  return artifactType ? mapArtifactTypeToOutputKinds(artifactType) : []
}

function extractMultimodalInputs(input: JsonObject): RegisterMultimodalInputArgs[] {
  const root = getObject(input, 'multimodal') ?? input
  const rows: RegisterMultimodalInputArgs[] = []
  const text = getString(root, 'text')
  if (text) {
    rows.push({
      kind: 'text',
      mimeType: 'text/plain',
      dataRef: 'inline:text',
      description: text.slice(0, 240),
      metadata: { charCount: text.length },
    })
  }
  for (const item of getObjectArray(root, 'images')) {
    rows.push({
      kind: 'image',
      mimeType: getString(item, 'mimeType'),
      dataRef: getString(item, 'data') ?? getString(item, 'path') ?? getString(item, 'url'),
      description: getString(item, 'description'),
      metadata: { source: getString(item, 'source') ?? 'user_supplied' },
    })
  }
  const screenshot = getObject(root, 'screenshot')
  if (screenshot) {
    rows.push({
      kind: 'screenshot',
      mimeType: getString(screenshot, 'mimeType') ?? 'image/png',
      dataRef: getString(screenshot, 'path') ?? getString(screenshot, 'data') ?? null,
      description: getString(screenshot, 'description'),
      metadata: {
        source: getString(screenshot, 'source') ?? 'active_window',
        annotatedByUser: getBoolean(screenshot, 'annotatedByUser'),
      },
    })
  }
  for (const item of normalizeObjectList(root.audio)) {
    rows.push({
      kind: 'audio',
      mimeType: getString(item, 'mimeType') ?? mimeFromAudioFormat(getString(item, 'format')),
      dataRef: getString(item, 'data') ?? getString(item, 'path'),
      description: getString(item, 'transcription'),
      metadata: { format: getString(item, 'format'), transcription: getString(item, 'transcription') },
    })
  }
  for (const item of normalizeObjectList(root.videoFrame)) {
    rows.push({
      kind: 'video_frame',
      mimeType: getString(item, 'mimeType') ?? 'image/png',
      dataRef: getString(item, 'data') ?? getString(item, 'path'),
      description: getString(item, 'description'),
      metadata: { timestamp: getNumber(item, 'timestamp'), fps: getNumber(item, 'fps') },
    })
  }
  const structured = getObject(root, 'structured')
  if (structured) {
    rows.push({
      kind: 'structured',
      mimeType: structuredMime(getString(structured, 'type')),
      dataRef: 'inline:structured',
      description: getString(structured, 'description') ?? getString(structured, 'type'),
      metadata: {
        structuredType: getString(structured, 'type') ?? 'json',
        hasData: structured.data !== undefined,
      },
    })
  }
  return rows
}

function extractMultimodalOutputs(output: JsonObject): RegisterMultimodalOutputArgs[] {
  const root = getObject(output, 'multimodalOutput') ?? getObject(output, 'multimodal') ?? output
  const rows: RegisterMultimodalOutputArgs[] = []
  const text = getString(root, 'text')
  if (text) rows.push({ kind: 'text', format: 'plain', data: { text }, caption: text.slice(0, 160) })
  for (const item of getObjectArray(root, 'codeDiff')) {
    rows.push({ kind: 'code_diff', path: getString(item, 'path'), data: item, caption: getString(item, 'diff') })
  }
  for (const item of getObjectArray(root, 'screenshots')) {
    rows.push({ kind: 'screenshot', path: getString(item, 'path'), caption: getString(item, 'caption'), data: item })
  }
  for (const item of getObjectArray(root, 'charts')) {
    rows.push({
      kind: 'chart',
      format: getString(item, 'type'),
      caption: getString(item, 'caption') ?? getString(item, 'type'),
      data: item,
    })
  }
  const recording = getObject(root, 'recording')
  if (recording) {
    rows.push({
      kind: 'recording',
      path: getString(recording, 'path'),
      caption: getString(recording, 'caption'),
      data: recording,
    })
  }
  const report = getObject(root, 'report')
  if (report) {
    rows.push({
      kind: 'report',
      path: getString(report, 'path'),
      format: getString(report, 'format'),
      caption: getString(report, 'caption') ?? getString(report, 'format'),
      data: report,
    })
  }
  const audioSummary = getObject(root, 'audioSummary')
  if (audioSummary) {
    rows.push({
      kind: 'audio_summary',
      path: getString(audioSummary, 'path'),
      format: getString(audioSummary, 'language'),
      caption: getString(audioSummary, 'caption'),
      data: audioSummary,
    })
  }
  return rows
}

function validateInput(args: RegisterMultimodalInputArgs): MultimodalValidationResult {
  const errors: string[] = []
  if (!args.kind) errors.push('kind is required')
  if (args.kind === 'image' && !IMAGE_MIME_TYPES.includes(args.mimeType ?? '')) {
    errors.push('image mimeType must be image/png, image/jpeg, image/gif, or image/webp')
  }
  if (args.kind === 'screenshot' && args.mimeType && !IMAGE_MIME_TYPES.includes(args.mimeType)) {
    errors.push('screenshot mimeType must be an image type')
  }
  if (args.kind === 'audio' && !AUDIO_MIME_TYPES.includes(args.mimeType ?? '')) {
    errors.push('audio mimeType must be audio/wav, audio/mpeg, or audio/mp3')
  }
  if (args.kind === 'video_frame' && args.mimeType && !IMAGE_MIME_TYPES.includes(args.mimeType)) {
    errors.push('video_frame mimeType must describe an extracted image frame')
  }
  if (args.kind === 'structured') {
    const structuredType = getString(args.metadata ?? {}, 'structuredType')
    if (structuredType && !STRUCTURED_TYPES.includes(structuredType)) {
      errors.push('structured metadata.structuredType must be json, csv, xml, or yaml')
    }
  }
  return { ok: errors.length === 0, errors }
}

function validateOutput(args: RegisterMultimodalOutputArgs): MultimodalValidationResult {
  const errors: string[] = []
  if (!args.kind) errors.push('kind is required')
  if (['screenshot', 'recording', 'audio_summary'].includes(args.kind) && !normalizeNullable(args.path)) {
    const placeholder = getBoolean(args.metadata ?? {}, 'readyForExecutor')
    if (!placeholder) errors.push(`${args.kind} requires path or readyForExecutor metadata`)
  }
  if (args.kind === 'report') {
    const format = normalizeNullable(args.format)
    if (format && !['html', 'pdf', 'markdown', 'json'].includes(format)) {
      errors.push('report format must be html, pdf, markdown, or json')
    }
  }
  return { ok: errors.length === 0, errors }
}

function mapArtifactTypeToOutputKinds(artifactType: string): MultimodalOutputKind[] {
  if (artifactType === 'code') return ['code_diff']
  if (artifactType === 'image' || artifactType === 'browser_state' || artifactType === 'desktop_result') {
    return ['screenshot']
  }
  if (artifactType === 'spreadsheet') return ['chart']
  if (['document', 'json', 'report', 'file_bundle'].includes(artifactType)) return ['report']
  return []
}

function normalizeInputKinds(values: string[]): MultimodalInputKind[] {
  const allowed: MultimodalInputKind[] = ['text', 'image', 'screenshot', 'audio', 'video_frame', 'structured']
  return values.filter((value): value is MultimodalInputKind => allowed.includes(value as MultimodalInputKind))
}

function normalizeOutputKinds(values: string[]): MultimodalOutputKind[] {
  const allowed: MultimodalOutputKind[] = [
    'text',
    'code_diff',
    'screenshot',
    'chart',
    'recording',
    'report',
    'audio_summary',
  ]
  return values.filter((value): value is MultimodalOutputKind => allowed.includes(value as MultimodalOutputKind))
}

function uniqueKinds<T extends string>(values: T[]): T[] {
  return [...new Set(values)]
}

function normalizeRequired(value: string | null | undefined, label: string): string {
  const trimmed = value?.trim() ?? ''
  if (!trimmed) throw new Error(`${label} is required.`)
  return trimmed
}

function normalizeNullable(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? ''
  return trimmed ? trimmed : null
}

function getObject(obj: JsonObject, key: string): JsonObject | null {
  const value = obj[key]
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as JsonObject) : null
}

function getObjectArray(obj: JsonObject, key: string): JsonObject[] {
  const value = obj[key]
  return Array.isArray(value)
    ? value.filter((item): item is JsonObject => item && typeof item === 'object' && !Array.isArray(item))
    : []
}

function normalizeObjectList(value: unknown): JsonObject[] {
  if (Array.isArray(value)) {
    return value.filter((item): item is JsonObject => item && typeof item === 'object' && !Array.isArray(item))
  }
  return value && typeof value === 'object' && !Array.isArray(value) ? [value as JsonObject] : []
}

function getString(obj: JsonObject, key: string): string | null {
  const value = obj[key]
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function getStringArray(obj: JsonObject | null, key: string): string[] {
  if (!obj) return []
  const value = obj[key]
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

function getBoolean(obj: JsonObject, key: string): boolean | null {
  const value = obj[key]
  return typeof value === 'boolean' ? value : null
}

function getNumber(obj: JsonObject, key: string): number | null {
  const value = obj[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function mimeFromAudioFormat(format: string | null): string | null {
  if (format === 'wav') return 'audio/wav'
  if (format === 'mp3') return 'audio/mpeg'
  return null
}

function structuredMime(type: string | null): string {
  if (type === 'csv') return 'text/csv'
  if (type === 'xml') return 'application/xml'
  if (type === 'yaml') return 'application/yaml'
  return 'application/json'
}
