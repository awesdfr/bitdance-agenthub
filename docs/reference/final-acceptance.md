# Final Acceptance Test Service

Section 210 is implemented as a persisted acceptance-test harness for the v1 release checklist.

## What It Records

- 10 release scenarios from first user experience through emergency stop.
- The expected result for each scenario.
- Automated evidence for required tables, services, and API routes.
- Manual QA gaps for actions that should not be automated against the user's real machine, such as packaged installer timing, forced process kill, actual network disconnect, and interrupted real file writes.
- A stored `acceptance_scenario_runs` row for every scenario run.

## API

- `GET /api/acceptance-criteria`
- `POST /api/acceptance-criteria/run`
- `GET /api/acceptance-scenario-runs`

`POST /api/acceptance-criteria/run` accepts:

```json
{
  "scenarioKeys": ["first_experience", "emergency_stop"]
}
```

Omit `scenarioKeys` to run all 10 scenarios.

## Statuses

- `passed`: all required control-plane evidence exists and no manual release gap is attached.
- `warning`: required evidence exists, but the scenario still needs manual release QA.
- `failed`: a required table, service, or route is missing.
- `manual_required`: reserved for future scenarios that cannot be evaluated automatically at all.

The suite summary exposes:

- `automatedBaselineReady`: true when no scenario failed.
- `releaseReadyWithoutManualQA`: true only when there are no failures, warnings, or manual-required scenarios.

## Scenario Coverage

1. First experience: onboarding, Agent creation, first run, artifact validation.
2. Parallel Agents: task queues, concurrency profile, resource locks, browser/computer isolation.
3. Crash recovery: checkpoints, recovery events, idempotency, continuation plans.
4. Canvas workflow: workflow graph, node runs, run events.
5. Approval flow: approval requests, notifications, audit logs.
6. Budget control: budget events, runtime stop behavior, recovery summary.
7. Memory learning: memory items, learning events, reflections, playbooks.
8. Security boundary: sandbox policies, audit logs, findings, credential scopes.
9. Offline degradation: degradation policies/events, model/network route decisions.
10. Emergency stop: user overrides, dashboard emergency-stop command, cancellation, locks, recovery evidence.
