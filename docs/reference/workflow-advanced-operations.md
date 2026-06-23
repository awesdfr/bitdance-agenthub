# Workflow Advanced Operations

Section 101 adds advanced workflow operations for partial reruns, task merge
suggestions, and parameterized workflow templates. The module is durable and
auditable: it records the plan first, then applies only explicit, bounded
changes.

## Partial Rerun

When a node fails, the system can plan a rerun from that node:

- upstream completed node runs are kept as cached evidence
- the selected node and all downstream nodes are queued again
- the cost scope records which nodes are charged again
- an optional input patch can be merged into the workflow run input

Applying the plan does not rerun the whole workflow. It resets only the
selected downstream node runs to `queued` so the existing workflow runner can
continue from the right point.

## Task Merge Suggestions

Similar user tasks can be merged into one suggested task when they share a
task type and Agent. The suggestion records:

- source task ids
- merged title
- merged payload with separated source task details
- expected saved model calls
- user approval or rejection

Rejected suggestions leave tasks separate. Approved suggestions can be marked
as applied.

## Workflow Template Variables

Workflow templates declare parameters with:

- `string`
- `number`
- `file`
- `url`
- `select`
- `boolean`

Instantiation validates required parameters and types, renders `{{param}}`
placeholders in workflow descriptions and node configuration, then creates a
new draft workflow instance.

## API

- `POST /api/workflow-advanced-operations/partial-reruns`
- `GET /api/workflow-advanced-operations/partial-reruns`
- `POST /api/workflow-advanced-operations/partial-reruns/:id/apply`
- `POST /api/workflow-advanced-operations/task-merge-suggestions`
- `GET /api/workflow-advanced-operations/task-merge-suggestions`
- `POST /api/workflow-advanced-operations/task-merge-suggestions/:id/decide`
- `POST /api/workflow-advanced-operations/task-merge-suggestions/:id/apply`
- `POST /api/workflow-advanced-operations/template-instantiations`
- `GET /api/workflow-advanced-operations/template-instantiations`

## Safety

The service does not silently discard upstream artifacts or auto-merge user
tasks. Partial reruns preserve cached upstream outputs, merge suggestions
require user decision before apply, and template instantiation creates a new
draft workflow instead of mutating the source template.
