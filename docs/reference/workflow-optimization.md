# Workflow Optimization Engine

Section 202 is implemented as a record-only workflow analysis engine.

The service reads workflow structure and historical workflow node runs, then saves an optimization snapshot. It does not directly rewrite the workflow graph unless a future explicit graph-migration step is added.

## Persistence

`workflow_optimizations` stores:

- workflow id and analyzed run count
- bottleneck analysis
- redundancy analysis
- parallelization opportunities
- cost optimizations
- auto-apply policy
- record-only applied changes
- analyzed/applied status

## APIs

- `POST /api/workflow-optimizations`
- `GET /api/workflow-optimizations`
- `POST /api/workflow-optimizations/:id/apply`

## Analysis Dimensions

- Bottlenecks: average node duration and percentage of total node time.
- Redundancies: nodes with the same type, Agent, purpose, and output contract.
- Parallelization opportunities: node pairs with no dependency path.
- Cost optimization: nodes with high configured estimated cost.

Auto-apply only records low or medium risk recommendations as applied metadata; it does not mutate the user's workflow graph.
