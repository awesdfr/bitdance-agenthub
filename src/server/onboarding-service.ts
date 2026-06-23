import { desc, eq } from 'drizzle-orm'

import { db, schema } from '@/db/client'
import type { JsonObject, OnboardingSessionRow } from '@/db/schema'
import { createAgentProfile } from '@/server/control-plane-service'
import { startEmployeeRun } from '@/server/employee-runtime-service'
import { newOnboardingSessionId } from '@/server/ids'
import { recordAuditLog } from '@/server/security-service'

export type OnboardingWorkType = 'coding' | 'documentation' | 'data' | 'browser' | 'files' | 'other'

export const onboardingWorkTypes: Array<{
  id: OnboardingWorkType
  label: string
  agentName: string
  role: string
  artifactType: string
  capabilityHints: string[]
}> = [
  {
    id: 'coding',
    label: '写代码',
    agentName: 'First Code Agent',
    role: 'Code reviewer and implementation helper',
    artifactType: 'code',
    capabilityHints: ['read files', 'write workspace files', 'run safe commands', 'review diffs'],
  },
  {
    id: 'documentation',
    label: '写文档',
    agentName: 'First Documentation Agent',
    role: 'Documentation writer',
    artifactType: 'document',
    capabilityHints: ['read project docs', 'summarize context', 'produce structured notes'],
  },
  {
    id: 'data',
    label: '处理数据',
    agentName: 'First Data Agent',
    role: 'Data report analyst',
    artifactType: 'spreadsheet',
    capabilityHints: ['read tabular files', 'summarize metrics', 'prepare chart data'],
  },
  {
    id: 'browser',
    label: '浏览网页',
    agentName: 'First Browser Agent',
    role: 'Research browser operator',
    artifactType: 'report',
    capabilityHints: ['browse web', 'collect sources', 'write evidence-backed reports'],
  },
  {
    id: 'files',
    label: '整理文件',
    agentName: 'First File Agent',
    role: 'Safe file organizer',
    artifactType: 'report',
    capabilityHints: ['scan workspace files', 'plan safe moves', 'ask before destructive changes'],
  },
  {
    id: 'other',
    label: '其他',
    agentName: 'First General Agent',
    role: 'General assistant employee',
    artifactType: 'report',
    capabilityHints: ['plan tasks', 'use selected tools', 'produce verifiable summaries'],
  },
]

export async function startOnboardingSession(): Promise<OnboardingSessionRow> {
  const now = Date.now()
  const row: OnboardingSessionRow = {
    id: newOnboardingSessionId(),
    status: 'started',
    currentStep: 'welcome',
    selectedWorkType: null,
    createdAgentProfileId: null,
    demoEmployeeRunId: null,
    checklist: buildChecklist({ welcome: true }),
    createdAt: now,
    updatedAt: now,
    completedAt: null,
  }
  await db.insert(schema.onboardingSessions).values(row)
  await recordAuditLog({
    actorType: 'system',
    action: 'onboarding.start',
    resourceType: 'onboarding_session',
    resourceId: row.id,
    status: 'allowed',
    riskLevel: 'low',
    message: 'Onboarding first lesson started.',
  })
  return row
}

export async function listOnboardingSessions(): Promise<OnboardingSessionRow[]> {
  return db.query.onboardingSessions.findMany({
    orderBy: [desc(schema.onboardingSessions.createdAt)],
    limit: 20,
  })
}

export async function configureOnboardingAgent(
  sessionId: string,
  workType: OnboardingWorkType,
): Promise<OnboardingSessionRow> {
  const session = await getRequiredOnboardingSession(sessionId)
  const config = getWorkTypeConfig(workType)
  const agent = await createAgentProfile({
    name: config.agentName,
    role: config.role,
    description: `Created by the Agent first lesson for ${config.label}.`,
    outputContract: {
      artifactType: config.artifactType,
      validationRules: ['first_lesson_artifact_must_be_reviewable'],
    },
    permissionPolicy: {
      canReadFiles: true,
      canWriteFiles: workType === 'coding' || workType === 'documentation',
      canRunCommands: workType === 'coding',
      canBrowseWeb: workType === 'browser',
      canOperateDesktop: false,
    },
    behaviorRules: [
      'Explain progress in small visible steps.',
      'Ask before destructive operations.',
      ...config.capabilityHints.map((hint) => `Capability hint: ${hint}.`),
    ],
    successCriteria: ['Create one reviewable artifact.', 'Show what was checked.', 'Suggest next steps.'],
  })
  await updateOnboardingSession(session.id, {
    status: 'agent_created',
    currentStep: 'agent_configured',
    selectedWorkType: workType,
    createdAgentProfileId: agent.id,
    checklist: buildChecklist({
      welcome: true,
      needSelected: true,
      agentConfigured: true,
    }),
  })
  await recordAuditLog({
    actorType: 'system',
    action: 'onboarding.agent.configure',
    resourceType: 'agent_profile',
    resourceId: agent.id,
    status: 'allowed',
    riskLevel: 'low',
    message: `First lesson created Agent ${agent.name}.`,
    metadata: { onboardingSessionId: session.id, workType },
  })
  return getRequiredOnboardingSession(session.id)
}

export async function runOnboardingDemo(sessionId: string): Promise<OnboardingSessionRow> {
  const session = await getRequiredOnboardingSession(sessionId)
  if (!session.createdAgentProfileId) throw new Error('Create the first Agent before running demo.')
  const run = await startEmployeeRun({
    agentProfileId: session.createdAgentProfileId,
    goal: 'First lesson demo: inspect README.md for spelling or clarity issues and produce a short report.',
    input: {
      source: 'onboarding_first_lesson',
      demoTask: 'README spelling and clarity check',
    },
  })
  await updateOnboardingSession(session.id, {
    status: 'demo_running',
    currentStep: run.status === 'complete' ? 'demo_complete' : 'demo_running',
    demoEmployeeRunId: run.id,
    checklist: buildChecklist({
      welcome: true,
      needSelected: true,
      agentConfigured: true,
      demoStarted: true,
      demoCompleted: run.status === 'complete',
    }),
  })
  return getRequiredOnboardingSession(session.id)
}

export async function completeOnboardingSession(sessionId: string): Promise<OnboardingSessionRow> {
  const session = await getRequiredOnboardingSession(sessionId)
  await updateOnboardingSession(session.id, {
    status: 'completed',
    currentStep: 'complete',
    completedAt: Date.now(),
    checklist: buildChecklist({
      welcome: true,
      needSelected: Boolean(session.selectedWorkType),
      agentConfigured: Boolean(session.createdAgentProfileId),
      demoStarted: Boolean(session.demoEmployeeRunId),
      demoCompleted: Boolean(session.demoEmployeeRunId),
      completed: true,
    }),
  })
  return getRequiredOnboardingSession(session.id)
}

async function getRequiredOnboardingSession(id: string): Promise<OnboardingSessionRow> {
  const row = await db.query.onboardingSessions.findFirst({
    where: eq(schema.onboardingSessions.id, id),
  })
  if (!row) throw new Error(`Onboarding session not found: ${id}`)
  return row
}

async function updateOnboardingSession(
  id: string,
  patch: Partial<Omit<OnboardingSessionRow, 'id' | 'createdAt'>>,
): Promise<void> {
  await db
    .update(schema.onboardingSessions)
    .set({ ...patch, updatedAt: Date.now() })
    .where(eq(schema.onboardingSessions.id, id))
}

function getWorkTypeConfig(workType: OnboardingWorkType) {
  return onboardingWorkTypes.find((item) => item.id === workType) ?? onboardingWorkTypes.at(-1)!
}

function buildChecklist(values: Record<string, boolean>): JsonObject {
  return {
    welcome: Boolean(values.welcome),
    needSelected: Boolean(values.needSelected),
    agentConfigured: Boolean(values.agentConfigured),
    demoStarted: Boolean(values.demoStarted),
    demoCompleted: Boolean(values.demoCompleted),
    completed: Boolean(values.completed),
    nextSteps: ['Explore Agent templates', 'Create a custom Agent', 'Open Canvas orchestration'],
  }
}
