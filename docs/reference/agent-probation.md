# Agent Probation and Risk Tiering

Section 104 gives every new Agent a probation record before it can be treated like a production employee.

## Persisted Records

- `agent_probation_records`: current probation status, staging/production environment, risk tier, task counts, success rate, thresholds, restrictions, and latest evaluation.
- `agent_environment_promotions`: staging-to-production promotion requests, linked approval request, optional A/B comparison evidence, and approval/application status.

## Default Probation Restrictions

New Agents start in `staging` with `probation` status and `high` risk tier.

The default restrictions are:

- autonomy is limited to `observe_only` or `propose_only`
- file deletion is blocked
- external network requests are blocked
- write operations require approval
- per-task token budget is reduced to 50%
- maximum concurrent steps are reduced to 50%
- staging output is not directly deployable

## Graduation

The default graduation threshold is:

- at least 10 terminal tasks
- success rate greater than 80%

`POST /api/agent-probation/evaluate` recalculates task count, success count, success rate, eligibility, and risk tier. With `autoGraduate: true`, an eligible Agent becomes `graduated`, but it stays in `staging` until production promotion is approved.

## Production Promotion

Production promotion is approval gated:

1. The Agent must be `eligible_for_promotion` or `graduated`.
2. `POST /api/agent-probation/promotions` creates an `agent_environment_promotion` approval request.
3. Optional A/B comparison evidence can be attached or generated from staging and production Agent run history.
4. `POST /api/agent-probation/promotions/:id/decide` approves or rejects the request.
5. `POST /api/agent-probation/promotions/:id/apply` moves the Agent to `production` only after approval.

## API

- `GET /api/agent-probation`
- `POST /api/agent-probation/evaluate`
- `GET /api/agent-probation/promotions`
- `POST /api/agent-probation/promotions`
- `POST /api/agent-probation/promotions/:id/decide`
- `POST /api/agent-probation/promotions/:id/apply`

The service is local-first and does not grant production privileges without a recorded approval.
