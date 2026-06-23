# Team Collaboration Control Plane

Section 37 is implemented as a team-aware permission and approval layer for the Agent employee system.

## Persistent Entities

- `team_users`: system users with `admin`, `operator`, `viewer`, or `custom` roles, optional permission overrides, scope, and status.
- `teams`: collaborative work groups that own shared Agent resources.
- `team_memberships`: per-team roles and permission overrides for users.
- `team_resource_shares`: shared Agent templates, workflows, skills, model profiles, and memories. Model profiles default to `user_isolated` secret handling.
- `team_approval_policies`: approval routing rules for `specific_user`, `any_approver`, `all_must_approve`, and `one_of_many`.
- `team_approval_decisions`: auditable approval/rejection records.

## Permission Model

The permission evaluator combines:

- System role defaults.
- User-level permission overrides.
- Team membership role defaults.
- Team membership permission overrides.
- Scope checks for `global` and project-specific scopes such as `project:alpha`.

Documented permissions include:

- `agent:create`, `agent:edit`, `agent:delete`, `agent:run`
- `workflow:create`, `workflow:run`
- `model:manage`
- `skill:install`
- `memory:view`, `memory:edit`, `memory:delete`
- `approval:decide`
- `billing:view`
- `system:settings`
- `audit:view`

Custom permission keys are allowed through the same override map.

## Approval Routing

Approval policies support:

- `specific_user`: exactly one named approver must approve.
- `any_approver`: any active user with the required permission can approve.
- `all_must_approve`: every named approver must approve; any rejection rejects the policy.
- `one_of_many`: any named approver can approve; all named approvers rejecting rejects the policy.

Every approval decision checks `requiredPermission`, writes a `team_approval_decisions` row, and records an audit log.

## API Surface

- `GET/POST /api/team-users`
- `GET/POST /api/teams`
- `GET/POST /api/teams/:id/members`
- `POST /api/team-permissions/evaluate`
- `GET/POST /api/team-resource-shares`
- `GET/POST /api/team-approval-policies`
- `GET/POST /api/team-approval-policies/:id/decisions`
- `GET/POST /api/team-approval-policies/:id/evaluate`

The matching typed frontend helpers live in `src/lib/api.ts`.

## Safety Boundaries

- This layer stores permission and approval metadata only.
- It does not mutate live customer accounts, secrets, billing systems, or external identity providers.
- Shared model profiles keep key material isolated by user unless explicitly represented by a non-secret shared reference.
