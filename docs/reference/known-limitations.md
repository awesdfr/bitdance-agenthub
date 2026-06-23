# Known Limitations Disclosure

Section 112 requires the product and documentation to state v1 limitations honestly instead of hiding them behind optimistic copy.

The implementation stores those disclosures in `known_limitations` and records user acknowledgements in `limitation_acknowledgements`.

## Default v1 Limitations

The seed set covers the ten limitations named in the plan:

- Desktop automation is Windows-only in v1.
- Local v1 should not exceed 10 concurrent Agents.
- Mobile phone operation is not available in v1.
- Native file pickers, print dialogs, color dialogs, and privileged OS dialogs require alternatives.
- CAPTCHA, Cloudflare, hCaptcha, reCAPTCHA, and bot challenges require user completion.
- Some enterprise networks need manual proxy/certificate setup.
- Ollama and local model speed/quality depend on hardware.
- Single tasks longer than 24 hours are not fully validated.
- Cluster and multi-machine collaboration are not v1 features.
- Realtime voice interaction is not supported in v1.

Each limitation includes:

- category
- severity
- user-facing title and description
- concrete user impact
- workaround
- roadmap note
- capability tags for preflight matching
- disclosure surfaces
- acknowledgement requirement
- evidence references

## Product Behavior

`POST /api/known-limitations/seed` installs the default disclosure set.

`GET /api/known-limitations` lists active disclosures and can filter by category, severity, status, and product surface.

`POST /api/known-limitations/evaluate` accepts requested capability tags, such as `mobile`, `captcha`, `cluster`, or `native_dialog`, and returns the matching limitations, severity summary, acknowledgement count, and recommended alternatives.

`POST /api/known-limitations/:id/acknowledge` records that a user saw and accepted a limitation in a specific surface, such as onboarding, Agent Factory, run preflight, approval, or settings.

`GET /api/known-limitations/acknowledgements` lists acknowledgement records for auditing and support.

## Intended Use

The limitation evaluator should be used before enabling capabilities that might exceed v1 guarantees:

- creating an Agent with desktop or mobile operation
- running many Agents in parallel
- using browser automation on sites with bot challenges
- configuring enterprise proxies
- selecting local models for demanding work
- launching long-running tasks
- attempting multi-machine orchestration
- enabling voice workflows

The system should prefer an explicit, helpful warning with a workaround over silently failing later.
