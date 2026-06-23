# Human Collaboration

Section 32 adds a control-plane layer for richer human-Agent collaboration.

## Approval Policies

Human approval policies support:

- timeout handling: auto reject, auto approve, keep waiting, or escalate to admin
- batching: max batch size, max wait time, and similar-request merging
- conditional auto-approval with per-run caps
- escalation chains across user, admin, project owner, and external approver

Policy evaluation is deterministic and record-only. It returns a recommendation, not an
unbounded autonomous action.

## Plan-Level Approval

Users can approve a multi-step Agent plan step by step:

- approve a step
- reject a step
- modify a step
- skip a step

The result stores all step decisions and computes the overall decision. If linked to a
pending approval request, the approval request is resolved with the plan result payload.

## Takeover Sessions

Takeover sessions record when a user temporarily takes control of a resource such as a
browser, desktop, CLI, or file editor. The session stores:

- run id
- Agent id
- step id
- resource
- user actions
- observation before and after handoff
- active/completed/cancelled status

This enables future learning and audit without directly starting OS-level automation.
