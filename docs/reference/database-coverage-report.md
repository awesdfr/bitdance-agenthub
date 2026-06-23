# Database Coverage Report

Section 18 is verified through a database coverage report. It checks the table and equivalent persistence required by the employee-level Agent orchestration plan.

## API

```txt
GET /api/database/coverage-report
```

The report is side-effect free. It reads:

- `src/db/schema.ts`
- `src/db/bootstrap.ts`
- the current SQLite table list

## Coverage Model

Most Section 18 requirements are physical tables, such as:

- `model_profiles`
- `network_profiles`
- `agent_profiles`
- `agent_workstations`
- `memory_items`
- `learning_events`
- `run_reflections`
- `playbooks`
- `tool_connections`
- `mcp_servers`
- `cli_profiles`
- `software_profiles`
- `software_commands`
- `recorded_macros`
- `workflows`
- `workflow_nodes`
- `workflow_edges`
- `workflow_runs`
- `workflow_node_runs`
- `resource_locks`
- `approval_requests`
- `artifacts`
- `artifact_validations`

Two logical requirements are stored as embedded JSON policy fields on `agent_profiles`:

- `agent_permissions` -> `agent_profiles.permission_policy`
- `agent_memory_policies` -> `agent_profiles.memory_policy`

The report marks those as `embedded_json_policy`, not as missing physical tables.

## Readiness

The report returns `ready` only when every required item is covered by:

- a schema export
- bootstrap DDL
- the current SQLite database table
- embedded policy column evidence where applicable
