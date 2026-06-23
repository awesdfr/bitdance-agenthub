import { and, asc, eq, type SQL } from 'drizzle-orm'

import { db, schema } from '@/db/client'
import type {
  ArchitectureAbstractionKind,
  ArchitectureEvolutionReservationRow,
  ArchitectureEvolutionStatus,
  ArchitectureEvolutionTrack,
  JsonObject,
} from '@/db/schema'
import { newArchitectureEvolutionReservationId } from '@/server/ids'

interface DefaultArchitectureEvolutionReservation {
  track: ArchitectureEvolutionTrack
  abstractionKind: ArchitectureAbstractionKind
  abstractionName: string
  currentImplementation: string
  futureImplementation: string
  migrationTrigger: string
  notes: string
  evidence: JsonObject
}

export interface CreateArchitectureEvolutionReservationArgs {
  track: ArchitectureEvolutionTrack
  abstractionKind: ArchitectureAbstractionKind
  abstractionName: string
  currentImplementation: string
  futureImplementation: string
  migrationTrigger: string
  notes?: string
  evidence?: JsonObject
  status?: ArchitectureEvolutionStatus
}

const defaultReservations: DefaultArchitectureEvolutionReservation[] = [
  {
    track: 'single_machine_to_cluster',
    abstractionKind: 'event_bus',
    abstractionName: 'IEventBus',
    currentImplementation: 'In-process event feed and SSE helpers.',
    futureImplementation: 'Redis Streams or NATS-backed distributed event bus.',
    migrationTrigger: 'Multiple Agent Runtime workers need cross-process event delivery.',
    notes: 'Keep runtime publishers behind an event bus interface.',
    evidence: { planRequirement: 'Event Bus can move from process memory to Redis/NATS.' },
  },
  {
    track: 'single_machine_to_cluster',
    abstractionKind: 'storage',
    abstractionName: 'IStorage',
    currentImplementation: 'SQLite plus local workspace filesystem.',
    futureImplementation: 'PostgreSQL or LiteFS plus shared/object storage.',
    migrationTrigger: 'Team or cluster deployment needs shared state and artifacts.',
    notes: 'Keep persistence callers behind database and workspace storage adapters.',
    evidence: { planRequirement: 'SQLite can move to PostgreSQL/LiteFS and files to shared storage.' },
  },
  {
    track: 'single_machine_to_cluster',
    abstractionKind: 'lock_service',
    abstractionName: 'ILockService',
    currentImplementation: 'Local resource_locks table and in-process coordination.',
    futureImplementation: 'etcd or Redis distributed lock adapter.',
    migrationTrigger: 'Multiple workers compete for desktop, VM, file, or device resources.',
    notes: 'Resource lock semantics stay stable while the backend changes.',
    evidence: { planRequirement: 'Resource locks need a distributed lock in cluster mode.' },
  },
  {
    track: 'cloud_worker',
    abstractionKind: 'runtime_worker',
    abstractionName: 'IRuntimeWorker',
    currentImplementation: 'Local desktop Agent Runtime process.',
    futureImplementation: 'Optional cloud worker for heavy tasks.',
    migrationTrigger: 'User opts into offloading expensive or long-running work.',
    notes: 'v1 remains local-first; cloud worker is a v2 optional adapter.',
    evidence: { planRequirement: 'v2 optional cloud worker can offload heavy tasks.' },
  },
  {
    track: 'saas_private_deploy',
    abstractionKind: 'deployment',
    abstractionName: 'IDeploymentTarget',
    currentImplementation: 'Local desktop app deployment.',
    futureImplementation: 'SaaS or private deployment target.',
    migrationTrigger: 'Organization needs managed multi-user deployment.',
    notes: 'Deployment target stays explicit so v1 does not accidentally become cloud-first.',
    evidence: { planRequirement: 'v3 SaaS/private deployment version is reserved.' },
  },
  {
    track: 'mobile_future',
    abstractionKind: 'mobile_interface',
    abstractionName: 'IMobileAgentSurface',
    currentImplementation: 'Mobile companion progress and approval APIs.',
    futureImplementation: 'Voice tasks, image upload, AR status, and mobile app control adapters.',
    migrationTrigger: 'Mobile companion grows beyond progress viewing into interaction and control.',
    notes: 'Android Accessibility Service and iOS limitations stay behind platform adapters.',
    evidence: {
      planRequirement: 'Future mobile can send voice tasks, images, AR status, and direct app operation.',
    },
  },
]

export function getDefaultArchitectureEvolutionReservationCount(): number {
  return defaultReservations.length
}

export async function seedArchitectureEvolutionReservations(): Promise<ArchitectureEvolutionReservationRow[]> {
  for (const item of defaultReservations) {
    const existing = await db.query.architectureEvolutionReservations.findFirst({
      where: eq(schema.architectureEvolutionReservations.abstractionName, item.abstractionName),
    })
    if (existing) continue
    await createArchitectureEvolutionReservation(item)
  }
  return listArchitectureEvolutionReservations()
}

export async function createArchitectureEvolutionReservation(
  args: CreateArchitectureEvolutionReservationArgs,
): Promise<ArchitectureEvolutionReservationRow> {
  const now = Date.now()
  const row: ArchitectureEvolutionReservationRow = {
    id: newArchitectureEvolutionReservationId(),
    track: args.track,
    abstractionKind: args.abstractionKind,
    abstractionName: normalizeRequired(args.abstractionName, 'abstractionName'),
    currentImplementation: normalizeRequired(args.currentImplementation, 'currentImplementation'),
    futureImplementation: normalizeRequired(args.futureImplementation, 'futureImplementation'),
    migrationTrigger: normalizeRequired(args.migrationTrigger, 'migrationTrigger'),
    notes: args.notes?.trim() ?? '',
    evidence: args.evidence ?? {},
    status: args.status ?? 'reserved',
    createdAt: now,
    updatedAt: now,
  }
  await db.insert(schema.architectureEvolutionReservations).values(row)
  return row
}

export async function listArchitectureEvolutionReservations(args: {
  track?: ArchitectureEvolutionTrack
  abstractionKind?: ArchitectureAbstractionKind
  status?: ArchitectureEvolutionStatus
  limit?: number
} = {}): Promise<ArchitectureEvolutionReservationRow[]> {
  const filters: SQL[] = []
  if (args.track) filters.push(eq(schema.architectureEvolutionReservations.track, args.track))
  if (args.abstractionKind) {
    filters.push(eq(schema.architectureEvolutionReservations.abstractionKind, args.abstractionKind))
  }
  if (args.status) filters.push(eq(schema.architectureEvolutionReservations.status, args.status))
  return db.query.architectureEvolutionReservations.findMany({
    where: filters.length ? and(...filters) : undefined,
    orderBy: [
      asc(schema.architectureEvolutionReservations.track),
      asc(schema.architectureEvolutionReservations.abstractionKind),
    ],
    limit: Math.min(Math.max(args.limit ?? 100, 1), 500),
  })
}

export async function evaluateArchitectureEvolutionReadiness(): Promise<{
  reservations: ArchitectureEvolutionReservationRow[]
  summary: {
    total: number
    reserved: number
    tracks: ArchitectureEvolutionTrack[]
    abstractions: ArchitectureAbstractionKind[]
  }
}> {
  const reservations = await seedArchitectureEvolutionReservations()
  return {
    reservations,
    summary: {
      total: reservations.length,
      reserved: reservations.filter((row) => row.status === 'reserved').length,
      tracks: [...new Set(reservations.map((row) => row.track))],
      abstractions: [...new Set(reservations.map((row) => row.abstractionKind))],
    },
  }
}

function normalizeRequired(value: string, field: string): string {
  const trimmed = value.trim()
  if (!trimmed) throw new Error(`${field} is required`)
  return trimmed
}
