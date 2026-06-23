# Resource Governor

Section 94 records local resource pressure decisions before Agents are scheduled or allowed to keep running at full speed.

## Covered Resources

- CPU: total and per-Agent CPU limits.
- GPU: total and per-Agent VRAM limits, with local model inference disabled under pressure.
- Memory: total and per-Agent memory limits.
- Disk I/O: throttling and low-priority pauses for heavy file workloads.
- Network: throttling for heavy upload/download workloads.
- Battery: cap concurrent Agents, prefer cheaper/cloud models, increase checkpoint frequency, slow browser actions, pause non-critical tasks below 20%, and force checkpoint below 5%.
- Thermal: CPU/GPU temperature pressure, reduced concurrency, cheaper models, and tray status guidance.

## APIs

- `POST /api/resource-governor/policies/seed`
- `GET /api/resource-governor/policies?status=active`
- `POST /api/resource-governor/evaluate`
- `GET /api/resource-governor/evaluations?status=paused`

## Safety Boundary

The service does not change OS power settings, kill processes, throttle hardware, or control real devices. It records scheduling decisions that runtime services can apply with normal checkpoint, permission, and user-notification behavior.
