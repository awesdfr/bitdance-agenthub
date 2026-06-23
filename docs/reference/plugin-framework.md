# Plugin And Extension Framework

Section 35 is implemented as a local plugin control plane. It lets new capabilities register extension points without changing core Agent runtime code for every future provider.

## Extension Points

Supported extension points:

- `tool_provider`
- `model_provider`
- `memory_backend`
- `workstation_type`
- `verification_strategy`
- `output_adapter`
- `notification_channel`
- `trigger_type`
- `ui_panel`
- `artifact_renderer`

## Persistence

- `plugin_packages`: plugin manifest, extension points, capabilities, config, marketplace metadata, compatibility report, security scan, status, and health.
- `plugin_lifecycle_events`: install, enable, disable, uninstall, upgrade, health-check, and compatibility-check history.

## API

- `GET /api/plugins`
- `POST /api/plugins`
- `POST /api/plugins/:id/enable`
- `POST /api/plugins/:id/disable`
- `POST /api/plugins/:id/uninstall`
- `POST /api/plugins/:id/upgrade`
- `POST /api/plugins/:id/health-check`
- `POST /api/plugins/:id/compatibility`
- `GET /api/plugins/:id/events`
- `GET /api/system/plugins`
- `POST /api/system/plugins/install`

## Install Shape

```json
{
  "name": "Browser Tool Provider",
  "version": "1.0.0",
  "extensionPoints": ["tool_provider", "ui_panel"],
  "capabilities": [
    {
      "id": "browser.open",
      "name": "Open Browser",
      "type": "tool_provider",
      "description": "Open a browser session for an Agent.",
      "riskLevel": "medium"
    }
  ],
  "marketplaceMetadata": {
    "source": "marketplace",
    "marketplaceUrl": "https://skillsmp.com/plugins/browser-tool-provider",
    "rating": 4.8,
    "downloads": 1200
  }
}
```

## Safety Model

- Every install receives a deterministic security scan.
- `unsafeEval` in plugin config blocks install/enable by marking the package `failed`.
- High-risk capabilities, host-access requests, workstation extensions, and non-HTTPS marketplace URLs produce warnings.
- Enable/upgrade actions write lifecycle events and audit logs.
- Compatibility checks compare required core version, security status, and selected extension-point overlap with enabled plugins.

This is a control-plane foundation. It does not execute third-party plugin code directly.
