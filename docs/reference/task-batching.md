# Resource-Aware Task Batching

Section 205 adds a conservative batching layer on top of task queues. It lets the system plan a merged task for small compatible queued work without hiding urgent, long-running, or approval-gated work.

## Flow

1. `POST /api/task-batches` scans queued due tasks in a queue window.
2. The planner excludes tasks by configured rules such as `priority == 1`, `estimated_duration > 10m`, and `requires_approval`.
3. Remaining tasks are grouped by Agent, task type, and project unless the strategy allows wider merging.
4. A `task_batches` row records the source task ids, merge strategy, benefits, merged payload, and exclusion reasons.
5. `POST /api/task-batches/:id/apply` creates one queued `task_batch` item and marks the source items as `canceled` with `result.batchedInto`.

## Default Strategy

```json
{
  "windowMs": 60000,
  "maxBatchSize": 5,
  "mergeable": {
    "sameAgent": true,
    "sameType": true,
    "sameProject": true,
    "crossAgent": false
  },
  "exclusionRules": ["priority == 1", "estimated_duration > 10m", "requires_approval"]
}
```

## Safety Properties

- Planning is non-destructive.
- Applying is explicit and auditable.
- Urgent tasks remain single-dispatch.
- Long tasks remain individually visible.
- Approval-gated work is not hidden inside a batch.
- The scheduler completes `task_batch` items as a structured merge record; it does not run external commands from the batch payload.
