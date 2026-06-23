# Knowledge Graph

Section 40 adds a structured knowledge graph next to vector-style memory search.

## Model

- Nodes live in `knowledge_graph_nodes`.
- Edges live in `knowledge_graph_edges`.
- Nodes support the Section 40 types: `person`, `project`, `software`, `concept`, `file`, `error`, `solution`, and `customer`, while preserving existing capability graph node types.
- Edges support the Section 40 relations: `uses`, `depends_on`, `solves`, `causes`, `belongs_to`, `prefers`, `avoids`, and `alternative_to`, while preserving existing capability graph relations.
- Each node stores a deterministic local embedding generated from label, summary, type, and properties. This is used for stable semantic graph search without requiring external model credentials.
- Each edge stores evidence metadata such as memory ids, run ids, software command ids, and successful software command run ids.

## Build

`POST /api/knowledge-graph`

The rebuild step indexes:

- memory items for customers, projects, people, software, files, errors, solutions, preferences, avoidances, and concepts;
- software profiles and software commands;
- software command run history as success-case evidence.

The rebuild is local-only and does not control real software or call model providers.

## Query

`POST /api/knowledge-graph/query`

Supported scenarios:

- `error_solution`: finds `error -> solves -> solution` paths.
- `customer_preference`: finds `customer -> prefers/avoids -> concept` paths.
- `software_command`: finds software and command relationships, including command success-case evidence.
- `general`: ranked node matches plus directly connected graph paths.

## Examples

```json
{
  "query": "Chrome timeout export report",
  "scenario": "error_solution"
}
```

```json
{
  "query": "Customer ACME prefers concise reports",
  "scenario": "customer_preference"
}
```

```json
{
  "query": "Excel export PDF command",
  "scenario": "software_command"
}
```
