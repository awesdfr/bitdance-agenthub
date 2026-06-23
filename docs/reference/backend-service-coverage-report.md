# Backend Service Coverage Report

Section 19 requires the system to expose explicit backend services for the Agent
employee control plane, runtime, tools, memory, workflow, computer operation, and
verification layers. The coverage report turns that architecture requirement into
a machine-checkable contract.

## API

`GET /api/backend-services/coverage-report`

Returns `{ report }`, where `report` contains:

- `requiredServices`: the 17 services named by the plan.
- `coveredServices`, `weakServices`, and `missingServices`.
- `dedicatedServices` and `compositeServices`.
- `criticalServices` and `coveredCriticalServices`.
- Per-service file checks, expected exports, found exports, API evidence, gaps,
  and recommendations.

## Service Set

The report verifies these Section 19 services:

- `ModelProfileService`
- `NetworkProfileService`
- `AgentProfileService`
- `AgentEmployeeRuntime`
- `AgentMemoryService`
- `LearningService`
- `CanvasWorkflowService`
- `WorkflowRunner`
- `ToolConnectionService`
- `McpService`
- `CliRunner`
- `SoftwareAdapterService`
- `ComputerSessionManager`
- `ResourceLockService`
- `ArtifactService`
- `VerificationService`
- `ApprovalService`

The critical services are `AgentEmployeeRuntime`, `AgentMemoryService`,
`SoftwareAdapterService`, `ComputerSessionManager`, and `ResourceLockService`.

## Implementation Notes

Some plan services map to a single dedicated module, such as
`src/server/employee-runtime-service.ts` for `AgentEmployeeRuntime`. Others are
composite services because the repository already groups related CRUD, runtime,
and report responsibilities together. For example, `ModelProfileService` is
covered by `src/server/control-plane-service.ts` and
`src/server/model-gateway-service.ts`.

The report is intentionally side-effect free. It only reads source files and
checks expected exports, so it can run in tests, API smoke checks, and governance
screens without starting live models, MCP servers, browser sessions, or desktop
automation.
