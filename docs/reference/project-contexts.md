# Project Contexts

Project contexts let one Agent work across multiple projects without mixing project budgets, model routing, Skill policy, network outlets, workflows, artifacts, or memories.

## Project Overrides

| Field | Purpose |
| --- | --- |
| `modelProfileId` | Force a project-specific model. |
| `maxBudget` | Set the project budget ceiling. |
| `allowedSkills` | Restrict Skills available inside the project. |
| `requiredApprovalFor` | Actions that always need approval in this project. |
| `networkProfileId` | Project-specific network outlet. |

## Agent Roles

Each project can attach Agents with:

- role
- join time
- active workflows
- contributed artifacts
- project-specific memories

This is the project-level equivalent of an employee assignment record.

## Switch Behavior

| Field | Default | Meaning |
| --- | --- | --- |
| `pauseCurrentTasks` | `true` | Pause current project tasks before switching. |
| `isolateMemories` | `true` | Keep memories separate by project. |
| `checkpointBeforeSwitch` | `true` | Record a checkpoint marker before switching. |
| `mode` | `sequential` | `sequential`, `parallel`, or `time_sliced`. |

Project switch events are recorded before runtime execution so the scheduler can decide whether to pause, checkpoint, isolate memory, or time-slice the Agent.
