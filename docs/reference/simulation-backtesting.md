# Simulation And Backtesting

Section 41 adds a deterministic local simulation and backtesting layer before live Agent or Workflow rollout.

## Dry Run Simulation

`POST /api/simulations`

Creates a simulation run where:

- the Agent or Workflow sees a simulated environment, not real files or browsers;
- tool calls use fixture results or user-played environment responses;
- the system records planned steps;
- the run pauses in `awaiting_review`;
- the user can approve, reject, or attach adjustments before any live execution.

`POST /api/simulations/:id/review`

Records an approval or rejection with optional plan adjustments.

## Historical Backtest

`POST /api/backtests`

Runs a candidate Agent or Workflow configuration over historical tasks. The result stores:

- baseline version;
- candidate version;
- candidate change metadata;
- per-task baseline/candidate scores;
- success-rate deltas;
- gate status.

The current implementation is deterministic and local-only. It does not call model providers or mutate real workspaces.

## Golden Set

`POST /api/golden-task-sets`

Stores a reusable golden task set with explicit success criteria and CI gate policy.

Golden backtests can block a rollout when:

- the candidate success rate falls below `minSuccessRate`;
- the candidate regresses more than `maxRegression`;
- `blockOnRegression` is enabled.

This provides a CI-ready gate for future PR or plugin checks.
