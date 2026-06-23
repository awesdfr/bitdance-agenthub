# Error Recovery Strategies

Section 42 adds a structured error taxonomy and recovery-strategy feedback loop for Agent employee runs.

## Taxonomy

The recovery layer classifies runtime failures into:

- `model_error`
- `tool_error`
- `network_error`
- `permission_error`
- `resource_error`
- `input_error`
- `environment_error`
- `rate_limit_error`
- `timeout_error`

Each classification also gets a severity:

- `recoverable`
- `recoverable_with_help`
- `fatal`

Fatal errors stop autonomous continuation and prefer `ask_user` or `rollback`.

## Strategies

The supported strategy types match the implementation plan:

- `retry`
- `retry_with_fallback_model`
- `retry_with_different_approach`
- `skip_step`
- `replan_from_scratch`
- `ask_user`
- `rollback`
- `delegate_to_agent`

The service ranks strategies with local deterministic priors first, then overrides those priors with historical success rate once attempts have been recorded.

## Persistence

- `error_classifications` stores the original error, normalized signal text, category, severity, confidence, suggested strategy, and ranked alternatives.
- `recovery_strategy_attempts` stores each attempted strategy and its outcome.
- `recovery_strategy_stats` stores attempt counts, success counts, failure counts, success rate, and last outcome by Agent/category/strategy.

## API

- `POST /api/error-recovery/classify`
- `POST /api/error-recovery/recommend`
- `GET /api/error-recovery/classifications`
- `GET /api/error-recovery/attempts`
- `POST /api/error-recovery/attempts`
- `GET /api/error-recovery/strategy-stats`

The API is record-only. It does not retry commands, mutate files, switch providers, or operate the desktop by itself. Runtime services can use these records to choose a safer next action.
