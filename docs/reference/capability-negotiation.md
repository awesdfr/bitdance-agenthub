# Agent Capability Negotiation

Section 200 is implemented as a deterministic negotiation state machine for Agents that discover missing capabilities after task intake.

## Persistence

`capability_negotiations` stores the self-check:

- requester Agent, workflow run, employee run, and task goal
- required, available, and missing capabilities
- enabled strategies: alternative, Skill install request, peer delegation, task degradation, and refusal
- peer Agent candidates
- selected strategy, resolution payload, status, and timestamps

`capability_negotiation_events` stores the timeline:

- `self_check`
- `alternative_found`
- `skill_install_requested`
- `delegation_proposed`
- `task_degraded`
- `refused`
- `resolved`

Each event also creates a standard Agent protocol message so the negotiation can be shown in collaboration and monitoring surfaces.

## APIs

- `POST /api/capability-negotiations`
- `GET /api/capability-negotiations`
- `POST /api/capability-negotiations/:id/resolve`
- `GET /api/capability-negotiation-events`

## Resolution Strategies

- `find_alternative`: records the substitute capability and limitation.
- `request_skill_install`: records Skill name, reason, and risk level.
- `delegate_to_peer`: records target Agent, subtask, and expected result.
- `degrade_task`: records what can and cannot be completed.
- `refuse_task`: fails the negotiation with an explanation.

The service validates disabled strategies, missing peer Agents, and non-open negotiations before resolution.
