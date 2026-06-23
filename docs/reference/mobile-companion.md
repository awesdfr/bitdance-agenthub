# Mobile Companion Report

Section 17 is implemented as a mobile companion surface plus a guarded mobile runtime boundary. A phone can observe desktop Agent work, answer approvals, control employee runs, send messages, view artifacts, and register phone-provided handoff material. Android ADB-backed device control is exposed through Runtime Control, but live phone actions remain blocked until production gates, allowlists, approvals, resource locks, and go-live evidence are satisfied.

## API

```txt
GET  /api/mobile/companion-report
POST /api/mobile/uploads
```

Both routes require the same Bearer token as the other `/api/mobile/*` routes.

## V1 Scope

- progress and Agent status from `/api/mobile/snapshot`
- conversation details and artifact viewing
- approval, pending write, and pending question responses
- employee run pause, resume, and cancel controls
- user message sending from the phone
- upload handoff records stored as `multimodal_inputs` with `source=mobile_companion_upload`

`/api/mobile/uploads` registers metadata and a `dataRef`; it does not read the phone filesystem or store raw phone bytes by itself.

## Guarded Device Automation

`v2DeviceAutomationReservations` now separates three cases:

- `guarded_available`: implemented through Runtime Control, but live execution is blocked by production gates until authorized.
- `needs_configuration`: implementation exists but a required local tool or setting is missing.
- `reserved_not_enabled`: not implemented as a live executor yet.

Android ADB and mobile click/input automation are `guarded_available` when reported. They expose the runtime action names, required environment variables, device/app allowlists, and safety gates:

- `AGENTHUB_ENABLE_REAL_MOBILE_CONTROL`
- `AGENTHUB_ENABLE_REAL_MOBILE_CAPTURE`
- `AGENTHUB_ADB_PATH` for customer machines where `adb` is not on `PATH`
- `AGENTHUB_ADB_ARGS_PREFIX_JSON` for an explicit wrapper argument array, such as a signed launcher script
- `AGENTHUB_ALLOWED_MOBILE_DEVICE_IDS`
- `AGENTHUB_ALLOWED_MOBILE_APP_PACKAGES`
- customer authorization evidence
- approved go-live hash
- live-pilot lease/session
- runtime approval input-hash binding
- mobile-device resource lock
- audit log

iOS Shortcuts, full Appium execution, and screen mirroring remain `reserved_not_enabled` until live executors are added.

`scripts/smoke-runtime-adb-execution-api.ts` verifies the configured ADB path without touching a real phone. It points `AGENTHUB_ADB_PATH` at the current Node executable, supplies `AGENTHUB_ADB_ARGS_PREFIX_JSON` for the smoke ADB fixture, then proves both production mobile discovery and Runtime Control `list_devices` execute the same configured command path.

## Readiness

The report returns:

- `ready` when companion mode and token are configured and there is visible run/approval/upload activity
- `empty` when the companion is configured but has no current activity
- `needs_configuration` when companion mode or token is missing

The readiness score combines configuration, active run/approval evidence, upload handoff evidence, gaps, and warnings.
