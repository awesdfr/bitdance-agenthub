# External Monitoring Integration

Section 207 exposes Reasonix/AgentHub state to standard operations tools.

## Endpoints

- `GET /metrics`: Prometheus text format.
- `GET /health`: liveness probe for database, memory, and queue health.
- `GET /ready`: readiness probe for database, maintenance, and queue state.
- `GET/POST /api/external-monitoring/configs`: stores external monitoring configuration.

## Prometheus Metrics

The `/metrics` endpoint includes the required baseline names:

- `reasonix_agents_total`
- `reasonix_agents_running`
- `reasonix_tasks_total`
- `reasonix_tasks_completed`
- `reasonix_tasks_failed`
- `reasonix_task_duration_seconds`
- `reasonix_model_calls_total`
- `reasonix_model_tokens_total`
- `reasonix_cost_total`
- `reasonix_resource_locks_waiting`
- `reasonix_memory_bytes`
- `reasonix_disk_bytes`
- `reasonix_db_size_bytes`
- `reasonix_event_queue_size`

## Log Export Configuration

External monitoring configs store:

- format: `json` or `syslog`
- destination: `stdout`, `file`, `http`, or `elasticsearch`
- structured logging flag
- sensitive redaction flag

The v1 implementation records the configuration and exposes probe/metrics data. It does not push logs to external network destinations without a future explicit delivery path.
