# Natural Language Workflows

Section 109 is implemented as a deterministic draft-to-confirm workflow generator.

## Flow

1. The user enters a natural language request in Agent Canvas.
2. `NaturalLanguageWorkflowDraftService` parses the prompt into:
   - trigger intent
   - condition branches
   - actions
   - Agent matches
   - a workflow preview with nodes and edges
3. The preview is stored in `natural_language_workflow_drafts`.
4. The user can inspect the preview on the canvas, modify the draft, or confirm it.
5. Confirming creates real `workflows`, `workflow_nodes`, and `workflow_edges`.

## GitHub Issue Triage

The built-in parser recognizes prompts such as:

```text
当 GitHub 有新 Issue 时，让代码 Agent 分析问题，如果是 bug 就分配给修复 Agent，如果是 feature 就加到计划表
```

It generates:

```text
Webhook Trigger -> 代码分析 Agent -> 条件判断 -> 修复 Agent / 添加到计划文档
```

The preview uses a safe webhook configuration with `dryRunOnly: true`; no live GitHub webhook is registered and no external credential is required.

## APIs

- `GET /api/workflow-nl-drafts`
- `POST /api/workflow-nl-drafts`
- `POST /api/workflow-nl-drafts/:id/revise`
- `POST /api/workflow-nl-drafts/:id/confirm`

## Runtime Boundary

This implementation does not call an external model. That keeps the parser testable and offline-first. A future model-backed parser can replace the deterministic parser as long as it produces the same preview contract before confirmation.
