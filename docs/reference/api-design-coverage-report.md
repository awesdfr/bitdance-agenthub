# API Design Coverage Report

Section 20 defines the v1 control-plane API contract for model profiles,
network profiles, Agent profiles, Skills, tool connections, CLI profiles,
software profiles, workflows, workflow runs, Agent run memory/reflection, and
approval decisions.

`GET /api/api-design/coverage-report` returns a machine-checkable report for
that contract.

## What The Report Checks

The report checks 36 documented endpoints:

- Model profile APIs: list, create, test.
- Network profile APIs: list, create, test.
- Agent profile APIs: list, create, patch, test.
- Skills APIs: list, install, enable.
- Tool Connection APIs: list, create, test.
- CLI Profile APIs: list, create, test.
- Software Profile / Command APIs: list, create, record command, test command.
- Workflow APIs: list, create, run.
- Workflow Run APIs: snapshot, events, pause, resume, cancel.
- Agent Run APIs: memory and reflection.
- Approval APIs: approve and reject.

For each endpoint, the report checks the expected App Router `route.ts` file and
the required exported HTTP method handler.

## Exact And Compatible Coverage

Most Section 20 endpoints have exact route coverage. The v1 implementation uses
employee-run control routes for workflow node execution control:

- `POST /api/workflow-runs/:id/pause` is compatible through
  `POST /api/employee-runs/:id/pause`.
- `POST /api/workflow-runs/:id/resume` is compatible through
  `POST /api/employee-runs/:id/resume`.
- `POST /api/workflow-runs/:id/cancel` is compatible through
  `POST /api/employee-runs/:id/cancel`.

This is intentional for v1 because workflow nodes execute through employee runs.
The report keeps these as warnings rather than gaps, so a direct workflow-level
wrapper can be added later without losing the current implementation evidence.
