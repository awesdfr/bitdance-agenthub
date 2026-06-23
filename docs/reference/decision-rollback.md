# Decision-Level Rollback

Section 201 is implemented as a non-destructive rollback planning service for Agent decisions.

It does not directly delete files, memories, or knowledge graph edges. Instead, it records which decisions should be treated as rolled back, what work may be lost, what downstream entities need review, and how the Agent should restart from the rollback point.

## Persistence

`decision_rollbacks` stores:

- employee run and Agent
- target decision from `decision_audit_trails`
- granularity: `single_decision`, `step_decisions`, or `from_decision_onwards`
- rollback scope for file changes, memory changes, peer cascade, and knowledge graph review
- reason type and description
- affected decision, memory, and peer Agent ids
- lost work summary and estimated rollback cost
- rollback history and restart plan
- planned/applied status

## APIs

- `POST /api/decision-rollbacks`
- `GET /api/decision-rollbacks`
- `POST /api/decision-rollbacks/:id/apply`

## Restart Plan

Each rollback creates a message for the Agent:

- the target decision that was revoked
- the reason
- blocked decisions that must not be reused
- preserved decision ids that can remain context
- whether user review is required before the Agent continues

This gives the runtime enough structure to restart from a decision point without silently trusting invalid prior work.
