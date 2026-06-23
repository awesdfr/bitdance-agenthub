# MCP Runtime

AgentHub treats MCP as a guarded tool connection layer. The baseline includes:

- MCP server registration and metadata tests.
- manifest-backed tool discovery.
- dry-run MCP tool calls.
- execute-mode approval requests.
- local stdio MCP JSON-RPC execution for approved tool calls when live gates and command allowlists are satisfied.
- remote HTTP MCP JSON-RPC execution for approved tool calls when live gates, endpoint host allowlists, and credentials are satisfied.
- guarded local stdio MCP process planning, start, stop, and status checks.

Runtime lifecycle endpoint:

```txt
GET  /api/mcp-servers/:id/runtime
POST /api/mcp-servers/:id/runtime
```

`POST` accepts:

```json
{
  "action": "plan | start | stop | status",
  "live": false,
  "confirmRisk": false
}
```

Live stdio process launch is blocked unless:

- `AGENTHUB_ENABLE_REAL_MCP_PROCESS=1`
- `confirmRisk=true`
- `AGENTHUB_ALLOWED_MCP_COMMANDS` contains the exact command or its basename
- the MCP server is enabled
- the command is a direct executable path or binary name

Remote HTTP/SSE MCP servers are treated as external endpoints. AgentHub does not pretend it launched an external process, but approved tool execution can call an HTTP-compatible MCP JSON-RPC endpoint with `initialize`, `notifications/initialized`, `tools/list`, and `tools/call`.

Remote MCP JSON-RPC tool calls are blocked unless:

- `AGENTHUB_ENABLE_REAL_MCP_PROCESS=1`
- `confirmRisk=true`
- `approvalRequestId` points to an approved request for the same tool and exact input
- `AGENTHUB_ALLOWED_MCP_ENDPOINT_HOSTS` contains the endpoint host, exact host, `*.domain`, or `*`
- the MCP server is enabled

Remote MCP credentials can be supplied through MCP server env:

- `AGENTHUB_MCP_AUTHORIZATION` or `MCP_AUTHORIZATION`
- `AGENTHUB_MCP_BEARER_TOKEN` or `MCP_BEARER_TOKEN`
- `AGENTHUB_MCP_API_KEY` or `MCP_API_KEY`
- optional API key header name via `AGENTHUB_MCP_API_KEY_HEADER` or `MCP_API_KEY_HEADER`

Approved stdio tool execution performs the MCP `initialize`, `notifications/initialized`, `tools/list`, and `tools/call` JSON-RPC sequence, records the result in `mcp_tool_calls`, updates MCP server health, and writes a redacted `mcp.tool.call.live` audit log. It still requires `approvalRequestId`, `live=true`, `confirmRisk=true`, `AGENTHUB_ENABLE_REAL_MCP_PROCESS=1`, and `AGENTHUB_ALLOWED_MCP_COMMANDS`.

Approved remote HTTP tool execution records the result in `mcp_tool_calls`, updates MCP server health, and writes the same redacted `mcp.tool.call.live` audit log with endpoint-host allowlist metadata.

This does not claim unrestricted external tool execution. Customer-owned MCP side effects still need authorized servers, scoped credentials, approvals, endpoint allowlists, and onsite audit evidence.
