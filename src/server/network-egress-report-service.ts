import { asc, desc } from 'drizzle-orm'

import { db, schema } from '@/db/client'
import type {
  AgentProfileRow,
  CliProfileRow,
  ModelProfileRow,
  NetworkAppliesTo,
  NetworkMode,
  NetworkProfileRow,
} from '@/db/schema'

export type NetworkEgressReadiness = 'ready' | 'needs_configuration' | 'failed'

export interface NetworkEgressRoute {
  networkProfileId: string
  networkProfileName: string
  appliesTo: NetworkAppliesTo
  mode: NetworkMode
  regionLabel: string | null
  targetType: 'model' | 'agent_browser' | 'agent_cli' | 'agent_all_traffic' | 'cli'
  targetId: string
  targetName: string
  routeStatus: 'configured' | 'implicit_direct' | 'misconfigured'
  reason: string
}

export interface NetworkEgressReport {
  readiness: NetworkEgressReadiness
  readinessScore: number
  summary: {
    networkProfileCount: number
    directCount: number
    proxyCount: number
    customGatewayCount: number
    modelRouteCount: number
    agentRouteCount: number
    cliRouteCount: number
    failedProfileCount: number
    missingEndpointCount: number
  }
  networkProfiles: Array<{
    id: string
    name: string
    mode: NetworkMode
    appliesTo: NetworkAppliesTo
    proxyConfigured: boolean
    bindInterfaceConfigured: boolean
    regionLabel: string | null
    healthStatus: NetworkProfileRow['healthStatus']
    lastTestResult: string | null
    modelCount: number
    agentCount: number
    cliCount: number
    gaps: string[]
    warnings: string[]
  }>
  routes: NetworkEgressRoute[]
  gaps: string[]
  warnings: string[]
  recommendations: string[]
  generatedAt: number
}

export async function getNetworkEgressReport(): Promise<NetworkEgressReport> {
  const [networks, models, agents, cliProfiles] = await Promise.all([
    db.query.networkProfiles.findMany({ orderBy: [desc(schema.networkProfiles.createdAt)] }),
    db.query.modelProfiles.findMany({ orderBy: [asc(schema.modelProfiles.name)] }),
    db.query.agentProfiles.findMany({ orderBy: [asc(schema.agentProfiles.name)] }),
    db.query.cliProfiles.findMany({ orderBy: [asc(schema.cliProfiles.name)] }),
  ])
  const networkById = new Map(networks.map((network) => [network.id, network]))
  const routes = buildRoutes({ networks, models, agents, cliProfiles, networkById })
  const networkSummaries = networks.map((network) =>
    summarizeNetworkProfile({
      network,
      routes: routes.filter((route) => route.networkProfileId === network.id),
    }),
  )
  const gaps = buildGaps(networkSummaries, routes)
  const warnings = buildWarnings({ networks, models, agents, routes })
  const readiness = resolveReadiness(gaps, networkSummaries)
  const recommendations = buildRecommendations({
    networks,
    models,
    agents,
    routes,
    gaps,
    warnings,
  })
  return {
    readiness,
    readinessScore: scoreReadiness(readiness, gaps, warnings, routes, networks),
    summary: {
      networkProfileCount: networks.length,
      directCount: networks.filter((network) => network.mode === 'direct').length,
      proxyCount: networks.filter((network) => network.mode === 'http_proxy' || network.mode === 'socks5_proxy').length,
      customGatewayCount: networks.filter((network) => network.mode === 'custom_gateway').length,
      modelRouteCount: routes.filter((route) => route.targetType === 'model').length,
      agentRouteCount: routes.filter((route) => route.targetType.startsWith('agent_')).length,
      cliRouteCount: routes.filter((route) => route.targetType === 'cli').length,
      failedProfileCount: networks.filter((network) => network.healthStatus === 'failed').length,
      missingEndpointCount: networkSummaries.filter((network) => network.gaps.length > 0).length,
    },
    networkProfiles: networkSummaries,
    routes,
    gaps,
    warnings,
    recommendations,
    generatedAt: Date.now(),
  }
}

export async function getNetworkProfileEgressReport(
  networkProfileId: string,
): Promise<NetworkEgressReport> {
  const report = await getNetworkEgressReport()
  const profile = report.networkProfiles.find((network) => network.id === networkProfileId)
  if (!profile) throw new Error(`Network profile not found: ${networkProfileId}`)
  const routes = report.routes.filter((route) => route.networkProfileId === networkProfileId)
  const gaps = [
    ...profile.gaps.map((gap) => `${profile.name}: ${gap}`),
    ...routes.filter((route) => route.routeStatus === 'misconfigured').map((route) => route.reason),
  ]
  const warnings = profile.warnings.map((warning) => `${profile.name}: ${warning}`)
  const readiness = resolveReadiness(gaps, [profile])
  return {
    ...report,
    readiness,
    readinessScore: scoreReadiness(readiness, gaps, warnings, routes, [profile as unknown as NetworkProfileRow]),
    summary: {
      ...report.summary,
      networkProfileCount: 1,
      directCount: profile.mode === 'direct' ? 1 : 0,
      proxyCount: profile.mode === 'http_proxy' || profile.mode === 'socks5_proxy' ? 1 : 0,
      customGatewayCount: profile.mode === 'custom_gateway' ? 1 : 0,
      modelRouteCount: routes.filter((route) => route.targetType === 'model').length,
      agentRouteCount: routes.filter((route) => route.targetType.startsWith('agent_')).length,
      cliRouteCount: routes.filter((route) => route.targetType === 'cli').length,
      failedProfileCount: profile.healthStatus === 'failed' ? 1 : 0,
      missingEndpointCount: profile.gaps.length > 0 ? 1 : 0,
    },
    networkProfiles: [profile],
    routes,
    gaps,
    warnings,
    recommendations: buildRecommendations({
      networks: [profile as unknown as NetworkProfileRow],
      models: [],
      agents: [],
      routes,
      gaps,
      warnings,
    }),
    generatedAt: Date.now(),
  }
}

function buildRoutes(args: {
  networks: NetworkProfileRow[]
  models: ModelProfileRow[]
  agents: AgentProfileRow[]
  cliProfiles: CliProfileRow[]
  networkById: Map<string, NetworkProfileRow>
}): NetworkEgressRoute[] {
  const routes: NetworkEgressRoute[] = []
  for (const model of args.models) {
    const network = model.networkProfileId ? args.networkById.get(model.networkProfileId) : null
    routes.push(routeFromNetwork({
      network,
      fallbackName: 'Direct model egress',
      targetType: 'model',
      targetId: model.id,
      targetName: `${model.name} (${model.provider}:${model.model})`,
      reason: network
        ? `Model profile ${model.name} explicitly uses network profile ${network.name}.`
        : `Model profile ${model.name} has no network profile and will use direct egress.`,
    }))
  }
  for (const agent of args.agents) {
    const browserNetworkId = readString(agent.workstationPolicy.networkProfileId)
    const allTrafficNetworkId = readString(agent.permissionPolicy.networkProfileId)
    const browserNetwork = browserNetworkId ? args.networkById.get(browserNetworkId) : null
    const allTrafficNetwork = allTrafficNetworkId ? args.networkById.get(allTrafficNetworkId) : null
    if (browserNetworkId || allTrafficNetworkId) {
      routes.push(routeFromNetwork({
        network: browserNetwork ?? allTrafficNetwork,
        fallbackName: 'Direct Agent egress',
        targetType: allTrafficNetworkId ? 'agent_all_traffic' : 'agent_browser',
        targetId: agent.id,
        targetName: agent.name,
        reason: browserNetwork ?? allTrafficNetwork
          ? `Agent ${agent.name} declares network routing metadata.`
          : `Agent ${agent.name} references a missing network profile.`,
        missingNetworkProfileId: browserNetworkId ?? allTrafficNetworkId ?? undefined,
      }))
    }
  }
  for (const cli of args.cliProfiles) {
    const networkId = readString(cli.env.NETWORK_PROFILE_ID) ?? readString(cli.env.AGENTHUB_NETWORK_PROFILE_ID)
    if (!networkId) continue
    const network = args.networkById.get(networkId)
    routes.push(routeFromNetwork({
      network,
      fallbackName: 'Direct CLI egress',
      targetType: 'cli',
      targetId: cli.id,
      targetName: cli.name,
      reason: network
        ? `CLI profile ${cli.name} routes through network profile ${network.name} via env metadata.`
        : `CLI profile ${cli.name} references missing network profile ${networkId}.`,
      missingNetworkProfileId: networkId,
    }))
  }
  return routes
}

function routeFromNetwork(args: {
  network: NetworkProfileRow | null | undefined
  fallbackName: string
  targetType: NetworkEgressRoute['targetType']
  targetId: string
  targetName: string
  reason: string
  missingNetworkProfileId?: string
}): NetworkEgressRoute {
  if (!args.network) {
    return {
      networkProfileId: args.missingNetworkProfileId ?? 'direct',
      networkProfileName: args.missingNetworkProfileId ? `Missing profile ${args.missingNetworkProfileId}` : args.fallbackName,
      appliesTo: 'all_agent_traffic',
      mode: 'direct',
      regionLabel: null,
      targetType: args.targetType,
      targetId: args.targetId,
      targetName: args.targetName,
      routeStatus: args.missingNetworkProfileId ? 'misconfigured' : 'implicit_direct',
      reason: args.reason,
    }
  }
  return {
    networkProfileId: args.network.id,
    networkProfileName: args.network.name,
    appliesTo: args.network.appliesTo,
    mode: args.network.mode,
    regionLabel: args.network.regionLabel,
    targetType: args.targetType,
    targetId: args.targetId,
    targetName: args.targetName,
    routeStatus: networkHasEndpoint(args.network) ? 'configured' : 'misconfigured',
    reason: args.reason,
  }
}

function summarizeNetworkProfile(args: {
  network: NetworkProfileRow
  routes: NetworkEgressRoute[]
}): NetworkEgressReport['networkProfiles'][number] {
  const gaps: string[] = []
  const warnings: string[] = []
  if (!networkHasEndpoint(args.network)) {
    gaps.push('Proxy/gateway mode requires proxyUrl or bindInterface.')
  }
  if (args.network.healthStatus === 'failed') {
    gaps.push(`Last health check failed: ${args.network.lastTestResult ?? 'unknown error'}.`)
  }
  if (args.network.healthStatus === 'unknown') {
    warnings.push('Network profile has not been tested yet.')
  }
  if (args.routes.length === 0) {
    warnings.push('Network profile is not assigned to any model, Agent, or CLI route.')
  }
  return {
    id: args.network.id,
    name: args.network.name,
    mode: args.network.mode,
    appliesTo: args.network.appliesTo,
    proxyConfigured: Boolean(args.network.proxyUrl),
    bindInterfaceConfigured: Boolean(args.network.bindInterface),
    regionLabel: args.network.regionLabel,
    healthStatus: args.network.healthStatus,
    lastTestResult: args.network.lastTestResult,
    modelCount: args.routes.filter((route) => route.targetType === 'model').length,
    agentCount: args.routes.filter((route) => route.targetType.startsWith('agent_')).length,
    cliCount: args.routes.filter((route) => route.targetType === 'cli').length,
    gaps,
    warnings,
  }
}

function buildGaps(
  networkSummaries: NetworkEgressReport['networkProfiles'],
  routes: NetworkEgressRoute[],
): string[] {
  return [
    ...networkSummaries.flatMap((network) => network.gaps.map((gap) => `${network.name}: ${gap}`)),
    ...routes.filter((route) => route.routeStatus === 'misconfigured').map((route) => route.reason),
  ]
}

function buildWarnings(args: {
  networks: NetworkProfileRow[]
  models: ModelProfileRow[]
  agents: AgentProfileRow[]
  routes: NetworkEgressRoute[]
}): string[] {
  const warnings: string[] = []
  if (args.networks.length === 0) warnings.push('No network profiles are configured; all traffic is implicit direct egress.')
  if (args.models.some((model) => !model.networkProfileId)) {
    warnings.push('At least one model profile has no explicit network profile.')
  }
  if (!args.routes.some((route) => route.targetType.startsWith('agent_'))) {
    warnings.push('No Agent-level browser/CLI/all-traffic network route is declared yet.')
  }
  return warnings
}

function resolveReadiness(
  gaps: string[],
  networkSummaries: NetworkEgressReport['networkProfiles'],
): NetworkEgressReadiness {
  if (networkSummaries.some((network) => network.healthStatus === 'failed')) return 'failed'
  return gaps.length ? 'needs_configuration' : 'ready'
}

function scoreReadiness(
  readiness: NetworkEgressReadiness,
  gaps: string[],
  warnings: string[],
  routes: NetworkEgressRoute[],
  networks: Array<Pick<NetworkProfileRow, 'healthStatus'>>,
): number {
  if (readiness === 'failed') return Math.max(0, 45 - gaps.length * 8)
  const testedBonus = networks.filter((network) => network.healthStatus === 'ok').length * 5
  const routeBonus = Math.min(20, routes.filter((route) => route.routeStatus === 'configured').length * 3)
  const base = readiness === 'ready' ? 70 : 55
  return Math.max(0, Math.min(100, base + testedBonus + routeBonus - gaps.length * 10 - warnings.length * 3))
}

function buildRecommendations(args: {
  networks: Array<Pick<NetworkProfileRow, 'mode' | 'name' | 'healthStatus'>>
  models: ModelProfileRow[]
  agents: AgentProfileRow[]
  routes: NetworkEgressRoute[]
  gaps: string[]
  warnings: string[]
}): string[] {
  const recommendations: string[] = []
  if (args.gaps.some((gap) => gap.includes('proxyUrl') || gap.includes('bindInterface'))) {
    recommendations.push('Add proxyUrl or bindInterface to every proxy/gateway network profile before assigning it to models or Agents.')
  }
  if (args.networks.some((network) => network.healthStatus === 'unknown')) {
    recommendations.push('Run network profile tests so the Model Control page can show current outlet health.')
  }
  if (args.models.some((model) => !model.networkProfileId)) {
    recommendations.push('Assign explicit networkProfileId values to model profiles that require a stable landing IP.')
  }
  if (!args.routes.some((route) => route.targetType.startsWith('agent_'))) {
    recommendations.push('Declare Agent-level networkProfileId metadata for browser, CLI, or all-Agent traffic when customer projects require dedicated egress.')
  }
  if (args.routes.some((route) => route.routeStatus === 'misconfigured')) {
    recommendations.push('Fix missing or misconfigured route references before running live model, browser, or CLI traffic.')
  }
  if (!recommendations.length) {
    recommendations.push('Network/IP outlet configuration is ready for dry-run routing and health monitoring.')
  }
  return recommendations
}

function networkHasEndpoint(network: NetworkProfileRow): boolean {
  return network.mode === 'direct' || Boolean(network.proxyUrl || network.bindInterface)
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}
