import { and, desc, eq } from 'drizzle-orm'

import { db, schema } from '@/db/client'
import { newAgentId } from '@/server/ids'
import type { AdapterName, ModelProvider } from '@/shared/types'

/**
 * 用户自建 Agent 的服务。
 *
 * 自建 Agent 一律走 adapterName='custom'，由用户指定底层 LLM 与工具集。
 * 内置 Agent (isBuiltin=true) 不可被删除或修改。
 */

export interface CreateAgentArgs {
  name: string
  avatar: string
  description: string
  capabilities: string[]
  systemPrompt: string
  modelProvider: ModelProvider
  modelId: string
  toolNames: string[]
}

export async function createCustomAgent(args: CreateAgentArgs) {
  const id = newAgentId()
  const createdAt = Date.now()

  const row = {
    id,
    name: args.name.trim(),
    avatar: args.avatar.trim() || '🤖',
    description: args.description.trim(),
    capabilities: args.capabilities,
    systemPrompt: args.systemPrompt,
    adapterName: 'custom' as AdapterName,
    modelProvider: args.modelProvider,
    modelId: args.modelId,
    toolNames: args.toolNames,
    isBuiltin: false,
    isOrchestrator: false,
    createdAt,
  }

  await db.insert(schema.agents).values(row)
  return row
}

export async function deleteCustomAgent(agentId: string): Promise<void> {
  // 防止误删内置
  const agent = await db.query.agents.findFirst({
    where: eq(schema.agents.id, agentId),
  })
  if (!agent) throw new Error(`Agent not found: ${agentId}`)
  if (agent.isBuiltin) throw new Error('Built-in agents cannot be deleted')

  const deleted = await db
    .delete(schema.agents)
    .where(and(eq(schema.agents.id, agentId), eq(schema.agents.isBuiltin, false)))
    .returning({ id: schema.agents.id })

  if (deleted.length === 0) {
    throw new Error(`Failed to delete agent: ${agentId}`)
  }
}

export async function listAgentsOrdered() {
  // 内置在前，按 createdAt desc
  return db.query.agents.findMany({
    orderBy: [desc(schema.agents.isBuiltin), desc(schema.agents.createdAt)],
  })
}
