# System Bootstrap and Meta Monitoring

Section 39 is implemented as a local system bootstrap check surface plus the existing Meta Agent digest/recommendation layer.

## Bootstrap Checks

`system_bootstrap_checks` records one row per component for each bootstrap run:

- `database_connection`
- `message_queue`
- `model_providers`
- `mcp_servers`
- `disk_space`
- `memory_usage`
- `running_agents`
- `pending_approvals`
- `api_latency`
- `websocket_connections`
- `event_throughput`
- `database_slow_queries`
- `checkpoint_latency`
- `ops_agent`

Each row stores `observed`, `threshold`, `status`, and a recommendation.

## Meta Monitoring

The bootstrap check complements the Meta Agent:

- health monitoring uses model/MCP/run/approval/queue data
- performance monitoring records latency, throughput, slow query, and checkpoint signals
- self-healing recommendations point users toward approvals, queue review, concurrency reduction, cleanup, and Meta/Ops Agent setup

The v1 implementation records and evaluates local signals. It does not mutate system settings or perform automatic cleanup without explicit user action.

## API

- `POST /api/system-bootstrap/checks/run`
- `GET /api/system-bootstrap/checks`
- `GET /api/system-bootstrap/checks?component=memory_usage`
- `GET /api/system-bootstrap/checks?status=warning`
