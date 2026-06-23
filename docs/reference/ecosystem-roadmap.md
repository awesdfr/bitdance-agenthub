# Ecosystem Roadmap

Section 115 is implemented as a local ecosystem roadmap control plane. It records what the product must prepare before opening templates, Skills, plugins, SDKs, community channels, and enterprise/platform offerings.

## Phases

| Phase | Stage | Required outcomes |
| --- | --- | --- |
| Phase 1 Internal Beta | `internal_beta` | 20 Agent templates, 10 Workflow templates, 50 Skills |
| Phase 2 Open Community | `open` | User-shared Agent/Workflow templates, ratings, rankings, official curation |
| Phase 3 Ecosystem | `ecosystem` | Plugin marketplace, Developer SDK, developer docs/tutorials, third-party revenue share, forum/Discord-style channels |
| Phase 4 Platform | `platform` | Enterprise edition, SLA, SSO, audit compliance, cloud-hosted option, training/certification, finance/healthcare/legal solutions |

## Data Model

The `ecosystem_roadmap_phases` table stores:

- `phaseNumber`, `phaseKey`, `stage`, and `title`
- `initiatives` for the concrete checklist items
- `requiredAssets` for counts and dependencies
- `communityChannels` for marketplace, forum, docs, training, and partner channels
- `revenueModel` for ecosystem/platform monetization notes
- `enterpriseReadiness` for SLA, SSO, audit, and vertical-solution readiness

## API

- `POST /api/ecosystem-roadmap/seed`
- `GET /api/ecosystem-roadmap/phases`
- `GET /api/ecosystem-roadmap/phases?stage=ecosystem`
- `GET /api/ecosystem-roadmap/phases?status=planned`
- `POST /api/ecosystem-roadmap/phases`

The v1 implementation records and audits ecosystem intent locally. It does not create external forums, Discord servers, cloud hosting, billing, certification delivery, or third-party payouts.
