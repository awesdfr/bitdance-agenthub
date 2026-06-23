import { and, desc, eq, type SQL } from 'drizzle-orm'

import { db, schema } from '@/db/client'
import type {
  EnterpriseCertificateIssue,
  EnterpriseNetworkAction,
  EnterpriseNetworkEvaluationRow,
  EnterpriseNetworkInput,
  EnterpriseNetworkPolicy,
  EnterpriseNetworkPolicyRow,
  EnterpriseNetworkRisk,
  EnterpriseNetworkStatus,
} from '@/db/schema'
import { newEnterpriseNetworkEvaluationId, newEnterpriseNetworkPolicyId } from '@/server/ids'

export interface EvaluateEnterpriseNetworkArgs extends EnterpriseNetworkInput {
  policyId?: string
}

export interface EnterpriseNetworkEvaluationResult {
  policy: EnterpriseNetworkPolicyRow
  evaluation: EnterpriseNetworkEvaluationRow
  summary: {
    riskCount: number
    needsUser: number
    warnings: number
    actions: EnterpriseNetworkAction[]
  }
}

const DEFAULT_POLICY_NAME = 'Default enterprise network policy'

const defaultPolicy: EnterpriseNetworkPolicy = {
  proxy: {
    preferSystemProxy: true,
    supportedTypes: ['http', 'https', 'socks5', 'pac', 'system'],
    supportedAuth: ['none', 'basic', 'ntlm', 'kerberos', 'negotiate'],
    requireSecretRefForPasswords: true,
    defaultNoProxy: ['localhost', '127.0.0.1', '::1'],
    ntlmRequiresRequestsNtlm: true,
    nodeRequiresProxyAgent: true,
    browserProxyInjection: true,
  },
  certificates: {
    useSystemCertStoreForBrowser: true,
    cliEnvVars: ['NODE_EXTRA_CA_CERTS', 'SSL_CERT_FILE', 'REQUESTS_CA_BUNDLE'],
    manualTrustRequiresApproval: true,
    rejectUnauthorizedBypassProhibited: true,
  },
}

export async function seedEnterpriseNetworkPolicy(): Promise<EnterpriseNetworkPolicyRow> {
  const existing = await db.query.enterpriseNetworkPolicies.findFirst({
    where: eq(schema.enterpriseNetworkPolicies.name, DEFAULT_POLICY_NAME),
  })
  if (existing) return existing
  const now = Date.now()
  const row: EnterpriseNetworkPolicyRow = {
    id: newEnterpriseNetworkPolicyId(),
    name: DEFAULT_POLICY_NAME,
    policy: defaultPolicy,
    status: 'active',
    createdAt: now,
    updatedAt: now,
  }
  await db.insert(schema.enterpriseNetworkPolicies).values(row)
  return row
}

export async function listEnterpriseNetworkPolicies(args: {
  status?: EnterpriseNetworkPolicyRow['status']
  limit?: number
} = {}): Promise<EnterpriseNetworkPolicyRow[]> {
  const filters: SQL[] = []
  if (args.status) filters.push(eq(schema.enterpriseNetworkPolicies.status, args.status))
  return db.query.enterpriseNetworkPolicies.findMany({
    where: filters.length ? and(...filters) : undefined,
    orderBy: [desc(schema.enterpriseNetworkPolicies.updatedAt)],
    limit: Math.min(Math.max(args.limit ?? 25, 1), 100),
  })
}

export async function evaluateEnterpriseNetwork(
  args: EvaluateEnterpriseNetworkArgs,
): Promise<EnterpriseNetworkEvaluationResult> {
  const policy = args.policyId
    ? await getRequiredPolicy(args.policyId)
    : await seedEnterpriseNetworkPolicy()
  if (policy.status !== 'active') throw new Error(`Enterprise network policy is ${policy.status}: ${policy.id}`)

  const input = normalizeInput(args)
  const risks = collectRisks(input, policy.policy)
  const actions = uniqueActions(risks, input, policy.policy)
  if (!actions.length) actions.push('continue')
  const status = statusFromRisks(risks)
  const evaluation: EnterpriseNetworkEvaluationRow = {
    id: newEnterpriseNetworkEvaluationId(),
    policyId: policy.id,
    input,
    risks,
    actions,
    status,
    recommendation: recommendationFor(status, risks, actions, policy.policy),
    createdAt: Date.now(),
  }
  await db.insert(schema.enterpriseNetworkEvaluations).values(evaluation)
  return {
    policy,
    evaluation,
    summary: {
      riskCount: risks.length,
      needsUser: risks.filter((risk) => risk.severity === 'needs_user').length,
      warnings: risks.filter((risk) => risk.severity === 'warning').length,
      actions,
    },
  }
}

export async function listEnterpriseNetworkEvaluations(args: {
  status?: EnterpriseNetworkStatus
  limit?: number
} = {}): Promise<EnterpriseNetworkEvaluationRow[]> {
  const filters: SQL[] = []
  if (args.status) filters.push(eq(schema.enterpriseNetworkEvaluations.status, args.status))
  return db.query.enterpriseNetworkEvaluations.findMany({
    where: filters.length ? and(...filters) : undefined,
    orderBy: [desc(schema.enterpriseNetworkEvaluations.createdAt)],
    limit: Math.min(Math.max(args.limit ?? 50, 1), 200),
  })
}

function normalizeInput(args: EvaluateEnterpriseNetworkArgs): EnterpriseNetworkInput {
  return {
    proxyType: args.proxyType,
    proxyUrl: args.proxyUrl?.trim(),
    auth: args.auth ?? 'none',
    username: args.username?.trim(),
    passwordRef: args.passwordRef?.trim(),
    domain: args.domain?.trim(),
    pacUrl: args.pacUrl?.trim(),
    noProxy: args.noProxy ?? [],
    needsBrowserProxy: args.needsBrowserProxy,
    needsNodeProxy: args.needsNodeProxy,
    needsPythonRequests: args.needsPythonRequests,
    certificateIssues: args.certificateIssues ?? [],
    caBundlePath: args.caBundlePath?.trim(),
    sslInspectionDetected: args.sslInspectionDetected,
    targetUrl: args.targetUrl?.trim(),
  }
}

function collectRisks(input: EnterpriseNetworkInput, policy: EnterpriseNetworkPolicy): EnterpriseNetworkRisk[] {
  const risks: EnterpriseNetworkRisk[] = []
  const proxyType = input.proxyType ?? (policy.proxy.preferSystemProxy ? 'system' : undefined)

  if (!proxyType) {
    risks.push(risk('proxy', 'warning', 'No proxy mode selected; enterprise networks often require system proxy discovery.', 'use_system_proxy'))
  } else if (!policy.proxy.supportedTypes.includes(proxyType)) {
    risks.push(risk('proxy', 'blocked', `Proxy type ${proxyType} is not supported by the enterprise policy.`, 'ask_it_admin'))
  } else if (proxyType !== 'system' && proxyType !== 'pac' && !input.proxyUrl) {
    risks.push(risk('proxy', 'needs_user', `Proxy type ${proxyType} requires a proxy URL.`, 'ask_it_admin'))
  }

  if (proxyType === 'pac' && !input.pacUrl) {
    risks.push(risk('pac', 'needs_user', 'PAC proxy mode requires a PAC URL or system auto-detect source.', 'use_system_proxy'))
  }

  const auth = input.auth ?? 'none'
  if (!policy.proxy.supportedAuth.includes(auth)) {
    risks.push(risk('proxy_auth', 'blocked', `Proxy auth mode ${auth} is not supported.`, 'ask_it_admin'))
  }
  if (auth !== 'none' && policy.proxy.requireSecretRefForPasswords && !input.passwordRef) {
    risks.push(risk('proxy_auth', 'needs_user', 'Proxy credentials must be stored as a Secret Vault reference.', 'ask_it_admin'))
  }
  if (auth === 'ntlm' && input.needsPythonRequests) {
    risks.push(risk('proxy_auth', 'warning', 'Python requests requires requests-ntlm for NTLM proxy auth.', 'install_requests_ntlm'))
  }
  if ((auth === 'ntlm' || auth === 'kerberos' || auth === 'negotiate') && input.needsNodeProxy) {
    risks.push(risk('proxy_auth', 'warning', 'Node.js model/tool calls need an authenticated proxy agent for enterprise auth.', 'configure_node_proxy_agent'))
  }
  if (input.needsBrowserProxy && proxyType && proxyType !== 'system') {
    risks.push(risk('proxy', 'warning', 'Browser instances need explicit proxy configuration and auth injection.', 'configure_browser_proxy'))
  }

  const missingNoProxy = policy.proxy.defaultNoProxy.filter((entry) => !(input.noProxy ?? []).includes(entry))
  if (missingNoProxy.length && proxyType && proxyType !== 'system') {
    risks.push(risk('no_proxy', 'info', `noProxy is missing local entries: ${missingNoProxy.join(', ')}.`, 'use_system_proxy'))
  }

  const certIssues = certificateIssues(input)
  for (const issue of certIssues) {
    risks.push(certificateRisk(issue, input, policy))
  }

  return risks
}

function certificateIssues(input: EnterpriseNetworkInput): EnterpriseCertificateIssue[] {
  const issues = new Set(input.certificateIssues ?? [])
  if (input.sslInspectionDetected) issues.add('ssl_interception')
  issues.delete('none')
  return Array.from(issues)
}

function certificateRisk(
  issue: EnterpriseCertificateIssue,
  input: EnterpriseNetworkInput,
  policy: EnterpriseNetworkPolicy,
): EnterpriseNetworkRisk {
  if (issue === 'missing_ca_bundle' || !input.caBundlePath) {
    return risk(
      'certificate',
      policy.certificates.manualTrustRequiresApproval ? 'needs_user' : 'warning',
      'Certificate trust requires an approved enterprise CA bundle before CLI or Python traffic is routed.',
      'manual_trust_certificate',
    )
  }
  if (issue === 'self_signed' || issue === 'corporate_ca') {
    return risk(
      'certificate',
      'warning',
      'Use the enterprise CA bundle for Node, generic CLI tools, and Python requests.',
      'set_node_extra_ca_certs',
    )
  }
  return risk(
    'certificate',
    'warning',
    'SSL inspection detected; configure trusted CA bundle instead of disabling TLS verification.',
    'set_requests_ca_bundle',
  )
}

function risk(
  type: EnterpriseNetworkRisk['type'],
  severity: EnterpriseNetworkRisk['severity'],
  message: string,
  action: EnterpriseNetworkAction,
): EnterpriseNetworkRisk {
  return { type, severity, message, action }
}

function uniqueActions(
  risks: EnterpriseNetworkRisk[],
  input: EnterpriseNetworkInput,
  policy: EnterpriseNetworkPolicy,
): EnterpriseNetworkAction[] {
  const actions = new Set<EnterpriseNetworkAction>(risks.map((risk) => risk.action))
  if ((input.proxyType === 'system' || !input.proxyType) && policy.proxy.preferSystemProxy) actions.add('use_system_proxy')
  if (input.needsNodeProxy && input.proxyType && input.proxyType !== 'system') actions.add('configure_node_proxy_agent')
  if (input.needsBrowserProxy && input.proxyType && input.proxyType !== 'system') actions.add('configure_browser_proxy')
  if (risks.some((risk) => risk.type === 'certificate')) {
    actions.add('set_node_extra_ca_certs')
    actions.add('set_ssl_cert_file')
    actions.add('set_requests_ca_bundle')
  }
  return Array.from(actions)
}

function statusFromRisks(risks: EnterpriseNetworkRisk[]): EnterpriseNetworkStatus {
  if (risks.some((risk) => risk.severity === 'blocked')) return 'blocked'
  if (risks.some((risk) => risk.severity === 'needs_user')) return 'needs_user'
  if (risks.some((risk) => risk.severity === 'warning')) return 'warning'
  return 'safe'
}

function recommendationFor(
  status: EnterpriseNetworkStatus,
  risks: EnterpriseNetworkRisk[],
  actions: EnterpriseNetworkAction[],
  policy: EnterpriseNetworkPolicy,
): string {
  if (!risks.length) return 'Enterprise network inputs look safe; continue with the selected route.'
  if (status === 'blocked') return 'Stop network routing until IT confirms the unsupported proxy or auth mode.'
  if (actions.includes('manual_trust_certificate')) {
    return policy.certificates.rejectUnauthorizedBypassProhibited
      ? 'Ask the user or IT to approve the enterprise CA bundle. Do not disable TLS verification.'
      : 'Ask the user or IT to approve the enterprise CA bundle before continuing.'
  }
  if (actions.includes('install_requests_ntlm')) return 'Install requests-ntlm for Python tools and configure Node/browser proxy adapters.'
  if (actions.includes('configure_node_proxy_agent')) return 'Configure authenticated proxy agents for Node, browser, and CLI traffic.'
  return 'Apply the enterprise proxy and certificate environment recommendations before retrying.'
}

async function getRequiredPolicy(id: string): Promise<EnterpriseNetworkPolicyRow> {
  const row = await db.query.enterpriseNetworkPolicies.findFirst({
    where: eq(schema.enterpriseNetworkPolicies.id, id),
  })
  if (!row) throw new Error(`Enterprise network policy not found: ${id}`)
  return row
}
