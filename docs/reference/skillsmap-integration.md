# SkillsMP CLI/API Integration Report

The SkillsMP integration report verifies the Skills Center control plane: local Skills, install flows, Skill SDK manifests, marketplace publication records, and the built-in SkillsMP CLI/API search surface.

## API

```http
GET /api/skills/skillsmap-report
```

The report is side-effect free. It does not browse SkillsMP, install Skills, publish packages, or make external network calls.

## What It Covers

- configured marketplace URL
- HTTPS and SkillsMap-like host checks
- Skills Center CLI/API search surface and expected panels
- installed/enabled/disabled Skill counts
- install-flow counts by `skillsmp`, `github`, and `local`
- failed install-flow count
- Skill SDK manifest and valid-manifest counts
- marketplace publication and published-package counts
- recent local Skills, install flows, SDK manifests, and publication records
- gaps, warnings, recommendations, and readiness score

## Readiness

```ts
type SkillsMapIntegrationReadiness =
  | 'ready'
  | 'needs_configuration'
  | 'empty'
```

`ready` means the marketplace URL is valid and local Skills/SDK/publication state is available.

`needs_configuration` means the marketplace URL is invalid, non-HTTPS, or install flows have failed.

`empty` means the marketplace URL is usable but the local Skills/SDK state has not been populated yet.

## UI Contract

The Skills Center exposes:

- local installed Skills
- install flow history
- SkillsMP CLI/API search results
- Skill SDK manifests
- marketplace publication history

The live marketplace search flow is:

```txt
Skills Center UI -> /api/skills/skillsmp-cli -> scripts/skillsmp-cli.mjs -> SkillsMP /api/v1/skills/search
```

This avoids the browser iframe restrictions on `skillsmp.com` while keeping SkillsMP discovery inside the application. The CLI reads `SKILLSMP_API_KEY` or `AGENTHUB_SKILLSMP_API_KEY` when authenticated search is needed, and tests can use `SKILLSMP_FIXTURE_PATH` for deterministic results.
