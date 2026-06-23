---
name: cli-anything-jianying
description: Use the local Windows Jianying Pro desktop app through a conservative CLI for locating, launching, focusing, screenshotting, and draft-root inspection.
---

# cli-anything-jianying

Use this skill when an Agent needs to operate the user's local Jianying Pro desktop app from a CLI.

## Safety Boundary

This CLI is currently a safe preflight and inspection harness. It can locate, launch, focus, list windows, capture screenshots, and list known draft roots. It must not be treated as permission to delete drafts, overwrite exports, publish videos, log in, pay, upload cloud assets, or change account settings.

## Command Pattern

Always prefer JSON for agent use:

```powershell
cli-anything-jianying --json status
```

Available commands:

- `locate`: find `JianyingPro.exe`.
- `status`: inspect executable, running processes, windows, and draft roots.
- `windows`: list candidate app windows.
- `launch`: start Jianying Pro or reuse a running process.
- `focus`: focus a window.
- `screenshot -o <path>`: capture the visible app window to PNG.
- `drafts`: list known draft root folders.
- `session show|undo|redo`: inspect or mutate CLI session metadata.

## Examples

```powershell
cli-anything-jianying --json locate
cli-anything-jianying --json launch
cli-anything-jianying --json screenshot -o .\jianying-window.png
cli-anything-jianying --json drafts
```

## Backend Notes

The CLI uses the real Jianying Pro executable. If it cannot find the app, set:

```powershell
$env:JIANYING_PATH="D:\JianyingPro\JianyingPro.exe"
```

The first production expansion should add macro-backed import/export commands with explicit output verification.
