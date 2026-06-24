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
  deliverableTitle?: string
  deliveryDescription?: string
  customerVisible?: boolean
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
    title: '收件箱处理流程',
    prompt: '帮我整理收件箱',
    description: '整理消息、判断优先级、标记重要事项，并生成可直接审核的回复草稿。',
    steps: [
      { title: '读取消息', instruction: '梳理新消息，提取发件人、主题、紧急程度和需要处理的动作。', artifactType: 'json', deliverableTitle: '消息结构化清单', deliveryDescription: '把原始消息整理成机器可读的分类数据。' },
      { title: '分类优先级', instruction: '把消息分为紧急、等待、归档、需要回复四类。', artifactType: 'spreadsheet', deliverableTitle: '收件箱优先级表', deliveryDescription: '客户可以直接查看每条消息的处理优先级。' },
      { title: '标记重点', instruction: '列出必须提醒用户注意的重要消息和原因。', artifactType: 'report', deliverableTitle: '重点消息报告', deliveryDescription: '汇总需要立即处理或人工确认的消息。' },
      { title: '生成回复草稿', instruction: '为需要回复的消息生成简洁、可修改的回复草稿。', artifactType: 'document', deliverableTitle: '回复草稿文档', deliveryDescription: '客户可以直接复制、修改和发送的回复草稿。' },
    ],
  },
  {
    id: 'weekly_sales_report',
    category: 'data_report',
    title: '销售周报交付流',
    prompt: '生成本周销售周报',
    description: '收集销售数据、分析趋势、生成图表，并输出可给客户看的周报。',
    steps: [
      { title: '收集销售数据', instruction: '从可用数据源或用户上传文件中整理本周销售数据。', artifactType: 'spreadsheet', deliverableTitle: '销售数据表', deliveryDescription: '包含本周销售数据、字段说明和基础清洗结果。' },
      { title: '分析销售趋势', instruction: '计算趋势、环比变化、畅销品、薄弱项和异常点。', artifactType: 'json', deliverableTitle: '销售分析数据', deliveryDescription: '给后续图表和报告使用的结构化分析结果。' },
      { title: '生成图表', instruction: '生成适合周报展示的图表数据和视觉建议。', artifactType: 'image', deliverableTitle: '周报图表', deliveryDescription: '客户可直接放进周报或演示文稿的图表。' },
      { title: '输出周报', instruction: '整合结论、图表和建议，输出简洁的销售周报。', artifactType: 'document', deliverableTitle: '销售周报', deliveryDescription: '最终给客户看的周报文档。' },
    ],
  },
  {
    id: 'pull_request_review',
    category: 'code_review',
    title: '代码审查交付流',
    prompt: 'Review 这个 PR',
    description: '阅读代码变更、检查安全和质量问题，并输出可执行的审查意见。',
    steps: [
      { title: '分析代码变更', instruction: '读取变更文件，总结行为变化和影响范围。', artifactType: 'code', deliverableTitle: '代码变更摘要', deliveryDescription: '说明本次 PR 改了什么、可能影响哪些模块。' },
      { title: '检查安全风险', instruction: '识别鉴权、数据暴露、注入、密钥和权限相关风险。', artifactType: 'report', deliverableTitle: '安全风险清单', deliveryDescription: '列出需要优先修复的安全问题。' },
      { title: '检查工程质量', instruction: '对照项目规范检查可维护性、测试覆盖和代码风格。', artifactType: 'report', deliverableTitle: '工程质量报告', deliveryDescription: '指出可维护性、测试和架构层面的风险。' },
      { title: '生成审查意见', instruction: '输出带严重程度、文件位置和修改建议的代码审查结论。', artifactType: 'document', deliverableTitle: '代码审查报告', deliveryDescription: '客户或开发者可以直接执行的 review findings。' },
    ],
  },
  {
    id: 'meeting_notes_to_tasks',
    category: 'meeting',
    title: '会议纪要转任务',
    prompt: '整理会议录音',
    description: '整理会议内容、提取决策和风险，并生成可跟进的任务清单。',
    steps: [
      { title: '整理转写稿', instruction: '把会议录音或原始纪要整理成干净的发言文本。', artifactType: 'document', deliverableTitle: '会议转写稿', deliveryDescription: '可追溯会议原文和发言内容的文本稿。' },
      { title: '提取关键事项', instruction: '识别会议决策、风险、负责人和未决问题。', artifactType: 'json', deliverableTitle: '关键事项数据', deliveryDescription: '给任务表和纪要复用的结构化会议结论。' },
      { title: '生成会议纪要', instruction: '写出包含背景、决策、风险和阻塞项的会议摘要。', artifactType: 'document', deliverableTitle: '会议纪要', deliveryDescription: '客户可以直接归档或转发的会议纪要。' },
      { title: '生成任务清单', instruction: '输出带负责人、截止日期和依赖关系的待办表。', artifactType: 'spreadsheet', deliverableTitle: '会后任务表', deliveryDescription: '团队可以直接跟进执行的任务清单。' },
    ],
  },
  {
    id: 'competitor_research',
    category: 'research',
    title: '竞品调研交付流',
    prompt: '调研竞品 X 的新功能',
    description: '访问竞品资料、采集证据、对比功能和定位，并输出调研报告。',
    steps: [
      { title: '浏览资料来源', instruction: '访问官网、更新日志、文档和可信公告。', artifactType: 'browser_state', deliverableTitle: '资料来源快照', deliveryDescription: '保留调研过程中的网页状态、链接和截图线索。' },
      { title: '采集证据', instruction: '收集截图、链接、声明和带日期的来源备注。', artifactType: 'file_bundle', deliverableTitle: '竞品证据包', deliveryDescription: '客户可复核的截图、链接和原始证据集合。' },
      { title: '分析定位', instruction: '对比功能范围、价格、UX 和潜在客户影响。', artifactType: 'json', deliverableTitle: '竞品对比数据', deliveryDescription: '用于生成报告的结构化对比结论。' },
      { title: '输出调研报告', instruction: '写出包含证据、差异和建议的竞品调研报告。', artifactType: 'report', deliverableTitle: '竞品调研报告', deliveryDescription: '最终给客户看的竞品分析报告。' },
    ],
  },
  {
    id: 'downloads_file_organizer',
    category: 'file_ops',
    title: '下载文件整理',
    prompt: '整理下载文件夹',
    description: '扫描文件、分类归档、识别重复项，并生成安全的整理方案。',
    steps: [
      { title: '扫描文件', instruction: '盘点文件类型、大小、修改时间和可能用途。', artifactType: 'json', deliverableTitle: '文件盘点数据', deliveryDescription: '下载目录的结构化文件清单。' },
      { title: '文件分类', instruction: '把文件分为文档、媒体、安装包、压缩包和未知类型。', artifactType: 'spreadsheet', deliverableTitle: '文件分类表', deliveryDescription: '客户可以直接查看和确认的文件分类结果。' },
      { title: '识别重复项', instruction: '根据名称、大小和可用校验信息找出疑似重复文件。', artifactType: 'json', deliverableTitle: '重复文件清单', deliveryDescription: '删除或移动前需要人工确认的重复文件列表。' },
      { title: '生成整理方案', instruction: '生成安全的重命名和移动计划，破坏性动作前必须审批。', artifactType: 'report', deliverableTitle: '文件整理方案', deliveryDescription: '最终执行前给客户确认的整理计划。' },
    ],
  },
  {
    id: 'jianying_video_delivery',
    category: 'video_delivery',
    title: '剪映视频交付流',
    prompt: '帮我做一条可交付的视频',
    description: '整理素材、生成剪辑方案、调用剪映草稿/导出能力，并输出客户可验收的视频交付物。',
    steps: [
      { title: '整理视频需求', instruction: '根据客户目标、素材和发布平台，整理视频规格、时长、比例和验收标准。', artifactType: 'document', deliverableTitle: '视频需求说明', deliveryDescription: '明确这条视频要做成什么样，避免后续剪辑跑偏。' },
      { title: '生成剪辑脚本', instruction: '输出镜头顺序、字幕文案、音乐节奏和转场建议。', artifactType: 'document', deliverableTitle: '剪辑脚本', deliveryDescription: '剪映或人工剪辑可以直接照着执行的脚本。' },
      { title: '准备剪映草稿', instruction: '检查剪映草稿目录、素材文件和可调用的软件命令，生成草稿准备报告。', artifactType: 'software_result', deliverableTitle: '剪映草稿准备结果', deliveryDescription: '说明剪映草稿、素材和自动化命令是否就绪。' },
      { title: '导出视频成片', instruction: '完成剪辑结果检查，输出视频文件、封面和导出记录。', artifactType: 'video', deliverableTitle: '视频成片', deliveryDescription: '客户最终验收的视频文件，包含封面和导出说明。' },
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
        customerVisible: step.customerVisible ?? true,
        deliverableTitle: step.deliverableTitle ?? step.title,
        deliveryDescription: step.deliveryDescription ?? step.instruction,
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
