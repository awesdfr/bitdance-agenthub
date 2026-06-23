# Memory Decay Visualization

Section 107 is implemented as a persisted knowledge-decay view for the Memory Center.

## Data Model

`memory_decay_snapshots` stores a generated visualization state:

- Agent filter and memory filters.
- Horizon, stale-after, expiring-soon, and pinned-importance thresholds.
- `points` with normalized x/y coordinates, memory title, type, scope, importance, age, days since update, expiry days, status, marker, line style, detail text, and suggested actions.
- `summary` counts for pinned, fresh, decaying, expiring soon, expired, and cleanup candidates.
- `actionResult` for the latest pin/update/delete request.

## Status Rules

- `pinned`: importance is at or above the pinned threshold and the memory has no expiry.
- `fresh`: memory is not stale and not expiring.
- `decaying`: memory is stale or has a future expiry outside the expiring-soon window.
- `expiring_soon`: memory expires within the configured expiring-soon window.
- `expired`: memory expiry time has passed.

## Visualization Contract

- X axis: days since the memory was updated.
- Y axis: memory importance.
- Solid line: pinned memory.
- Dashed line: decaying memory.
- Square marker: memory that is expiring soon or already expired.
- Red/yellow/green/gray roles: core, important, temporary, expiring, expired.

## API

- `POST /api/memory-decay-snapshots` creates a snapshot.
- `GET /api/memory-decay-snapshots` lists snapshots.
- `GET /api/memory-decay-snapshots/:id` reads one snapshot.
- `POST /api/memory-decay-snapshots/:id/actions` applies `pin`, `update_content`, or `delete_now`.

`delete_now` requires `confirm: true`; otherwise the API records a planned action only.
