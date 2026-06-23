# Context Window Visualizer

Section 194 implements a persisted view of what an Agent can currently see before a model call.

## Records

`context_window_visualizations` stores:

- Agent/run/snapshot references.
- Token capacity, estimated tokens, used tokens, remaining tokens, overflow tokens, and used percentage.
- Segment bars for system instructions, plans, memories, tools, inputs, policies, and other context.
- Breakdown by content type.
- Breakdown by importance: critical, important, supporting.
- Optimization suggestions and estimated token savings.

The visualizer reuses `previewAgentContextPack` so packing order and truncation behavior stay consistent with runtime context assembly.

## APIs

- `POST /api/context-window-visualizations`
- `GET /api/context-window-visualizations`
- `POST /api/context-window-visualizations/:id/actions`

Supported action previews:

- `compress_plan`
- `remove_old_steps`
- `expand_window`
- `compress_memory`
- `trim_tools`

Action previews are deterministic planning records. They do not mutate prompts, memories, or model settings by themselves.
