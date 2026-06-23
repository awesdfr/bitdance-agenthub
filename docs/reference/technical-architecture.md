# Technical Architecture Contract

Section 46 is implemented as a verifiable architecture contract instead of a passive note.

The current v1 stack is:

- Desktop shell: Electron + Node.js.
- Frontend: Next.js, React, TypeScript, Zustand, TailwindCSS.
- Canvas: custom React/SVG Agent Workflow Canvas.
- Editor: CodeMirror 6.
- Backend: Next.js route handlers, local services, and SQLite WAL via better-sqlite3 + Drizzle.
- Runtime managers: AgentEmployeeRuntime, WorkflowRunner, ComputerSessionManager, CliRunner, SchedulerService, and RunEventFeed.
- Events: in-process EventEmitter plus persisted employee run events and stream protocol records.
- Secrets: node:crypto AES-256-GCM vault values plus credential scopes and audit logs.
- Browser/computer operation: BrowserSession and ComputerSession records behind manager services.

API:

- `GET /api/technical-architecture/manifest`
- `POST /api/technical-architecture/evaluate`
- `GET /api/technical-architecture/evaluations`

The evaluator records a `technical_architecture_evaluations` row with:

- `manifest`: the selected stack, process architecture, supplemental table mapping, and data flow.
- `checks`: pass/warning/fail checks across stack, process, database, and data flow.
- `summary`: total checks, passed checks, warnings, failures, required failures, and overall status.

Warnings are allowed for implementation choices that differ from the recommendation but still satisfy the v1 contract. For example, the plan recommends React Flow/xyflow and Monaco, while the repository currently uses a custom workflow canvas and CodeMirror. That is recorded as a warning, not a runtime failure.
