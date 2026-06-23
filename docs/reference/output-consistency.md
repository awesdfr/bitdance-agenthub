# Agent Output Consistency

Section 93 records output-language and code-style checks before artifacts move between Agents.

## Default Policy

- Output language: `zh-CN`
- Code comments: English
- Mixed-language detection: enabled
- Language consistency enforcement: enabled
- Code formatters:
  - `.ts`, `.tsx`, `.js`, `.jsx`, `.css`, `.md`: Prettier
  - `.py`: Black
  - `.go`: gofmt
- Formatter failures: warning by default

## Evaluated Risks

- Wrong output language
- Mixed language in the same artifact
- Non-English code comments
- Missing formatter configuration
- Formatter missing or failed

## APIs

- `POST /api/output-consistency/policies/seed`
- `GET /api/output-consistency/policies?status=active`
- `POST /api/output-consistency/evaluate`
- `GET /api/output-consistency/evaluations?status=warning`

## Safety Boundary

This service does not rewrite artifacts or run formatters directly. It records deterministic output-control decisions so runtime or artifact services can apply them with normal approval and verification checks.
