# Memory Integrity Guard

Section 108 protects long-term memory from context pollution and memory poisoning.

## Persisted Records

- `memory_integrity_policies`: source confidence map, dangerous pattern rules, action on dangerous content, and periodic scan settings.
- `memory_integrity_evaluations`: before-write and scan decisions with matched patterns, confidence applied, contradictions, input preview, and recommended action.

## Default Source Confidence

| Source | Confidence |
| --- | ---: |
| `agent_direct_observation` | 0.90 |
| `user_explicit_instruction` | 0.95 |
| `external_web_content` | 0.40 |
| `inferred_from_task` | 0.60 |
| `other_agent_shared` | 0.70 |
| `external_file` | 0.50 |

External web content, uploaded files, inferred task lessons, and peer-shared memories therefore enter the system with lower confidence unless reviewed or corroborated.

## Dangerous Patterns

The seeded policy detects content that tries to teach the Agent unsafe procedures:

- hardcode password, API key, or secret
- ignore SSL verification
- disable security
- commit secrets
- bypass authentication

The default action is `block_and_alert`, so the memory write is recorded as blocked and marked for review.

## Periodic Scan

`POST /api/memory-integrity/scan` scans recent memories for:

- low-confidence knowledge
- dangerous patterns
- contradictions against high-confidence trusted memories

The scan is record-only. It does not delete or rewrite memories automatically.

## API

- `POST /api/memory-integrity/policies/seed`
- `GET /api/memory-integrity/policies`
- `POST /api/memory-integrity/policies`
- `POST /api/memory-integrity/evaluate`
- `POST /api/memory-integrity/scan`
- `GET /api/memory-integrity/evaluations`

The intended runtime flow is: evaluate before write, lower confidence or block when needed, then periodically scan stored memories for poisoning risk.
