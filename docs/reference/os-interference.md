# OS Interference Handling

Section 89 is implemented as a safe OS-interference policy and event evaluator.

API:

- `POST /api/os-interference/policies/seed`
- `GET /api/os-interference/policies`
- `POST /api/os-interference/evaluate`
- `GET /api/os-interference/events`

Persistence:

- `os_interference_policies` stores monitor-handling policy and prevention checklist.
- `os_interference_events` stores detected signal, source type, monitor snapshot, recommended action, status, and evidence refs.

Supported signals include:

- System popups: UAC, firewall, system update, low battery, disk-space warning.
- Application popups: save changes, app update, file modified/reload, crash report, print dialog, native file picker.
- Screen/session states: screen saver, locked screen, display sleep, fast user switch, RDP disconnect/reconnect.

The evaluator maps monitor snapshots to actions such as:

- `pause_all_agents`
- `notify_user`
- `take_screenshot_and_ask`
- `pause_ui_agents`
- `continue_headless_only`
- `use_cli_or_api_instead`

Safety boundary:

The module does not click UAC prompts, close real OS dialogs, mutate network settings, unlock sessions, or control live desktop state. It records the interference and returns the safest next action for the runtime, scheduler, monitor, or user approval flow.

Default prevention checklist:

- Prefer headless browser or virtual display for automation that should not depend on the physical screen.
- Route native file-picker workflows through CLI/API file paths instead of clicking OS dialogs.
- Keep core Agent runtime able to run without an unlocked interactive desktop session.
- Before long desktop runs, warn about updates, low battery, firewall prompts, and disk-space pressure.
