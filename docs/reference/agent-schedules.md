# Agent Scheduling And Availability

Section 204 is implemented as Agent-level scheduling and availability evaluation.

## Persistence

`agent_schedules` stores:

- Agent profile id
- timezone
- weekly working-hour schedule
- maintenance windows
- overtime policy
- vacation mode and backup Agent
- current status and last availability decision

## APIs

- `POST /api/agent-schedules`
- `GET /api/agent-schedules`
- `POST /api/agent-schedules/:id/evaluate`

## Availability Decision

Evaluation returns:

- `allowed`
- `currentStatus`: `on_duty`, `off_duty`, `overtime`, `maintenance`, or `vacation`
- reason
- whether to queue the task
- backup Agent delegation target
- whether the user should be notified

The service supports normal working hours, all-day schedules, maintenance windows, urgent-task overtime bypass, and vacation behaviors: reject, queue, or delegate to a backup Agent.
