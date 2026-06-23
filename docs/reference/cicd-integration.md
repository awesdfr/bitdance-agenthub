# CI/CD Integration

Section 197 implements local CI/CD integration records for Agent-assisted development pipelines.

## Tables

`cicd_integrations` stores:

- Platform: `github_actions`, `gitlab_ci`, `jenkins`, `circleci`, `azure_devops`.
- Mode: `cli`, `action`, `api`, `webhook`.
- Agent name/profile binding.
- Task, max budget, fail-on condition, output behavior, PR comment behavior, auto-fix behavior.
- Exit-code mapping.
- Generated workflow/template text.

`cicd_runs` stores trigger records:

- Trigger mode, ref, commit, pull request number.
- Optional employee run id.
- Agent conclusion and mapped exit code.
- Artifact manifest, planned PR comment, and auto-fix plan.

## APIs

- `POST /api/cicd/integrations`
- `GET /api/cicd/integrations`
- `POST /api/cicd/integrations/:id/trigger`
- `GET /api/cicd/runs`

The v1 implementation does not call external CI providers. It provides the local control-plane contract, generated workflow snippets, and deterministic run/result mapping.
