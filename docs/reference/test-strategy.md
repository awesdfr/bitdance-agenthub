# Test Strategy

Section 47 is implemented as a persisted test-strategy registry.

API:

- `POST /api/test-strategy/seed`
- `GET /api/test-strategy/items`
- `POST /api/test-strategy/evaluate`

The registry stores four item kinds in `test_strategy_items`:

- `pyramid_layer`: unit, integration, and E2E layers.
- `integration_case`: AgentEmployeeRuntime, ResourceLockService, and MemoryService integration cases.
- `mock_model_capability`: deterministic output, error injection, and call/event recording.
- `chaos_case`: child-process kill, network disconnect, model error, and disk-full plans.

The v1 chaos policy is `record_only`. Tests must not randomly kill live desktop processes, disconnect the user's network, fill disks, or mutate the OS. Instead, the suite verifies recovery, degradation, error classification, system-bootstrap warnings, checkpoints, and idempotency through deterministic local services.

Default evaluation expects:

- 3 pyramid layers.
- 16 integration cases.
- 3 mock model capabilities.
- 4 record-only chaos cases.

This keeps the project testable without paying for live models or destabilizing the user's machine.
