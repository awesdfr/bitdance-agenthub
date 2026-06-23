# Ethical Alignment

Section 116 is implemented as a local ethics and alignment policy layer for Agent task intake.

## Policy

`ethical_alignment_policies` stores:

- `refuseCategories`: operations the Agent should refuse
- `warnCategories`: gray-area operations that should require caution or confirmation
- `onRefuse`: refusal behavior, such as explaining why or asking the user to rephrase
- `userValues`: privacy, security, transparency, and sustainability preferences
- `preTaskAlignment`: task-intake checks and uncertainty behavior

Default refuse categories:

- `generate_misinformation`
- `impersonate_real_person`
- `generate_hate_speech`
- `generate_adult_content`
- `manipulate_or_deceive`
- `invade_privacy`
- `generate_malicious_code`
- `plagiarize`
- `circumvent_security`
- `self_replicate_unsafely`
- `access_unauthorized_systems`

Default warn categories:

- `generate_persuasive_content`
- `scrape_public_data`
- `automate_social_media`
- `generate_opinion_content`
- `analyze_competitor`
- `use_open_source_code`

## Evaluation

`ethical_alignment_evaluations` stores the decision for a proposed task:

- `allowed`: no ethics or alignment risk detected
- `warn`: gray-area category or uncertainty with proceed-with-caution policy
- `refused`: refuse category or uncertainty with refuse policy
- `ask_user`: uncertainty policy requires user clarification

The evaluator records reasons and policy snapshots so the user can inspect why the decision happened.

## API

- `POST /api/ethical-alignment/seed`
- `GET /api/ethical-alignment/policies`
- `POST /api/ethical-alignment/policies`
- `POST /api/ethical-alignment/evaluate`
- `GET /api/ethical-alignment/evaluations`

This layer is deterministic and local. It does not claim legal or moral perfection; it creates auditable decision points before Agent autonomy executes.
