# Employee Runtime Loop

Section 4 requires an Agent employee to run as a loop rather than as a single prompt.
The current implementation is deterministic and local-first: it records the loop structure and safe handoff points without calling live models, launching software, or controlling the desktop.

## Runtime Phases

Every employee run passes through:

1. `understand_goal`
2. `retrieve_memory`
3. `create_plan`
4. `verify_output_contract`
5. `checkpoint_ready_state`

After those phases the runtime saves a prompt/context snapshot, renders configured CLI dry-runs, materializes multimodal IO records, validates the artifact contract, writes reflection/learning records, and stores continuity records.

## Loop Trace

Each phase payload and final run output includes a `RuntimeLoopStepTrace`:

- `observation`: what the Agent/runtime saw.
- `decision`: why the next action was chosen.
- `selectedAction`: the deterministic action selected for the phase.
- `verification`: how that step was checked.
- `nextStep`: the next runtime phase.
- `status`: `completed` or `blocked`.
- `recoveryPlan`: suggested recovery actions for blocked phases.
- `evidence`: run id, Agent id, artifact type, memory count, plan count, and next phase.

The final output also includes `nextRuntimeAction`, which tells the UI whether to hand off to a model/tool executor, review rendered CLI dry-runs, request approval, or fix the Agent Profile.

## Failure Recovery

When the runtime fails early, error events include `recoveryPlan`.
For example:

- budget failures recommend reviewing estimated cost, reducing scope or increasing budget, and restarting with the updated policy.
- missing output contracts recommend defining `artifactType`, `requiredFiles`, and `validationRules` in Agent Factory before resuming.

This makes blocked runs visible and resumable without pretending a live model or desktop action has succeeded.
