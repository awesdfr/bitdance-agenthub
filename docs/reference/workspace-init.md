# Workspace Initialization

Workspace initialization prepares the environment an Agent needs before it starts work. In v1 this is represented as a safe, auditable plan; external commands such as `git clone`, dependency installation, migrations, tests, lint, and build checks are recorded as pending actions that require the runtime approval path.

## Sources

| Source | Required fields | Behavior |
| --- | --- | --- |
| `git` | `url`, optional `branch`, optional `depth` | Records a network and CLI gated fetch step. |
| `local` | `path` | Records a read-only local path validation step. |
| `template` | `templateId` | Applies a registered workspace template. |
| `empty` | `structure` | Creates an empty `node`, `python`, `go`, or `custom` structure. |

## Setup Plan

| Field | Meaning |
| --- | --- |
| `installDeps` | Queue dependency installation such as npm/pip/go commands. |
| `runMigrations` | Queue database or project migration commands. |
| `seedData` | Queue a seed script name or command reference. |
| `linkSharedModules` | Link team/shared modules inside the workspace. |

## Verification Plan

| Field | Meaning |
| --- | --- |
| `runTests` | Queue project tests. |
| `checkTypes` | Queue TypeScript or language-specific type checks. |
| `lintCheck` | Queue lint/static analysis. |
| `buildCheck` | Queue build verification. |

## Failure Policies

| Policy | Result |
| --- | --- |
| `abort` | Mark the init run as failed and abort the Agent run. |
| `retry` | Keep the init run planned so setup can be retried. |
| `skip_and_warn` | Continue with warning status. |
| `ask_user` | Pause as `awaiting_user` for explicit user guidance. |
