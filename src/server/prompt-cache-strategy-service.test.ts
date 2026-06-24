import { describe, expect, it } from 'vitest'

import type { ModelProfileRow } from '@/db/schema'

import {
  APPEND_ONLY_HISTORY_LIMIT,
  DEFAULT_RECENT_HISTORY_LIMIT,
  planAgentPromptCache,
  planModelProfilePromptCache,
} from './prompt-cache-strategy-service'

describe('prompt-cache-strategy-service', () => {
  it('uses append-only stable prefix for DeepSeek agent runs', () => {
    const plan = planAgentPromptCache({
      provider: 'deepseek',
      modelId: 'deepseek-v4-flash',
      contextWindow: 1_000_000,
    })

    expect(plan.mode).toBe('append_only_stable_prefix')
    expect(plan.appendOnly).toBe(true)
    expect(plan.historyLimit).toBe(APPEND_ONLY_HISTORY_LIMIT)
    expect(plan.targetHitRate).toBe(0.9)
    expect(plan.stablePrefixSections).toContain('上一轮完整对话前缀')
  })

  it('uses bounded recent history for ordinary non-cache-friendly models', () => {
    const plan = planAgentPromptCache({
      provider: 'openai',
      modelId: 'gpt-small',
      contextWindow: 128_000,
    })

    expect(plan.mode).toBe('bounded_recent_history')
    expect(plan.appendOnly).toBe(false)
    expect(plan.historyLimit).toBe(DEFAULT_RECENT_HISTORY_LIMIT)
    expect(plan.targetInputCostPercent).toBe(100)
  })

  it('detects DeepSeek-compatible model profiles by base URL and long context', () => {
    const profile = {
      provider: 'openai-compatible',
      model: 'reasoner-large',
      baseUrl: 'https://api.deepseek.com',
      contextWindow: 1_000_000,
    } as ModelProfileRow

    const plan = planModelProfilePromptCache(profile)

    expect(plan.appendOnly).toBe(true)
    expect(plan.reserveTokens).toBe(64_000)
    expect(plan.reason).toContain('prefix-cache')
  })
})
