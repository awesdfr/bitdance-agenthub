# Production Onsite Intake Checklist

The onsite intake checklist turns the last production-only requirements into a concrete, redacted work order.

Endpoint:

```txt
GET /api/production-integrations/onsite-intake/checklist
```

It covers:

- real model credentials and credential scopes
- model network/IP egress profiles
- desktop control gates and execution evidence
- mobile device/tooling gates and execution evidence
- VM/RDP/VNC workstation reservations
- customer authorization
- production hardening and rollback evidence
- approved go-live hash activation

Model credential intake:

- `GET /api/production-integrations/model-credentials/intake` returns a redacted model credential intake report.
- `POST /api/production-integrations/model-credentials/intake` can dry-run or apply a migration from `env:NAME` to `secret:<id>`.
- `confirmMigrate=true` is required before the API writes a Secret Vault `env_ref`, updates the model profile, or grants `model.connect` / `model.invoke` scopes.
- The intake route accepts environment variable names or existing `secret:<id>` references. It does not accept or return plaintext API keys.
- Live Model Gateway connection tests and capability probes write redacted audit logs through `model.connect.live` and `model.invoke.live`. The production hardening report exposes this as `model_gateway_audit`.
- Live Model Gateway connection tests require `confirmExternalCall=true` and `AGENTHUB_ENABLE_REAL_MODEL_CONNECTION=1` before a credentialed request can be sent to an external model provider. Live model invocation remains separately gated by `AGENTHUB_ENABLE_REAL_MODEL_INVOCATION=1`, customer authorization, and the approved go-live decision hash.
- Capability probes can dry-run JSON mode, tool-calling, vision, and streaming handshakes before any live external request. OpenAI-compatible and Anthropic probes use SSE for streaming, Gemini probes switch to `streamGenerateContent?alt=sse`, and Ollama-style probes use NDJSON streaming metadata. Live probes keep the same credential, endpoint allowlist, customer authorization, and go-live gates.
- Network/Profile landing-IP checks use `POST /api/network-profiles/:id/egress-live-test` and require `confirmExternalCall=true` plus `AGENTHUB_ENABLE_REAL_NETWORK_EGRESS_TEST=1`. Run this before claiming a model is routed through a customer-required proxy or dedicated outbound IP.

Execution preflight:

- `GET /api/production-integrations/execution-preflight` returns a read-only preflight report for live model connection tests, live model invocation, desktop observation/control/capture, mobile discovery/control/capture, workstation validation, and remote workstation launch.
- The report explains which actions can execute now, which are blocked, and which environment gates, approvals, customer authorization, or go-live hash are missing.
- The report also surfaces runtime guards such as `AGENTHUB_RUNTIME_CONTROL_KILL_SWITCH`, `AGENTHUB_ALLOWED_DESKTOP_TARGETS`, and `AGENTHUB_ALLOWED_MOBILE_DEVICE_IDS`, so operators can see emergency-stop and allowlist blockers before attempting a live action.
- The preflight route does not click, type, screenshot, launch remote sessions, operate phones, or call external models.
- High-risk actions still require the same runtime gate chain as the actual executor.
- Runtime screenshot actions only write inside the current computer session `tempPath`; dry-run planning blocks paths outside that boundary.
- Runtime Control supports guarded desktop `click`, `scroll`, `type_text`, `key_press`, `focus_window`, and `capture_screenshot` actions, plus Android ADB-backed mobile `list_devices`, `mobile_tap`, `mobile_swipe`, `mobile_text`, `mobile_keyevent`, and `mobile_screenshot` actions. Write/control actions remain behind environment gates, resource locks, approvals, and go-live checks.
- Android discovery and Runtime Control use the same ADB resolver. By default it runs `adb` from `PATH`; customer machines can set `AGENTHUB_ADB_PATH` to an absolute `adb.exe` path. Advanced deployments can set `AGENTHUB_ADB_ARGS_PREFIX_JSON` to a JSON string array of wrapper arguments, for example when a signed launcher script must be called before normal ADB arguments.
- `AGENTHUB_ADB_PATH` and `AGENTHUB_ADB_ARGS_PREFIX_JSON` are included in the go-live environment fingerprint. Changing the ADB binary path or wrapper arguments after approval is treated as environment drift before high-risk live phone actions can continue.
- `AGENTHUB_RUNTIME_CONTROL_KILL_SWITCH=1` is the operator emergency stop. It blocks high-risk live desktop, mobile, and workstation launch actions before environment gates, approvals, or go-live execution can proceed. Read-only observation and low-risk workstation release remain available so operators can inspect state and clean up leases.
- Live desktop write/control and screenshot actions also require `AGENTHUB_ALLOWED_DESKTOP_TARGETS` to contain the declared `target`, `processName`, `titleContains`, or `targetWindowTitle`. This keeps production desktop control scoped to customer-approved windows or applications instead of letting an Agent click whatever happens to be foreground.
- Live mobile write/control and screenshot actions also require `AGENTHUB_ALLOWED_MOBILE_DEVICE_IDS` to contain the exact `input.deviceId` or `target` device id. `list_devices` stays read-only so operators can discover devices first, but live taps/swipes/text/key events/screenshots are blocked when the target phone is missing from the allowlist.

The checklist is intentionally redacted. It may contain secret reference names, environment variable names, validation commands, status summaries, evidence hashes, and operator instructions. It must not contain API keys, passwords, cookies, phone unlock codes, remote desktop passwords, payment data, or customer private data.

Onsite evidence records are also guarded server-side. Evidence text, notes, operator names, and external references are rejected when they look like API key assignments, bearer tokens, passwords, cookies, phone unlock codes, remote desktop credentials, or payment card numbers. Store redacted evidence IDs, hashes, ticket links, or secret references instead.

The checklist does not by itself enable live actions. Live model connection tests require:

- `confirmExternalCall=true`
- `AGENTHUB_ENABLE_REAL_MODEL_CONNECTION=1`
- a resolvable Secret Vault credential with `model.connect` scope

Live model invocation, desktop control, mobile control, and remote workstation launch still require:

- customer environment authorization
- `AGENTHUB_RUNTIME_CONTROL_KILL_SWITCH` not set to `1`
- the relevant high-risk environment gate
- for desktop actions, a target window or process present in `AGENTHUB_ALLOWED_DESKTOP_TARGETS`
- for mobile actions, a target device id present in `AGENTHUB_ALLOWED_MOBILE_DEVICE_IDS`
- runtime-control approval where required
- an approved go-live decision hash through `AGENTHUB_APPROVED_GO_LIVE_DECISION_HASH`

Live model connection tests are medium-risk credentialed network checks. They do not require the final go-live hash because they do not send a task prompt or ask the model to perform work.

The server-side go-live gate enforces both the approved decision hash and the current `AGENTHUB_CUSTOMER_ENVIRONMENT_AUTHORIZED=1` value. A previously generated hash is not enough if customer authorization has been turned off for the current environment.

Runtime-control actions record a stable `inputHash` for the exact action input. High-risk live `runtime_control_action` approvals must include that `inputHash`, and the executor requires it to match before the action can proceed. This lets approvals bind to a specific click coordinate, scroll delta, text input, mobile swipe coordinates, device id, screenshot path, or workstation launch input instead of only the broad action type.

Software Command approvals use the same binding idea. A `software_command_execute` approval records the user input hash and, when the command maps to runtime-control, the final scope, action type, target, and runtime input hash. Reusing an approved Software Command with changed input or a changed runtime-control mapping creates a fresh approval request instead of silently executing the old approval.

The production hardening report exposes this as `software_command_approval_binding`, with counts for total Software Command approvals, bound approvals, and approved Software Command approvals.

Supported workstation launch metadata:

- `workspacePath`, `browserProfilePath`, and `tempPath`: default to the per-Agent workstation directory. Custom values may be relative subpaths or absolute paths inside that same workstation directory; paths outside the AgentHub workstation root are rejected before directories are created.
- `rdpConfig`: writes a temporary `.rdp` file and launches `mstsc.exe`.
- `vncUrl`: opens `vnc://`, `http://`, or `https://` through the OS registered handler.
- `displayId=rdp:<host>`: launches `mstsc.exe /v:<host>`.
- `displayId=hyperv:<vmName>`: launches `vmconnect.exe localhost <vmName>`.
- `displayId=virtualbox:<vmName>` or `displayId=vbox:<vmName>`: launches `VBoxManage startvm <vmName> --type gui`.
- `displayId=vmware:<vmxPath>` or `displayId=vmrun:<vmxPath>`: launches `vmrun start <vmxPath> gui`.
- `displayId=url:<url>`: opens a remote browser/VNC gateway URL through the OS handler.

Workstation lifecycle:

- `runtime_control.workstation.launch_remote_session` marks the workstation `busy` only after the OS launch command is successfully started.
- A workstation already marked `busy` blocks a second launch attempt until it is released.
- `runtime_control.workstation.release_workstation` marks the workstation back to `idle` inside AgentHub. It does not close the user's RDP/VNC/VM window or kill the remote desktop process.

Stale busy workstation recovery:

- `GET /api/production-integrations/workstations/recovery` returns a dry-run report for busy workstations that have exceeded the stale threshold. The default threshold is 2 hours, and `maxBusyAgeMs` can be supplied for incident response.
- `POST /api/production-integrations/workstations/recovery` with `apply=true` and `confirmRecovery=true` marks only recoverable stale busy workstations back to `idle`.
- A stale workstation is recoverable only when no active or paused computer session still references it and no held `workstation:<id>` resource lock exists.
- Recovery changes AgentHub lease state only. It does not close RDP/VNC/VM windows, kill remote desktop clients, delete files, or stop a real remote machine.
- The production hardening report exposes `workstation_stale_busy_recovery`, `staleBusyWorkstations`, and `recoverableStaleBusyWorkstations` so operators can see stuck workstation leases before assigning more Agents.

RDP and VNC metadata must not contain passwords or credential blobs.
Workstation reservation rejects `rdpConfig` values containing password or credential fields, and rejects `vncUrl` values that embed usernames or passwords. Store those credentials in the operating system credential manager or a scoped secret vault instead of in workstation metadata.
