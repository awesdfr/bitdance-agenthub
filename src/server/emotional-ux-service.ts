import { and, asc, eq, type SQL } from 'drizzle-orm'

import { db, schema } from '@/db/client'
import type {
  EmotionalUxGuidelineRow,
  EmotionalUxGuidelineType,
  EmotionalUxStatus,
} from '@/db/schema'
import { newEmotionalUxGuidelineId } from '@/server/ids'

export interface CreateEmotionalUxGuidelineArgs {
  guidelineType: EmotionalUxGuidelineType
  scenarioKey: string
  title: string
  messageTemplate?: string
  behavior?: string
  visualCue?: string
  audioCue?: string
  anxietyReduction?: string
  status?: EmotionalUxStatus
}

const defaultGuidelines: CreateEmotionalUxGuidelineArgs[] = [
  {
    guidelineType: 'tone',
    scenarioKey: 'task_start',
    title: 'Start task with confident colleague tone',
    messageTemplate: 'Okay, I will handle {goal}. I am checking the current state first.',
    behavior: 'positive_clear_dependable',
  },
  {
    guidelineType: 'tone',
    scenarioKey: 'in_progress',
    title: 'Report progress transparently',
    messageTemplate: 'I found {finding}. I am now working on {nextAction}.',
    behavior: 'transparent_realtime_progress',
  },
  {
    guidelineType: 'tone',
    scenarioKey: 'blocked',
    title: 'Ask for help honestly when blocked',
    messageTemplate: 'This part is more complex than expected. I can try another route or use your direction.',
    behavior: 'honest_non_defensive_help_request',
  },
  {
    guidelineType: 'tone',
    scenarioKey: 'completed',
    title: 'Finish with measurable result and artifact',
    messageTemplate: 'Done. The result is {result}. The detailed artifact is ready for review.',
    behavior: 'outcome_artifact_verifiable',
  },
  {
    guidelineType: 'tone',
    scenarioKey: 'failed',
    title: 'Take responsibility after failure',
    messageTemplate: 'I could not complete this. The reason is {reason}. I recorded the lesson for next time.',
    behavior: 'responsible_summary_learning',
  },
  {
    guidelineType: 'microinteraction',
    scenarioKey: 'thinking_pause',
    title: 'Thinking pause animation',
    behavior: 'show_small_pre_typing_pause',
    visualCue: 'subtle_thinking_animation',
  },
  {
    guidelineType: 'microinteraction',
    scenarioKey: 'tool_success',
    title: 'Tool success feedback',
    behavior: 'confirm_success_without_interrupting_flow',
    visualCue: 'light_check_animation',
  },
  {
    guidelineType: 'microinteraction',
    scenarioKey: 'tool_failure',
    title: 'Tool failure feedback',
    behavior: 'show_soft_warning_and_next_recovery_step',
    visualCue: 'soft_warning_signal',
  },
  {
    guidelineType: 'microinteraction',
    scenarioKey: 'long_operation',
    title: 'Long operation progress',
    behavior: 'show_percent_and_estimated_time_remaining',
    visualCue: 'progress_bar_with_eta',
  },
  {
    guidelineType: 'microinteraction',
    scenarioKey: 'approval_request',
    title: 'Gentle approval request',
    behavior: 'request_attention_without_alarm_fatigue',
    audioCue: 'gentle_reminder_tone',
  },
  {
    guidelineType: 'microinteraction',
    scenarioKey: 'all_tasks_complete',
    title: 'Small completion celebration',
    behavior: 'celebrate_completion_subtly',
    visualCue: 'small_celebration_animation',
  },
  {
    guidelineType: 'anxiety_reduction',
    scenarioKey: 'working_vs_waiting',
    title: 'Separate working and waiting states',
    behavior: 'label_agent_state_as_working_or_waiting',
    anxietyReduction: 'Users can tell whether the Agent is active or blocked.',
  },
  {
    guidelineType: 'anxiety_reduction',
    scenarioKey: 'long_silence_update',
    title: 'Update during long silence',
    messageTemplate: 'Still processing. Completed {completedSteps}/{totalSteps} steps.',
    behavior: 'send_periodic_progress_update',
    anxietyReduction: 'Avoids the feeling that the Agent disappeared.',
  },
  {
    guidelineType: 'anxiety_reduction',
    scenarioKey: 'dangerous_action_warning',
    title: 'Dangerous action requires stronger confirmation',
    behavior: 'show_red_warning_and_extra_confirm_click',
    visualCue: 'danger_visual_warning',
    anxietyReduction: 'Makes risky operations visibly different from routine actions.',
  },
  {
    guidelineType: 'anxiety_reduction',
    scenarioKey: 'agent_activity_visibility',
    title: 'Always show what the Agent is doing',
    behavior: 'surface_current_goal_step_tool_and_next_action',
    anxietyReduction: 'Users can inspect current Agent activity at any time.',
  },
  {
    guidelineType: 'anxiety_reduction',
    scenarioKey: 'emergency_stop_visible',
    title: 'Emergency stop is always visible',
    behavior: 'keep_emergency_stop_available_on_run_surfaces',
    visualCue: 'persistent_stop_control',
    anxietyReduction: 'Users retain immediate control over Agent behavior.',
  },
]

export function getDefaultEmotionalUxGuidelineCount(): number {
  return defaultGuidelines.length
}

export async function seedEmotionalUxGuidelines(): Promise<EmotionalUxGuidelineRow[]> {
  const rows: EmotionalUxGuidelineRow[] = []
  for (const guideline of defaultGuidelines) {
    const existing = await db.query.emotionalUxGuidelines.findFirst({
      where: eq(schema.emotionalUxGuidelines.scenarioKey, guideline.scenarioKey),
    })
    if (existing) {
      rows.push(existing)
      continue
    }
    rows.push(await createEmotionalUxGuideline(guideline))
  }
  return rows.sort((a, b) => a.scenarioKey.localeCompare(b.scenarioKey))
}

export async function createEmotionalUxGuideline(
  args: CreateEmotionalUxGuidelineArgs,
): Promise<EmotionalUxGuidelineRow> {
  const now = Date.now()
  const row = {
    id: newEmotionalUxGuidelineId(),
    guidelineType: args.guidelineType,
    scenarioKey: args.scenarioKey.trim(),
    title: args.title.trim(),
    messageTemplate: args.messageTemplate?.trim() ?? '',
    behavior: args.behavior?.trim() ?? '',
    visualCue: args.visualCue?.trim() ?? '',
    audioCue: args.audioCue?.trim() ?? '',
    anxietyReduction: args.anxietyReduction?.trim() ?? '',
    status: args.status ?? 'active',
    createdAt: now,
    updatedAt: now,
  }
  await db.insert(schema.emotionalUxGuidelines).values(row)
  return row
}

export async function listEmotionalUxGuidelines(args: {
  guidelineType?: EmotionalUxGuidelineType
  status?: EmotionalUxStatus
  limit?: number
} = {}): Promise<EmotionalUxGuidelineRow[]> {
  const conditions: SQL[] = []
  if (args.guidelineType) conditions.push(eq(schema.emotionalUxGuidelines.guidelineType, args.guidelineType))
  if (args.status) conditions.push(eq(schema.emotionalUxGuidelines.status, args.status))
  return db.query.emotionalUxGuidelines.findMany({
    where: conditions.length ? and(...conditions) : undefined,
    orderBy: [asc(schema.emotionalUxGuidelines.guidelineType), asc(schema.emotionalUxGuidelines.scenarioKey)],
    limit: args.limit ?? 100,
  })
}
