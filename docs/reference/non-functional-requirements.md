# Non-Functional Requirements

Section 111 turns the engineering NFR list into auditable product data.

## Persisted Records

- `nfr_requirements`: reliability, usability, compatibility, security, and maintainability targets.
- `nfr_evaluations`: pass/fail/warning/unknown records for observed runtime or QA metrics.

## Categories

- Reliability: 7x24 no-leak operation, 8-hour single-Agent stability, 1000 model calls with memory growth under 5%.
- Usability: UI response under 200ms, Agent status update under 500ms, actionable errors without normal-mode stack traces.
- Compatibility: Windows 10 21H2+, Windows 11, macOS 13+ core support, 8GB RAM minimum, 2GB disk minimum.
- Security: minimal secret residency, no plaintext secrets in memory/core dumps, regular dependency scans.
- Maintainability: service tests, critical integration tests, no swallowed critical exceptions, module documentation coverage.

## API

- `POST /api/nfr/requirements/seed`
- `GET /api/nfr/requirements`
- `POST /api/nfr/evaluate`
- `GET /api/nfr/evaluations`

`POST /api/nfr/evaluate` accepts an `observed` object keyed by metric path, for example:

```json
{
  "observed": {
    "reliability": { "modelCallMemoryGrowthPercent": 3 },
    "usability": { "uiResponseMsP95": 180 },
    "security": { "memoryDumpPlaintextSecrets": false }
  }
}
```

Missing metrics are recorded as `unknown`, which keeps untested requirements visible instead of silently passing them.
