# Emotional UX

Section 122 is implemented as configurable UX guidelines for Agent-facing surfaces.

## Guideline Types

`emotional_ux_guidelines` stores three groups:

- `tone`: message rhythm for task start, progress, blocked, completed, and failed states
- `microinteraction`: thinking pause, tool success, tool failure, long operation, approval request, and all-tasks-complete feedback
- `anxiety_reduction`: clear working/waiting states, long-silence updates, dangerous-action warnings, visible activity, and persistent emergency stop

## Tone Scenarios

| Scenario | Intent |
| --- | --- |
| `task_start` | Confident, positive, dependable colleague tone |
| `in_progress` | Transparent, realtime progress reporting |
| `blocked` | Honest, non-defensive request for direction |
| `completed` | Measurable result plus artifact reference |
| `failed` | Responsible failure summary with learning |

## Microinteractions

| Scenario | UX behavior |
| --- | --- |
| `thinking_pause` | Subtle pause before the Agent starts responding |
| `tool_success` | Lightweight success confirmation |
| `tool_failure` | Soft warning plus recovery direction |
| `long_operation` | Progress percentage and estimated remaining time |
| `approval_request` | Gentle reminder, not an alarming interruption |
| `all_tasks_complete` | Small, restrained completion celebration |

## Anxiety Reduction

The default rules make Agent state inspectable and user control visible:

- separate working and waiting states
- send progress updates during long silence
- require stronger visual confirmation for dangerous actions
- show current goal, step, tool, and next action
- keep emergency stop visible on run surfaces

## API

- `POST /api/emotional-ux/seed`
- `GET /api/emotional-ux/guidelines`
- `GET /api/emotional-ux/guidelines?guidelineType=tone`
- `POST /api/emotional-ux/guidelines`
