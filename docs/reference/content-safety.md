# Content Safety And Copyright Review

Section 120 is implemented as a local-first output governance layer for Agent artifacts.

## Content Safety

Content safety policies persist in `content_safety_policies`.

Each policy stores:

- L1 local keyword and regex filters for blocked patterns and PII patterns.
- L2 local lightweight classifier categories: `safe`, `hate`, `adult`, `violence`, `spam`, `self_harm`, plus internal `pii`, `blocked_pattern`, and `cloud_review` findings.
- L3 optional cloud safety API metadata with `requiresUserConsent: true`.
- A deterministic `onFlag` action: `block`, `warn`, `redact`, `quarantine`, or `ask_user`.

Scanning writes `content_safety_scans` with:

- content hash and short preview, not full content storage;
- matched categories and findings;
- whether cloud review would require consent;
- final decision and status.

The v1 implementation does not send content to any external moderation API. If a cloud safety API is configured and user consent is missing, the scan records `cloudReviewRequired` and returns a user-gated decision.

## Copyright Review

Copyright checks persist in `copyright_checks`.

For code outputs, checks compare Agent output with provided known source snippets using the configured similarity threshold and minimum match length. On match, the policy can warn with attribution, block, or ask the user.

For image outputs, checks inspect metadata for copyright/license signals and record whether reverse image search would require an external API. Reverse image search is record-only in v1.

## API Surface

- `POST /api/content-safety/policies/seed`
- `GET /api/content-safety/policies`
- `POST /api/content-safety/policies`
- `POST /api/content-safety/scan`
- `GET /api/content-safety/scans`
- `POST /api/content-safety/copyright-checks`
- `GET /api/content-safety/copyright-checks`

## Runtime Use

Agent runtimes should call content safety scanning before publishing user-visible artifacts, sending messages, or passing an artifact into another Agent. Copyright checks should run before code/document/image artifacts are marked final.

The result is auditable and composable with artifact validation, approvals, and workflow node status.
