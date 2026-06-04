# Spec 06 — Orchestrator 工作流

> 「主 Agent 协调器」是 AgentHub 的核心差异化能力。本文档定义其触发条件、工作流和数据流。

---

## 定位

Orchestrator 是「特殊 Agent」（详见 Spec 01）：
- `isOrchestrator: true`
- `toolNames` 必含 `dispatch_to_agent`（实际通过 `plan_tasks` 工具暴露给 LLM）
- 走同一个 `AgentRunner`，与普通 Agent 共享代码路径
- 默认 `adapterName: 'custom'`，由用户在创建时选定底层 LLM

**不要**为 Orchestrator 写独立服务。

---

## 触发条件

```
群聊场景（Conversation.mode === 'group'）:
  收到 user 消息时:
    if message.mentionedAgentIds 非空:
       直接为每个被 @ 的 Agent 创建独立 AgentRun
       Orchestrator 不参与
    else:
       查找该会话中 isOrchestrator: true 的 Agent
       若找到 → 触发 Orchestrator 的 AgentRun
       若未找到 → 报错：「群聊缺少协调者」

单聊场景（Conversation.mode === 'single'）:
  Orchestrator 不参与，直接触发那个 Agent
```

**蕴含规则**：群聊里有人 @ 时跳过 Orchestrator。用户的显式选择优先于自动调度。

---

## 三阶段工作流

```
┌─────────────────────────────────────────────────────────────┐
│ Stage 1: PLAN                                               │
│ ─────────────────────────────────────────────────────────── │
│ 输入：群聊上下文（XML 包装的最近 N 条 + pin） + 用户消息    │
│       + 可用 Agent 列表（动态注入到 system prompt）         │
│ 行为：调底层 LLM，提供 plan_tasks 工具，强制调用           │
│ 输出：tool.call('plan_tasks', { reasoning, tasks })         │
│        → 发 dispatch.plan 事件（UI 渲染调度卡片）           │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│ Stage 2: EXECUTE                                            │
│ ─────────────────────────────────────────────────────────── │
│ 输入：plan.tasks                                            │
│ 行为：按 dependsOn 做 DAG 拓扑                              │
│       同一波次无依赖任务并行，但受全局并发上限约束         │
│       每个子任务：                                          │
│         等待进程级全局子任务信号量槽位                     │
│         dispatch.start                                      │
│         AgentRunner.run(subAgentId, subTask, subContext)   │
│         事件全部转发到主事件流                              │
│         dispatch.end(status=complete/failed/aborted/skipped)│
│       上游 failed/aborted/skipped 时，下游传递 skipped      │
│ 输出：Map<taskId, TaskResult>                              │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│ Stage 3: AGGREGATE                                          │
│ ─────────────────────────────────────────────────────────── │
│ 输入：所有子任务结果（status / artifacts / 关键消息摘要）   │
│ 行为：再调一次 LLM，让 Orchestrator 生成聚合消息             │
│ 输出：一条 agent message，包含：                            │
│       - 完成情况总结                                        │
│       - 失败任务的原因                                      │
│       - 产物链接（artifact_ref parts）                      │
│       - 下一步建议                                          │
└─────────────────────────────────────────────────────────────┘
```

---

## plan_tasks 工具签名

```typescript
const planTasksTool: ToolDef = {
  name: 'plan_tasks',
  description: '把用户请求拆解为子任务并分派给可用 Agent。一次性输出完整 plan。',
  parameters: {
    type: 'object',
    required: ['reasoning', 'tasks'],
    properties: {
      reasoning: {
        type: 'string',
        description: '简要说明拆解思路，3 句以内',
      },
      tasks: {
        type: 'array',
        items: {
          type: 'object',
          required: ['id', 'agentId', 'task'],
          properties: {
            id: {
              type: 'string',
              description: '子任务 id，使用 t1/t2/t3 形式',
            },
            agentId: {
              type: 'string',
              description: '执行该子任务的 Agent id，必须在可用列表中',
            },
            task: {
              type: 'string',
              description: '给该 Agent 的具体任务描述，独立可执行',
            },
            dependsOn: {
              type: 'array',
              items: { type: 'string' },
              description: '前置依赖的子任务 id 列表，无依赖则省略',
            },
          },
        },
      },
    },
  },
  handler: async (args, ctx) => {
    // plan_tasks 的 handler 不实际「执行」，
    // 它只是把 plan 透传给 AgentRunner 让其调度。
    // 这里返回的 ok=true 让 LLM 知道 plan 已被接受。
    return { ok: true, value: { acknowledged: true, taskCount: args.tasks.length } }
  },
}
```

**说明**：`plan_tasks` 是「输出端工具」——它的目的是让 LLM 用结构化方式输出 plan，而不是真的去做什么副作用。

**校验分层**：
- `plan_tasks` handler 只做参数形状校验（`tasks` 是否为数组、字段是否存在），返回 ack 给 LLM。
- AgentRunner 在发布 `dispatch.plan` 与进入 EXECUTE 前必须先编译 plan，再做语义校验；失败时不发布 `dispatch.plan`，当前 Orchestrator run 以 `failed` 结束，并把明确错误写入 `run.end.error` / 错误消息。

**plan 编译**：
- `dependsOn` 仍是唯一执行顺序契约，但 Orchestrator 的 LLM 可能把依赖写进 task 文本而漏写字段。
- AgentRunner 必须在校验前运行确定性的 `compileDispatchPlan`：
  - 保留显式 `dependsOn`
  - 仅从同一 plan 中排在当前任务之前的任务推断缺失依赖
  - 识别 `t1 产物`、`读取 PRD`、`基于 UI 设计`、`审查前端实现`、`上游产物` 等高置信依赖信号
  - 审查 / 验收类任务默认依赖前面所有产物型任务
- `dispatch.plan` 事件发布编译后的 plan，而不是原始 LLM 输出。

语义校验规则：
- `tasks` 非空
- 每个 `id` 唯一
- 每个 `agentId` 必须属于当前群聊的可用 worker Agent 列表
- `agentId` 不能是 Orchestrator 自己，避免递归分派
- `dependsOn` 只能引用同一 plan 中存在的 task id
- task 不能依赖自己；同一 task 的 `dependsOn` 不能重复
- plan 必须是 DAG，不允许循环依赖

---

## Orchestrator 的 system prompt 模板

```
你是 AgentHub 的 Orchestrator，负责把用户请求拆解并分派给合适的 Agent。

【你的工作流】
1. 阅读群聊上下文与用户最新请求
2. 调用 plan_tasks 工具，输出结构化 plan
3. 等待系统执行 plan（你不需要做任何事）
4. 系统会再次唤起你做聚合总结

【可用 Agent 列表】
{{AGENT_LIST}}
（每个 Agent 包含 id、name、capabilities、description）

【拆解原则】
- 充分利用每个 Agent 的 capabilities
- 能并行的尽量并行（不写 dependsOn）
- 有依赖关系的明确写 dependsOn
- 每个子任务给出独立可执行的描述（被分派的 Agent 看不到完整群聊上下文）
- 不要重复拆解已有产物已满足的需求

【输出规则】
- 你只能调用 plan_tasks 工具，不要直接回复用户文字
- plan 一次性输出完整，不要分多次调用
```

---

## 子 Agent 看到的上下文

子 Agent 收到的 prompt 由 Orchestrator 的 `task` 字段 + 摘要包装而成：

```xml
<context>
  <recent_conversation>
    <!-- 最近 5 条群聊消息，按 Spec 03 的 XML 包装 -->
    <message from="user">帮我做一个番茄钟网站</message>
    <message from="orchestrator">[Orchestrator 的上一条消息]</message>
  </recent_conversation>

  <pinned_messages>
    <!-- 用户 pin 的关键消息 -->
  </pinned_messages>

  <upstream_artifacts>
    <!-- dependsOn 上游任务产物；仅列 id/title/type，不内联内容 -->
    <artifact id="art_001" type="document" title="番茄钟 PRD"/>
  </upstream_artifacts>

  <existing_artifacts>
    <!-- 会话内最近 N 个非上游产物；仅列 id/title/type，不内联内容 -->
    <artifact id="art_002" type="image" title="UI 设计稿"/>
  </existing_artifacts>
</context>

<your_task>
  {{ Orchestrator plan 里指派给这个 agent 的 task 字段 }}
</your_task>
```

**lazy load**：子 Agent 需要某个产物详情时，调用 `read_artifact(id)` 工具按需获取。

**artifact 注入**：
- `upstream_artifacts`：来自当前任务 `dependsOn` 的传递闭包上游结果，按 artifact id 去重后全部列出。例：`t4 -> t3 -> t2 -> t1` 时，t4 能看到 t1/t2/t3 的产物摘要。
- `existing_artifacts`：来自当前会话其它产物，排除 `upstream_artifacts` 中已经列过的 id，只保留最近 N 个（默认 5，按 `createdAt desc`），避免长会话把所有产物重复塞给每个子 agent。
- 两者都只列 `id` / `type` / `title`，不内联 artifact 内容；需要全文时走 `read_artifact(id)`。

**上下文截断**：`recent_conversation` 取最近 5 条 + 所有 pin。超出可配置上限（默认 5）的不传。

**与 Phase C 跨 agent 历史的关系**：Phase C（spec 13）给普通会话轮次的 custom agent 注入了 `[名字]` 前缀的完整群聊历史，但**被分派的 sub-agent 明确跳过 `buildHistoryFor`**——`agent-runner.ts:buildAdapterInput` 在 `args.overridePrompt` 已设时不注入历史。子 agent 的唯一上下文就是上面这个 `buildSubAgentPrompt` 包装，隔离原则不受 Phase C 影响。

---

## 子任务并发上限

Orchestrator 子任务执行使用 AgentRunner 模块级全局信号量，默认 `MAX_CONCURRENT_SUB_AGENT_RUNS = 4`。

语义：
- 上限是当前 Node 进程内全局共享，不按 conversation 分桶；这样更接近 provider API key 的限流粒度。
- `dispatch.start` 只在任务拿到槽位、即将启动 child AgentRun 时发布；等待槽位期间任务在 UI 中保持 `pending`。
- 父 run abort 时，仍在等待槽位的任务发布 `dispatch.end(status='aborted')`，不创建 child AgentRun。
- 不做 provider 分组、不做用户设置项；后续真需要更细粒度限流时再扩展。

---

## DAG 调度算法

`executePlan` 只接收已编译并通过语义校验的 plan；缺失依赖、重复 id、自依赖、循环依赖等坏 plan 应在进入本阶段前给出清晰错误。

```typescript
async function executePlan(
  plan: DispatchPlanItem[],
  ctx: { parentRunId: string, conversationId: string }
): Promise<Map<string, TaskResult>> {
  const completed = new Map<string, TaskResult>()
  const remaining = new Set(plan.map(t => t.id))

  while (remaining.size > 0) {
    // 上游没有成功完成的任务，不启动下游，直接标 skipped
    const skipped = plan.filter(t =>
      remaining.has(t.id) &&
      (t.dependsOn ?? []).some(d => completed.has(d) && completed.get(d)?.status !== 'complete')
    )
    for (const t of skipped) {
      const result = { taskId: t.id, status: 'skipped', error: 'Upstream task did not complete' }
      publish({ type: 'dispatch.end', parentRunId: ctx.parentRunId,
                taskId: t.id, status: 'skipped', error: result.error })
      completed.set(t.id, result)
      remaining.delete(t.id)
    }

    // 找出所有依赖已成功完成的任务
    const ready = plan.filter(t =>
      remaining.has(t.id) &&
      (t.dependsOn ?? []).every(d => completed.get(d)?.status === 'complete')
    )

    if (ready.length === 0) {
      throw new Error('Circular dependency or missing dependency in plan')
    }

    // 同一波并行执行；runSubTask 内部会先等待全局子任务信号量
    const results = await Promise.all(
      ready.map(t => runSubTask(t, completed, ctx))
    )

    for (let i = 0; i < ready.length; i++) {
      completed.set(ready[i].id, results[i])
      remaining.delete(ready[i].id)
    }
  }

  return completed
}

async function runSubTask(
  task: DispatchPlanItem,
  upstream: Map<string, TaskResult>,
  ctx: { parentRunId: string, conversationId: string }
): Promise<TaskResult> {
  const subRunId = generateRunId()
  publish({ type: 'dispatch.start', parentRunId: ctx.parentRunId,
            childRunId: subRunId, taskId: task.id, agentId: task.agentId, ... })

  try {
    const result = await AgentRunner.run({
      agentId: task.agentId,
      conversationId: ctx.conversationId,
      runId: subRunId,
      parentRunId: ctx.parentRunId,
      prompt: buildSubAgentPrompt(task, upstream, ctx.conversationId),
    })
    publish({ type: 'dispatch.end', parentRunId: ctx.parentRunId,
              childRunId: subRunId, taskId: task.id, status: result.status, ... })
    return { taskId: task.id, status: result.status, artifacts: result.artifacts }
  } catch (err) {
    publish({ type: 'dispatch.end', parentRunId: ctx.parentRunId,
              childRunId: subRunId, taskId: task.id,
              status: 'failed', ... })
    return { taskId: task.id, status: 'failed', error: String(err) }
  }
}
```

---

## 失败降级

**策略**：记录上报，由 Orchestrator 在聚合阶段决定向用户的措辞。

```
子 Agent run 失败:
  不在 AgentRunner 层重跑整个子任务
  TaskResult.status = 'failed'，error 字段记录原因

子 Agent run 被用户中止或父 run 级联中止:
  TaskResult.status = 'aborted'
  dispatch.end.status = 'aborted'

某任务文本 / 类型明确要求产出 artifact，但 child run complete 后 artifactIds 为空:
  TaskResult.status = 'failed'
  error 记录「任务需要产物但未产出」
  下游按依赖失败规则 skipped

某任务的任一 dependsOn 上游不是 complete:
  不启动该任务，不创建 child AgentRun
  TaskResult.status = 'skipped'
  dispatch.end.status = 'skipped'，不带 childRunId，但带 parentRunId

Stage 3 聚合时，Orchestrator 看到的 prompt 包含所有任务状态：
  <task_results>
    <result task="t1" agent="pm" status="complete">
      <artifact_ref id="art_001"/>
    </result>
    <result task="t2" agent="design" status="failed">
      <error>Rate limited by upstream provider</error>
    </result>
    <result task="t3" agent="frontend" status="skipped" error="Skipped because upstream task(s) did not complete"/>
  </task_results>

Orchestrator 据此生成聚合消息。
```

**不做的事**：
- ❌ AgentRunner 层不做「同一子任务自动重试」的逻辑（避免重复工具副作用 / 重复 artifact；必要时由 Orchestrator 决定再次 plan）
- ❌ AgentRunner 层不做「换个 Agent 重试」的逻辑（Orchestrator 决定，必要时再次 plan）
- ❌ 不做无限重试

---

## 数据流（完整一次群聊请求）

```
1. user 发消息（无 @）→ POST /api/conversations/:id/messages
2. ConversationService 写 user message
3. 找到该会话的 Orchestrator agent，触发 AgentRunner.run(orch, ...)
4. AgentRunner: run.start
5. AgentRegistry.getAdapter(orch) → CustomAgentAdapter (假设 Orchestrator 用 Claude)
6. Adapter.stream() → LLM 调用 plan_tasks 工具
   - 发 tool.call('plan_tasks', { ... })
   - ToolExecutor 执行 plan_tasks handler（实际只是确认）
   - 发 tool.result
7. AgentRunner 在 tool.call 是 plan_tasks 时，
   解析 args.tasks → 编译缺失依赖 → 做 plan 语义校验 → 转发编译后的 dispatch.plan 事件
   并接管控制，进入 Stage 2；若校验失败则当前 run 失败并报告明确错误
8. AgentRunner.executePlan(...):
   for each wave:
     Promise.all(ready.map(task =>
       wait global sub-agent semaphore, then AgentRunner.run(subAgent, ..., parentRunId=orchRunId)
     ))
9. 所有子 run 结束 → AgentRunner 回到 Orchestrator，
   把 task_results 作为新一轮 prompt 喂给 Adapter，跑 Stage 3
10. Orchestrator 输出聚合消息
11. run.end
```

---

## Orchestrator 的 LLM 选型

Orchestrator 的 `adapterName: 'custom'`，`modelProvider` 和 `modelId` 在创建时由用户选定。

推荐默认值：
- `modelProvider: 'anthropic'`
- `modelId: 'claude-opus-4-7'`

理由：Orchestrator 重度依赖 tool use + structured output + 多步推理，Claude Opus 在这三项上当前最稳。如用户选其他模型，行为可能下降但接口不变。

---

## 不要做的事

- ❌ 不在 Orchestrator system prompt 里硬编码具体 Agent 名字（动态注入 `{{AGENT_LIST}}`）
- ❌ 不为 Orchestrator 开辟独立的 API 端点或服务类
- ❌ 不让 Orchestrator 在 plan 阶段直接调用子 Agent（必须通过 plan_tasks 透传 plan，AgentRunner 负责实际调度）
- ❌ 不在 plan 中允许循环依赖（AgentRunner 的 plan 语义校验会拒绝并报错）
- ❌ 不让子 Agent 看到完整群聊历史（隔离 + lazy load）。实现上由 `agent-runner.ts` 在 `args.overridePrompt` 已设时跳过 `buildHistoryFor` 保证（详见 spec 13）

---

## 单元测试关注点

- DAG 拓扑排序的正确性（diamond、链、并行的混合）
- plan 语义校验：重复 id、未知 agentId、派给 Orchestrator 自己、未知 dependsOn、自依赖、循环依赖
- plan 中引用不存在的 agentId 时的报错路径
- Orchestrator system prompt 注入 `{{AGENT_LIST}}` 后的格式
