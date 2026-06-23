# Agent Experiments

Section 105 is implemented as an Agent experimentation layer for clone, compare, and what-if editing flows.

## Data Model

- `agent_clone_records` stores the source Agent, cloned Agent, model-copy policy, Skill copy mode, semantic-memory copy mode, permission-copy policy, copied memory ids, experiment note, and structured modifications.
- `agent_comparison_reports` stores A/B comparison tasks, repeated task results, side-by-side metrics, and a recommendation summary.
- `agent_what_if_analyses` stores a proposed Agent configuration change, estimated impact items, affected workflow ids, and a risk summary.

## API

- `POST /api/agent-profiles/:id/clone` creates a cloned Agent Profile and records the clone operation.
- `GET /api/agent-profiles/:id/clone` lists clone records for a source Agent.
- `POST /api/agent-comparisons` compares two Agents on the same tasks and repetitions.
- `GET /api/agent-comparisons?agentProfileId=...` lists reports touching an Agent.
- `POST /api/agent-what-if` estimates impact before applying Agent configuration changes.
- `GET /api/agent-what-if?agentProfileId=...` lists what-if analyses for an Agent.

## Behavior

- Model config can be copied, removed, or swapped during clone.
- Skills can be reused as shared ids, omitted, or represented as independent snapshot ids.
- Semantic memories are copied when `memoryMode` is `semantic_only`; working memory is not copied.
- Permission config is copied only when requested.
- Compare reports include model, skills, success-rate estimate, average cost/task, and average steps.
- What-if analysis estimates cost, latency, output quality, context-window impact, memory compatibility, and workflow impact.

## Boundaries

The comparison engine is deterministic and does not perform live model calls. It is intended for UI decision support and safe local testing. Real benchmark execution can attach later by replacing or augmenting the stored task results.
