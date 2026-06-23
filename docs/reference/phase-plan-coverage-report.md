# Phase Plan Coverage Report

Section 22 is tracked by `src/server/phase-plan-coverage-report-service.ts` and exposed through:

```txt
GET /api/phase-plan/coverage-report
```

The report verifies the seven documented implementation phases:

1. Control plane foundation
2. Agent employee runtime
3. Canvas orchestration
4. Memory and learning
5. Computer and browser operation
6. Software CLI-ization
7. Virtual workstations

Phases 1-7 are expected to be `baseline_ready` in the local guarded baseline. They point at concrete services, UI surfaces, API helpers, tests, and runtime adapters that already exist in the repo.

Phase 7 is implemented as a guarded workstation integration baseline. The system supports `virtual_desktop`, `vm`, and `remote_session` workstation records, validates readiness, builds RDP/VNC/browser/Hyper-V/VirtualBox/VMware launch plans, applies workstation target allowlists, launches configured remote targets, marks launched workstations busy, releases them back to idle, and exposes stale busy lease recovery. It still does not claim automatic cloud VM provisioning; customer-provided VM/RDP/VNC infrastructure and authorization are required for live production proof.

The report returns:

- `requiredPhases`: total required phase count.
- `coveredPhases`: phases with either baseline implementation evidence or an explicit reservation.
- `baselineReadyPhases`: v1-ready phases.
- `reservedPhases`: future phases with schema and architecture hooks. The guarded baseline currently expects this to be `0`.
- `missingPhases`: phases missing required files or markers.
- `items`: per-phase evidence, gaps, and warnings.
