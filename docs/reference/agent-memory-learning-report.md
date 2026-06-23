# Agent Memory Learning Report

The Agent memory learning report turns Section 5 into a control-plane view for an employee Agent's memory and learning state. It is side-effect free: it does not write memories, approve learning events, or change Playbooks.

## API

```http
GET /api/agent-profiles/:id/memory-learning-report?q=optional-goal
```

The optional `q` query is used as a sample retrieval goal. Without `q`, the service builds a default goal from the Agent role and output contract.

## What It Shows

The report includes:

- memory policy
- owned memory count and active/expired split
- counts by memory type and scope
- average confidence and importance
- high-importance memories
- sensitive and encrypted memory counts
- mistake/procedural/semantic memory counts
- expiring-soon memories
- sample retrieval candidates with scores and matched terms
- reflection coverage
- pending/approved/rejected learning events
- active/draft/archived Playbooks
- Playbook version count
- human-review needs
- recommendations

## Readiness

```ts
type AgentMemoryLearningReadiness =
  | 'ready'
  | 'needs_review'
  | 'empty'
  | 'disabled'
```

`ready` means the Agent has usable memory/learning state for runtime retrieval.

`needs_review` means memory is enabled but there are pending learning events, expiring memories, or governance issues that should be reviewed by the user.

`empty` means memory is enabled but no useful memories, learning events, or Playbooks exist yet.

`disabled` means `memoryPolicy.enabled === false`, so runtime retrieval and post-run learning should be skipped.

## Learning Safety

The report intentionally does not auto-promote new lessons. Runtime reflection can produce learning events, but those events remain `pending_review` until a user approves them into Playbooks.

This matches the v1 policy:

- ordinary task memories can be written by runtime policy
- reusable procedures become learning events
- Playbooks require human review
- mistakes are preserved so future planning can avoid repeated failures
- sensitive memories are counted and expected to be encrypted

## UI Usage

Agent Factory can show the readiness score beside memory settings. Memory Center can use the same report to highlight:

- pending learning reviews
- missing seed memories
- useful mistake memories
- active Playbooks
- expiring memories
- retrieval candidates for the current task goal

Runtime can use the report as a pre-run explanation of what memory context is likely to be available before it calls `retrieveRelevantMemories`.
