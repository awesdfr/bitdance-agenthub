import { and, desc, eq, type SQL } from 'drizzle-orm'

import { db, schema } from '@/db/client'
import type {
  JsonObject,
  PluginCapabilityDefinition,
  PluginCompatibilityReport,
  PluginExtensionPoint,
  PluginHealthStatus,
  PluginLifecycleEventRow,
  PluginLifecycleEventType,
  PluginMarketplaceMetadata,
  PluginPackageRow,
  PluginSecurityScanResult,
  PluginStatus,
} from '@/db/schema'
import { newPluginLifecycleEventId, newPluginPackageId } from '@/server/ids'
import { recordAuditLog } from '@/server/security-service'

export interface InstallPluginArgs {
  name: string
  version: string
  description?: string
  author?: string
  extensionPoints: PluginExtensionPoint[]
  capabilities?: PluginCapabilityDefinition[]
  config?: JsonObject
  marketplaceMetadata?: Partial<PluginMarketplaceMetadata>
  requiredCoreVersion?: string | null
}

export interface UpgradePluginArgs {
  version: string
  extensionPoints?: PluginExtensionPoint[]
  capabilities?: PluginCapabilityDefinition[]
  config?: JsonObject
  marketplaceMetadata?: Partial<PluginMarketplaceMetadata>
  requiredCoreVersion?: string | null
}

export interface CheckPluginCompatibilityArgs {
  pluginId: string
  requiredCoreVersion?: string | null
}

export const PLUGIN_EXTENSION_POINTS: PluginExtensionPoint[] = [
  'tool_provider',
  'model_provider',
  'memory_backend',
  'workstation_type',
  'verification_strategy',
  'output_adapter',
  'notification_channel',
  'trigger_type',
  'ui_panel',
  'artifact_renderer',
]

const SYSTEM_VERSION = '0.1.0'

export async function installPlugin(args: InstallPluginArgs): Promise<PluginPackageRow> {
  const now = Date.now()
  const extensionPoints = normalizeExtensionPoints(args.extensionPoints)
  const capabilities = normalizeCapabilities(extensionPoints, args.capabilities)
  const marketplaceMetadata = normalizeMarketplaceMetadata(args.marketplaceMetadata)
  const securityScanResult = scanPluginSecurity(args, marketplaceMetadata, capabilities)
  const compatibilityReport = buildCompatibilityReport({
    extensionPoints,
    securityScanResult,
    requiredCoreVersion: args.requiredCoreVersion,
    enabledPlugins: await listPlugins({ status: 'enabled' }),
  })
  const row: PluginPackageRow = {
    id: newPluginPackageId(),
    name: normalizeRequired(args.name, 'name'),
    version: normalizeRequired(args.version, 'version'),
    description: args.description?.trim() ?? '',
    author: args.author?.trim() ?? '',
    source: marketplaceMetadata.source,
    extensionPoints,
    capabilities,
    config: args.config ?? {},
    marketplaceMetadata,
    compatibilityReport,
    securityScanResult,
    status: securityScanResult.status === 'blocked' ? 'failed' : 'installed',
    healthStatus: 'unknown',
    healthMessage: '',
    installedAt: now,
    enabledAt: null,
    updatedAt: now,
  }
  await db.insert(schema.pluginPackages).values(row)
  await recordPluginLifecycleEvent(row.id, 'install', {
    status: row.status === 'failed' ? 'failed' : 'succeeded',
    toVersion: row.version,
    message: row.status === 'failed' ? 'Plugin install blocked by security scan.' : 'Plugin installed.',
    metadata: {
      extensionPoints,
      compatibilityReport,
      securityScanResult,
    },
  })
  await auditPlugin(row, 'plugin.install', row.status === 'failed' ? 'blocked' : 'allowed')
  return row
}

export async function listPlugins(args: {
  status?: PluginStatus
  source?: PluginMarketplaceMetadata['source']
  extensionPoint?: PluginExtensionPoint
  limit?: number
} = {}): Promise<PluginPackageRow[]> {
  const filters: SQL[] = []
  if (args.status) filters.push(eq(schema.pluginPackages.status, args.status))
  if (args.source) filters.push(eq(schema.pluginPackages.source, args.source))
  const rows = await db.query.pluginPackages.findMany({
    where: filters.length ? and(...filters) : undefined,
    orderBy: [desc(schema.pluginPackages.updatedAt)],
    limit: Math.min(Math.max(args.limit ?? 100, 1), 500),
  })
  if (!args.extensionPoint) return rows
  return rows.filter((row) => row.extensionPoints.includes(args.extensionPoint!))
}

export async function enablePlugin(pluginId: string): Promise<PluginPackageRow> {
  const plugin = await getRequiredPlugin(pluginId)
  if (plugin.status === 'uninstalled') throw new Error(`Cannot enable uninstalled plugin: ${pluginId}`)
  if (plugin.securityScanResult.status === 'blocked') {
    await recordPluginLifecycleEvent(plugin.id, 'enable', {
      status: 'failed',
      message: 'Enable blocked by plugin security scan.',
    })
    throw new Error(`Plugin security scan is blocked: ${pluginId}`)
  }
  const compatibility = buildCompatibilityReport({
    extensionPoints: plugin.extensionPoints,
    securityScanResult: plugin.securityScanResult,
    requiredCoreVersion: plugin.compatibilityReport.requiredCoreVersion,
    enabledPlugins: await listPlugins({ status: 'enabled' }),
    pluginId,
  })
  const now = Date.now()
  await db
    .update(schema.pluginPackages)
    .set({
      status: 'enabled',
      enabledAt: now,
      updatedAt: now,
      compatibilityReport: compatibility,
    })
    .where(eq(schema.pluginPackages.id, pluginId))
  const row = await getRequiredPlugin(pluginId)
  await recordPluginLifecycleEvent(pluginId, 'enable', {
    status: compatibility.compatible ? 'succeeded' : 'failed',
    message: compatibility.compatible ? 'Plugin enabled.' : 'Plugin enabled with compatibility conflicts.',
    metadata: { compatibility },
  })
  await auditPlugin(row, 'plugin.enable', compatibility.compatible ? 'allowed' : 'warning')
  return row
}

export async function disablePlugin(pluginId: string): Promise<PluginPackageRow> {
  await getRequiredPlugin(pluginId)
  await db
    .update(schema.pluginPackages)
    .set({ status: 'disabled', updatedAt: Date.now() })
    .where(eq(schema.pluginPackages.id, pluginId))
  const row = await getRequiredPlugin(pluginId)
  await recordPluginLifecycleEvent(pluginId, 'disable', {
    status: 'succeeded',
    message: 'Plugin disabled.',
  })
  await auditPlugin(row, 'plugin.disable', 'allowed')
  return row
}

export async function uninstallPlugin(pluginId: string): Promise<PluginPackageRow> {
  await getRequiredPlugin(pluginId)
  await db
    .update(schema.pluginPackages)
    .set({ status: 'uninstalled', enabledAt: null, updatedAt: Date.now() })
    .where(eq(schema.pluginPackages.id, pluginId))
  const row = await getRequiredPlugin(pluginId)
  await recordPluginLifecycleEvent(pluginId, 'uninstall', {
    status: 'succeeded',
    message: 'Plugin uninstalled non-destructively; lifecycle history is retained.',
  })
  await auditPlugin(row, 'plugin.uninstall', 'allowed')
  return row
}

export async function upgradePlugin(pluginId: string, args: UpgradePluginArgs): Promise<PluginPackageRow> {
  const plugin = await getRequiredPlugin(pluginId)
  if (plugin.status === 'uninstalled') throw new Error(`Cannot upgrade uninstalled plugin: ${pluginId}`)
  const extensionPoints = args.extensionPoints
    ? normalizeExtensionPoints(args.extensionPoints)
    : plugin.extensionPoints
  const capabilities = args.capabilities
    ? normalizeCapabilities(extensionPoints, args.capabilities)
    : plugin.capabilities
  const marketplaceMetadata = normalizeMarketplaceMetadata({
    ...plugin.marketplaceMetadata,
    ...(args.marketplaceMetadata ?? {}),
    latestVersion: args.version,
    updateAvailable: false,
  })
  const securityScanResult = scanPluginSecurity(
    {
      extensionPoints,
      config: args.config ?? plugin.config,
    },
    marketplaceMetadata,
    capabilities,
  )
  const compatibilityReport = buildCompatibilityReport({
    extensionPoints,
    securityScanResult,
    requiredCoreVersion: args.requiredCoreVersion ?? plugin.compatibilityReport.requiredCoreVersion,
    enabledPlugins: await listPlugins({ status: 'enabled' }),
    pluginId,
  })
  await db
    .update(schema.pluginPackages)
    .set({
      version: normalizeRequired(args.version, 'version'),
      extensionPoints,
      capabilities,
      config: args.config ?? plugin.config,
      marketplaceMetadata,
      securityScanResult,
      compatibilityReport,
      status: securityScanResult.status === 'blocked' ? 'failed' : plugin.status,
      updatedAt: Date.now(),
    })
    .where(eq(schema.pluginPackages.id, pluginId))
  const row = await getRequiredPlugin(pluginId)
  await recordPluginLifecycleEvent(pluginId, 'upgrade', {
    status: row.status === 'failed' ? 'failed' : 'succeeded',
    fromVersion: plugin.version,
    toVersion: row.version,
    message: `Plugin upgraded from ${plugin.version} to ${row.version}.`,
    metadata: { compatibilityReport, securityScanResult },
  })
  await auditPlugin(row, 'plugin.upgrade', row.status === 'failed' ? 'blocked' : 'allowed')
  return row
}

export async function runPluginHealthCheck(pluginId: string): Promise<PluginPackageRow> {
  const plugin = await getRequiredPlugin(pluginId)
  const health = evaluateHealth(plugin)
  await db
    .update(schema.pluginPackages)
    .set({
      healthStatus: health.status,
      healthMessage: health.message,
      updatedAt: Date.now(),
    })
    .where(eq(schema.pluginPackages.id, pluginId))
  const row = await getRequiredPlugin(pluginId)
  await recordPluginLifecycleEvent(pluginId, 'health_check', {
    status: health.status === 'ok' ? 'succeeded' : 'failed',
    message: health.message,
    metadata: { healthStatus: health.status },
  })
  await auditPlugin(row, 'plugin.health_check', health.status === 'ok' ? 'allowed' : 'warning')
  return row
}

export async function checkPluginCompatibility(
  args: CheckPluginCompatibilityArgs,
): Promise<PluginCompatibilityReport> {
  const plugin = await getRequiredPlugin(args.pluginId)
  const compatibility = buildCompatibilityReport({
    extensionPoints: plugin.extensionPoints,
    securityScanResult: plugin.securityScanResult,
    requiredCoreVersion: args.requiredCoreVersion ?? plugin.compatibilityReport.requiredCoreVersion,
    enabledPlugins: await listPlugins({ status: 'enabled' }),
    pluginId: plugin.id,
  })
  await db
    .update(schema.pluginPackages)
    .set({ compatibilityReport: compatibility, updatedAt: Date.now() })
    .where(eq(schema.pluginPackages.id, plugin.id))
  await recordPluginLifecycleEvent(plugin.id, 'compatibility_check', {
    status: compatibility.compatible ? 'succeeded' : 'failed',
    message: compatibility.compatible ? 'Plugin is compatible.' : 'Plugin has compatibility conflicts.',
    metadata: { compatibility },
  })
  return compatibility
}

export async function listPluginLifecycleEvents(args: {
  pluginId?: string
  eventType?: PluginLifecycleEventType
  limit?: number
} = {}): Promise<PluginLifecycleEventRow[]> {
  const filters: SQL[] = []
  if (args.pluginId) filters.push(eq(schema.pluginLifecycleEvents.pluginId, args.pluginId))
  if (args.eventType) filters.push(eq(schema.pluginLifecycleEvents.eventType, args.eventType))
  return db.query.pluginLifecycleEvents.findMany({
    where: filters.length ? and(...filters) : undefined,
    orderBy: [desc(schema.pluginLifecycleEvents.createdAt)],
    limit: Math.min(Math.max(args.limit ?? 100, 1), 500),
  })
}

async function getRequiredPlugin(pluginId: string): Promise<PluginPackageRow> {
  const row = await db.query.pluginPackages.findFirst({
    where: eq(schema.pluginPackages.id, pluginId),
  })
  if (!row) throw new Error(`Plugin not found: ${pluginId}`)
  return row
}

async function recordPluginLifecycleEvent(
  pluginId: string,
  eventType: PluginLifecycleEventType,
  args: {
    status?: 'succeeded' | 'failed'
    fromVersion?: string | null
    toVersion?: string | null
    message?: string
    metadata?: JsonObject
  } = {},
): Promise<PluginLifecycleEventRow> {
  const row: PluginLifecycleEventRow = {
    id: newPluginLifecycleEventId(),
    pluginId,
    eventType,
    fromVersion: normalizeNullable(args.fromVersion),
    toVersion: normalizeNullable(args.toVersion),
    status: args.status ?? 'succeeded',
    message: args.message?.trim() ?? '',
    metadata: args.metadata ?? {},
    createdAt: Date.now(),
  }
  await db.insert(schema.pluginLifecycleEvents).values(row)
  return row
}

function normalizeExtensionPoints(extensionPoints: PluginExtensionPoint[]): PluginExtensionPoint[] {
  const normalized = Array.from(new Set(extensionPoints))
  if (!normalized.length) throw new Error('Plugin must declare at least one extension point.')
  const invalid = normalized.filter((point) => !PLUGIN_EXTENSION_POINTS.includes(point))
  if (invalid.length) throw new Error(`Unsupported extension point(s): ${invalid.join(', ')}`)
  return normalized
}

function normalizeCapabilities(
  extensionPoints: PluginExtensionPoint[],
  capabilities: PluginCapabilityDefinition[] | undefined,
): PluginCapabilityDefinition[] {
  const normalized: PluginCapabilityDefinition[] =
    capabilities?.length
      ? capabilities.map((capability) => ({
          id: normalizeRequired(capability.id, 'capability.id'),
          name: normalizeRequired(capability.name, 'capability.name'),
          type: capability.type,
          description: capability.description?.trim() ?? '',
          inputSchema: capability.inputSchema,
          outputSchema: capability.outputSchema,
          riskLevel: capability.riskLevel ?? 'low',
        }))
      : extensionPoints.map((point) => ({
          id: `${point}.default`,
          name: defaultCapabilityName(point),
          type: point,
          description: `Default capability exposed for ${point}.`,
          riskLevel: point === 'workstation_type' ? 'medium' : 'low',
        }))
  const ids = new Set<string>()
  for (const capability of normalized) {
    if (!extensionPoints.includes(capability.type)) {
      throw new Error(`Capability ${capability.id} uses undeclared extension point ${capability.type}.`)
    }
    if (ids.has(capability.id)) throw new Error(`Capability ids must be unique: ${capability.id}`)
    ids.add(capability.id)
  }
  return normalized
}

function normalizeMarketplaceMetadata(
  metadata: Partial<PluginMarketplaceMetadata> | undefined,
): PluginMarketplaceMetadata {
  return {
    source: metadata?.source ?? 'local',
    marketplaceUrl: normalizeNullable(metadata?.marketplaceUrl),
    rating: metadata?.rating ?? null,
    downloads: metadata?.downloads ?? null,
    reviews: metadata?.reviews ?? null,
    updateAvailable: metadata?.updateAvailable ?? false,
    latestVersion: normalizeNullable(metadata?.latestVersion),
  }
}

function scanPluginSecurity(
  args: Pick<InstallPluginArgs, 'config' | 'extensionPoints'>,
  marketplaceMetadata: PluginMarketplaceMetadata,
  capabilities: PluginCapabilityDefinition[],
): PluginSecurityScanResult {
  const findings: string[] = []
  const config = args.config ?? {}
  if (capabilities.some((capability) => capability.riskLevel === 'high')) {
    findings.push('High-risk capability requires explicit user review before enable.')
  }
  if (args.extensionPoints.includes('workstation_type')) {
    findings.push('Workstation-type extensions are constrained to sandboxed launch policies.')
  }
  if (config.allowHostAccess === true) {
    findings.push('Host access request detected; keep plugin disabled until reviewed.')
  }
  if (config.unsafeEval === true) {
    findings.push('Unsafe eval is not allowed in plugin manifests.')
  }
  if (marketplaceMetadata.marketplaceUrl && !marketplaceMetadata.marketplaceUrl.startsWith('https://')) {
    findings.push('Marketplace URL should use HTTPS.')
  }
  return {
    status: config.unsafeEval === true ? 'blocked' : findings.length ? 'warning' : 'passed',
    findings,
    scannedAt: Date.now(),
  }
}

function buildCompatibilityReport(args: {
  extensionPoints: PluginExtensionPoint[]
  securityScanResult: PluginSecurityScanResult
  enabledPlugins: PluginPackageRow[]
  requiredCoreVersion?: string | null
  pluginId?: string
}): PluginCompatibilityReport {
  const conflicts: string[] = []
  const warnings: string[] = []
  const requiredCoreVersion = normalizeNullable(args.requiredCoreVersion)
  if (requiredCoreVersion && !isCoreVersionCompatible(requiredCoreVersion)) {
    conflicts.push(`Requires core version ${requiredCoreVersion}, current ${SYSTEM_VERSION}.`)
  }
  if (args.securityScanResult.status === 'blocked') {
    conflicts.push('Security scan blocked this plugin.')
  }
  if (args.securityScanResult.status === 'warning') {
    warnings.push(...args.securityScanResult.findings)
  }
  for (const other of args.enabledPlugins) {
    if (other.id === args.pluginId) continue
    const overlap = other.extensionPoints.filter((point) => args.extensionPoints.includes(point))
    if (overlap.includes('ui_panel') || overlap.includes('artifact_renderer')) {
      warnings.push(`Shares UI/rendering extension point with enabled plugin ${other.name}.`)
    }
  }
  return {
    systemVersion: SYSTEM_VERSION,
    compatible: conflicts.length === 0,
    requiredCoreVersion,
    conflicts: Array.from(new Set(conflicts)),
    warnings: Array.from(new Set(warnings)),
    checkedAt: Date.now(),
  }
}

function evaluateHealth(plugin: PluginPackageRow): { status: PluginHealthStatus; message: string } {
  if (plugin.status === 'failed') return { status: 'failed', message: 'Plugin is marked failed.' }
  if (plugin.status === 'uninstalled') return { status: 'failed', message: 'Plugin is uninstalled.' }
  if (!plugin.extensionPoints.length) return { status: 'failed', message: 'Plugin has no extension points.' }
  if (plugin.securityScanResult.status === 'blocked') {
    return { status: 'failed', message: 'Plugin security scan is blocked.' }
  }
  return {
    status: 'ok',
    message: `${plugin.name} exposes ${plugin.extensionPoints.length} extension point(s) and ${plugin.capabilities.length} capability definition(s).`,
  }
}

async function auditPlugin(
  plugin: PluginPackageRow,
  action: string,
  status: 'allowed' | 'blocked' | 'warning',
): Promise<void> {
  await recordAuditLog({
    actorType: 'system',
    action,
    resourceType: 'plugin_package',
    resourceId: plugin.id,
    status,
    riskLevel: status === 'blocked' ? 'high' : status === 'warning' ? 'medium' : 'low',
    message: `${plugin.name}@${plugin.version} ${action}.`,
    metadata: {
      extensionPoints: plugin.extensionPoints,
      capabilityCount: plugin.capabilities.length,
      healthStatus: plugin.healthStatus,
      securityStatus: plugin.securityScanResult.status,
    },
  })
}

function defaultCapabilityName(point: PluginExtensionPoint): string {
  return point
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

function isCoreVersionCompatible(requiredCoreVersion: string): boolean {
  const requiredMajor = Number(requiredCoreVersion.split('.')[0])
  const currentMajor = Number(SYSTEM_VERSION.split('.')[0])
  return Number.isFinite(requiredMajor) && requiredMajor <= currentMajor
}

function normalizeRequired(value: string, field: string): string {
  const trimmed = value.trim()
  if (!trimmed) throw new Error(`${field} is required`)
  return trimmed
}

function normalizeNullable(value: string | null | undefined): string | null {
  const trimmed = value?.trim()
  return trimmed ? trimmed : null
}
