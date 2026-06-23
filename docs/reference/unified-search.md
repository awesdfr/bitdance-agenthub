# Unified Search

Unified search provides one entry point across Agents, tasks, memories, artifacts, workflows, events, the knowledge graph, and workspace documents.

## Index Entries

Each indexed entity stores:

- entity type and entity ID
- title, content, snippet, and keywords
- lightweight semantic vector
- optional Agent, task, and project source labels
- timestamp

## Modes

| Mode | Meaning |
| --- | --- |
| `keyword` | Token/keyword matching, ready to be backed by FTS5. |
| `semantic` | Lightweight vector similarity, ready to be backed by embeddings. |
| `hybrid` | Combines keyword and semantic scores. |
| `filtered` | Applies type, project, Agent, and date filters. |

## Scope

The query can include or exclude:

- Agents
- tasks
- memories
- artifacts
- workflows
- events
- knowledge graph
- documents

The global shortcut target is `Ctrl+K`; natural language queries are stored with `nlQuery: true`.
