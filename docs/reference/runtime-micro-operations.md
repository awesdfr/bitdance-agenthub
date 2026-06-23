# Runtime Micro-Operations

Section 100 defines the small operational decisions that let an Agent behave
more like an employee between major task steps. This implementation is
record-only and policy-driven: it stores decisions, scheduled work, and inbox
state without taking live desktop or provider actions by itself.

## Timeout Policy

The default policy includes:

- waiting for approval: 30 minutes, then keep waiting
- Agent idle: 2 hours, then hibernate
- Agent stuck: 3 no-progress steps and 10 minutes, then replan

Timeout evaluations create `runtime_micro_operation_decisions` rows with the
input facts, selected action, status, and recommendation.

## Busy-Task Policy

When a new task arrives while an Agent is busy, the policy can:

- queue the new task after current work
- safely pause and preempt for higher-priority work
- delegate to another capable Agent
- ask the user whether to interrupt

The default policy queues ordinary tasks, preempts when the new task priority
is at least 5 points higher, and delegates when a capable peer is available.

## Delayed Actions

Delayed actions are stored in `scheduled_actions`. Running due actions marks
items as:

- `due` when the Agent can be woken and the action can execute next
- `queued` when the target Agent is currently busy

This gives the scheduler a durable wake-up list without requiring an always-on
background worker in the current local-first runtime.

## Agent Inbox

Agent inbox items are stored in `agent_inbox_items` and can represent:

- user messages
- other-Agent help requests
- system notifications
- approval results
- task assignments

The next inbox item is selected by unread status, highest priority, and oldest
creation time. Processing an item marks it as `processing` and records
`processedAt`.

## API

- `POST /api/runtime-micro-operations/policies/seed`
- `GET /api/runtime-micro-operations/policies`
- `POST /api/runtime-micro-operations/policies`
- `POST /api/runtime-micro-operations/timeouts/evaluate`
- `POST /api/runtime-micro-operations/busy/evaluate`
- `GET /api/runtime-micro-operations/decisions`
- `POST /api/runtime-micro-operations/scheduled-actions`
- `GET /api/runtime-micro-operations/scheduled-actions`
- `POST /api/runtime-micro-operations/scheduled-actions/run-due`
- `POST /api/runtime-micro-operations/inbox`
- `GET /api/runtime-micro-operations/inbox`
- `POST /api/runtime-micro-operations/inbox/process-next`

## Safety

The module does not interrupt real work, control the desktop, wake a process,
or send messages by itself. It records the policy decision so the runtime,
scheduler, or user interface can apply it with the existing approval and
resource-lock layers.
