# Test Plan Coverage Report

Section 23 is tracked by `src/server/test-plan-coverage-report-service.ts` and exposed through:

```txt
GET /api/test-plan/coverage-report
```

The report converts the required test checklist into auditable evidence. Each checklist item names the required assertion and the source files, integration tests, API smokes, or services that must contain matching evidence markers.

It covers these 18 requirements:

- Model connection success/failure.
- Proxy and IP outlet tests.
- Agent permission interception.
- CLI Profile execution.
- MCP tool invocation, guarded MCP server runtime lifecycle, local stdio JSON-RPC execution, and remote HTTP MCP JSON-RPC execution.
- Skills install and enable flows.
- Agent employee runtime loop.
- Agent output artifact validation.
- Multi-Agent parallel execution boundaries.
- Resource lock conflicts.
- Configured Android ADB runtime discovery through `AGENTHUB_ADB_PATH` and `AGENTHUB_ADB_ARGS_PREFIX_JSON`.
- Browser session isolation.
- File write isolation.
- Memory write and retrieval.
- Learning result review.
- Software command recording and replay.
- Canvas node status updates.
- Human approval pause/resume.
- Failure recovery and retry.

The report returns `ready` only when all required evidence files exist and every marker is present. It is intentionally marker-based so future refactors that remove a tested capability show up as a coverage gap.
