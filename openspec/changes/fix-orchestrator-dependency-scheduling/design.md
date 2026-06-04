# Design

## Problem

`dependsOn` is the execution contract, but LLM-generated plans sometimes put dependency semantics only in prose. Example:

```json
{
  "id": "t4",
  "agentId": "ag_reviewer",
  "task": "先读取 PRD（t1 产物）、UI（t2 产物）和前端实现（t3 产物）..."
}
```

With no `dependsOn`, the DAG executor treats `t4` as runnable immediately.

## Approach

Add `compileDispatchPlan(plan)` between parsing and semantic validation.

The compiler is deterministic and conservative:

- Preserve explicit `dependsOn`.
- Infer dependencies only from earlier tasks in the same plan.
- Infer direct task-id references when task text contains dependency signals such as `读取`, `基于`, `产物`, `前序`, `上游`, `审查`, or `artifact`.
- Infer topic dependencies when a task consumes PRD/UI/frontend output and an earlier task appears to produce that topic.
- Make review/check/acceptance tasks depend on all earlier artifact-producing tasks.

Validation still rejects duplicate ids, unknown dependencies, unavailable agents, self dependencies, and cycles after compilation.

## Artifact Readiness

Task status `complete` is not sufficient when the task asks for an artifact. If an artifact-producing task completes with no artifact ids, the dispatch result is converted to `failed`, and downstream tasks are skipped by existing DAG logic.

## Dependency Context

Sub-agent prompts should include artifacts from the transitive dependency closure. If `t4 -> t3 -> t2 -> t1`, then `t4` gets artifacts from `t1`, `t2`, and `t3`.
