# Budget Control

Section 27 is implemented as a local-first budget control plane for employee Agents.

## Scope

Budget policies can target:

- `per_task`
- `per_agent_per_day`
- `per_project_per_month`
- `global_per_month`

Each policy supports `token_count` or `usd_amount`, a numeric limit, a hard cap flag,
and a notification threshold.

## Runtime Decision

`src/server/budget-control-service.ts` evaluates:

- historical run cost in the active period
- current observed tokens and dollars
- estimated additional tokens and dollars
- optional model routing hints
- structured model/tool/CLI cost breakdowns

The result is persisted in `budget_evaluations` with:

- `ok` + `allow`
- `notify` + `notify_user`
- `blocked` + `stop_task`

Hard caps block projected usage at or above 100%. Soft caps notify the user instead
of stopping the task.

## APIs

- `POST /api/budget-control/policies/seed`
- `GET /api/budget-control/policies`
- `POST /api/budget-control/policies`
- `POST /api/budget-control/evaluate`
- `GET /api/budget-control/evaluations`
- `GET /api/budget-control/usage-report`

The usage report groups by Agent, project, day, week, or month and returns both
structured rows and a CSV string for export.

## Safety Notes

The implementation does not call model billing APIs or external gateways. It uses
local run records, route decisions, and caller-provided estimates so budget checks
are deterministic and testable in v1.
