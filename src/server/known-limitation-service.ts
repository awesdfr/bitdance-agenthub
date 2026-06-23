import { and, desc, eq, type SQL } from 'drizzle-orm'

import { db, schema } from '@/db/client'
import type {
  KnownLimitationCategory,
  KnownLimitationRow,
  KnownLimitationSeverity,
  KnownLimitationStatus,
  LimitationAcknowledgementRow,
  LimitationDisclosureSurface,
} from '@/db/schema'
import {
  newKnownLimitationId,
  newLimitationAcknowledgementId,
} from '@/server/ids'

export interface DefaultKnownLimitation {
  limitationKey: string
  category: KnownLimitationCategory
  severity: KnownLimitationSeverity
  title: string
  description: string
  userImpact: string
  workaround: string
  roadmap: string
  capabilityTags: string[]
  disclosureSurfaces: LimitationDisclosureSurface[]
  requiresAcknowledgement: boolean
  evidenceRefs: string[]
}

export interface KnownLimitationEvaluation {
  limitations: KnownLimitationRow[]
  summary: {
    requestedCapabilities: string[]
    total: number
    blocking: number
    warnings: number
    info: number
    requiresAcknowledgement: number
    canProceedWithoutUserAcknowledgement: boolean
  }
  recommendations: string[]
}

const defaultKnownLimitations: DefaultKnownLimitation[] = [
  {
    limitationKey: 'desktop_automation_windows_only',
    category: 'desktop_automation',
    severity: 'blocking',
    title: 'Desktop automation is Windows-only in v1',
    description: 'v1 desktop automation adapters are validated for Windows only and do not support macOS or Linux desktop control.',
    userImpact: 'Agents cannot safely control native macOS or Linux desktop applications in v1.',
    workaround: 'Use browser automation, CLI/API integrations, or a Windows workstation for desktop-control tasks.',
    roadmap: 'v2 can add macOS/Linux desktop adapters after separate permission, accessibility, and input-dispatch hardening.',
    capabilityTags: ['desktop', 'desktop_automation', 'macos', 'linux', 'native_app'],
    disclosureSurfaces: ['documentation', 'onboarding', 'agent_factory', 'run_preflight'],
    requiresAcknowledgement: true,
    evidenceRefs: ['section_112', 'docs/reference/known-limitations.md'],
  },
  {
    limitationKey: 'max_10_parallel_agents_local',
    category: 'parallel_agents',
    severity: 'warning',
    title: 'Local v1 should not exceed 10 concurrent Agents',
    description: 'The local-first runtime is bounded by CPU, memory, browser profiles, child processes, and model-provider rate limits.',
    userImpact: 'Running more than 10 Agents can increase latency, failures, lock contention, and memory pressure.',
    workaround: 'Use task queues, batching, resource governor policies, and staggered schedules for larger workloads.',
    roadmap: 'v2 cluster or remote workstation execution can raise this limit with explicit capacity planning.',
    capabilityTags: ['parallel', 'concurrency', '10_agents', 'many_agents', 'batch'],
    disclosureSurfaces: ['documentation', 'agent_factory', 'run_preflight', 'settings'],
    requiresAcknowledgement: false,
    evidenceRefs: ['section_112', 'docs/reference/known-limitations.md'],
  },
  {
    limitationKey: 'mobile_operation_v2',
    category: 'mobile_operation',
    severity: 'blocking',
    title: 'Mobile phone operation is not available in v1',
    description: 'v1 supports companion-style mobile progress, approvals, messages, and artifact viewing, not direct phone automation.',
    userImpact: 'Agents cannot tap, type, or control Android/iOS apps through the phone screen in v1.',
    workaround: 'Use the mobile companion for approvals and provide files/screenshots to desktop Agents.',
    roadmap: 'v2 can add Android ADB, Appium, iOS Shortcuts, and screen-mirroring workstations.',
    capabilityTags: ['mobile', 'phone', 'android', 'ios', 'adb', 'appium'],
    disclosureSurfaces: ['documentation', 'onboarding', 'agent_factory', 'run_preflight'],
    requiresAcknowledgement: true,
    evidenceRefs: ['section_112', 'docs/reference/known-limitations.md'],
  },
  {
    limitationKey: 'native_dialogs_not_operated_directly',
    category: 'native_dialogs',
    severity: 'blocking',
    title: 'Native file pickers and print dialogs require alternatives',
    description: 'v1 does not directly operate native file-picker, print, color, or privileged OS dialogs.',
    userImpact: 'Agents may pause when a native OS dialog appears instead of clicking through it.',
    workaround: 'Prefer CLI/API file paths, browser file-input injection, generated PDFs, or user approval/takeover.',
    roadmap: 'Future adapters can add per-dialog safe commands after OS-specific validation.',
    capabilityTags: ['file_picker', 'print_dialog', 'native_dialog', 'color_picker', 'os_dialog'],
    disclosureSurfaces: ['documentation', 'run_preflight', 'approval'],
    requiresAcknowledgement: true,
    evidenceRefs: ['section_112', 'docs/reference/known-limitations.md'],
  },
  {
    limitationKey: 'captcha_requires_user',
    category: 'browser_automation',
    severity: 'blocking',
    title: 'CAPTCHA and bot challenges require user completion',
    description: 'v1 must not bypass CAPTCHA, Cloudflare, hCaptcha, reCAPTCHA, or similar bot-detection challenges.',
    userImpact: 'Browser Agents will pause and ask the user to complete the challenge manually.',
    workaround: 'Use logged-in approved sessions, official APIs, or user-assisted takeover when a challenge appears.',
    roadmap: 'The policy remains user-assisted unless a site provides compliant automation APIs.',
    capabilityTags: ['captcha', 'recaptcha', 'hcaptcha', 'cloudflare', 'bot_detection', 'browser'],
    disclosureSurfaces: ['documentation', 'run_preflight', 'approval'],
    requiresAcknowledgement: true,
    evidenceRefs: ['section_112', 'docs/reference/known-limitations.md'],
  },
  {
    limitationKey: 'enterprise_proxy_manual_configuration',
    category: 'enterprise_network',
    severity: 'warning',
    title: 'Some enterprise networks need manual proxy setup',
    description: 'Corporate proxies, PAC files, NTLM/Kerberos auth, and TLS inspection can require admin-provided settings.',
    userImpact: 'Model calls, browser sessions, or CLI tools may fail until a matching Network Profile is configured.',
    workaround: 'Create a Network Profile with proxy, certificate, and no-proxy settings supplied by IT.',
    roadmap: 'Enterprise templates can pre-package approved network profiles and certificate references.',
    capabilityTags: ['enterprise_proxy', 'proxy', 'pac', 'ntlm', 'kerberos', 'tls_inspection', 'network'],
    disclosureSurfaces: ['documentation', 'settings', 'run_preflight'],
    requiresAcknowledgement: false,
    evidenceRefs: ['section_112', 'docs/reference/known-limitations.md'],
  },
  {
    limitationKey: 'ollama_quality_depends_on_hardware',
    category: 'local_model',
    severity: 'warning',
    title: 'Local model speed and quality depend on hardware',
    description: 'Ollama and other local providers vary by RAM, GPU, model size, quantization, and thermal constraints.',
    userImpact: 'Local Agents can be slower or less capable than cloud models on constrained machines.',
    workaround: 'Use smaller models, route demanding tasks to cloud providers, or lower parallelism.',
    roadmap: 'Model benchmarking and hardware profiles can recommend safer defaults over time.',
    capabilityTags: ['ollama', 'local_model', 'local_llm', 'gpu', 'hardware'],
    disclosureSurfaces: ['documentation', 'settings', 'agent_factory'],
    requiresAcknowledgement: false,
    evidenceRefs: ['section_112', 'docs/reference/known-limitations.md'],
  },
  {
    limitationKey: 'single_task_over_24h_not_fully_tested',
    category: 'long_running_task',
    severity: 'warning',
    title: 'Single tasks longer than 24 hours are not fully validated',
    description: 'v1 has checkpointing and recovery, but one uninterrupted task running beyond 24 hours is not a release guarantee.',
    userImpact: 'Very long tasks should be split into resumable batches to reduce memory, lock, and model-session risk.',
    workaround: 'Use continuation plans, checkpoints, task queues, and scheduled follow-up runs.',
    roadmap: 'Long-haul soak tests and remote worker supervision can harden this path.',
    capabilityTags: ['24h', 'long_running', 'soak', 'overnight', 'checkpoint'],
    disclosureSurfaces: ['documentation', 'run_preflight', 'settings'],
    requiresAcknowledgement: false,
    evidenceRefs: ['section_112', 'docs/reference/known-limitations.md'],
  },
  {
    limitationKey: 'no_cluster_multi_machine_v1',
    category: 'cluster',
    severity: 'blocking',
    title: 'Cluster and multi-machine collaboration are not v1 features',
    description: 'v1 is local-first and does not schedule Agents across multiple machines as a coordinated cluster.',
    userImpact: 'One desktop installation cannot automatically borrow resources from other computers.',
    workaround: 'Run separate local installations or keep work inside one workstation with resource-aware scheduling.',
    roadmap: 'v2 can introduce remote workers, shared queues, and multi-machine orchestration.',
    capabilityTags: ['cluster', 'multi_machine', 'remote_worker', 'distributed'],
    disclosureSurfaces: ['documentation', 'settings', 'run_preflight'],
    requiresAcknowledgement: true,
    evidenceRefs: ['section_112', 'docs/reference/known-limitations.md'],
  },
  {
    limitationKey: 'realtime_voice_not_supported',
    category: 'voice',
    severity: 'blocking',
    title: 'Realtime voice interaction is not supported in v1',
    description: 'v1 can store voice-interface metadata, but live bidirectional voice control is outside the first release.',
    userImpact: 'Users must interact through text, approvals, files, and companion controls rather than live speech.',
    workaround: 'Use text prompts or attach transcribed audio as task context.',
    roadmap: 'v2 can add streaming speech recognition and TTS once safety and interruption handling are ready.',
    capabilityTags: ['voice', 'speech', 'realtime_voice', 'tts', 'stt'],
    disclosureSurfaces: ['documentation', 'onboarding', 'settings'],
    requiresAcknowledgement: false,
    evidenceRefs: ['section_112', 'docs/reference/known-limitations.md'],
  },
]

export function getDefaultKnownLimitationCount(): number {
  return defaultKnownLimitations.length
}

export async function seedKnownLimitations(): Promise<KnownLimitationRow[]> {
  const now = Date.now()
  for (const limitation of defaultKnownLimitations) {
    const existing = await db.query.knownLimitations.findFirst({
      where: eq(schema.knownLimitations.limitationKey, limitation.limitationKey),
    })
    if (existing) continue
    await db.insert(schema.knownLimitations).values({
      id: newKnownLimitationId(),
      ...limitation,
      status: 'active',
      createdAt: now,
      updatedAt: now,
    })
  }
  return listKnownLimitations({ status: 'active', limit: 200 })
}

export async function listKnownLimitations(args: {
  category?: KnownLimitationCategory
  severity?: KnownLimitationSeverity
  status?: KnownLimitationStatus
  surface?: LimitationDisclosureSurface
  limit?: number
} = {}): Promise<KnownLimitationRow[]> {
  const conditions: SQL[] = []
  if (args.category) conditions.push(eq(schema.knownLimitations.category, args.category))
  if (args.severity) conditions.push(eq(schema.knownLimitations.severity, args.severity))
  if (args.status) conditions.push(eq(schema.knownLimitations.status, args.status))
  const rows = await db.query.knownLimitations.findMany({
    where: conditions.length ? and(...conditions) : undefined,
    orderBy: [desc(schema.knownLimitations.updatedAt)],
    limit: args.limit ?? 100,
  })
  const surface = args.surface
  if (!surface) return rows
  return rows.filter((row) => row.disclosureSurfaces.includes(surface))
}

export async function evaluateKnownLimitations(args: {
  requestedCapabilities?: string[]
  surface?: LimitationDisclosureSurface
} = {}): Promise<KnownLimitationEvaluation> {
  const limitations = await listKnownLimitations({
    status: 'active',
    surface: args.surface,
    limit: 200,
  })
  const requestedCapabilities = (args.requestedCapabilities ?? [])
    .map((capability) => capability.trim().toLowerCase())
    .filter(Boolean)
  const matched = requestedCapabilities.length
    ? limitations.filter((limitation) =>
        limitation.capabilityTags.some((tag) => {
          const normalizedTag = tag.toLowerCase()
          return requestedCapabilities.some(
            (capability) =>
              capability.includes(normalizedTag) ||
              normalizedTag.includes(capability) ||
              words(capability).some((word) => word.length > 2 && normalizedTag.includes(word)),
          )
        }),
      )
    : limitations
  const blocking = matched.filter((limitation) => limitation.severity === 'blocking')
  const warnings = matched.filter((limitation) => limitation.severity === 'warning')
  const info = matched.filter((limitation) => limitation.severity === 'info')
  const acknowledgements = matched.filter((limitation) => limitation.requiresAcknowledgement)
  return {
    limitations: matched,
    summary: {
      requestedCapabilities,
      total: matched.length,
      blocking: blocking.length,
      warnings: warnings.length,
      info: info.length,
      requiresAcknowledgement: acknowledgements.length,
      canProceedWithoutUserAcknowledgement: acknowledgements.length === 0,
    },
    recommendations: buildRecommendations(blocking, warnings),
  }
}

export async function acknowledgeKnownLimitation(args: {
  limitationId: string
  acknowledgedBy?: string
  surface?: LimitationDisclosureSurface
  note?: string
}): Promise<LimitationAcknowledgementRow> {
  const limitation = await db.query.knownLimitations.findFirst({
    where: eq(schema.knownLimitations.id, args.limitationId),
  })
  if (!limitation) throw new Error(`Known limitation not found: ${args.limitationId}`)
  const row = {
    id: newLimitationAcknowledgementId(),
    limitationId: limitation.id,
    acknowledgedBy: args.acknowledgedBy?.trim() || 'local_user',
    surface: args.surface ?? 'documentation',
    note: args.note?.trim() || '',
    createdAt: Date.now(),
  }
  await db.insert(schema.limitationAcknowledgements).values(row)
  return row
}

export async function listLimitationAcknowledgements(args: {
  limitationId?: string
  acknowledgedBy?: string
  surface?: LimitationDisclosureSurface
  limit?: number
} = {}): Promise<LimitationAcknowledgementRow[]> {
  const conditions: SQL[] = []
  if (args.limitationId) conditions.push(eq(schema.limitationAcknowledgements.limitationId, args.limitationId))
  if (args.acknowledgedBy) conditions.push(eq(schema.limitationAcknowledgements.acknowledgedBy, args.acknowledgedBy))
  if (args.surface) conditions.push(eq(schema.limitationAcknowledgements.surface, args.surface))
  return db.query.limitationAcknowledgements.findMany({
    where: conditions.length ? and(...conditions) : undefined,
    orderBy: [desc(schema.limitationAcknowledgements.createdAt)],
    limit: args.limit ?? 100,
  })
}

function words(value: string): string[] {
  return value.split(/[^a-z0-9_]+/).filter(Boolean)
}

function buildRecommendations(
  blocking: KnownLimitationRow[],
  warnings: KnownLimitationRow[],
): string[] {
  const recommendations = new Set<string>()
  for (const limitation of blocking) {
    recommendations.add(`Gate "${limitation.title}" behind user acknowledgement before execution.`)
    recommendations.add(limitation.workaround)
  }
  for (const limitation of warnings) {
    recommendations.add(limitation.workaround)
  }
  if (!recommendations.size) recommendations.add('No active v1 limitation matched the requested capability set.')
  return [...recommendations]
}
