# Agent Mentorship

Section 192 adds mentor/mentee relationships between Agent profiles. A senior Agent can review output, intervene when the mentee is stuck, share relevant memories, and generate practice tasks.

## API Surface

- `POST /api/agent-mentorships` creates a mentorship relationship.
- `GET /api/agent-mentorships` lists relationships by mentor, mentee, or status.
- `POST /api/agent-mentorships/:id/actions` records a mentoring action.
- `GET /api/agent-mentoring-events` lists mentoring events.

## Relationship

A mentorship records `mentorAgentProfileId`, `menteeAgentProfileId`, scope (`all_tasks`, `specific_task_types`, or `until_proficiency`), style (`review_and_feedback`, `pair_execution`, or `shadow_mode`), and optional task-type limits.

## Actions

Supported events are:

- `review_output`
- `intervene_when_stuck`
- `share_memory`
- `generate_practice_task`
- `progress_update`

Each action can attach feedback, shared memory IDs, a generated practice task, areas improved, remaining improvement areas, and a proficiency delta.

## Progress

The service tracks initial/current/target proficiency, fastest improving areas, needs-improvement areas, and tasks until graduation. Successful tasks decrement the graduation counter; reaching target proficiency or zero remaining tasks graduates the relationship.
