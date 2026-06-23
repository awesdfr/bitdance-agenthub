# Prompt Drift And Model Behavior Change

Section 118 covers the risk that a model provider silently changes model behavior and an Agent becomes worse without a visible configuration change.

The implementation adds:

- `prompt_drift_monitors`
- `model_behavior_snapshots`
- `prompt_drift_runs`

## Monitors

A prompt drift monitor records:

- schedule: `7d`, `30d`, or `on_model_update_notice`
- checks:
  - output format stability
  - refusal rate change
  - verbosity change
  - tool calling accuracy
  - reasoning quality
  - latency change
  - cost change
- action on drift:
  - notify user
  - auto rollback model
  - create incident
- thresholds for each check

## Model Behavior Snapshots

A model behavior snapshot stores the model identity and benchmark results at a point in time:

- model name
- model date or dated provider snapshot
- optional provider version
- benchmark scores
- pinned flag

Pinned snapshots represent model behavior the user is satisfied with. Drift runs can compare a candidate snapshot against a pinned baseline.

## Drift Runs

`POST /api/prompt-drift/checks` compares baseline and candidate benchmark metrics.

The default metrics are:

- `output_format_schema_score`
- `refusal_rate`
- `avg_output_tokens`
- `tool_call_accuracy`
- `reasoning_quality_score`
- `latency_ms_p95`
- `cost_usd_per_task`

The result is stored as a prompt drift run with:

- `stable`
- `warning`
- `drift_detected`

The run also records drift signals, a summary, and the recommended action from the monitor.

## API

- `GET /api/prompt-drift/monitors`
- `POST /api/prompt-drift/monitors`
- `GET /api/prompt-drift/snapshots`
- `POST /api/prompt-drift/snapshots`
- `POST /api/prompt-drift/checks`
- `GET /api/prompt-drift/runs`

This is record-only in v1. It does not call live model providers or automatically change production models unless a future workflow explicitly applies the recommendation with approval.
