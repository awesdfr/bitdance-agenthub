# Agent Profile Capability Report

Section 1-3 treats an Agent as an employee profile rather than a prompt-only record.
The capability report is the read-only contract that explains what a configured Agent can do before it is assigned to a workflow node or runtime task.

## API

`GET /api/agent-profiles/:id/capability-report`

The response includes:

- `readiness`: `ready`, `needs_configuration`, `draft_only`, or `archived`.
- `readinessScore`: a deterministic 0-100 score derived from declared capabilities, gaps, and warnings.
- `primaryModel` and `fallbackModels`: resolved Model Profiles with capability metadata.
- `skills`, `mcpServers`, `cliProfiles`, `softwareProfiles`, `softwareCommands`: resolved employee abilities.
- `declaredCapabilities`: boolean matrix for model, Skills, MCP, CLI, software, memory, autonomy, workstation, permissions, contracts, persona, behavior rules, and success criteria.
- `permissionMatrix`: normalized action permissions such as file read/write, command execution, network, browser, desktop, and mobile.
- `contractSummary`: input keys, output keys, artifact type, required files, and validation rules.
- `missingReferences`: unresolved profile IDs.
- `gaps`, `warnings`, `recommendations`: actionable configuration feedback.
- `employeeRunbook`: safe runtime checklist generated from the profile.

## Runtime Use

The report is intentionally side-effect free. It does not call a model, start MCP servers, run CLI commands, launch software, or touch the desktop.
Canvas, workflow preflight, onboarding, and Agent Factory screens can use it to explain whether an Agent is ready for a task and what must be configured next.

## Readiness Rules

- `archived`: the Agent is archived.
- `draft_only`: the Agent is still draft, even if most configuration is present.
- `needs_configuration`: the Agent is active but has blocking gaps such as no primary model, no output contract, missing referenced capability IDs, or mismatched permissions.
- `ready`: the Agent is active, has a resolvable model, output contract, success criteria, permission policy, workstation policy, and no blocking capability gaps.
