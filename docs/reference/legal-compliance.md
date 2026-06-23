# Legal Compliance

Section 117 is implemented as local compliance metadata, disclaimers, and license-check records. This is not legal advice; it gives the product auditable control-plane records for user-facing compliance workflows.

## Compliance Matrix

`legal_compliance_frameworks` stores a regulations JSON matrix:

- `gdpr`: DPA flag, right to access, right to be forgotten, data residency
- `ccpa`: opt out of sale and data disclosure flags
- `hipaa`: whether medical-data handling applies
- `pipl`: data-localization and consent flags

The default framework is local-first and uses `local_only` data residency.

## Disclaimer Notices

`legal_disclaimer_notices` stores the four required notice placements:

- `installation`: AI Agents can operate the computer; grant least privilege, back up files, and understand high-risk approvals
- `agent_creation`: creating an Agent with file/browser/command abilities should start in probation mode
- `approval_footer`: approving means the Agent will perform the actual operation
- `artifact_output`: AI-generated artifacts must be verified before use

## License Compliance

`license_compliance_checks` stores deterministic license detections for reused code:

- `MIT`: preserve copyright and license text, low risk
- `Apache-2.0`: preserve notices, include license, state significant changes, low risk
- `BSD`: preserve notices and avoid endorsement misuse, medium risk
- `GPL-3.0`: source and copyleft obligations, high risk
- `unknown`: review before reuse, critical risk

Each check stores obligations, restrictions, risk level, and attribution text.

## API

- `POST /api/legal-compliance/seed`
- `GET /api/legal-compliance/frameworks`
- `POST /api/legal-compliance/frameworks`
- `GET /api/legal-compliance/disclaimers`
- `POST /api/legal-compliance/disclaimers`
- `GET /api/legal-compliance/license-checks`
- `POST /api/legal-compliance/license-checks`
