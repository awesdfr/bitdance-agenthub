# Data Maintenance and Storage Optimization

Section 102 adds a local-first maintenance control plane for keeping long-running Agent workspaces healthy without silently deleting user data.

## Persisted Records

- `data_maintenance_policies`: named maintenance policies with log-rotation, SQLite, workspace-GC, and browser-profile settings.
- `data_maintenance_runs`: immutable run records containing the evaluated maintenance results.

## API

- `POST /api/data-maintenance/policies/seed`
- `GET /api/data-maintenance/policies`
- `POST /api/data-maintenance/policies`
- `GET /api/data-maintenance/runs`
- `POST /api/data-maintenance/runs`

## Default Policy

The seeded policy uses conservative defaults:

- Run-event log rotation: `maxEventsPerRun = 500`, `olderThanDays = 90`, `archiveStrategy = summarize`.
- SQLite maintenance: weekly Sunday plan with backup, `integrity_check`, `ANALYZE`, `VACUUM`, and `REINDEX`.
- Workspace garbage collection: clean temp candidates for completed, failed, or aborted runs; remove empty dirs; clear browser residue while preserving artifacts, runtime checkpoints, and Agent long-term work files.
- Browser profiles: clear cache after task, keep cookies, warn over 500MB, and mark profiles inactive for 30 days as archive candidates.

## Safety Model

The v1 service is record-only. It evaluates what should be summarized, deleted, compressed, vacuumed, cleaned, warned, or archived, then stores the plan in `data_maintenance_runs`. The service does not delete user files, cookies, artifacts, checkpoints, or long-term Agent work files during normal evaluation.

This lets the Governance or Ops surface show:

- Which employee runs have too many events.
- Which old events would be summarized.
- Which SQLite operations are scheduled.
- Which completed run temp paths are cleanup candidates.
- Which browser profiles are too large.
- Which browser profiles are inactive enough to archive.

The actual destructive maintenance step remains a future explicit approval workflow.
