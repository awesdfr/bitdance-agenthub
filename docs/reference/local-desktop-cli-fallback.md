# Local Desktop CLI Fallback

AgentHub now ships a built-in Windows desktop software CLI at:

```txt
scripts/local-desktop-app-cli.mjs
```

It is a fallback for machines where `cli-anything-wechat.exe` or
`cli-anything-jianying.exe` is not installed. Registration scripts still prefer the
external `cli-anything-*` harness when it exists, but automatically fall back to:

```txt
node scripts/local-desktop-app-cli.mjs --app wechat --json <command>
node scripts/local-desktop-app-cli.mjs --app jianying --json <command>
```

## Supported Commands

WeChat:

- `locate`
- `status`
- `focus`
- `screenshot -o <path>`
- `visible-text --ack-privacy --max-items <n>`
- `message draft-current --ack-current-chat --text <text>`

Jianying:

- `locate`
- `status`
- `launch`
- `screenshot -o <path>`
- `drafts`

## Safety Boundary

The built-in WeChat CLI does not read local chat databases, decrypt storage,
bypass login, or send messages. It can inspect processes/windows, focus a window,
capture the screen after focus, read visible UI Automation text with an explicit
privacy acknowledgement, and draft text into the current chat when explicitly
asked.

Jianying support is currently a safe preflight layer: locate the executable,
inspect running state, launch the app, capture the visible screen, and list known
local draft folders. Full import/edit/export automation still needs macro
recording or a draft-format adapter.

## Verification

Run:

```txt
node node_modules/tsx/dist/cli.mjs scripts/smoke-local-desktop-app-cli.ts
```

This verifies the built-in CLI and the fallback registration path in an isolated
AgentHub data directory.
