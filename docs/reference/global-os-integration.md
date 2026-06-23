# Global OS Integration Safety

Section 95 records safety decisions for shared OS resources before desktop or browser automation touches them.

## Covered Areas

- Clipboard isolation:
  - Prefer virtual Agent clipboards.
  - Prefer direct input dispatch instead of Ctrl+C/Ctrl+V.
  - If system clipboard is unavoidable, backup and restore it quickly.
- Window focus:
  - Prefer headless browser sessions.
  - Prefer background or minimized execution.
  - Delay foreground actions when the user has typed or moved the mouse recently.
  - Ask before taking focus when foreground automation is unavoidable.
- Native dialogs:
  - File picker: controlled file-input injection.
  - Print dialog: PDF generation API.
  - Color picker: CSS value injection.
  - Unknown native dialogs: user assistance.

## APIs

- `POST /api/global-os-integration/policies/seed`
- `GET /api/global-os-integration/policies?status=active`
- `POST /api/global-os-integration/evaluate`
- `GET /api/global-os-integration/evaluations?status=delayed`

## Safety Boundary

The service does not read or write the real clipboard, change focus, send keystrokes, or control native OS dialogs. It records safe execution decisions for runtime adapters to apply with normal approvals and locks.
