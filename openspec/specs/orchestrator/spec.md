# Orchestrator

## Purpose

Defines the special agent workflow for planning, dispatching, and aggregating multi-agent tasks. Detailed flow lives in `specs/06-orchestrator-flow.md`.

## Requirements

### Requirement: Orchestrator SHALL be a normal Agent

The orchestrator MUST run through AgentRunner and an adapter like any other agent; it SHALL not have a separate service path.

#### Scenario: User starts a group task
- **WHEN** the conversation includes an orchestrator
- **THEN** AgentRunner executes it as an agent run
- **AND** uses orchestrator-specific prompts and tools.

### Requirement: Orchestrator SHALL plan before dispatch

The orchestration flow MUST produce a compiled and validated task plan before launching child agent runs.

#### Scenario: Plan tool is called
- **WHEN** the orchestrator calls `plan_tasks`
- **THEN** AgentRunner parses, compiles, and validates task ids, agent ids, dependencies, and acyclicity.

#### Scenario: Plan text implies missing dependencies
- **WHEN** task text references earlier task outputs but `dependsOn` omits them
- **THEN** AgentRunner adds high-confidence inferred dependencies before dispatch
- **AND** publishes and executes the compiled plan.

### Requirement: Child tasks SHALL respect dependency order

AgentRunner MUST execute dispatch tasks as a DAG and skip dependent tasks when prerequisites fail or required artifacts are not produced.

#### Scenario: Upstream task fails
- **WHEN** a task dependency ends with status `failed`
- **THEN** dependent tasks are skipped
- **AND** dispatch events include the blocking reason.

#### Scenario: Upstream task produces no required artifact
- **WHEN** a child task appears to require artifact output
- **AND** the run completes without artifact ids
- **THEN** the task result is treated as `failed`
- **AND** dependent tasks are skipped.

### Requirement: Child task context SHALL include transitive upstream artifacts

AgentRunner MUST include artifact summaries from the full dependency closure in child prompts.

#### Scenario: Downstream review depends on implementation
- **WHEN** review task `t4` depends on `t3`, and `t3` depends on `t1` and `t2`
- **THEN** the review prompt includes artifact summaries from `t1`, `t2`, and `t3`.

### Requirement: Aggregation SHALL summarize child outputs

After child tasks finish, the orchestrator MUST run an aggregate stage that sees task results and produces the final response.

#### Scenario: All child tasks complete
- **WHEN** the DAG has no remaining runnable tasks
- **THEN** AgentRunner builds an aggregate prompt
- **AND** runs the orchestrator without `plan_tasks`.
