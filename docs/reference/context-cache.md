# Context Preload And Smart Cache

Section 188 adds a control-plane primitive for preparing Agent context before a run starts. The system records what should be loaded, which task predictors were selected, and when cached context should be reused, marked stale, or invalidated.

## API Surface

- `POST /api/context-cache/preload` creates a context preload plan.
- `GET /api/context-cache` lists cached preload plans by Agent, project, task type, or status.
- `POST /api/context-cache/resolve` resolves the current cache status by `contextCacheId` or `cacheKey`.

## Task Predictors

- `code`: project structure, dependencies, recent git log.
- `data`: data schema and historical analysis results.
- `doc`: style guides, glossary, and historical documents.
- `general`: relevant memories and recent errors.

## Cached Sections

The preload flags map to stable cached sections:

- `relevant_memories`
- `project_structure`
- `recent_changes`
- `active_guidelines`
- `peer_agent_status`
- `recent_errors`

These sections can be used by the runtime to build a compact working context before the Agent decides its first action.

## Cache Resolution

- A cache starts as `fresh`.
- Passing an `invalidationSignal`, such as `file_change`, marks it `invalidated`.
- If `expiresAt` has passed, it becomes `stale`.
- `projectStructureTTL` defaults to `until_file_change`, while semantic and memory search caches default to 300 and 600 seconds.

The v1 implementation stores the plan and cache metadata in SQLite. It does not read arbitrary project files during planning; future runtime integrations can materialize the listed sections from memory, filesystem, search, peer Agent status, and error streams.
