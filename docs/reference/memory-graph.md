# Memory Graph

Section 195 implements a persisted memory graph view for exploring project, customer, error, preference, technology, solution, Agent, and memory relationships.

## Table

`memory_graph_views` stores generated graph views:

- `nodes`: memory/entity/Agent nodes.
- `edges`: relationship edges such as `prefers`, `belongs_to`, `depends_on`, `has_error`, `solves`, `similar_to`, `used_in`, and `learned_by`.
- `nodeCount` and `edgeCount`.
- `layout`: `force` or `hierarchical`.
- `includeExpired`: whether expired memories appear.
- `exportManifest`: manifest-only export metadata.

Node size is derived from memory `importance`. Edge width is derived from memory `confidence`.

## APIs

- `POST /api/memory-graph-views`
- `GET /api/memory-graph-views`
- `POST /api/memory-graph-views/:id/export`

The v1 graph builder is deterministic and local. It extracts named entities from memory titles/content and creates similarity edges from lexical overlap. It does not call external graph databases or model APIs.
