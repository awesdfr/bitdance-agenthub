# Model Invocation Optimization

Section 99 adds model-call optimization controls for response caching,
task-type parameters, and Agent warmup. This implementation is record-only:
it does not make live model requests or hold real HTTP/2 connections.

## Response Cache

The default policy uses:

- strategy: `exact`
- exact TTL: `60` seconds
- semantic TTL: `300` seconds
- semantic similarity threshold: `0.97`
- no-cache task types:
  - `task_planning`
  - `creative_generation`
  - `safety_critical`

Cache events can be `hit`, `miss`, `miss_stored`, or `bypassed`. Hits update
policy statistics for hits and saved cost. Misses update miss statistics and
can store caller-supplied outputs for later reuse.

## Task Parameters

Default model parameters follow the plan:

| Task type | Temperature | top_p |
| --- | ---: | ---: |
| `code_generation` | 0.1 | 0.95 |
| `creative_writing` | 0.9 | 0.98 |
| `analysis` | 0.3 | 0.9 |
| `planning` | 0.5 | 0.95 |
| `tool_selection` | 0.0 | 1.0 |
| `summarization` | 0.2 | 0.9 |

Policies can also define Agent-specific overrides.

## Agent Warmup

Warmup sessions store:

- the lightweight warmup request
- visible status text
- planned connection-cache behavior
- record-only HTTP/2 keep-alive intent
- completion result and latency

## API

- `POST /api/model-optimization/policies/seed`
- `GET /api/model-optimization/policies`
- `POST /api/model-optimization/policies`
- `POST /api/model-optimization/cache/evaluate`
- `GET /api/model-optimization/cache-entries`
- `POST /api/model-optimization/parameters/resolve`
- `POST /api/model-optimization/warmups`
- `GET /api/model-optimization/warmups`
- `POST /api/model-optimization/warmups/:id/complete`
- `GET /api/model-optimization/events`

## Safety

The module never calls a provider by itself. It only records cache decisions,
parameter resolution, and warmup plans so the runtime can apply them later.
