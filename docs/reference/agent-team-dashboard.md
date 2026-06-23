# Agent Team Dashboard

Section 196 implements a realtime-style team dashboard snapshot for multiple Agents.

## Tables

`agent_team_dashboard_snapshots` stores:

- Visible Agent cards with current run, phase, step, status, approval count, screen-session ids, and help/takeover affordances.
- Shared blackboard summaries.
- Team counts: active runs, waiting approvals, blocked cards, failed cards.
- Export manifest metadata.

`agent_team_dashboard_commands` stores audited control actions:

- `pause_all`
- `resume_all`
- `emergency_stop`
- `export_report`

The command path uses existing employee-run pause/resume/cancel functions where possible and records skipped run ids when a run cannot accept that command.

## APIs

- `POST /api/agent-team-dashboard-snapshots`
- `GET /api/agent-team-dashboard-snapshots`
- `POST /api/agent-team-dashboard-snapshots/:id/commands`
- `GET /api/agent-team-dashboard-commands`

This is a local control-plane snapshot, not OS-level desktop control.
