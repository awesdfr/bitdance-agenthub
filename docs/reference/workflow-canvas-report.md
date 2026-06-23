# Workflow Canvas Report

The Canvas report turns a saved workflow graph into a deterministic, UI-ready orchestration report. It is side-effect free: it does not start Agents, call models, run CLI commands, or operate the desktop.

## API

```http
GET /api/workflows/:id/canvas-report
```

The report answers four questions:

- Which nodes are on the Canvas, and which Agent/profile/tool does each node represent?
- What input mappings and output contracts will be used between nodes?
- What graph shape will the runner see: entry nodes, terminal nodes, parallel groups, dangling edges, and cycles?
- What should the UI show for current/latest run status?

## Readiness

```ts
type WorkflowCanvasReadiness = 'ready' | 'needs_configuration' | 'blocked'
```

`ready` means the graph has no blocking structural gaps and can proceed to workflow preflight.

`needs_configuration` means nodes need more metadata, such as explicit input mappings or active Agents, but the graph shape is still usable.

`blocked` means the workflow has a cycle, dangling edge, missing Agent profile, missing Agent output contract, or another issue that makes execution unsafe or ambiguous.

## Node Report

Each node includes:

- node id, type, known-type flag, and Canvas position
- bound Agent profile summary for `agent_employee` nodes
- input mapping keys
- node-level output contract keys
- resolved output contract from the node first, then the Agent profile
- upstream and downstream node ids
- approval/retry flags
- latest run status/progress/current step when a workflow run exists
- node-level gaps and warnings

Supported documented node types are:

- `agent_employee`
- `human_approval`
- `artifact_transform`
- `condition`
- `parallel`
- `merge`
- `software_command`
- `cli_command`
- `mcp_tool`

Unknown node types are allowed but reported as warnings.

## Graph Report

The report computes:

- entry nodes
- terminal nodes
- valid and dangling edges
- topological order
- parallel groups
- cycle detection
- artifact flow between valid edges

Parallel groups are informational for the Canvas and preflight. The v1 runner may still execute in deterministic order, while preflight and later schedulers can use the groups to reason about resource locks and approvals.

## UI Usage

Agent Canvas should call this report after loading a workflow. It can use:

- `summary.entryNodeIds` and `summary.terminalNodeIds` to style starts and finishes
- `executionPlan.parallelGroups` to show branch lanes
- `nodes[].resolvedOutputContract` to show deterministic artifact output
- `edges[].artifactType` and `artifactFlow` to label data passed between nodes
- `visualization.nodeStatuses` to paint current/latest run state
- `gaps`, `warnings`, and `recommendations` to guide the user before running preflight

Workflow preflight remains the runtime safety gate for cost, risk, resource locks, approvals, and unhealthy tools. The Canvas report is the graph and contract inspection layer before that gate.
