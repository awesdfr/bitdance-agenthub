# Product Effects Coverage Report

Section 24 is tracked by `src/server/product-effects-coverage-report-service.ts` and exposed through:

```txt
GET /api/product-effects/coverage-report
```

The report turns the promised product outcomes into auditable evidence. It separates effects into:

- `available`: usable in the v1 local control plane.
- `guarded`: implemented through safe records, approvals, timelines, dry-runs, or resource locks.
- `reserved`: architecture foundation exists, but full live capability is a future milestone. The guarded local baseline currently expects no promised product effect to remain purely reserved.
- `missing`: required evidence is absent.

It covers the Agent employee factory, per-Agent independence, employee runtime loop, memory and learning, CLI orchestration, guarded computer/browser operation, Canvas team workflows, progress visibility, verifiable artifacts, multi-Agent parallel boundaries, workstation/resource-lock safety, software CLI-ization, and the local AI employee operating-system foundation.

This report intentionally does not claim that the product performs unrestricted human-level desktop automation, ungated live mobile control, payments/account actions, destructive file operations, or automatic cloud VM provisioning. Desktop, ADB-backed mobile, and VM/RDP/VNC workstation Runtime Control adapters are present, but they remain guarded by an emergency kill switch, environment gates, approvals, resource locks, target allowlists, audit logs, and customer go-live evidence; live parallel workstation proof still requires authorized customer infrastructure.
