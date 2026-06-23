import { and, desc, eq } from 'drizzle-orm'

import { db, schema } from '@/db/client'
import type {
  FutureTechCapabilityKind,
  FutureTechInterfaceRow,
  FutureTechRadarItemRow,
  FutureTechRadarStatus,
  FutureTechReadiness,
  FutureTechStage,
  JsonObject,
} from '@/db/schema'
import {
  newFutureTechInterfaceId,
  newFutureTechRadarItemId,
} from '@/server/ids'
import { recordAuditLog } from '@/server/security-service'

export interface CreateFutureTechInterfaceArgs {
  capabilityKind: FutureTechCapabilityKind
  displayName: string
  abstractionName: string
  description?: string
  reservedMethods?: string[]
  safetyBoundary?: string
  localFirst?: boolean
  readiness?: FutureTechReadiness
}

export interface CreateFutureTechRadarItemArgs {
  stage: FutureTechStage
  title: string
  description?: string
  capabilityKinds?: FutureTechCapabilityKind[]
  dependencies?: string[]
  status?: FutureTechRadarStatus
}

export interface FutureTechRoadmap {
  interfaces: FutureTechInterfaceRow[]
  radarItems: FutureTechRadarItemRow[]
}

const defaultInterfaces: CreateFutureTechInterfaceArgs[] = [
  {
    capabilityKind: 'compute_provider',
    displayName: 'Hybrid compute provider',
    abstractionName: 'IComputeProvider',
    description: 'Reserves a local-first to hybrid compute boundary for cloud offload later.',
    reservedMethods: ['estimate(job)', 'schedule(job, placementPolicy)', 'execute(job)', 'cancel(jobId)'],
    safetyBoundary: 'Sensitive data stays local; cloud execution remains policy and approval gated.',
    localFirst: true,
  },
  {
    capabilityKind: 'computer_use',
    displayName: 'Native computer use',
    abstractionName: 'IComputerUse',
    description: 'Reserves pixel/screen-native observation and action APIs beyond DOM/API automation.',
    reservedMethods: ['observeScreen()', 'readPixels(region)', 'click(point)', 'type(text)', 'waitFor(condition)'],
    safetyBoundary: 'Live OS action requires workstation isolation, resource locks, and user approval.',
    localFirst: true,
  },
  {
    capabilityKind: 'reinforcement_learning',
    displayName: 'Autonomous learning loop',
    abstractionName: 'IReinforcementLearning',
    description: 'Reserves a reviewed learning path from observations to reusable policies.',
    reservedMethods: ['recordEpisode(runId)', 'proposePolicy(memory)', 'evaluatePolicy(policy)', 'promotePolicy(policyId)'],
    safetyBoundary: 'Learned procedures are proposed artifacts until reviewed and approved.',
    localFirst: true,
  },
  {
    capabilityKind: 'model_router',
    displayName: 'Model routing network',
    abstractionName: 'IModelRouter',
    description: 'Reserves dynamic per-step model selection across capability, cost, latency, and fallback.',
    reservedMethods: ['routeStep(step)', 'scoreCandidates(step)', 'fallback(routeDecision)', 'recordOutcome(result)'],
    safetyBoundary: 'Routing is dry-run/record-only until model credentials and budgets are explicitly configured.',
    localFirst: true,
  },
  {
    capabilityKind: 'os_integration',
    displayName: 'OS integration adapter',
    abstractionName: 'IOSIntegration',
    description: 'Reserves operating-system-native intent, search, and automation integration.',
    reservedMethods: ['registerIntent(intent)', 'observeSystemState()', 'requestAutomation(action)', 'revokeIntent(id)'],
    safetyBoundary: 'No system setting or destructive OS mutation is allowed without explicit approval.',
    localFirst: true,
  },
  {
    capabilityKind: 'organization_service',
    displayName: 'Organization deployment service',
    abstractionName: 'IOrganizationService',
    description: 'Reserves tenant, identity, policy, and cross-user Agent collaboration boundaries.',
    reservedMethods: ['resolveTenant(user)', 'getPolicy(scope)', 'shareAgent(agentId, audience)', 'auditOrgAction(action)'],
    safetyBoundary: 'No live IdP, customer data, or multi-tenant sharing occurs without configured org policy.',
    localFirst: false,
  },
  {
    capabilityKind: 'proactive_agent',
    displayName: 'Proactive coworker adapter',
    abstractionName: 'IProactiveAgent',
    description: 'Reserves a propose-first interface for Agents that notice issues and ask to help.',
    reservedMethods: ['detectOpportunity(signal)', 'draftProposal(opportunity)', 'requestApproval(proposal)', 'recordOutcome(outcome)'],
    safetyBoundary: 'Proactive Agents can propose and request approval, but cannot self-start risky work.',
    localFirst: true,
  },
]

const defaultRadarItems: CreateFutureTechRadarItemArgs[] = [
  {
    stage: 'v1_now',
    title: 'Desktop app + SQLite + single-machine Agent',
    description: 'Current local-first baseline with persisted control plane and single-machine runtime.',
    capabilityKinds: ['compute_provider', 'model_router'],
    dependencies: ['local database', 'desktop shell'],
    status: 'available',
  },
  {
    stage: 'v2_near',
    title: 'Virtual workstations + mobile companion',
    description: 'Adds isolated Agent workstations and phone approval/progress surfaces.',
    capabilityKinds: ['computer_use', 'os_integration'],
    dependencies: ['workstation manager', 'mobile companion'],
    status: 'planned',
  },
  {
    stage: 'v3_mid',
    title: 'Cloud worker + team collaboration',
    description: 'Adds cloud offload and organization/team collaboration controls.',
    capabilityKinds: ['compute_provider', 'organization_service'],
    dependencies: ['cloud worker queue', 'organization policy'],
    status: 'planned',
  },
  {
    stage: 'v4_far',
    title: 'Autonomous learning + multimodal native + organization deployment',
    description: 'Adds reviewed autonomous learning, native multimodal computer use, and org deployment.',
    capabilityKinds: ['reinforcement_learning', 'computer_use', 'proactive_agent', 'organization_service'],
    dependencies: ['learning review', 'native multimodal runtime', 'tenant governance'],
    status: 'planned',
  },
]

export async function createFutureTechInterface(
  args: CreateFutureTechInterfaceArgs,
): Promise<FutureTechInterfaceRow> {
  const now = Date.now()
  const row: FutureTechInterfaceRow = {
    id: newFutureTechInterfaceId(),
    capabilityKind: args.capabilityKind,
    displayName: args.displayName.trim(),
    abstractionName: args.abstractionName.trim(),
    description: args.description?.trim() ?? '',
    reservedMethods: args.reservedMethods?.map((method) => method.trim()).filter(Boolean) ?? [],
    safetyBoundary: args.safetyBoundary?.trim() ?? '',
    localFirst: args.localFirst ?? true,
    readiness: args.readiness ?? 'reserved',
    createdAt: now,
    updatedAt: now,
  }
  await db.insert(schema.futureTechInterfaces).values(row)
  await recordAuditLog({
    actorType: 'system',
    action: 'future_tech.interface.create',
    resourceType: 'future_tech_interface',
    resourceId: row.id,
    status: 'allowed',
    riskLevel: 'low',
    message: `Reserved ${row.abstractionName}.`,
    metadata: interfaceSnapshot(row),
  })
  return row
}

export async function listFutureTechInterfaces(args: {
  capabilityKind?: FutureTechCapabilityKind
  readiness?: FutureTechReadiness
  limit?: number
} = {}): Promise<FutureTechInterfaceRow[]> {
  const filters = [
    args.capabilityKind ? eq(schema.futureTechInterfaces.capabilityKind, args.capabilityKind) : undefined,
    args.readiness ? eq(schema.futureTechInterfaces.readiness, args.readiness) : undefined,
  ].filter(Boolean)
  return db.query.futureTechInterfaces.findMany({
    where: filters.length > 0 ? and(...filters) : undefined,
    orderBy: [desc(schema.futureTechInterfaces.updatedAt)],
    limit: Math.min(Math.max(args.limit ?? 50, 1), 200),
  })
}

export async function createFutureTechRadarItem(
  args: CreateFutureTechRadarItemArgs,
): Promise<FutureTechRadarItemRow> {
  const now = Date.now()
  const row: FutureTechRadarItemRow = {
    id: newFutureTechRadarItemId(),
    stage: args.stage,
    title: args.title.trim(),
    description: args.description?.trim() ?? '',
    capabilityKinds: args.capabilityKinds ?? [],
    dependencies: args.dependencies?.map((dependency) => dependency.trim()).filter(Boolean) ?? [],
    status: args.status ?? 'planned',
    createdAt: now,
    updatedAt: now,
  }
  await db.insert(schema.futureTechRadarItems).values(row)
  await recordAuditLog({
    actorType: 'system',
    action: 'future_tech.radar.create',
    resourceType: 'future_tech_radar_item',
    resourceId: row.id,
    status: 'allowed',
    riskLevel: 'low',
    message: `Reserved future radar stage ${row.stage}.`,
    metadata: radarSnapshot(row),
  })
  return row
}

export async function listFutureTechRadarItems(args: {
  stage?: FutureTechStage
  status?: FutureTechRadarStatus
  limit?: number
} = {}): Promise<FutureTechRadarItemRow[]> {
  const filters = [
    args.stage ? eq(schema.futureTechRadarItems.stage, args.stage) : undefined,
    args.status ? eq(schema.futureTechRadarItems.status, args.status) : undefined,
  ].filter(Boolean)
  return db.query.futureTechRadarItems.findMany({
    where: filters.length > 0 ? and(...filters) : undefined,
    orderBy: [desc(schema.futureTechRadarItems.updatedAt)],
    limit: Math.min(Math.max(args.limit ?? 50, 1), 200),
  })
}

export async function seedFutureTechRoadmap(): Promise<FutureTechRoadmap> {
  for (const item of defaultInterfaces) {
    const existing = await db.query.futureTechInterfaces.findFirst({
      where: eq(schema.futureTechInterfaces.capabilityKind, item.capabilityKind),
    })
    if (!existing) await createFutureTechInterface(item)
  }
  for (const item of defaultRadarItems) {
    const existing = await db.query.futureTechRadarItems.findFirst({
      where: and(
        eq(schema.futureTechRadarItems.stage, item.stage),
        eq(schema.futureTechRadarItems.title, item.title),
      ),
    })
    if (!existing) await createFutureTechRadarItem(item)
  }
  return {
    interfaces: await listFutureTechInterfaces({ limit: 100 }),
    radarItems: await listFutureTechRadarItems({ limit: 100 }),
  }
}

function interfaceSnapshot(row: FutureTechInterfaceRow): JsonObject {
  return {
    capabilityKind: row.capabilityKind,
    abstractionName: row.abstractionName,
    reservedMethods: row.reservedMethods,
    readiness: row.readiness,
    localFirst: row.localFirst,
    safetyBoundary: row.safetyBoundary,
  }
}

function radarSnapshot(row: FutureTechRadarItemRow): JsonObject {
  return {
    stage: row.stage,
    capabilityKinds: row.capabilityKinds,
    dependencies: row.dependencies,
    status: row.status,
  }
}
