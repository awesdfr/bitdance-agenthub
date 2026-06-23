# Telemetry Policy

Section 97 defines transparent telemetry and usage analytics. The local
implementation is intentionally record-only: it evaluates what would be
collected, stores the sanitized local decision, and does not upload telemetry.

## Defaults

- Telemetry starts at `off`.
- `requiresExplicitConsent` is `true`.
- `defaultOptIn` is `false`.
- `consentGranted` is `false` until the user explicitly enables a level.
- Users can export their sanitized telemetry manifest.

## Levels

- `minimal`: app version, OS, anonymous install id, crash-report flag.
- `usage`: minimal fields plus aggregate counts such as Agents created, tasks
  run, and workflows created.
- `performance`: usage/minimal fields plus aggregate latency and duration
  metrics.
- `full`: allows broader diagnostic payloads after consent, but still runs the
  never-collect redaction pass.
- `off`: records only a disabled local decision.

## Never Collect

The policy always forbids:

- `api_keys`
- `user_files`
- `agent_outputs`
- `memory_content`
- `browser_screenshots`
- `clipboard_data`
- `credentials`

If an event payload includes these categories, the service removes matching
fields or blocks the event when no safe fields remain.

## API

- `POST /api/telemetry/policies/seed`
- `GET /api/telemetry/policies`
- `POST /api/telemetry/policies`
- `POST /api/telemetry/events/evaluate`
- `GET /api/telemetry/events`
- `POST /api/telemetry/export`
- `GET /api/telemetry/exports`

## Safety

This module does not read user files, browser screenshots, memory contents,
clipboard data, API keys, credentials, or Agent outputs. It only accepts caller
supplied event payloads and writes sanitized local records.
