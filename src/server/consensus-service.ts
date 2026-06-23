import { and, desc, eq, type SQL } from 'drizzle-orm'

import { db, schema } from '@/db/client'
import type {
  AdversarialReviewAction,
  AdversarialReviewRow,
  AdversarialReviewStatus,
  AgentConsensusVoteRow,
  AgentVotingDecision,
  AgentVotingTieBreaker,
  ConsensusCriticalTask,
  ConsensusRecommendedAction,
  DualModelVerificationRow,
  JsonObject,
  SecondaryModelStrategy,
} from '@/db/schema'
import {
  newAdversarialReviewId,
  newAgentConsensusVoteId,
  newDualModelVerificationId,
} from '@/server/ids'

export interface DualModelVerificationArgs {
  appliesTo: ConsensusCriticalTask
  primaryModelProfileId?: string | null
  secondaryModelProfileId?: string | null
  secondaryModel?: SecondaryModelStrategy
  primaryResult: JsonObject
  secondaryResult: JsonObject
}

export interface AgentVoteInput {
  agentId: string
  vote: string
  reasoning: string
  confidence: number
}

export interface AgentConsensusVoteArgs {
  question: string
  voters: AgentVoteInput[]
  quorum: number
  requiredMajority: number
  tieBreaker?: AgentVotingTieBreaker
}

export interface AdversarialReviewArgs {
  subjectAgentId?: string | null
  reviewerAgentId?: string | null
  targetTitle: string
  targetContent: JsonObject
  skepticism?: number
  assumptions?: string[]
  missedCases?: string[]
  attackerExploitation?: string[]
  worstCases?: string[]
}

export async function createDualModelVerification(
  args: DualModelVerificationArgs,
): Promise<DualModelVerificationRow> {
  const disagreementPoints = compareJsonResults(args.primaryResult, args.secondaryResult)
  const totalCompared = Math.max(
    uniqueKeys(args.primaryResult, args.secondaryResult).length,
    1,
  )
  const agreement = disagreementPoints.length === 0
  const confidence = agreement ? 0.95 : round(Math.max(0, 1 - disagreementPoints.length / totalCompared))
  const recommendedAction = recommendedDualModelAction(
    agreement,
    confidence,
    args.primaryResult,
    args.secondaryResult,
  )
  const row = {
    id: newDualModelVerificationId(),
    appliesTo: args.appliesTo,
    primaryModelProfileId: normalizeNullable(args.primaryModelProfileId),
    secondaryModelProfileId: normalizeNullable(args.secondaryModelProfileId),
    secondaryModel: args.secondaryModel ?? 'cheap_fast_model',
    primaryResult: args.primaryResult,
    secondaryResult: args.secondaryResult,
    agreement,
    disagreementPoints,
    confidence,
    recommendedAction,
    createdAt: Date.now(),
  }
  await db.insert(schema.dualModelVerifications).values(row)
  return row
}

export async function listDualModelVerifications(args: {
  appliesTo?: ConsensusCriticalTask
  recommendedAction?: ConsensusRecommendedAction
  limit?: number
} = {}): Promise<DualModelVerificationRow[]> {
  const conditions: SQL[] = []
  if (args.appliesTo) conditions.push(eq(schema.dualModelVerifications.appliesTo, args.appliesTo))
  if (args.recommendedAction) {
    conditions.push(eq(schema.dualModelVerifications.recommendedAction, args.recommendedAction))
  }
  return db.query.dualModelVerifications.findMany({
    where: conditions.length ? and(...conditions) : undefined,
    orderBy: [desc(schema.dualModelVerifications.createdAt)],
    limit: args.limit ?? 100,
  })
}

export async function createAgentConsensusVote(
  args: AgentConsensusVoteArgs,
): Promise<AgentConsensusVoteRow> {
  if (!args.question.trim()) throw new Error('Consensus question is required.')
  if (args.quorum < 1) throw new Error('Consensus quorum must be at least 1.')
  if (args.requiredMajority <= 0 || args.requiredMajority > 1) {
    throw new Error('Consensus requiredMajority must be in (0, 1].')
  }
  const voters = args.voters.map((voter) => ({
    agentId: voter.agentId.trim(),
    vote: voter.vote.trim(),
    reasoning: voter.reasoning.trim(),
    confidence: clamp(voter.confidence),
  }))
  const tally = tallyVotes(voters)
  const top = [...tally.entries()].sort((a, b) => b[1] - a[1])[0]
  const topCount = top?.[1] ?? 0
  const topVote = top?.[0] ?? null
  const majorityRatio = voters.length ? round(topCount / voters.length) : 0
  const tie = top ? [...tally.values()].filter((count) => count === topCount).length > 1 : false
  const decision = resolveVoteDecision({
    voterCount: voters.length,
    quorum: args.quorum,
    majorityRatio,
    requiredMajority: args.requiredMajority,
    topVote,
    tie,
  })
  const row = {
    id: newAgentConsensusVoteId(),
    question: args.question.trim(),
    voters: voters as unknown as JsonObject[],
    quorum: args.quorum,
    requiredMajority: args.requiredMajority,
    tieBreaker: args.tieBreaker ?? 'user_decides',
    winningVote: decision === 'no_quorum' || decision === 'tie' ? null : topVote,
    majorityRatio,
    decision,
    createdAt: Date.now(),
  }
  await db.insert(schema.agentConsensusVotes).values(row)
  return row
}

export async function listAgentConsensusVotes(args: {
  decision?: AgentVotingDecision
  limit?: number
} = {}): Promise<AgentConsensusVoteRow[]> {
  const conditions: SQL[] = []
  if (args.decision) conditions.push(eq(schema.agentConsensusVotes.decision, args.decision))
  return db.query.agentConsensusVotes.findMany({
    where: conditions.length ? and(...conditions) : undefined,
    orderBy: [desc(schema.agentConsensusVotes.createdAt)],
    limit: args.limit ?? 100,
  })
}

export async function createAdversarialReview(
  args: AdversarialReviewArgs,
): Promise<AdversarialReviewRow> {
  const targetTitle = args.targetTitle.trim()
  if (!targetTitle) throw new Error('Adversarial review target title is required.')
  const skepticism = clamp(args.skepticism ?? 0.8)
  const inferred = inferAdversarialFindings(args.targetContent, skepticism)
  const assumptions = [...(args.assumptions ?? []), ...inferred.assumptions]
  const missedCases = [...(args.missedCases ?? []), ...inferred.missedCases]
  const attackerExploitation = [...(args.attackerExploitation ?? []), ...inferred.attackerExploitation]
  const worstCases = [...(args.worstCases ?? []), ...inferred.worstCases]
  const issues = [...assumptions, ...missedCases, ...attackerExploitation, ...worstCases]
  const status: AdversarialReviewStatus = issues.length > 3
    ? 'needs_revision'
    : issues.length
      ? 'issues_found'
      : 'passed'
  const recommendedAction: AdversarialReviewAction = status === 'passed' ? 'approve' : 'revise'
  const row = {
    id: newAdversarialReviewId(),
    subjectAgentId: normalizeNullable(args.subjectAgentId),
    reviewerAgentId: normalizeNullable(args.reviewerAgentId),
    targetTitle,
    targetContent: args.targetContent,
    skepticism,
    assumptions: unique(assumptions),
    missedCases: unique(missedCases),
    attackerExploitation: unique(attackerExploitation),
    worstCases: unique(worstCases),
    issues: unique(issues),
    status,
    recommendedAction,
    createdAt: Date.now(),
  }
  await db.insert(schema.adversarialReviews).values(row)
  return row
}

export async function listAdversarialReviews(args: {
  status?: AdversarialReviewStatus
  subjectAgentId?: string
  reviewerAgentId?: string
  limit?: number
} = {}): Promise<AdversarialReviewRow[]> {
  const conditions: SQL[] = []
  if (args.status) conditions.push(eq(schema.adversarialReviews.status, args.status))
  if (args.subjectAgentId) conditions.push(eq(schema.adversarialReviews.subjectAgentId, args.subjectAgentId))
  if (args.reviewerAgentId) conditions.push(eq(schema.adversarialReviews.reviewerAgentId, args.reviewerAgentId))
  return db.query.adversarialReviews.findMany({
    where: conditions.length ? and(...conditions) : undefined,
    orderBy: [desc(schema.adversarialReviews.createdAt)],
    limit: args.limit ?? 100,
  })
}

function compareJsonResults(primary: JsonObject, secondary: JsonObject): string[] {
  return uniqueKeys(primary, secondary).flatMap((key) => {
    const left = JSON.stringify(primary[key] ?? null)
    const right = JSON.stringify(secondary[key] ?? null)
    return left === right ? [] : [`${key}: primary=${left}, secondary=${right}`]
  })
}

function uniqueKeys(primary: JsonObject, secondary: JsonObject): string[] {
  return [...new Set([...Object.keys(primary), ...Object.keys(secondary)])].sort()
}

function recommendedDualModelAction(
  agreement: boolean,
  confidence: number,
  primaryResult: JsonObject,
  secondaryResult: JsonObject,
): ConsensusRecommendedAction {
  if (agreement) return 'use_primary'
  const primaryConfidence = numericField(primaryResult, 'confidence')
  const secondaryConfidence = numericField(secondaryResult, 'confidence')
  if (secondaryConfidence > primaryConfidence + 0.15) return 'use_secondary'
  if (confidence >= 0.67) return 'merge'
  return 'ask_user'
}

function resolveVoteDecision(args: {
  voterCount: number
  quorum: number
  majorityRatio: number
  requiredMajority: number
  topVote: string | null
  tie: boolean
}): AgentVotingDecision {
  if (args.voterCount < args.quorum) return 'no_quorum'
  if (args.tie) return 'tie'
  if (args.majorityRatio < args.requiredMajority) return 'tie'
  const vote = args.topVote?.toLowerCase() ?? ''
  if (['reject', 'rejected', 'no', 'block'].includes(vote)) return 'rejected'
  return 'accepted'
}

function tallyVotes(voters: Array<{ vote: string }>): Map<string, number> {
  const tally = new Map<string, number>()
  for (const voter of voters) {
    const vote = voter.vote.trim().toLowerCase()
    tally.set(vote, (tally.get(vote) ?? 0) + 1)
  }
  return tally
}

function inferAdversarialFindings(targetContent: JsonObject, skepticism: number): {
  assumptions: string[]
  missedCases: string[]
  attackerExploitation: string[]
  worstCases: string[]
} {
  const text = JSON.stringify(targetContent).toLowerCase()
  const assumptions: string[] = []
  const missedCases: string[] = []
  const attackerExploitation: string[] = []
  const worstCases: string[] = []
  if (text.includes('assume') || text.includes('assumption')) {
    assumptions.push('The plan contains assumptions that need validation.')
  }
  if (!text.includes('edge') && !text.includes('fallback')) {
    missedCases.push('No explicit edge-case or fallback coverage was found.')
  }
  if (!text.includes('security') && !text.includes('permission') && !text.includes('auth')) {
    attackerExploitation.push('Security, permission, or abuse paths were not explicitly analyzed.')
  }
  if (!text.includes('rollback') && !text.includes('recovery')) {
    worstCases.push('No rollback or recovery path was described for the worst case.')
  }
  if (skepticism > 0.9 && !text.includes('evidence')) {
    missedCases.push('High-skepticism review requires explicit evidence for the main claim.')
  }
  return { assumptions, missedCases, attackerExploitation, worstCases }
}

function numericField(value: JsonObject, key: string): number {
  const raw = value[key]
  return typeof raw === 'number' && Number.isFinite(raw) ? raw : 0
}

function normalizeNullable(value: string | null | undefined): string | null {
  const normalized = value?.trim()
  return normalized ? normalized : null
}

function unique(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))]
}

function clamp(value: number): number {
  return Math.max(0, Math.min(1, value))
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000
}
