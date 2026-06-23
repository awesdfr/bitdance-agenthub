# Behavior Stabilization

Behavior stabilization detects when an Agent's behavior drifts away from its original configuration because memories, playbooks, or repeated feedback have changed how it works.

## Drift Detection

Each Agent can record a baseline snapshot and later current snapshots on a schedule such as `weekly`.

Tracked metrics:

- average steps per task
- average cost per task
- approval request rate
- typical plan structure
- tool preference order
- output verbosity
- maximum allowed deviation, normally `0.2`

## Stabilization Actions

When drift is significant, the system can plan:

- memory hygiene
- learned behavior reset
- re-anchoring to the original configuration
- recalibration with baseline benchmarks

These actions are recorded as planned stabilization runs. They are not applied silently unless the configured response policy allows automation.

## Response Policies

| Policy | Behavior |
| --- | --- |
| `notify` | Inform the user and wait. |
| `auto_correct` | Plan automatic stabilization actions. |
| `ask_user` | Pause and ask for explicit approval before changing behavior. |
