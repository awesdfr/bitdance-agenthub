import path from 'node:path'

import { and, desc, eq, type SQL } from 'drizzle-orm'

import { db, schema } from '@/db/client'
import type {
  FileBoundaryAction,
  FileBoundaryEvaluationStatus,
  FileBoundaryRisk,
  FileBoundarySeverity,
  FileSystemBoundaryEvaluationRow,
  FileSystemBoundaryInput,
  FileSystemBoundaryPolicy,
  FileSystemBoundaryPolicyRow,
} from '@/db/schema'
import { newFileSystemBoundaryEvaluationId, newFileSystemBoundaryPolicyId } from '@/server/ids'

export interface EvaluateFileSystemBoundaryArgs extends FileSystemBoundaryInput {
  policyId?: string
}

export interface FileSystemBoundaryEvaluationResult {
  policy: FileSystemBoundaryPolicyRow
  evaluation: FileSystemBoundaryEvaluationRow
  summary: {
    riskCount: number
    blocked: number
    warnings: number
    actions: FileBoundaryAction[]
  }
}

const DEFAULT_POLICY_NAME = 'Default cross-platform file boundary policy'

const defaultPolicy: FileSystemBoundaryPolicy = {
  encoding: {
    defaultEncoding: 'utf-8',
    defaultLineEnding: 'lf',
    defaultBOM: false,
    autoDetect: {
      encoding: true,
      lineEnding: true,
      BOM: true,
    },
    binaryExtensions: [
      '.png',
      '.jpg',
      '.jpeg',
      '.gif',
      '.webp',
      '.ico',
      '.pdf',
      '.zip',
      '.7z',
      '.rar',
      '.exe',
      '.dll',
      '.mp3',
      '.mp4',
      '.mov',
      '.wav',
      '.xlsx',
      '.docx',
      '.pptx',
    ],
    encodingOverrides: {
      '*.srt': 'utf-8',
      '*.csv': 'utf-8',
    },
  },
  pathLength: {
    windowsMaxPath: 260,
    warnAt: 240,
    shallowWorkspaceRoot: 'C:\\ra\\ws',
    longPathsEnabledRequired: true,
    fallbackToShortPath: true,
  },
  fileLock: {
    checkBeforeWrite: true,
    maxWaitMs: 15000,
    onLocked: 'wait_or_notify',
  },
  largeFile: {
    thresholds: {
      smallBytes: 1 * 1024 * 1024,
      mediumBytes: 10 * 1024 * 1024,
      largeBytes: 100 * 1024 * 1024,
    },
    mediumStrategy: 'stream_summary',
    largeStrategy: 'metadata_only',
    hugeStrategy: 'block',
  },
  filename: {
    windowsForbiddenPattern: '< > : " / \\ | ? * and control characters',
    replacement: '-',
    stripEmoji: true,
    maxNameLength: 180,
    shellEscapeSpaces: true,
  },
}

export async function seedFileSystemBoundaryPolicy(): Promise<FileSystemBoundaryPolicyRow> {
  const existing = await db.query.fileSystemBoundaryPolicies.findFirst({
    where: eq(schema.fileSystemBoundaryPolicies.name, DEFAULT_POLICY_NAME),
  })
  if (existing) return existing
  const now = Date.now()
  const row: FileSystemBoundaryPolicyRow = {
    id: newFileSystemBoundaryPolicyId(),
    name: DEFAULT_POLICY_NAME,
    policy: defaultPolicy,
    status: 'active',
    createdAt: now,
    updatedAt: now,
  }
  await db.insert(schema.fileSystemBoundaryPolicies).values(row)
  return row
}

export async function listFileSystemBoundaryPolicies(args: {
  status?: FileSystemBoundaryPolicyRow['status']
  limit?: number
} = {}): Promise<FileSystemBoundaryPolicyRow[]> {
  const filters: SQL[] = []
  if (args.status) filters.push(eq(schema.fileSystemBoundaryPolicies.status, args.status))
  return db.query.fileSystemBoundaryPolicies.findMany({
    where: filters.length ? and(...filters) : undefined,
    orderBy: [desc(schema.fileSystemBoundaryPolicies.updatedAt)],
    limit: Math.min(Math.max(args.limit ?? 25, 1), 100),
  })
}

export async function evaluateFileSystemBoundary(
  args: EvaluateFileSystemBoundaryArgs,
): Promise<FileSystemBoundaryEvaluationResult> {
  const policy = args.policyId
    ? await getRequiredPolicy(args.policyId)
    : await seedFileSystemBoundaryPolicy()
  if (policy.status !== 'active') throw new Error(`File system boundary policy is ${policy.status}: ${policy.id}`)

  const input = normalizeInput(args)
  const fileName = resolveFileName(input)
  const normalizedFileName = normalizeFileName(fileName, policy.policy)
  const normalizedPath = buildNormalizedPath(input.path, normalizedFileName)
  const risks = collectRisks(input, fileName, normalizedFileName, policy.policy)
  const actions = uniqueActions(risks)
  if (!actions.length && input.operation === 'read') actions.push('allow_full_read')
  const status = statusFromRisks(risks)
  const evaluation: FileSystemBoundaryEvaluationRow = {
    id: newFileSystemBoundaryEvaluationId(),
    policyId: policy.id,
    requestedPath: input.path ?? fileName,
    normalizedPath,
    operation: input.operation,
    platform: input.platform ?? 'windows',
    input,
    risks,
    actions,
    status,
    recommendation: recommendationFor(status, risks, actions, normalizedFileName),
    createdAt: Date.now(),
  }
  await db.insert(schema.fileSystemBoundaryEvaluations).values(evaluation)
  return {
    policy,
    evaluation,
    summary: {
      riskCount: risks.length,
      blocked: risks.filter((risk) => risk.severity === 'blocked').length,
      warnings: risks.filter((risk) => risk.severity === 'warning' || risk.severity === 'high').length,
      actions,
    },
  }
}

export async function listFileSystemBoundaryEvaluations(args: {
  status?: FileBoundaryEvaluationStatus
  operation?: FileSystemBoundaryInput['operation']
  limit?: number
} = {}): Promise<FileSystemBoundaryEvaluationRow[]> {
  const filters: SQL[] = []
  if (args.status) filters.push(eq(schema.fileSystemBoundaryEvaluations.status, args.status))
  if (args.operation) filters.push(eq(schema.fileSystemBoundaryEvaluations.operation, args.operation))
  return db.query.fileSystemBoundaryEvaluations.findMany({
    where: filters.length ? and(...filters) : undefined,
    orderBy: [desc(schema.fileSystemBoundaryEvaluations.createdAt)],
    limit: Math.min(Math.max(args.limit ?? 50, 1), 200),
  })
}

function normalizeInput(args: EvaluateFileSystemBoundaryArgs): FileSystemBoundaryInput {
  return {
    path: args.path,
    fileName: args.fileName,
    extension: normalizeExtension(args.extension ?? extensionFromPath(args.path ?? args.fileName ?? '')),
    fileSizeBytes: Math.max(args.fileSizeBytes ?? 0, 0),
    encoding: args.encoding?.toLowerCase(),
    hasBom: args.hasBom,
    lineEnding: args.lineEnding,
    isBinary: args.isBinary,
    operation: args.operation,
    platform: args.platform ?? 'windows',
    lockDetected: args.lockDetected,
  }
}

function resolveFileName(input: FileSystemBoundaryInput): string {
  if (input.fileName?.trim()) return input.fileName.trim()
  if (!input.path) return 'untitled'
  return input.platform === 'windows' ? path.win32.basename(input.path) : path.posix.basename(input.path)
}

function extensionFromPath(target: string): string {
  const basename = target.includes('\\') ? path.win32.basename(target) : path.posix.basename(target)
  const extension = path.extname(basename)
  return normalizeExtension(extension)
}

function normalizeExtension(extension: string): string {
  if (!extension) return ''
  return extension.startsWith('.') ? extension.toLowerCase() : `.${extension.toLowerCase()}`
}

function normalizeFileName(fileName: string, policy: FileSystemBoundaryPolicy): string {
  const replacement = policy.filename.replacement || '-'
  let normalized = fileName
    .replace(/[<>:"\/\\|?*\x00-\x1F]/g, replacement)
    .replace(/[ .]+$/g, '')
    .trim()
  if (policy.filename.stripEmoji) {
    normalized = normalized.replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, '')
  }
  if (!normalized) normalized = 'untitled'
  if (normalized.length > policy.filename.maxNameLength) {
    normalized = normalized.slice(0, policy.filename.maxNameLength)
  }
  return normalized
}

function buildNormalizedPath(requestedPath: string | undefined, normalizedFileName: string): string {
  if (!requestedPath) return normalizedFileName
  if (!/[\\/]/.test(requestedPath)) return normalizedFileName
  return requestedPath.replace(/[^\\/]+$/, normalizedFileName)
}

function collectRisks(
  input: FileSystemBoundaryInput,
  fileName: string,
  normalizedFileName: string,
  policy: FileSystemBoundaryPolicy,
): FileBoundaryRisk[] {
  const risks: FileBoundaryRisk[] = []
  const isBinary = input.isBinary || policy.encoding.binaryExtensions.includes(input.extension ?? '')
  const size = input.fileSizeBytes ?? 0
  const requestedPath = input.path ?? fileName

  if (normalizedFileName !== fileName) {
    risks.push(risk(
      'special_filename',
      'warning',
      `File name "${fileName}" is not cross-platform safe; use "${normalizedFileName}".`,
      'normalize_filename',
    ))
  }

  if ((input.platform ?? 'windows') === 'windows') {
    if (requestedPath.length >= policy.pathLength.windowsMaxPath) {
      risks.push(risk(
        'path_length',
        policy.pathLength.fallbackToShortPath ? 'high' : 'blocked',
        `Windows path length ${requestedPath.length} reaches or exceeds MAX_PATH ${policy.pathLength.windowsMaxPath}.`,
        policy.pathLength.fallbackToShortPath ? 'shorten_workspace_root' : 'block',
      ))
    } else if (requestedPath.length >= policy.pathLength.warnAt) {
      risks.push(risk(
        'path_length',
        'warning',
        `Windows path length ${requestedPath.length} is close to MAX_PATH; keep Agent workspaces shallow.`,
        'shorten_workspace_root',
      ))
    }
  }

  if (input.lockDetected && (input.operation === 'write' || input.operation === 'create' || input.operation === 'delete')) {
    risks.push(risk(
      'file_lock',
      'high',
      `Target appears locked; wait up to ${policy.fileLock.maxWaitMs}ms or notify the user before writing.`,
      policy.fileLock.onLocked,
    ))
  }

  if (isBinary) {
    risks.push(risk(
      'binary_file',
      'info',
      'Binary files should not be loaded as text context; use metadata or a specialized parser.',
      'metadata_only',
    ))
  }

  if (size > policy.largeFile.thresholds.largeBytes) {
    risks.push(risk(
      'large_file',
      'blocked',
      `File size ${size} bytes is above the huge-file threshold; block direct Agent read.`,
      policy.largeFile.hugeStrategy,
    ))
  } else if (size > policy.largeFile.thresholds.mediumBytes) {
    risks.push(risk(
      'large_file',
      'warning',
      `File size ${size} bytes is large; expose metadata and specialized tools instead of full context.`,
      policy.largeFile.largeStrategy,
    ))
  } else if (size > policy.largeFile.thresholds.smallBytes) {
    risks.push(risk(
      'large_file',
      'info',
      `File size ${size} bytes is medium; stream or summarize instead of loading the full file.`,
      policy.largeFile.mediumStrategy,
    ))
  }

  if (!isBinary) {
    const encoding = input.encoding ?? policy.encoding.defaultEncoding
    if (encoding !== 'utf-8' && encoding !== 'utf8') {
      risks.push(risk(
        'encoding',
        'warning',
        `Detected ${encoding} content; transcode to UTF-8 before adding it to Agent context.`,
        'transcode_utf8',
      ))
    }
    if (input.hasBom) {
      risks.push(risk(
        'bom',
        'info',
        'Detected BOM; strip it during text ingestion unless the user explicitly preserves it.',
        'strip_bom',
      ))
    }
    if (input.lineEnding && input.lineEnding !== policy.encoding.defaultLineEnding) {
      risks.push(risk(
        'line_ending',
        input.lineEnding === 'mixed' ? 'warning' : 'info',
        `Detected ${input.lineEnding} line endings; normalize to ${policy.encoding.defaultLineEnding}.`,
        'normalize_line_endings',
      ))
    }
  }

  return risks
}

function risk(
  type: FileBoundaryRisk['type'],
  severity: FileBoundarySeverity,
  message: string,
  action: FileBoundaryAction,
): FileBoundaryRisk {
  return { type, severity, message, action }
}

function uniqueActions(risks: FileBoundaryRisk[]): FileBoundaryAction[] {
  return Array.from(new Set(risks.map((risk) => risk.action)))
}

function statusFromRisks(risks: FileBoundaryRisk[]): FileBoundaryEvaluationStatus {
  if (risks.some((risk) => risk.severity === 'blocked')) return 'blocked'
  if (risks.some((risk) => risk.type === 'file_lock')) return 'needs_user'
  if (risks.some((risk) => risk.severity === 'warning' || risk.severity === 'high')) return 'warning'
  return 'safe'
}

function recommendationFor(
  status: FileBoundaryEvaluationStatus,
  risks: FileBoundaryRisk[],
  actions: FileBoundaryAction[],
  normalizedFileName: string,
): string {
  if (!risks.length) return 'No file-system boundary issue detected; continue with the requested file operation.'
  if (status === 'blocked') return 'Block direct Agent access and route through metadata, specialized tooling, or user review.'
  if (actions.includes('normalize_filename')) return `Use normalized file name "${normalizedFileName}" before creating or writing.`
  if (actions.includes('wait_or_notify')) return 'Wait briefly for the file lock to clear, then notify the user before retrying.'
  if (actions.includes('shorten_workspace_root')) return 'Move the Agent workspace closer to the drive root or enable Windows long paths.'
  return 'Apply the recommended preprocessing actions before exposing this file to Agent context.'
}

async function getRequiredPolicy(id: string): Promise<FileSystemBoundaryPolicyRow> {
  const row = await db.query.fileSystemBoundaryPolicies.findFirst({
    where: eq(schema.fileSystemBoundaryPolicies.id, id),
  })
  if (!row) throw new Error(`File system boundary policy not found: ${id}`)
  return row
}
