import { asc, desc, eq } from 'drizzle-orm'

import { db, schema } from '@/db/client'
import type {
  IncidentReportRow,
  IncidentResponseActionRow,
  IncidentResponsePlanRow,
  IncidentSeverity,
  JsonObject,
} from '@/db/schema'
import {
  newIncidentReportId,
  newIncidentResponseActionId,
  newIncidentResponsePlanId,
} from '@/server/ids'

interface DefaultIncidentPlan {
  severity: IncidentSeverity
  title: string
  responseWindowMinutes: number
  triggerExamples: string[]
  actionSequence: string[]
  description: string
}

const actionTitles: Record<string, string> = {
  emergency_stop: 'Emergency stop',
  impact_assessment: 'Assess impact',
  rollback: 'Rollback or isolate affected change',
  notify: 'Notify affected users/stakeholders',
  root_cause_analysis: 'Root cause analysis',
  fix: 'Implement fix',
  postmortem: 'Postmortem and prevention review',
  triage: 'Triage incident',
  mitigation: 'Mitigate active impact',
  data_recovery: 'Recover or verify affected data',
  cost_containment: 'Contain abnormal cost',
  performance_review: 'Review performance degradation',
  schedule_next_release: 'Schedule fix for next release',
}

const defaultIncidentPlans: DefaultIncidentPlan[] = [
  {
    severity: 'P0',
    title: 'P0 Emergency immediate response',
    responseWindowMinutes: 0,
    triggerExamples: ['irreversible_dangerous_agent_action', 'secret_leak', 'exploited_security_vulnerability'],
    actionSequence: [
      'emergency_stop',
      'impact_assessment',
      'rollback',
      'notify',
      'root_cause_analysis',
      'fix',
      'postmortem',
    ],
    description: 'Immediate response for irreversible dangerous actions, secret leakage, or exploited security vulnerabilities.',
  },
  {
    severity: 'P1',
    title: 'P1 High one-hour response',
    responseWindowMinutes: 60,
    triggerExamples: ['large_scale_failure', 'data_loss', 'cost_anomaly'],
    actionSequence: ['triage', 'mitigation', 'data_recovery', 'cost_containment', 'notify', 'root_cause_analysis', 'fix'],
    description: 'Respond within one hour for large-scale failures, data loss, or abnormal cost spikes.',
  },
  {
    severity: 'P2',
    title: 'P2 Medium twenty-four-hour response',
    responseWindowMinutes: 24 * 60,
    triggerExamples: ['non_critical_anomaly', 'performance_degradation'],
    actionSequence: ['triage', 'performance_review', 'mitigation', 'fix'],
    description: 'Respond within 24 hours for non-critical anomalies or performance degradation.',
  },
  {
    severity: 'P3',
    title: 'P3 Low next-release response',
    responseWindowMinutes: 14 * 24 * 60,
    triggerExamples: ['minor_ui_issue'],
    actionSequence: ['triage', 'schedule_next_release', 'fix'],
    description: 'Track low-priority issues for the next release.',
  },
]

export function getDefaultIncidentPlanCount(): number {
  return defaultIncidentPlans.length
}

export async function seedIncidentResponsePlans(): Promise<IncidentResponsePlanRow[]> {
  const now = Date.now()
  for (const plan of defaultIncidentPlans) {
    const existing = await db.query.incidentResponsePlans.findFirst({
      where: eq(schema.incidentResponsePlans.severity, plan.severity),
    })
    if (existing) continue
    await db.insert(schema.incidentResponsePlans).values({
      id: newIncidentResponsePlanId(),
      severity: plan.severity,
      title: plan.title,
      responseWindowMinutes: plan.responseWindowMinutes,
      triggerExamples: plan.triggerExamples,
      actionSequence: plan.actionSequence,
      description: plan.description,
      status: 'active',
      createdAt: now,
      updatedAt: now,
    })
  }
  return listIncidentResponsePlans()
}

export async function listIncidentResponsePlans(): Promise<IncidentResponsePlanRow[]> {
  return db.query.incidentResponsePlans.findMany({
    orderBy: [asc(schema.incidentResponsePlans.responseWindowMinutes)],
    limit: 20,
  })
}

export async function createIncidentReport(args: {
  severity: IncidentSeverity
  title: string
  trigger: string
  affectedResources?: string[]
  evidence?: JsonObject
}): Promise<{
  incident: IncidentReportRow
  actions: IncidentResponseActionRow[]
}> {
  await seedIncidentResponsePlans()
  const plan = await db.query.incidentResponsePlans.findFirst({
    where: eq(schema.incidentResponsePlans.severity, args.severity),
  })
  if (!plan) throw new Error(`Incident response plan not found for ${args.severity}`)
  const now = Date.now()
  const dueAt = now + plan.responseWindowMinutes * 60 * 1000
  const incidentId = newIncidentReportId()
  const responseSummary = {
    requiresEmergencyStop: args.severity === 'P0',
    responseWindowMinutes: plan.responseWindowMinutes,
    actionSequence: plan.actionSequence,
  }
  await db.insert(schema.incidentReports).values({
    id: incidentId,
    severity: args.severity,
    title: args.title.trim(),
    trigger: args.trigger.trim(),
    status: args.severity === 'P0' ? 'mitigating' : 'open',
    responsePlanId: plan.id,
    affectedResources: args.affectedResources ?? [],
    evidence: args.evidence ?? {},
    responseSummary,
    openedAt: now,
    dueAt,
    resolvedAt: null,
  })

  const actions: IncidentResponseActionRow[] = []
  for (const [index, actionKey] of plan.actionSequence.entries()) {
    const action = {
      id: newIncidentResponseActionId(),
      incidentId,
      actionKey,
      title: actionTitles[actionKey] ?? actionKey,
      status: 'pending' as const,
      required: true,
      dueAt: dueAt + index * 5 * 60 * 1000,
      completedAt: null,
      evidence: {},
      createdAt: now,
      updatedAt: now,
    }
    await db.insert(schema.incidentResponseActions).values(action)
    actions.push(action)
  }
  const incident = await getRequiredIncidentReport(incidentId)
  return { incident, actions }
}

export async function listIncidentReports(args: {
  severity?: IncidentSeverity
} = {}): Promise<IncidentReportRow[]> {
  return db.query.incidentReports.findMany({
    where: args.severity ? eq(schema.incidentReports.severity, args.severity) : undefined,
    orderBy: [desc(schema.incidentReports.openedAt)],
    limit: 100,
  })
}

export async function listIncidentResponseActions(args: {
  incidentId?: string
} = {}): Promise<IncidentResponseActionRow[]> {
  return db.query.incidentResponseActions.findMany({
    where: args.incidentId ? eq(schema.incidentResponseActions.incidentId, args.incidentId) : undefined,
    orderBy: [asc(schema.incidentResponseActions.createdAt)],
    limit: 200,
  })
}

export async function completeIncidentResponseAction(
  actionId: string,
  evidence: JsonObject = {},
): Promise<IncidentResponseActionRow> {
  const action = await db.query.incidentResponseActions.findFirst({
    where: eq(schema.incidentResponseActions.id, actionId),
  })
  if (!action) throw new Error(`Incident response action not found: ${actionId}`)
  const now = Date.now()
  await db
    .update(schema.incidentResponseActions)
    .set({
      status: 'completed',
      completedAt: now,
      evidence,
      updatedAt: now,
    })
    .where(eq(schema.incidentResponseActions.id, actionId))
  return getRequiredIncidentResponseAction(actionId)
}

async function getRequiredIncidentReport(id: string): Promise<IncidentReportRow> {
  const row = await db.query.incidentReports.findFirst({
    where: eq(schema.incidentReports.id, id),
  })
  if (!row) throw new Error(`Incident report not found: ${id}`)
  return row
}

async function getRequiredIncidentResponseAction(id: string): Promise<IncidentResponseActionRow> {
  const row = await db.query.incidentResponseActions.findFirst({
    where: eq(schema.incidentResponseActions.id, id),
  })
  if (!row) throw new Error(`Incident response action not found: ${id}`)
  return row
}
