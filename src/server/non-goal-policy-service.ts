import { and, asc, eq, type SQL } from 'drizzle-orm'

import { db, schema } from '@/db/client'
import type { NonGoalPolicyRow, NonGoalScope } from '@/db/schema'
import { newNonGoalPolicyId } from '@/server/ids'

interface DefaultNonGoalPolicy {
  scope: NonGoalScope
  featureKey: string
  title: string
  rationale: string
  enforcementPolicy: string
}

const defaultPolicies: DefaultNonGoalPolicy[] = [
  { scope: 'v1_not_do', featureKey: 'cloud_saas', title: '云SaaS版', rationale: 'v1 is local-first desktop.', enforcementPolicy: 'defer_to_future_phase' },
  { scope: 'v1_not_do', featureKey: 'full_mobile_automation', title: '完整手机自动化', rationale: 'v1 starts with companion controls, not device automation.', enforcementPolicy: 'defer_to_v2_device_plan' },
  { scope: 'v1_not_do', featureKey: 'voice_interaction', title: '语音交互', rationale: 'voice is reserved as a non-live v2 interface.', enforcementPolicy: 'record_only_reservation' },
  { scope: 'v1_not_do', featureKey: 'multi_machine_cluster', title: '多机集群', rationale: 'v1 focuses on single-machine local execution.', enforcementPolicy: 'defer_to_infrastructure_phase' },
  { scope: 'v1_not_do', featureKey: 'realtime_voice', title: '实时语音', rationale: 'live audio capture/playback is out of v1 scope.', enforcementPolicy: 'disabled_live_audio' },
  { scope: 'v1_not_do', featureKey: 'fully_autonomous_decisions', title: '完全自主决策', rationale: 'v1 requires approvals and explicit autonomy boundaries.', enforcementPolicy: 'require_autonomy_policy' },
  { scope: 'v1_not_do', featureKey: 'video_3d_generation', title: '生成视频3D', rationale: 'not part of the local Agent employee operating system core.', enforcementPolicy: 'out_of_scope' },
  { scope: 'v1_not_do', featureKey: 'web3', title: 'Web3', rationale: 'blockchain/Web3 workflows are not part of v1.', enforcementPolicy: 'out_of_scope' },
  { scope: 'v1_not_do', featureKey: 'wechat_qq_integration', title: '微信QQ集成', rationale: 'consumer messenger integrations are not part of v1.', enforcementPolicy: 'out_of_scope' },
  { scope: 'never_do', featureKey: 'impersonate_human_posting', title: '冒充真人发帖', rationale: 'Deceptive impersonation is forbidden.', enforcementPolicy: 'block_and_audit' },
  { scope: 'never_do', featureKey: 'bypass_paywalls', title: '绕过付费墙', rationale: 'Bypassing access controls is forbidden.', enforcementPolicy: 'block_and_audit' },
  { scope: 'never_do', featureKey: 'deepfake', title: 'deepfake', rationale: 'Deceptive synthetic identity media is forbidden.', enforcementPolicy: 'block_and_audit' },
  { scope: 'never_do', featureKey: 'attack_scanning_tools', title: '攻击扫描工具', rationale: 'Offensive attack tooling is forbidden.', enforcementPolicy: 'block_and_audit' },
  { scope: 'never_do', featureKey: 'cheating_fraud', title: '作弊欺诈功能', rationale: 'Cheating and fraud workflows are forbidden.', enforcementPolicy: 'block_and_audit' },
]

export function getDefaultNonGoalPolicyCount(): number {
  return defaultPolicies.length
}

export async function seedNonGoalPolicies(): Promise<NonGoalPolicyRow[]> {
  const now = Date.now()
  for (const policy of defaultPolicies) {
    const existing = await db.query.nonGoalPolicies.findFirst({
      where: eq(schema.nonGoalPolicies.featureKey, policy.featureKey),
    })
    if (existing) continue
    await db.insert(schema.nonGoalPolicies).values({
      id: newNonGoalPolicyId(),
      scope: policy.scope,
      featureKey: policy.featureKey,
      title: policy.title,
      rationale: policy.rationale,
      enforcementPolicy: policy.enforcementPolicy,
      status: 'active',
      createdAt: now,
      updatedAt: now,
    })
  }
  return listNonGoalPolicies()
}

export async function listNonGoalPolicies(args: {
  scope?: NonGoalScope
  status?: string
  limit?: number
} = {}): Promise<NonGoalPolicyRow[]> {
  const conditions: SQL[] = []
  if (args.scope) conditions.push(eq(schema.nonGoalPolicies.scope, args.scope))
  if (args.status) conditions.push(eq(schema.nonGoalPolicies.status, args.status))
  return db.query.nonGoalPolicies.findMany({
    where: conditions.length ? and(...conditions) : undefined,
    orderBy: [asc(schema.nonGoalPolicies.scope), asc(schema.nonGoalPolicies.featureKey)],
    limit: args.limit ?? 100,
  })
}
