import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'

import { desc, eq } from 'drizzle-orm'

import { db, schema } from '@/db/client'
import type {
  AgentWorkstationRow,
  ApprovalRequestRow,
  ComputerSessionRow,
  HealthStatus,
  JsonObject,
  ResourceLockRow,
  WorkstationMode,
} from '@/db/schema'
import {
  LIVE_PILOT_LEASE_HASH_ENV,
  evaluateProductionGoLiveRuntimeGate,
} from '@/server/go-live-enforcement-service'
import { newAgentWorkstationId } from '@/server/ids'
import { ADB_ARGS_PREFIX_ENV, ADB_PATH_ENV, resolveAdbCommand } from '@/server/runtime-control-service'
import { createCredentialScope, createSecret, recordAuditLog } from '@/server/security-service'

import packageJson from '../../package.json'

const execFileAsync = promisify(execFile)
const DEFAULT_STALE_BUSY_WORKSTATION_MS = 2 * 60 * 60 * 1000
const PRODUCTION_AUDIT_LOOKBACK_LIMIT = 1000
const MODEL_ENDPOINT_HOST_ALLOWLIST_ENV = 'AGENTHUB_ALLOWED_MODEL_ENDPOINT_HOSTS'
const CUSTOMER_AUTHORIZATION_ENV = 'AGENTHUB_CUSTOMER_ENVIRONMENT_AUTHORIZED'
const CUSTOMER_AUTHORIZATION_EVIDENCE_HASH_ENV = 'AGENTHUB_CUSTOMER_AUTHORIZATION_EVIDENCE_HASH'
const DEFAULT_VAULT_MASTER_KEY_ROTATION_DAYS = 90
const VAULT_MASTER_KEY_ROTATION_DAYS_ENV = 'AGENTHUB_VAULT_MASTER_KEY_ROTATION_DAYS'

export type ProductionIntegrationStatus =
  | 'ready'
  | 'available'
  | 'not_configured'
  | 'not_installed'
  | 'blocked'
  | 'unknown'

export interface ProductionProbeResult {
  key: string
  label: string
  status: ProductionIntegrationStatus
  evidence: string[]
  warnings: string[]
  nextActions: string[]
  checkedAt: number
}

export interface DesktopAutomationProbe extends ProductionProbeResult {
  platform: NodeJS.Platform
  canObserveWindows: boolean
  canControlPhysicalDesktop: boolean
  windowSamples: Array<{ processName: string; title: string }>
}

export interface MobileAutomationDiscovery extends ProductionProbeResult {
  adb: CommandProbe
  appium: CommandProbe
  devices: MobileDeviceProbe[]
}

export interface WorkstationProviderDiscovery extends ProductionProbeResult {
  providers: WorkstationProviderProbe[]
}

export interface WorkstationLeaseRecoveryItem {
  workstationId: string
  agentProfileId: string
  mode: WorkstationMode
  status: AgentWorkstationRow['status']
  updatedAt: number
  ageMs: number
  stale: boolean
  recoverable: boolean
  activeSessionIds: string[]
  heldLockIds: string[]
  blockers: string[]
}

export interface WorkstationLeaseRecoveryReport {
  generatedAt: number
  maxBusyAgeMs: number
  summary: {
    busyWorkstations: number
    staleBusyWorkstations: number
    recoverableWorkstations: number
    blockedWorkstations: number
    recoveredWorkstations: number
  }
  items: WorkstationLeaseRecoveryItem[]
  warnings: string[]
  nextActions: string[]
  applied: boolean
  recoveredIds: string[]
}

export interface ProductionHardeningReport {
  status: ProductionIntegrationStatus
  readinessScore: number
  generatedAt: number
  app: {
    name: string
    version: string
    platform: NodeJS.Platform
    arch: string
    node: string
    electronMode: 'dev' | 'packaged' | 'node'
    dataDir: string
  }
  checks: ProductionProbeResult[]
  counts: {
    modelProfiles: number
    liveModelTests: number
    modelCapabilityProbes: number
    successfulModelCapabilityProbes: number
    modelGatewayAuditLogs: number
    modelGatewayInvokeAuditLogs: number
    secrets: number
    scopedCredentials: number
    agentWorkstations: number
    computerSessions: number
    softwareCommands: number
    runtimeMappedSoftwareCommands: number
    softwareCommandRuns: number
    softwareCommandApprovals: number
    approvalBoundSoftwareCommandApprovals: number
    runtimeApprovalBoundSoftwareCommandApprovals: number
    approvedSoftwareCommandApprovals: number
    runtimeControlApprovals: number
    approvalBoundRuntimeControlApprovals: number
    approvedRuntimeControlApprovals: number
    runtimeControlActions: number
    completedRuntimeControlActions: number
    blockedRuntimeControlActions: number
    runtimeControlKillSwitchActions: number
    desktopTargetAllowlistActions: number
    desktopTargetAllowlistBlockedActions: number
    desktopTargetAllowlistPassedActions: number
    desktopInputActions: number
    desktopInputFocusBoundActions: number
    desktopInputFocusMissingActions: number
    desktopPointerActions: number
    desktopPointerFocusBoundActions: number
    desktopPointerFocusMissingActions: number
    successfulWorkstationValidations: number
    blockedWorkstationValidations: number
    workstationReleaseActions: number
    staleBusyWorkstations: number
    recoverableStaleBusyWorkstations: number
    mobileScreenshotActions: number
    mobileDeviceAllowlistActions: number
    mobileDeviceAllowlistBlockedActions: number
    mobileDeviceAllowlistPassedActions: number
    mobileAppAllowlistActions: number
    mobileAppAllowlistBlockedActions: number
    mobileAppAllowlistPassedActions: number
    workstationTargetAllowlistActions: number
    workstationTargetAllowlistBlockedActions: number
    workstationTargetAllowlistPassedActions: number
    runtimeFileOutputActions: number
    redactedRuntimeFileOutputs: number
    unredactedRuntimeFileOutputs: number
    auditLogs: number
  }
  gaps: string[]
  warnings: string[]
  recommendations: string[]
}

export interface ProductionIntegrationReadiness {
  status: ProductionIntegrationStatus
  readinessScore: number
  generatedAt: number
  categories: ProductionProbeResult[]
  summary: {
    modelProfiles: number
    modelProfilesUsingVault: number
    modelProfilesWithScopedVaultCredentials: number
    liveModelTests: number
    modelCapabilityProbes: number
    successfulModelCapabilityProbes: number
    secrets: number
    desktopPlatform: NodeJS.Platform
    mobileCompanionConfigured: boolean
    agentWorkstations: number
  }
}

export interface ProductionModelCredentialReport {
  status: ProductionIntegrationStatus
  readinessScore: number
  generatedAt: number
  summary: {
    modelProfiles: number
    readyModels: number
    vaultBackedModels: number
    envBackedModels: number
    unresolvedModels: number
    inlineSecretBlockedModels: number
    scopedForConnect: number
    scopedForInvoke: number
    liveConnectionOk: number
    liveInvocationOk: number
  }
  models: ProductionModelCredentialItem[]
  blockers: string[]
  nextActions: string[]
}

export interface ProductionModelCredentialIntakeReport {
  status: ProductionIntegrationStatus
  readinessScore: number
  generatedAt: number
  redacted: true
  summary: {
    totalModels: number
    vaultReadyModels: number
    envMigratableModels: number
    inlineSecretBlockedModels: number
    missingScopeModels: number
    migratedSecretRefs: number
  }
  items: ProductionModelCredentialIntakeItem[]
  blockers: string[]
  nextActions: string[]
  safetyNotice: string
}

export interface ProductionModelCredentialIntakeItem {
  modelProfileId: string
  name: string
  provider: string
  model: string
  status: ProductionIntegrationStatus
  credentialRefKind: ProductionModelCredentialItem['credential']['refKind']
  currentRefPreview: string
  proposedSecretRef: string | null
  proposedEnvVar: string | null
  envValuePresent: boolean | null
  secretId: string | null
  connectScope: ProductionModelCredentialItem['credential']['connectScope']
  invokeScope: ProductionModelCredentialItem['credential']['invokeScope']
  canMigrateFromEnv: boolean
  canAttachExistingSecret: boolean
  requiresManualSecretInput: boolean
  redacted: true
  evidence: string[]
  blockers: string[]
  nextActions: string[]
}

export interface ApplyProductionModelCredentialIntakeArgs {
  modelProfileId: string
  envVar?: string | null
  secretId?: string | null
  grantConnect?: boolean
  grantInvoke?: boolean
  confirmMigrate?: boolean
}

export interface ProductionModelCredentialIntakeApplyResult {
  applied: boolean
  redacted: true
  modelProfileId: string
  previousApiKeyRef: string
  nextApiKeyRef: string
  secretId: string | null
  createdSecret: boolean
  createdScopes: string[]
  status: ProductionIntegrationStatus
  message: string
  plan: ProductionModelCredentialIntakeItem
}

export interface ProductionModelCredentialItem {
  modelProfileId: string
  name: string
  provider: string
  model: string
  baseUrlHost: string
  networkProfileId: string | null
  status: ProductionIntegrationStatus
  credential: {
    refKind: 'secret_vault' | 'env' | 'unresolved' | 'inline_secret_blocked'
    refPreview: string
    envVar: string | null
    envValuePresent: boolean | null
    secretId: string | null
    secretName: string | null
    secretKind: string | null
    secretStatus: string | null
    secretValuePresent: boolean | null
    secretResolvable: boolean | null
    connectScope: 'allowed' | 'missing' | 'not_applicable'
    invokeScope: 'allowed' | 'missing' | 'not_applicable'
  }
  latestLiveConnection: ProductionModelCredentialTestEvidence | null
  latestLiveInvocation: ProductionModelCredentialTestEvidence | null
  evidence: string[]
  warnings: string[]
  nextActions: string[]
}

export interface ProductionModelCredentialTestEvidence {
  id: string
  status: HealthStatus
  mode: 'dry_run' | 'live'
  message: string
  latencyMs: number | null
  createdAt: number
}

export interface RuntimeControlReadinessReport {
  status: ProductionIntegrationStatus
  readinessScore: number
  generatedAt: number
  gates: RuntimeControlGateProbe[]
  workstationChecks: WorkstationReadinessProbe[]
  summary: {
    runtimeControlActions: number
    completedRuntimeControlActions: number
    blockedRuntimeControlActions: number
    approvedRuntimeControlApprovals: number
    enabledHighRiskGates: number
    totalHighRiskGates: number
    readyWorkstations: number
    blockedWorkstations: number
  }
  recommendations: string[]
}

export interface RealControlRuntimeAcceptanceReport {
  status: ProductionIntegrationStatus
  readinessScore: number
  generatedAt: number
  safeToUseLiveControls: boolean
  summary: {
    desktopReady: boolean
    mobileReady: boolean
    workstationReady: boolean
    customerAuthorized: boolean
    customerAuthorizationSwitchEnabled: boolean
    customerAuthorizationEvidenceHashPresent: boolean
    customerAuthorizationEvidenceMatched: boolean
    enabledHighRiskGates: number
    totalHighRiskGates: number
    liveExecutions: number
    blockedActions: number
    readyWorkstations: number
    blockedWorkstations: number
  }
  desktop: RealControlDomainAcceptance
  mobile: RealControlDomainAcceptance
  workstations: RealControlDomainAcceptance
  checks: ProductionProbeResult[]
  blockers: string[]
  nextActions: string[]
}

export interface RealControlDomainAcceptance {
  key: 'desktop' | 'mobile' | 'workstation'
  label: string
  status: ProductionIntegrationStatus
  toolchainStatus: ProductionIntegrationStatus
  gates: RuntimeControlGateProbe[]
  evidence: string[]
  warnings: string[]
  blockers: string[]
  nextActions: string[]
  liveExecutions: number
  blockedActions: number
  ready: boolean
}

export type ProductionSetupStepStatus = 'done' | 'needs_action' | 'blocked'

export interface ProductionSetupGuide {
  status: ProductionIntegrationStatus
  completionPercent: number
  generatedAt: number
  steps: ProductionSetupGuideStep[]
  summary: {
    done: number
    needsAction: number
    blocked: number
    total: number
    productionReady: boolean
  }
}

export interface ProductionSetupGuideStep {
  key: string
  title: string
  status: ProductionSetupStepStatus
  readinessStatus: ProductionIntegrationStatus
  evidence: string[]
  blockers: string[]
  nextActions: string[]
  primaryActionLabel: string
  targetRoute?: string
}

export interface ProductionCustomerEnvironmentReport {
  status: ProductionIntegrationStatus
  readinessScore: number
  generatedAt: number
  safeToRunLive: boolean
  host: {
    platform: NodeJS.Platform
    arch: string
    node: string
    electronMode: 'dev' | 'packaged' | 'node'
    dataDir: string
  }
  setupGuide: {
    completionPercent: number
    productionReady: boolean
    done: number
    needsAction: number
    blocked: number
    total: number
  }
  envGates: ProductionEnvironmentGate[]
  runtimeGuards: ProductionExecutionPreflightRuntimeGuard[]
  emergencyStop: ProductionExecutionPreflightEmergencyStop
  customerAuthorization: {
    switchEnabled: boolean
    evidenceHash: string | null
    evidenceHashPresent: boolean
    evidenceMatched: boolean
    matchedEvidenceId: string | null
    matchedEvidenceTitle: string | null
    matchedEvidenceAt: number | null
  }
  checks: ProductionProbeResult[]
  evidence: string[]
  blockers: string[]
  nextActions: string[]
}

export interface ProductionCustomerEnvironmentPackage {
  id: string
  generatedAt: number
  redacted: true
  contentHash: string
  report: ProductionCustomerEnvironmentReport
  files: {
    manifestPath: string
    markdownPath: string
    preflightScriptPath: string
    rollbackScriptPath: string
    manifestFileName: string
    markdownFileName: string
    preflightScriptFileName: string
    rollbackScriptFileName: string
  }
  summary: {
    status: ProductionIntegrationStatus
    readinessScore: number
    safeToRunLive: boolean
    blockers: number
    nextActions: number
  }
}

export type ProductionPackageIntegrityKind = 'onsite_activation' | 'customer_environment'

export interface ProductionPackageIntegrityReport {
  status: ProductionIntegrationStatus
  readinessScore: number
  generatedAt: number
  summary: {
    totalPackages: number
    readyPackages: number
    blockedPackages: number
    onsiteActivationPackages: number
    customerEnvironmentPackages: number
    latestReadyPackageHash: string | null
  }
  packages: ProductionPackageIntegrityItem[]
  checks: ProductionProbeResult[]
  blockers: string[]
  nextActions: string[]
}

export interface ProductionPackageIntegrityItem {
  id: string
  kind: ProductionPackageIntegrityKind
  status: ProductionIntegrationStatus
  generatedAt: number | null
  contentHash: string | null
  expectedContentHash: string | null
  contentHashMatches: boolean
  manifestPath: string | null
  markdownPath: string | null
  scriptPaths: string[]
  filesPresent: boolean
  manifestReadable: boolean
  manifestSchemaMatches: boolean
  scriptHashesMatch: boolean
  redacted: boolean
  sensitiveHits: string[]
  evidence: string[]
  warnings: string[]
  nextActions: string[]
}

export interface ProductionEnvironmentGate {
  key: string
  label: string
  envVar: string
  enabled: boolean
  riskLevel: 'medium' | 'high'
  purpose: string
}

export type ProductionExecutionPreflightDomain = 'model' | 'desktop' | 'mobile' | 'workstation'

export interface ProductionExecutionPreflightReport {
  status: ProductionIntegrationStatus
  readinessScore: number
  generatedAt: number
  safeToExecuteAnyLiveAction: boolean
  canExecuteReadOnly: boolean
  summary: {
    totalActions: number
    executableNow: number
    blocked: number
    readOnly: number
    highRisk: number
    enabledEnvGates: number
    requiredEnvGates: number
    readyModels: number
    readyWorkstations: number
  }
  actions: ProductionExecutionPreflightAction[]
  blockers: string[]
  nextActions: string[]
  safetyNotice: string
}

export interface ProductionExecutionPreflightAction {
  id: string
  domain: ProductionExecutionPreflightDomain
  label: string
  actionType: string
  riskLevel: 'low' | 'medium' | 'high'
  status: ProductionIntegrationStatus
  canExecuteNow: boolean
  dryRunAvailable: boolean
  readOnly: boolean
  requiresApproval: boolean
  requiresGoLiveHash: boolean
  requiredEnvVars: ProductionExecutionPreflightEnvGate[]
  requiredRuntimeGuards?: ProductionExecutionPreflightRuntimeGuard[]
  emergencyStop?: ProductionExecutionPreflightEmergencyStop
  evidence: string[]
  blockers: string[]
  nextActions: string[]
}

export interface ProductionExecutionPreflightEnvGate {
  envVar: string
  enabled: boolean
  required: boolean
  purpose: string
}

export interface ProductionExecutionPreflightRuntimeGuard {
  key: string
  envVar: string
  configured: boolean
  required: boolean
  purpose: string
  valueHint: string
}

export interface ProductionExecutionPreflightEmergencyStop {
  envVar: string
  active: boolean
  blocksHighRiskLive: boolean
  purpose: string
}

export type ProductionGoLiveDrillDomain =
  | 'model'
  | 'desktop'
  | 'mobile'
  | 'workstation'
  | 'customer'
  | 'go_live'

export interface ProductionGoLiveDrillReport {
  status: ProductionIntegrationStatus
  readinessScore: number
  generatedAt: number
  safeToStartLivePilot: boolean
  willTouchExternalSystems: false
  summary: {
    totalScenarios: number
    passedScenarios: number
    blockedScenarios: number
    readOnlyScenarios: number
    highRiskScenarios: number
    goLiveGateAllowed: boolean
    customerAuthorized: boolean
    environmentFingerprintMatched: boolean
  }
  scenarios: ProductionGoLiveDrillScenario[]
  blockers: string[]
  nextActions: string[]
  safetyNotice: string
}

export interface ProductionGoLiveDrillScenario {
  id: string
  domain: ProductionGoLiveDrillDomain
  title: string
  target: string
  riskLevel: 'low' | 'medium' | 'high'
  readOnly: boolean
  status: ProductionIntegrationStatus
  canPassNow: boolean
  evidence: string[]
  blockers: string[]
  nextActions: string[]
}

export type ProductionOnsiteIntakeDomain =
  | 'model_credentials'
  | 'network_routes'
  | 'desktop_control'
  | 'mobile_control'
  | 'workstations'
  | 'customer_authorization'
  | 'runtime_guardrails'
  | 'hardening'
  | 'go_live'

export type ProductionOnsiteIntakeFieldKind =
  | 'secret_ref'
  | 'env_var'
  | 'network_profile'
  | 'device_id'
  | 'rdp_config'
  | 'vnc_url'
  | 'approval'
  | 'evidence'
  | 'command'
  | 'hash'

export type ProductionOnsiteIntakeFieldStatus = 'ready' | 'missing' | 'needs_review'

export interface ProductionOnsiteIntakeChecklist {
  status: ProductionIntegrationStatus
  readinessScore: number
  generatedAt: number
  redacted: true
  canProceedToGoLive: boolean
  summary: {
    totalItems: number
    readyItems: number
    blockedItems: number
    missingFields: number
    highRiskItems: number
    modelItems: number
    workstationItems: number
  }
  items: ProductionOnsiteIntakeItem[]
  blockers: string[]
  nextActions: string[]
  safetyNotice: string
}

export interface ProductionOnsiteIntakeItem {
  id: string
  domain: ProductionOnsiteIntakeDomain
  title: string
  ownerId: string | null
  status: ProductionIntegrationStatus
  ready: boolean
  riskLevel: 'low' | 'medium' | 'high'
  fields: ProductionOnsiteIntakeField[]
  validationCommands: ProductionOnsiteCommand[]
  evidence: string[]
  blockers: string[]
  nextActions: string[]
}

export interface ProductionOnsiteIntakeField {
  key: string
  label: string
  kind: ProductionOnsiteIntakeFieldKind
  required: boolean
  redacted: boolean
  currentStatus: ProductionOnsiteIntakeFieldStatus
  valuePreview: string | null
  instructions: string[]
}

export interface ProductionLiveConnectorReport {
  status: ProductionIntegrationStatus
  readinessScore: number
  generatedAt: number
  safeToActivateLive: boolean
  connectors: ProductionLiveConnector[]
  summary: {
    total: number
    ready: number
    available: number
    blocked: number
    models: number
    modelReady: number
    desktopReady: boolean
    mobileReady: boolean
    workstationReady: boolean
    customerAuthorized: boolean
    customerAuthorizationSwitchEnabled: boolean
    customerAuthorizationEvidenceHashPresent: boolean
    customerAuthorizationEvidenceMatched: boolean
  }
  checks: ProductionProbeResult[]
  blockers: string[]
  nextActions: string[]
}

export interface ProductionLiveConnector {
  id: string
  kind: 'model' | 'desktop' | 'mobile' | 'workstation' | 'customer_authorization'
  label: string
  status: ProductionIntegrationStatus
  ready: boolean
  ownerId: string | null
  routeLabel: string
  verification: {
    dryRunAvailable: boolean
    liveEvidenceCount: number
    lastLiveEvidenceAt: number | null
  }
  envGates: ProductionLiveConnectorEnvGate[]
  evidence: string[]
  warnings: string[]
  blockers: string[]
  nextActions: string[]
}

export interface ProductionLiveConnectorEnvGate {
  envVar: string
  label: string
  enabled: boolean
  requiredForLive: boolean
}

export interface ProductionOnsiteActivationGuide {
  status: ProductionIntegrationStatus
  readinessScore: number
  generatedAt: number
  safeToStartDryRun: boolean
  safeToActivateLive: boolean
  summary: {
    totalSteps: number
    doneSteps: number
    needsActionSteps: number
    blockedSteps: number
    envGates: number
    enabledEnvGates: number
    connectors: number
    readyConnectors: number
  }
  steps: ProductionOnsiteActivationStep[]
  envChecklist: ProductionOnsiteEnvInstruction[]
  validationCommands: ProductionOnsiteCommand[]
  rollbackPlan: ProductionOnsiteCommand[]
  blockers: string[]
  nextActions: string[]
}

export interface ProductionOnsiteActivationStep {
  id: string
  phase:
    | 'authorization'
    | 'credentials'
    | 'network'
    | 'desktop'
    | 'mobile'
    | 'workstation'
    | 'verification'
    | 'rollback'
  title: string
  status: ProductionSetupStepStatus
  riskLevel: 'low' | 'medium' | 'high'
  automationAvailable: boolean
  evidence: string[]
  actions: string[]
  verification: string[]
  rollback: string[]
}

export interface ProductionOnsiteEnvInstruction {
  envVar: string
  label: string
  enabled: boolean
  requiredForLive: boolean
  valueHint: string
  powershellPreview: string
}

export interface ProductionOnsiteCommand {
  label: string
  command: string
  riskLevel: 'low' | 'medium' | 'high'
  requiresHuman: boolean
  notes: string[]
}

export interface ProductionOnsiteActivationPackage {
  id: string
  generatedAt: number
  redacted: true
  contentHash: string
  guide: ProductionOnsiteActivationGuide
  files: {
    manifestPath: string
    markdownPath: string
    activationScriptPath: string
    rollbackScriptPath: string
    manifestFileName: string
    markdownFileName: string
    activationScriptFileName: string
    rollbackScriptFileName: string
  }
  summary: {
    status: ProductionIntegrationStatus
    readinessScore: number
    safeToActivateLive: boolean
    totalSteps: number
    blockedSteps: number
    rollbackCommands: number
  }
}

export type ProductionFinalAcceptanceCategoryKey =
  | 'model_credentials'
  | 'desktop_control'
  | 'mobile_control'
  | 'workstations'
  | 'customer_authorization'
  | 'runtime_guardrails'
  | 'hardening'
  | 'rollback'

export interface ProductionFinalAcceptanceLedger {
  status: ProductionIntegrationStatus
  readinessScore: number
  generatedAt: number
  canClaimProductionReady: boolean
  categories: ProductionFinalAcceptanceCategory[]
  summary: {
    total: number
    passed: number
    needsAction: number
    blocked: number
    evidenceItems: number
    requiredEvidenceItems: number
    onsiteEvidenceItems: number
    latestPackageHash: string | null
    latestEvidenceHash: string | null
    customerAuthorizationEvidenceHash: string | null
    customerAuthorizationEvidenceMatched: boolean
  }
  evidence: string[]
  blockers: string[]
  nextActions: string[]
}

export interface ProductionFinalAcceptanceCategory {
  key: ProductionFinalAcceptanceCategoryKey
  title: string
  status: ProductionIntegrationStatus
  passed: boolean
  requiredEvidence: string[]
  presentEvidence: string[]
  missingEvidence: string[]
  blockers: string[]
  nextActions: string[]
}

export interface ProductionOnsiteEvidenceReport {
  generatedAt: number
  records: ProductionOnsiteEvidenceRecord[]
  summary: {
    total: number
    categoriesCovered: number
    latestEvidenceHash: string | null
    byCategory: Record<ProductionFinalAcceptanceCategoryKey, number>
  }
}

export interface ProductionOnsiteEvidenceRecord {
  id: string
  category: ProductionFinalAcceptanceCategoryKey
  title: string
  evidence: string[]
  notes: string | null
  operator: string | null
  externalRef: string | null
  riskLevel: 'low' | 'medium' | 'high'
  contentHash: string
  verifiedAt: number
  createdAt: number
}

export interface CreateProductionOnsiteEvidenceArgs {
  category: ProductionFinalAcceptanceCategoryKey
  title: string
  evidence: string[]
  notes?: string | null
  operator?: string | null
  externalRef?: string | null
  riskLevel?: 'low' | 'medium' | 'high'
  verifiedAt?: number | null
}

export interface ProductionGoLiveDecision {
  id: string
  generatedAt: number
  decision: 'approved' | 'blocked'
  status: ProductionIntegrationStatus
  readinessScore: number
  contentHash: string
  canActivateLive: boolean
  ledgerSnapshot: {
    status: ProductionIntegrationStatus
    readinessScore: number
    canClaimProductionReady: boolean
    passed: number
    total: number
    blockers: number
    onsiteEvidenceItems: number
    latestPackageHash: string | null
    latestEvidenceHash: string | null
    customerAuthorizationEvidenceHash: string | null
    customerAuthorizationEvidenceMatched: boolean
  }
  environmentFingerprint: ProductionGoLiveEnvironmentFingerprint[]
  activationPlan: ProductionGoLiveActivationInstruction[]
  approvedHashInstruction: ProductionGoLiveActivationInstruction
  rollbackPlan: ProductionOnsiteCommand[]
  blockedReasons: string[]
  nextActions: string[]
  safetyNotice: string
}

export interface ProductionGoLiveEnvironmentFingerprint {
  envVar: string
  configured: boolean
  valueHash: string | null
}

export interface ProductionGoLiveActivationInstruction {
  envVar: string
  label: string
  currentlyEnabled: boolean
  requiredForLive: boolean
  riskLevel: 'medium' | 'high'
  powershellPreview: string
  reason: string
}

export interface ProductionLivePilotLease {
  id: string
  generatedAt: number
  expiresAt: number
  durationMinutes: number
  status: 'active' | 'blocked' | 'expired'
  contentHash: string
  currentlyEnabled: boolean
  goLiveDecisionHash: string | null
  customerAuthorizationEvidenceHash: string | null
  environmentFingerprintHash: string | null
  environmentFingerprintItems: number
  canActivateLivePilot: boolean
  activationInstruction: ProductionGoLiveActivationInstruction
  blockers: string[]
  nextActions: string[]
  safetyNotice: string
}

export type ProductionLivePilotSessionStatus = 'active' | 'blocked' | 'expired' | 'stopped'

export interface ProductionLivePilotSession {
  id: string
  generatedAt: number
  startedAt: number
  expiresAt: number
  stoppedAt: number | null
  durationMinutes: number
  status: ProductionLivePilotSessionStatus
  contentHash: string
  livePilotLeaseHash: string | null
  livePilotLeaseExpiresAt: number | null
  goLiveDecisionHash: string | null
  customerAuthorizationEvidenceHash: string | null
  environmentFingerprintHash: string | null
  canRunLivePilot: boolean
  blockers: string[]
  nextActions: string[]
  safetyNotice: string
}

export interface ProductionLivePilotSessionReport {
  generatedAt: number
  activeSession: ProductionLivePilotSession | null
  sessions: ProductionLivePilotSession[]
  summary: {
    total: number
    active: number
    stopped: number
    expired: number
    blocked: number
  }
  blockers: string[]
  nextActions: string[]
}

export interface RuntimeControlGateProbe extends ProductionProbeResult {
  scope: 'desktop' | 'mobile' | 'workstation'
  envVar: string | null
  envEnabled: boolean
  approvalRequired: boolean
  readOnly: boolean
  actionTypes: string[]
  recentActions: number
  completedActions: number
  blockedActions: number
  liveExecutions: number
  approvedRuntimeControlApprovals: number
  lastActionAt: number | null
}

export interface WorkstationReadinessProbe {
  id: string
  agentProfileId: string
  mode: WorkstationMode
  status: AgentWorkstationRow['status']
  ready: boolean
  hasVncUrl: boolean
  hasRdpConfig: boolean
  pathChecks: {
    workspacePath: boolean
    browserProfilePath: boolean
    tempPath: boolean
  }
  blockingReasons: string[]
  warnings: string[]
  nextActions: string[]
}

export interface CreateWorkstationReservationArgs {
  agentProfileId: string
  mode: Extract<WorkstationMode, 'virtual_desktop' | 'vm' | 'remote_session'>
  workspacePath?: string | null
  browserProfilePath?: string | null
  tempPath?: string | null
  displayId?: string | null
  vncUrl?: string | null
  rdpConfig?: string | null
}

interface CommandProbe {
  command: string
  available: boolean
  path?: string
  version?: string
  error?: string
}

interface MobileDeviceProbe {
  id: string
  status: string
  description: string
}

interface WorkstationProviderProbe {
  key: 'rdp' | 'hyperv' | 'virtualbox' | 'vmware' | 'docker' | 'wsl' | 'vnc'
  label: string
  available: boolean
  command?: string
  evidence: string[]
  warnings: string[]
}

export async function getProductionIntegrationReadiness(): Promise<ProductionIntegrationReadiness> {
  const [models, tests, secrets, scopes, workstations] = await Promise.all([
    db.query.modelProfiles.findMany(),
    db.query.modelConnectionTests.findMany({ orderBy: [desc(schema.modelConnectionTests.createdAt)], limit: 200 }),
    db.query.secretVault.findMany(),
    db.query.credentialScopes.findMany(),
    db.query.agentWorkstations.findMany(),
  ])
  const liveTests = tests.filter((test) => test.mode === 'live' && test.status === 'ok')
  const capabilityProbes = tests.filter(isModelCapabilityProbe)
  const successfulCapabilityProbes = capabilityProbes.filter((test) => test.mode === 'live' && test.status === 'ok')
  const modelProfilesUsingVault = models.filter((model) => isVaultRef(model.apiKeyRef)).length
  const modelProfilesWithScopedVaultCredentials = models.filter((model) =>
    isVaultRef(model.apiKeyRef) && hasCredentialScopeForModel(scopes, model.id),
  ).length
  const modelCredentialsStatus: ProductionIntegrationStatus =
    models.length === 0
      ? 'not_configured'
      : modelProfilesUsingVault > 0 &&
          modelProfilesWithScopedVaultCredentials === modelProfilesUsingVault &&
          (liveTests.length > 0 || successfulCapabilityProbes.length > 0)
        ? 'ready'
        : modelProfilesWithScopedVaultCredentials > 0 || liveTests.length > 0
          ? 'available'
          : 'not_configured'
  const mobileCompanionConfigured = Boolean(
    process.env.AGENTHUB_MOBILE_TOKEN?.trim() || process.env.AGENTHUB_MOBILE_DEV_TOKEN?.trim(),
  )
  const desktop = await probeDesktopAutomation({ live: false })
  const mobile = await discoverMobileAutomation({ live: false })
  const workstationsProbe = await discoverWorkstationProviders({ live: false })

  const categories: ProductionProbeResult[] = [
    {
      key: 'model_credentials',
      label: '外部模型凭证',
      status: modelCredentialsStatus,
      evidence: [
        `已注册 ${models.length} 个模型档案`,
        `${modelProfilesUsingVault} 个模型档案使用 Secret Vault 引用`,
        `${modelProfilesWithScopedVaultCredentials} 个模型档案具备凭证作用域授权`,
        `已记录 ${liveTests.length} 次成功的真实模型连接测试`,
        `已记录 ${successfulCapabilityProbes.length} 次成功的真实模型能力探测`,
        `已登记 ${secrets.length} 个密钥引用`,
      ],
      warnings:
        modelProfilesUsingVault === 0
          ? ['模型档案仍在使用环境变量引用或未解析引用；生产环境建议优先使用 Secret Vault 引用。']
          : modelProfilesWithScopedVaultCredentials < modelProfilesUsingVault
            ? ['部分使用 Vault 的模型档案缺少凭证作用域授权。']
          : [],
      nextActions:
        liveTests.length === 0
          ? ['配置凭证后，为每个生产模型档案运行一次真实连接测试。']
          : successfulCapabilityProbes.length === 0
            ? ['运行一次真实模型推理探测，证明模型不只是连得上，而是真的能完成推理。']
          : [],
      checkedAt: Date.now(),
    },
    desktop,
    mobile,
    workstationsProbe,
  ]

  const readinessScore = scoreReadiness(categories)
  return {
    status: readinessStatus(readinessScore, categories),
    readinessScore,
    generatedAt: Date.now(),
    categories,
    summary: {
      modelProfiles: models.length,
      modelProfilesUsingVault,
      modelProfilesWithScopedVaultCredentials,
      liveModelTests: liveTests.length,
      modelCapabilityProbes: capabilityProbes.length,
      successfulModelCapabilityProbes: successfulCapabilityProbes.length,
      secrets: secrets.length,
      desktopPlatform: process.platform,
      mobileCompanionConfigured,
      agentWorkstations: workstations.length,
    },
  }
}

export async function getProductionModelCredentialReport(): Promise<ProductionModelCredentialReport> {
  const [models, tests, secrets, scopes] = await Promise.all([
    db.query.modelProfiles.findMany(),
    db.query.modelConnectionTests.findMany({
      orderBy: [desc(schema.modelConnectionTests.createdAt)],
      limit: 1000,
    }),
    db.query.secretVault.findMany(),
    db.query.credentialScopes.findMany(),
  ])
  const secretById = new Map(secrets.map((secret) => [secret.id, secret]))
  const items = models.map((model): ProductionModelCredentialItem => {
    const credential = inspectModelCredentialRef({
      apiKeyRef: model.apiKeyRef,
      modelProfileId: model.id,
      secrets: secretById,
      scopes,
    })
    const latestLiveConnection = latestModelTestForProfile(tests, model.id, 'connection')
    const latestLiveInvocation = latestModelTestForProfile(tests, model.id, 'invocation')
    const liveConnectionOk = latestLiveConnection?.status === 'ok'
    const liveInvocationOk = latestLiveInvocation?.status === 'ok'
    const hasCredential =
      credential.refKind === 'secret_vault'
        ? credential.secretValuePresent === true && credential.secretResolvable !== false
        : credential.refKind === 'env'
          ? credential.envValuePresent === true
          : false
    const connectAllowed =
      credential.connectScope === 'allowed' || credential.connectScope === 'not_applicable'
    const invokeAllowed =
      credential.invokeScope === 'allowed' || credential.invokeScope === 'not_applicable'
    const status: ProductionIntegrationStatus =
      credential.refKind === 'inline_secret_blocked'
        ? 'blocked'
        : hasCredential && connectAllowed && invokeAllowed && liveConnectionOk && liveInvocationOk
          ? 'ready'
          : hasCredential && (liveConnectionOk || liveInvocationOk || connectAllowed || invokeAllowed)
            ? 'available'
            : 'not_configured'
    const warnings = [
      ...(credential.refKind === 'env'
        ? ['环境变量引用可用，但生产环境建议改为密钥库引用并绑定作用域。']
        : []),
      ...(credential.refKind === 'inline_secret_blocked'
        ? ['模型 apiKeyRef 疑似直接保存了明文密钥；应立即改为 env:NAME 或 secret:ID。']
        : []),
      ...(credential.refKind === 'secret_vault' && credential.secretStatus !== 'active'
        ? ['密钥库条目不是 active 状态。']
        : []),
      ...(credential.refKind === 'secret_vault' && credential.secretResolvable === false
        ? ['加密密钥无法解析；缺少 AGENTHUB_VAULT_MASTER_KEY。']
        : []),
      ...(latestLiveConnection && latestLiveConnection.status !== 'ok'
        ? [`最近一次实时连接失败：${latestLiveConnection.message}`]
        : []),
      ...(latestLiveInvocation && latestLiveInvocation.status !== 'ok'
        ? [`最近一次实时推理失败：${latestLiveInvocation.message}`]
        : []),
    ]
    const nextActions = [
      ...(!hasCredential ? ['配置可解析的模型凭证引用。'] : []),
      ...(credential.refKind === 'secret_vault' && credential.connectScope !== 'allowed'
        ? ['为该模型授予 model.connect 凭证作用域。']
        : []),
      ...(credential.refKind === 'secret_vault' && credential.invokeScope !== 'allowed'
        ? ['为该模型授予 model.invoke 凭证作用域。']
        : []),
      ...(!liveConnectionOk ? ['运行一次实时连接测试。'] : []),
      ...(!liveInvocationOk ? ['运行一次真实模型推理探测。'] : []),
    ]
    return {
      modelProfileId: model.id,
      name: model.name,
      provider: model.provider,
      model: model.model,
      baseUrlHost: safeUrlHost(model.baseUrl),
      networkProfileId: model.networkProfileId,
      status,
      credential,
      latestLiveConnection,
      latestLiveInvocation,
      evidence: [
        `凭证来源=${credential.refKind}`,
        `凭证引用=${credential.refPreview}`,
        `连接授权=${credential.connectScope}`,
        `推理授权=${credential.invokeScope}`,
        `实时连接=${latestLiveConnection?.status ?? 'missing'}`,
        `实时推理=${latestLiveInvocation?.status ?? 'missing'}`,
      ],
      warnings: uniqueNonEmpty(warnings),
      nextActions: uniqueNonEmpty(nextActions),
    }
  })
  const checks: ProductionProbeResult[] = items.map((item) => ({
    key: `model_credential_${item.modelProfileId}`,
    label: item.name,
    status: item.status,
    evidence: item.evidence,
    warnings: item.warnings,
    nextActions: item.nextActions,
    checkedAt: Date.now(),
  }))
  const readinessScore = checks.length ? scoreReadiness(checks) : 0
  const report: ProductionModelCredentialReport = {
    status: checks.length ? readinessStatus(readinessScore, checks) : 'not_configured',
    readinessScore,
    generatedAt: Date.now(),
    summary: {
      modelProfiles: items.length,
      readyModels: items.filter((item) => item.status === 'ready').length,
      vaultBackedModels: items.filter((item) => item.credential.refKind === 'secret_vault').length,
      envBackedModels: items.filter((item) => item.credential.refKind === 'env').length,
      unresolvedModels: items.filter((item) => item.credential.refKind === 'unresolved').length,
      inlineSecretBlockedModels: items.filter((item) => item.credential.refKind === 'inline_secret_blocked').length,
      scopedForConnect: items.filter((item) => item.credential.connectScope === 'allowed').length,
      scopedForInvoke: items.filter((item) => item.credential.invokeScope === 'allowed').length,
      liveConnectionOk: items.filter((item) => item.latestLiveConnection?.status === 'ok').length,
      liveInvocationOk: items.filter((item) => item.latestLiveInvocation?.status === 'ok').length,
    },
    models: items,
    blockers: uniqueNonEmpty(
      items.flatMap((item) =>
        item.status === 'ready' || item.status === 'available' ? [] : item.nextActions,
      ),
    ),
    nextActions: uniqueNonEmpty(items.flatMap((item) => item.nextActions)),
  }
  await recordAuditLog({
    actorType: 'system',
    action: 'production.model_credentials.report',
    resourceType: 'production_integration',
    resourceId: 'model-credentials',
    riskLevel: 'low',
    message: `Production model credential report generated with score ${readinessScore}.`,
    metadata: {
      status: report.status,
      modelProfiles: report.summary.modelProfiles,
      readyModels: report.summary.readyModels,
      inlineSecretBlockedModels: report.summary.inlineSecretBlockedModels,
    },
  })
  return report
}

export async function getProductionModelCredentialIntakeReport(): Promise<ProductionModelCredentialIntakeReport> {
  const credentialReport = await getProductionModelCredentialReport()
  const items = credentialReport.models.map(modelCredentialItemToIntakeItem)
  const checks = items.map((item): ProductionProbeResult => ({
    key: `model_credential_intake_${item.modelProfileId}`,
    label: item.name,
    status: item.status,
    evidence: item.evidence,
    warnings: item.blockers,
    nextActions: item.nextActions,
    checkedAt: Date.now(),
  }))
  const readinessScore = checks.length ? scoreReadiness(checks) : 0
  const report: ProductionModelCredentialIntakeReport = {
    status: checks.length ? readinessStatus(readinessScore, checks) : 'not_configured',
    readinessScore,
    generatedAt: Date.now(),
    redacted: true,
    summary: {
      totalModels: items.length,
      vaultReadyModels: items.filter((item) => item.status === 'ready').length,
      envMigratableModels: items.filter((item) => item.canMigrateFromEnv).length,
      inlineSecretBlockedModels: items.filter((item) => item.credentialRefKind === 'inline_secret_blocked').length,
      missingScopeModels: items.filter((item) => item.connectScope === 'missing' || item.invokeScope === 'missing').length,
      migratedSecretRefs: items.filter((item) => item.credentialRefKind === 'secret_vault').length,
    },
    items,
    blockers: uniqueNonEmpty(items.flatMap((item) => item.blockers)).slice(0, 16),
    nextActions: uniqueNonEmpty(items.flatMap((item) => item.nextActions)).slice(0, 16),
    safetyNotice:
      '模型凭证接入只处理 env:NAME 或 secret:ID 引用，不在报告、接口响应或审计日志里返回 API Key 明文。',
  }
  await recordAuditLog({
    actorType: 'system',
    action: 'production.model_credentials.intake_report',
    resourceType: 'production_integration',
    resourceId: 'model-credential-intake',
    riskLevel: 'low',
    message: `Production model credential intake report generated with ${items.length} model items.`,
    metadata: {
      totalModels: report.summary.totalModels,
      envMigratableModels: report.summary.envMigratableModels,
      missingScopeModels: report.summary.missingScopeModels,
      redacted: true,
    },
  })
  return report
}

export async function applyProductionModelCredentialIntake(
  args: ApplyProductionModelCredentialIntakeArgs,
): Promise<ProductionModelCredentialIntakeApplyResult> {
  const model = await db.query.modelProfiles.findFirst({
    where: eq(schema.modelProfiles.id, args.modelProfileId),
  })
  if (!model) throw new Error(`Model profile not found: ${args.modelProfileId}`)

  const currentReport = await getProductionModelCredentialReport()
  const currentItem = currentReport.models.find((item) => item.modelProfileId === model.id)
  if (!currentItem) throw new Error(`Model credential report item not found: ${model.id}`)
  const plan = modelCredentialItemToIntakeItem(currentItem)
  const previousApiKeyRef = model.apiKeyRef
  const resolved = await resolveIntakeSecretTarget({
    modelProfileId: model.id,
    modelName: model.name,
    currentApiKeyRef: model.apiKeyRef,
    envVar: args.envVar,
    secretId: args.secretId,
    createIfMissing: Boolean(args.confirmMigrate),
  })

  if (!args.confirmMigrate) {
    return {
      applied: false,
      redacted: true,
      modelProfileId: model.id,
      previousApiKeyRef: redactCredentialRef(previousApiKeyRef),
      nextApiKeyRef: resolved.nextApiKeyRef,
      secretId: resolved.secretId,
      createdSecret: false,
      createdScopes: [],
      status: plan.status,
      message: 'Dry-run only. Set confirmMigrate=true to bind the model profile to this secret reference.',
      plan,
    }
  }

  if (currentItem.credential.refKind === 'inline_secret_blocked') {
    throw new Error('Inline-looking API keys cannot be migrated automatically; move the key into an environment variable or Secret Vault first.')
  }

  const now = Date.now()
  await db
    .update(schema.modelProfiles)
    .set({
      apiKeyRef: resolved.nextApiKeyRef,
      updatedAt: now,
      healthStatus: 'unknown',
      lastTestResult: 'Credential reference migrated into Secret Vault; run model connection tests again.',
      lastCheckedAt: now,
    })
    .where(eq(schema.modelProfiles.id, model.id))

  const createdScopes: string[] = []
  if (args.grantConnect ?? true) {
    const scope = await ensureModelCredentialScope(resolved.secretId, model.id, 'model.connect')
    if (scope.created) createdScopes.push(scope.scope.id)
  }
  if (args.grantInvoke ?? true) {
    const scope = await ensureModelCredentialScope(resolved.secretId, model.id, 'model.invoke')
    if (scope.created) createdScopes.push(scope.scope.id)
  }

  await recordAuditLog({
    actorType: 'system',
    action: 'production.model_credentials.intake_apply',
    resourceType: 'model_profile',
    resourceId: model.id,
    riskLevel: 'medium',
    message: `Model credential intake applied for ${model.name}.`,
    metadata: {
      modelProfileId: model.id,
      previousRefKind: currentItem.credential.refKind,
      nextApiKeyRef: resolved.nextApiKeyRef,
      secretId: resolved.secretId,
      createdSecret: resolved.createdSecret,
      createdScopes,
      redacted: true,
    },
  })

  const updatedReport = await getProductionModelCredentialReport()
  const updatedItem = updatedReport.models.find((item) => item.modelProfileId === model.id)
  const updatedPlan = updatedItem ? modelCredentialItemToIntakeItem(updatedItem) : plan
  return {
    applied: true,
    redacted: true,
    modelProfileId: model.id,
    previousApiKeyRef: redactCredentialRef(previousApiKeyRef),
    nextApiKeyRef: resolved.nextApiKeyRef,
    secretId: resolved.secretId,
    createdSecret: resolved.createdSecret,
    createdScopes,
    status: updatedPlan.status,
    message: 'Model profile is now bound to a Secret Vault reference; run live connection and invocation tests when the approved go-live hash is available.',
    plan: updatedPlan,
  }
}

export async function probeDesktopAutomation(args: {
  live?: boolean
  includeWindowList?: boolean
} = {}): Promise<DesktopAutomationProbe> {
  const evidence: string[] = [`platform=${process.platform}`]
  const warnings: string[] = []
  const nextActions: string[] = []
  const windowSamples: Array<{ processName: string; title: string }> = []

  let canObserveWindows = false
  let canControlPhysicalDesktop = false

  if (process.platform === 'win32') {
    const powershell = await probeCommand('powershell.exe', ['-NoProfile', '-Command', '$PSVersionTable.PSVersion.ToString()'])
    if (powershell.available) {
      evidence.push(`PowerShell 可用${powershell.version ? `：${powershell.version}` : ''}`)
      canObserveWindows = true
      canControlPhysicalDesktop = true
      if (args.live || args.includeWindowList) {
        const list = await runCommand('powershell.exe', [
          '-NoProfile',
          '-ExecutionPolicy',
          'Bypass',
          '-Command',
          "Get-Process | Where-Object { $_.MainWindowTitle } | Select-Object -First 8 ProcessName,MainWindowTitle | ConvertTo-Json -Compress",
        ])
        if (list.ok) {
          windowSamples.push(...parseWindowSamples(list.stdout))
          evidence.push(`已观察到 ${windowSamples.length} 个可见窗口`)
        } else {
          warnings.push(`窗口观察失败：${list.error}`)
        }
      }
    } else {
      warnings.push('PowerShell 不可用，无法运行 Windows 桌面观察。')
      nextActions.push('安装或启用 PowerShell 后再运行桌面自动化探测。')
    }
  } else {
    warnings.push('物理桌面自动化探测当前优先支持 Windows。')
    nextActions.push('为当前平台补充 macOS Accessibility 或 Linux xdotool/Wayland 适配器。')
  }

  await recordAuditLog({
    actorType: 'system',
    action: 'production.desktop.probe',
    resourceType: 'production_integration',
    resourceId: 'desktop',
    riskLevel: args.live ? 'medium' : 'low',
    message: 'Desktop automation capability was probed without clicking, typing, or moving the mouse.',
    metadata: { live: Boolean(args.live), includeWindowList: Boolean(args.includeWindowList), windowSamples },
  })

  const status: ProductionIntegrationStatus = canObserveWindows ? 'available' : 'not_installed'
  return {
    key: 'desktop_automation',
    label: 'Desktop control runtime',
    status,
    evidence,
    warnings,
    nextActions,
    checkedAt: Date.now(),
    platform: process.platform,
    canObserveWindows,
    canControlPhysicalDesktop,
    windowSamples,
  }
}

export async function discoverMobileAutomation(args: {
  live?: boolean
} = {}): Promise<MobileAutomationDiscovery> {
  const adbRuntime = resolveAdbCommand()
  const adb = await probeCommand(adbRuntime.command, [...adbRuntime.argsPrefix, 'version'])
  const appium = await probeCommand('appium', ['--version'])
  const devices: MobileDeviceProbe[] = []
  const evidence: string[] = [
    adbRuntime.configured
      ? `${ADB_PATH_ENV} 已配置，手机运行时会使用指定的 adb。`
      : `${ADB_PATH_ENV} 未配置，手机运行时会从 PATH 查找 adb。`,
    adbRuntime.argsPrefix.length > 0
      ? `${ADB_ARGS_PREFIX_ENV} 已配置，adb 调用会先附加 ${adbRuntime.argsPrefix.length} 个 wrapper 参数。`
      : `${ADB_ARGS_PREFIX_ENV} 未配置，adb 调用不会附加 wrapper 参数。`,
    adb.available ? `adb 可用${adb.version ? `：${adb.version}` : ''}` : 'adb 不可用',
    appium.available ? `appium available${appium.version ? `: ${appium.version}` : ''}` : 'appium not found',
  ]
  const warnings: string[] = []
  const nextActions: string[] = []

  if (args.live && adb.available) {
    const result = await runCommand(adbRuntime.command, [...adbRuntime.argsPrefix, 'devices', '-l'])
    if (result.ok) {
      devices.push(...parseAdbDevices(result.stdout))
      evidence.push(`通过 adb 发现 ${devices.length} 台 Android 设备。`)
    } else {
      warnings.push(`adb 设备发现失败：${result.error}`)
    }
  }

  if (!adb.available) {
    nextActions.push(`安装 Android platform-tools，并把 adb 加入 PATH，或设置 ${ADB_PATH_ENV} 指向 adb.exe。`)
  }
  if (!appium.available) nextActions.push('需要完整手机 App 自动化时，安装并配置 Appium。')

  await recordAuditLog({
    actorType: 'system',
    action: 'production.mobile.discover',
    resourceType: 'production_integration',
    resourceId: 'mobile',
    riskLevel: 'low',
    message: 'Mobile automation tooling was discovered without controlling a phone.',
    metadata: {
      live: Boolean(args.live),
      adb: adb.available,
      adbPathEnvVar: ADB_PATH_ENV,
      adbPathConfigured: adbRuntime.configured,
      adbArgsPrefixEnvVar: ADB_ARGS_PREFIX_ENV,
      adbArgsPrefixConfigured: adbRuntime.argsPrefix.length > 0,
      adbArgsPrefixCount: adbRuntime.argsPrefix.length,
      appium: appium.available,
      devices,
    },
  })

  const status: ProductionIntegrationStatus =
    adb.available || appium.available ? 'available' : 'not_installed'
  return {
    key: 'mobile_automation',
    label: '手机控制运行时',
    status,
    evidence,
    warnings,
    nextActions,
    checkedAt: Date.now(),
    adb,
    appium,
    devices,
  }
}

export async function discoverWorkstationProviders(args: {
  live?: boolean
} = {}): Promise<WorkstationProviderDiscovery> {
  const [mstsc, vbox, vmrun, docker, wsl, hyperv] = await Promise.all([
    locateCommand('mstsc.exe'),
    probeCommand('VBoxManage', ['--version']),
    probeCommand('vmrun', []),
    probeDockerProvider({ live: Boolean(args.live) }),
    probeWslProvider({ live: Boolean(args.live) }),
    probeHyperV(),
  ])
  const providers: WorkstationProviderProbe[] = [
    {
      key: 'rdp',
      label: 'Microsoft Remote Desktop',
      available: mstsc.available,
      command: 'mstsc.exe',
      evidence: mstsc.available
        ? [`mstsc.exe found${mstsc.path ? `: ${mstsc.path}` : ''}`]
        : [`mstsc.exe not found${mstsc.error ? `: ${mstsc.error}` : ''}`],
      warnings: [],
    },
    {
      key: 'virtualbox',
      label: 'VirtualBox',
      available: vbox.available,
      command: 'VBoxManage',
      evidence: vbox.available ? [`VBoxManage available${vbox.version ? `: ${vbox.version}` : ''}`] : ['VBoxManage not found'],
      warnings: [],
    },
    {
      key: 'vmware',
      label: 'VMware vmrun',
      available: vmrun.available,
      command: 'vmrun',
      evidence: vmrun.available ? ['vmrun available'] : ['vmrun not found'],
      warnings: [],
    },
    hyperv,
    docker,
    wsl,
    {
      key: 'vnc',
      label: 'VNC / remote session URL',
      available: true,
      evidence: ['VNC 地址可以注册成 remote_session 工作站。'],
      warnings: ['AgentHub 不保存远程桌面密码；请使用系统凭据管理器或有作用域的密钥。'],
    },
  ]
  const available = providers.filter((provider) => provider.available)
  const warnings = providers.flatMap((provider) => provider.warnings)
  const nextActions =
    available.length === 0
      ? ['启用并行桌面工作站前，请先安装或配置 RDP、VNC、Hyper-V、VirtualBox 或 VMware 提供方。']
      : ['为每个智能体登记可使用的 VM/RDP/VNC 工作站预约。']

  await recordAuditLog({
    actorType: 'system',
    action: 'production.workstations.discover',
    resourceType: 'production_integration',
    resourceId: 'workstations',
    riskLevel: 'low',
    message: 'Virtual workstation providers were discovered without starting or connecting to a VM.',
    metadata: { live: Boolean(args.live), providers: providers as unknown as JsonObject[] },
  })

  return {
    key: 'virtual_workstations',
    label: 'VM/RDP virtual workstations',
    status: available.length > 0 ? 'available' : 'not_installed',
    evidence: providers.flatMap((provider) => provider.evidence),
    warnings,
    nextActions,
    checkedAt: Date.now(),
    providers,
  }
}

export async function createWorkstationReservation(
  args: CreateWorkstationReservationArgs,
): Promise<AgentWorkstationRow> {
  if (!['virtual_desktop', 'vm', 'remote_session'].includes(args.mode)) {
    throw new Error('Production workstation reservations must use virtual_desktop, vm, or remote_session mode.')
  }
  const agent = await db.query.agentProfiles.findFirst({
    where: eq(schema.agentProfiles.id, args.agentProfileId),
  })
  if (!agent) throw new Error(`Agent profile not found: ${args.agentProfileId}`)

  assertWorkstationReservationIsRedacted(args)
  const paths = resolveWorkstationPaths(args)
  mkdirSync(paths.workspacePath, { recursive: true })
  mkdirSync(paths.browserProfilePath, { recursive: true })
  mkdirSync(paths.tempPath, { recursive: true })

  const now = Date.now()
  const row: AgentWorkstationRow = {
    id: newAgentWorkstationId(),
    agentProfileId: args.agentProfileId,
    mode: args.mode,
    workspacePath: paths.workspacePath,
    browserProfilePath: paths.browserProfilePath,
    tempPath: paths.tempPath,
    displayId: args.displayId?.trim() || null,
    vncUrl: args.vncUrl?.trim() || null,
    rdpConfig: args.rdpConfig?.trim() || null,
    status: 'idle',
    createdAt: now,
    updatedAt: now,
  }
  await db.insert(schema.agentWorkstations).values(row)
  await recordAuditLog({
    actorType: 'system',
    action: 'production.workstation.reserve',
    resourceType: 'agent_workstation',
    resourceId: row.id,
    riskLevel: args.mode === 'remote_session' ? 'medium' : 'low',
    message: `Workstation reservation created for Agent ${agent.name}.`,
    metadata: { mode: row.mode, agentProfileId: row.agentProfileId },
  })
  return row
}

export async function getWorkstationLeaseRecoveryReport(args: {
  maxBusyAgeMs?: number
} = {}): Promise<WorkstationLeaseRecoveryReport> {
  const maxBusyAgeMs = normalizeStaleBusyWorkstationMs(args.maxBusyAgeMs)
  const [workstations, sessions, resourceLocks] = await Promise.all([
    db.query.agentWorkstations.findMany(),
    db.query.computerSessions.findMany(),
    db.query.resourceLocks.findMany(),
  ])
  return buildWorkstationLeaseRecoveryReport({
    workstations,
    sessions,
    resourceLocks,
    maxBusyAgeMs,
    now: Date.now(),
    recoveredIds: [],
    applied: false,
  })
}

export async function recoverStaleWorkstationLeases(args: {
  maxBusyAgeMs?: number
  apply?: boolean
  confirmRecovery?: boolean
} = {}): Promise<WorkstationLeaseRecoveryReport> {
  if (args.apply && !args.confirmRecovery) {
    throw new Error('confirmRecovery=true is required before applying stale workstation recovery.')
  }
  const report = await getWorkstationLeaseRecoveryReport({ maxBusyAgeMs: args.maxBusyAgeMs })
  if (!args.apply) return report

  const now = Date.now()
  const recoverable = report.items.filter((item) => item.recoverable)
  for (const item of recoverable) {
    await db
      .update(schema.agentWorkstations)
      .set({ status: 'idle', updatedAt: now })
      .where(eq(schema.agentWorkstations.id, item.workstationId))
  }
  const recoveredIds = recoverable.map((item) => item.workstationId)
  await recordAuditLog({
    actorType: 'system',
    action: 'production.workstation.recover_stale',
    resourceType: 'agent_workstation',
    resourceId: recoveredIds.length === 1 ? recoveredIds[0] : 'multiple',
    riskLevel: recoveredIds.length > 0 ? 'medium' : 'low',
    message:
      recoveredIds.length > 0
        ? `Recovered ${recoveredIds.length} stale busy workstation lease(s).`
        : 'Stale busy workstation recovery ran with no recoverable workstations.',
    metadata: {
      maxBusyAgeMs: report.maxBusyAgeMs,
      recoveredIds,
      staleBusyWorkstations: report.summary.staleBusyWorkstations,
      blockedWorkstations: report.summary.blockedWorkstations,
    },
  })

  const [workstations, sessions, resourceLocks] = await Promise.all([
    db.query.agentWorkstations.findMany(),
    db.query.computerSessions.findMany(),
    db.query.resourceLocks.findMany(),
  ])
  return buildWorkstationLeaseRecoveryReport({
    workstations,
    sessions,
    resourceLocks,
    maxBusyAgeMs: report.maxBusyAgeMs,
    now,
    recoveredIds,
    applied: true,
  })
}

export async function getRuntimeControlReadinessReport(): Promise<RuntimeControlReadinessReport> {
  const [actions, approvals, workstations] = await Promise.all([
    db.query.computerActionEvents.findMany({
      orderBy: [desc(schema.computerActionEvents.createdAt)],
      limit: 500,
    }),
    db.query.approvalRequests.findMany({
      where: eq(schema.approvalRequests.type, 'runtime_control_action'),
      orderBy: [desc(schema.approvalRequests.createdAt)],
      limit: 200,
    }),
    db.query.agentWorkstations.findMany(),
  ])
  const runtimeActions = actions.filter((action) => action.actionType.startsWith('runtime_control.'))
  const approvedRuntimeControlApprovals = approvals.filter((approval) => approval.status === 'approved')
  const gateDefinitions = runtimeGateDefinitions()
  const gates = gateDefinitions.map((definition): RuntimeControlGateProbe => {
    const matchingActions = runtimeActions.filter((action) => definition.actionTypes.includes(action.actionType))
    const completedActions = matchingActions.filter((action) => action.status === 'complete')
    const blockedActions = matchingActions.filter((action) => action.status === 'blocked')
    const liveExecutions = matchingActions.filter((action) => action.output.liveExecuted === true)
    const envEnabled = definition.envVar ? process.env[definition.envVar] === '1' : true
    const approvalRequired = !definition.readOnly
    const status = runtimeGateStatus({
      readOnly: definition.readOnly,
      envEnabled,
      completedActions: completedActions.length,
      liveExecutions: liveExecutions.length,
      approvedRuntimeControlApprovals: approvedRuntimeControlApprovals.length,
    })
    return {
      key: definition.key,
      label: definition.label,
      status,
      evidence: [
        definition.envVar ? `${definition.envVar}=${envEnabled ? '1' : 'off'}` : '只读检查不需要高风险环境开关',
        `${matchingActions.length} 条相关运行时动作`,
        `${completedActions.length} 条完成`,
        `${blockedActions.length} 条被拦截`,
        `${liveExecutions.length} 条真实执行`,
        `${approvedRuntimeControlApprovals.length} 条已批准的运行时审批`,
      ],
      warnings: [
        ...(!definition.readOnly && !envEnabled ? [`${definition.envVar} 尚未开启，真实操作会被阻止。`] : []),
        ...(blockedActions.length > 0 ? ['最近存在被门控拦截的动作，请检查环境开关、审批或目标资源。'] : []),
      ],
      nextActions: runtimeGateNextActions({
        readOnly: definition.readOnly,
        envVar: definition.envVar,
        envEnabled,
        completedActions: completedActions.length,
        liveExecutions: liveExecutions.length,
        approvedRuntimeControlApprovals: approvedRuntimeControlApprovals.length,
      }),
      checkedAt: Date.now(),
      scope: definition.scope,
      envVar: definition.envVar,
      envEnabled,
      approvalRequired,
      readOnly: definition.readOnly,
      actionTypes: definition.actionTypes,
      recentActions: matchingActions.length,
      completedActions: completedActions.length,
      blockedActions: blockedActions.length,
      liveExecutions: liveExecutions.length,
      approvedRuntimeControlApprovals: approvedRuntimeControlApprovals.length,
      lastActionAt: matchingActions[0]?.createdAt ?? null,
    }
  })
  const workstationChecks = workstations.map(buildWorkstationReadinessProbe)
  const readyWorkstations = workstationChecks.filter((workstation) => workstation.ready)
  const blockedWorkstations = workstationChecks.filter((workstation) => !workstation.ready)
  const highRiskGates = gates.filter((gate) => !gate.readOnly)
  const enabledHighRiskGates = highRiskGates.filter((gate) => gate.envEnabled)
  const combinedChecks: ProductionProbeResult[] = [
    ...gates,
    {
      key: 'workstation_reservation_readiness',
      label: '工作站预留可用性',
      status:
        workstations.length === 0
          ? 'not_configured'
          : blockedWorkstations.length === 0
            ? 'ready'
            : readyWorkstations.length > 0
              ? 'available'
              : 'blocked',
      evidence: [
        `${workstations.length} 个工作站预留`,
        `${readyWorkstations.length} 个可用`,
        `${blockedWorkstations.length} 个阻塞`,
      ],
      warnings: blockedWorkstations.length > 0 ? ['存在缺少 RDP/VNC/VM 元数据或路径不可用的工作站。'] : [],
      nextActions:
        workstations.length === 0
          ? ['为需要操作桌面软件的 Agent 预留 VM/RDP/VNC 工作站。']
          : blockedWorkstations.length > 0
            ? ['打开工作站详情，补齐远程地址、RDP 配置或本地路径。']
            : [],
      checkedAt: Date.now(),
    },
  ]
  const readinessScore = scoreReadiness(combinedChecks)
  const recommendations = [
    ...new Set([
      ...combinedChecks.flatMap((check) => check.nextActions),
      '真实点击、输入、手机控制、远程桌面启动继续保留审批和审计链路。',
      '客户现场上线前，至少完成一次桌面观察、手机设备发现和工作站校验。',
    ]),
  ]
  const report: RuntimeControlReadinessReport = {
    status: readinessStatus(readinessScore, combinedChecks),
    readinessScore,
    generatedAt: Date.now(),
    gates,
    workstationChecks,
    summary: {
      runtimeControlActions: runtimeActions.length,
      completedRuntimeControlActions: runtimeActions.filter((action) => action.status === 'complete').length,
      blockedRuntimeControlActions: runtimeActions.filter((action) => action.status === 'blocked').length,
      approvedRuntimeControlApprovals: approvedRuntimeControlApprovals.length,
      enabledHighRiskGates: enabledHighRiskGates.length,
      totalHighRiskGates: highRiskGates.length,
      readyWorkstations: readyWorkstations.length,
      blockedWorkstations: blockedWorkstations.length,
    },
    recommendations,
  }
  await recordAuditLog({
    actorType: 'system',
    action: 'production.runtime_control.readiness',
    resourceType: 'production_integration',
    resourceId: 'runtime-control',
    riskLevel: 'low',
    message: `Runtime control readiness generated with score ${readinessScore}.`,
    metadata: {
      gates: gates.map((gate) => ({
        key: gate.key,
        status: gate.status,
        envEnabled: gate.envEnabled,
        recentActions: gate.recentActions,
      })) as unknown as JsonObject[],
      readyWorkstations: readyWorkstations.length,
      blockedWorkstations: blockedWorkstations.length,
    },
  })
  return report
}

export async function getRealControlRuntimeAcceptanceReport(): Promise<RealControlRuntimeAcceptanceReport> {
  const [desktopProbe, mobileDiscovery, workstationProviders, runtimeControl, customerAuthorization] = await Promise.all([
    probeDesktopAutomation({ live: true, includeWindowList: true }),
    discoverMobileAutomation({ live: true }),
    discoverWorkstationProviders({ live: true }),
    getRuntimeControlReadinessReport(),
    getCustomerAuthorizationEvidenceGate(),
  ])
  const customerAuthorized = customerAuthorization.ready
  const desktopGates = runtimeControl.gates.filter((gate) => gate.scope === 'desktop')
  const mobileGates = runtimeControl.gates.filter((gate) => gate.scope === 'mobile')
  const workstationGates = runtimeControl.gates.filter((gate) => gate.scope === 'workstation')
  const highRiskGates = runtimeControl.gates.filter((gate) => !gate.readOnly)
  const enabledHighRiskGates = highRiskGates.filter((gate) => gate.envEnabled)
  const desktop = buildRealControlDomainAcceptance({
    key: 'desktop',
    label: '真实桌面控制',
    toolchain: desktopProbe,
    gates: desktopGates,
    requiredProbeReady: desktopProbe.canObserveWindows && desktopProbe.canControlPhysicalDesktop,
    toolchainBlockers: desktopProbe.canObserveWindows ? [] : ['当前机器无法观察桌面窗口。'],
    extraEvidence: [
      `窗口观察=${desktopProbe.canObserveWindows ? '可用' : '不可用'}`,
      `物理桌面控制=${desktopProbe.canControlPhysicalDesktop ? '可用' : '不可用'}`,
      `${desktopProbe.windowSamples.length} 个可见窗口样本`,
    ],
    readyRequiresLive: true,
  })
  const mobileToolchainReady = mobileDiscovery.adb.available || mobileDiscovery.appium.available
  const mobile = buildRealControlDomainAcceptance({
    key: 'mobile',
    label: '真实手机控制',
    toolchain: mobileDiscovery,
    gates: mobileGates,
    requiredProbeReady: mobileToolchainReady,
    toolchainBlockers: mobileToolchainReady ? [] : ['当前机器未发现 adb 或 Appium。'],
    extraEvidence: [
      `adb=${mobileDiscovery.adb.available ? '可用' : '不可用'}`,
      `Appium=${mobileDiscovery.appium.available ? '可用' : '不可用'}`,
      `${mobileDiscovery.devices.length} 台 adb 设备`,
    ],
    readyRequiresLive: true,
  })
  const providerReady = workstationProviders.providers.some((provider) => provider.available)
  const workstationReady =
    providerReady &&
    runtimeControl.summary.readyWorkstations > 0 &&
    runtimeControl.summary.blockedWorkstations === 0
  const workstations = buildRealControlDomainAcceptance({
    key: 'workstation',
    label: 'VM/RDP 独立工作站',
    toolchain: workstationProviders,
    gates: workstationGates,
    requiredProbeReady: workstationReady,
    toolchainBlockers: [
      ...(!providerReady ? ['当前机器未发现可用的 RDP/VM/VNC 工作站提供方。'] : []),
      ...(runtimeControl.summary.readyWorkstations === 0 ? ['还没有可用的工作站预留。'] : []),
      ...(runtimeControl.summary.blockedWorkstations > 0 ? ['存在阻塞的工作站预留。'] : []),
    ],
    extraEvidence: [
      `${workstationProviders.providers.filter((provider) => provider.available).length}/${workstationProviders.providers.length} 个提供方可用`,
      `${runtimeControl.summary.readyWorkstations} 个工作站可用`,
      `${runtimeControl.summary.blockedWorkstations} 个工作站阻塞`,
    ],
    readyRequiresLive: true,
  })
  const authorizationCheck: ProductionProbeResult = {
    key: 'customer_real_control_authorization',
    label: '客户真实控制授权',
    status: customerAuthorization.status,
    evidence: customerAuthorization.evidence,
    warnings: customerAuthorization.warnings,
    nextActions: customerAuthorization.nextActions,
    checkedAt: Date.now(),
  }
  const domainChecks = [desktop, mobile, workstations].map(domainAcceptanceToProbe)
  const gateChecks = runtimeControl.gates.map((gate): ProductionProbeResult => ({
    key: `real_control_gate_${gate.key}`,
    label: gate.label,
    status: gate.status,
    evidence: gate.evidence,
    warnings: gate.warnings,
    nextActions: gate.nextActions,
    checkedAt: Date.now(),
  }))
  const checks = [
    authorizationCheck,
    desktopProbe,
    mobileDiscovery,
    workstationProviders,
    ...domainChecks,
    ...gateChecks,
  ]
  const readinessScore = scoreReadiness(checks)
  const blockers = uniqueNonEmpty([
    ...(!customerAuthorized ? authorizationCheck.warnings : []),
    ...[desktop, mobile, workstations].flatMap((domain) => domain.blockers),
    ...runtimeControl.gates
      .filter((gate) => !gate.readOnly && gate.envEnabled && gate.approvedRuntimeControlApprovals === 0)
      .map((gate) => `${gate.label} 缺少已批准的真实控制审批。`),
  ])
  const nextActions = uniqueNonEmpty([
    ...authorizationCheck.nextActions,
    ...[desktop, mobile, workstations].flatMap((domain) => domain.nextActions),
    ...runtimeControl.recommendations,
  ]).slice(0, 14)
  const report: RealControlRuntimeAcceptanceReport = {
    status: readinessStatus(readinessScore, checks),
    readinessScore,
    generatedAt: Date.now(),
    safeToUseLiveControls:
      customerAuthorized &&
      desktop.ready &&
      mobile.ready &&
      workstations.ready &&
      blockers.length === 0,
    summary: {
      desktopReady: desktop.ready,
      mobileReady: mobile.ready,
      workstationReady: workstations.ready,
      customerAuthorized,
      customerAuthorizationSwitchEnabled: customerAuthorization.switchEnabled,
      customerAuthorizationEvidenceHashPresent: customerAuthorization.evidenceHashPresent,
      customerAuthorizationEvidenceMatched: customerAuthorization.evidenceMatched,
      enabledHighRiskGates: enabledHighRiskGates.length,
      totalHighRiskGates: highRiskGates.length,
      liveExecutions: runtimeControl.gates.reduce((sum, gate) => sum + gate.liveExecutions, 0),
      blockedActions: runtimeControl.summary.blockedRuntimeControlActions,
      readyWorkstations: runtimeControl.summary.readyWorkstations,
      blockedWorkstations: runtimeControl.summary.blockedWorkstations,
    },
    desktop,
    mobile,
    workstations,
    checks,
    blockers: blockers.slice(0, 14),
    nextActions,
  }
  await recordAuditLog({
    actorType: 'system',
    action: 'production.real_control.acceptance',
    resourceType: 'production_integration',
    resourceId: 'real-control',
    riskLevel: 'low',
    message: `Real control runtime acceptance report generated with score ${readinessScore}.`,
    metadata: {
      status: report.status,
      safeToUseLiveControls: report.safeToUseLiveControls,
      desktopReady: report.summary.desktopReady,
      mobileReady: report.summary.mobileReady,
      workstationReady: report.summary.workstationReady,
      customerAuthorized,
      customerAuthorizationSwitchEnabled: customerAuthorization.switchEnabled,
      customerAuthorizationEvidenceHashPresent: customerAuthorization.evidenceHashPresent,
      customerAuthorizationEvidenceMatched: customerAuthorization.evidenceMatched,
    },
  })
  return report
}

export async function getProductionLiveConnectorReport(): Promise<ProductionLiveConnectorReport> {
  const [modelCredentials, realControl, runtimeControl, networkProfiles] = await Promise.all([
    getProductionModelCredentialReport(),
    getRealControlRuntimeAcceptanceReport(),
    getRuntimeControlReadinessReport(),
    db.query.networkProfiles.findMany(),
  ])
  const networkById = new Map(networkProfiles.map((network) => [network.id, network]))
  const modelConnectionGate = liveConnectorEnvGate('AGENTHUB_ENABLE_REAL_MODEL_CONNECTION')
  const modelInvocationGate = liveConnectorEnvGate('AGENTHUB_ENABLE_REAL_MODEL_INVOCATION')
  const modelConnectors = modelCredentials.models.map((model): ProductionLiveConnector => {
    const network = model.networkProfileId ? networkById.get(model.networkProfileId) ?? null : null
    const endpointAllowed = modelEndpointHostAllowed(model.baseUrlHost)
    const latestEvidenceAt = Math.max(
      model.latestLiveConnection?.createdAt ?? 0,
      model.latestLiveInvocation?.createdAt ?? 0,
    ) || null
    const blockers = uniqueNonEmpty([
      ...(!modelEndpointHostAllowlistConfigured()
        ? [`${MODEL_ENDPOINT_HOST_ALLOWLIST_ENV} 尚未配置模型接口主机白名单。`]
        : []),
      ...(modelEndpointHostAllowlistConfigured() && !endpointAllowed
        ? [`模型接口主机 ${model.baseUrlHost} 不在 ${MODEL_ENDPOINT_HOST_ALLOWLIST_ENV} 白名单中。`]
        : []),
      ...(model.credential.refKind !== 'secret_vault'
        ? ['生产环境建议把模型密钥迁入密钥库，不要依赖明文或未解析引用。']
        : []),
      ...(!credentialItemHasUsableSecret(model) ? ['模型凭证当前不可解析。'] : []),
      ...(model.credential.connectScope === 'missing' ? ['缺少 model.connect 凭证作用域。'] : []),
      ...(model.credential.invokeScope === 'missing' ? ['缺少 model.invoke 凭证作用域。'] : []),
      ...(model.latestLiveConnection?.status !== 'ok' ? ['还没有成功的真实连接测试。'] : []),
      ...(model.latestLiveInvocation?.status !== 'ok' ? ['还没有成功的真实推理测试。'] : []),
    ])
    const status: ProductionIntegrationStatus =
      blockers.length === 0
        ? 'ready'
        : model.status === 'blocked'
          ? 'blocked'
          : model.status === 'ready' || model.status === 'available'
            ? 'available'
            : model.status
    return {
      id: `model:${model.modelProfileId}`,
      kind: 'model',
      label: model.name,
      status,
      ready: status === 'ready',
      ownerId: model.modelProfileId,
      routeLabel: network
        ? `${network.name} · ${network.mode}${network.regionLabel ? ` · ${network.regionLabel}` : ''}`
        : '未绑定专属网络出口',
      verification: {
        dryRunAvailable: credentialItemHasUsableSecret(model),
        liveEvidenceCount: [model.latestLiveConnection, model.latestLiveInvocation].filter(
          (evidence) => evidence?.status === 'ok' && evidence.mode === 'live',
        ).length,
        lastLiveEvidenceAt: latestEvidenceAt,
      },
      envGates: [modelConnectionGate, modelInvocationGate],
      evidence: uniqueNonEmpty([
        `${MODEL_ENDPOINT_HOST_ALLOWLIST_ENV}=${endpointAllowed ? '已允许' : '已阻塞'}`,
        `${model.provider} · ${model.model}`,
        `凭证=${model.credential.refPreview}`,
        `网络出口=${network?.name ?? '未绑定'}`,
        `连接测试=${model.latestLiveConnection?.status ?? 'missing'}`,
        `真实推理=${model.latestLiveInvocation?.status ?? 'missing'}`,
      ]),
      warnings: model.warnings,
      blockers,
      nextActions: uniqueNonEmpty([
        ...model.nextActions,
        ...blockers.map((blocker) => `处理：${blocker}`),
        ...(!network ? ['按客户或模型供应商要求绑定 Network Profile。'] : []),
      ]).slice(0, 8),
    }
  })
  const desktopConnector = domainToLiveConnector({
    id: 'desktop:physical',
    kind: 'desktop',
    domain: realControl.desktop,
    ownerId: null,
    routeLabel: '本机 Windows 桌面',
    envVars: ['AGENTHUB_ENABLE_REAL_DESKTOP_CONTROL', 'AGENTHUB_ENABLE_REAL_DESKTOP_CAPTURE'],
    dryRunAvailable: true,
  })
  const mobileConnector = domainToLiveConnector({
    id: 'mobile:adb-appium',
    kind: 'mobile',
    domain: realControl.mobile,
    ownerId: null,
    routeLabel: 'ADB / Appium',
    envVars: ['AGENTHUB_ENABLE_REAL_MOBILE_CONTROL', 'AGENTHUB_ENABLE_REAL_MOBILE_CAPTURE'],
    dryRunAvailable: true,
  })
  const workstationConnector = domainToLiveConnector({
    id: 'workstation:vm-rdp',
    kind: 'workstation',
    domain: realControl.workstations,
    ownerId: null,
    routeLabel: `${runtimeControl.summary.readyWorkstations} 个可用 / ${runtimeControl.summary.blockedWorkstations} 个阻塞`,
    envVars: ['AGENTHUB_ENABLE_REAL_WORKSTATION_LAUNCH'],
    dryRunAvailable: runtimeControl.workstationChecks.length > 0,
  })
  const customerAuthorized = realControl.summary.customerAuthorized
  const authorizationCheck = realControl.checks.find((check) => check.key === 'customer_real_control_authorization')
  const authorizationConnector: ProductionLiveConnector = {
    id: 'customer:authorization',
    kind: 'customer_authorization',
    label: '客户现场授权',
    status: authorizationCheck?.status ?? (customerAuthorized ? 'ready' : 'not_configured'),
    ready: customerAuthorized,
    ownerId: null,
    routeLabel: realControl.summary.customerAuthorizationEvidenceMatched
      ? '客户授权证据已绑定'
      : '客户环境保护门',
    verification: {
      dryRunAvailable: true,
      liveEvidenceCount: customerAuthorized ? 1 : 0,
      lastLiveEvidenceAt: null,
    },
    envGates: [
      liveConnectorEnvGate(CUSTOMER_AUTHORIZATION_ENV),
      liveConnectorValueEnvGate(
        CUSTOMER_AUTHORIZATION_EVIDENCE_HASH_ENV,
        '客户授权证据哈希',
        realControl.summary.customerAuthorizationEvidenceMatched,
      ),
    ],
    evidence: authorizationCheck?.evidence ?? [],
    warnings: authorizationCheck?.warnings ?? [],
    blockers: customerAuthorized ? [] : authorizationCheck?.warnings ?? ['客户现场授权未确认。'],
    nextActions: customerAuthorized
      ? []
      : authorizationCheck?.nextActions ?? [
          `客户明确授权、测试账号和测试设备准备好后，再设置 ${CUSTOMER_AUTHORIZATION_ENV}=1。`,
        ],
  }
  const connectors = [
    ...modelConnectors,
    desktopConnector,
    mobileConnector,
    workstationConnector,
    authorizationConnector,
  ]
  const checks = connectors.map(liveConnectorToProbe)
  const readinessScore = scoreReadiness(checks)
  const blockers = uniqueNonEmpty(connectors.flatMap((connector) => connector.blockers)).slice(0, 16)
  const nextActions = uniqueNonEmpty(connectors.flatMap((connector) => connector.nextActions)).slice(0, 16)
  const safeToActivateLive =
    customerAuthorized &&
    connectors.length > 0 &&
    connectors.every((connector) => connector.ready)
  const report: ProductionLiveConnectorReport = {
    status: safeToActivateLive ? 'ready' : readinessStatus(readinessScore, checks),
    readinessScore,
    generatedAt: Date.now(),
    safeToActivateLive,
    connectors,
    summary: {
      total: connectors.length,
      ready: connectors.filter((connector) => connector.ready).length,
      available: connectors.filter((connector) => connector.status === 'available').length,
      blocked: connectors.filter(
        (connector) => connector.status === 'blocked' || connector.status === 'not_installed',
      ).length,
      models: modelConnectors.length,
      modelReady: modelConnectors.filter((connector) => connector.ready).length,
      desktopReady: desktopConnector.ready,
      mobileReady: mobileConnector.ready,
      workstationReady: workstationConnector.ready,
      customerAuthorized,
      customerAuthorizationSwitchEnabled: realControl.summary.customerAuthorizationSwitchEnabled,
      customerAuthorizationEvidenceHashPresent: realControl.summary.customerAuthorizationEvidenceHashPresent,
      customerAuthorizationEvidenceMatched: realControl.summary.customerAuthorizationEvidenceMatched,
    },
    checks,
    blockers,
    nextActions,
  }
  await recordAuditLog({
    actorType: 'system',
    action: 'production.live_connectors.report',
    resourceType: 'production_integration',
    resourceId: 'live-connectors',
    riskLevel: 'low',
    message: `Production live connector report generated with score ${readinessScore}.`,
    metadata: {
      status: report.status,
      safeToActivateLive,
      connectors: connectors.length,
      ready: report.summary.ready,
      blockers: blockers.length,
    },
  })
  return report
}

export async function getProductionExecutionPreflightReport(): Promise<ProductionExecutionPreflightReport> {
  const [modelCredentials, runtimeControl, realControl, liveConnectors] = await Promise.all([
    getProductionModelCredentialReport(),
    getRuntimeControlReadinessReport(),
    getRealControlRuntimeAcceptanceReport(),
    getProductionLiveConnectorReport(),
  ])
  const gateByKey = new Map(runtimeControl.gates.map((gate) => [gate.key, gate]))
  const customerAuthorized = realControl.summary.customerAuthorized
  const approvedGoLiveHash = process.env.AGENTHUB_APPROVED_GO_LIVE_DECISION_HASH?.trim() || null
  const readyConnectionModels = modelCredentials.models.filter(
    (model) =>
      model.credential.refKind === 'secret_vault' &&
      credentialItemHasUsableSecret(model) &&
      model.credential.connectScope === 'allowed',
  )
  const readyModels = modelCredentials.models.filter(
    (model) =>
      model.credential.refKind === 'secret_vault' &&
      credentialItemHasUsableSecret(model) &&
      model.credential.invokeScope === 'allowed',
  )
  const modelConnectors = liveConnectors.connectors.filter((connector) => connector.kind === 'model')
  const desktopObservation = gateByKey.get('desktop_observation')
  const desktopControl = gateByKey.get('desktop_control')
  const desktopCapture = gateByKey.get('desktop_capture')
  const mobileObservation = gateByKey.get('mobile_observation')
  const mobileControl = gateByKey.get('mobile_control')
  const mobileCapture = gateByKey.get('mobile_capture')
  const workstationValidation = gateByKey.get('workstation_validation')
  const workstationLaunch = gateByKey.get('workstation_launch')
  const customerEnvGate = preflightEnvGate(
    CUSTOMER_AUTHORIZATION_ENV,
    '客户明确授权后，真实桌面、手机、工作站和外部模型调用才允许进入现场环境。',
  )
  const customerAuthorizationEvidenceHashGate = preflightEnvGate(
    CUSTOMER_AUTHORIZATION_EVIDENCE_HASH_ENV,
    '真实动作必须绑定到一条已写入、已脱敏的客户现场授权证据 hash。',
    realControl.summary.customerAuthorizationEvidenceMatched,
  )
  const approvedHashGate = preflightEnvGate(
    'AGENTHUB_APPROVED_GO_LIVE_DECISION_HASH',
    '最终验收生成 approved 哈希后，高风险真实动作必须匹配这个上线哈希。',
    Boolean(approvedGoLiveHash),
  )
  const modelInvocationEnvGate = preflightEnvGate(
    'AGENTHUB_ENABLE_REAL_MODEL_INVOCATION',
    '允许模型网关发起真实外部模型推理请求。',
  )

  const modelConnectionEnvGate = preflightEnvGate(
    'AGENTHUB_ENABLE_REAL_MODEL_CONNECTION',
    '允许模型网关发起带凭据的真实连接测试请求。',
  )

  const emergencyStop = preflightEmergencyStop()
  const modelEndpointHostGuard = preflightRuntimeGuard(
    'model_endpoint_host_allowlist',
    MODEL_ENDPOINT_HOST_ALLOWLIST_ENV,
    '只有客户批准的模型供应商主机可以接收带凭证的真实模型流量。',
    '示例：api.openai.com; api.anthropic.com; generativelanguage.googleapis.com',
  )
  const desktopTargetGuard = preflightRuntimeGuard(
    'desktop_target_allowlist',
    'AGENTHUB_ALLOWED_DESKTOP_TARGETS',
    '只有客户批准的桌面窗口或进程名称可以接收真实桌面控制动作。',
    '示例：Chrome; Photoshop; target-window-title',
  )
  const mobileDeviceGuard = preflightRuntimeGuard(
    'mobile_device_allowlist',
    'AGENTHUB_ALLOWED_MOBILE_DEVICE_IDS',
    '只有客户批准的 Android/Appium 设备 ID 可以接收真实手机动作。',
    '示例：emulator-5554; R58N123ABC',
  )
  const mobileAppGuard = preflightRuntimeGuard(
    'mobile_app_package_allowlist',
    'AGENTHUB_ALLOWED_MOBILE_APP_PACKAGES',
    '只有客户批准的 Android 应用包名可以接收真实点按、输入、滑动或按键动作。',
    '示例：com.customer.app; com.android.chrome',
  )
  const workstationTargetGuard = preflightRuntimeGuard(
    'workstation_target_allowlist',
    'AGENTHUB_ALLOWED_WORKSTATION_TARGETS',
    '只有客户批准的 VM/RDP/VNC 工作站 ID 或远程目标可以被真实启动。',
    '示例：aws_123; customer-rdp-host; AgentVM',
  )

  const actions: ProductionExecutionPreflightAction[] = [
    preflightAction({
      id: 'model_connection',
      domain: 'model',
      label: '真实模型连接测试',
      actionType: 'model.connect.live',
      riskLevel: 'medium',
      dryRunAvailable: modelCredentials.models.length > 0,
      readOnly: false,
      requiresApproval: false,
      requiresGoLiveHash: false,
      requiredEnvVars: [modelConnectionEnvGate],
      requiredRuntimeGuards: [modelEndpointHostGuard],
      evidence: [
        `${readyConnectionModels.length}/${modelCredentials.models.length} 个模型具备 Secret Vault + model.connect`,
        `${modelConnectors.filter((connector) => connector.ready).length}/${modelConnectors.length} 个模型连接器已就绪`,
        `AGENTHUB_ENABLE_REAL_MODEL_CONNECTION=${modelConnectionEnvGate.enabled ? '1' : 'off'}`,
        `${MODEL_ENDPOINT_HOST_ALLOWLIST_ENV}=${modelEndpointHostGuard.configured ? 'configured' : 'missing'}`,
      ],
      blockers: [
        ...(modelCredentials.models.length === 0 ? ['还没有可用于真实连接测试的模型配置。'] : []),
        ...(readyConnectionModels.length === 0 ? ['还没有模型同时满足 Secret Vault 凭证和 model.connect 授权作用域。'] : []),
        ...(!modelConnectionEnvGate.enabled ? ['真实模型连接测试开关尚未开启。'] : []),
      ],
      nextActions: uniqueNonEmpty([
        ...modelCredentials.nextActions,
        '打开 AGENTHUB_ENABLE_REAL_MODEL_CONNECTION=1 后再运行连接测试。',
      ]),
    }),
    preflightAction({
      id: 'model_invocation',
      domain: 'model',
      label: '真实模型推理',
      actionType: 'model.invoke.live',
      riskLevel: 'high',
      dryRunAvailable: modelCredentials.models.length > 0,
      readOnly: false,
      requiresApproval: false,
      requiresGoLiveHash: true,
      requiredEnvVars: [
        modelInvocationEnvGate,
        customerEnvGate,
        customerAuthorizationEvidenceHashGate,
        approvedHashGate,
      ],
      requiredRuntimeGuards: [modelEndpointHostGuard],
      evidence: [
        `${readyModels.length}/${modelCredentials.models.length} 个模型具备 Secret Vault + model.invoke`,
        `${modelConnectors.filter((connector) => connector.ready).length}/${modelConnectors.length} 个模型连接器已就绪`,
        `AGENTHUB_ENABLE_REAL_MODEL_INVOCATION=${modelInvocationEnvGate.enabled ? '1' : 'off'}`,
        `${MODEL_ENDPOINT_HOST_ALLOWLIST_ENV}=${modelEndpointHostGuard.configured ? 'configured' : 'missing'}`,
      ],
      blockers: [
        ...(modelCredentials.models.length === 0 ? ['还没有可用于真实推理的模型配置。'] : []),
        ...(readyModels.length === 0 ? ['还没有模型同时满足 Secret Vault 凭证和 model.invoke 授权。'] : []),
        ...(!modelInvocationEnvGate.enabled ? ['真实模型推理开关尚未开启。'] : []),
        ...commonLivePreflightBlockers(customerAuthorized, Boolean(approvedGoLiveHash)),
        ...modelConnectors.flatMap((connector) => connector.blockers).slice(0, 4),
      ],
      nextActions: uniqueNonEmpty([
        ...modelCredentials.nextActions,
        ...liveConnectors.nextActions.filter((action) => action.includes('模型') || action.includes('model')),
        '在客户授权和上线哈希满足后，再打开 AGENTHUB_ENABLE_REAL_MODEL_INVOCATION=1。',
      ]),
    }),
    preflightAction({
      id: 'desktop_observation',
      domain: 'desktop',
      label: '桌面窗口观察',
      actionType: 'runtime_control.desktop.observe_windows',
      riskLevel: 'low',
      dryRunAvailable: true,
      readOnly: true,
      requiresApproval: false,
      requiresGoLiveHash: false,
      requiredEnvVars: [],
      evidence: [
        `桌面工具链=${realControl.desktop.toolchainStatus}`,
        `${desktopObservation?.completedActions ?? 0} 次观察动作已完成`,
      ],
      blockers:
        realControl.desktop.toolchainStatus === 'not_installed'
          ? ['当前机器还不能观察桌面窗口。']
          : [],
      nextActions: desktopObservation?.nextActions ?? [],
    }),
    preflightAction({
      id: 'desktop_control',
      domain: 'desktop',
      label: '桌面点击/输入',
      actionType: 'runtime_control.desktop.click_type_key',
      riskLevel: 'high',
      dryRunAvailable: realControl.desktop.toolchainStatus !== 'not_installed',
      readOnly: false,
      requiresApproval: true,
      requiresGoLiveHash: true,
      requiredEnvVars: [
        preflightEnvGate('AGENTHUB_ENABLE_REAL_DESKTOP_CONTROL', '允许物理桌面点击、输入、按键和窗口聚焦。'),
        customerEnvGate,
        customerAuthorizationEvidenceHashGate,
        approvedHashGate,
      ],
      requiredRuntimeGuards: [desktopTargetGuard],
      emergencyStop,
      evidence: [
        `桌面工具链=${realControl.desktop.toolchainStatus}`,
        `${desktopControl?.approvedRuntimeControlApprovals ?? 0} 条真实控制审批已批准`,
        `${desktopControl?.liveExecutions ?? 0} 次真实桌面控制执行证据`,
      ],
      blockers: [
        ...(realControl.desktop.toolchainStatus === 'not_installed' ? ['当前机器还不能执行桌面控制。'] : []),
        ...gatePreflightBlockers(desktopControl),
        ...commonLivePreflightBlockers(customerAuthorized, Boolean(approvedGoLiveHash)),
      ],
      nextActions: uniqueNonEmpty([...(desktopControl?.nextActions ?? []), ...realControl.desktop.nextActions]),
    }),
    preflightAction({
      id: 'desktop_capture',
      domain: 'desktop',
      label: '桌面截图',
      actionType: 'runtime_control.desktop.capture_screenshot',
      riskLevel: 'high',
      dryRunAvailable: realControl.desktop.toolchainStatus !== 'not_installed',
      readOnly: false,
      requiresApproval: true,
      requiresGoLiveHash: true,
      requiredEnvVars: [
        preflightEnvGate('AGENTHUB_ENABLE_REAL_DESKTOP_CAPTURE', '允许真实桌面截图采集。'),
        customerEnvGate,
        customerAuthorizationEvidenceHashGate,
        approvedHashGate,
      ],
      requiredRuntimeGuards: [desktopTargetGuard],
      emergencyStop,
      evidence: [
        `桌面工具链=${realControl.desktop.toolchainStatus}`,
        `${desktopCapture?.approvedRuntimeControlApprovals ?? 0} 条真实截图审批已批准`,
        `${desktopCapture?.liveExecutions ?? 0} 次真实桌面截图证据`,
      ],
      blockers: [
        ...(realControl.desktop.toolchainStatus === 'not_installed' ? ['当前机器还不能执行桌面截图。'] : []),
        ...gatePreflightBlockers(desktopCapture),
        ...commonLivePreflightBlockers(customerAuthorized, Boolean(approvedGoLiveHash)),
      ],
      nextActions: uniqueNonEmpty([...(desktopCapture?.nextActions ?? []), ...realControl.desktop.nextActions]),
    }),
    preflightAction({
      id: 'mobile_discovery',
      domain: 'mobile',
      label: '手机设备发现',
      actionType: 'runtime_control.mobile.list_devices',
      riskLevel: 'low',
      dryRunAvailable: true,
      readOnly: true,
      requiresApproval: false,
      requiresGoLiveHash: false,
      requiredEnvVars: [],
      evidence: [
        `手机工具链=${realControl.mobile.toolchainStatus}`,
        `${mobileObservation?.completedActions ?? 0} 次手机发现动作已完成`,
      ],
      blockers:
        realControl.mobile.toolchainStatus === 'not_installed'
          ? ['当前机器还没有 adb 或 Appium。']
          : [],
      nextActions: mobileObservation?.nextActions ?? realControl.mobile.nextActions,
    }),
    preflightAction({
      id: 'mobile_control',
      domain: 'mobile',
      label: '手机点击/输入',
      actionType: 'runtime_control.mobile.tap_text_keyevent',
      riskLevel: 'high',
      dryRunAvailable: realControl.mobile.toolchainStatus !== 'not_installed',
      readOnly: false,
      requiresApproval: true,
      requiresGoLiveHash: true,
      requiredEnvVars: [
        preflightEnvGate('AGENTHUB_ENABLE_REAL_MOBILE_CONTROL', '允许手机点击、输入和按键动作。'),
        customerEnvGate,
        customerAuthorizationEvidenceHashGate,
        approvedHashGate,
      ],
      requiredRuntimeGuards: [mobileDeviceGuard, mobileAppGuard],
      emergencyStop,
      evidence: [
        `手机工具链=${realControl.mobile.toolchainStatus}`,
        `${mobileControl?.approvedRuntimeControlApprovals ?? 0} 条手机控制审批已批准`,
        `${mobileControl?.liveExecutions ?? 0} 次真实手机控制证据`,
      ],
      blockers: [
        ...(realControl.mobile.toolchainStatus === 'not_installed' ? ['当前机器还不能控制手机。'] : []),
        ...gatePreflightBlockers(mobileControl),
        ...commonLivePreflightBlockers(customerAuthorized, Boolean(approvedGoLiveHash)),
      ],
      nextActions: uniqueNonEmpty([...(mobileControl?.nextActions ?? []), ...realControl.mobile.nextActions]),
    }),
    preflightAction({
      id: 'mobile_capture',
      domain: 'mobile',
      label: '手机截图',
      actionType: 'runtime_control.mobile.mobile_screenshot',
      riskLevel: 'high',
      dryRunAvailable: realControl.mobile.toolchainStatus !== 'not_installed',
      readOnly: false,
      requiresApproval: true,
      requiresGoLiveHash: true,
      requiredEnvVars: [
        preflightEnvGate('AGENTHUB_ENABLE_REAL_MOBILE_CAPTURE', '允许采集测试手机屏幕截图。'),
        customerEnvGate,
        customerAuthorizationEvidenceHashGate,
        approvedHashGate,
      ],
      requiredRuntimeGuards: [mobileDeviceGuard],
      emergencyStop,
      evidence: [
        `手机工具链=${realControl.mobile.toolchainStatus}`,
        `${mobileCapture?.approvedRuntimeControlApprovals ?? 0} 条手机截图审批已批准`,
        `${mobileCapture?.liveExecutions ?? 0} 次真实手机截图证据`,
      ],
      blockers: [
        ...(realControl.mobile.toolchainStatus === 'not_installed' ? ['当前机器还不能采集手机截图。'] : []),
        ...gatePreflightBlockers(mobileCapture),
        ...commonLivePreflightBlockers(customerAuthorized, Boolean(approvedGoLiveHash)),
      ],
      nextActions: uniqueNonEmpty([...(mobileCapture?.nextActions ?? []), ...realControl.mobile.nextActions]),
    }),
    preflightAction({
      id: 'workstation_validation',
      domain: 'workstation',
      label: '工作站校验',
      actionType: 'runtime_control.workstation.validate_workstation',
      riskLevel: 'low',
      dryRunAvailable: runtimeControl.workstationChecks.length > 0,
      readOnly: true,
      requiresApproval: false,
      requiresGoLiveHash: false,
      requiredEnvVars: [],
      evidence: [
        `${runtimeControl.summary.readyWorkstations} 个工作站可用`,
        `${runtimeControl.summary.blockedWorkstations} 个工作站阻塞`,
        `${workstationValidation?.completedActions ?? 0} 次工作站校验完成`,
      ],
      blockers:
        runtimeControl.workstationChecks.length === 0
          ? ['还没有给 Agent 预留 VM/RDP/VNC 工作站。']
          : [],
      nextActions: workstationValidation?.nextActions ?? realControl.workstations.nextActions,
    }),
    preflightAction({
      id: 'workstation_launch',
      domain: 'workstation',
      label: '远程工作站启动',
      actionType: 'runtime_control.workstation.launch_remote_session',
      riskLevel: 'high',
      dryRunAvailable: runtimeControl.workstationChecks.length > 0,
      readOnly: false,
      requiresApproval: true,
      requiresGoLiveHash: true,
      requiredEnvVars: [
        preflightEnvGate('AGENTHUB_ENABLE_REAL_WORKSTATION_LAUNCH', '允许启动 RDP/VNC/VM 远程工作站会话。'),
        customerEnvGate,
        customerAuthorizationEvidenceHashGate,
        approvedHashGate,
      ],
      requiredRuntimeGuards: [workstationTargetGuard],
      emergencyStop,
      evidence: [
        `${runtimeControl.summary.readyWorkstations} 个工作站可用`,
        `${runtimeControl.summary.blockedWorkstations} 个工作站阻塞`,
        `${workstationLaunch?.approvedRuntimeControlApprovals ?? 0} 条工作站启动审批已批准`,
        `${workstationLaunch?.liveExecutions ?? 0} 次远程工作站真实启动证据`,
      ],
      blockers: [
        ...(runtimeControl.summary.readyWorkstations === 0 ? ['没有可启动的工作站。'] : []),
        ...(runtimeControl.summary.blockedWorkstations > 0 ? ['存在阻塞的工作站，需要先修复。'] : []),
        ...gatePreflightBlockers(workstationLaunch),
        ...commonLivePreflightBlockers(customerAuthorized, Boolean(approvedGoLiveHash)),
      ],
      nextActions: uniqueNonEmpty([...(workstationLaunch?.nextActions ?? []), ...realControl.workstations.nextActions]),
    }),
  ]
  const checks = actions.map((action): ProductionProbeResult => ({
    key: `execution_preflight_${action.id}`,
    label: action.label,
    status: action.status,
    evidence: action.evidence,
    warnings: action.blockers,
    nextActions: action.nextActions,
    checkedAt: Date.now(),
  }))
  const readinessScore = scoreReadiness(checks)
  const requiredEnvGates = actions.flatMap((action) => action.requiredEnvVars)
  const taskExecutionActions = actions.filter((action) => action.actionType !== 'model.connect.live')
  const report: ProductionExecutionPreflightReport = {
    status: readinessStatus(readinessScore, checks),
    readinessScore,
    generatedAt: Date.now(),
    safeToExecuteAnyLiveAction: taskExecutionActions.some((action) => action.canExecuteNow && !action.readOnly),
    canExecuteReadOnly: actions.some((action) => action.canExecuteNow && action.readOnly),
    summary: {
      totalActions: actions.length,
      executableNow: actions.filter((action) => action.canExecuteNow).length,
      blocked: actions.filter((action) => !action.canExecuteNow).length,
      readOnly: actions.filter((action) => action.readOnly).length,
      highRisk: actions.filter((action) => action.riskLevel === 'high').length,
      enabledEnvGates: requiredEnvGates.filter((gate) => gate.enabled).length,
      requiredEnvGates: requiredEnvGates.length,
      readyModels: readyModels.length,
      readyWorkstations: runtimeControl.summary.readyWorkstations,
    },
    actions,
    blockers: uniqueNonEmpty(actions.flatMap((action) => action.blockers)).slice(0, 18),
    nextActions: uniqueNonEmpty(actions.flatMap((action) => action.nextActions)).slice(0, 18),
    safetyNotice:
      '执行前检查只读汇总当前状态，不会点击、输入、截图、启动远程桌面、操作手机或调用外部模型。高风险动作仍必须经过客户授权、环境开关、审批和上线哈希。',
  }
  await recordAuditLog({
    actorType: 'system',
    action: 'production.execution_preflight.report',
    resourceType: 'production_integration',
    resourceId: 'execution-preflight',
    riskLevel: 'low',
    message: `Production execution preflight report generated with score ${readinessScore}.`,
    metadata: {
      status: report.status,
      safeToExecuteAnyLiveAction: report.safeToExecuteAnyLiveAction,
      canExecuteReadOnly: report.canExecuteReadOnly,
      executableNow: report.summary.executableNow,
      blocked: report.summary.blocked,
    },
  })
  return report
}

export async function getProductionGoLiveDrillReport(): Promise<ProductionGoLiveDrillReport> {
  const [preflight, realControl, customerEnvironment, finalAcceptance, goLiveGate] = await Promise.all([
    getProductionExecutionPreflightReport(),
    getRealControlRuntimeAcceptanceReport(),
    getProductionCustomerEnvironmentReport(),
    getProductionFinalAcceptanceLedger(),
    evaluateProductionGoLiveRuntimeGate(),
  ])
  const actionById = new Map(preflight.actions.map((action) => [action.id, action]))
  const scenarioFromAction = (
    id: string,
    title: string,
    target: string,
    fallbackDomain: ProductionGoLiveDrillDomain,
  ): ProductionGoLiveDrillScenario => {
    const action = actionById.get(id)
    return productionGoLiveDrillScenario({
      id,
      domain: action?.domain ?? fallbackDomain,
      title,
      target,
      riskLevel: action?.riskLevel ?? 'high',
      readOnly: action?.readOnly ?? false,
      canPassNow: action?.canExecuteNow === true,
      evidence: action?.evidence ?? [],
      blockers: action?.blockers ?? ['上线前演练没有找到对应的执行前检查动作。'],
      nextActions: action?.nextActions ?? [],
    })
  }
  const scenarios: ProductionGoLiveDrillScenario[] = [
    scenarioFromAction('model_connection', '模型连接演练', '外部模型供应商连接测试', 'model'),
    scenarioFromAction('model_invocation', '模型推理演练', '真实外部模型推理请求', 'model'),
    scenarioFromAction('desktop_observation', '桌面观察演练', '只读读取 Windows 窗口列表', 'desktop'),
    scenarioFromAction('desktop_control', '桌面操作演练', '真实点击、输入、聚焦窗口', 'desktop'),
    scenarioFromAction('mobile_discovery', '手机发现演练', '只读发现 Android/Appium 设备', 'mobile'),
    scenarioFromAction('mobile_control', '手机操作演练', '真实手机点击、输入、按键', 'mobile'),
    scenarioFromAction('workstation_validation', '工作站校验演练', '只读校验 VM/RDP/VNC 工位', 'workstation'),
    scenarioFromAction('workstation_launch', '远程工作站启动演练', '真实启动 VM/RDP/VNC 会话', 'workstation'),
    productionGoLiveDrillScenario({
      id: 'customer_authorization',
      domain: 'customer',
      title: '客户授权演练',
      target: '客户测试账号、测试设备、允许范围和停止条件',
      riskLevel: 'high',
      readOnly: true,
      canPassNow: customerEnvironment.customerAuthorization.evidenceMatched,
      evidence: [
        `${CUSTOMER_AUTHORIZATION_ENV}=${customerEnvironment.customerAuthorization.switchEnabled ? '1' : 'off'}`,
        `${CUSTOMER_AUTHORIZATION_EVIDENCE_HASH_ENV}=${
          customerEnvironment.customerAuthorization.evidenceMatched ? 'matched' : 'missing_or_unmatched'
        }`,
        ...customerEnvironment.checks
          .filter((check) => check.key === 'customer_authorization')
          .flatMap((check) => check.evidence),
      ],
      blockers: customerEnvironment.customerAuthorization.evidenceMatched
        ? []
        : customerEnvironment.checks
            .filter((check) => check.key === 'customer_authorization')
            .flatMap((check) => check.warnings),
      nextActions: customerEnvironment.checks
        .filter((check) => check.key === 'customer_authorization')
        .flatMap((check) => check.nextActions),
    }),
    productionGoLiveDrillScenario({
      id: 'approved_go_live_gate',
      domain: 'go_live',
      title: '上线闸门演练',
      target: '批准上线 hash、客户授权证据 hash、当前环境指纹',
      riskLevel: 'high',
      readOnly: true,
      canPassNow: goLiveGate.allowed,
      evidence: [
        `approvedHash=${goLiveGate.latestDecisionApproved ? 'approved' : 'missing_or_blocked'}`,
        `customerEvidence=${goLiveGate.customerAuthorizationEvidenceMatched ? 'matched' : 'missing_or_unmatched'}`,
        `environmentFingerprint=${
          goLiveGate.latestDecisionEnvironmentFingerprintMatched ? 'matched' : 'missing_or_changed'
        }`,
        `finalAcceptance=${finalAcceptance.canClaimProductionReady ? 'passed' : 'not_passed'}`,
      ],
      blockers: goLiveGate.allowed ? [] : [goLiveGate.reason],
      nextActions: goLiveGate.allowed
        ? []
        : uniqueNonEmpty([
            ...finalAcceptance.nextActions,
            '生成 approved 上线判定后，把 AGENTHUB_APPROVED_GO_LIVE_DECISION_HASH 设置为该判定 hash。',
            `确认 ${CUSTOMER_AUTHORIZATION_EVIDENCE_HASH_ENV} 与 approved 上线判定绑定的客户授权证据 hash 一致。`,
          ]),
    }),
  ]
  const checks: ProductionProbeResult[] = scenarios.map((scenario) => ({
    key: `go_live_drill_${scenario.id}`,
    label: scenario.title,
    status: scenario.status,
    evidence: scenario.evidence,
    warnings: scenario.blockers,
    nextActions: scenario.nextActions,
    checkedAt: Date.now(),
  }))
  const readinessScore = scoreReadiness(checks)
  const blockedScenarios = scenarios.filter((scenario) => !scenario.canPassNow)
  const highRiskScenarios = scenarios.filter((scenario) => scenario.riskLevel === 'high')
  const safeToStartLivePilot =
    goLiveGate.allowed &&
    realControl.safeToUseLiveControls &&
    customerEnvironment.safeToRunLive &&
    finalAcceptance.canClaimProductionReady &&
    highRiskScenarios.every((scenario) => scenario.canPassNow)
  const report: ProductionGoLiveDrillReport = {
    status: safeToStartLivePilot ? 'ready' : readinessStatus(readinessScore, checks),
    readinessScore,
    generatedAt: Date.now(),
    safeToStartLivePilot,
    willTouchExternalSystems: false,
    summary: {
      totalScenarios: scenarios.length,
      passedScenarios: scenarios.filter((scenario) => scenario.canPassNow).length,
      blockedScenarios: blockedScenarios.length,
      readOnlyScenarios: scenarios.filter((scenario) => scenario.readOnly).length,
      highRiskScenarios: highRiskScenarios.length,
      goLiveGateAllowed: goLiveGate.allowed,
      customerAuthorized: realControl.summary.customerAuthorized,
      environmentFingerprintMatched: goLiveGate.latestDecisionEnvironmentFingerprintMatched,
    },
    scenarios,
    blockers: uniqueNonEmpty(blockedScenarios.flatMap((scenario) => scenario.blockers)).slice(0, 18),
    nextActions: uniqueNonEmpty(blockedScenarios.flatMap((scenario) => scenario.nextActions)).slice(0, 18),
    safetyNotice:
      '上线前演练只读取当前配置、审计证据、环境闸门和 allowlist 指纹，不会调用外部模型、点击桌面、操作手机、启动 RDP/VNC/VM 或写入客户数据。',
  }
  await recordAuditLog({
    actorType: 'system',
    action: 'production.go_live.drill',
    resourceType: 'production_integration',
    resourceId: 'go-live-drill',
    riskLevel: 'low',
    message: `Production go-live drill generated with score ${readinessScore}.`,
    metadata: {
      status: report.status,
      safeToStartLivePilot,
      passedScenarios: report.summary.passedScenarios,
      blockedScenarios: report.summary.blockedScenarios,
      goLiveGateAllowed: report.summary.goLiveGateAllowed,
      environmentFingerprintMatched: report.summary.environmentFingerprintMatched,
    },
  })
  return report
}

export async function getProductionOnsiteIntakeChecklist(): Promise<ProductionOnsiteIntakeChecklist> {
  const [
    modelCredentials,
    liveConnectors,
    runtimeControl,
    customerEnvironment,
    onsiteActivation,
    finalAcceptance,
  ] = await Promise.all([
    getProductionModelCredentialReport(),
    getProductionLiveConnectorReport(),
    getRuntimeControlReadinessReport(),
    getProductionCustomerEnvironmentReport(),
    getProductionOnsiteActivationGuide(),
    getProductionFinalAcceptanceLedger(),
  ])
  const connectorByKind = new Map(liveConnectors.connectors.map((connector) => [connector.kind, connector]))
  const gateByKey = new Map(runtimeControl.gates.map((gate) => [gate.key, gate]))
  const approvedGoLiveHash = process.env.AGENTHUB_APPROVED_GO_LIVE_DECISION_HASH?.trim() || null
  const items: ProductionOnsiteIntakeItem[] = []

  if (modelCredentials.models.length === 0) {
    items.push(
      buildOnsiteIntakeItem({
        id: 'model:none',
        domain: 'model_credentials',
        title: '添加真实模型配置',
        ownerId: null,
        riskLevel: 'medium',
        fields: [
          onsiteIntakeField({
            key: 'model_profile',
            label: '模型配置',
            kind: 'secret_ref',
            ready: false,
            valuePreview: null,
            instructions: ['先在模型管理里添加 OpenAI、Claude、DeepSeek、Google 或自定义兼容模型。'],
          }),
          onsiteIntakeField({
            key: 'secret_vault',
            label: '密钥库引用',
            kind: 'secret_ref',
            ready: false,
            redacted: true,
            valuePreview: null,
            instructions: ['真实 API Key 只放入密钥库或环境变量，不要写入模型配置明文字段。'],
          }),
        ],
        evidence: modelCredentials.nextActions,
        blockers: ['还没有可用于现场验收的模型配置。'],
        nextActions: modelCredentials.nextActions,
        validationCommands: onsiteActivation.validationCommands.slice(0, 1),
      }),
    )
  } else {
    for (const model of modelCredentials.models.slice(0, 12)) {
      const secretReady = credentialItemHasUsableSecret(model) && model.credential.refKind === 'secret_vault'
      const connectReady = model.credential.connectScope === 'allowed'
      const invokeReady = model.credential.invokeScope === 'allowed'
      const networkReady = Boolean(model.networkProfileId)
      const liveConnectReady = model.latestLiveConnection?.status === 'ok'
      const liveInvokeReady = model.latestLiveInvocation?.status === 'ok'
      items.push(
        buildOnsiteIntakeItem({
          id: `model:${model.modelProfileId}`,
          domain: 'model_credentials',
          title: `模型凭证：${model.name}`,
          ownerId: model.modelProfileId,
          riskLevel: 'medium',
          fields: [
            onsiteIntakeField({
              key: 'secret_ref',
              label: '密钥库凭证',
              kind: 'secret_ref',
              ready: secretReady,
              redacted: true,
              valuePreview: model.credential.refPreview,
              instructions: ['把真实 API Key 存入密钥库，并确认该引用可解析。'],
            }),
            onsiteIntakeField({
              key: 'model_connect_scope',
              label: '连接测试授权',
              kind: 'approval',
              ready: connectReady,
              valuePreview: model.credential.connectScope,
              instructions: ['给该模型凭证授予 model.connect 作用域，允许连接测试。'],
            }),
            onsiteIntakeField({
              key: 'model_invoke_scope',
              label: '真实推理授权',
              kind: 'approval',
              ready: invokeReady,
              valuePreview: model.credential.invokeScope,
              instructions: ['给该模型凭证授予 model.invoke 作用域，允许真实推理。'],
            }),
            onsiteIntakeField({
              key: 'network_profile',
              label: '网络/IP 出口',
              kind: 'network_profile',
              ready: networkReady,
              valuePreview: model.networkProfileId,
              instructions: ['按客户或供应商要求绑定直连、HTTP/SOCKS5 代理或自定义网关。'],
            }),
            onsiteIntakeField({
              key: 'live_connection',
              label: '真实连接证据',
              kind: 'evidence',
              ready: liveConnectReady,
              valuePreview: model.latestLiveConnection?.status ?? null,
              instructions: ['运行一次 live 模型连接测试，并保存 ok 结果。'],
            }),
            onsiteIntakeField({
              key: 'live_invocation',
              label: '真实推理证据',
              kind: 'evidence',
              ready: liveInvokeReady,
              valuePreview: model.latestLiveInvocation?.status ?? null,
              instructions: ['通过 approved 上线哈希后运行一次真实推理探测，并保存 ok 结果。'],
            }),
          ],
          evidence: model.evidence,
          blockers: model.status === 'ready' ? [] : model.nextActions,
          nextActions: model.nextActions,
          validationCommands: onsiteActivation.validationCommands.filter((command) =>
            command.command.includes('smoke-production-integrations-api'),
          ).slice(0, 1),
        }),
      )
    }
  }

  items.push(
    buildOnsiteIntakeItem({
      id: 'network:model-routes',
      domain: 'network_routes',
      title: '模型网络/IP 出口',
      ownerId: null,
      riskLevel: 'medium',
      fields: [
        onsiteIntakeField({
          key: 'all_models_networked',
          label: '全部模型已绑定出口',
          kind: 'network_profile',
          ready: modelCredentials.models.length > 0 && modelCredentials.models.every((model) => model.networkProfileId),
          valuePreview: `${modelCredentials.models.filter((model) => model.networkProfileId).length}/${modelCredentials.models.length}`,
          instructions: ['每个真实模型都要绑定 Network Profile，便于控制落地 IP 和代理出口。'],
        }),
      ],
      evidence: liveConnectors.connectors
        .filter((connector) => connector.kind === 'model')
        .map((connector) => `${connector.label}: ${connector.routeLabel}`),
      blockers: modelCredentials.models.some((model) => !model.networkProfileId)
        ? ['还有模型没有绑定网络/IP 出口。']
        : [],
      nextActions: ['为没有出口的模型补齐 Network Profile，并重新运行连接测试。'],
      validationCommands: onsiteActivation.validationCommands.filter((command) =>
        command.label.includes('模型') || command.command.includes('model'),
      ).slice(0, 1),
    }),
  )

  const desktopConnector = connectorByKind.get('desktop')
  const desktopControl = gateByKey.get('desktop_control')
  const desktopCapture = gateByKey.get('desktop_capture')
  items.push(
    buildOnsiteIntakeItem({
      id: 'desktop:physical',
      domain: 'desktop_control',
      title: '真实桌面控制',
      ownerId: null,
      riskLevel: 'high',
      fields: [
        onsiteIntakeField({
          key: 'desktop_control_env',
          label: '桌面点击输入开关',
          kind: 'env_var',
          ready: desktopControl?.envEnabled === true,
          valuePreview: 'AGENTHUB_ENABLE_REAL_DESKTOP_CONTROL',
          instructions: ['只在客户授权的测试环境中设置 AGENTHUB_ENABLE_REAL_DESKTOP_CONTROL=1。'],
        }),
        onsiteIntakeField({
          key: 'desktop_capture_env',
          label: '桌面截图开关',
          kind: 'env_var',
          ready: desktopCapture?.envEnabled === true,
          valuePreview: 'AGENTHUB_ENABLE_REAL_DESKTOP_CAPTURE',
          instructions: ['只在客户授权的测试环境中设置 AGENTHUB_ENABLE_REAL_DESKTOP_CAPTURE=1。'],
        }),
        onsiteIntakeField({
          key: 'desktop_approval',
          label: '真实操作审批',
          kind: 'approval',
          ready: (desktopControl?.approvedRuntimeControlApprovals ?? 0) > 0,
          valuePreview: `${desktopControl?.approvedRuntimeControlApprovals ?? 0}`,
          instructions: ['真实点击、输入、截图必须绑定已批准的 runtime_control_action 审批。'],
        }),
        onsiteIntakeField({
          key: 'desktop_live_evidence',
          label: '真实执行证据',
          kind: 'evidence',
          ready: (desktopControl?.liveExecutions ?? 0) > 0 || (desktopCapture?.liveExecutions ?? 0) > 0,
          valuePreview: `${(desktopControl?.liveExecutions ?? 0) + (desktopCapture?.liveExecutions ?? 0)}`,
          instructions: ['完成至少一次客户授权范围内的桌面截图或低风险点击输入验证。'],
        }),
      ],
      evidence: desktopConnector?.evidence ?? [],
      blockers: desktopConnector?.blockers ?? ['桌面连接档案尚未生成。'],
      nextActions: desktopConnector?.nextActions ?? [],
      validationCommands: onsiteActivation.validationCommands.filter((command) =>
        command.label.includes('桌面') || command.command.includes('desktop'),
      ).slice(0, 2),
    }),
  )

  const mobileConnector = connectorByKind.get('mobile')
  const mobileControl = gateByKey.get('mobile_control')
  const mobileCapture = gateByKey.get('mobile_capture')
  const mobileObservation = gateByKey.get('mobile_observation')
  items.push(
    buildOnsiteIntakeItem({
      id: 'mobile:adb-appium',
      domain: 'mobile_control',
      title: '真实手机控制',
      ownerId: null,
      riskLevel: 'high',
      fields: [
        onsiteIntakeField({
          key: 'mobile_device',
          label: '测试手机设备',
          kind: 'device_id',
          ready: (mobileObservation?.completedActions ?? 0) > 0,
          valuePreview: `${mobileObservation?.completedActions ?? 0} 次发现`,
          instructions: ['连接客户授权的 Android 测试机或 Appium 设备，并运行设备发现。'],
        }),
        onsiteIntakeField({
          key: 'mobile_control_env',
          label: '手机点击输入开关',
          kind: 'env_var',
          ready: mobileControl?.envEnabled === true,
          valuePreview: 'AGENTHUB_ENABLE_REAL_MOBILE_CONTROL',
          instructions: ['只在客户授权的测试手机上设置 AGENTHUB_ENABLE_REAL_MOBILE_CONTROL=1。'],
        }),
        onsiteIntakeField({
          key: 'mobile_capture_env',
          label: '手机截图开关',
          kind: 'env_var',
          ready: mobileCapture?.envEnabled === true,
          valuePreview: 'AGENTHUB_ENABLE_REAL_MOBILE_CAPTURE',
          instructions: ['只在客户授权的测试手机上设置 AGENTHUB_ENABLE_REAL_MOBILE_CAPTURE=1。'],
        }),
        onsiteIntakeField({
          key: 'mobile_live_evidence',
          label: '真实执行证据',
          kind: 'evidence',
          ready: (mobileControl?.liveExecutions ?? 0) > 0 || (mobileCapture?.liveExecutions ?? 0) > 0,
          valuePreview: `${(mobileControl?.liveExecutions ?? 0) + (mobileCapture?.liveExecutions ?? 0)}`,
          instructions: ['完成至少一次客户授权范围内的手机截图或低风险点击输入验证。'],
        }),
      ],
      evidence: mobileConnector?.evidence ?? [],
      blockers: mobileConnector?.blockers ?? ['手机连接档案尚未生成。'],
      nextActions: mobileConnector?.nextActions ?? [],
      validationCommands: onsiteActivation.validationCommands.filter((command) =>
        command.label.includes('手机') || command.command.includes('mobile'),
      ).slice(0, 2),
    }),
  )

  const workstationConnector = connectorByKind.get('workstation')
  const workstationLaunch = gateByKey.get('workstation_launch')
  if (runtimeControl.workstationChecks.length === 0) {
    items.push(
      buildOnsiteIntakeItem({
        id: 'workstation:none',
        domain: 'workstations',
        title: '预留 VM/RDP 独立工作站',
        ownerId: null,
        riskLevel: 'high',
        fields: [
          onsiteIntakeField({
            key: 'workstation_reservation',
            label: '工作站预留',
            kind: 'rdp_config',
            ready: false,
            redacted: true,
            valuePreview: null,
            instructions: ['为需要操作电脑软件的 Agent 预留 VM、RDP、VNC 或虚拟桌面工作站。'],
          }),
        ],
        evidence: workstationConnector?.evidence ?? [],
        blockers: ['还没有 VM/RDP/VNC 工作站预留。'],
        nextActions: workstationConnector?.nextActions ?? [],
        validationCommands: onsiteActivation.validationCommands.filter((command) =>
          command.label.includes('工作站') || command.command.includes('workstation'),
        ).slice(0, 2),
      }),
    )
  } else {
    for (const workstation of runtimeControl.workstationChecks.slice(0, 12)) {
      items.push(
        buildOnsiteIntakeItem({
          id: `workstation:${workstation.id}`,
          domain: 'workstations',
          title: `工作站：${workstation.mode}`,
          ownerId: workstation.id,
          riskLevel: 'high',
          fields: [
            onsiteIntakeField({
              key: 'workspace_path',
              label: '工作目录',
              kind: 'evidence',
              ready: workstation.pathChecks.workspacePath,
              valuePreview: workstation.pathChecks.workspacePath ? '存在' : '缺失',
              instructions: ['确认该 Agent 的独立工作目录存在且可写。'],
            }),
            onsiteIntakeField({
              key: 'browser_profile_path',
              label: '浏览器隔离配置',
              kind: 'evidence',
              ready: workstation.pathChecks.browserProfilePath,
              valuePreview: workstation.pathChecks.browserProfilePath ? '存在' : '缺失',
              instructions: ['确认浏览器 profile 独立，不和其他 Agent 共用登录态。'],
            }),
            onsiteIntakeField({
              key: 'rdp_config',
              label: 'RDP 配置',
              kind: 'rdp_config',
              ready: workstation.hasRdpConfig,
              redacted: true,
              valuePreview: workstation.hasRdpConfig ? '已填写' : null,
              instructions: ['填写不含密码的 RDP 配置，凭证交给系统/远程桌面凭证管理器。'],
            }),
            onsiteIntakeField({
              key: 'vnc_url',
              label: 'VNC/远程地址',
              kind: 'vnc_url',
              ready: workstation.hasVncUrl,
              redacted: true,
              valuePreview: workstation.hasVncUrl ? '已填写' : null,
              instructions: ['可选填写 VNC 或远程浏览地址，不在这里保存密码。'],
            }),
            onsiteIntakeField({
              key: 'workstation_launch_env',
              label: '远程启动开关',
              kind: 'env_var',
              ready: workstationLaunch?.envEnabled === true,
              valuePreview: 'AGENTHUB_ENABLE_REAL_WORKSTATION_LAUNCH',
              instructions: ['只有在工作站验证通过后才设置真实远程启动开关。'],
            }),
          ],
          evidence: [`状态=${workstation.status}`, ...workstation.warnings],
          blockers: workstation.blockingReasons,
          nextActions: workstation.nextActions,
          validationCommands: onsiteActivation.validationCommands.filter((command) =>
            command.label.includes('工作站') || command.command.includes('workstation'),
          ).slice(0, 2),
        }),
      )
    }
  }

  items.push(
    buildOnsiteIntakeItem({
      id: 'customer:authorization',
      domain: 'customer_authorization',
      title: '客户现场授权',
      ownerId: null,
      riskLevel: 'high',
      fields: [
        onsiteIntakeField({
          key: 'customer_authorized',
          label: '客户真实操作授权',
          kind: 'approval',
          ready: customerEnvironment.customerAuthorization.switchEnabled,
          valuePreview: CUSTOMER_AUTHORIZATION_ENV,
          instructions: ['客户确认测试账号、测试设备、操作范围和停止条件后，才允许设置该开关。'],
        }),
        onsiteIntakeField({
          key: 'customer_authorization_evidence_hash',
          label: '授权证据哈希',
          kind: 'hash',
          ready: customerEnvironment.customerAuthorization.evidenceMatched,
          valuePreview: customerEnvironment.customerAuthorization.evidenceHash ?? CUSTOMER_AUTHORIZATION_EVIDENCE_HASH_ENV,
          instructions: [
            `把“客户现场授权”证据的 contentHash 写入 ${CUSTOMER_AUTHORIZATION_EVIDENCE_HASH_ENV}，系统会校验它是否匹配已写入证据。`,
          ],
        }),
        onsiteIntakeField({
          key: 'customer_package',
          label: '客户环境验收包',
          kind: 'evidence',
          ready: customerEnvironment.safeToRunLive,
          valuePreview: `${customerEnvironment.readinessScore}/100`,
          instructions: ['导出客户环境验收包，保存脱敏 manifest 和 markdown。'],
        }),
      ],
      evidence: customerEnvironment.evidence,
      blockers: customerEnvironment.blockers,
      nextActions: customerEnvironment.nextActions,
      validationCommands: onsiteActivation.validationCommands.slice(0, 2),
    }),
  )

  const runtimeGuardrailsCheck = customerEnvironment.checks.find((check) => check.key === 'runtime_guardrails')
  items.push(
    buildOnsiteIntakeItem({
      id: 'runtime:guardrails',
      domain: 'runtime_guardrails',
      title: '运行时安全护栏',
      ownerId: null,
      riskLevel: 'high',
      fields: [
        onsiteIntakeField({
          key: 'runtime_kill_switch',
          label: '运行时急停开关',
          kind: 'env_var',
          ready: customerEnvironment.emergencyStop.active === false,
          valuePreview: `${customerEnvironment.emergencyStop.envVar}=${
            customerEnvironment.emergencyStop.active ? '1' : 'off'
          }`,
          instructions: [
            '现场激活前确认 AGENTHUB_RUNTIME_CONTROL_KILL_SWITCH 的使用策略；未获批时可设为 1 作为全局急停，获批上线前必须确认其不会阻断已批准的真实动作。',
          ],
        }),
        ...customerEnvironment.runtimeGuards.map((guard) =>
          onsiteIntakeField({
            key: guard.key,
            label:
              guard.key === 'model_endpoint_host_allowlist'
                ? '模型 endpoint 主机白名单'
                : guard.key === 'desktop_target_allowlist'
                ? '桌面目标白名单'
                : guard.key === 'mobile_device_allowlist'
                  ? '手机设备白名单'
                  : '工作站目标白名单',
            kind: 'env_var',
            ready: guard.configured,
            valuePreview: guard.envVar,
            instructions: [
              `配置 ${guard.envVar}，只允许客户授权的目标进入真实运行。示例：${guard.valueHint}`,
              guard.purpose,
            ],
          }),
        ),
        onsiteIntakeField({
          key: 'runtime_guard_report',
          label: '护栏验收报告',
          kind: 'evidence',
          ready: runtimeGuardrailsCheck?.status === 'ready',
          valuePreview: runtimeGuardrailsCheck?.status ?? null,
          instructions: ['重新生成客户环境验收报告，确认 runtime_guardrails 检查项为 ready。'],
        }),
      ],
      evidence: runtimeGuardrailsCheck?.evidence ?? customerEnvironment.evidence,
      blockers: [
        ...(runtimeGuardrailsCheck?.warnings ?? []),
        ...(runtimeGuardrailsCheck?.status === 'ready' ? [] : ['运行时护栏尚未达到客户现场真实控制要求。']),
      ],
      nextActions: runtimeGuardrailsCheck?.nextActions ?? customerEnvironment.nextActions,
      validationCommands: onsiteActivation.validationCommands.filter((command) =>
        command.command.includes('execution-preflight') ||
        command.command.includes('customer-environment') ||
        command.command.includes('real-control'),
      ).slice(0, 2),
    }),
  )

  items.push(
    buildOnsiteIntakeItem({
      id: 'hardening:production',
      domain: 'hardening',
      title: '生产硬化与回退证据',
      ownerId: null,
      riskLevel: 'medium',
      fields: [
        onsiteIntakeField({
          key: 'hardening_score',
          label: '生产硬化分',
          kind: 'evidence',
          ready: customerEnvironment.readinessScore >= 85 && customerEnvironment.blockers.length === 0,
          valuePreview: `${customerEnvironment.readinessScore}/100`,
          instructions: ['现场环境验收分达到生产阈值，且没有高风险阻塞。'],
        }),
        onsiteIntakeField({
          key: 'activation_package',
          label: '现场激活包',
          kind: 'hash',
          ready: Boolean(finalAcceptance.summary.latestPackageHash),
          valuePreview: finalAcceptance.summary.latestPackageHash,
          instructions: ['导出现​​场激活包和客户环境包，并保留 SHA-256 哈希。'],
        }),
        onsiteIntakeField({
          key: 'onsite_evidence',
          label: '现场证据',
          kind: 'hash',
          ready: Boolean(finalAcceptance.summary.latestEvidenceHash),
          valuePreview: finalAcceptance.summary.latestEvidenceHash,
          instructions: ['至少写入一条现场验收证据，且不包含密钥、密码或客户隐私。'],
        }),
      ],
      evidence: finalAcceptance.evidence,
      blockers: finalAcceptance.blockers,
      nextActions: finalAcceptance.nextActions,
      validationCommands: onsiteActivation.validationCommands.slice(0, 3),
    }),
  )

  items.push(
    buildOnsiteIntakeItem({
      id: 'go_live:approved_hash',
      domain: 'go_live',
      title: '上线哈希闸门',
      ownerId: null,
      riskLevel: 'high',
      fields: [
        onsiteIntakeField({
          key: 'approved_go_live_hash',
          label: 'approved 判定哈希',
          kind: 'hash',
          ready: Boolean(approvedGoLiveHash),
          valuePreview: approvedGoLiveHash ? `${approvedGoLiveHash.slice(0, 18)}...` : null,
          instructions: ['只有最终验收通过并生成 approved 判定后，才设置 AGENTHUB_APPROVED_GO_LIVE_DECISION_HASH。'],
        }),
        onsiteIntakeField({
          key: 'final_acceptance',
          label: '最终验收总账',
          kind: 'evidence',
          ready: finalAcceptance.canClaimProductionReady,
          valuePreview: `${finalAcceptance.summary.passed}/${finalAcceptance.summary.total}`,
          instructions: ['所有最终验收分类通过后，才能生成真正可用的 approved 上线判定。'],
        }),
      ],
      evidence: finalAcceptance.evidence,
      blockers: finalAcceptance.canClaimProductionReady
        ? []
        : ['最终验收总账还不能声明 production ready。'],
      nextActions: [
        '先处理现场接入工单中的缺失项，再生成上线判定。',
        '只有 approved 判定哈希能放开真实模型推理、桌面、手机和 VM/RDP。',
      ],
      validationCommands: onsiteActivation.validationCommands.slice(0, 2),
    }),
  )

  const checks = items.map(onsiteIntakeItemToProbe)
  const readinessScore = scoreReadiness(checks)
  const blockers = uniqueNonEmpty(items.flatMap((item) => item.blockers)).slice(0, 18)
  const nextActions = uniqueNonEmpty(items.flatMap((item) => item.nextActions)).slice(0, 18)
  const checklist: ProductionOnsiteIntakeChecklist = {
    status: finalAcceptance.canClaimProductionReady && blockers.length === 0 ? 'ready' : readinessStatus(readinessScore, checks),
    readinessScore,
    generatedAt: Date.now(),
    redacted: true,
    canProceedToGoLive: finalAcceptance.canClaimProductionReady && blockers.length === 0,
    summary: {
      totalItems: items.length,
      readyItems: items.filter((item) => item.ready).length,
      blockedItems: items.filter((item) => item.status === 'blocked' || item.blockers.length > 0).length,
      missingFields: items.reduce(
        (sum, item) => sum + item.fields.filter((field) => field.required && field.currentStatus !== 'ready').length,
        0,
      ),
      highRiskItems: items.filter((item) => item.riskLevel === 'high').length,
      modelItems: items.filter((item) => item.domain === 'model_credentials').length,
      workstationItems: items.filter((item) => item.domain === 'workstations').length,
    },
    items,
    blockers,
    nextActions,
    safetyNotice:
      '现场接入工单只记录脱敏状态、引用名、开关名、验证命令和哈希；不要把 API Key、密码、Cookie、手机解锁码、远程桌面密码、支付信息或客户隐私写进工单。',
  }
  await recordAuditLog({
    actorType: 'system',
    action: 'production.onsite_intake.checklist',
    resourceType: 'production_integration',
    resourceId: 'onsite-intake',
    riskLevel: 'low',
    message: `Production onsite intake checklist generated with score ${readinessScore}.`,
    metadata: {
      status: checklist.status,
      readinessScore,
      totalItems: checklist.summary.totalItems,
      readyItems: checklist.summary.readyItems,
      missingFields: checklist.summary.missingFields,
      redacted: true,
    },
  })
  return checklist
}

export async function getProductionOnsiteActivationGuide(): Promise<ProductionOnsiteActivationGuide> {
  const [liveConnectors, customerEnvironment] = await Promise.all([
    getProductionLiveConnectorReport(),
    getProductionCustomerEnvironmentReport(),
  ])
  const modelConnectors = liveConnectors.connectors.filter((connector) => connector.kind === 'model')
  const desktopConnector = liveConnectors.connectors.find((connector) => connector.kind === 'desktop') ?? null
  const mobileConnector = liveConnectors.connectors.find((connector) => connector.kind === 'mobile') ?? null
  const workstationConnector = liveConnectors.connectors.find((connector) => connector.kind === 'workstation') ?? null
  const authorizationConnector =
    liveConnectors.connectors.find((connector) => connector.kind === 'customer_authorization') ?? null
  const envChecklist = buildOnsiteEnvChecklist(liveConnectors.connectors)
  const steps: ProductionOnsiteActivationStep[] = [
    onsiteActivationStep({
      id: 'customer_authorization',
      phase: 'authorization',
      title: '确认客户现场授权',
      status: authorizationConnector?.ready ? 'done' : 'blocked',
      riskLevel: 'high',
      automationAvailable: false,
      evidence: authorizationConnector?.evidence ?? [],
      actions: authorizationConnector?.nextActions ?? ['让客户确认测试账号、测试设备和真实控制授权。'],
      verification: ['确认 AGENTHUB_CUSTOMER_ENVIRONMENT_AUTHORIZED=1。'],
      rollback: ['关闭 AGENTHUB_CUSTOMER_ENVIRONMENT_AUTHORIZED，暂停所有真实控制动作。'],
    }),
    onsiteActivationStep({
      id: 'model_credentials',
      phase: 'credentials',
      title: '接入真实模型凭证',
      status:
        modelConnectors.length > 0 && modelConnectors.every((connector) => connector.ready)
          ? 'done'
          : 'needs_action',
      riskLevel: 'medium',
      automationAvailable: true,
      evidence: [
        `${liveConnectors.summary.modelReady}/${liveConnectors.summary.models} 个模型连接就绪`,
        ...modelConnectors.slice(0, 3).flatMap((connector) => connector.evidence.slice(0, 1)),
      ],
      actions: uniqueNonEmpty([
        ...modelConnectors.flatMap((connector) => connector.nextActions),
        '把正式 API Key 放入密钥库，并给模型连接和推理作用域授权。',
      ]),
      verification: ['运行模型连接测试和真实推理测试，确保最新证据为 ok。'],
      rollback: ['撤销 model.connect / model.invoke 凭证作用域，或禁用对应模型配置。'],
    }),
    onsiteActivationStep({
      id: 'network_routes',
      phase: 'network',
      title: '确认模型网络出口',
      status:
        modelConnectors.length > 0 &&
        modelConnectors.every((connector) => !connector.routeLabel.includes('未绑定'))
          ? 'done'
          : 'needs_action',
      riskLevel: 'medium',
      automationAvailable: true,
      evidence: modelConnectors.slice(0, 5).map((connector) => `${connector.label}: ${connector.routeLabel}`),
      actions: ['按模型供应商和客户要求绑定直连、HTTP 代理、SOCKS5 或自定义网关。'],
      verification: ['重新运行模型连接测试，确认请求走指定 Network Profile。'],
      rollback: ['把模型 Network Profile 切回 direct 或禁用该模型。'],
    }),
    onsiteActivationStep({
      id: 'desktop_runtime',
      phase: 'desktop',
      title: '启用桌面观察与控制',
      status: connectorStepStatus(desktopConnector),
      riskLevel: 'high',
      automationAvailable: true,
      evidence: desktopConnector?.evidence ?? [],
      actions: desktopConnector?.nextActions ?? ['开启桌面控制环境开关并完成真实桌面观察。'],
      verification: ['先做只读窗口观察，再用审批流程验证点击/输入被正确门控。'],
      rollback: ['关闭 AGENTHUB_ENABLE_REAL_DESKTOP_CONTROL 和 AGENTHUB_ENABLE_REAL_DESKTOP_CAPTURE。'],
    }),
    onsiteActivationStep({
      id: 'mobile_runtime',
      phase: 'mobile',
      title: '连接真实手机设备',
      status: connectorStepStatus(mobileConnector),
      riskLevel: 'high',
      automationAvailable: true,
      evidence: mobileConnector?.evidence ?? [],
      actions: mobileConnector?.nextActions ?? ['安装 Android platform-tools 或 Appium，并接入测试手机。'],
      verification: ['先运行设备发现，再通过审批流程验证截图/点击动作。'],
      rollback: ['拔掉测试手机或关闭 AGENTHUB_ENABLE_REAL_MOBILE_CONTROL / CAPTURE。'],
    }),
    onsiteActivationStep({
      id: 'workstation_runtime',
      phase: 'workstation',
      title: '预留 VM/RDP 独立工作站',
      status: connectorStepStatus(workstationConnector),
      riskLevel: 'high',
      automationAvailable: true,
      evidence: workstationConnector?.evidence ?? [],
      actions: workstationConnector?.nextActions ?? ['为每个需要操作电脑的 Agent 预留远程工作站。'],
      verification: ['运行工作站校验，确认 RDP/VNC/VM 配置完整且资源锁可释放。'],
      rollback: ['关闭 AGENTHUB_ENABLE_REAL_WORKSTATION_LAUNCH 并释放工作站预留。'],
    }),
    onsiteActivationStep({
      id: 'final_verification',
      phase: 'verification',
      title: '执行现场验收',
      status: customerEnvironment.safeToRunLive ? 'done' : 'needs_action',
      riskLevel: 'high',
      automationAvailable: true,
      evidence: [
        `客户环境验收分 ${customerEnvironment.readinessScore}/100`,
        `现场连接验收分 ${liveConnectors.readinessScore}/100`,
      ],
      actions: uniqueNonEmpty([
        ...customerEnvironment.nextActions,
        ...liveConnectors.nextActions,
      ]),
      verification: ['导出客户环境验收包，保存脱敏 manifest 和 markdown 作为上线证据。'],
      rollback: ['如任一高风险动作异常，暂停 Agent 运行并关闭全部真实控制开关。'],
    }),
    onsiteActivationStep({
      id: 'rollback_ready',
      phase: 'rollback',
      title: '准备一键回退方案',
      status: 'done',
      riskLevel: 'medium',
      automationAvailable: false,
      evidence: ['回退方案已生成，不包含任何密钥或账号。'],
      actions: ['现场执行前先确认回退负责人和恢复窗口。'],
      verification: ['确认所有高风险开关都有对应关闭命令。'],
      rollback: ['按下方回退命令关闭真实模型推理、桌面、手机、工作站和客户授权开关。'],
    }),
  ]
  const checks = steps.map(onsiteStepToProbe)
  const readinessScore = scoreReadiness(checks)
  const blockers = uniqueNonEmpty([
    ...steps.filter((step) => step.status === 'blocked').flatMap((step) => [step.title, ...step.actions]),
    ...liveConnectors.blockers,
    ...customerEnvironment.blockers,
  ]).slice(0, 16)
  const nextActions = uniqueNonEmpty([
    ...steps.filter((step) => step.status !== 'done').flatMap((step) => step.actions),
    ...liveConnectors.nextActions,
    ...customerEnvironment.nextActions,
  ]).slice(0, 16)
  const doneSteps = steps.filter((step) => step.status === 'done').length
  const needsActionSteps = steps.filter((step) => step.status === 'needs_action').length
  const blockedSteps = steps.filter((step) => step.status === 'blocked').length
  const safeToActivateLive =
    liveConnectors.safeToActivateLive &&
    customerEnvironment.safeToRunLive &&
    blockedSteps === 0 &&
    needsActionSteps === 0
  const guide: ProductionOnsiteActivationGuide = {
    status: safeToActivateLive ? 'ready' : readinessStatus(readinessScore, checks),
    readinessScore,
    generatedAt: Date.now(),
    safeToStartDryRun: liveConnectors.summary.total > 0,
    safeToActivateLive,
    summary: {
      totalSteps: steps.length,
      doneSteps,
      needsActionSteps,
      blockedSteps,
      envGates: envChecklist.length,
      enabledEnvGates: envChecklist.filter((item) => item.enabled).length,
      connectors: liveConnectors.summary.total,
      readyConnectors: liveConnectors.summary.ready,
    },
    steps,
    envChecklist,
    validationCommands: buildOnsiteValidationCommands(),
    rollbackPlan: buildOnsiteRollbackPlan(envChecklist),
    blockers,
    nextActions,
  }
  await recordAuditLog({
    actorType: 'system',
    action: 'production.onsite_activation.guide',
    resourceType: 'production_integration',
    resourceId: 'onsite-activation',
    riskLevel: 'low',
    message: `Production onsite activation guide generated with score ${readinessScore}.`,
    metadata: {
      status: guide.status,
      safeToActivateLive,
      doneSteps,
      needsActionSteps,
      blockedSteps,
    },
  })
  return guide
}

export async function createProductionOnsiteActivationPackage(): Promise<ProductionOnsiteActivationPackage> {
  const guide = await getProductionOnsiteActivationGuide()
  const generatedAt = Date.now()
  const id = `poa_${generatedAt}_${Math.random().toString(36).slice(2, 8)}`
  const dataDir = process.env.AGENTHUB_DATA_DIR ?? path.resolve(process.cwd(), '.agenthub-data')
  const exportRoot = path.join(dataDir, 'production-onsite-activation', id)
  mkdirSync(exportRoot, { recursive: true })
  const manifestFileName = `${id}.json`
  const markdownFileName = `${id}.md`
  const activationScriptFileName = `${id}-activate.ps1`
  const rollbackScriptFileName = `${id}-rollback.ps1`
  const manifestPath = path.join(exportRoot, manifestFileName)
  const markdownPath = path.join(exportRoot, markdownFileName)
  const activationScriptPath = path.join(exportRoot, activationScriptFileName)
  const rollbackScriptPath = path.join(exportRoot, rollbackScriptFileName)
  const markdown = renderOnsiteActivationMarkdown(id, guide)
  const activationScript = renderOnsiteActivationScript(id, guide)
  const rollbackScript = renderOnsiteRollbackScript(id, guide)
  const manifest = {
    schema: 'agenthub.production_onsite_activation.v1',
    id,
    generatedAt,
    redacted: true,
    guide,
    files: {
      manifestFileName,
      markdownFileName,
      activationScriptFileName,
      rollbackScriptFileName,
    },
    scriptHashes: {
      activationScript: `sha256:${sha256(activationScript)}`,
      rollbackScript: `sha256:${sha256(rollbackScript)}`,
    },
  }
  const manifestJson = `${stableStringify(manifest)}\n`
  const contentHash = `sha256:${sha256(`${manifestJson}\n${markdown}\n${activationScript}\n${rollbackScript}`)}`
  const packageDocument = {
    ...manifest,
    contentHash,
    safetyNotice:
      'This package is redacted. It contains activation steps, environment variable names, validation commands, and rollback commands, but no API keys, passwords, cookies, phone unlock codes, or remote desktop credentials.',
  }
  await Promise.all([
    writeFile(manifestPath, `${stableStringify(packageDocument)}\n`, 'utf8'),
    writeFile(markdownPath, markdown, 'utf8'),
    writeFile(activationScriptPath, activationScript, 'utf8'),
    writeFile(rollbackScriptPath, rollbackScript, 'utf8'),
  ])
  const pkg: ProductionOnsiteActivationPackage = {
    id,
    generatedAt,
    redacted: true,
    contentHash,
    guide,
    files: {
      manifestPath,
      markdownPath,
      activationScriptPath,
      rollbackScriptPath,
      manifestFileName,
      markdownFileName,
      activationScriptFileName,
      rollbackScriptFileName,
    },
    summary: {
      status: guide.status,
      readinessScore: guide.readinessScore,
      safeToActivateLive: guide.safeToActivateLive,
      totalSteps: guide.summary.totalSteps,
      blockedSteps: guide.summary.blockedSteps,
      rollbackCommands: guide.rollbackPlan.length,
    },
  }
  await recordAuditLog({
    actorType: 'system',
    action: 'production.onsite_activation.package',
    resourceType: 'production_integration',
    resourceId: id,
    riskLevel: 'low',
    message: `Production onsite activation package ${id} generated.`,
    metadata: {
      contentHash,
      manifestPath,
      markdownPath,
      activationScriptPath,
      rollbackScriptPath,
      safeToActivateLive: guide.safeToActivateLive,
      readinessScore: guide.readinessScore,
      blockedSteps: guide.summary.blockedSteps,
    },
  })
  return pkg
}

export async function recordProductionOnsiteEvidence(
  args: CreateProductionOnsiteEvidenceArgs,
): Promise<ProductionOnsiteEvidenceRecord> {
  const category = normalizeFinalAcceptanceCategory(args.category)
  const title = args.title.trim()
  if (!title) throw new Error('Evidence title is required.')
  const evidence = uniqueNonEmpty(args.evidence).slice(0, 12)
  if (evidence.length === 0) throw new Error('At least one evidence item is required.')
  assertRedactedOnsiteEvidence({
    title,
    evidence,
    notes: args.notes,
    operator: args.operator,
    externalRef: args.externalRef,
  })
  const riskLevel = args.riskLevel ?? 'medium'
  const createdAt = Date.now()
  const verifiedAt = args.verifiedAt && Number.isFinite(args.verifiedAt) ? args.verifiedAt : createdAt
  const id = `poe_${createdAt}_${Math.random().toString(36).slice(2, 8)}`
  const recordBase = {
    id,
    category,
    title,
    evidence,
    notes: nullableTextValue(args.notes),
    operator: nullableTextValue(args.operator),
    externalRef: nullableTextValue(args.externalRef),
    riskLevel,
    verifiedAt,
    createdAt,
  }
  const contentHash = `sha256:${sha256(stableStringify(recordBase))}`
  const record: ProductionOnsiteEvidenceRecord = {
    ...recordBase,
    contentHash,
  }
  await recordAuditLog({
    actorType: 'system',
    action: 'production.final_acceptance.evidence',
    resourceType: 'production_integration',
    resourceId: id,
    riskLevel,
    message: `Production onsite evidence recorded for ${category}: ${title}.`,
    metadata: {
      ...record,
      redacted: true,
      safetyNotice:
        'This evidence record must not include API keys, passwords, cookies, phone unlock codes, payment data, or customer private data.',
    },
  })
  return record
}

export async function getProductionOnsiteEvidenceReport(): Promise<ProductionOnsiteEvidenceReport> {
  const auditLogs = await db.query.auditLogs.findMany({
    orderBy: [desc(schema.auditLogs.createdAt)],
    limit: PRODUCTION_AUDIT_LOOKBACK_LIMIT,
  })
  const records = auditLogs
    .map(onsiteEvidenceRecordFromAuditLog)
    .filter((record): record is ProductionOnsiteEvidenceRecord => Boolean(record))
  const byCategory = finalAcceptanceCategoryKeys().reduce(
    (acc, category) => {
      acc[category] = records.filter((record) => record.category === category).length
      return acc
    },
    {} as Record<ProductionFinalAcceptanceCategoryKey, number>,
  )
  return {
    generatedAt: Date.now(),
    records,
    summary: {
      total: records.length,
      categoriesCovered: Object.values(byCategory).filter((count) => count > 0).length,
      latestEvidenceHash: records[0]?.contentHash ?? null,
      byCategory,
    },
  }
}

export async function createProductionGoLiveDecision(): Promise<ProductionGoLiveDecision> {
  const [ledger, onsiteActivation] = await Promise.all([
    getProductionFinalAcceptanceLedger(),
    getProductionOnsiteActivationGuide(),
  ])
  const generatedAt = Date.now()
  const id = `pgld_${generatedAt}_${Math.random().toString(36).slice(2, 8)}`
  const activationPlan: ProductionGoLiveActivationInstruction[] = [
    ...goLiveEnvironmentGates().map((gate): ProductionGoLiveActivationInstruction => ({
      envVar: gate.envVar,
      label: gate.label,
      currentlyEnabled: gate.enabled,
      requiredForLive: true,
      riskLevel: gate.riskLevel,
      powershellPreview:
        gate.envVar === CUSTOMER_AUTHORIZATION_EVIDENCE_HASH_ENV
          ? `$env:${gate.envVar}='${
              process.env[CUSTOMER_AUTHORIZATION_EVIDENCE_HASH_ENV]?.trim() ??
              ledger.summary.customerAuthorizationEvidenceHash ??
              ledger.summary.latestEvidenceHash ??
              'sha256:...'
            }'`
          : `$env:${gate.envVar}='1'`,
      reason: goLiveGateReason(gate.key),
    })),
    ...goLiveRuntimeGuardActivationInstructions(),
  ]
  const environmentFingerprint = goLiveEnvironmentFingerprint(
    activationPlan.map((instruction) => instruction.envVar),
  )
  const runtimeGuardrailReasons = ledger.categories
    .filter((category) => category.key === 'runtime_guardrails')
    .flatMap((category) => [...category.missingEvidence, ...category.blockers])
  const blockedReasons = uniqueNonEmpty([
    ...(!ledger.canClaimProductionReady ? ['最终验收总账尚未达到生产可上线条件。'] : []),
    ...runtimeGuardrailReasons,
    ...ledger.blockers,
    ...(ledger.summary.latestPackageHash ? [] : ['还没有完整现场验收包哈希。']),
    ...(ledger.summary.latestEvidenceHash ? [] : ['还没有现场证据哈希。']),
  ]).slice(0, 20)
  const canActivateLive = ledger.canClaimProductionReady && blockedReasons.length === 0
  const decision: ProductionGoLiveDecision['decision'] = canActivateLive ? 'approved' : 'blocked'
  const decisionBase = {
    id,
    generatedAt,
    decision,
    status: canActivateLive ? 'ready' : ledger.status,
    readinessScore: ledger.readinessScore,
    canActivateLive,
    ledgerSnapshot: {
      status: ledger.status,
      readinessScore: ledger.readinessScore,
      canClaimProductionReady: ledger.canClaimProductionReady,
      passed: ledger.summary.passed,
      total: ledger.summary.total,
      blockers: ledger.blockers.length,
      onsiteEvidenceItems: ledger.summary.onsiteEvidenceItems,
      latestPackageHash: ledger.summary.latestPackageHash,
      latestEvidenceHash: ledger.summary.latestEvidenceHash,
      customerAuthorizationEvidenceHash: ledger.summary.customerAuthorizationEvidenceHash,
      customerAuthorizationEvidenceMatched: ledger.summary.customerAuthorizationEvidenceMatched,
    },
    environmentFingerprint,
    activationPlan,
    rollbackPlan: onsiteActivation.rollbackPlan,
    blockedReasons,
    nextActions: uniqueNonEmpty([
      ...ledger.nextActions,
      ...blockedReasons.map((reason) => `处理：${reason}`),
      ...(canActivateLive
        ? ['现场负责人确认后，按激活计划逐项开启真实能力环境开关。']
        : ['不要开启真实桌面、手机、模型推理或远程工作站开关，直到总账通过。']),
    ]).slice(0, 20),
    safetyNotice:
      '上线判定只记录状态和脱敏证据，不包含 API Key、密码、Cookie、手机解锁码、远程桌面密码、支付信息或客户隐私数据。',
  }
  const contentHash = `sha256:${sha256(stableStringify(decisionBase))}`
  const approvedHashInstruction: ProductionGoLiveActivationInstruction = {
    envVar: 'AGENTHUB_APPROVED_GO_LIVE_DECISION_HASH',
    label: '上线判定哈希',
    currentlyEnabled: process.env.AGENTHUB_APPROVED_GO_LIVE_DECISION_HASH?.trim() === contentHash,
    requiredForLive: true,
    riskLevel: 'high',
    powershellPreview: canActivateLive
      ? `$env:AGENTHUB_APPROVED_GO_LIVE_DECISION_HASH='${contentHash}'`
      : '先生成 approved 上线判定后再设置 AGENTHUB_APPROVED_GO_LIVE_DECISION_HASH',
    reason: canActivateLive
      ? '绑定本次 approved 上线判定，真实模型推理、桌面控制、手机控制和虚拟工作站必须匹配该哈希。'
      : '当前判定为 blocked，不能把 blocked 判定哈希用于放行真实能力。',
  }
  const goLiveDecision: ProductionGoLiveDecision = {
    ...decisionBase,
    contentHash,
    approvedHashInstruction,
  }
  await recordAuditLog({
    actorType: 'system',
    action: 'production.go_live.decision',
    resourceType: 'production_integration',
    resourceId: id,
    riskLevel: canActivateLive ? 'medium' : 'low',
    status: canActivateLive ? 'allowed' : 'blocked',
    message: `Production go-live decision ${id}: ${decision}.`,
    metadata: {
      id,
      decision,
      contentHash,
      approvedHashEnvVar: approvedHashInstruction.envVar,
      canActivateLive,
      readinessScore: ledger.readinessScore,
      blockedReasons,
      latestPackageHash: ledger.summary.latestPackageHash,
      latestEvidenceHash: ledger.summary.latestEvidenceHash,
      customerAuthorizationEvidenceHash: ledger.summary.customerAuthorizationEvidenceHash,
      customerAuthorizationEvidenceMatched: ledger.summary.customerAuthorizationEvidenceMatched,
      environmentFingerprint,
      redacted: true,
    },
  })
  return goLiveDecision
}

export async function createProductionLivePilotLease(args: {
  durationMinutes?: number | null
} = {}): Promise<ProductionLivePilotLease> {
  const durationInput = Number(args.durationMinutes ?? 60)
  const durationMinutes = Number.isFinite(durationInput)
    ? Math.min(240, Math.max(5, Math.round(durationInput)))
    : 60
  const generatedAt = Date.now()
  const expiresAt = generatedAt + durationMinutes * 60 * 1000
  const id = `plpl_${generatedAt}_${Math.random().toString(36).slice(2, 8)}`
  const [goLiveGate, auditLogs] = await Promise.all([
    evaluateProductionGoLiveRuntimeGate({
      requireLivePilotLease: false,
      requireLivePilotSession: false,
    }),
    db.query.auditLogs.findMany({
      orderBy: [desc(schema.auditLogs.createdAt)],
      limit: PRODUCTION_AUDIT_LOOKBACK_LIMIT,
    }),
  ])
  const latestApprovedDecision =
    auditLogs.find(
      (log) =>
        log.action === 'production.go_live.decision' &&
        log.metadata.decision === 'approved' &&
        log.metadata.canActivateLive === true,
    ) ?? null
  const goLiveDecisionHash =
    typeof latestApprovedDecision?.metadata.contentHash === 'string'
      ? latestApprovedDecision.metadata.contentHash
      : null
  const customerAuthorizationEvidenceHash =
    typeof latestApprovedDecision?.metadata.customerAuthorizationEvidenceHash === 'string'
      ? latestApprovedDecision.metadata.customerAuthorizationEvidenceHash
      : null
  const environmentFingerprint = productionGoLiveEnvironmentFingerprintFromMetadata(
    latestApprovedDecision?.metadata.environmentFingerprint,
  )
  const environmentFingerprintHash = productionGoLiveEnvironmentFingerprintHash(environmentFingerprint)
  const blockers = uniqueNonEmpty([
    ...(goLiveGate.allowed ? [] : [goLiveGate.reason]),
    ...(latestApprovedDecision ? [] : ['No audited approved go-live decision is available.']),
    ...(goLiveDecisionHash ? [] : ['Approved go-live decision content hash is missing.']),
    ...(goLiveGate.latestDecisionHash === goLiveDecisionHash
      ? []
      : ['Latest audited go-live decision does not match the approved decision selected for this live pilot lease.']),
    ...(customerAuthorizationEvidenceHash ? [] : ['Approved go-live decision is not bound to customer authorization evidence.']),
    ...(environmentFingerprintHash ? [] : ['Approved go-live decision is not bound to a runtime environment fingerprint.']),
    ...(goLiveGate.latestDecisionEnvironmentFingerprintMatched
      ? []
      : ['Current runtime environment fingerprint does not match the approved go-live decision.']),
  ])
  const canActivateLivePilot = blockers.length === 0
  const leaseBase = {
    id,
    generatedAt,
    expiresAt,
    durationMinutes,
    goLiveDecisionHash,
    customerAuthorizationEvidenceHash,
    environmentFingerprintHash,
    environmentFingerprintItems: environmentFingerprint.length,
    canActivateLivePilot,
  }
  const contentHash = `sha256:${sha256(stableStringify(leaseBase))}`
  const currentlyEnabled = process.env[LIVE_PILOT_LEASE_HASH_ENV]?.trim() === contentHash
  const status: ProductionLivePilotLease['status'] =
    expiresAt <= generatedAt ? 'expired' : canActivateLivePilot && currentlyEnabled ? 'active' : 'blocked'
  const activationInstruction: ProductionGoLiveActivationInstruction = {
    envVar: LIVE_PILOT_LEASE_HASH_ENV,
    label: '现场试运行凭证',
    currentlyEnabled,
    requiredForLive: true,
    riskLevel: 'high',
    powershellPreview: canActivateLivePilot
      ? `$env:${LIVE_PILOT_LEASE_HASH_ENV}='${contentHash}'`
      : `先通过上线判定、客户授权和环境指纹检查，再生成 ${LIVE_PILOT_LEASE_HASH_ENV}`,
    reason:
      '真实模型调用、桌面控制、手机控制和虚拟工作站启动必须绑定一张未过期的现场试运行凭证。',
  }
  const lease: ProductionLivePilotLease = {
    ...leaseBase,
    status,
    contentHash,
    currentlyEnabled,
    activationInstruction,
    blockers,
    nextActions: canActivateLivePilot
      ? [
          `将 ${LIVE_PILOT_LEASE_HASH_ENV} 设置为本凭证 hash。`,
          `本凭证将在 ${new Date(expiresAt).toISOString()} 过期；过期后重新生成。`,
          '先进行小范围现场试运行，再放大到真实客户任务。',
        ]
      : [
          '不要启动真实模型调用、桌面控制、手机控制或虚拟工作站。',
          '先补齐 approved 上线判定、客户授权证据和当前环境指纹。',
        ],
    safetyNotice:
      'Live pilot lease is time-limited and redacted; it does not contain API keys, cookies, passwords, device unlock codes, remote desktop passwords, payment data, or customer private content.',
  }
  await recordAuditLog({
    actorType: 'system',
    action: 'production.live_pilot.lease',
    resourceType: 'production_integration',
    resourceId: id,
    riskLevel: canActivateLivePilot ? 'medium' : 'low',
    status: canActivateLivePilot ? 'allowed' : 'blocked',
    message: `Production live pilot lease ${id}: ${status}.`,
    metadata: {
      ...leaseBase,
      contentHash,
      status,
      currentlyEnabled,
      activationEnvVar: LIVE_PILOT_LEASE_HASH_ENV,
      blockers,
      redacted: true,
    },
  })
  return lease
}

export async function startProductionLivePilotSession(args: {
  durationMinutes?: number | null
} = {}): Promise<ProductionLivePilotSession> {
  const requestedDurationInput = Number(args.durationMinutes ?? 60)
  const requestedDurationMinutes = Number.isFinite(requestedDurationInput)
    ? Math.min(240, Math.max(5, Math.round(requestedDurationInput)))
    : 60
  const generatedAt = Date.now()
  const startedAt = generatedAt
  const id = `plps_${generatedAt}_${Math.random().toString(36).slice(2, 8)}`
  const [goLiveGate, auditLogs] = await Promise.all([
    evaluateProductionGoLiveRuntimeGate({ requireLivePilotSession: false }),
    db.query.auditLogs.findMany({
      orderBy: [desc(schema.auditLogs.createdAt)],
      limit: PRODUCTION_AUDIT_LOOKBACK_LIMIT,
    }),
  ])
  const livePilotLease =
    goLiveGate.livePilotLeaseHash
      ? auditLogs.find(
          (log) =>
            log.action === 'production.live_pilot.lease' &&
            log.metadata.contentHash === goLiveGate.livePilotLeaseHash,
        ) ?? null
      : null
  const livePilotLeaseExpiresAt =
    typeof livePilotLease?.metadata.expiresAt === 'number'
      ? livePilotLease.metadata.expiresAt
      : goLiveGate.latestLivePilotLeaseExpiresAt
  const requestedExpiresAt = startedAt + requestedDurationMinutes * 60 * 1000
  const expiresAt =
    livePilotLeaseExpiresAt && livePilotLeaseExpiresAt > 0
      ? Math.min(requestedExpiresAt, livePilotLeaseExpiresAt)
      : requestedExpiresAt
  const durationMinutes = Math.max(0, Math.ceil((expiresAt - startedAt) / 60_000))
  const blockers = uniqueNonEmpty([
    ...(goLiveGate.allowed ? [] : [goLiveGate.reason]),
    ...(livePilotLease ? [] : ['No audited live pilot lease matches the current lease hash.']),
    ...(livePilotLeaseExpiresAt && livePilotLeaseExpiresAt > startedAt
      ? []
      : ['The current live pilot lease is already expired.']),
    ...(goLiveGate.livePilotLeaseMatched ? [] : ['The current live pilot lease is not matched.']),
  ])
  const canRunLivePilot = blockers.length === 0
  const sessionBase = {
    id,
    generatedAt,
    startedAt,
    expiresAt,
    durationMinutes,
    livePilotLeaseHash: goLiveGate.livePilotLeaseHash,
    livePilotLeaseExpiresAt,
    goLiveDecisionHash: goLiveGate.latestDecisionHash,
    customerAuthorizationEvidenceHash: goLiveGate.latestDecisionCustomerAuthorizationEvidenceHash,
    environmentFingerprintHash:
      typeof livePilotLease?.metadata.environmentFingerprintHash === 'string'
        ? livePilotLease.metadata.environmentFingerprintHash
        : null,
    canRunLivePilot,
  }
  const contentHash = `sha256:${sha256(stableStringify(sessionBase))}`
  const status: ProductionLivePilotSessionStatus =
    expiresAt <= startedAt ? 'expired' : canRunLivePilot ? 'active' : 'blocked'
  const session: ProductionLivePilotSession = {
    ...sessionBase,
    stoppedAt: null,
    status,
    contentHash,
    blockers,
    nextActions: canRunLivePilot
      ? [
          `现场试运行会话已开始，将在 ${new Date(expiresAt).toISOString()} 自动过期。`,
          '只在本会话窗口内执行真实模型、桌面、手机或 VM/RDP 操作。',
          '现场试运行完成后立即停止会话并导出审计记录。',
        ]
      : [
          '不要执行真实模型、桌面、手机或 VM/RDP 操作。',
          '先让上线判定、客户授权、环境指纹和试运行凭证全部匹配。',
        ],
    safetyNotice:
      'Live pilot session is an audited execution window. It stores hashes and status only, not API keys, passwords, cookies, payment data, or customer private content.',
  }
  await recordAuditLog({
    actorType: 'system',
    action: 'production.live_pilot.session_started',
    resourceType: 'production_integration',
    resourceId: id,
    riskLevel: canRunLivePilot ? 'high' : 'low',
    status: canRunLivePilot ? 'allowed' : 'blocked',
    message: `Production live pilot session ${id}: ${status}.`,
    metadata: {
      ...sessionBase,
      contentHash,
      status,
      blockers,
      redacted: true,
    },
  })
  return session
}

export async function stopProductionLivePilotSession(args: {
  reason?: string | null
} = {}): Promise<ProductionLivePilotSession> {
  const report = await getProductionLivePilotSessionReport()
  const stoppedAt = Date.now()
  const activeSession = report.activeSession
  if (!activeSession) {
    const id = `plps_stop_${stoppedAt}_${Math.random().toString(36).slice(2, 8)}`
    const sessionBase = {
      id,
      generatedAt: stoppedAt,
      startedAt: stoppedAt,
      expiresAt: stoppedAt,
      durationMinutes: 0,
      livePilotLeaseHash: null,
      livePilotLeaseExpiresAt: null,
      goLiveDecisionHash: null,
      customerAuthorizationEvidenceHash: null,
      environmentFingerprintHash: null,
      canRunLivePilot: false,
    }
    const contentHash = `sha256:${sha256(stableStringify(sessionBase))}`
    const session: ProductionLivePilotSession = {
      ...sessionBase,
      stoppedAt,
      status: 'blocked',
      contentHash,
      blockers: ['No active live pilot session is available to stop.'],
      nextActions: ['Start a live pilot session only after the go-live gate, lease, and onsite authorization match.'],
      safetyNotice:
        'Stop request was recorded without secrets or customer private content.',
    }
    await recordAuditLog({
      actorType: 'system',
      action: 'production.live_pilot.session_stopped',
      resourceType: 'production_integration',
      resourceId: id,
      riskLevel: 'low',
      status: 'blocked',
      message: 'Production live pilot stop requested, but no active session was available.',
      metadata: {
        ...sessionBase,
        contentHash,
        status: session.status,
        stoppedAt,
        reason: args.reason?.trim() || 'no_active_session',
        redacted: true,
      },
    })
    return session
  }
  const stoppedSession: ProductionLivePilotSession = {
    ...activeSession,
    stoppedAt,
    status: 'stopped',
    canRunLivePilot: false,
    blockers: ['Live pilot session has been stopped.'],
    nextActions: ['Start a fresh live pilot session before any further live execution.'],
  }
  await recordAuditLog({
    actorType: 'system',
    action: 'production.live_pilot.session_stopped',
    resourceType: 'production_integration',
    resourceId: activeSession.id,
    riskLevel: 'medium',
    status: 'allowed',
    message: `Production live pilot session ${activeSession.id} stopped.`,
    metadata: {
      sessionId: activeSession.id,
      sessionHash: activeSession.contentHash,
      livePilotLeaseHash: activeSession.livePilotLeaseHash,
      stoppedAt,
      reason: args.reason?.trim() || 'manual_stop',
      redacted: true,
    },
  })
  return stoppedSession
}

export async function getProductionLivePilotSessionReport(): Promise<ProductionLivePilotSessionReport> {
  const generatedAt = Date.now()
  const auditLogs = await db.query.auditLogs.findMany({
    orderBy: [desc(schema.auditLogs.createdAt)],
    limit: PRODUCTION_AUDIT_LOOKBACK_LIMIT,
  })
  const stopLogs = auditLogs.filter((log) => log.action === 'production.live_pilot.session_stopped')
  const sessions = auditLogs
    .filter((log) => log.action === 'production.live_pilot.session_started')
    .map((log) => {
      const id = typeof log.metadata.id === 'string' ? log.metadata.id : log.resourceId
      const stopLog = stopLogs.find((item) => item.metadata.sessionId === id) ?? null
      return livePilotSessionFromAuditMetadata(log.metadata, stopLog?.metadata.stoppedAt)
    })
    .filter((session): session is ProductionLivePilotSession => Boolean(session))
    .slice(0, 20)
  const activeSession = sessions.find((session) => session.status === 'active') ?? null
  const summary = {
    total: sessions.length,
    active: sessions.filter((session) => session.status === 'active').length,
    stopped: sessions.filter((session) => session.status === 'stopped').length,
    expired: sessions.filter((session) => session.status === 'expired').length,
    blocked: sessions.filter((session) => session.status === 'blocked').length,
  }
  return {
    generatedAt,
    activeSession,
    sessions,
    summary,
    blockers: activeSession ? [] : ['No active live pilot session is currently open.'],
    nextActions: activeSession
      ? ['Stop the live pilot session immediately after onsite verification is done.']
      : ['Start a live pilot session only after the live pilot lease and go-live gate match.'],
  }
}

export async function getProductionFinalAcceptanceLedger(): Promise<ProductionFinalAcceptanceLedger> {
  const [
    modelCredentials,
    realControl,
    liveConnectors,
    onsiteActivation,
    customerEnvironment,
    hardening,
    packageIntegrity,
    auditLogs,
  ] = await Promise.all([
    getProductionModelCredentialReport(),
    getRealControlRuntimeAcceptanceReport(),
    getProductionLiveConnectorReport(),
    getProductionOnsiteActivationGuide(),
    getProductionCustomerEnvironmentReport(),
    getProductionHardeningReport(),
    getProductionPackageIntegrityReport(),
    db.query.auditLogs.findMany({
      orderBy: [desc(schema.auditLogs.createdAt)],
      limit: PRODUCTION_AUDIT_LOOKBACK_LIMIT,
    }),
  ])
  const latestOnsitePackageHash =
    auditLogs
      .filter((log) => log.action === 'production.onsite_activation.package')
      .map((log) => log.metadata.contentHash)
      .find((value): value is string => typeof value === 'string') ?? null
  const latestCustomerPackageHash =
    auditLogs
      .filter((log) => log.action === 'production.customer_environment.package')
      .map((log) => log.metadata.contentHash)
      .find((value): value is string => typeof value === 'string') ?? null
  const latestPackageHash = latestOnsitePackageHash ?? latestCustomerPackageHash
  const onsiteEvidenceRecords = auditLogs
    .map(onsiteEvidenceRecordFromAuditLog)
    .filter((record): record is ProductionOnsiteEvidenceRecord => Boolean(record))
  const latestEvidenceHash = onsiteEvidenceRecords[0]?.contentHash ?? null
  const categoryEvidence = (category: ProductionFinalAcceptanceCategoryKey) =>
    onsiteEvidenceForCategory(onsiteEvidenceRecords, category)
  const customerAuthorization = customerAuthorizationEvidenceGateFromRecords(onsiteEvidenceRecords)
  const modelCount = modelCredentials.summary.modelProfiles
  const modelCredentialsPassed =
    modelCount > 0 &&
    modelCredentials.summary.readyModels === modelCount &&
    modelCredentials.summary.liveConnectionOk >= modelCount &&
    modelCredentials.summary.liveInvocationOk >= modelCount &&
    modelCredentials.summary.scopedForConnect >= modelCount &&
    modelCredentials.summary.scopedForInvoke >= modelCount &&
    modelCredentials.models.every((model) => model.networkProfileId)
  const onsitePackageIntegrityReady = packageIntegrity.packages.some(
    (item) => item.kind === 'onsite_activation' && item.status === 'ready',
  )
  const customerPackageIntegrityReady = packageIntegrity.packages.some(
    (item) => item.kind === 'customer_environment' && item.status === 'ready',
  )
  const rollbackPassed =
    onsiteActivation.validationCommands.length > 0 &&
    onsiteActivation.rollbackPlan.length > 0 &&
    Boolean(latestOnsitePackageHash) &&
    Boolean(latestCustomerPackageHash) &&
    onsitePackageIntegrityReady &&
    customerPackageIntegrityReady
  const runtimeGuardrailsCheck = customerEnvironment.checks.find((check) => check.key === 'runtime_guardrails')
  const runtimeGuardrailsPassed =
    customerEnvironment.emergencyStop.active === false &&
    customerEnvironment.runtimeGuards.every((guard) => guard.configured) &&
    runtimeGuardrailsCheck?.status === 'ready'

  const categories = [
    finalAcceptanceCategory({
      key: 'model_credentials',
      title: '模型凭证和出口',
      status: modelCredentialsPassed ? 'ready' : modelCredentials.status === 'ready' ? 'available' : modelCredentials.status,
      passed: modelCredentialsPassed,
      requiredEvidence: [
        '至少一个模型档案',
        '全部模型凭证可解析',
        '全部模型具备 model.connect 授权',
        '全部模型具备 model.invoke 授权',
        '全部模型真实连接测试成功',
        '全部模型真实推理测试成功',
        '全部模型绑定网络出口',
      ],
      presentEvidence: [
        `${modelCredentials.summary.readyModels}/${modelCount} 个模型凭证就绪`,
        `${modelCredentials.summary.scopedForConnect}/${modelCount} 个模型具备 model.connect 授权`,
        `${modelCredentials.summary.scopedForInvoke}/${modelCount} 个模型具备 model.invoke 授权`,
        `${modelCredentials.summary.liveConnectionOk}/${modelCount} 个模型真实连接成功`,
        `${modelCredentials.summary.liveInvocationOk}/${modelCount} 个模型真实推理成功`,
        `${modelCredentials.models.filter((model) => model.networkProfileId).length}/${modelCount} 个模型绑定网络出口`,
        ...categoryEvidence('model_credentials'),
      ],
      missingEvidence: [
        ...(modelCount === 0 ? ['还没有可验收的模型档案'] : []),
        ...(modelCredentials.summary.readyModels < modelCount ? ['仍有模型凭证不可解析或授权不完整'] : []),
        ...(modelCredentials.summary.scopedForConnect < modelCount ? ['仍有模型缺少 model.connect 授权'] : []),
        ...(modelCredentials.summary.scopedForInvoke < modelCount ? ['仍有模型缺少 model.invoke 授权'] : []),
        ...(modelCredentials.summary.liveConnectionOk < modelCount ? ['仍有模型缺少真实连接成功证据'] : []),
        ...(modelCredentials.summary.liveInvocationOk < modelCount ? ['仍有模型缺少真实推理成功证据'] : []),
        ...(modelCredentials.models.some((model) => !model.networkProfileId) ? ['仍有模型没有绑定网络出口'] : []),
      ],
      blockers: modelCredentials.blockers,
      nextActions: modelCredentials.nextActions,
    }),
    finalAcceptanceCategory({
      key: 'desktop_control',
      title: '真实桌面控制',
      status: realControl.desktop.status,
      passed: realControl.desktop.ready,
      requiredEvidence: [
        '可以观察 Windows 窗口',
        '桌面截图和桌面点击输入门控已按需开启',
        '高风险桌面动作有审批记录',
        '至少一条真实桌面执行证据',
        '没有未释放资源锁或阻塞动作',
      ],
      presentEvidence: [...realControl.desktop.evidence, ...categoryEvidence('desktop_control')],
      missingEvidence: realControl.desktop.ready ? [] : realControl.desktop.blockers,
      blockers: realControl.desktop.blockers,
      nextActions: realControl.desktop.nextActions,
    }),
    finalAcceptanceCategory({
      key: 'mobile_control',
      title: '真实手机控制',
      status: realControl.mobile.status,
      passed: realControl.mobile.ready,
      requiredEvidence: [
        'ADB 或 Appium 工具链可用',
        '测试手机已连接并可识别',
        '手机截图和点击输入门控已按需开启',
        '至少一条真实手机执行证据',
        '没有未释放资源锁或阻塞动作',
      ],
      presentEvidence: [...realControl.mobile.evidence, ...categoryEvidence('mobile_control')],
      missingEvidence: realControl.mobile.ready ? [] : realControl.mobile.blockers,
      blockers: realControl.mobile.blockers,
      nextActions: realControl.mobile.nextActions,
    }),
    finalAcceptanceCategory({
      key: 'workstations',
      title: '独立工作站',
      status: realControl.workstations.status,
      passed: realControl.workstations.ready,
      requiredEvidence: [
        '至少一个 VM/RDP/VNC 工作站可用',
        '工作区、浏览器配置和临时目录可访问',
        '远程会话启动动作有审批记录',
        '工作站校验通过',
        '没有阻塞工作站',
      ],
      presentEvidence: [...realControl.workstations.evidence, ...categoryEvidence('workstations')],
      missingEvidence: realControl.workstations.ready ? [] : realControl.workstations.blockers,
      blockers: realControl.workstations.blockers,
      nextActions: realControl.workstations.nextActions,
    }),
    finalAcceptanceCategory({
      key: 'customer_authorization',
      title: '客户现场授权',
      status: customerAuthorization.status,
      passed: customerAuthorization.ready,
      requiredEvidence: [
        '客户已明确授权真实操作',
        '测试账号和测试设备已确认',
        `${CUSTOMER_AUTHORIZATION_ENV}=1`,
        `${CUSTOMER_AUTHORIZATION_EVIDENCE_HASH_ENV}=客户授权证据哈希`,
        '现场真实动作不涉及未授权账号、支付或客户隐私数据',
      ],
      presentEvidence: [
        ...customerAuthorization.evidence,
        ...customerEnvironment.checks
          .filter((check) => check.key === 'customer_authorization')
          .flatMap((check) => check.evidence),
        ...categoryEvidence('customer_authorization'),
      ],
      missingEvidence: customerAuthorization.ready ? [] : customerAuthorization.warnings,
      blockers: customerAuthorization.status === 'blocked' ? customerAuthorization.warnings : [],
      nextActions: customerAuthorization.nextActions,
    }),
    finalAcceptanceCategory({
      key: 'runtime_guardrails',
      title: '运行安全护栏',
      status: runtimeGuardrailsPassed ? 'ready' : runtimeGuardrailsCheck?.status ?? 'blocked',
      passed: runtimeGuardrailsPassed,
      requiredEvidence: [
        '上线批准前，AGENTHUB_RUNTIME_CONTROL_KILL_SWITCH 已确认不会阻断获批动作。',
        'AGENTHUB_ALLOWED_DESKTOP_TARGETS 已配置为客户批准的桌面目标。',
        'AGENTHUB_ALLOWED_MOBILE_DEVICE_IDS 已配置为客户批准的手机设备。',
        'AGENTHUB_ALLOWED_MOBILE_APP_PACKAGES 已配置为客户批准的手机应用包名。',
        'AGENTHUB_ALLOWED_WORKSTATION_TARGETS 已配置为客户批准的 VM/RDP/VNC 工作站。',
        '客户环境验收报告包含运行护栏证据。',
      ],
      presentEvidence: [
        `${customerEnvironment.emergencyStop.envVar}=${customerEnvironment.emergencyStop.active ? '1' : 'off'}`,
        ...customerEnvironment.runtimeGuards.map(
          (guard) => `${guard.envVar}=${guard.configured ? '已配置' : '缺失'}`,
        ),
        ...(runtimeGuardrailsCheck?.evidence ?? []),
        ...categoryEvidence('runtime_guardrails'),
      ],
      missingEvidence: [
        ...(customerEnvironment.emergencyStop.active
          ? [`${customerEnvironment.emergencyStop.envVar}=1 仍在阻断高风险真实控制。`]
          : []),
        ...customerEnvironment.runtimeGuards
          .filter((guard) => !guard.configured)
          .map((guard) => `${guard.envVar} 尚未配置。`),
        ...(runtimeGuardrailsCheck && runtimeGuardrailsCheck.status !== 'ready'
          ? runtimeGuardrailsCheck.warnings
          : []),
      ],
      blockers: runtimeGuardrailsPassed
        ? []
        : ['运行安全护栏尚未达到客户现场真实控制要求。'],
      nextActions: runtimeGuardrailsPassed
        ? []
        : uniqueNonEmpty([
            ...(runtimeGuardrailsCheck?.nextActions ?? []),
            `客户授权和上线批准都完成前，保持 ${customerEnvironment.emergencyStop.envVar}=1。`,
          ]),
    }),
    finalAcceptanceCategory({
      key: 'hardening',
      title: '生产硬化',
      status: hardening.readinessScore >= 90 && hardening.gaps.length === 0 ? 'ready' : hardening.status,
      passed: hardening.readinessScore >= 90 && hardening.gaps.length === 0,
      requiredEvidence: [
        '生产硬化分数达到 90 分以上',
        '没有硬化缺口',
        '审计日志可写入',
        '运行时控制、审批、资源锁和工作站证据完整',
        '软件命令和真实操作路径已被门控保护',
      ],
      presentEvidence: [
        `硬化分数=${hardening.readinessScore}/100`,
        `硬化缺口=${hardening.gaps.length}`,
        `审计日志=${hardening.counts.auditLogs}`,
        `运行时动作=${hardening.counts.runtimeControlActions}`,
        `资源/工作站校验成功=${hardening.counts.successfulWorkstationValidations}`,
        `软件真实操作命令=${hardening.counts.runtimeMappedSoftwareCommands}`,
        ...categoryEvidence('hardening'),
      ],
      missingEvidence: hardening.gaps,
      blockers: hardening.gaps,
      nextActions: hardening.recommendations,
    }),
    finalAcceptanceCategory({
      key: 'rollback',
      title: '验收包和回退',
      status: rollbackPassed ? 'ready' : latestPackageHash ? 'available' : 'not_configured',
      passed: rollbackPassed,
      requiredEvidence: [
        '现场激活包已导出',
        '客户环境验收包已导出',
        '验证命令可用',
        '回退命令可用',
        '导出内容已脱敏并带 SHA-256 哈希',
        '现场包 manifest、Markdown、PowerShell 脚本完整且 hash 可复算',
      ],
      presentEvidence: [
        `验证命令=${onsiteActivation.validationCommands.length}`,
        `回退命令=${onsiteActivation.rollbackPlan.length}`,
        ...(latestOnsitePackageHash ? [`现场激活包=${latestOnsitePackageHash}`] : []),
        ...(latestCustomerPackageHash ? [`客户环境包=${latestCustomerPackageHash}`] : []),
        `现场激活包完整性=${onsitePackageIntegrityReady ? 'ready' : 'missing'}`,
        `客户环境包完整性=${customerPackageIntegrityReady ? 'ready' : 'missing'}`,
        ...categoryEvidence('rollback'),
      ],
      missingEvidence: [
        ...(latestOnsitePackageHash ? [] : ['还没有导出现场激活包']),
        ...(latestCustomerPackageHash ? [] : ['还没有导出客户环境验收包']),
        ...(onsiteActivation.validationCommands.length === 0 ? ['还没有可执行的验证命令'] : []),
        ...(onsiteActivation.rollbackPlan.length === 0 ? ['还没有可执行的回退命令'] : []),
        ...(onsitePackageIntegrityReady ? [] : ['现场激活包完整性校验未通过']),
        ...(customerPackageIntegrityReady ? [] : ['客户环境包完整性校验未通过']),
      ],
      blockers: [],
      nextActions: [
        ...(latestOnsitePackageHash ? [] : ['点击“导出激活包”，保存现场激活证据。']),
        ...(latestCustomerPackageHash ? [] : ['点击“导出客户环境包”，保存客户环境验收证据。']),
      ],
    }),
  ]
  const categoryChecks: ProductionProbeResult[] = categories.map((category) => ({
    key: `final_acceptance_${category.key}`,
    label: category.title,
    status: category.status,
    evidence: category.presentEvidence,
    warnings: [...category.missingEvidence, ...category.blockers],
    nextActions: category.nextActions,
    checkedAt: Date.now(),
  }))
  const readinessScore = scoreReadiness(categoryChecks)
  const canClaimProductionReady =
    categories.every((category) => category.passed) &&
    realControl.safeToUseLiveControls &&
    liveConnectors.safeToActivateLive &&
    onsiteActivation.safeToActivateLive &&
    customerEnvironment.safeToRunLive
  const blockers = uniqueNonEmpty(categories.flatMap((category) => [...category.missingEvidence, ...category.blockers]))
    .slice(0, 18)
  const nextActions = uniqueNonEmpty(categories.flatMap((category) => category.nextActions)).slice(0, 18)
  const ledger: ProductionFinalAcceptanceLedger = {
    status: canClaimProductionReady ? 'ready' : readinessStatus(readinessScore, categoryChecks),
    readinessScore,
    generatedAt: Date.now(),
    canClaimProductionReady,
    categories,
    summary: {
      total: categories.length,
      passed: categories.filter((category) => category.passed).length,
      needsAction: categories.filter(
        (category) => !category.passed && category.status !== 'blocked' && category.status !== 'not_installed',
      ).length,
      blocked: categories.filter(
        (category) =>
          !category.passed &&
          (category.status === 'blocked' || category.status === 'not_installed' || category.blockers.length > 0),
      ).length,
      evidenceItems: categories.reduce((sum, category) => sum + category.presentEvidence.length, 0),
      requiredEvidenceItems: categories.reduce((sum, category) => sum + category.requiredEvidence.length, 0),
      onsiteEvidenceItems: onsiteEvidenceRecords.length,
      latestPackageHash,
      latestEvidenceHash,
      customerAuthorizationEvidenceHash: customerAuthorization.matchedEvidence?.contentHash ?? null,
      customerAuthorizationEvidenceMatched: customerAuthorization.evidenceMatched,
    },
    evidence: uniqueNonEmpty([
      `模型=${modelCredentials.summary.readyModels}/${modelCredentials.summary.modelProfiles}`,
      `真实控制=${realControl.readinessScore}/100`,
      `现场激活=${onsiteActivation.readinessScore}/100`,
      `客户环境=${customerEnvironment.readinessScore}/100`,
      `硬化=${hardening.readinessScore}/100`,
      latestPackageHash ? `最新验收包=${latestPackageHash}` : '还没有完整现场验收包哈希',
      latestEvidenceHash ? `最新现场证据=${latestEvidenceHash}` : '还没有现场证据记录',
    ]),
    blockers,
    nextActions,
  }
  await recordAuditLog({
    actorType: 'system',
    action: 'production.final_acceptance.ledger',
    resourceType: 'production_integration',
    resourceId: 'final-acceptance',
    riskLevel: 'low',
    message: `Production final acceptance ledger generated with score ${readinessScore}.`,
    metadata: {
      status: ledger.status,
      canClaimProductionReady,
      passed: ledger.summary.passed,
      blockers: blockers.length,
      latestPackageHash,
      latestEvidenceHash,
      customerAuthorizationEvidenceHash: customerAuthorization.matchedEvidence?.contentHash ?? null,
      customerAuthorizationEvidenceMatched: customerAuthorization.evidenceMatched,
      onsiteEvidenceItems: onsiteEvidenceRecords.length,
    },
  })
  return ledger
}

export async function getProductionSetupGuide(): Promise<ProductionSetupGuide> {
  const [readiness, runtimeControl, hardening] = await Promise.all([
    getProductionIntegrationReadiness(),
    getRuntimeControlReadinessReport(),
    getProductionHardeningReport(),
  ])
  const readinessByKey = new Map(readiness.categories.map((category) => [category.key, category]))
  const hardeningByKey = new Map(hardening.checks.map((check) => [check.key, check]))
  const runtimeGateByKey = new Map(runtimeControl.gates.map((gate) => [gate.key, gate]))
  const modelCredentials = readinessByKey.get('model_credentials')
  const desktopRuntime = readinessByKey.get('desktop_automation')
  const mobileRuntime = readinessByKey.get('mobile_automation')
  const workstationProviders = readinessByKey.get('virtual_workstations')
  const modelInvokeSmoke = hardeningByKey.get('model_invocation_smoke')
  const credentialScopes = hardeningByKey.get('credential_scopes')
  const desktopObservation = runtimeGateByKey.get('desktop_observation')
  const desktopControl = runtimeGateByKey.get('desktop_control')
  const desktopCapture = runtimeGateByKey.get('desktop_capture')
  const mobileObservation = runtimeGateByKey.get('mobile_observation')
  const mobileControl = runtimeGateByKey.get('mobile_control')
  const mobileCapture = runtimeGateByKey.get('mobile_capture')
  const workstationValidation = runtimeGateByKey.get('workstation_validation')
  const workstationLaunch = runtimeGateByKey.get('workstation_launch')

  const steps: ProductionSetupGuideStep[] = [
    setupStep({
      key: 'model_credentials',
      title: '真实模型凭证',
      status:
        modelCredentials?.status === 'ready' &&
        hardening.counts.successfulModelCapabilityProbes > 0 &&
        credentialScopes?.status === 'ready'
          ? 'done'
          : modelCredentials?.status === 'blocked' || credentialScopes?.status === 'blocked'
            ? 'blocked'
            : 'needs_action',
      readinessStatus: weakestStatus([modelCredentials?.status, modelInvokeSmoke?.status, credentialScopes?.status]),
      evidence: [
        `${readiness.summary.modelProfilesUsingVault}/${readiness.summary.modelProfiles} 个模型使用密钥库`,
        `${readiness.summary.modelProfilesWithScopedVaultCredentials} 个模型已有凭证作用域`,
        `${hardening.counts.successfulModelCapabilityProbes} 次真实模型推理探测成功`,
      ],
      blockers: [
        ...(readiness.summary.modelProfiles === 0 ? ['还没有模型配置'] : []),
        ...(readiness.summary.modelProfilesUsingVault === 0 ? ['模型尚未绑定密钥库凭证'] : []),
        ...(readiness.summary.modelProfilesWithScopedVaultCredentials < readiness.summary.modelProfilesUsingVault
          ? ['部分模型密钥缺少作用域授权']
          : []),
        ...(hardening.counts.successfulModelCapabilityProbes === 0 ? ['还没有真实模型推理探测证据'] : []),
      ],
      nextActions: [
        ...(modelCredentials?.nextActions ?? []),
        ...(modelInvokeSmoke?.nextActions ?? []),
        ...(credentialScopes?.nextActions ?? []),
      ],
      primaryActionLabel: '去配置模型密钥',
      targetRoute: 'models',
    }),
    setupStep({
      key: 'desktop_runtime',
      title: '真实桌面控制',
      status:
        desktopRuntime?.status === 'not_installed' || desktopRuntime?.status === 'blocked'
          ? 'needs_action'
          : (desktopObservation?.completedActions ?? 0) > 0 &&
              (desktopControl?.liveExecutions ?? 0) > 0 &&
              (desktopCapture?.liveExecutions ?? 0) > 0
            ? 'done'
            : 'needs_action',
      readinessStatus: weakestStatus([desktopRuntime?.status, desktopObservation?.status, desktopControl?.status, desktopCapture?.status]),
      evidence: [
        desktopRuntime?.evidence[0] ?? `平台=${readiness.summary.desktopPlatform}`,
        `${desktopObservation?.completedActions ?? 0} 次桌面观察完成`,
        `${desktopControl?.liveExecutions ?? 0} 次真实桌面点击/输入执行`,
        `${desktopCapture?.liveExecutions ?? 0} 次真实桌面截图执行`,
      ],
      blockers: [
        ...((desktopControl?.envEnabled ?? false) ? [] : ['真实桌面点击/输入门控尚未开启']),
        ...((desktopCapture?.envEnabled ?? false) ? [] : ['真实桌面截图门控尚未开启']),
        ...((desktopControl?.approvedRuntimeControlApprovals ?? 0) > 0 ? [] : ['缺少已批准的桌面控制审批']),
        ...((desktopControl?.liveExecutions ?? 0) > 0 ? [] : ['还没有真实桌面控制执行证据']),
      ],
      nextActions: [
        ...(desktopRuntime?.nextActions ?? []),
        ...(desktopObservation?.nextActions ?? []),
        ...(desktopControl?.nextActions ?? []),
        ...(desktopCapture?.nextActions ?? []),
      ],
      primaryActionLabel: '运行桌面自检',
      targetRoute: 'production',
    }),
    setupStep({
      key: 'mobile_runtime',
      title: '真实手机控制',
      status:
        mobileRuntime?.status === 'not_installed' || mobileRuntime?.status === 'blocked'
          ? 'needs_action'
          : (mobileObservation?.completedActions ?? 0) > 0 &&
              (mobileControl?.liveExecutions ?? 0) > 0 &&
              (mobileCapture?.liveExecutions ?? 0) > 0
            ? 'done'
            : 'needs_action',
      readinessStatus: weakestStatus([mobileRuntime?.status, mobileObservation?.status, mobileControl?.status, mobileCapture?.status]),
      evidence: [
        mobileRuntime?.evidence[0] ?? '手机运行时尚未探测',
        `${mobileObservation?.completedActions ?? 0} 次手机设备发现完成`,
        `${mobileControl?.liveExecutions ?? 0} 次真实手机点击/输入执行`,
        `${mobileCapture?.liveExecutions ?? 0} 次真实手机截图执行`,
      ],
      blockers: [
        ...((mobileControl?.envEnabled ?? false) ? [] : ['真实手机点击/输入门控尚未开启']),
        ...((mobileCapture?.envEnabled ?? false) ? [] : ['真实手机截图门控尚未开启']),
        ...((mobileControl?.approvedRuntimeControlApprovals ?? 0) > 0 ? [] : ['缺少已批准的手机控制审批']),
        ...((mobileControl?.liveExecutions ?? 0) > 0 ? [] : ['还没有真实手机控制执行证据']),
      ],
      nextActions: [
        ...(mobileRuntime?.nextActions ?? []),
        ...(mobileObservation?.nextActions ?? []),
        ...(mobileControl?.nextActions ?? []),
        ...(mobileCapture?.nextActions ?? []),
      ],
      primaryActionLabel: '连接手机设备',
      targetRoute: 'production',
    }),
    setupStep({
      key: 'virtual_workstations',
      title: 'VM/RDP 独立工作站',
      status:
        runtimeControl.summary.readyWorkstations > 0 &&
        runtimeControl.summary.blockedWorkstations === 0 &&
        (workstationValidation?.completedActions ?? 0) > 0 &&
        (workstationLaunch?.liveExecutions ?? 0) > 0
          ? 'done'
          : runtimeControl.summary.readyWorkstations === 0 && runtimeControl.summary.blockedWorkstations > 0
            ? 'blocked'
            : 'needs_action',
      readinessStatus: weakestStatus([workstationProviders?.status, workstationValidation?.status, workstationLaunch?.status]),
      evidence: [
        `${runtimeControl.summary.readyWorkstations} 个工作站可用`,
        `${runtimeControl.summary.blockedWorkstations} 个工作站阻塞`,
        `${workstationValidation?.completedActions ?? 0} 次工作站校验完成`,
        `${workstationLaunch?.liveExecutions ?? 0} 次远程工作站真实启动`,
      ],
      blockers: [
        ...(runtimeControl.summary.readyWorkstations === 0 ? ['还没有可用的 VM/RDP/VNC 工作站'] : []),
        ...(runtimeControl.summary.blockedWorkstations > 0 ? ['存在阻塞的工作站预留'] : []),
        ...((workstationLaunch?.envEnabled ?? false) ? [] : ['远程工作站启动门控尚未开启']),
        ...((workstationLaunch?.liveExecutions ?? 0) > 0 ? [] : ['还没有远程工作站真实启动证据']),
      ],
      nextActions: [
        ...(workstationProviders?.nextActions ?? []),
        ...(workstationValidation?.nextActions ?? []),
        ...(workstationLaunch?.nextActions ?? []),
        ...runtimeControl.workstationChecks.flatMap((workstation) => workstation.nextActions).slice(0, 3),
      ],
      primaryActionLabel: '预留并校验工作站',
      targetRoute: 'production',
    }),
    setupStep({
      key: 'runtime_approvals',
      title: '真实操作审批链路',
      status:
        hardening.counts.approvedRuntimeControlApprovals > 0 &&
        hardening.counts.runtimeControlActions > 0
          ? 'done'
          : hardening.counts.runtimeControlActions > 0
            ? 'needs_action'
            : 'needs_action',
      readinessStatus: weakestStatus([
        hardeningByKey.get('runtime_control_approval_binding')?.status,
        hardeningByKey.get('runtime_control_execution_evidence')?.status,
      ]),
      evidence: [
        `${hardening.counts.runtimeControlApprovals} 条真实操作审批`,
        `${hardening.counts.approvedRuntimeControlApprovals} 条已批准`,
        `${hardening.counts.runtimeControlActions} 条运行时动作审计`,
      ],
      blockers: [
        ...(hardening.counts.approvedRuntimeControlApprovals === 0 ? ['还没有已批准的真实控制审批'] : []),
        ...(hardening.counts.runtimeControlActions === 0 ? ['还没有运行时控制动作审计证据'] : []),
      ],
      nextActions: [
        ...(hardeningByKey.get('runtime_control_approval_binding')?.nextActions ?? []),
        ...(hardeningByKey.get('runtime_control_execution_evidence')?.nextActions ?? []),
      ],
      primaryActionLabel: '检查审批记录',
      targetRoute: 'governance',
    }),
    setupStep({
      key: 'production_hardening',
      title: '生产硬化',
      status:
        hardening.readinessScore >= 85 && hardening.gaps.length === 0
          ? 'done'
          : hardening.status === 'blocked'
            ? 'blocked'
            : 'needs_action',
      readinessStatus: hardening.status,
      evidence: [
        `硬化分数 ${hardening.readinessScore}/100`,
        `${hardening.gaps.length} 个阻塞缺口`,
        `${hardening.warnings.length} 条风险提醒`,
        `${hardening.counts.auditLogs} 条审计日志`,
      ],
      blockers: hardening.gaps.slice(0, 5),
      nextActions: hardening.recommendations.slice(0, 6),
      primaryActionLabel: '运行一键自检',
      targetRoute: 'production',
    }),
  ]
  const summary = {
    done: steps.filter((step) => step.status === 'done').length,
    needsAction: steps.filter((step) => step.status === 'needs_action').length,
    blocked: steps.filter((step) => step.status === 'blocked').length,
    total: steps.length,
    productionReady: steps.every((step) => step.status === 'done'),
  }
  const completionPercent = Math.round(
    steps.reduce((sum, step) => {
      if (step.status === 'done') return sum + 100
      if (step.status === 'needs_action') return sum + 45
      return sum
    }, 0) / steps.length,
  )
  const guide: ProductionSetupGuide = {
    status: summary.productionReady ? 'ready' : summary.blocked > 0 ? 'blocked' : 'available',
    completionPercent,
    generatedAt: Date.now(),
    steps,
    summary,
  }
  await recordAuditLog({
    actorType: 'system',
    action: 'production.setup_guide.generate',
    resourceType: 'production_integration',
    resourceId: 'setup-guide',
    riskLevel: 'low',
    message: `Production setup guide generated with ${completionPercent}% completion.`,
    metadata: {
      status: guide.status,
      completionPercent,
      done: summary.done,
      needsAction: summary.needsAction,
      blocked: summary.blocked,
    },
  })
  return guide
}

export async function getProductionCustomerEnvironmentReport(): Promise<ProductionCustomerEnvironmentReport> {
  const [setupGuide, readiness, runtimeControl, hardening, desktop, mobile, workstations, customerAuthorization] = await Promise.all([
    getProductionSetupGuide(),
    getProductionIntegrationReadiness(),
    getRuntimeControlReadinessReport(),
    getProductionHardeningReport(),
    probeDesktopAutomation({ live: false }),
    discoverMobileAutomation({ live: false }),
    discoverWorkstationProviders({ live: false }),
    getCustomerAuthorizationEvidenceGate(),
  ])
  const dataDir = process.env.AGENTHUB_DATA_DIR ?? path.resolve(process.cwd(), '.agenthub-data')
  const envGates = productionEnvironmentGates()
  const emergencyStop = preflightEmergencyStop()
  const runtimeGuards = [
    preflightRuntimeGuard(
      'model_endpoint_host_allowlist',
      MODEL_ENDPOINT_HOST_ALLOWLIST_ENV,
      '只有客户批准的模型供应商主机可以接收带凭证的真实模型流量。',
      'api.openai.com; api.anthropic.com; generativelanguage.googleapis.com',
    ),
    preflightRuntimeGuard(
      'desktop_target_allowlist',
      'AGENTHUB_ALLOWED_DESKTOP_TARGETS',
      '只有客户批准的桌面目标可以接收真实桌面控制。',
      'Chrome; Customer Test App',
    ),
    preflightRuntimeGuard(
      'mobile_device_allowlist',
      'AGENTHUB_ALLOWED_MOBILE_DEVICE_IDS',
      '只有客户批准的手机设备 ID 可以接收真实手机控制。',
      'emulator-5554; R58N123ABC',
    ),
    preflightRuntimeGuard(
      'mobile_app_package_allowlist',
      'AGENTHUB_ALLOWED_MOBILE_APP_PACKAGES',
      '只有客户批准的应用包名可以接收真实手机点按、输入、滑动或按键动作。',
      'com.customer.app; com.android.chrome',
    ),
    preflightRuntimeGuard(
      'workstation_target_allowlist',
      'AGENTHUB_ALLOWED_WORKSTATION_TARGETS',
      '只有客户批准的 VM/RDP/VNC 工作站 ID 或远程目标可以被真实启动。',
      'aws_123; customer-rdp-host; AgentVM',
    ),
  ]
  const enabledHighRiskGates = envGates.filter((gate) => gate.enabled && gate.riskLevel === 'high')
  const setupCheck = customerCheck({
    key: 'setup_guide',
    label: '上线向导',
    status: setupGuide.summary.productionReady ? 'ready' : setupGuide.summary.blocked > 0 ? 'blocked' : 'available',
    evidence: [
      `上线进度 ${setupGuide.completionPercent}%`,
      `${setupGuide.summary.done}/${setupGuide.summary.total} 个上线步骤完成`,
      `${setupGuide.summary.needsAction} 个步骤待处理`,
      `${setupGuide.summary.blocked} 个步骤阻塞`,
    ],
    warnings: setupGuide.summary.productionReady ? [] : ['上线向导仍有未完成步骤。'],
    nextActions: setupGuide.steps
      .filter((step) => step.status !== 'done')
      .flatMap((step) => step.nextActions.length ? step.nextActions : [step.primaryActionLabel]),
  })
  const gateCheck = customerCheck({
    key: 'high_risk_env_gates',
    label: '真实控制环境开关',
    status:
      enabledHighRiskGates.length === envGates.filter((gate) => gate.riskLevel === 'high').length
        ? 'ready'
        : enabledHighRiskGates.length > 0
          ? 'available'
          : 'not_configured',
    evidence: envGates.map((gate) => `${gate.envVar}=${gate.enabled ? '1' : 'off'}`),
    warnings:
      enabledHighRiskGates.length === 0
        ? ['高风险真实控制开关全部关闭，点击、输入、手机控制和远程启动不会真实执行。']
        : [],
    nextActions: envGates
      .filter((gate) => !gate.enabled)
      .map((gate) => `客户授权后，按需设置 ${gate.envVar}=1。`),
  })
  const runtimeGuardCheck = customerCheck({
    key: 'runtime_guardrails',
    label: '运行安全护栏',
    status:
      !emergencyStop.active && runtimeGuards.every((guard) => guard.configured)
        ? 'ready'
        : 'blocked',
    evidence: [
      `${emergencyStop.envVar}=${emergencyStop.active ? '1' : 'off'}`,
      ...runtimeGuards.map((guard) => `${guard.envVar}=${guard.configured ? '已配置' : '缺失'}`),
    ],
    warnings: [
      ...(emergencyStop.active ? [`${emergencyStop.envVar}=1 正在阻断所有高风险真实运行控制。`] : []),
      ...runtimeGuards
        .filter((guard) => !guard.configured)
        .map((guard) => `${guard.envVar} 必须先配置，才能进入客户现场真实运行控制。`),
    ],
    nextActions: [
      ...(emergencyStop.active ? [`只有在客户授权和上线批准完成后，才能把 ${emergencyStop.envVar} 设为 0。`] : []),
      ...runtimeGuards
        .filter((guard) => !guard.configured)
        .map((guard) => `配置 ${guard.envVar}：${guard.valueHint}`),
    ],
  })
  const liveEvidenceCheck = customerCheck({
    key: 'live_execution_evidence',
    label: '真实执行证据',
    status:
      runtimeControl.gates.every((gate) => gate.readOnly || gate.liveExecutions > 0)
        ? 'ready'
        : runtimeControl.gates.some((gate) => !gate.readOnly && gate.liveExecutions > 0)
          ? 'available'
          : 'not_configured',
    evidence: runtimeControl.gates.map(
      (gate) => `${gate.label}: ${gate.liveExecutions} 次真实执行 / ${gate.completedActions} 次完成`,
    ),
    warnings:
      runtimeControl.gates.some((gate) => !gate.readOnly && gate.liveExecutions === 0)
        ? ['部分高风险能力还没有真实执行证据。']
        : [],
    nextActions: runtimeControl.gates
      .filter((gate) => !gate.readOnly && gate.liveExecutions === 0)
      .flatMap((gate) => gate.nextActions),
  })
  const workstationCheck = customerCheck({
    key: 'customer_workstations',
    label: '客户工作站',
    status:
      runtimeControl.summary.readyWorkstations > 0 && runtimeControl.summary.blockedWorkstations === 0
        ? 'ready'
        : runtimeControl.summary.readyWorkstations > 0
          ? 'available'
          : runtimeControl.summary.blockedWorkstations > 0
            ? 'blocked'
            : 'not_configured',
    evidence: [
      `${runtimeControl.summary.readyWorkstations} 个工作站可用`,
      `${runtimeControl.summary.blockedWorkstations} 个工作站阻塞`,
      `${workstations.providers.filter((provider) => provider.available).length}/${workstations.providers.length} 个工作站提供方可用`,
    ],
    warnings:
      runtimeControl.summary.blockedWorkstations > 0
        ? ['存在不可用的客户工作站配置。']
        : [],
    nextActions: [
      ...workstations.nextActions,
      ...runtimeControl.workstationChecks.flatMap((workstation) => workstation.nextActions),
    ],
  })
  const hardeningCheck = customerCheck({
    key: 'customer_hardening',
    label: '客户环境硬化',
    status: hardening.readinessScore >= 90 && hardening.gaps.length === 0 ? 'ready' : hardening.status,
    evidence: [
      `硬化分数 ${hardening.readinessScore}/100`,
      `${hardening.gaps.length} 个硬化缺口`,
      `${hardening.counts.auditLogs} 条审计日志`,
      `dataDir=${dataDir}`,
    ],
    warnings: hardening.warnings.slice(0, 8),
    nextActions: hardening.recommendations,
  })
  const toolchainCheck = customerCheck({
    key: 'customer_toolchain',
    label: '客户机器工具链',
    status:
      desktop.canObserveWindows && workstations.providers.some((provider) => provider.available)
        ? mobile.status === 'not_installed'
          ? 'available'
          : 'ready'
        : 'not_installed',
    evidence: [
      `桌面观察=${desktop.canObserveWindows ? '可用' : '不可用'}`,
      `桌面控制=${desktop.canControlPhysicalDesktop ? '可用' : '不可用'}`,
      `adb=${mobile.adb.available ? '可用' : '不可用'}`,
      `appium=${mobile.appium.available ? '可用' : '不可用'}`,
    ],
    warnings: [
      ...desktop.warnings,
      ...mobile.warnings,
      ...workstations.warnings,
    ],
    nextActions: [
      ...desktop.nextActions,
      ...mobile.nextActions,
      ...workstations.nextActions,
    ],
  })
  const authorizationCheck = customerCheck({
    key: 'customer_authorization',
    label: '客户授权确认',
    status: customerAuthorization.status,
    evidence: customerAuthorization.evidence,
    warnings: customerAuthorization.warnings,
    nextActions: customerAuthorization.nextActions,
  })

  const checks = [
    setupCheck,
    authorizationCheck,
    gateCheck,
    runtimeGuardCheck,
    liveEvidenceCheck,
    workstationCheck,
    hardeningCheck,
    toolchainCheck,
  ]
  const readinessScore = scoreReadiness(checks)
  const blockers = checks
    .filter((check) => check.status === 'blocked' || check.status === 'not_installed')
    .flatMap((check) => [check.label, ...check.warnings])
  const nextActions = uniqueNonEmpty(checks.flatMap((check) => check.nextActions)).slice(0, 12)
  const safeToRunLive =
    setupGuide.summary.productionReady &&
    authorizationCheck.status === 'ready' &&
    runtimeGuardCheck.status === 'ready' &&
    hardening.readinessScore >= 90 &&
    checks.every((check) => check.status === 'ready' || check.status === 'available') &&
    runtimeControl.summary.blockedWorkstations === 0
  const report: ProductionCustomerEnvironmentReport = {
    status: safeToRunLive ? 'ready' : readinessStatus(readinessScore, checks),
    readinessScore,
    generatedAt: Date.now(),
    safeToRunLive,
    host: {
      platform: process.platform,
      arch: process.arch,
      node: process.version,
      electronMode: process.versions.electron
        ? process.env.AGENTHUB_DEV === '1'
          ? 'dev'
          : 'packaged'
        : 'node',
      dataDir,
    },
    setupGuide: {
      completionPercent: setupGuide.completionPercent,
      productionReady: setupGuide.summary.productionReady,
      done: setupGuide.summary.done,
      needsAction: setupGuide.summary.needsAction,
      blocked: setupGuide.summary.blocked,
      total: setupGuide.summary.total,
    },
    envGates,
    runtimeGuards,
    emergencyStop,
    customerAuthorization: {
      switchEnabled: customerAuthorization.switchEnabled,
      evidenceHash: customerAuthorization.evidenceHash,
      evidenceHashPresent: customerAuthorization.evidenceHashPresent,
      evidenceMatched: customerAuthorization.evidenceMatched,
      matchedEvidenceId: customerAuthorization.matchedEvidence?.id ?? null,
      matchedEvidenceTitle: customerAuthorization.matchedEvidence?.title ?? null,
      matchedEvidenceAt: customerAuthorization.matchedEvidence?.verifiedAt ?? null,
    },
    checks,
    evidence: uniqueNonEmpty([
      `模型=${readiness.summary.modelProfiles}`,
      `真实模型推理探测=${hardening.counts.successfulModelCapabilityProbes}`,
      `运行时动作=${runtimeControl.summary.runtimeControlActions}`,
      `可用工作站=${runtimeControl.summary.readyWorkstations}`,
      `硬化分数=${hardening.readinessScore}`,
      `上线向导=${setupGuide.completionPercent}%`,
      `${CUSTOMER_AUTHORIZATION_EVIDENCE_HASH_ENV}=${
        customerAuthorization.evidenceMatched ? 'matched' : 'missing_or_unmatched'
      }`,
    ]),
    blockers: uniqueNonEmpty(blockers).slice(0, 12),
    nextActions,
  }
  await recordAuditLog({
    actorType: 'system',
    action: 'production.customer_environment.report',
    resourceType: 'production_integration',
    resourceId: 'customer-environment',
    riskLevel: 'low',
    message: `Customer environment report generated with score ${readinessScore}.`,
    metadata: {
      status: report.status,
      safeToRunLive,
      readinessScore,
      blockedChecks: checks.filter((check) => check.status === 'blocked').length,
    },
  })
  return report
}

export async function createProductionCustomerEnvironmentPackage(): Promise<ProductionCustomerEnvironmentPackage> {
  const report = await getProductionCustomerEnvironmentReport()
  const generatedAt = Date.now()
  const id = `pce_${generatedAt}_${Math.random().toString(36).slice(2, 8)}`
  const exportRoot = path.join(report.host.dataDir, 'production-customer-environment', id)
  mkdirSync(exportRoot, { recursive: true })
  const manifestFileName = `${id}.json`
  const markdownFileName = `${id}.md`
  const preflightScriptFileName = `${id}-preflight.ps1`
  const rollbackScriptFileName = `${id}-rollback.ps1`
  const manifestPath = path.join(exportRoot, manifestFileName)
  const markdownPath = path.join(exportRoot, markdownFileName)
  const preflightScriptPath = path.join(exportRoot, preflightScriptFileName)
  const rollbackScriptPath = path.join(exportRoot, rollbackScriptFileName)
  const markdown = renderCustomerEnvironmentMarkdown(id, report)
  const preflightScript = renderCustomerEnvironmentPreflightScript(id, report)
  const rollbackScript = renderCustomerEnvironmentRollbackScript(id, report)
  const manifest = {
    schema: 'agenthub.production_customer_environment.v1',
    id,
    generatedAt,
    redacted: true,
    report,
    files: {
      manifestFileName,
      markdownFileName,
      preflightScriptFileName,
      rollbackScriptFileName,
    },
    scriptHashes: {
      preflightScript: `sha256:${sha256(preflightScript)}`,
      rollbackScript: `sha256:${sha256(rollbackScript)}`,
    },
  }
  const manifestJson = `${stableStringify(manifest)}\n`
  const contentHash = `sha256:${sha256(`${manifestJson}\n${markdown}\n${preflightScript}\n${rollbackScript}`)}`
  const packageDocument = {
    ...manifest,
    contentHash,
    safetyNotice:
      'This package is redacted. It contains readiness evidence, environment gate names, and local paths, but no API keys, passwords, cookies, or remote desktop credentials.',
  }
  await Promise.all([
    writeFile(manifestPath, `${stableStringify(packageDocument)}\n`, 'utf8'),
    writeFile(markdownPath, markdown, 'utf8'),
    writeFile(preflightScriptPath, preflightScript, 'utf8'),
    writeFile(rollbackScriptPath, rollbackScript, 'utf8'),
  ])
  const pkg: ProductionCustomerEnvironmentPackage = {
    id,
    generatedAt,
    redacted: true,
    contentHash,
    report,
    files: {
      manifestPath,
      markdownPath,
      preflightScriptPath,
      rollbackScriptPath,
      manifestFileName,
      markdownFileName,
      preflightScriptFileName,
      rollbackScriptFileName,
    },
    summary: {
      status: report.status,
      readinessScore: report.readinessScore,
      safeToRunLive: report.safeToRunLive,
      blockers: report.blockers.length,
      nextActions: report.nextActions.length,
    },
  }
  await recordAuditLog({
    actorType: 'system',
    action: 'production.customer_environment.package',
    resourceType: 'production_integration',
    resourceId: id,
    riskLevel: 'low',
    message: `Customer environment package ${id} generated.`,
    metadata: {
      contentHash,
      manifestPath,
      markdownPath,
      preflightScriptPath,
      rollbackScriptPath,
      safeToRunLive: report.safeToRunLive,
      readinessScore: report.readinessScore,
    },
  })
  return pkg
}

export async function getProductionPackageIntegrityReport(): Promise<ProductionPackageIntegrityReport> {
  const auditLogs = await db.query.auditLogs.findMany({
    orderBy: [desc(schema.auditLogs.createdAt)],
    limit: PRODUCTION_AUDIT_LOOKBACK_LIMIT,
  })
  const packageLogs = auditLogs
    .filter(
      (log) =>
        log.action === 'production.onsite_activation.package' ||
        log.action === 'production.customer_environment.package',
    )
    .slice(0, 24)
  const packages = await Promise.all(packageLogs.map(verifyProductionPackageIntegrity))
  const checks = packages.map((item): ProductionProbeResult => ({
    key: `package_integrity_${item.kind}_${item.id}`,
    label: `${productionPackageKindLabel(item.kind)} package integrity`,
    status: item.status,
    evidence: item.evidence,
    warnings: item.warnings,
    nextActions: item.nextActions,
    checkedAt: Date.now(),
  }))
  const readinessScore = packages.length === 0 ? 0 : scoreReadiness(checks)
  const readyPackages = packages.filter((item) => item.status === 'ready').length
  const blockedPackages = packages.filter((item) => item.status === 'blocked').length
  const report: ProductionPackageIntegrityReport = {
    status: packages.length === 0 ? 'not_configured' : readinessStatus(readinessScore, checks),
    readinessScore,
    generatedAt: Date.now(),
    summary: {
      totalPackages: packages.length,
      readyPackages,
      blockedPackages,
      onsiteActivationPackages: packages.filter((item) => item.kind === 'onsite_activation').length,
      customerEnvironmentPackages: packages.filter((item) => item.kind === 'customer_environment').length,
      latestReadyPackageHash: packages.find((item) => item.status === 'ready')?.contentHash ?? null,
    },
    packages,
    checks,
    blockers: uniqueNonEmpty(packages.flatMap((item) => item.warnings)).slice(0, 12),
    nextActions: uniqueNonEmpty([
      ...(packages.length === 0
        ? ['Export onsite activation and customer environment packages before customer handoff.']
        : []),
      ...packages.flatMap((item) => item.nextActions),
    ]).slice(0, 12),
  }
  return report
}

async function verifyProductionPackageIntegrity(log: {
  action: string
  resourceId: string | null
  metadata: JsonObject
  createdAt: Date | number
}): Promise<ProductionPackageIntegrityItem> {
  const kind: ProductionPackageIntegrityKind =
    log.action === 'production.onsite_activation.package' ? 'onsite_activation' : 'customer_environment'
  const metadata = log.metadata as Record<string, unknown>
  const dataDir = process.env.AGENTHUB_DATA_DIR ?? path.resolve(process.cwd(), '.agenthub-data')
  const manifestPath = packagePathValue(metadata.manifestPath, dataDir)
  let manifestText: string | null = null
  let manifestDocument: Record<string, unknown> | null = null
  const warnings: string[] = []
  const nextActions: string[] = []
  if (!manifestPath) {
    warnings.push('Package manifest path is missing or outside AGENTHUB_DATA_DIR.')
    nextActions.push('Regenerate the package so manifest and script paths are recorded in the audit log.')
  } else {
    manifestText = await readPackageFile(manifestPath, warnings)
    if (manifestText) {
      try {
        manifestDocument = JSON.parse(manifestText) as Record<string, unknown>
      } catch {
        warnings.push('Package manifest is not valid JSON.')
      }
    }
  }
  const manifestFiles = readManifestFiles(manifestDocument)
  const markdownPath =
    packagePathValue(metadata.markdownPath, dataDir) ??
    siblingPackagePath(manifestPath, stringField(manifestFiles.markdownFileName), dataDir)
  const scriptPaths = scriptPathsForPackage({
    kind,
    metadata,
    manifestPath,
    manifestFiles,
    dataDir,
  })
  const requiredPaths = [manifestPath, markdownPath, ...scriptPaths]
  const missingPaths = requiredPaths.filter((value): value is string => !value || !existsSync(value))
  const markdownText = markdownPath ? await readPackageFile(markdownPath, warnings) : null
  const scriptTexts = await Promise.all(scriptPaths.map((scriptPath) => readPackageFile(scriptPath, warnings)))
  const contentHash = stringField(manifestDocument?.contentHash) ?? stringField(metadata.contentHash)
  const expectedContentHash =
    manifestDocument && manifestText && markdownText && scriptTexts.every((text): text is string => Boolean(text))
      ? expectedPackageContentHash(kind, manifestDocument, markdownText, scriptTexts as string[])
      : null
  const contentHashMatches = Boolean(contentHash && expectedContentHash && contentHash === expectedContentHash)
  const manifestSchemaMatches = manifestDocument?.schema === expectedPackageSchema(kind)
  const scriptHashesMatch =
    manifestDocument && scriptTexts.every((text): text is string => Boolean(text))
      ? packageScriptHashesMatch(kind, manifestDocument, scriptTexts as string[])
      : false
  const sensitiveHits = uniqueNonEmpty(
    [manifestText, markdownText, ...scriptTexts]
      .filter((value): value is string => Boolean(value))
      .flatMap((value) => detectSensitiveOnsiteEvidence(value)),
  )
  const redacted = manifestDocument?.redacted === true && sensitiveHits.length === 0
  const filesPresent = requiredPaths.length >= 4 && missingPaths.length === 0
  const ready =
    filesPresent &&
    Boolean(manifestDocument) &&
    Boolean(manifestText) &&
    Boolean(markdownText) &&
    manifestSchemaMatches &&
    contentHashMatches &&
    scriptHashesMatch &&
    redacted
  if (!filesPresent) {
    warnings.push('Package files are incomplete or missing from disk.')
    nextActions.push('Regenerate the package and keep the manifest, markdown, and PowerShell scripts together.')
  }
  if (manifestDocument && !manifestSchemaMatches) warnings.push('Package manifest schema does not match package type.')
  if (manifestDocument && !contentHashMatches) warnings.push('Package content hash does not match manifest + markdown + script content.')
  if (manifestDocument && !scriptHashesMatch) warnings.push('Package script hashes do not match the generated scripts.')
  if (!redacted) warnings.push('Package redaction check failed or sensitive-looking content was detected.')
  return {
    id: stringField(manifestDocument?.id) ?? log.resourceId ?? 'unknown-package',
    kind,
    status: ready ? 'ready' : 'blocked',
    generatedAt: numberField(manifestDocument?.generatedAt) ?? dateLikeToMs(log.createdAt),
    contentHash,
    expectedContentHash,
    contentHashMatches,
    manifestPath,
    markdownPath,
    scriptPaths,
    filesPresent,
    manifestReadable: Boolean(manifestText && manifestDocument),
    manifestSchemaMatches,
    scriptHashesMatch,
    redacted,
    sensitiveHits,
    evidence: uniqueNonEmpty([
      `package=${log.resourceId ?? 'unknown-package'}`,
      `kind=${kind}`,
      contentHash ? `contentHash=${contentHash}` : 'contentHash=missing',
      expectedContentHash ? `expectedHash=${expectedContentHash}` : 'expectedHash=unavailable',
      `files=${requiredPaths.length - missingPaths.length}/${requiredPaths.length}`,
      `scriptHashes=${scriptHashesMatch ? 'ok' : 'failed'}`,
      `redacted=${redacted ? 'yes' : 'no'}`,
    ]),
    warnings: uniqueNonEmpty(warnings),
    nextActions: uniqueNonEmpty(
      nextActions.length > 0 ? nextActions : ready ? [] : ['Regenerate the package and verify it again before customer handoff.'],
    ),
  }
}

export async function getProductionHardeningReport(): Promise<ProductionHardeningReport> {
  const [
    models,
    tests,
    secrets,
    scopes,
    workstations,
    sessions,
    softwareCommands,
    softwareCommandRuns,
    approvalRequests,
    computerActionEvents,
    resourceLocks,
    auditLogs,
  ] = await Promise.all([
    db.query.modelProfiles.findMany(),
    db.query.modelConnectionTests.findMany({ orderBy: [desc(schema.modelConnectionTests.createdAt)], limit: 500 }),
    db.query.secretVault.findMany(),
    db.query.credentialScopes.findMany(),
    db.query.agentWorkstations.findMany(),
    db.query.computerSessions.findMany({ orderBy: [desc(schema.computerSessions.createdAt)], limit: 500 }),
    db.query.softwareCommands.findMany(),
    db.query.softwareCommandRuns.findMany({ orderBy: [desc(schema.softwareCommandRuns.createdAt)], limit: 500 }),
    db.query.approvalRequests.findMany({ orderBy: [desc(schema.approvalRequests.createdAt)], limit: 500 }),
    db.query.computerActionEvents.findMany({ orderBy: [desc(schema.computerActionEvents.createdAt)], limit: 500 }),
    db.query.resourceLocks.findMany(),
    db.query.auditLogs.findMany({ orderBy: [desc(schema.auditLogs.createdAt)], limit: 500 }),
  ])
  const dataDir = process.env.AGENTHUB_DATA_DIR ?? path.resolve(process.cwd(), '.agenthub-data')
  const runtimeMappedSoftwareCommands = softwareCommands.filter((command) =>
    isRuntimeControlSoftwareImplementation(command.implementation),
  )
  const capabilityProbes = tests.filter(isModelCapabilityProbe)
  const successfulCapabilityProbes = capabilityProbes.filter((test) => test.mode === 'live' && test.status === 'ok')
  const modelGatewayAuditLogs = auditLogs.filter(
    (log) => log.action === 'model.connect.live' || log.action === 'model.invoke.live',
  )
  const modelGatewayInvokeAuditLogs = auditLogs.filter((log) => log.action === 'model.invoke.live')
  const runtimeControlApprovals = approvalRequests.filter((approval) => approval.type === 'runtime_control_action')
  const approvedRuntimeControlApprovals = runtimeControlApprovals.filter((approval) => approval.status === 'approved')
  const approvalBoundRuntimeControlApprovals = approvedRuntimeControlApprovals.filter(hasRuntimeControlApprovalBinding)
  const softwareCommandApprovals = approvalRequests.filter((approval) => approval.type === 'software_command_execute')
  const approvedSoftwareCommandApprovals = softwareCommandApprovals.filter((approval) => approval.status === 'approved')
  const approvalBoundSoftwareCommandApprovals = softwareCommandApprovals.filter(hasSoftwareCommandApprovalBinding)
  const runtimeApprovalBoundSoftwareCommandApprovals = softwareCommandApprovals.filter(
    hasSoftwareCommandRuntimeApprovalInputBinding,
  )
  const runtimeControlActions = computerActionEvents.filter((event) => event.actionType.startsWith('runtime_control.'))
  const completedRuntimeControlActions = runtimeControlActions.filter((event) => event.status === 'complete')
  const blockedRuntimeControlActions = runtimeControlActions.filter((event) => event.status === 'blocked')
  const runtimeControlKillSwitchActions = runtimeControlActions.filter(
    (event) => runtimeControlOutputGate(event)?.runtimeControlKillSwitchActive === true && event.status === 'blocked',
  )
  const desktopTargetAllowlistActions = runtimeControlActions.filter(
    (event) => runtimeControlOutputGate(event)?.desktopTargetAllowlistRequired === true,
  )
  const desktopTargetAllowlistBlockedActions = desktopTargetAllowlistActions.filter(
    (event) => runtimeControlOutputGate(event)?.desktopTargetAllowed === false,
  )
  const desktopTargetAllowlistPassedActions = desktopTargetAllowlistActions.filter(
    (event) => runtimeControlOutputGate(event)?.desktopTargetAllowed === true,
  )
  const desktopInputActions = runtimeControlActions.filter(
    (event) =>
      event.actionType === 'runtime_control.desktop.type_text' ||
      event.actionType === 'runtime_control.desktop.key_press',
  )
  const desktopInputFocusBoundActions = desktopInputActions.filter(hasDesktopInputFocusBinding)
  const desktopInputFocusMissingActions = desktopInputActions.filter((event) => !hasDesktopInputFocusBinding(event))
  const desktopPointerActions = runtimeControlActions.filter(
    (event) =>
      event.actionType === 'runtime_control.desktop.click' ||
      event.actionType === 'runtime_control.desktop.scroll',
  )
  const desktopPointerFocusBoundActions = desktopPointerActions.filter(hasDesktopInputFocusBinding)
  const desktopPointerFocusMissingActions = desktopPointerActions.filter((event) => !hasDesktopInputFocusBinding(event))
  const workstationValidations = runtimeControlActions.filter(
    (event) => event.actionType === 'runtime_control.workstation.validate_workstation',
  )
  const successfulWorkstationValidations = workstationValidations.filter((event) => event.status === 'complete')
  const blockedWorkstationValidations = workstationValidations.filter((event) => event.status === 'blocked')
  const workstationReleaseActions = runtimeControlActions.filter(
    (event) => event.actionType === 'runtime_control.workstation.release_workstation',
  )
  const mobileScreenshotActions = runtimeControlActions.filter(
    (event) => event.actionType === 'runtime_control.mobile.mobile_screenshot',
  )
  const mobileDeviceAllowlistActions = runtimeControlActions.filter(
    (event) => runtimeControlOutputGate(event)?.mobileDeviceAllowlistRequired === true,
  )
  const mobileDeviceAllowlistBlockedActions = mobileDeviceAllowlistActions.filter(
    (event) => runtimeControlOutputGate(event)?.mobileDeviceAllowed === false,
  )
  const mobileDeviceAllowlistPassedActions = mobileDeviceAllowlistActions.filter(
    (event) => runtimeControlOutputGate(event)?.mobileDeviceAllowed === true,
  )
  const mobileAppAllowlistActions = runtimeControlActions.filter(
    (event) => runtimeControlOutputGate(event)?.mobileAppAllowlistRequired === true,
  )
  const mobileAppAllowlistBlockedActions = mobileAppAllowlistActions.filter(
    (event) => runtimeControlOutputGate(event)?.mobileAppAllowed === false,
  )
  const mobileAppAllowlistPassedActions = mobileAppAllowlistActions.filter(
    (event) => runtimeControlOutputGate(event)?.mobileAppAllowed === true,
  )
  const workstationTargetAllowlistActions = runtimeControlActions.filter(
    (event) => runtimeControlOutputGate(event)?.workstationTargetAllowlistRequired === true,
  )
  const workstationTargetAllowlistBlockedActions = workstationTargetAllowlistActions.filter(
    (event) => runtimeControlOutputGate(event)?.workstationTargetAllowed === false,
  )
  const workstationTargetAllowlistPassedActions = workstationTargetAllowlistActions.filter(
    (event) => runtimeControlOutputGate(event)?.workstationTargetAllowed === true,
  )
  const runtimeFileOutputActions = runtimeControlActions.filter(hasRuntimeFileOutputEvidence)
  const redactedRuntimeFileOutputActions = runtimeFileOutputActions.filter(isRuntimeFileOutputRedacted)
  const unredactedRuntimeFileOutputActions = runtimeFileOutputActions.filter(
    (event) => !isRuntimeFileOutputRedacted(event),
  )
  const workstationRecovery = buildWorkstationLeaseRecoveryReport({
    workstations,
    sessions,
    resourceLocks,
    maxBusyAgeMs: DEFAULT_STALE_BUSY_WORKSTATION_MS,
    now: Date.now(),
    recoveredIds: [],
    applied: false,
  })
  const packageIntegrity = await getProductionPackageIntegrityReport()
  const checks: ProductionProbeResult[] = [
    vaultMasterKeyCheck(),
    {
      key: 'model_live_tests',
      label: '真实模型连接测试',
      status: tests.some((test) => test.mode === 'live' && test.status === 'ok') ? 'ready' : 'not_configured',
      evidence: [`已记录 ${tests.filter((test) => test.mode === 'live').length} 次真实模型测试`],
      warnings: tests.some((test) => test.mode === 'live' && test.status === 'ok')
        ? []
        : ['还没有成功的真实模型连接测试记录。'],
      nextActions: ['配置生产凭证后，运行真实连接测试。'],
      checkedAt: Date.now(),
    },
    {
      key: 'model_invocation_smoke',
      label: '真实模型推理探测',
      status: successfulCapabilityProbes.length > 0 ? 'ready' : 'not_configured',
      evidence: [
        `已记录 ${capabilityProbes.length} 次模型能力探测`,
        `${successfulCapabilityProbes.length} 次真实模型能力探测成功`,
      ],
      warnings:
        successfulCapabilityProbes.length > 0
          ? []
          : ['还没有成功的真实模型推理探测记录；仅证明 endpoint 可达不能证明智能体真的能推理。'],
      nextActions:
        successfulCapabilityProbes.length > 0
          ? []
          : ['配置凭证后，在 AGENTHUB_ENABLE_REAL_MODEL_INVOCATION=1 的条件下对生产模型运行一次 Invoke。'],
      checkedAt: Date.now(),
    },
    {
      key: 'model_gateway_audit',
      label: 'Model gateway audit',
      status: modelGatewayAuditLogs.length > 0 ? 'ready' : 'not_configured',
      evidence: [
        `${modelGatewayAuditLogs.length} model gateway live audit logs recorded`,
        `${modelGatewayInvokeAuditLogs.length} model invoke audit logs recorded`,
      ],
      warnings:
        modelGatewayAuditLogs.length > 0
          ? []
          : ['No audited model gateway live call is recorded; production model access should leave redacted audit evidence.'],
      nextActions:
        modelGatewayAuditLogs.length > 0
          ? []
          : ['Run a live model connection test or capability probe through Model Gateway to create redacted audit evidence.'],
      checkedAt: Date.now(),
    },
    {
      key: 'credential_scopes',
      label: 'Credential scoping',
      status: scopes.length > 0 ? 'ready' : 'not_configured',
      evidence: [`${secrets.length} secrets`, `${scopes.length} credential scopes`],
      warnings: scopes.length === 0 && secrets.length > 0 ? ['Secrets exist but are not scoped to resources.'] : [],
      nextActions: scopes.length === 0 ? ['Create credential scopes for model profiles, CLIs, and tools.'] : [],
      checkedAt: Date.now(),
    },
    {
      key: 'workstation_isolation',
      label: 'Workstation isolation',
      status: workstations.length > 0 ? 'ready' : 'not_configured',
      evidence: [`${workstations.length} agent workstations registered`, `${sessions.length} computer sessions recorded`],
      warnings: workstations.length === 0 ? ['No VM/RDP/VNC workstation reservation has been registered.'] : [],
      nextActions: workstations.length === 0 ? ['Reserve isolated workstations for Agents that need desktop control.'] : [],
      checkedAt: Date.now(),
    },
    {
      key: 'workstation_stale_busy_recovery',
      label: 'Stale workstation recovery',
      status:
        workstationRecovery.summary.staleBusyWorkstations === 0
          ? 'ready'
          : workstationRecovery.summary.recoverableWorkstations > 0
            ? 'blocked'
            : 'blocked',
      evidence: [
        `${workstationRecovery.summary.busyWorkstations} busy workstations`,
        `${workstationRecovery.summary.staleBusyWorkstations} stale busy workstations`,
        `${workstationRecovery.summary.recoverableWorkstations} recoverable stale workstations`,
      ],
      warnings: workstationRecovery.warnings,
      nextActions: workstationRecovery.nextActions,
      checkedAt: Date.now(),
    },
    runtimeControlGateCheck(),
    {
      key: 'runtime_control_kill_switch',
      label: 'Runtime control kill switch',
      status: runtimeControlKillSwitchActions.length > 0 ? 'ready' : 'available',
      evidence: [
        `${runtimeControlKillSwitchActions.length} runtime-control actions blocked by global kill switch`,
        'AGENTHUB_RUNTIME_CONTROL_KILL_SWITCH=1 blocks high-risk live control before env, approval, or go-live execution.',
      ],
      warnings: [],
      nextActions:
        runtimeControlKillSwitchActions.length > 0
          ? []
          : ['Exercise AGENTHUB_RUNTIME_CONTROL_KILL_SWITCH=1 once in staging to prove emergency stop behavior is audited.'],
      checkedAt: Date.now(),
    },
    {
      key: 'desktop_target_allowlist_gate',
      label: 'Desktop target allowlist gate',
      status:
        desktopTargetAllowlistActions.length === 0
          ? 'not_configured'
          : desktopTargetAllowlistBlockedActions.length > 0 && desktopTargetAllowlistPassedActions.length > 0
            ? 'ready'
            : 'available',
      evidence: [
        `${desktopTargetAllowlistActions.length} desktop allowlist-gated runtime actions`,
        `${desktopTargetAllowlistBlockedActions.length} blocked by target allowlist`,
        `${desktopTargetAllowlistPassedActions.length} passed target allowlist`,
      ],
      warnings:
        desktopTargetAllowlistActions.length === 0
          ? ['No live desktop runtime-control action has exercised the target allowlist gate.']
          : [],
      nextActions:
        desktopTargetAllowlistActions.length === 0
          ? ['Before production desktop automation, run one blocked and one allowlisted test-window action with AGENTHUB_ALLOWED_DESKTOP_TARGETS configured.']
          : desktopTargetAllowlistPassedActions.length === 0
            ? ['Run a low-risk action against an allowlisted test window or process to prove approved desktop targets can pass the target gate.']
            : [],
      checkedAt: Date.now(),
    },
    {
      key: 'desktop_input_focus_binding',
      label: 'Desktop input focus binding',
      status: desktopInputFocusBoundActions.length > 0 ? 'ready' : 'not_configured',
      evidence: [
        `${desktopInputActions.length} desktop text/key runtime actions recorded`,
        `${desktopInputFocusBoundActions.length} actions include focus-target binding evidence`,
        `${desktopInputFocusMissingActions.length} older actions are missing focus-target binding evidence`,
      ],
      warnings:
        desktopInputFocusBoundActions.length === 0
          ? ['No desktop text/key runtime action has recorded focus-target binding metadata yet.']
          : desktopInputFocusMissingActions.length > 0
            ? ['Some older desktop text/key actions do not include focus-target binding evidence.']
            : [],
      nextActions:
        desktopInputFocusBoundActions.length === 0
          ? ['Run one desktop type_text/key_press dry-run with target/titleContains/processName so approval evidence binds the focus target.']
          : desktopInputFocusMissingActions.length > 0
            ? ['Regenerate old desktop text/key evidence before using it for production acceptance.']
            : [],
      checkedAt: Date.now(),
    },
    {
      key: 'desktop_pointer_focus_binding',
      label: 'Desktop pointer focus binding',
      status: desktopPointerFocusBoundActions.length > 0 ? 'ready' : 'not_configured',
      evidence: [
        `${desktopPointerActions.length} desktop click/scroll runtime actions recorded`,
        `${desktopPointerFocusBoundActions.length} actions include focus-target binding evidence`,
        `${desktopPointerFocusMissingActions.length} older actions are missing focus-target binding evidence`,
      ],
      warnings:
        desktopPointerFocusBoundActions.length === 0
          ? ['No desktop click/scroll runtime action has recorded focus-target binding metadata yet.']
          : desktopPointerFocusMissingActions.length > 0
            ? ['Some older desktop click/scroll actions do not include focus-target binding evidence.']
            : [],
      nextActions:
        desktopPointerFocusBoundActions.length === 0
          ? ['Run one desktop click/scroll dry-run with target/titleContains/processName so pointer evidence binds the focus target.']
          : desktopPointerFocusMissingActions.length > 0
            ? ['Regenerate old desktop pointer evidence before using it for production acceptance.']
            : [],
      checkedAt: Date.now(),
    },
    {
      key: 'mobile_device_allowlist_gate',
      label: 'Mobile device allowlist gate',
      status:
        mobileDeviceAllowlistActions.length === 0
          ? 'not_configured'
          : mobileDeviceAllowlistBlockedActions.length > 0 && mobileDeviceAllowlistPassedActions.length > 0
            ? 'ready'
            : 'available',
      evidence: [
        `${mobileDeviceAllowlistActions.length} mobile allowlist-gated runtime actions`,
        `${mobileDeviceAllowlistBlockedActions.length} blocked by device allowlist`,
        `${mobileDeviceAllowlistPassedActions.length} passed device allowlist`,
      ],
      warnings:
        mobileDeviceAllowlistActions.length === 0
          ? ['No live mobile runtime-control action has exercised the device allowlist gate.']
          : [],
      nextActions:
        mobileDeviceAllowlistActions.length === 0
          ? ['Before production mobile automation, run one blocked and one allowlisted test device action with AGENTHUB_ALLOWED_MOBILE_DEVICE_IDS configured.']
          : mobileDeviceAllowlistPassedActions.length === 0
            ? ['Run a low-risk action against an allowlisted test device to prove approved phones can pass the device gate.']
            : [],
      checkedAt: Date.now(),
    },
    {
      key: 'mobile_app_allowlist_gate',
      label: 'Mobile app package allowlist gate',
      status:
        mobileAppAllowlistActions.length === 0
          ? 'not_configured'
          : mobileAppAllowlistBlockedActions.length > 0 && mobileAppAllowlistPassedActions.length > 0
            ? 'ready'
            : 'available',
      evidence: [
        `${mobileAppAllowlistActions.length} mobile app allowlist-gated runtime actions`,
        `${mobileAppAllowlistBlockedActions.length} blocked by app package allowlist`,
        `${mobileAppAllowlistPassedActions.length} passed app package allowlist`,
      ],
      warnings:
        mobileAppAllowlistActions.length === 0
          ? ['No live mobile runtime-control action has exercised the app package allowlist gate.']
          : [],
      nextActions:
        mobileAppAllowlistActions.length === 0
          ? ['Before production mobile automation, run one blocked and one allowlisted app action with AGENTHUB_ALLOWED_MOBILE_APP_PACKAGES configured.']
          : mobileAppAllowlistPassedActions.length === 0
            ? ['Run a low-risk action against an allowlisted test app package to prove approved mobile apps can pass the app gate.']
            : [],
      checkedAt: Date.now(),
    },
    {
      key: 'workstation_target_allowlist_gate',
      label: 'Workstation target allowlist gate',
      status:
        workstationTargetAllowlistActions.length === 0
          ? 'not_configured'
          : workstationTargetAllowlistBlockedActions.length > 0 && workstationTargetAllowlistPassedActions.length > 0
            ? 'ready'
            : 'available',
      evidence: [
        `${workstationTargetAllowlistActions.length} workstation allowlist-gated runtime actions`,
        `${workstationTargetAllowlistBlockedActions.length} blocked by workstation allowlist`,
        `${workstationTargetAllowlistPassedActions.length} passed workstation allowlist`,
      ],
      warnings:
        workstationTargetAllowlistActions.length === 0
          ? ['No live workstation runtime-control action has exercised the target allowlist gate.']
          : [],
      nextActions:
        workstationTargetAllowlistActions.length === 0
          ? ['Before production VM/RDP/VNC launch, run one blocked and one allowlisted test workstation action with AGENTHUB_ALLOWED_WORKSTATION_TARGETS configured.']
          : workstationTargetAllowlistPassedActions.length === 0
            ? ['Run a low-risk action against an allowlisted test workstation to prove approved VM/RDP/VNC targets can pass the target gate.']
            : [],
      checkedAt: Date.now(),
    },
    {
      key: 'runtime_output_redaction',
      label: 'Runtime output path redaction',
      status: redactedRuntimeFileOutputActions.length > 0 ? 'ready' : 'not_configured',
      evidence: [
        `${runtimeFileOutputActions.length} runtime-control actions with file/path output evidence`,
        `${redactedRuntimeFileOutputActions.length} runtime-control outputs marked redacted`,
        `${unredactedRuntimeFileOutputActions.length} older outputs missing redaction markers`,
      ],
      warnings:
        unredactedRuntimeFileOutputActions.length > 0
          ? ['Some older runtime-control outputs still look like full local paths; regenerate those evidence records after the redaction update.']
          : redactedRuntimeFileOutputActions.length === 0
            ? ['No runtime-control screenshot/RDP dry-run has produced redacted output-path evidence yet.']
            : [],
      nextActions:
        redactedRuntimeFileOutputActions.length === 0
          ? ['Run desktop screenshot dry-run, mobile screenshot dry-run, and RDP workstation launch dry-run once to create redacted output evidence.']
          : unredactedRuntimeFileOutputActions.length > 0
            ? ['Archive or regenerate old unredacted runtime-control evidence before sharing production packages outside the local machine.']
            : [],
      checkedAt: Date.now(),
    },
    {
      key: 'runtime_control_approval_binding',
      label: 'Runtime control approval binding',
      status: approvalBoundRuntimeControlApprovals.length > 0 ? 'ready' : 'not_configured',
      evidence: [
        `${runtimeControlApprovals.length} runtime-control approvals recorded`,
        `${approvedRuntimeControlApprovals.length} runtime-control approvals approved`,
        `${approvalBoundRuntimeControlApprovals.length} approved runtime-control approvals bind inputHash`,
      ],
      warnings:
        approvalBoundRuntimeControlApprovals.length === 0
          ? ['No inputHash-bound runtime-control action is recorded; production desktop/mobile/workstation actions must be tied to exact action inputs.']
          : approvalBoundRuntimeControlApprovals.length < approvedRuntimeControlApprovals.length
            ? ['Some older runtime-control approvals are missing inputHash and will no longer satisfy live execution gates.']
            : [],
      nextActions:
        approvalBoundRuntimeControlApprovals.length > 0
          ? approvalBoundRuntimeControlApprovals.length < approvedRuntimeControlApprovals.length
            ? ['Recreate old runtime_control_action approvals so they include the exact runtime inputHash.']
            : []
          : ['Create and approve runtime_control_action requests with inputHash before enabling live high-risk desktop, phone, or remote-session actions.'],
      checkedAt: Date.now(),
    },
    {
      key: 'runtime_control_execution_evidence',
      label: 'Runtime control execution evidence',
      status: runtimeControlActions.length > 0 ? 'ready' : 'not_configured',
      evidence: [
        `${runtimeControlActions.length} runtime-control actions recorded`,
        `${completedRuntimeControlActions.length} completed runtime-control actions`,
        `${blockedRuntimeControlActions.length} blocked runtime-control actions`,
      ],
      warnings:
        blockedRuntimeControlActions.length > 0
          ? ['Some runtime-control actions were blocked by production gates; review whether approvals or environment gates are missing.']
          : [],
      nextActions:
        runtimeControlActions.length === 0
          ? ['Run read-only runtime-control observations and workstation validations before assigning production Agents.']
          : [],
      checkedAt: Date.now(),
    },
    {
      key: 'workstation_validation_evidence',
      label: 'Workstation validation evidence',
      status: successfulWorkstationValidations.length > 0 ? 'ready' : 'not_configured',
      evidence: [
        `${workstationValidations.length} workstation validation actions recorded`,
        `${successfulWorkstationValidations.length} workstation validations completed`,
        `${blockedWorkstationValidations.length} workstation validations blocked`,
        `${workstationReleaseActions.length} workstation release actions recorded`,
      ],
      warnings:
        blockedWorkstationValidations.length > 0
          ? ['Some workstation validations are blocked; incomplete RDP/VNC/VM metadata may prevent parallel desktop execution.']
          : [],
      nextActions:
        successfulWorkstationValidations.length === 0
          ? ['Validate every VM/RDP/VNC workstation reservation before using it for an Agent.']
          : [],
      checkedAt: Date.now(),
    },
    {
      key: 'software_command_runtime_mapping',
      label: 'Software command execution mapping',
      status: runtimeMappedSoftwareCommands.length > 0 ? 'ready' : 'not_configured',
      evidence: [
        `${softwareCommands.length} software commands registered`,
        `${runtimeMappedSoftwareCommands.length} commands mapped to runtime-control`,
        `${softwareCommandRuns.length} software command runs recorded`,
      ],
      warnings:
        runtimeMappedSoftwareCommands.length === 0
          ? ['No Software Command is mapped to runtime-control, so software CLI-ization cannot execute through the controlled adapter layer.']
          : [],
      nextActions:
        runtimeMappedSoftwareCommands.length === 0
          ? ['Create Software Commands with implementation.type desktop, mobile, workstation, or runtime_control.']
          : [],
      checkedAt: Date.now(),
    },
    {
      key: 'software_command_approval_binding',
      label: 'Software command approval binding',
      status:
        softwareCommandApprovals.length === 0
          ? 'not_configured'
          : approvalBoundSoftwareCommandApprovals.length === softwareCommandApprovals.length
            ? 'ready'
            : 'blocked',
      evidence: [
        `${softwareCommandApprovals.length} software command approvals recorded`,
        `${approvalBoundSoftwareCommandApprovals.length} approvals bind exact input/runtime hashes`,
        `${runtimeApprovalBoundSoftwareCommandApprovals.length} approvals bind runtime approvalInputHash`,
        `${approvedSoftwareCommandApprovals.length} software command approvals approved`,
      ],
      warnings:
        softwareCommandApprovals.length > 0 &&
        approvalBoundSoftwareCommandApprovals.length < softwareCommandApprovals.length
          ? ['Some Software Command approvals are missing inputHash/runtimeControl binding metadata.']
          : runtimeApprovalBoundSoftwareCommandApprovals.length === 0
            ? ['No Software Command approval has runtime approvalInputHash evidence yet; recreate one approval-required runtime-mapped command.']
            : runtimeApprovalBoundSoftwareCommandApprovals.length < approvalBoundSoftwareCommandApprovals.length
              ? ['Some older Software Command approvals do not include runtime approvalInputHash evidence.']
              : [],
      nextActions:
        softwareCommandApprovals.length === 0
          ? ['Execute an approval-required Software Command once to generate a bound approval request.']
          : approvalBoundSoftwareCommandApprovals.length < softwareCommandApprovals.length
            ? ['Recreate old Software Command approvals so they bind exact inputHash and runtime-control metadata.']
            : [],
      checkedAt: Date.now(),
    },
    {
      key: 'production_package_integrity',
      label: 'Production package integrity',
      status: packageIntegrity.status,
      evidence: [
        `${packageIntegrity.summary.readyPackages}/${packageIntegrity.summary.totalPackages} packages passed integrity checks`,
        `${packageIntegrity.summary.onsiteActivationPackages} onsite activation packages`,
        `${packageIntegrity.summary.customerEnvironmentPackages} customer environment packages`,
        packageIntegrity.summary.latestReadyPackageHash
          ? `latestReadyPackageHash=${packageIntegrity.summary.latestReadyPackageHash}`
          : 'latestReadyPackageHash=missing',
      ],
      warnings: packageIntegrity.blockers,
      nextActions: packageIntegrity.nextActions,
      checkedAt: Date.now(),
    },
    {
      key: 'data_dir',
      label: 'Local data directory',
      status: 'ready',
      evidence: [`dataDir=${dataDir}`],
      warnings: [],
      nextActions: [],
      checkedAt: Date.now(),
    },
  ]
  const gaps = checks
    .filter((check) => check.status !== 'ready' && check.status !== 'available')
    .map((check) => check.label)
  const warnings = checks.flatMap((check) => check.warnings)
  const readinessScore = scoreReadiness(checks)
  const report: ProductionHardeningReport = {
    status: readinessStatus(readinessScore, checks),
    readinessScore,
    generatedAt: Date.now(),
    app: {
      name: packageJson.name,
      version: packageJson.version,
      platform: process.platform,
      arch: process.arch,
      node: process.version,
      electronMode: process.versions.electron
        ? process.env.AGENTHUB_DEV === '1'
          ? 'dev'
          : 'packaged'
        : 'node',
      dataDir,
    },
    checks,
    counts: {
      modelProfiles: models.length,
      liveModelTests: tests.filter((test) => test.mode === 'live').length,
      modelCapabilityProbes: capabilityProbes.length,
      successfulModelCapabilityProbes: successfulCapabilityProbes.length,
      modelGatewayAuditLogs: modelGatewayAuditLogs.length,
      modelGatewayInvokeAuditLogs: modelGatewayInvokeAuditLogs.length,
      secrets: secrets.length,
      scopedCredentials: scopes.length,
      agentWorkstations: workstations.length,
      computerSessions: sessions.length,
      softwareCommands: softwareCommands.length,
      runtimeMappedSoftwareCommands: runtimeMappedSoftwareCommands.length,
      softwareCommandRuns: softwareCommandRuns.length,
      softwareCommandApprovals: softwareCommandApprovals.length,
      approvalBoundSoftwareCommandApprovals: approvalBoundSoftwareCommandApprovals.length,
      runtimeApprovalBoundSoftwareCommandApprovals: runtimeApprovalBoundSoftwareCommandApprovals.length,
      approvedSoftwareCommandApprovals: approvedSoftwareCommandApprovals.length,
      runtimeControlApprovals: runtimeControlApprovals.length,
      approvalBoundRuntimeControlApprovals: approvalBoundRuntimeControlApprovals.length,
      approvedRuntimeControlApprovals: approvedRuntimeControlApprovals.length,
      runtimeControlActions: runtimeControlActions.length,
      completedRuntimeControlActions: completedRuntimeControlActions.length,
      blockedRuntimeControlActions: blockedRuntimeControlActions.length,
      runtimeControlKillSwitchActions: runtimeControlKillSwitchActions.length,
      desktopTargetAllowlistActions: desktopTargetAllowlistActions.length,
      desktopTargetAllowlistBlockedActions: desktopTargetAllowlistBlockedActions.length,
      desktopTargetAllowlistPassedActions: desktopTargetAllowlistPassedActions.length,
      desktopInputActions: desktopInputActions.length,
      desktopInputFocusBoundActions: desktopInputFocusBoundActions.length,
      desktopInputFocusMissingActions: desktopInputFocusMissingActions.length,
      desktopPointerActions: desktopPointerActions.length,
      desktopPointerFocusBoundActions: desktopPointerFocusBoundActions.length,
      desktopPointerFocusMissingActions: desktopPointerFocusMissingActions.length,
      successfulWorkstationValidations: successfulWorkstationValidations.length,
      blockedWorkstationValidations: blockedWorkstationValidations.length,
      workstationReleaseActions: workstationReleaseActions.length,
      staleBusyWorkstations: workstationRecovery.summary.staleBusyWorkstations,
      recoverableStaleBusyWorkstations: workstationRecovery.summary.recoverableWorkstations,
      mobileScreenshotActions: mobileScreenshotActions.length,
      mobileDeviceAllowlistActions: mobileDeviceAllowlistActions.length,
      mobileDeviceAllowlistBlockedActions: mobileDeviceAllowlistBlockedActions.length,
      mobileDeviceAllowlistPassedActions: mobileDeviceAllowlistPassedActions.length,
      mobileAppAllowlistActions: mobileAppAllowlistActions.length,
      mobileAppAllowlistBlockedActions: mobileAppAllowlistBlockedActions.length,
      mobileAppAllowlistPassedActions: mobileAppAllowlistPassedActions.length,
      workstationTargetAllowlistActions: workstationTargetAllowlistActions.length,
      workstationTargetAllowlistBlockedActions: workstationTargetAllowlistBlockedActions.length,
      workstationTargetAllowlistPassedActions: workstationTargetAllowlistPassedActions.length,
      runtimeFileOutputActions: runtimeFileOutputActions.length,
      redactedRuntimeFileOutputs: redactedRuntimeFileOutputActions.length,
      unredactedRuntimeFileOutputs: unredactedRuntimeFileOutputActions.length,
      auditLogs: auditLogs.length,
    },
    gaps,
    warnings,
    recommendations: buildHardeningRecommendations(checks),
  }
  await recordAuditLog({
    actorType: 'system',
    action: 'production.hardening.report',
    resourceType: 'production_integration',
    resourceId: 'hardening',
    riskLevel: 'low',
    message: `Production hardening report generated with score ${readinessScore}.`,
    metadata: { status: report.status, gaps },
  })
  return report
}

async function probeCommand(command: string, args: string[]): Promise<CommandProbe> {
  const located = await locateCommand(command)
  if (!located.available) return { command, available: false, error: located.error }
  if (args.length === 0) return { command, available: true, path: located.path }
  const result = await runCommand(command, args)
  return {
    command,
    available: true,
    path: located.path,
    version: result.ok ? firstUsefulLine(result.stdout) : undefined,
    error: result.ok ? undefined : result.error,
  }
}

async function locateCommand(command: string): Promise<{ available: boolean; path?: string; error?: string }> {
  if (path.isAbsolute(command) || command.includes(path.sep) || command.includes('/')) {
    return existsSync(command)
      ? { available: true, path: command }
      : { available: false, error: `Command path does not exist: ${command}` }
  }
  const locator = process.platform === 'win32' ? 'where.exe' : 'which'
  const result = await runCommand(locator, [command])
  if (!result.ok) return { available: false, error: result.error }
  return { available: true, path: firstUsefulLine(result.stdout) }
}

async function runCommand(
  command: string,
  args: string[],
): Promise<{ ok: true; stdout: string; stderr: string } | { ok: false; error: string; stdout: string; stderr: string }> {
  try {
    const { stdout, stderr } = await execFileAsync(command, args, {
      timeout: 8000,
      windowsHide: true,
      maxBuffer: 1024 * 1024,
    })
    return { ok: true, stdout: String(stdout), stderr: String(stderr) }
  } catch (err) {
    const maybe = err as { message?: string; stdout?: unknown; stderr?: unknown }
    return {
      ok: false,
      error: maybe.message ?? String(err),
      stdout: String(maybe.stdout ?? ''),
      stderr: String(maybe.stderr ?? ''),
    }
  }
}

async function probeHyperV(): Promise<WorkstationProviderProbe> {
  if (process.platform !== 'win32') {
    return {
      key: 'hyperv',
      label: 'Hyper-V',
      available: false,
      evidence: ['Hyper-V probe is Windows-only.'],
      warnings: [],
    }
  }
  const result = await runCommand('powershell.exe', [
    '-NoProfile',
    '-Command',
    'Get-Command New-VM -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty Name',
  ])
  const available = result.ok && firstUsefulLine(result.stdout) === 'New-VM'
  return {
    key: 'hyperv',
    label: 'Hyper-V',
    available,
    command: 'New-VM',
    evidence: [available ? 'Hyper-V PowerShell command New-VM is available' : 'Hyper-V New-VM command not available'],
    warnings: available ? [] : ['Hyper-V may be disabled or unavailable on this Windows edition.'],
  }
}

async function probeDockerProvider(args: { live?: boolean } = {}): Promise<WorkstationProviderProbe> {
  const docker = await probeCommand('docker', ['--version'])
  const evidence = docker.available
    ? [`docker CLI available${docker.version ? `: ${docker.version}` : ''}`]
    : [`docker CLI not found${docker.error ? `: ${docker.error}` : ''}`]
  const warnings: string[] = []

  if (process.platform === 'win32') {
    const service = await probeWindowsServiceStatus('com.docker.service')
    if (service) {
      evidence.push(`com.docker.service status=${service.status}`)
      if (service.status !== 'Running') {
        warnings.push(`Docker Desktop Service is ${service.status}; daemon access may be unavailable.`)
      }
    }
  }

  if (docker.available && args.live) {
    const daemon = await runCommand('docker', ['info', '--format', '{{.ServerVersion}}'])
    if (daemon.ok) {
      const serverVersion = firstUsefulLine(daemon.stdout)
      evidence.push(`docker daemon reachable${serverVersion ? `: ${serverVersion}` : ''}`)
    } else {
      warnings.push(`docker CLI is installed but the daemon is not reachable: ${daemon.error}`)
    }
  } else if (docker.available) {
    warnings.push('Docker daemon reachability was not checked because live=false.')
  }

  return {
    key: 'docker',
    label: 'Docker Desktop / container workstation',
    available: docker.available,
    command: 'docker',
    evidence,
    warnings,
  }
}

async function probeWslProvider(args: { live?: boolean } = {}): Promise<WorkstationProviderProbe> {
  const wsl = await locateCommand('wsl.exe')
  const evidence = wsl.available
    ? [`wsl.exe found${wsl.path ? `: ${wsl.path}` : ''}`]
    : [`wsl.exe not found${wsl.error ? `: ${wsl.error}` : ''}`]
  const warnings: string[] = []

  if (wsl.available) {
    const list = await runCommand('wsl.exe', ['--list', '--quiet'])
    if (list.ok) {
      const distros = list.stdout
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
      evidence.push(`wsl distributions discovered: ${distros.length}`)
      if (distros.length === 0) warnings.push('WSL is installed but no Linux distribution is registered.')
    } else if (args.live) {
      warnings.push(`wsl distribution listing failed: ${list.error}`)
    }
  }

  return {
    key: 'wsl',
    label: 'WSL lightweight workstation',
    available: wsl.available,
    command: 'wsl.exe',
    evidence,
    warnings: [
      ...warnings,
      ...(wsl.available
        ? ['WSL is suitable for isolated CLI/service work; full GUI desktop still needs WSLg, RDP, VNC, or a VM provider.']
        : []),
    ],
  }
}

async function probeWindowsServiceStatus(name: string): Promise<{ name: string; status: string } | null> {
  if (process.platform !== 'win32') return null
  const result = await runCommand('powershell.exe', [
    '-NoProfile',
    '-Command',
    `Get-Service -Name ${JSON.stringify(name)} -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty Status`,
  ])
  if (!result.ok) return null
  const status = sanitizeProbeLine(firstUsefulLine(result.stdout))
  return status ? { name, status } : null
}

function sanitizeProbeLine(value: string | undefined): string | null {
  if (!value) return null
  const sanitized = value
    .replace(/\u0000/g, '')
    .replace(/[\u0000-\u001F\u007F-\u009F]/g, '')
    .trim()
  if (!sanitized || sanitized.length < 2) return null
  return sanitized
}

function parseWindowSamples(stdout: string): Array<{ processName: string; title: string }> {
  if (!stdout.trim()) return []
  try {
    const parsed = JSON.parse(stdout) as unknown
    const rows = Array.isArray(parsed) ? parsed : [parsed]
    return rows
      .map((row) => {
        const record = row as Record<string, unknown>
        return {
          processName: String(record.ProcessName ?? ''),
          title: String(record.MainWindowTitle ?? ''),
        }
      })
      .filter((row) => row.processName && row.title)
  } catch {
    return []
  }
}

function parseAdbDevices(stdout: string): MobileDeviceProbe[] {
  return stdout
    .split(/\r?\n/)
    .slice(1)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [id, status, ...rest] = line.split(/\s+/)
      return { id, status: status ?? 'unknown', description: rest.join(' ') }
    })
}

function normalizeStaleBusyWorkstationMs(value: number | undefined): number {
  if (!Number.isFinite(value) || !value || value <= 0) return DEFAULT_STALE_BUSY_WORKSTATION_MS
  return Math.max(60 * 1000, Math.floor(value))
}

function buildWorkstationLeaseRecoveryReport(args: {
  workstations: AgentWorkstationRow[]
  sessions: ComputerSessionRow[]
  resourceLocks: ResourceLockRow[]
  maxBusyAgeMs: number
  now: number
  recoveredIds: string[]
  applied: boolean
}): WorkstationLeaseRecoveryReport {
  const busyWorkstations = args.workstations.filter((workstation) => workstation.status === 'busy')
  const items = busyWorkstations.map((workstation): WorkstationLeaseRecoveryItem => {
    const ageMs = Math.max(0, args.now - workstation.updatedAt)
    const stale = ageMs >= args.maxBusyAgeMs
    const activeSessionIds = args.sessions
      .filter(
        (session) =>
          session.workstationId === workstation.id &&
          (session.status === 'active' || session.status === 'paused'),
      )
      .map((session) => session.id)
    const heldLockIds = args.resourceLocks
      .filter(
        (lock) =>
          lock.status === 'held' &&
          lock.resourceType === 'software_instance' &&
          lock.resourceId === `workstation:${workstation.id}`,
      )
      .map((lock) => lock.id)
    const blockers = [
      ...(stale ? [] : ['Workstation has not exceeded the stale busy threshold.']),
      ...(activeSessionIds.length === 0
        ? []
        : ['Active or paused computer sessions still reference this workstation.']),
      ...(heldLockIds.length === 0 ? [] : ['A held workstation resource lock is still active.']),
    ]
    return {
      workstationId: workstation.id,
      agentProfileId: workstation.agentProfileId,
      mode: workstation.mode,
      status: workstation.status,
      updatedAt: workstation.updatedAt,
      ageMs,
      stale,
      recoverable: stale && activeSessionIds.length === 0 && heldLockIds.length === 0,
      activeSessionIds,
      heldLockIds,
      blockers,
    }
  })
  const staleItems = items.filter((item) => item.stale)
  const recoverableItems = items.filter((item) => item.recoverable)
  const blockedItems = staleItems.filter((item) => !item.recoverable)
  return {
    generatedAt: args.now,
    maxBusyAgeMs: args.maxBusyAgeMs,
    summary: {
      busyWorkstations: busyWorkstations.length,
      staleBusyWorkstations: staleItems.length,
      recoverableWorkstations: recoverableItems.length,
      blockedWorkstations: blockedItems.length,
      recoveredWorkstations: args.recoveredIds.length,
    },
    items,
    warnings: uniqueNonEmpty([
      ...(staleItems.length > 0
        ? [`${staleItems.length} busy workstation lease(s) exceeded the stale threshold.`]
        : []),
      ...(blockedItems.length > 0
        ? [`${blockedItems.length} stale workstation lease(s) still have sessions or locks.`]
        : []),
    ]),
    nextActions: uniqueNonEmpty([
      ...(recoverableItems.length > 0
        ? ['Run stale workstation recovery with apply=true and confirmRecovery=true to return safe stale leases to idle.']
        : []),
      ...(blockedItems.length > 0
        ? ['Review active computer sessions and held resource locks before recovering blocked stale workstations.']
        : []),
      ...(busyWorkstations.length > staleItems.length
        ? ['Busy workstations that have not exceeded the stale threshold should be left alone.']
        : []),
    ]),
    applied: args.applied,
    recoveredIds: args.recoveredIds,
  }
}

function resolveWorkstationPaths(args: CreateWorkstationReservationArgs) {
  const root = process.env.AGENTHUB_DATA_DIR ?? path.resolve(process.cwd(), '.agenthub-data')
  const base = path.resolve(root, 'agent-workstations', safeSegment(args.agentProfileId), safeSegment(args.mode))
  return {
    workspacePath: resolveWorkstationSubpath(base, args.workspacePath, 'workspacePath', 'workspace'),
    browserProfilePath: resolveWorkstationSubpath(base, args.browserProfilePath, 'browserProfilePath', 'browser-profile'),
    tempPath: resolveWorkstationSubpath(base, args.tempPath, 'tempPath', 'tmp'),
  }
}

function resolveWorkstationSubpath(
  base: string,
  requestedPath: string | null | undefined,
  label: string,
  fallbackSegment: string,
): string {
  const trimmed = requestedPath?.trim()
  const resolved = trimmed
    ? path.resolve(path.isAbsolute(trimmed) ? trimmed : path.join(base, trimmed))
    : path.join(base, fallbackSegment)
  if (resolved !== base && !resolved.startsWith(`${base}${path.sep}`)) {
    throw new Error(`${label} must stay inside the AgentHub workstation directory.`)
  }
  return resolved
}

function assertWorkstationReservationIsRedacted(args: CreateWorkstationReservationArgs): void {
  const rdpConfig = args.rdpConfig?.trim()
  if (rdpConfig && workstationConfigContainsSecret(rdpConfig)) {
    throw new Error('rdpConfig must not contain passwords or credential blobs.')
  }
  const vncUrl = args.vncUrl?.trim()
  if (!vncUrl) return
  try {
    const url = new URL(vncUrl)
    if (url.username || url.password) {
      throw new Error('vncUrl must not embed usernames or passwords.')
    }
  } catch (err) {
    if (err instanceof Error && err.message.includes('must not embed')) throw err
  }
}

function vaultMasterKeyCheck(): ProductionProbeResult {
  const key = process.env.AGENTHUB_VAULT_MASTER_KEY?.trim() ?? ''
  const configured = key.length > 0
  const keyId = process.env.AGENTHUB_VAULT_MASTER_KEY_ID?.trim() ?? ''
  const rotatedAtRaw = process.env.AGENTHUB_VAULT_MASTER_KEY_ROTATED_AT?.trim() ?? ''
  const rotationDays =
    parsePositiveInteger(process.env[VAULT_MASTER_KEY_ROTATION_DAYS_ENV]) ?? DEFAULT_VAULT_MASTER_KEY_ROTATION_DAYS
  const rotatedAt = parseVaultKeyRotatedAt(rotatedAtRaw)
  const now = Date.now()
  const keyAgeDays =
    rotatedAt === null ? null : Math.max(0, Math.floor((now - rotatedAt) / (24 * 60 * 60 * 1000)))
  const weakReason = configured ? vaultMasterKeyWeakReason(key) : null
  const rotationFresh = keyAgeDays !== null && keyAgeDays <= rotationDays
  const status: ProductionIntegrationStatus = !configured
    ? 'not_configured'
    : weakReason
      ? 'blocked'
      : !keyId || rotatedAt === null
        ? 'available'
        : rotationFresh
          ? 'ready'
          : 'blocked'
  const evidence = [
    configured ? 'AGENTHUB_VAULT_MASTER_KEY is configured and redacted' : 'AGENTHUB_VAULT_MASTER_KEY is missing',
    configured ? `vault key length=${key.length}` : null,
    keyId ? `vault key id=${redactVaultKeyId(keyId)}` : 'vault key id=missing',
    rotatedAt === null ? 'vault key rotatedAt=missing' : `vault key rotatedAt=${new Date(rotatedAt).toISOString()}`,
    `vault key rotation window=${rotationDays} days`,
    keyAgeDays === null ? null : `vault key age=${keyAgeDays} days`,
  ].filter(Boolean) as string[]
  const warnings = [
    configured ? null : 'Encrypted Secret Vault values cannot be decrypted without AGENTHUB_VAULT_MASTER_KEY.',
    weakReason ? `Vault master key is not production safe: ${weakReason}.` : null,
    configured && !keyId ? 'Vault master key is missing AGENTHUB_VAULT_MASTER_KEY_ID rotation metadata.' : null,
    configured && rotatedAtRaw && rotatedAt === null
      ? 'Vault master key rotation timestamp could not be parsed.'
      : null,
    configured && !rotatedAtRaw ? 'Vault master key is missing AGENTHUB_VAULT_MASTER_KEY_ROTATED_AT.' : null,
    configured && rotatedAt !== null && !rotationFresh
      ? `Vault master key rotation is older than ${rotationDays} days.`
      : null,
  ].filter(Boolean) as string[]
  const nextActions = [
    configured ? null : 'Set AGENTHUB_VAULT_MASTER_KEY before storing encrypted production credentials.',
    weakReason ? 'Replace AGENTHUB_VAULT_MASTER_KEY with a high-entropy value of at least 32 characters.' : null,
    configured && !keyId ? 'Set AGENTHUB_VAULT_MASTER_KEY_ID to the active key label or version.' : null,
    configured && rotatedAt === null
      ? 'Set AGENTHUB_VAULT_MASTER_KEY_ROTATED_AT to the ISO timestamp when the key was last rotated.'
      : null,
    configured && rotatedAt !== null && !rotationFresh
      ? 'Rotate AGENTHUB_VAULT_MASTER_KEY and update the key id plus rotatedAt metadata.'
      : null,
  ].filter(Boolean) as string[]
  return {
    key: 'vault_master_key',
    label: 'Vault master key',
    status,
    evidence,
    warnings,
    nextActions,
    checkedAt: now,
  }
}

function vaultMasterKeyWeakReason(value: string): string | null {
  if (value.length < 32) return 'shorter than 32 characters'
  if (/^(.)\1+$/.test(value)) return 'contains only repeated characters'
  if (/(change[-_ ]?me|password|passwd|secret|test|demo|smoke|default|example|123456|agenthub)/i.test(value)) {
    return 'looks like a placeholder'
  }
  const uniqueChars = new Set(value).size
  if (uniqueChars < 10) return 'too little character diversity'
  return null
}

function parseVaultKeyRotatedAt(value: string): number | null {
  if (!value) return null
  const numeric = Number(value)
  const timestamp = Number.isFinite(numeric) && /^\d+$/.test(value) ? numeric : Date.parse(value)
  return Number.isFinite(timestamp) ? timestamp : null
}

function parsePositiveInteger(value: string | undefined): number | null {
  if (!value) return null
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed <= 0) return null
  return Math.floor(parsed)
}

function redactVaultKeyId(value: string): string {
  if (value.length <= 10) return value
  return `${value.slice(0, 4)}...${value.slice(-4)}`
}

function isRuntimeControlSoftwareImplementation(value: JsonObject): boolean {
  const type = value.type
  return type === 'desktop' || type === 'mobile' || type === 'workstation' || type === 'runtime_control'
}

function preflightEnvGate(
  envVar: string,
  purpose: string,
  enabledOverride?: boolean,
): ProductionExecutionPreflightEnvGate {
  return {
    envVar,
    enabled: enabledOverride ?? process.env[envVar] === '1',
    required: true,
    purpose,
  }
}

function preflightRuntimeGuard(
  key: string,
  envVar: string,
  purpose: string,
  valueHint: string,
): ProductionExecutionPreflightRuntimeGuard {
  return {
    key,
    envVar,
    configured: Boolean(process.env[envVar]?.trim()),
    required: true,
    purpose,
    valueHint,
  }
}

function modelEndpointHostAllowlistConfigured(): boolean {
  return modelEndpointHostAllowlistPatterns().length > 0
}

function modelEndpointHostAllowed(host: string): boolean {
  const normalizedHost = host.toLowerCase().split(':')[0] ?? ''
  return modelEndpointHostAllowlistPatterns().some((pattern) => {
    if (pattern === '*') return true
    if (pattern === normalizedHost) return true
    if (pattern.startsWith('*.')) {
      const suffix = pattern.slice(2)
      return normalizedHost === suffix || normalizedHost.endsWith(`.${suffix}`)
    }
    return false
  })
}

function modelEndpointHostAllowlistPatterns(): string[] {
  return (process.env[MODEL_ENDPOINT_HOST_ALLOWLIST_ENV] ?? '')
    .split(/[\s,;]+/u)
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean)
}

function preflightEmergencyStop(): ProductionExecutionPreflightEmergencyStop {
  return {
    envVar: 'AGENTHUB_RUNTIME_CONTROL_KILL_SWITCH',
    active: process.env.AGENTHUB_RUNTIME_CONTROL_KILL_SWITCH === '1',
    blocksHighRiskLive: true,
    purpose: 'Blocks high-risk live desktop, mobile, and workstation launch actions before env gates or approvals run.',
  }
}

function commonLivePreflightBlockers(customerAuthorized: boolean, approvedGoLiveHashPresent: boolean): string[] {
  return [
    ...(customerAuthorized ? [] : ['客户现场授权开关和授权证据哈希尚未同时通过。']),
    ...(approvedGoLiveHashPresent ? [] : ['缺少 AGENTHUB_APPROVED_GO_LIVE_DECISION_HASH 上线哈希。']),
  ]
}

function runtimeGuardPreflightBlockers(guards: ProductionExecutionPreflightRuntimeGuard[]): string[] {
  return guards
    .filter((guard) => guard.required && !guard.configured)
    .map((guard) => `${guard.envVar} is not configured for ${guard.key}.`)
}

function gatePreflightBlockers(gate: RuntimeControlGateProbe | undefined): string[] {
  if (!gate) return ['缺少对应的运行时门控定义。']
  return [
    ...(!gate.readOnly && !gate.envEnabled && gate.envVar ? [`${gate.envVar} 尚未开启。`] : []),
    ...(gate.approvalRequired && gate.approvedRuntimeControlApprovals === 0
      ? ['缺少已批准的 runtime_control_action 审批。']
      : []),
  ]
}

function preflightAction(
  args: Omit<ProductionExecutionPreflightAction, 'status' | 'canExecuteNow'> & {
    blockers: string[]
  },
): ProductionExecutionPreflightAction {
  const requiredRuntimeGuards = args.requiredRuntimeGuards ?? []
  const emergencyStop = args.emergencyStop ?? preflightEmergencyStop()
  const highRiskRuntimeAction = args.domain !== 'model' && !args.readOnly && args.riskLevel === 'high'
  const blockers = uniqueNonEmpty([
    ...args.blockers,
    ...runtimeGuardPreflightBlockers(requiredRuntimeGuards),
    ...(highRiskRuntimeAction && emergencyStop.active
      ? [`${emergencyStop.envVar}=1 is blocking high-risk live runtime control.`]
      : []),
  ]).slice(0, 10)
  return {
    ...args,
    requiredRuntimeGuards,
    emergencyStop,
    evidence: uniqueNonEmpty(args.evidence).slice(0, 8),
    blockers,
    nextActions: uniqueNonEmpty(args.nextActions).slice(0, 8),
    canExecuteNow: blockers.length === 0,
    status: blockers.length === 0 ? 'ready' : args.dryRunAvailable ? 'blocked' : 'not_configured',
  }
}

function productionGoLiveDrillScenario(args: {
  id: string
  domain: ProductionGoLiveDrillDomain
  title: string
  target: string
  riskLevel: 'low' | 'medium' | 'high'
  readOnly: boolean
  canPassNow: boolean
  evidence: string[]
  blockers: string[]
  nextActions: string[]
}): ProductionGoLiveDrillScenario {
  const blockers = uniqueNonEmpty(args.blockers).slice(0, 8)
  const canPassNow = args.canPassNow && blockers.length === 0
  return {
    id: args.id,
    domain: args.domain,
    title: args.title,
    target: args.target,
    riskLevel: args.riskLevel,
    readOnly: args.readOnly,
    status: canPassNow ? 'ready' : 'blocked',
    canPassNow,
    evidence: uniqueNonEmpty(args.evidence).slice(0, 8),
    blockers,
    nextActions: uniqueNonEmpty(args.nextActions).slice(0, 8),
  }
}

function isModelCapabilityProbe(test: { capabilityChecks: JsonObject }): boolean {
  return typeof test.capabilityChecks.capabilityProbeKind === 'string'
}

function runtimeGateDefinitions(): Array<{
  key: string
  label: string
  scope: RuntimeControlGateProbe['scope']
  envVar: string | null
  readOnly: boolean
  actionTypes: string[]
  enabled?: boolean
  riskLevel?: 'low' | 'medium' | 'high'
  purpose?: string
}> {
  const definitions: Array<{
    key: string
    label: string
    scope: RuntimeControlGateProbe['scope']
    envVar: string | null
    readOnly: boolean
    actionTypes: string[]
    enabled?: boolean
    riskLevel?: 'low' | 'medium' | 'high'
    purpose?: string
  }> = [
    {
      key: 'desktop_observation',
      label: '桌面观察',
      scope: 'desktop',
      envVar: null,
      readOnly: true,
      actionTypes: ['runtime_control.desktop.observe_windows'],
    },
    {
      key: 'network_egress_test',
      label: '真实网络出口 IP 检测',
      scope: 'desktop',
      envVar: 'AGENTHUB_ENABLE_REAL_NETWORK_EGRESS_TEST',
      readOnly: true,
      actionTypes: [],
      enabled: process.env.AGENTHUB_ENABLE_REAL_NETWORK_EGRESS_TEST === '1',
      riskLevel: 'medium',
      purpose: '允许系统向客户批准的 IP Echo 服务发起一次外部请求，以验证模型/代理出口落地 IP。',
    },
    {
      key: 'desktop_control',
      label: '桌面点击输入',
      scope: 'desktop',
      envVar: 'AGENTHUB_ENABLE_REAL_DESKTOP_CONTROL',
      readOnly: false,
      actionTypes: [
        'runtime_control.desktop.click',
        'runtime_control.desktop.scroll',
        'runtime_control.desktop.type_text',
        'runtime_control.desktop.key_press',
        'runtime_control.desktop.focus_window',
      ],
    },
    {
      key: 'desktop_capture',
      label: '桌面截图',
      scope: 'desktop',
      envVar: 'AGENTHUB_ENABLE_REAL_DESKTOP_CAPTURE',
      readOnly: false,
      actionTypes: ['runtime_control.desktop.capture_screenshot'],
    },
    {
      key: 'mobile_observation',
      label: '手机设备发现',
      scope: 'mobile',
      envVar: null,
      readOnly: true,
      actionTypes: ['runtime_control.mobile.list_devices'],
    },
    {
      key: 'mobile_control',
      label: '手机点击输入',
      scope: 'mobile',
      envVar: 'AGENTHUB_ENABLE_REAL_MOBILE_CONTROL',
      readOnly: false,
      actionTypes: [
        'runtime_control.mobile.mobile_tap',
        'runtime_control.mobile.mobile_swipe',
        'runtime_control.mobile.mobile_text',
        'runtime_control.mobile.mobile_keyevent',
      ],
    },
    {
      key: 'mobile_capture',
      label: '手机截图',
      scope: 'mobile',
      envVar: 'AGENTHUB_ENABLE_REAL_MOBILE_CAPTURE',
      readOnly: false,
      actionTypes: ['runtime_control.mobile.mobile_screenshot'],
    },
    {
      key: 'workstation_validation',
      label: '工作站校验',
      scope: 'workstation',
      envVar: null,
      readOnly: true,
      actionTypes: [
        'runtime_control.workstation.validate_workstation',
        'runtime_control.workstation.release_workstation',
      ],
    },
    {
      key: 'workstation_launch',
      label: '远程工作站启动',
      scope: 'workstation',
      envVar: 'AGENTHUB_ENABLE_REAL_WORKSTATION_LAUNCH',
      readOnly: false,
      actionTypes: ['runtime_control.workstation.launch_remote_session'],
    },
  ]
  return definitions.filter((definition) => definition.actionTypes.length > 0)
}

function runtimeGateStatus(args: {
  readOnly: boolean
  envEnabled: boolean
  completedActions: number
  liveExecutions: number
  approvedRuntimeControlApprovals: number
}): ProductionIntegrationStatus {
  if (args.readOnly) return args.completedActions > 0 ? 'ready' : 'available'
  if (!args.envEnabled) return 'not_configured'
  if (args.liveExecutions > 0) return 'ready'
  if (args.approvedRuntimeControlApprovals > 0 || args.completedActions > 0) return 'available'
  return 'not_configured'
}

function runtimeGateNextActions(args: {
  readOnly: boolean
  envVar: string | null
  envEnabled: boolean
  completedActions: number
  liveExecutions: number
  approvedRuntimeControlApprovals: number
}): string[] {
  if (args.readOnly) {
    return args.completedActions > 0 ? [] : ['运行一次只读检查，确认运行时能观察目标环境。']
  }
  const next: string[] = []
  if (!args.envEnabled && args.envVar) next.push(`只在客户授权环境中设置 ${args.envVar}=1。`)
  if (args.approvedRuntimeControlApprovals === 0) next.push('为一次真实控制动作创建并批准运行时审批。')
  if (args.envEnabled && args.liveExecutions === 0) next.push('在测试工作站上执行一次受控真实动作，留下审计证据。')
  return next
}

function buildWorkstationReadinessProbe(workstation: AgentWorkstationRow): WorkstationReadinessProbe {
  const blockingReasons: string[] = []
  const warnings: string[] = []
  const nextActions: string[] = []
  const pathChecks = {
    workspacePath: existsSync(workstation.workspacePath),
    browserProfilePath: existsSync(workstation.browserProfilePath),
    tempPath: existsSync(workstation.tempPath),
  }
  if (!pathChecks.workspacePath) blockingReasons.push('工作区目录不存在')
  if (!pathChecks.browserProfilePath) blockingReasons.push('浏览器配置目录不存在')
  if (!pathChecks.tempPath) blockingReasons.push('临时目录不存在')
  if (workstation.mode === 'remote_session') {
    if (!workstation.rdpConfig?.trim() && !workstation.vncUrl?.trim()) {
      blockingReasons.push('远程会话缺少 RDP 配置或 VNC 地址')
      nextActions.push('填写 RDP 配置或 VNC 地址后再校验工作站。')
    }
    if (workstation.rdpConfig && !/\bfull address:s:/i.test(workstation.rdpConfig)) {
      warnings.push('RDP 配置缺少 full address:s: 地址字段')
    }
    if (workstation.rdpConfig && workstationConfigContainsSecret(workstation.rdpConfig)) {
      blockingReasons.push('rdpConfig 不能包含密码或凭据内容。')
      nextActions.push('把远程桌面密码移到系统凭据管理器或有作用域的密钥库。')
    }
    if (workstation.vncUrl) {
      try {
        const url = new URL(workstation.vncUrl)
        if (!['vnc:', 'http:', 'https:'].includes(url.protocol)) {
          warnings.push('VNC 地址建议使用 vnc://、http:// 或 https://')
        }
        if (url.username || url.password) {
          blockingReasons.push('vncUrl 不能内嵌用户名或密码。')
          nextActions.push('使用凭据管理器或有作用域的密钥库保存 VNC 凭据。')
        }
      } catch {
        blockingReasons.push('VNC 地址格式无效')
      }
    }
  }
  if ((workstation.mode === 'vm' || workstation.mode === 'virtual_desktop') &&
      !workstation.displayId &&
      !workstation.rdpConfig &&
      !workstation.vncUrl) {
    blockingReasons.push('VM/虚拟桌面缺少屏幕、RDP 或 VNC 元数据')
    nextActions.push('补齐虚拟桌面标识、RDP 配置或 VNC 地址。')
  }
  if ((workstation.mode === 'vm' || workstation.mode === 'virtual_desktop') &&
      workstation.displayId &&
      !workstation.rdpConfig &&
      !workstation.vncUrl &&
      !workstationDisplayIdHasSupportedLauncher(workstation.displayId)) {
    blockingReasons.push('displayId must use a launchable provider prefix: rdp:, url:, vnc:, hyperv:, virtualbox:, vbox:, vmware:, or vmrun:.')
    nextActions.push('Update displayId to a supported VM/RDP/VNC launcher format before enabling live workstation launch.')
  }
  if (workstation.status === 'error') blockingReasons.push('工作站处于错误状态')
  if (workstation.status === 'busy') warnings.push('工作站当前忙碌')
  if (!pathChecks.workspacePath || !pathChecks.browserProfilePath || !pathChecks.tempPath) {
    nextActions.push('确认本机工作区、浏览器配置和临时目录可访问。')
  }
  return {
    id: workstation.id,
    agentProfileId: workstation.agentProfileId,
    mode: workstation.mode,
    status: workstation.status,
    ready: blockingReasons.length === 0,
    hasVncUrl: Boolean(workstation.vncUrl),
    hasRdpConfig: Boolean(workstation.rdpConfig),
    pathChecks,
    blockingReasons,
    warnings,
    nextActions: [...new Set(nextActions)],
  }
}

function workstationConfigContainsSecret(value: string): boolean {
  return /\bpassword(?:\s+51)?:/i.test(value) || /\bcredential(?:s)?:/i.test(value)
}

function workstationDisplayIdHasSupportedLauncher(displayId: string): boolean {
  const prefix = displayId.split(':')[0]?.trim().toLowerCase()
  return ['rdp', 'url', 'vnc', 'http', 'https', 'hyperv', 'virtualbox', 'vbox', 'vmware', 'vmrun'].includes(prefix)
}

function runtimeControlGateCheck(): ProductionProbeResult {
  const gates = [
    'AGENTHUB_ENABLE_REAL_DESKTOP_CONTROL',
    'AGENTHUB_ENABLE_REAL_DESKTOP_CAPTURE',
    'AGENTHUB_ENABLE_REAL_MOBILE_CONTROL',
    'AGENTHUB_ENABLE_REAL_MOBILE_CAPTURE',
    'AGENTHUB_ENABLE_REAL_WORKSTATION_LAUNCH',
  ]
  const enabled = gates.filter((key) => process.env[key] === '1')
  return {
    key: 'runtime_control_gates',
    label: 'Runtime control gates',
    status: enabled.length > 0 ? 'available' : 'not_configured',
    evidence: gates.map((key) => `${key}=${process.env[key] === '1' ? '1' : 'off'}`),
    warnings:
      enabled.length === 0
        ? ['All high-risk runtime control gates are off; click/type/tap/remote launch actions will be blocked.']
        : [],
    nextActions:
      enabled.length === gates.length
        ? []
        : ['Enable only the specific real-control environment gates needed for the customer workstation.'],
    checkedAt: Date.now(),
  }
}

function buildHardeningRecommendations(checks: ProductionProbeResult[]): string[] {
  const recommendations = checks.flatMap((check) => check.nextActions)
  recommendations.push('真实桌面点击、手机动作、登录、支付和客户数据发送必须经过审批和审计日志。')
  recommendations.push('给自主智能体分配客户工作站前，先在每台工作站上运行就绪探测。')
  return [...new Set(recommendations)]
}

function setupStep(args: ProductionSetupGuideStep): ProductionSetupGuideStep {
  return {
    ...args,
    evidence: uniqueNonEmpty(args.evidence).slice(0, 6),
    blockers: uniqueNonEmpty(args.blockers).slice(0, 6),
    nextActions: uniqueNonEmpty(args.nextActions).slice(0, 6),
  }
}

function weakestStatus(statuses: Array<ProductionIntegrationStatus | undefined>): ProductionIntegrationStatus {
  const present = statuses.filter(Boolean) as ProductionIntegrationStatus[]
  if (present.length === 0) return 'unknown'
  if (present.includes('blocked')) return 'blocked'
  if (present.includes('not_installed')) return 'not_installed'
  if (present.includes('not_configured')) return 'not_configured'
  if (present.every((status) => status === 'ready')) return 'ready'
  if (present.some((status) => status === 'available')) return 'available'
  if (present.some((status) => status === 'unknown')) return 'unknown'
  return present[0] ?? 'unknown'
}

function uniqueNonEmpty(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))]
}

function modelCredentialItemToIntakeItem(
  model: ProductionModelCredentialItem,
): ProductionModelCredentialIntakeItem {
  const credential = model.credential
  const isVault = credential.refKind === 'secret_vault'
  const isEnv = credential.refKind === 'env'
  const secretUsable = credentialItemHasUsableSecret(model)
  const scopesReady = credential.connectScope === 'allowed' && credential.invokeScope === 'allowed'
  const envMigratable = isEnv && Boolean(credential.envVar)
  const ready = isVault && secretUsable && scopesReady
  const status: ProductionIntegrationStatus = ready
    ? 'ready'
    : credential.refKind === 'inline_secret_blocked'
      ? 'blocked'
      : envMigratable || isVault
        ? 'available'
        : 'not_configured'
  const blockers = uniqueNonEmpty([
    ...(credential.refKind === 'inline_secret_blocked'
      ? ['模型 apiKeyRef 看起来像明文密钥，不能自动迁移；请先放入环境变量或密钥库。']
      : []),
    ...(credential.refKind === 'unresolved' ? ['模型凭证引用无法解析。'] : []),
    ...(isEnv ? ['模型仍直接引用环境变量，生产建议迁入 Secret Vault env_ref。'] : []),
    ...(isVault && !secretUsable ? ['密钥库引用当前不可解析或不可用。'] : []),
    ...(isVault && credential.connectScope === 'missing' ? ['缺少 model.connect 作用域。'] : []),
    ...(isVault && credential.invokeScope === 'missing' ? ['缺少 model.invoke 作用域。'] : []),
  ])
  const nextActions = uniqueNonEmpty([
    ...(envMigratable ? [`把 ${credential.envVar} 注册为 Secret Vault env_ref，并把模型 apiKeyRef 改为 secret:ID。`] : []),
    ...(isVault && credential.connectScope === 'missing' ? ['给该 secret 授予 model.connect 作用域。'] : []),
    ...(isVault && credential.invokeScope === 'missing' ? ['给该 secret 授予 model.invoke 作用域。'] : []),
    ...(credential.refKind === 'inline_secret_blocked'
      ? ['不要在模型配置中保存 API Key 明文；改用 env:NAME 或 secret:ID。']
      : []),
    ...model.nextActions,
  ]).slice(0, 8)
  return {
    modelProfileId: model.modelProfileId,
    name: model.name,
    provider: model.provider,
    model: model.model,
    status,
    credentialRefKind: credential.refKind,
    currentRefPreview: credential.refPreview,
    proposedSecretRef: credential.secretId
      ? `secret:${credential.secretId}`
      : credential.envVar
        ? `secret:<env:${credential.envVar}>`
        : null,
    proposedEnvVar: credential.envVar,
    envValuePresent: credential.envValuePresent,
    secretId: credential.secretId,
    connectScope: credential.connectScope,
    invokeScope: credential.invokeScope,
    canMigrateFromEnv: envMigratable,
    canAttachExistingSecret: !ready && credential.refKind !== 'inline_secret_blocked',
    requiresManualSecretInput: credential.refKind === 'unresolved' || credential.refKind === 'inline_secret_blocked',
    redacted: true,
    evidence: uniqueNonEmpty([
      `${model.provider} / ${model.model}`,
      `credential=${credential.refPreview}`,
      `connectScope=${credential.connectScope}`,
      `invokeScope=${credential.invokeScope}`,
      credential.envVar ? `env:${credential.envVar}=${credential.envValuePresent ? 'present' : 'missing'}` : '',
      credential.secretId ? `secret:${credential.secretId}` : '',
    ]),
    blockers,
    nextActions,
  }
}

async function resolveIntakeSecretTarget(args: {
  modelProfileId: string
  modelName: string
  currentApiKeyRef: string
  envVar?: string | null
  secretId?: string | null
  createIfMissing: boolean
}): Promise<{
  secretId: string
  nextApiKeyRef: string
  createdSecret: boolean
}> {
  const explicitSecretId = args.secretId?.trim() || parseVaultSecretId(args.currentApiKeyRef.trim())
  if (explicitSecretId) {
    const secret = await db.query.secretVault.findFirst({
      where: eq(schema.secretVault.id, explicitSecretId),
    })
    if (!secret) throw new Error(`Secret not found: ${explicitSecretId}`)
    return {
      secretId: secret.id,
      nextApiKeyRef: `secret:${secret.id}`,
      createdSecret: false,
    }
  }

  const envVar = normalizeCredentialEnvVar(args.envVar) ?? envVarFromApiKeyRef(args.currentApiKeyRef)
  if (!envVar) {
    throw new Error('Credential intake requires an envVar or existing secretId.')
  }
  const existing = await db.query.secretVault.findMany({
    where: eq(schema.secretVault.kind, 'env_ref'),
  })
  const match = existing.find((secret) => secret.valueRef === envVar && secret.status === 'active')
  if (match) {
    return {
      secretId: match.id,
      nextApiKeyRef: `secret:${match.id}`,
      createdSecret: false,
    }
  }
  if (!args.createIfMissing) {
    return {
      secretId: `pending:${envVar}`,
      nextApiKeyRef: `secret:<env:${envVar}>`,
      createdSecret: false,
    }
  }
  const secret = await createSecret({
    name: `${args.modelName} API key`,
    kind: 'env_ref',
    valueRef: envVar,
  })
  return {
    secretId: secret.id,
    nextApiKeyRef: `secret:${secret.id}`,
    createdSecret: true,
  }
}

async function ensureModelCredentialScope(
  secretId: string,
  modelProfileId: string,
  capability: 'model.connect' | 'model.invoke',
): Promise<{ created: boolean; scope: { id: string } }> {
  if (secretId.startsWith('pending:')) throw new Error('Cannot create credential scopes for a pending secret.')
  const scopes = await db.query.credentialScopes.findMany({
    where: eq(schema.credentialScopes.secretId, secretId),
  })
  const existing = scopes.find(
    (scope) =>
      scope.resourceType === 'model_profile' &&
      scope.resourceId === modelProfileId &&
      scope.capability === capability,
  )
  if (existing) return { created: false, scope: existing }
  const scope = await createCredentialScope({
    secretId,
    resourceType: 'model_profile',
    resourceId: modelProfileId,
    capability,
  })
  return { created: true, scope }
}

function normalizeCredentialEnvVar(value: string | null | undefined): string | null {
  const trimmed = value?.trim()
  if (!trimmed) return null
  const withoutPrefix = trimmed.startsWith('env:') ? trimmed.slice('env:'.length) : trimmed
  if (!/^[A-Z_][A-Z0-9_]*$/i.test(withoutPrefix)) {
    throw new Error('envVar must be an environment variable name such as OPENAI_API_KEY.')
  }
  return withoutPrefix
}

function envVarFromApiKeyRef(apiKeyRef: string): string | null {
  const trimmed = apiKeyRef.trim()
  if (!trimmed.startsWith('env:')) return null
  return normalizeCredentialEnvVar(trimmed.slice('env:'.length))
}

function onsiteIntakeField(args: {
  key: string
  label: string
  kind: ProductionOnsiteIntakeFieldKind
  ready: boolean
  required?: boolean
  redacted?: boolean
  valuePreview: string | null | undefined
  instructions: string[]
}): ProductionOnsiteIntakeField {
  const required = args.required ?? true
  return {
    key: args.key,
    label: args.label,
    kind: args.kind,
    required,
    redacted: args.redacted ?? false,
    currentStatus: args.ready ? 'ready' : required ? 'missing' : 'needs_review',
    valuePreview: args.valuePreview ?? null,
    instructions: uniqueNonEmpty(args.instructions).slice(0, 4),
  }
}

function buildOnsiteIntakeItem(args: {
  id: string
  domain: ProductionOnsiteIntakeDomain
  title: string
  ownerId: string | null
  riskLevel: 'low' | 'medium' | 'high'
  fields: ProductionOnsiteIntakeField[]
  validationCommands: ProductionOnsiteCommand[]
  evidence: string[]
  blockers: string[]
  nextActions: string[]
}): ProductionOnsiteIntakeItem {
  const missingRequired = args.fields.filter((field) => field.required && field.currentStatus !== 'ready')
  const blockers = uniqueNonEmpty(args.blockers)
  const ready = missingRequired.length === 0 && blockers.length === 0
  const status: ProductionIntegrationStatus = ready
    ? 'ready'
    : blockers.length > 0 || args.riskLevel === 'high'
      ? 'blocked'
      : 'not_configured'
  return {
    id: args.id,
    domain: args.domain,
    title: args.title,
    ownerId: args.ownerId,
    status,
    ready,
    riskLevel: args.riskLevel,
    fields: args.fields,
    validationCommands: args.validationCommands,
    evidence: uniqueNonEmpty(args.evidence).slice(0, 10),
    blockers: uniqueNonEmpty([
      ...blockers,
      ...missingRequired.map((field) => `${field.label} 还没有准备好。`),
    ]).slice(0, 10),
    nextActions: uniqueNonEmpty([
      ...args.nextActions,
      ...missingRequired.flatMap((field) => field.instructions),
    ]).slice(0, 10),
  }
}

function onsiteIntakeItemToProbe(item: ProductionOnsiteIntakeItem): ProductionProbeResult {
  return {
    key: `onsite_intake_${item.id.replace(/[^a-z0-9_-]/gi, '_')}`,
    label: item.title,
    status: item.status,
    evidence: [
      `${item.fields.filter((field) => field.currentStatus === 'ready').length}/${item.fields.length} 个字段已准备`,
      ...item.evidence,
    ],
    warnings: item.blockers,
    nextActions: item.nextActions,
    checkedAt: Date.now(),
  }
}

function credentialItemHasUsableSecret(model: ProductionModelCredentialItem): boolean {
  if (model.credential.refKind === 'secret_vault') {
    return model.credential.secretValuePresent === true && model.credential.secretResolvable !== false
  }
  if (model.credential.refKind === 'env') return model.credential.envValuePresent === true
  return false
}

function finalAcceptanceCategoryKeys(): ProductionFinalAcceptanceCategoryKey[] {
  return [
    'model_credentials',
    'desktop_control',
    'mobile_control',
    'workstations',
    'customer_authorization',
    'runtime_guardrails',
    'hardening',
    'rollback',
  ]
}

function normalizeFinalAcceptanceCategory(value: string): ProductionFinalAcceptanceCategoryKey {
  const normalized = value.trim() as ProductionFinalAcceptanceCategoryKey
  if (!finalAcceptanceCategoryKeys().includes(normalized)) {
    throw new Error(`Unsupported final acceptance evidence category: ${value}`)
  }
  return normalized
}

function assertRedactedOnsiteEvidence(args: {
  title: string
  evidence: string[]
  notes?: string | null
  operator?: string | null
  externalRef?: string | null
}) {
  const fields = [
    ['title', args.title],
    ...args.evidence.map((item, index) => [`evidence[${index}]`, item] as const),
    ['notes', args.notes ?? ''],
    ['operator', args.operator ?? ''],
    ['externalRef', args.externalRef ?? ''],
  ] as const
  const hits = fields.flatMap(([field, value]) =>
    detectSensitiveOnsiteEvidence(value).map((label) => `${field}:${label}`),
  )
  if (hits.length > 0) {
    throw new Error(
      `Onsite evidence appears to contain sensitive material (${[...new Set(hits)].join(', ')}). Store only redacted references, hashes, or evidence IDs.`,
    )
  }
}

function detectSensitiveOnsiteEvidence(value: string): string[] {
  const text = value.trim()
  if (!text) return []
  const patterns: Array<{ label: string; regex: RegExp }> = [
    {
      label: 'credential_assignment',
      regex: /\b(?:api[_ -]?key|secret[_ -]?key|access[_ -]?token|refresh[_ -]?token|password|passwd|pwd|cookie|authorization)\s*[:=]\s*\S{4,}/i,
    },
    { label: 'bearer_token', regex: /\bBearer\s+[A-Za-z0-9._~+/=-]{12,}/i },
    { label: 'openai_style_key', regex: /\bsk-[A-Za-z0-9_-]{12,}/i },
    { label: 'remote_desktop_secret', regex: /\b(?:password\s+51|credential(?:s)?)\s*:/i },
    {
      label: 'phone_unlock_code',
      regex: /\b(?:unlock|pin|passcode|phone\s*code|mobile\s*code|解锁码|手机验证码)\s*[:：=]\s*\d{4,8}\b/i,
    },
    {
      label: 'payment_card',
      regex: /\b(?:card|credit\s*card|payment)\s*(?:number|no\.?)?\s*[:=]\s*\d[\d\s-]{11,}\d/i,
    },
    {
      label: 'chinese_secret_assignment',
      regex: /(?:密码|密钥|令牌|授权头|Cookie|API\s*Key)\s*[:：=]\s*\S{4,}/i,
    },
  ]
  return patterns.filter((pattern) => pattern.regex.test(text)).map((pattern) => pattern.label)
}

function nullableTextValue(value: string | null | undefined): string | null {
  const normalized = value?.trim()
  return normalized ? normalized : null
}

function onsiteEvidenceRecordFromAuditLog(log: {
  action: string
  metadata: JsonObject
  createdAt: number
}): ProductionOnsiteEvidenceRecord | null {
  if (log.action !== 'production.final_acceptance.evidence') return null
  const metadata = log.metadata
  try {
    const category = normalizeFinalAcceptanceCategory(String(metadata.category ?? ''))
    const evidence = Array.isArray(metadata.evidence)
      ? metadata.evidence.map((item) => String(item)).filter(Boolean)
      : []
    if (!metadata.id || !metadata.title || evidence.length === 0 || !metadata.contentHash) return null
    return {
      id: String(metadata.id),
      category,
      title: String(metadata.title),
      evidence,
      notes: nullableTextValue(typeof metadata.notes === 'string' ? metadata.notes : null),
      operator: nullableTextValue(typeof metadata.operator === 'string' ? metadata.operator : null),
      externalRef: nullableTextValue(typeof metadata.externalRef === 'string' ? metadata.externalRef : null),
      riskLevel:
        metadata.riskLevel === 'low' || metadata.riskLevel === 'high' ? metadata.riskLevel : 'medium',
      contentHash: String(metadata.contentHash),
      verifiedAt: typeof metadata.verifiedAt === 'number' ? metadata.verifiedAt : log.createdAt,
      createdAt: typeof metadata.createdAt === 'number' ? metadata.createdAt : log.createdAt,
    }
  } catch {
    return null
  }
}

function onsiteEvidenceForCategory(
  records: ProductionOnsiteEvidenceRecord[],
  category: ProductionFinalAcceptanceCategoryKey,
): string[] {
  return records
    .filter((record) => record.category === category)
    .slice(0, 4)
    .flatMap((record) => [
      `现场证据：${record.title}`,
      ...record.evidence.slice(0, 2),
      `证据哈希=${record.contentHash}`,
    ])
}

type CustomerAuthorizationEvidenceGate = {
  switchEnabled: boolean
  evidenceHash: string | null
  evidenceHashPresent: boolean
  evidenceMatched: boolean
  matchedEvidence: ProductionOnsiteEvidenceRecord | null
  status: ProductionIntegrationStatus
  ready: boolean
  evidence: string[]
  warnings: string[]
  nextActions: string[]
}

async function getCustomerAuthorizationEvidenceGate(): Promise<CustomerAuthorizationEvidenceGate> {
  const auditLogs = await db.query.auditLogs.findMany({
    orderBy: [desc(schema.auditLogs.createdAt)],
    limit: PRODUCTION_AUDIT_LOOKBACK_LIMIT,
  })
  const records = auditLogs
    .map(onsiteEvidenceRecordFromAuditLog)
    .filter((record): record is ProductionOnsiteEvidenceRecord => Boolean(record))
  return customerAuthorizationEvidenceGateFromRecords(records)
}

function customerAuthorizationEvidenceGateFromRecords(
  records: ProductionOnsiteEvidenceRecord[],
): CustomerAuthorizationEvidenceGate {
  const switchEnabled = process.env[CUSTOMER_AUTHORIZATION_ENV] === '1'
  const evidenceHash = process.env[CUSTOMER_AUTHORIZATION_EVIDENCE_HASH_ENV]?.trim() || null
  const authorizationRecords = records.filter((record) => record.category === 'customer_authorization')
  const matchedEvidence = evidenceHash
    ? authorizationRecords.find((record) => record.contentHash === evidenceHash) ?? null
    : null
  const evidenceHashPresent = Boolean(evidenceHash)
  const evidenceMatched = Boolean(matchedEvidence)
  const hashLooksValid = evidenceHash ? /^sha256:[a-f0-9]{64}$/i.test(evidenceHash) : false
  const status: ProductionIntegrationStatus = !switchEnabled
    ? 'not_configured'
    : !evidenceHashPresent || !hashLooksValid || !evidenceMatched
      ? 'blocked'
      : 'ready'
  const evidence = uniqueNonEmpty([
    `${CUSTOMER_AUTHORIZATION_ENV}=${switchEnabled ? '1' : 'off'}`,
    `${CUSTOMER_AUTHORIZATION_EVIDENCE_HASH_ENV}=${evidenceHash ?? 'missing'}`,
    `客户授权证据记录=${authorizationRecords.length}`,
    ...(matchedEvidence
      ? [
          `匹配授权证据=${matchedEvidence.title}`,
          `匹配授权证据时间=${new Date(matchedEvidence.verifiedAt).toISOString()}`,
        ]
      : []),
  ])
  const warnings = uniqueNonEmpty([
    ...(switchEnabled ? [] : ['客户现场授权开关尚未开启。']),
    ...(evidenceHashPresent ? [] : [`缺少 ${CUSTOMER_AUTHORIZATION_EVIDENCE_HASH_ENV}，不能证明授权开关绑定到哪条现场证据。`]),
    ...(evidenceHash && !hashLooksValid ? [`${CUSTOMER_AUTHORIZATION_EVIDENCE_HASH_ENV} 不是有效 sha256 哈希。`] : []),
    ...(evidenceHashPresent && hashLooksValid && !evidenceMatched
      ? [`${CUSTOMER_AUTHORIZATION_EVIDENCE_HASH_ENV} 没有匹配任何客户授权现场证据。`]
      : []),
    ...(authorizationRecords.length === 0 ? ['还没有写入客户现场授权证据。'] : []),
  ])
  const nextActions = uniqueNonEmpty([
    ...(switchEnabled ? [] : [`客户确认测试账号、测试设备、允许范围和停止条件后，设置 ${CUSTOMER_AUTHORIZATION_ENV}=1。`]),
    ...(authorizationRecords.length === 0 ? ['在最终验收里写入一条“客户现场授权”证据，且不要包含密码、Cookie、验证码或客户隐私。'] : []),
    ...(evidenceHashPresent ? [] : [`把客户授权证据的 contentHash 写入 ${CUSTOMER_AUTHORIZATION_EVIDENCE_HASH_ENV}。`]),
    ...(evidenceHashPresent && !evidenceMatched ? [`检查 ${CUSTOMER_AUTHORIZATION_EVIDENCE_HASH_ENV} 是否复制了正确的客户授权证据哈希。`] : []),
  ])
  return {
    switchEnabled,
    evidenceHash,
    evidenceHashPresent,
    evidenceMatched,
    matchedEvidence,
    status,
    ready: status === 'ready',
    evidence,
    warnings,
    nextActions,
  }
}

function goLiveGateReason(key: ProductionEnvironmentGate['key']): string {
  switch (key) {
    case 'customer_authorization':
      return '确认客户已授权测试账号、测试设备和真实操作范围。'
    case 'customer_authorization_evidence_hash':
      return '把客户授权开关绑定到一条已写入、已脱敏的现场授权证据哈希。'
    case 'model_connect':
      return '允许外部模型真实连接测试请求进入生产路径。'
    case 'model_invoke':
      return '允许外部模型真实推理请求进入生产路径。'
    case 'desktop_control':
      return '允许 Agent 真实点击、输入和聚焦 Windows 桌面。'
    case 'desktop_capture':
      return '允许 Agent 截取真实桌面画面作为操作证据。'
    case 'mobile_control':
      return '允许 Agent 通过 ADB/Appium 对测试手机执行点击、输入和按键。'
    case 'mobile_capture':
      return '允许 Agent 截取测试手机屏幕作为操作证据。'
    case 'workstation_launch':
      return '允许 Agent 启动 RDP/远程工作站会话。'
    default:
      return '允许生产现场按该开关启用对应真实能力。'
  }
}

function goLiveEnvironmentGates(): ProductionEnvironmentGate[] {
  return [
    {
      key: 'customer_authorization',
      label: '客户现场授权',
      envVar: CUSTOMER_AUTHORIZATION_ENV,
      enabled: process.env[CUSTOMER_AUTHORIZATION_ENV] === '1',
      riskLevel: 'high',
      purpose: '确认客户已授权真实模型、桌面、手机和远程工作站测试范围。',
    },
    {
      key: 'customer_authorization_evidence_hash',
      label: '客户授权证据哈希',
      envVar: CUSTOMER_AUTHORIZATION_EVIDENCE_HASH_ENV,
      enabled: Boolean(process.env[CUSTOMER_AUTHORIZATION_EVIDENCE_HASH_ENV]?.trim()),
      riskLevel: 'high',
      purpose: '把客户授权开关绑定到一条脱敏现场证据哈希，防止仅靠布尔开关误放行。',
    },
    ...productionEnvironmentGates(),
  ]
}

function goLiveRuntimeGuardActivationInstructions(): ProductionGoLiveActivationInstruction[] {
  return [
    {
      envVar: 'AGENTHUB_RUNTIME_CONTROL_KILL_SWITCH',
      label: '运行时控制急停',
      currentlyEnabled: process.env.AGENTHUB_RUNTIME_CONTROL_KILL_SWITCH !== '1',
      requiredForLive: true,
      riskLevel: 'high',
      powershellPreview: "$env:AGENTHUB_RUNTIME_CONTROL_KILL_SWITCH='0'",
      reason: '只有客户授权、上线批准哈希和运行目标白名单都准备好后，才能确认急停不会阻断获批动作。',
    },
    {
      envVar: MODEL_ENDPOINT_HOST_ALLOWLIST_ENV,
      label: '模型接口主机白名单',
      currentlyEnabled: Boolean(process.env[MODEL_ENDPOINT_HOST_ALLOWLIST_ENV]?.trim()),
      requiredForLive: true,
      riskLevel: 'high',
      powershellPreview: `$env:${MODEL_ENDPOINT_HOST_ALLOWLIST_ENV}='api.openai.com; api.anthropic.com; generativelanguage.googleapis.com'`,
      reason: '把带凭证的真实模型流量限制到客户批准的模型供应商主机。',
    },
    {
      envVar: 'AGENTHUB_ALLOWED_DESKTOP_TARGETS',
      label: '桌面窗口/进程白名单',
      currentlyEnabled: Boolean(process.env.AGENTHUB_ALLOWED_DESKTOP_TARGETS?.trim()),
      requiredForLive: true,
      riskLevel: 'high',
      powershellPreview: "$env:AGENTHUB_ALLOWED_DESKTOP_TARGETS='Chrome; Customer Test App'",
      reason: '把真实桌面点击、输入、聚焦和截图限制到客户批准的窗口或进程。',
    },
    {
      envVar: 'AGENTHUB_ALLOWED_MOBILE_DEVICE_IDS',
      label: '手机设备 ID 白名单',
      currentlyEnabled: Boolean(process.env.AGENTHUB_ALLOWED_MOBILE_DEVICE_IDS?.trim()),
      requiredForLive: true,
      riskLevel: 'high',
      powershellPreview: "$env:AGENTHUB_ALLOWED_MOBILE_DEVICE_IDS='emulator-5554; R58N123ABC'",
      reason: '把真实 ADB/Appium 手机控制限制到客户批准的测试设备。',
    },
    {
      envVar: 'AGENTHUB_ALLOWED_MOBILE_APP_PACKAGES',
      label: '手机应用包名白名单',
      currentlyEnabled: Boolean(process.env.AGENTHUB_ALLOWED_MOBILE_APP_PACKAGES?.trim()),
      requiredForLive: true,
      riskLevel: 'high',
      powershellPreview: "$env:AGENTHUB_ALLOWED_MOBILE_APP_PACKAGES='com.customer.app; com.android.chrome'",
      reason: '把真实手机点按、输入、滑动和按键限制到客户批准的 Android 包名。',
    },
    {
      envVar: 'AGENTHUB_ALLOWED_WORKSTATION_TARGETS',
      label: 'VM/RDP/VNC 工作站目标白名单',
      currentlyEnabled: Boolean(process.env.AGENTHUB_ALLOWED_WORKSTATION_TARGETS?.trim()),
      requiredForLive: true,
      riskLevel: 'high',
      powershellPreview: "$env:AGENTHUB_ALLOWED_WORKSTATION_TARGETS='aws_123; customer-rdp-host; AgentVM'",
      reason: '把真实远程工作站启动限制到客户批准的工作站 ID 或远程目标。',
    },
  ]
}

function goLiveEnvironmentFingerprint(envVars: string[]): ProductionGoLiveEnvironmentFingerprint[] {
  return [...new Set(envVars)]
    .sort((a, b) => a.localeCompare(b))
    .map((envVar) => {
      const value = process.env[envVar]?.trim() ?? ''
      return {
        envVar,
        configured: value.length > 0,
        valueHash: value ? `sha256:${sha256(value)}` : null,
      }
    })
}

function finalAcceptanceCategory(args: {
  key: ProductionFinalAcceptanceCategoryKey
  title: string
  status: ProductionIntegrationStatus
  passed: boolean
  requiredEvidence: string[]
  presentEvidence: string[]
  missingEvidence: string[]
  blockers: string[]
  nextActions: string[]
}): ProductionFinalAcceptanceCategory {
  return {
    key: args.key,
    title: args.title,
    status: args.passed ? 'ready' : args.status,
    passed: args.passed,
    requiredEvidence: uniqueNonEmpty(args.requiredEvidence).slice(0, 10),
    presentEvidence: uniqueNonEmpty(args.presentEvidence).slice(0, 10),
    missingEvidence: uniqueNonEmpty(args.missingEvidence).slice(0, 10),
    blockers: uniqueNonEmpty(args.blockers).slice(0, 10),
    nextActions: uniqueNonEmpty(args.nextActions).slice(0, 10),
  }
}

function liveConnectorEnvGate(envVar: string): ProductionLiveConnectorEnvGate {
  const gate = productionEnvironmentGates().find((item) => item.envVar === envVar)
  return {
    envVar,
    label: gate?.label ?? envVar,
    enabled: process.env[envVar] === '1',
    requiredForLive: true,
  }
}

function liveConnectorValueEnvGate(
  envVar: string,
  label: string,
  enabled: boolean,
): ProductionLiveConnectorEnvGate {
  return {
    envVar,
    label,
    enabled,
    requiredForLive: true,
  }
}

function domainToLiveConnector(args: {
  id: string
  kind: Extract<ProductionLiveConnector['kind'], 'desktop' | 'mobile' | 'workstation'>
  domain: RealControlDomainAcceptance
  ownerId: string | null
  routeLabel: string
  envVars: string[]
  dryRunAvailable: boolean
}): ProductionLiveConnector {
  return {
    id: args.id,
    kind: args.kind,
    label: args.domain.label,
    status: args.domain.status,
    ready: args.domain.ready,
    ownerId: args.ownerId,
    routeLabel: args.routeLabel,
    verification: {
      dryRunAvailable: args.dryRunAvailable,
      liveEvidenceCount: args.domain.liveExecutions,
      lastLiveEvidenceAt: latestGateActionAt(args.domain.gates),
    },
    envGates: args.envVars.map(liveConnectorEnvGate),
    evidence: args.domain.evidence,
    warnings: args.domain.warnings,
    blockers: args.domain.blockers,
    nextActions: args.domain.nextActions,
  }
}

function latestGateActionAt(gates: RuntimeControlGateProbe[]): number | null {
  const timestamps = gates
    .map((gate) => gate.lastActionAt)
    .filter((value): value is number => typeof value === 'number')
  return timestamps.length > 0 ? Math.max(...timestamps) : null
}

function liveConnectorToProbe(connector: ProductionLiveConnector): ProductionProbeResult {
  return {
    key: `live_connector_${connector.kind}_${connector.id.replace(/[^a-zA-Z0-9_-]/g, '_')}`,
    label: connector.label,
    status: connector.status,
    evidence: connector.evidence,
    warnings: [...connector.warnings, ...connector.blockers],
    nextActions: connector.nextActions,
    checkedAt: Date.now(),
  }
}

function connectorStepStatus(connector: ProductionLiveConnector | null): ProductionSetupStepStatus {
  if (!connector) return 'needs_action'
  if (connector.ready) return 'done'
  if (connector.status === 'blocked') return 'blocked'
  return 'needs_action'
}

function onsiteActivationStep(step: ProductionOnsiteActivationStep): ProductionOnsiteActivationStep {
  return {
    ...step,
    evidence: uniqueNonEmpty(step.evidence).slice(0, 6),
    actions: uniqueNonEmpty(step.actions).slice(0, 6),
    verification: uniqueNonEmpty(step.verification).slice(0, 6),
    rollback: uniqueNonEmpty(step.rollback).slice(0, 6),
  }
}

function onsiteStepToProbe(step: ProductionOnsiteActivationStep): ProductionProbeResult {
  return {
    key: `onsite_activation_${step.id}`,
    label: step.title,
    status:
      step.status === 'done'
        ? 'ready'
        : step.status === 'blocked'
          ? 'blocked'
          : 'available',
    evidence: step.evidence,
    warnings: step.status === 'done' ? [] : step.actions,
    nextActions: step.actions,
    checkedAt: Date.now(),
  }
}

function buildOnsiteEnvChecklist(connectors: ProductionLiveConnector[]): ProductionOnsiteEnvInstruction[] {
  const gates = new Map<string, ProductionLiveConnectorEnvGate>()
  for (const connector of connectors) {
    for (const gate of connector.envGates) {
      if (!gates.has(gate.envVar)) gates.set(gate.envVar, gate)
    }
  }
  const envInstructions = [...gates.values()]
    .sort((a, b) => a.envVar.localeCompare(b.envVar))
    .map((gate) => ({
      envVar: gate.envVar,
      label: gate.label,
      enabled: gate.enabled,
      requiredForLive: gate.requiredForLive,
      valueHint: gate.envVar === CUSTOMER_AUTHORIZATION_EVIDENCE_HASH_ENV
        ? '填入“客户现场授权”证据的 sha256:... contentHash'
        : gate.envVar.includes('AUTHORIZED')
        ? '客户授权后设置为 1'
        : gate.envVar.includes('MODEL')
          ? '完成模型凭证和供应商授权后设置为 1'
          : '只在客户授权的测试环境设置为 1',
      powershellPreview: gate.envVar === CUSTOMER_AUTHORIZATION_EVIDENCE_HASH_ENV
        ? `$env:${gate.envVar}='sha256:...'`
        : `$env:${gate.envVar}='1'`,
    }))
  for (const instruction of buildOnsiteRuntimeGuardEnvInstructions()) {
    const existing = envInstructions.findIndex((item) => item.envVar === instruction.envVar)
    if (existing >= 0) envInstructions[existing] = instruction
    else envInstructions.push(instruction)
  }
  return envInstructions.sort((a, b) => a.envVar.localeCompare(b.envVar))
}

function buildOnsiteRuntimeGuardEnvInstructions(): ProductionOnsiteEnvInstruction[] {
  return [
    {
      envVar: 'AGENTHUB_RUNTIME_CONTROL_KILL_SWITCH',
      label: '运行时控制急停',
      enabled: process.env.AGENTHUB_RUNTIME_CONTROL_KILL_SWITCH !== '1',
      requiredForLive: true,
      valueHint: '获批真实执行时保持 0/off；紧急停止时设为 1。',
      powershellPreview: "$env:AGENTHUB_RUNTIME_CONTROL_KILL_SWITCH='0'",
    },
    {
      envVar: MODEL_ENDPOINT_HOST_ALLOWLIST_ENV,
      label: '模型接口主机白名单',
      enabled: Boolean(process.env[MODEL_ENDPOINT_HOST_ALLOWLIST_ENV]?.trim()),
      requiredForLive: true,
      valueHint: '用分号分隔客户批准的模型供应商主机，例如 api.openai.com; api.anthropic.com; generativelanguage.googleapis.com。',
      powershellPreview: `$env:${MODEL_ENDPOINT_HOST_ALLOWLIST_ENV}='api.openai.com; api.anthropic.com; generativelanguage.googleapis.com'`,
    },
    {
      envVar: 'AGENTHUB_ALLOWED_DESKTOP_TARGETS',
      label: '桌面窗口/进程白名单',
      enabled: Boolean(process.env.AGENTHUB_ALLOWED_DESKTOP_TARGETS?.trim()),
      requiredForLive: true,
      valueHint: '用分号分隔客户批准的进程或窗口目标，例如 Chrome; Figma; Customer Test App。',
      powershellPreview: "$env:AGENTHUB_ALLOWED_DESKTOP_TARGETS='Chrome; Customer Test App'",
    },
    {
      envVar: 'AGENTHUB_ALLOWED_MOBILE_DEVICE_IDS',
      label: '手机设备 ID 白名单',
      enabled: Boolean(process.env.AGENTHUB_ALLOWED_MOBILE_DEVICE_IDS?.trim()),
      requiredForLive: true,
      valueHint: '用分号分隔客户批准的 ADB/Appium 设备 ID，例如 emulator-5554; R58N123ABC。',
      powershellPreview: "$env:AGENTHUB_ALLOWED_MOBILE_DEVICE_IDS='emulator-5554; R58N123ABC'",
    },
    {
      envVar: 'AGENTHUB_ALLOWED_MOBILE_APP_PACKAGES',
      label: '手机应用包名白名单',
      enabled: Boolean(process.env.AGENTHUB_ALLOWED_MOBILE_APP_PACKAGES?.trim()),
      requiredForLive: true,
      valueHint: '用分号分隔客户批准的 Android 包名，用于真实点按、输入和按键动作，例如 com.customer.app; com.android.chrome。',
      powershellPreview: "$env:AGENTHUB_ALLOWED_MOBILE_APP_PACKAGES='com.customer.app; com.android.chrome'",
    },
    {
      envVar: 'AGENTHUB_ALLOWED_WORKSTATION_TARGETS',
      label: 'VM/RDP/VNC 工作站目标白名单',
      enabled: Boolean(process.env.AGENTHUB_ALLOWED_WORKSTATION_TARGETS?.trim()),
      requiredForLive: true,
      valueHint: '用分号分隔客户批准的工作站 ID、RDP 主机、VM 名称或远程目标，例如 aws_123; customer-rdp-host; AgentVM。',
      powershellPreview: "$env:AGENTHUB_ALLOWED_WORKSTATION_TARGETS='aws_123; customer-rdp-host; AgentVM'",
    },
  ]
}

function buildOnsiteValidationCommands(): ProductionOnsiteCommand[] {
  return [
    {
      label: '重新生成真实控制验收',
      command: 'GET /api/production-integrations/real-control/report',
      riskLevel: 'low',
      requiresHuman: false,
      notes: ['只读检查，不会点击、输入或启动远程会话。'],
    },
    {
      label: '重新生成现场连接档案',
      command: 'GET /api/production-integrations/live-connectors/report',
      riskLevel: 'low',
      requiresHuman: false,
      notes: ['检查模型、桌面、手机、工作站和客户授权是否齐备。'],
    },
    {
      label: '导出客户环境验收包',
      command: 'POST /api/production-integrations/customer-environment/package',
      riskLevel: 'low',
      requiresHuman: false,
      notes: ['导出内容会脱敏，不包含 API Key、密码、Cookie 或远程桌面凭证。'],
    },
  ]
}

function buildOnsiteRollbackPlan(envChecklist: ProductionOnsiteEnvInstruction[]): ProductionOnsiteCommand[] {
  const highRiskEnvVars = envChecklist.filter((item) => item.requiredForLive).map((item) => item.envVar)
  return [
    ...highRiskEnvVars.map((envVar): ProductionOnsiteCommand => ({
      label: `关闭 ${envVar}`,
      command: rollbackCommandForEnvVar(envVar),
      riskLevel: 'medium',
      requiresHuman: true,
      notes: ['当前进程内立即关闭；如使用系统级环境变量，也需要同步移除或改为 0。'],
    })),
    {
      label: '暂停所有 Agent 运行',
      command: 'POST /api/workflow-runs/:id/pause 或 POST /api/agent-runs/:id/pause',
      riskLevel: 'medium',
      requiresHuman: true,
      notes: ['在真实控制异常时先暂停运行，再检查资源锁和审计日志。'],
    },
  ]
}

function rollbackCommandForEnvVar(envVar: string): string {
  if (envVar === 'AGENTHUB_RUNTIME_CONTROL_KILL_SWITCH') {
    return "$env:AGENTHUB_RUNTIME_CONTROL_KILL_SWITCH='1'"
  }
  if (
    envVar === 'AGENTHUB_ALLOWED_DESKTOP_TARGETS' ||
    envVar === 'AGENTHUB_ALLOWED_MOBILE_DEVICE_IDS' ||
    envVar === 'AGENTHUB_ALLOWED_MOBILE_APP_PACKAGES' ||
    envVar === 'AGENTHUB_ALLOWED_WORKSTATION_TARGETS' ||
    envVar === CUSTOMER_AUTHORIZATION_EVIDENCE_HASH_ENV ||
    envVar === MODEL_ENDPOINT_HOST_ALLOWLIST_ENV
  ) {
    return `$env:${envVar}=''`
  }
  return `$env:${envVar}='0'`
}

function buildRealControlDomainAcceptance(args: {
  key: RealControlDomainAcceptance['key']
  label: string
  toolchain: ProductionProbeResult
  gates: RuntimeControlGateProbe[]
  requiredProbeReady: boolean
  toolchainBlockers: string[]
  extraEvidence: string[]
  readyRequiresLive: boolean
}): RealControlDomainAcceptance {
  const liveExecutions = args.gates.reduce((sum, gate) => sum + gate.liveExecutions, 0)
  const blockedActions = args.gates.reduce((sum, gate) => sum + gate.blockedActions, 0)
  const highRiskGates = args.gates.filter((gate) => !gate.readOnly)
  const missingEnvGates = highRiskGates.filter((gate) => !gate.envEnabled)
  const missingApprovalGates = highRiskGates.filter(
    (gate) => gate.approvalRequired && gate.approvedRuntimeControlApprovals === 0,
  )
  const missingLiveEvidence = args.readyRequiresLive
    ? highRiskGates.filter((gate) => gate.liveExecutions === 0)
    : []
  const blockers = uniqueNonEmpty([
    ...args.toolchainBlockers,
    ...missingEnvGates.map((gate) => `${gate.label} 缺少 ${gate.envVar} 环境开关。`),
    ...missingApprovalGates.map((gate) => `${gate.label} 缺少已批准的真实控制审批。`),
    ...missingLiveEvidence.map((gate) => `${gate.label} 还没有真实执行证据。`),
  ])
  const ready = args.requiredProbeReady && blockers.length === 0
  const status: ProductionIntegrationStatus = ready
    ? 'ready'
    : args.toolchain.status === 'not_installed'
      ? 'not_installed'
      : args.toolchain.status === 'blocked'
        ? 'blocked'
        : args.requiredProbeReady || liveExecutions > 0 || args.gates.some((gate) => gate.completedActions > 0)
          ? 'available'
          : args.toolchain.status === 'not_configured'
            ? 'not_configured'
            : 'available'

  return {
    key: args.key,
    label: args.label,
    status,
    toolchainStatus: args.toolchain.status,
    gates: args.gates,
    evidence: uniqueNonEmpty([
      ...args.extraEvidence,
      ...args.toolchain.evidence,
      ...args.gates.flatMap((gate) => gate.evidence),
      `${liveExecutions} 条真实执行证据`,
      `${blockedActions} 条被拦截动作`,
    ]).slice(0, 10),
    warnings: uniqueNonEmpty([
      ...args.toolchain.warnings,
      ...args.gates.flatMap((gate) => gate.warnings),
      ...(!args.requiredProbeReady ? args.toolchainBlockers : []),
    ]).slice(0, 10),
    blockers: blockers.slice(0, 10),
    nextActions: uniqueNonEmpty([
      ...args.toolchain.nextActions,
      ...args.gates.flatMap((gate) => gate.nextActions),
      ...blockers.map((blocker) => `处理：${blocker}`),
    ]).slice(0, 10),
    liveExecutions,
    blockedActions,
    ready,
  }
}

function domainAcceptanceToProbe(domain: RealControlDomainAcceptance): ProductionProbeResult {
  return {
    key: `real_control_${domain.key}`,
    label: domain.label,
    status: domain.status,
    evidence: domain.evidence,
    warnings: domain.warnings,
    nextActions: domain.nextActions,
    checkedAt: Date.now(),
  }
}

function customerCheck(args: Omit<ProductionProbeResult, 'checkedAt'>): ProductionProbeResult {
  return {
    ...args,
    evidence: uniqueNonEmpty(args.evidence).slice(0, 8),
    warnings: uniqueNonEmpty(args.warnings).slice(0, 8),
    nextActions: uniqueNonEmpty(args.nextActions).slice(0, 10),
    checkedAt: Date.now(),
  }
}

function hasSoftwareCommandApprovalBinding(approval: ApprovalRequestRow): boolean {
  if (approval.type !== 'software_command_execute') return false
  if (typeof approval.payload.inputHash !== 'string') return false
  if (!Object.prototype.hasOwnProperty.call(approval.payload, 'runtimeControl')) return false
  const runtimeControl = approval.payload.runtimeControl
  if (runtimeControl === null) return true
  if (!runtimeControl || typeof runtimeControl !== 'object' || Array.isArray(runtimeControl)) return false
  const record = runtimeControl as Record<string, unknown>
  return (
    typeof record.scope === 'string' &&
    typeof record.actionType === 'string' &&
    typeof record.inputHash === 'string' &&
    (record.target === null || typeof record.target === 'string' || record.target === undefined)
  )
}

function hasSoftwareCommandRuntimeApprovalInputBinding(approval: ApprovalRequestRow): boolean {
  if (!hasSoftwareCommandApprovalBinding(approval)) return false
  const runtimeControl = approval.payload.runtimeControl
  if (!runtimeControl || typeof runtimeControl !== 'object' || Array.isArray(runtimeControl)) return false
  const record = runtimeControl as Record<string, unknown>
  return (
    typeof record.approvalInputHash === 'string' &&
    Boolean(record.approvalInput) &&
    typeof record.approvalInput === 'object' &&
    !Array.isArray(record.approvalInput)
  )
}

function hasRuntimeControlApprovalBinding(approval: ApprovalRequestRow): boolean {
  if (approval.type !== 'runtime_control_action') return false
  return (
    typeof approval.payload.inputHash === 'string' &&
    typeof approval.payload.scope === 'string' &&
    typeof approval.payload.actionType === 'string'
  )
}

function runtimeControlOutputGate(event: { output: JsonObject }): Record<string, unknown> | null {
  const gate = event.output.gate
  return gate && typeof gate === 'object' && !Array.isArray(gate)
    ? gate as Record<string, unknown>
    : null
}

function hasDesktopInputFocusBinding(event: { output: JsonObject }): boolean {
  const output = event.output as Record<string, unknown>
  const approvalInput = objectValue(output.approvalInput)
  const focusRequired = output.desktopFocusRequired === true || approvalInput?.desktopFocusRequired === true
  if (!focusRequired) return false
  const focusTarget =
    readStringValue(output.desktopFocusTarget) ??
    readStringValue(approvalInput?.desktopFocusTarget) ??
    readStringValue(output.desktopFocusProcessName) ??
    readStringValue(approvalInput?.desktopFocusProcessName) ??
    readStringValue(output.desktopFocusTitleContains) ??
    readStringValue(approvalInput?.desktopFocusTitleContains)
  return Boolean(focusTarget)
}

function hasRuntimeFileOutputEvidence(event: { output: JsonObject }): boolean {
  const output = event.output as Record<string, unknown>
  const launchPlan = objectValue(output.launchPlan)
  return Boolean(
    typeof output.screenshotPath === 'string' ||
      typeof output.plannedScreenshotPath === 'string' ||
      typeof output.rdpFile === 'string' ||
      typeof output.rdpFileRelativePath === 'string' ||
      output.screenshotPathRedacted === true ||
      output.plannedScreenshotPathRedacted === true ||
      output.rdpFilePathRedacted === true ||
      launchPlan?.rdpFilePathRedacted === true,
  )
}

function isRuntimeFileOutputRedacted(event: { output: JsonObject }): boolean {
  const output = event.output as Record<string, unknown>
  const launchPlan = objectValue(output.launchPlan)
  const redacted =
    output.screenshotPathRedacted === true ||
    output.plannedScreenshotPathRedacted === true ||
    output.rdpFilePathRedacted === true ||
    launchPlan?.rdpFilePathRedacted === true
  if (!redacted) return false
  const pathValues = [
    output.screenshotPath,
    output.plannedScreenshotPath,
    output.rdpFile,
    output.rdpFileRelativePath,
    launchPlan?.rdpFileName,
  ]
  return !pathValues.some((value) => typeof value === 'string' && looksLikeAbsoluteLocalPath(value))
}

function objectValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function readStringValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function looksLikeAbsoluteLocalPath(value: string): boolean {
  return /^[a-zA-Z]:[\\/]/.test(value) || value.startsWith('\\\\') || value.startsWith('/')
}

function productionEnvironmentGates(): ProductionEnvironmentGate[] {
  return [
    {
      key: 'network_egress_test',
      label: '真实网络出口 IP 检测',
      envVar: 'AGENTHUB_ENABLE_REAL_NETWORK_EGRESS_TEST',
      enabled: process.env.AGENTHUB_ENABLE_REAL_NETWORK_EGRESS_TEST === '1',
      riskLevel: 'medium',
      purpose: '允许系统向客户批准的 IP Echo 服务发起一次外部请求，以验证模型/代理出口落地 IP。',
    },
    {
      key: 'model_connect',
      label: '真实模型连接测试',
      envVar: 'AGENTHUB_ENABLE_REAL_MODEL_CONNECTION',
      enabled: process.env.AGENTHUB_ENABLE_REAL_MODEL_CONNECTION === '1',
      riskLevel: 'medium',
      purpose: '允许系统向外部模型供应商发起带凭据的真实连接测试请求。',
    },
    {
      key: 'model_invoke',
      label: '真实模型推理',
      envVar: 'AGENTHUB_ENABLE_REAL_MODEL_INVOCATION',
      enabled: process.env.AGENTHUB_ENABLE_REAL_MODEL_INVOCATION === '1',
      riskLevel: 'medium',
      purpose: '允许系统向外部模型发起真实推理请求。',
    },
    {
      key: 'desktop_control',
      label: '真实桌面点击输入',
      envVar: 'AGENTHUB_ENABLE_REAL_DESKTOP_CONTROL',
      enabled: process.env.AGENTHUB_ENABLE_REAL_DESKTOP_CONTROL === '1',
      riskLevel: 'high',
      purpose: '允许系统真实移动鼠标、点击、输入和聚焦窗口。',
    },
    {
      key: 'desktop_capture',
      label: '真实桌面截图',
      envVar: 'AGENTHUB_ENABLE_REAL_DESKTOP_CAPTURE',
      enabled: process.env.AGENTHUB_ENABLE_REAL_DESKTOP_CAPTURE === '1',
      riskLevel: 'high',
      purpose: '允许系统截取桌面画面并保存证据图片。',
    },
    {
      key: 'mobile_control',
      label: '真实手机点击输入',
      envVar: 'AGENTHUB_ENABLE_REAL_MOBILE_CONTROL',
      enabled: process.env.AGENTHUB_ENABLE_REAL_MOBILE_CONTROL === '1',
      riskLevel: 'high',
      purpose: '允许系统通过 ADB/Appium 对手机执行点按、输入和按键。',
    },
    {
      key: 'mobile_capture',
      label: '真实手机截图',
      envVar: 'AGENTHUB_ENABLE_REAL_MOBILE_CAPTURE',
      enabled: process.env.AGENTHUB_ENABLE_REAL_MOBILE_CAPTURE === '1',
      riskLevel: 'high',
      purpose: '允许系统通过 ADB/Appium 截取手机屏幕。',
    },
    {
      key: 'workstation_launch',
      label: '真实远程工作站启动',
      envVar: 'AGENTHUB_ENABLE_REAL_WORKSTATION_LAUNCH',
      enabled: process.env.AGENTHUB_ENABLE_REAL_WORKSTATION_LAUNCH === '1',
      riskLevel: 'high',
      purpose: '允许系统启动 RDP/远程工作站会话。',
    },
  ]
}

type PowerShellEnvPair = {
  name: string
  value: string
  label: string
  requiredForLive?: boolean
  currentlyEnabled?: boolean
  purpose?: string
}

function expectedPackageSchema(kind: ProductionPackageIntegrityKind): string {
  return kind === 'onsite_activation'
    ? 'agenthub.production_onsite_activation.v1'
    : 'agenthub.production_customer_environment.v1'
}

function productionPackageKindLabel(kind: ProductionPackageIntegrityKind): string {
  return kind === 'onsite_activation' ? 'Onsite activation' : 'Customer environment'
}

function packagePathValue(value: unknown, dataDir: string): string | null {
  if (typeof value !== 'string' || !value.trim()) return null
  const resolved = path.resolve(value)
  return pathInsideRoot(resolved, dataDir) ? resolved : null
}

function siblingPackagePath(manifestPath: string | null, fileName: string | null, dataDir: string): string | null {
  if (!manifestPath || !fileName) return null
  return packagePathValue(path.join(path.dirname(manifestPath), fileName), dataDir)
}

function pathInsideRoot(targetPath: string, rootPath: string): boolean {
  const root = path.resolve(rootPath).toLowerCase()
  const target = path.resolve(targetPath).toLowerCase()
  return target === root || target.startsWith(`${root}${path.sep}`)
}

async function readPackageFile(filePath: string, warnings: string[]): Promise<string | null> {
  if (!existsSync(filePath)) {
    warnings.push(`Package file is missing: ${path.basename(filePath)}`)
    return null
  }
  try {
    return await readFile(filePath, 'utf8')
  } catch (err) {
    warnings.push(`Package file cannot be read: ${path.basename(filePath)} (${err instanceof Error ? err.message : 'unknown error'})`)
    return null
  }
}

function readManifestFiles(manifestDocument: Record<string, unknown> | null): Record<string, unknown> {
  const files = manifestDocument?.files
  return files && typeof files === 'object' && !Array.isArray(files) ? (files as Record<string, unknown>) : {}
}

function scriptPathsForPackage(args: {
  kind: ProductionPackageIntegrityKind
  metadata: Record<string, unknown>
  manifestPath: string | null
  manifestFiles: Record<string, unknown>
  dataDir: string
}): string[] {
  if (args.kind === 'onsite_activation') {
    return [
      packagePathValue(args.metadata.activationScriptPath, args.dataDir) ??
        siblingPackagePath(args.manifestPath, stringField(args.manifestFiles.activationScriptFileName), args.dataDir),
      packagePathValue(args.metadata.rollbackScriptPath, args.dataDir) ??
        siblingPackagePath(args.manifestPath, stringField(args.manifestFiles.rollbackScriptFileName), args.dataDir),
    ].filter((value): value is string => Boolean(value))
  }
  return [
    packagePathValue(args.metadata.preflightScriptPath, args.dataDir) ??
      siblingPackagePath(args.manifestPath, stringField(args.manifestFiles.preflightScriptFileName), args.dataDir),
    packagePathValue(args.metadata.rollbackScriptPath, args.dataDir) ??
      siblingPackagePath(args.manifestPath, stringField(args.manifestFiles.rollbackScriptFileName), args.dataDir),
  ].filter((value): value is string => Boolean(value))
}

function expectedPackageContentHash(
  kind: ProductionPackageIntegrityKind,
  manifestDocument: Record<string, unknown>,
  markdown: string,
  scripts: string[],
): string {
  const manifestBase = JSON.parse(JSON.stringify(manifestDocument)) as Record<string, unknown>
  delete manifestBase.contentHash
  delete manifestBase.safetyNotice
  const manifestJson = `${stableStringify(manifestBase)}\n`
  const orderedScripts = kind === 'onsite_activation' ? scripts.slice(0, 2) : scripts.slice(0, 2)
  return `sha256:${sha256(`${manifestJson}\n${markdown}\n${orderedScripts.join('\n')}`)}`
}

function packageScriptHashesMatch(
  kind: ProductionPackageIntegrityKind,
  manifestDocument: Record<string, unknown>,
  scripts: string[],
): boolean {
  const scriptHashes = manifestDocument.scriptHashes
  if (!scriptHashes || typeof scriptHashes !== 'object' || Array.isArray(scriptHashes)) return false
  const hashes = scriptHashes as Record<string, unknown>
  const keys = kind === 'onsite_activation' ? ['activationScript', 'rollbackScript'] : ['preflightScript', 'rollbackScript']
  return keys.every((key, index) => stringField(hashes[key]) === `sha256:${sha256(scripts[index] ?? '')}`)
}

function stringField(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null
}

function numberField(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function dateLikeToMs(value: Date | number): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (value instanceof Date) return value.getTime()
  return null
}

function renderOnsiteActivationScript(
  packageId: string,
  guide: ProductionOnsiteActivationGuide,
): string {
  const envPairs = uniquePowerShellEnvPairs(guide.envChecklist.map(onsiteEnvInstructionToPowerShellPair))
  const lines: string[] = [
    '# AgentHub onsite activation script',
    '# Default mode is preview only.',
    '# Safety: this script does not run live desktop/mobile/workstation/model actions.',
    'param(',
    '  [switch]$ApplyEnv,',
    "  [string]$BaseUrl = 'http://127.0.0.1:3101'",
    ')',
    '',
    "$ErrorActionPreference = 'Stop'",
    `Write-Host ${powerShellSingleQuote(`AgentHub 现场激活脚本：${packageId}`)}`,
    "Write-Host 'Default mode: preview only. Pass -ApplyEnv to write env vars into this PowerShell process.'",
    "Write-Host 'Safety: this script does not run live desktop/mobile/workstation/model actions.'",
    '',
    '$envPairs = @(',
    ...renderPowerShellEnvPairs(envPairs),
    ')',
    '',
    'foreach ($item in $envPairs) {',
    '  if ($ApplyEnv) {',
    "    [Environment]::SetEnvironmentVariable([string]$item.Name, [string]$item.Value, 'Process')",
    "    Write-Host ('APPLIED {0}={1}' -f $item.Name, $item.Value)",
    '  } else {',
    "    Write-Host ('PREVIEW {0}={1}' -f $item.Name, $item.Value)",
    '  }',
    '}',
    '',
    '$validationCommands = @(',
    ...renderPowerShellCommandObjects(guide.validationCommands),
    ')',
    '',
    "Write-Host ''",
    "Write-Host 'Manual validation endpoints. Open these in AgentHub after env review; this script does not call them automatically.'",
    'foreach ($command in $validationCommands) {',
    "  Write-Host ('- [{0}] {1} :: {2}' -f $command.RiskLevel, $command.Label, $command.Command)",
    '}',
    '',
    "Write-Host ''",
    "Write-Host ('BaseUrl hint: {0}' -f $BaseUrl)",
    "Write-Host 'Activation is complete only after UI/API approval, audit evidence, go-live hash, and customer authorization all pass.'",
  ]
  return `${lines.join('\n')}\n`
}

function renderOnsiteRollbackScript(
  packageId: string,
  guide: ProductionOnsiteActivationGuide,
): string {
  const envPairs = uniquePowerShellEnvPairs(guide.rollbackPlan.map(onsiteRollbackCommandToPowerShellPair).filter(Boolean))
  const manualCommands = guide.rollbackPlan.filter((command) => !onsiteRollbackCommandToPowerShellPair(command))
  const lines: string[] = [
    '# AgentHub onsite rollback script',
    '# Default mode is preview only.',
    '# Safety: this script does not run live desktop/mobile/workstation/model actions.',
    'param(',
    '  [switch]$ApplyEnv',
    ')',
    '',
    "$ErrorActionPreference = 'Stop'",
    `Write-Host ${powerShellSingleQuote(`AgentHub 现场回滚脚本：${packageId}`)}`,
    "Write-Host 'Default mode: preview only. Pass -ApplyEnv to write rollback env vars into this PowerShell process.'",
    "Write-Host 'Safety: this script does not run live desktop/mobile/workstation/model actions.'",
    '',
    '$envPairs = @(',
    ...renderPowerShellEnvPairs(envPairs),
    ')',
    '',
    'foreach ($item in $envPairs) {',
    '  if ($ApplyEnv) {',
    "    [Environment]::SetEnvironmentVariable([string]$item.Name, [string]$item.Value, 'Process')",
    "    Write-Host ('APPLIED ROLLBACK {0}={1}' -f $item.Name, $item.Value)",
    '  } else {',
    "    Write-Host ('ROLLBACK PREVIEW {0}={1}' -f $item.Name, $item.Value)",
    '  }',
    '}',
    '',
    '$manualRollbackCommands = @(',
    ...renderPowerShellCommandObjects(manualCommands),
    ')',
    '',
    "Write-Host ''",
    "Write-Host 'Manual rollback actions to perform in AgentHub if needed:'",
    'foreach ($command in $manualRollbackCommands) {',
    "  Write-Host ('- [{0}] {1} :: {2}' -f $command.RiskLevel, $command.Label, $command.Command)",
    '}',
  ]
  return `${lines.join('\n')}\n`
}

function renderCustomerEnvironmentPreflightScript(
  packageId: string,
  report: ProductionCustomerEnvironmentReport,
): string {
  const envPairs = uniquePowerShellEnvPairs([
    ...report.envGates.map((gate): PowerShellEnvPair => ({
      name: gate.envVar,
      value: gate.enabled ? '1' : '',
      label: gate.label,
      requiredForLive: true,
      currentlyEnabled: gate.enabled,
      purpose: gate.purpose,
    })),
    {
      name: CUSTOMER_AUTHORIZATION_ENV,
      value: report.customerAuthorization.switchEnabled ? '1' : '',
      label: 'Customer authorization switch',
      requiredForLive: true,
      currentlyEnabled: report.customerAuthorization.switchEnabled,
      purpose: 'Customer authorization switch must be enabled only after explicit onsite approval.',
    },
    {
      name: CUSTOMER_AUTHORIZATION_EVIDENCE_HASH_ENV,
      value: report.customerAuthorization.evidenceHash ?? '',
      label: 'Customer authorization evidence hash',
      requiredForLive: true,
      currentlyEnabled: report.customerAuthorization.evidenceMatched,
      purpose: 'Bind live authorization to a redacted onsite customer-authorization evidence hash.',
    },
    ...report.runtimeGuards.map((guard): PowerShellEnvPair => ({
      name: guard.envVar,
      value: '',
      label: guard.key,
      requiredForLive: guard.required,
      currentlyEnabled: guard.configured,
      purpose: guard.purpose,
    })),
    {
      name: report.emergencyStop.envVar,
      value: report.emergencyStop.active ? '1' : '0',
      label: 'Runtime control emergency stop',
      requiredForLive: true,
      currentlyEnabled: report.emergencyStop.active,
      purpose: report.emergencyStop.purpose,
    },
  ])
  const lines: string[] = [
    '# AgentHub customer environment preflight',
    '# Read-only script. It does not mutate env vars, call external model providers, or control desktop/mobile/workstations.',
    'param(',
    "  [string]$BaseUrl = 'http://127.0.0.1:3101'",
    ')',
    '',
    "$ErrorActionPreference = 'Stop'",
    `Write-Host ${powerShellSingleQuote(`Customer environment preflight：${packageId}`)}`,
    "Write-Host 'Safety: this script does not call external model providers or control desktop/mobile/workstations.'",
    "Write-Host ('Host platform: {0}; arch: {1}; node: {2}; mode: {3}' -f $PSVersionTable.Platform, $env:PROCESSOR_ARCHITECTURE, $PSVersionTable.PSVersion, 'powershell')",
    `Write-Host ${powerShellSingleQuote(`AgentHub reported host：${report.host.platform}/${report.host.arch} Node ${report.host.node} ${report.host.electronMode}`)}`,
    '',
    '$requiredEnv = @(',
    ...renderPowerShellEnvPairs(envPairs),
    ')',
    '',
    'foreach ($item in $requiredEnv) {',
    "  $value = [Environment]::GetEnvironmentVariable([string]$item.Name, 'Process')",
    '  $configured = -not [string]::IsNullOrWhiteSpace($value)',
    '  if ($configured) {',
    "    Write-Host ('OK {0} configured' -f $item.Name)",
    '  } else {',
    "    Write-Host ('MISSING {0} :: {1}' -f $item.Name, $item.Purpose)",
    '  }',
    '}',
    '',
    "Write-Host ''",
    "Write-Host 'Manual validation endpoints. This script prints them only; it does not call them automatically.'",
    "Write-Host ('{0}/api/production-integrations/customer-environment/report' -f $BaseUrl)",
    "Write-Host ('{0}/api/production-integrations/execution-preflight/report' -f $BaseUrl)",
    "Write-Host ('{0}/api/production-integrations/final-acceptance/ledger' -f $BaseUrl)",
    '',
    "Write-Host ''",
    `Write-Host ${powerShellSingleQuote(`Readiness snapshot：status=${report.status}; score=${report.readinessScore}; safeToRunLive=${report.safeToRunLive}`)}`,
  ]
  return `${lines.join('\n')}\n`
}

function renderCustomerEnvironmentRollbackScript(
  packageId: string,
  report: ProductionCustomerEnvironmentReport,
): string {
  const envPairs = uniquePowerShellEnvPairs([
    ...report.envGates.map((gate): PowerShellEnvPair => ({
      name: gate.envVar,
      value: '0',
      label: gate.label,
      requiredForLive: true,
      currentlyEnabled: gate.enabled,
      purpose: `Disable ${gate.label}.`,
    })),
    {
      name: CUSTOMER_AUTHORIZATION_ENV,
      value: '0',
      label: 'Customer authorization switch',
      requiredForLive: true,
      currentlyEnabled: report.customerAuthorization.switchEnabled,
      purpose: 'Disable customer live authorization.',
    },
    {
      name: CUSTOMER_AUTHORIZATION_EVIDENCE_HASH_ENV,
      value: '',
      label: 'Customer authorization evidence hash',
      requiredForLive: true,
      currentlyEnabled: report.customerAuthorization.evidenceHashPresent,
      purpose: 'Clear customer authorization evidence binding.',
    },
    ...report.runtimeGuards.map((guard): PowerShellEnvPair => ({
      name: guard.envVar,
      value: '',
      label: guard.key,
      requiredForLive: guard.required,
      currentlyEnabled: guard.configured,
      purpose: `Clear runtime guard ${guard.key}.`,
    })),
    {
      name: report.emergencyStop.envVar,
      value: '1',
      label: 'Runtime control emergency stop',
      requiredForLive: true,
      currentlyEnabled: report.emergencyStop.active,
      purpose: 'Enable emergency stop before incident review.',
    },
  ])
  const lines: string[] = [
    '# AgentHub customer environment rollback',
    '# Default mode is preview only.',
    '# Safety: this script does not run live desktop/mobile/workstation/model actions.',
    'param(',
    '  [switch]$ApplyEnv',
    ')',
    '',
    "$ErrorActionPreference = 'Stop'",
    `Write-Host ${powerShellSingleQuote(`客户环境回滚脚本：${packageId}`)}`,
    "Write-Host 'Default mode: preview only. Pass -ApplyEnv to write rollback env vars into this PowerShell process.'",
    "Write-Host 'Safety: this script does not run live desktop/mobile/workstation/model actions.'",
    '',
    '$envPairs = @(',
    ...renderPowerShellEnvPairs(envPairs),
    ')',
    '',
    'foreach ($item in $envPairs) {',
    '  if ($ApplyEnv) {',
    "    [Environment]::SetEnvironmentVariable([string]$item.Name, [string]$item.Value, 'Process')",
    "    Write-Host ('APPLIED ROLLBACK {0}={1}' -f $item.Name, $item.Value)",
    '  } else {',
    "    Write-Host ('ROLLBACK PREVIEW {0}={1}' -f $item.Name, $item.Value)",
    '  }',
    '}',
    '',
    "Write-Host 'After rollback, pause active workflow/agent runs in AgentHub and preserve audit logs before restarting.'",
  ]
  return `${lines.join('\n')}\n`
}

function onsiteEnvInstructionToPowerShellPair(item: ProductionOnsiteEnvInstruction): PowerShellEnvPair {
  const parsed = envPairFromPowerShellPreview(item.powershellPreview)
  return {
    name: parsed?.name ?? item.envVar,
    value: parsed?.value ?? '',
    label: item.label,
    requiredForLive: item.requiredForLive,
    currentlyEnabled: item.enabled,
    purpose: item.valueHint,
  }
}

function onsiteRollbackCommandToPowerShellPair(command: ProductionOnsiteCommand): PowerShellEnvPair | null {
  const parsed = envPairFromPowerShellPreview(command.command)
  if (!parsed) return null
  return {
    name: parsed.name,
    value: parsed.value,
    label: command.label,
    requiredForLive: true,
    purpose: command.notes.join(' '),
  }
}

function envPairFromPowerShellPreview(command: string): { name: string; value: string } | null {
  const match = command.trim().match(/^\$env:([A-Z0-9_]+)='((?:''|[^'])*)'$/)
  if (!match) return null
  return {
    name: match[1],
    value: match[2].replace(/''/g, "'"),
  }
}

function uniquePowerShellEnvPairs(pairs: Array<PowerShellEnvPair | null>): PowerShellEnvPair[] {
  const byName = new Map<string, PowerShellEnvPair>()
  for (const pair of pairs) {
    if (!pair) continue
    byName.set(pair.name, pair)
  }
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name))
}

function renderPowerShellEnvPairs(pairs: PowerShellEnvPair[]): string[] {
  return pairs.map(
    (pair) =>
      `  @{ Name = ${powerShellSingleQuote(pair.name)}; Value = ${powerShellSingleQuote(pair.value)}; Label = ${powerShellSingleQuote(pair.label)}; RequiredForLive = ${powerShellBoolean(pair.requiredForLive ?? false)}; CurrentlyEnabled = ${powerShellBoolean(pair.currentlyEnabled ?? false)}; Purpose = ${powerShellSingleQuote(pair.purpose ?? '')} }`,
  )
}

function renderPowerShellCommandObjects(commands: ProductionOnsiteCommand[]): string[] {
  return commands.map(
    (command) =>
      `  @{ Label = ${powerShellSingleQuote(command.label)}; Command = ${powerShellSingleQuote(command.command)}; RiskLevel = ${powerShellSingleQuote(command.riskLevel)}; RequiresHuman = ${powerShellBoolean(command.requiresHuman)}; Notes = ${powerShellSingleQuote(command.notes.join(' | '))} }`,
  )
}

function powerShellBoolean(value: boolean): string {
  return value ? '$true' : '$false'
}

function powerShellSingleQuote(value: string): string {
  return `'${value.replace(/'/g, "''").replace(/\r?\n/g, ' ')}'`
}

function renderCustomerEnvironmentMarkdown(
  packageId: string,
  report: ProductionCustomerEnvironmentReport,
): string {
  const lines: string[] = [
    '# AgentHub 客户环境验收报告',
    '',
    `- 报告编号：${packageId}`,
    `- 生成时间：${new Date(report.generatedAt).toISOString()}`,
    `- 验收状态：${formatProductionStatus(report.status)}`,
    `- 验收分：${report.readinessScore}/100`,
    `- 是否允许进入真实执行：${report.safeToRunLive ? '是' : '否'}`,
    `- 上线向导进度：${report.setupGuide.completionPercent}%`,
    `- 脱敏：是`,
    '',
    '## 机器信息',
    '',
    `- 平台：${report.host.platform}`,
    `- 架构：${report.host.arch}`,
    `- Node：${report.host.node}`,
    `- Electron 模式：${report.host.electronMode}`,
    `- 数据目录：${report.host.dataDir}`,
    '',
    '## 真实能力开关',
    '',
    '| 能力 | 环境变量 | 状态 | 风险 | 用途 |',
    '| --- | --- | --- | --- | --- |',
    ...report.envGates.map((gate) =>
      `| ${escapeMarkdownCell(gate.label)} | \`${gate.envVar}\` | ${gate.enabled ? '已开启' : '关闭'} | ${formatRiskLevel(gate.riskLevel)} | ${escapeMarkdownCell(gate.purpose)} |`,
    ),
    '',
    '## 运行安全护栏',
    '',
    `- 紧急停止：\`${report.emergencyStop.envVar}\` = ${report.emergencyStop.active ? '已开启' : '未开启'}`,
    '',
    '| 护栏 | 环境变量 | 状态 | 值提示 | 用途 |',
    '| --- | --- | --- | --- | --- |',
    ...report.runtimeGuards.map((guard) =>
      `| ${escapeMarkdownCell(formatRuntimeGuardLabel(guard.key))} | \`${guard.envVar}\` | ${guard.configured ? '已配置' : '缺失'} | ${escapeMarkdownCell(guard.valueHint)} | ${escapeMarkdownCell(guard.purpose)} |`,
    ),
    '',
    '## 验收检查',
    '',
  ]
  for (const check of report.checks) {
    lines.push(`### ${check.label}`)
    lines.push('')
    lines.push(`- 状态：${formatProductionStatus(check.status)}`)
    lines.push(`- 检查时间：${new Date(check.checkedAt).toISOString()}`)
    lines.push('- 证据：')
    lines.push(...markdownList(check.evidence))
    if (check.warnings.length > 0) {
      lines.push('- 风险提醒：')
      lines.push(...markdownList(check.warnings))
    }
    if (check.nextActions.length > 0) {
      lines.push('- 下一步：')
      lines.push(...markdownList(check.nextActions))
    }
    lines.push('')
  }
  lines.push('## 阻塞项')
  lines.push('')
  lines.push(...(report.blockers.length > 0 ? markdownList(report.blockers) : ['- 暂无阻塞项。']))
  lines.push('')
  lines.push('## 建议下一步')
  lines.push('')
  lines.push(...(report.nextActions.length > 0 ? markdownList(report.nextActions) : ['- 保持定期自检和审计记录。']))
  lines.push('')
  lines.push('## 安全说明')
  lines.push('')
  lines.push('- 本报告只包含状态、证据、环境变量名称、路径和建议。')
  lines.push('- 本报告不包含 API Key、密码、Cookie、远程桌面密码或客户账号凭证。')
  lines.push('- 真实桌面、手机、远程工作站动作仍需环境开关、风险确认、审批和审计链路。')
  lines.push('')
  return `${lines.join('\n')}\n`
}

function renderOnsiteActivationMarkdown(
  packageId: string,
  guide: ProductionOnsiteActivationGuide,
): string {
  const lines: string[] = [
    '# AgentHub 现场激活包',
    '',
    `- 激活包编号：${packageId}`,
    `- 生成时间：${new Date(guide.generatedAt).toISOString()}`,
    `- 状态：${formatProductionStatus(guide.status)}`,
    `- 验收分：${guide.readinessScore}/100`,
    `- 是否可以进入真实激活：${guide.safeToActivateLive ? '是' : '否'}`,
    `- 是否可以先做 dry-run：${guide.safeToStartDryRun ? '是' : '否'}`,
    `- 脱敏：是`,
    '',
    '## 总览',
    '',
    `- 步骤：${guide.summary.doneSteps}/${guide.summary.totalSteps} 已完成`,
    `- 待处理：${guide.summary.needsActionSteps}`,
    `- 阻塞：${guide.summary.blockedSteps}`,
    `- 现场开关：${guide.summary.enabledEnvGates}/${guide.summary.envGates} 已开启`,
    `- 连接档案：${guide.summary.readyConnectors}/${guide.summary.connectors} 已就绪`,
    '',
    '## 激活步骤',
    '',
  ]
  for (const step of guide.steps) {
    lines.push(`### ${step.title}`)
    lines.push('')
    lines.push(`- 阶段：${formatActivationPhase(step.phase)}`)
    lines.push(`- 状态：${formatProductionStatus(step.status)}`)
    lines.push(`- 风险：${formatRiskLevel(step.riskLevel)}`)
    lines.push(`- 可自动检查：${step.automationAvailable ? '是' : '否'}`)
    lines.push('- 证据：')
    lines.push(...markdownList(step.evidence.length > 0 ? step.evidence : ['暂无证据']))
    lines.push('- 现场动作：')
    lines.push(...markdownList(step.actions.length > 0 ? step.actions : ['暂无动作']))
    lines.push('- 验证：')
    lines.push(...markdownList(step.verification.length > 0 ? step.verification : ['暂无验证项']))
    lines.push('- 回退：')
    lines.push(...markdownList(step.rollback.length > 0 ? step.rollback : ['暂无回退项']))
    lines.push('')
  }
  lines.push('## 现场开关')
  lines.push('')
  lines.push('| 能力 | 环境变量 | 当前状态 | 值提示 | PowerShell 预览 |')
  lines.push('| --- | --- | --- | --- | --- |')
  for (const item of guide.envChecklist) {
    lines.push(
      `| ${escapeMarkdownCell(item.label)} | \`${item.envVar}\` | ${item.enabled ? '已开启' : '关闭'} | ${escapeMarkdownCell(item.valueHint)} | \`${escapeMarkdownCell(item.powershellPreview)}\` |`,
    )
  }
  lines.push('')
  lines.push('## 验证命令')
  lines.push('')
  for (const command of guide.validationCommands) {
    lines.push(`### ${command.label}`)
    lines.push('')
    lines.push(`- 命令：\`${command.command}\``)
    lines.push(`- 风险：${formatRiskLevel(command.riskLevel)}`)
    lines.push(`- 是否需要人工：${command.requiresHuman ? '是' : '否'}`)
    if (command.notes.length > 0) {
      lines.push('- 说明：')
      lines.push(...markdownList(command.notes))
    }
    lines.push('')
  }
  lines.push('## 回退命令')
  lines.push('')
  for (const command of guide.rollbackPlan) {
    lines.push(`### ${command.label}`)
    lines.push('')
    lines.push(`- 命令：\`${command.command}\``)
    lines.push(`- 风险：${formatRiskLevel(command.riskLevel)}`)
    lines.push(`- 是否需要人工：${command.requiresHuman ? '是' : '否'}`)
    if (command.notes.length > 0) {
      lines.push('- 说明：')
      lines.push(...markdownList(command.notes))
    }
    lines.push('')
  }
  lines.push('## 阻塞项')
  lines.push('')
  lines.push(...(guide.blockers.length > 0 ? markdownList(guide.blockers) : ['- 暂无阻塞项。']))
  lines.push('')
  lines.push('## 下一步')
  lines.push('')
  lines.push(...(guide.nextActions.length > 0 ? markdownList(guide.nextActions) : ['- 保持定期验收和审计记录。']))
  lines.push('')
  lines.push('## 安全说明')
  lines.push('')
  lines.push('- 本激活包只包含步骤、状态、环境变量名、验证命令和回退命令。')
  lines.push('- 本激活包不包含 API Key、密码、Cookie、手机解锁码、远程桌面密码或客户账号凭证。')
  lines.push('- 真实桌面、手机、远程工作站动作仍然需要环境开关、风险确认、审批和审计链路。')
  lines.push('')
  return `${lines.join('\n')}\n`
}

function markdownList(values: string[]): string[] {
  return values.map((value) => `  - ${formatMarkdownText(value)}`)
}

function formatMarkdownText(value: string): string {
  return value
    .replace(/\r?\n/g, ' ')
    .replace(/^PowerShell available(?::\s*(.+))?$/u, (_match, version: string | undefined) =>
      version ? `PowerShell 可用：${version}` : 'PowerShell 可用',
    )
    .replace(/^(\d+) visible windows observed$/u, '已观察到 $1 个可见窗口')
    .replace(
      /^Model endpoint host (.+) is not in (AGENTHUB_[A-Z0-9_]+)\.$/u,
      '模型接口主机 $1 不在 $2 白名单中。',
    )
    .replace(/=blocked\b/gu, '=已阻塞')
    .replace(/=available\b/gu, '=可用')
    .replace(/=ready\b/gu, '=已就绪')
    .replace(/=not_configured\b/gu, '=未配置')
}

function formatProductionStatus(value: string): string {
  const labels: Record<string, string> = {
    active: '运行中',
    allowed: '已允许',
    available: '可用',
    blocked: '已阻塞',
    complete: '已完成',
    done: '已完成',
    expired: '已过期',
    failed: '失败',
    idle: '空闲',
    needs_action: '待处理',
    not_configured: '未配置',
    not_installed: '未安装',
    ok: '正常',
    pending: '等待中',
    planned: '已规划',
    ready: '已就绪',
    released: '已释放',
    stopped: '已停止',
    warning: '需注意',
  }
  return labels[value] ?? value
}

function formatRiskLevel(value: string): string {
  const labels: Record<string, string> = {
    low: '低风险',
    medium: '中风险',
    high: '高风险',
  }
  return labels[value] ?? value
}

function formatActivationPhase(value: string): string {
  const labels: Record<string, string> = {
    authorization: '客户授权',
    credentials: '模型凭证',
    network: '网络出口',
    desktop: '桌面控制',
    mobile: '手机控制',
    workstation: '虚拟工作站',
    hardening: '生产硬化',
    validation: '现场验证',
    rollback: '回退预案',
  }
  return labels[value] ?? value
}

function formatRuntimeGuardLabel(value: string): string {
  const labels: Record<string, string> = {
    model_endpoint_host_allowlist: '模型接口主机白名单',
    desktop_target_allowlist: '桌面目标白名单',
    mobile_device_allowlist: '手机设备白名单',
    mobile_app_package_allowlist: '手机应用包名白名单',
    workstation_target_allowlist: '工作站目标白名单',
  }
  return labels[value] ?? value
}

function escapeMarkdownCell(value: string): string {
  return value.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ')
}

function livePilotSessionFromAuditMetadata(
  metadata: unknown,
  stoppedAtValue: unknown,
): ProductionLivePilotSession | null {
  if (!metadata || typeof metadata !== 'object') return null
  const record = metadata as Record<string, unknown>
  const id = typeof record.id === 'string' ? record.id : null
  const generatedAt = typeof record.generatedAt === 'number' ? record.generatedAt : null
  const startedAt = typeof record.startedAt === 'number' ? record.startedAt : generatedAt
  const expiresAt = typeof record.expiresAt === 'number' ? record.expiresAt : null
  if (!id || !generatedAt || !startedAt || !expiresAt) return null
  const stoppedAt =
    typeof stoppedAtValue === 'number'
      ? stoppedAtValue
      : typeof record.stoppedAt === 'number'
        ? record.stoppedAt
        : null
  const canRunLivePilot = record.canRunLivePilot === true
  const status: ProductionLivePilotSessionStatus = stoppedAt
    ? 'stopped'
    : expiresAt <= Date.now()
      ? 'expired'
      : canRunLivePilot
        ? 'active'
        : 'blocked'
  const base = {
    id,
    generatedAt,
    startedAt,
    expiresAt,
    durationMinutes: typeof record.durationMinutes === 'number' ? record.durationMinutes : 0,
    livePilotLeaseHash: typeof record.livePilotLeaseHash === 'string' ? record.livePilotLeaseHash : null,
    livePilotLeaseExpiresAt:
      typeof record.livePilotLeaseExpiresAt === 'number' ? record.livePilotLeaseExpiresAt : null,
    goLiveDecisionHash: typeof record.goLiveDecisionHash === 'string' ? record.goLiveDecisionHash : null,
    customerAuthorizationEvidenceHash:
      typeof record.customerAuthorizationEvidenceHash === 'string'
        ? record.customerAuthorizationEvidenceHash
        : null,
    environmentFingerprintHash:
      typeof record.environmentFingerprintHash === 'string' ? record.environmentFingerprintHash : null,
    canRunLivePilot,
  }
  const contentHash =
    typeof record.contentHash === 'string' ? record.contentHash : `sha256:${sha256(stableStringify(base))}`
  const blockers = Array.isArray(record.blockers)
    ? record.blockers.filter((item): item is string => typeof item === 'string')
    : []
  return {
    ...base,
    stoppedAt,
    status,
    contentHash,
    blockers:
      status === 'active'
        ? blockers
        : uniqueNonEmpty([
            ...blockers,
            ...(status === 'stopped' ? ['Live pilot session has been stopped.'] : []),
            ...(status === 'expired' ? ['Live pilot session has expired.'] : []),
          ]),
    nextActions:
      status === 'active'
        ? ['Stop the live pilot session immediately after onsite verification is done.']
        : ['Start a fresh live pilot session before live execution.'],
    safetyNotice:
      'Live pilot session is an audited execution window. It stores hashes and status only, not secrets or customer private content.',
  }
}

function productionGoLiveEnvironmentFingerprintFromMetadata(
  value: unknown,
): ProductionGoLiveEnvironmentFingerprint[] {
  if (!Array.isArray(value)) return []
  return value
    .map((item) => {
      if (!item || typeof item !== 'object') return null
      const record = item as Record<string, unknown>
      const envVar = typeof record.envVar === 'string' ? record.envVar : null
      if (!envVar) return null
      return {
        envVar,
        configured: record.configured === true,
        valueHash: typeof record.valueHash === 'string' ? record.valueHash : null,
      }
    })
    .filter((item): item is ProductionGoLiveEnvironmentFingerprint => Boolean(item))
}

function productionGoLiveEnvironmentFingerprintHash(
  fingerprint: ProductionGoLiveEnvironmentFingerprint[],
): string | null {
  if (fingerprint.length === 0) return null
  return `sha256:${sha256(stableStringify(fingerprint))}`
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  const record = value as Record<string, unknown>
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
    .join(',')}}`
}

function scoreReadiness(checks: ProductionProbeResult[]): number {
  if (checks.length === 0) return 0
  const score = checks.reduce((sum, check) => {
    if (check.status === 'ready') return sum + 100
    if (check.status === 'available') return sum + 80
    if (check.status === 'not_configured') return sum + 40
    return sum + 10
  }, 0)
  return Math.round(score / checks.length)
}

function readinessStatus(
  readinessScore: number,
  checks: ProductionProbeResult[],
): ProductionIntegrationStatus {
  if (checks.some((check) => check.status === 'blocked')) return 'blocked'
  if (readinessScore >= 85) return 'ready'
  if (readinessScore >= 60) return 'available'
  if (readinessScore >= 30) return 'not_configured'
  return 'not_installed'
}

function isVaultRef(value: string): boolean {
  const trimmed = value.trim()
  return trimmed.startsWith('secret:') || trimmed.startsWith('vault:') || trimmed.startsWith('sec_')
}

function hasCredentialScopeForModel(
  scopes: Array<{ resourceType: string; resourceId: string; capability: string }>,
  modelProfileId: string,
): boolean {
  return scopes.some((scope) => {
    const resourceMatches =
      (scope.resourceType === 'model_profile' && scope.resourceId === modelProfileId) ||
      (scope.resourceType === 'global' && (scope.resourceId === '*' || scope.resourceId === 'global'))
    const capabilityMatches =
      scope.capability === 'use' ||
      scope.capability === '*' ||
      scope.capability === 'model.connect' ||
      scope.capability === 'model.invoke'
    return resourceMatches && capabilityMatches
  })
}

function inspectModelCredentialRef(args: {
  apiKeyRef: string
  modelProfileId: string
  secrets: Map<string, { id: string; name: string; kind: string; valueRef: string; status: string }>
  scopes: Array<{ secretId: string; resourceType: string; resourceId: string; capability: string }>
}): ProductionModelCredentialItem['credential'] {
  const trimmed = args.apiKeyRef.trim()
  const secretId = parseVaultSecretId(trimmed)
  if (secretId) {
    const secret = args.secrets.get(secretId)
    const connectScope = secret
      ? isScopeAllowedForCapability(args.scopes, secret.id, args.modelProfileId, 'model.connect')
      : 'missing'
    const invokeScope = secret
      ? isScopeAllowedForCapability(args.scopes, secret.id, args.modelProfileId, 'model.invoke')
      : 'missing'
    const secretValuePresent = secret
      ? secret.kind === 'env_ref'
        ? Boolean(process.env[secret.valueRef])
        : secret.status === 'active'
      : false
    const secretResolvable = secret
      ? secret.kind === 'encrypted_value'
        ? Boolean(process.env.AGENTHUB_VAULT_MASTER_KEY?.trim())
        : true
      : false
    return {
      refKind: 'secret_vault',
      refPreview: secret ? `secret:${secret.id}` : redactCredentialRef(trimmed),
      envVar: secret?.kind === 'env_ref' ? secret.valueRef : null,
      envValuePresent: secret?.kind === 'env_ref' ? Boolean(process.env[secret.valueRef]) : null,
      secretId,
      secretName: secret?.name ?? null,
      secretKind: secret?.kind ?? null,
      secretStatus: secret?.status ?? null,
      secretValuePresent,
      secretResolvable,
      connectScope,
      invokeScope,
    }
  }

  const envVar = parseEnvSecretRef(trimmed)
  if (envVar) {
    return {
      refKind: 'env',
      refPreview: `env:${envVar}`,
      envVar,
      envValuePresent: Boolean(process.env[envVar]),
      secretId: null,
      secretName: null,
      secretKind: null,
      secretStatus: null,
      secretValuePresent: null,
      secretResolvable: null,
      connectScope: 'not_applicable',
      invokeScope: 'not_applicable',
    }
  }

  return {
    refKind: looksLikeInlineSecret(trimmed) ? 'inline_secret_blocked' : 'unresolved',
    refPreview: redactCredentialRef(trimmed),
    envVar: null,
    envValuePresent: null,
    secretId: null,
    secretName: null,
    secretKind: null,
    secretStatus: null,
    secretValuePresent: false,
    secretResolvable: false,
    connectScope: 'not_applicable',
    invokeScope: 'not_applicable',
  }
}

function latestModelTestForProfile(
  tests: Array<{
    id: string
    modelProfileId: string | null
    mode: 'dry_run' | 'live'
    status: HealthStatus
    message: string
    latencyMs: number | null
    capabilityChecks: JsonObject
    createdAt: number
  }>,
  modelProfileId: string,
  kind: 'connection' | 'invocation',
): ProductionModelCredentialTestEvidence | null {
  const found = tests.find((test) => {
    if (test.modelProfileId !== modelProfileId || test.mode !== 'live') return false
    const capabilityProbe = isModelCapabilityProbe(test)
    return kind === 'invocation' ? capabilityProbe : !capabilityProbe
  })
  return found
    ? {
        id: found.id,
        status: found.status,
        mode: found.mode,
        message: found.message,
        latencyMs: found.latencyMs,
        createdAt: found.createdAt,
      }
    : null
}

function isScopeAllowedForCapability(
  scopes: Array<{ secretId: string; resourceType: string; resourceId: string; capability: string }>,
  secretId: string,
  modelProfileId: string,
  capability: 'model.connect' | 'model.invoke',
): 'allowed' | 'missing' {
  return scopes.some((scope) => {
    if (scope.secretId !== secretId) return false
    const resourceMatches =
      (scope.resourceType === 'model_profile' && scope.resourceId === modelProfileId) ||
      (scope.resourceType === 'global' && (scope.resourceId === '*' || scope.resourceId === 'global'))
    const capabilityMatches =
      scope.capability === capability ||
      scope.capability === 'use' ||
      scope.capability === '*'
    return resourceMatches && capabilityMatches
  })
    ? 'allowed'
    : 'missing'
}

function parseVaultSecretId(value: string): string | null {
  if (value.startsWith('secret:')) return value.slice('secret:'.length)
  if (value.startsWith('vault:')) return value.slice('vault:'.length)
  if (value.startsWith('sec_')) return value
  return null
}

function parseEnvSecretRef(value: string): string | null {
  if (value.startsWith('env:')) {
    const envVar = value.slice('env:'.length).trim()
    return /^[A-Z0-9_]+$/.test(envVar) ? envVar : null
  }
  return /^[A-Z0-9_]+$/.test(value) ? value : null
}

function looksLikeInlineSecret(value: string): boolean {
  return /^(sk-|sk_|AIza|xoxb-|ghp_|pat_|eyJ)[A-Za-z0-9_.-]{12,}/.test(value) || value.length >= 32
}

function redactCredentialRef(value: string): string {
  if (!value) return '[empty]'
  if (value.length <= 10) return '[redacted]'
  return `${value.slice(0, 4)}...${value.slice(-4)}`
}

function safeUrlHost(value: string): string {
  try {
    return new URL(value).host
  } catch {
    return '[invalid-url]'
  }
}

function firstUsefulLine(value: string): string | undefined {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean)
}

function safeSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9_.-]/g, '_')
}
