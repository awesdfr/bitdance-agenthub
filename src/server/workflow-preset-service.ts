import type { JsonObject, WorkflowRow, WorkflowRunRow } from '@/db/schema'
import {
  createWorkflow,
  getWorkflowGraph,
  startWorkflowRun,
  type WorkflowGraph,
} from '@/server/control-plane-service'
import { newWorkflowNodeId } from '@/server/ids'

export interface WorkflowPresetStep {
  title: string
  instruction: string
  artifactType: string
}

export interface WorkflowPreset {
  id: string
  category: string
  title: string
  prompt: string
  description: string
  steps: WorkflowPresetStep[]
}

const workflowPresets: WorkflowPreset[] = [
  {
    id: 'email_inbox_triage',
    category: 'email',
    title: 'Email Inbox Triage',
    prompt: '帮我整理收件箱',
    description: 'Analyze inbox items, classify priority, mark important messages, and draft replies.',
    steps: [
      { title: 'Analyze inbox', instruction: 'Review incoming messages and extract sender, topic, urgency, and required action.', artifactType: 'json' },
      { title: 'Classify messages', instruction: 'Group messages into urgent, waiting, archive, and draft-reply buckets.', artifactType: 'spreadsheet' },
      { title: 'Mark important', instruction: 'Prepare the list of messages that should be flagged or surfaced to the user.', artifactType: 'report' },
      { title: 'Draft replies', instruction: 'Create concise draft replies for messages that need a response.', artifactType: 'document' },
    ],
  },
  {
    id: 'weekly_sales_report',
    category: 'data_report',
    title: 'Weekly Sales Report',
    prompt: '生成本周销售周报',
    description: 'Query data, analyze trends, generate charts, and package a presentation-ready report.',
    steps: [
      { title: 'Query data', instruction: 'Collect the relevant weekly sales data from available sources or uploaded files.', artifactType: 'spreadsheet' },
      { title: 'Analyze trends', instruction: 'Calculate trend, delta, top products, weak spots, and anomalies.', artifactType: 'json' },
      { title: 'Generate charts', instruction: 'Prepare chart-ready data and visual recommendations.', artifactType: 'image' },
      { title: 'Output presentation', instruction: 'Assemble a concise weekly sales report suitable for slides.', artifactType: 'document' },
    ],
  },
  {
    id: 'pull_request_review',
    category: 'code_review',
    title: 'Pull Request Review',
    prompt: 'Review 这个 PR',
    description: 'Analyze diff, check security, check style, and produce a review report.',
    steps: [
      { title: 'Analyze diff', instruction: 'Read the changed files and summarize behavioral changes.', artifactType: 'code' },
      { title: 'Check security', instruction: 'Identify auth, data exposure, injection, secret, and permission risks.', artifactType: 'report' },
      { title: 'Check style', instruction: 'Compare changes with project conventions and maintainability expectations.', artifactType: 'report' },
      { title: 'Generate review', instruction: 'Write actionable review findings with severity and file references.', artifactType: 'document' },
    ],
  },
  {
    id: 'meeting_notes_to_tasks',
    category: 'meeting',
    title: 'Meeting Notes To Tasks',
    prompt: '整理会议录音',
    description: 'Transcribe a meeting, extract decisions, summarize notes, and create follow-up tasks.',
    steps: [
      { title: 'Transcribe', instruction: 'Convert meeting audio or transcript input into clean speaker-aware text.', artifactType: 'document' },
      { title: 'Extract key points', instruction: 'Identify decisions, risks, owners, and open questions.', artifactType: 'json' },
      { title: 'Create notes', instruction: 'Write a meeting summary with sections for context, decisions, and blockers.', artifactType: 'document' },
      { title: 'Create tasks', instruction: 'Produce a task list with owner, due date, and dependency hints.', artifactType: 'spreadsheet' },
    ],
  },
  {
    id: 'competitor_research',
    category: 'research',
    title: 'Competitor Research',
    prompt: '调研竞品 X 的新功能',
    description: 'Browse competitor pages, capture evidence, compare changes, and output a research report.',
    steps: [
      { title: 'Browse sources', instruction: 'Visit official pages, changelogs, docs, and credible announcements.', artifactType: 'browser_state' },
      { title: 'Capture evidence', instruction: 'Collect screenshots, links, claims, and dated source notes.', artifactType: 'file_bundle' },
      { title: 'Analyze positioning', instruction: 'Compare feature scope, pricing, UX, and likely customer impact.', artifactType: 'json' },
      { title: 'Output report', instruction: 'Write a concise competitor research report with evidence and recommendations.', artifactType: 'report' },
    ],
  },
  {
    id: 'downloads_file_organizer',
    category: 'file_ops',
    title: 'Downloads File Organizer',
    prompt: '整理下载文件夹',
    description: 'Scan files, classify them, detect duplicates, rename safely, and prepare an archive plan.',
    steps: [
      { title: 'Scan files', instruction: 'Inventory files with type, size, modified time, and likely purpose.', artifactType: 'json' },
      { title: 'Classify files', instruction: 'Group files into documents, media, installers, archives, and unknowns.', artifactType: 'spreadsheet' },
      { title: 'Detect duplicates', instruction: 'Find likely duplicates by name, size, and checksum metadata when available.', artifactType: 'json' },
      { title: 'Prepare archive plan', instruction: 'Produce a safe rename/move plan requiring approval before destructive changes.', artifactType: 'report' },
    ],
  },
]

export function listWorkflowPresets(): WorkflowPreset[] {
  return workflowPresets
}

export function getWorkflowPreset(id: string): WorkflowPreset {
  const preset = workflowPresets.find((item) => item.id === id)
  if (!preset) throw new Error(`Workflow preset not found: ${id}`)
  return preset
}

export async function installWorkflowPreset(
  id: string,
  args: { name?: string; status?: WorkflowRow['status'] } = {},
): Promise<WorkflowGraph> {
  const preset = getWorkflowPreset(id)
  const nodeIds = preset.steps.map(() => newWorkflowNodeId())
  const workflow = await createWorkflow({
    name: args.name?.trim() || preset.title,
    description: `${preset.description} Preset prompt: ${preset.prompt}`,
    status: args.status ?? 'draft',
    nodes: preset.steps.map((step, index) => ({
      id: nodeIds[index],
      type: 'artifact_transform',
      position: { x: 80 + index * 220, y: 120 + (index % 2) * 120 },
      config: {
        presetId: preset.id,
        category: preset.category,
        title: step.title,
        instruction: step.instruction,
      },
      inputMapping: index === 0 ? { input: '$workflow.input' } : { input: `$node.${nodeIds[index - 1]}.output` },
      outputContract: {
        artifactType: step.artifactType,
        validationRules: ['preset_step_must_emit_named_artifact'],
      },
      retryPolicy: { maxAttempts: 1 },
      approvalPolicy: step.artifactType === 'desktop_result' ? { requiresApproval: true } : {},
    })),
    edges: nodeIds.slice(0, -1).map((nodeId, index) => ({
      sourceNodeId: nodeId,
      targetNodeId: nodeIds[index + 1],
      mapping: { artifact: 'previous_output' } as JsonObject,
    })),
  })
  return getWorkflowGraph(workflow.id)
}

export async function runWorkflowPreset(
  id: string,
  input: JsonObject = {},
): Promise<{ workflow: WorkflowRow; workflowRun: WorkflowRunRow }> {
  const graph = await installWorkflowPreset(id, { status: 'active' })
  const workflowRun = await startWorkflowRun(graph.workflow.id, {
    presetId: id,
    ...input,
  })
  return { workflow: graph.workflow, workflowRun }
}
