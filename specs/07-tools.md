# Spec 07 — 工具系统

> 工具是 Agent 在对话中调用的「副作用入口」：写产物、读附件、调度子任务等。本 spec 定义工具接口、Registry 行为、内置工具清单与新增工具的步骤。

源文件：`src/server/tools/`

---

## 设计原则

1. **工具是无状态函数**：`handler(args, ctx) → ToolResult`，每次调用独立
2. **JSON Schema 同时给两端用**：LLM API 的 function calling 声明 + 我们自己的 zod 运行时校验（zod schema 在 handler 内部，JSON Schema 在 `parameters` 字段）
3. **错误不抛出，包装成 `ToolResult`**：Registry 的 `execute` 会 catch handler 抛出的异常并包成 `{ ok: false, error }`，让 Adapter 把错误注入 tool_result part 给 LLM 看到
4. **工具执行属 L3，不是 Adapter 的事**：但代码现状放宽 —— `CustomAgentAdapter` 直接 `import { toolRegistry }` 并自跑 tool loop（见 Spec 05 的「现状说明」）

---

## 接口定义

```typescript
interface ToolDef {
  name: string                       // 工具名，全局唯一
  description: string                // 给 LLM 看的说明
  parameters: Record<string, unknown> // JSON Schema，描述 args 形状
  handler: (args: unknown, ctx: ToolContext) => Promise<ToolResult>
}

interface ToolContext {
  conversationId: string
  workspacePath: string
  agentId: string
  runId: string
  abortSignal: AbortSignal
}

type ToolResult =
  | { ok: true; value: unknown }
  | { ok: false; error: string }
```

**约束**：
- `name` 必须是 LLM 可调用的标识符（`^[a-zA-Z0-9_]+$`，不含点号 / 横线）
- `handler` 内部应当使用 `zod` 二次校验 `args`（即便 LLM 按 JSON Schema 生成，也可能漂移）
- `handler` 必须尊重 `ctx.abortSignal`，长耗时操作应轮询或 `signal.addEventListener('abort', ...)`

---

## Registry 行为

源文件：`src/server/tools/registry.ts`

```typescript
class ToolRegistry {
  register(tool: ToolDef): void         // 重名 throw
  get(name): ToolDef | undefined        // 不存在返回 undefined
  resolve(names: string[]): ToolDef[]   // 任一不存在 throw
  execute(name, args, ctx): Promise<ToolResult>  // 不存在/handler throw → ok:false
}

export const toolRegistry = buildRegistry()
```

**重要**：`toolRegistry` 是**模块级单例**，但**不**用 `globalThis` 跨 HMR 缓存。原因：工具集是静态的（不持有 DB 连接、不订阅事件、无内存状态），每次模块重载重建即可，新增工具在 dev 模式自动生效。这与 `EventBus`（需要跨 HMR 保持订阅）的处理不同，详见 Spec 02 注。

---

## 内置工具清单

| 名称 | 用途 | 副作用 | 谁该装备 |
|---|---|---|---|
| `write_artifact` | 创建产物 | 写 DB | 任何产出代码 / 文档 / 网页的 agent |
| `read_artifact` | 读已有产物的完整内容 | 读 DB | 跨任务复用产物的 agent（Orchestrator 派的子 agent 常用） |
| `read_attachment` | 读用户上传附件 | 读文件系统 | 处理用户文档 / 文本附件的 agent |
| `plan_tasks` | Orchestrator 拆解子任务 | 无（输出端工具） | **仅 Orchestrator** |

### write_artifact

源文件：`src/server/tools/write-artifact.ts`

**当前 MVP 限制**：`type` 只接受 `'web_app' | 'document' | 'image'`，`code_file` / `diff` 未实装（需配合 workspace 写入逻辑）。

**入参容错（drift 增量）**：handler 会接受 4 种 `content` 形状并归一化到标准 `ArtifactContent`（见 Spec 04）：

| 输入形态 | 处理 |
|---|---|
| `{ files: { ... }, entry: 'index.html' }` | 标准形态，直接用 |
| `{ html: '...', css?, js? }` | 扁平形态，映射到 `index.html` / `style.css` / `script.js` |
| `{ content: '<html>...' }` 或 `{ code: '...' }` | 单文件 HTML，作为 `index.html` |
| `'<html>...'` 裸字符串 | 同上 |

**返回值**：`{ artifactId, title, type }`。**不发布 `artifact.create` 事件**，由 Adapter 在 tool_result 后统一发，AgentRunner 接住后注入 `artifact_ref` part（见 Spec 02 的「artifact_ref 注入路径」）。

### read_artifact

源文件：`src/server/tools/read-artifact.ts`

**作用域**：只能读**当前会话**的 artifact（`WHERE conversation_id = ctx.conversationId`），防越权。

**返回值**：`{ id, type, title, content, version }`，content 是完整的 `ArtifactContent`（可能很大，调用方自行决定塞回 LLM 多少）。

### read_attachment

源文件：`src/server/tools/read-attachment.ts`

**与 read_artifact 的区分**：
- `att_` 前缀 → attachment（用户上传到文件库）
- `art_` 前缀 → artifact（agent 自己产出）
- 传错前缀时 handler 给友好提示，不静默失败

**按 MIME 分支**：
- 文本类（`text/*` / `application/json` / `application/xml` / `application/javascript` / `application/x-yaml`）：直接 `readFileSync(utf8)`，截断到 50,000 字符（防 prompt 爆炸）
- 图片：返回 metadata + note，告知 LLM 图片已通过 multimodal channel 投递（见 Spec 05 multimodal 部分）
- 其他二进制（PDF / docx / zip）：仅返回 metadata + note。**TODO**：PDF 文本抽取（标 P1，需引入 `pdf-parse` 类依赖，按 CLAUDE.md §6.2 要先讨论）

**容量**：`MAX_TEXT_CHARS = 50_000`。

### plan_tasks

源文件：`src/server/tools/plan-tasks.ts`

**特殊**：这是「输出端工具」—— handler 仅校验参数并返回 `{ acknowledged: true, taskCount }`，**真正的副作用（拆分子 run、DAG 调度）在 AgentRunner 里**（见 Spec 06）。

**参数**：
```typescript
{
  reasoning: string         // 拆分理由，3 句以内
  tasks: Array<{
    id: string              // 't1' / 't2' / 't3'...
    agentId: string         // 群里现有 agent id
    task: string            // 给该子 agent 的完整指令（自包含，子 agent 看不到群聊历史）
    dependsOn?: string[]    // 前置任务 id，省略 = 可立即开始
  }>
}
```

**装备约束**：只有 `isOrchestrator=true` 的 agent 才应装备 `plan_tasks`（service 层未强制，但前端 UI 不允许给非 Orchestrator agent 勾选）。

---

## 工具调用生命周期

```
LLM 决定调用 →  Adapter emit  tool.call (StreamEvent)
                              │
                              ▼
                  AgentRunner 持久化为 tool_use part
                              │
                              ▼
   Adapter 自跑 ToolExecutor: toolRegistry.execute(name, args, ctx)
                              │
                              ▼
                  Adapter emit  tool.result (StreamEvent)
                              │
                              ▼
                  AgentRunner 持久化为 tool_result part
                              │
                  （前端把同 callId 的 tool_use + tool_result
                    合并为一个工具卡片，见 Spec 03 / 09）
```

**callId 串联**：`call_<nanoid>`，由 Adapter 在 tool.call 时分配，tool.result 必须带回相同 callId（用于前端合并 + LLM 的下一轮 turn）。

---

## 错误处理契约

| 场景 | handler 应该 | Registry 表现 | LLM 看到的 |
|---|---|---|---|
| args 不符合 schema | 返回 `{ ok: false, error }` | 透传 | tool_result.isError=true，error 文字 |
| 业务校验失败（如 artifact 不存在） | 返回 `{ ok: false, error }` | 透传 | 同上 |
| handler 内部 throw（不该发生） | — | catch 包成 `{ ok: false, error: err.message }` | 同上 |
| AbortSignal 触发 | handler 应尽早返回（行为不强制） | 透传 | 同上 |

**反模式**：不要在 handler 里 `throw new Error('failed')` 来表示业务错误，应当 `return { ok: false, error: ... }`。throw 用于真正的「不该发生」的内部异常。

---

## 新增工具步骤

> 详见 `skills/新增一个工具.md`（待写）。下面是 outline。

1. **决定工具是否需要**：三处重复后才提抽象（CLAUDE.md §4.3）
2. **新建文件** `src/server/tools/<my-tool>.ts`：
   ```typescript
   import { z } from 'zod'
   import type { ToolDef } from './types'
   
   const ArgsSchema = z.object({ ... })
   
   export const myTool: ToolDef = {
     name: 'my_tool',
     description: '...',
     parameters: { type: 'object', required: [...], properties: { ... } },
     async handler(args, ctx) {
       const parsed = ArgsSchema.safeParse(args)
       if (!parsed.success) return { ok: false, error: ... }
       // ...
       return { ok: true, value: ... }
     },
   }
   ```
3. **在 `registry.ts` 注册**：`reg.register(myTool)`
4. **决定哪些 agent 装备**：
   - 改 `src/db/seed.ts` 把工具加到对应 agent 的 `toolNames`（影响新种子）
   - 已存在的 agent 通过「编辑 Agent」对话框勾选（影响数据库现状）
   - 在 `src/components/create-agent-dialog.tsx` 的 `AVAILABLE_TOOLS` 数组加上工具名（UI 才能勾选）
5. **JSON Schema 注意点**：
   - 用 `type: 'object'` 而不是 `oneOf`（DeepSeek / OpenAI 对复杂 schema 兼容性差）
   - `description` 越具体越好，LLM 主要靠这个判断什么时候调用
   - 必填字段必须列入 `required`
6. **测试**：跑一个挂了该工具的 agent，验证调用 / 错误路径 / Abort

---

## 安全 / 沙箱约束

参考 CLAUDE.md §5。任何涉及文件系统 / 命令执行的工具必须：

- **路径解析后落在 `ctx.workspacePath` 子树内**（用 `path.resolve` + `startsWith` 检查）
- **bash cwd 强制为 `ctx.workspacePath`**
- **bash 命令前匹配 CLAUDE.md §5.2 黑名单**（rm -rf /、sudo、fork bomb、curl pipe shell 等）
- **不引入新依赖而不在 PR 中说明**（CLAUDE.md §4.3）

**TODO 工具（CLAUDE.md / 用户期望提到但代码未实装）**：

- `bash` —— 在 workspace 内跑 shell 命令。需要：黑名单 + 输出截断 + 超时 + AbortSignal 中止
- `fs_read` —— 读 workspace 文件（路径校验）
- `fs_write` —— 写 workspace 文件（路径校验 + size 限制 100MB / 1000 files，见 CLAUDE.md §5.3）
- `web_fetch` —— 抓取 URL 内容（SSRF 防护：禁止 localhost / 内网 IP / file://）

新人不要以为这些工具已经存在；要么先实现，要么按 Spec 07 §「新增工具步骤」走。

---

## 与 Spec 01 / 05 / 06 的关系

- Spec 01：定义了 `Agent.toolNames`（引用本 spec 的工具名）
- Spec 05：定义了 `AdapterInput.toolNames`（同上）；说明 Adapter 如何调用 ToolExecutor
- Spec 06：`plan_tasks` 工具是 Orchestrator 三阶段工作流的核心
