# cli-anything-jianying

Safe CLI-Anything harness for the local Windows Jianying Pro desktop app.

This CLI does not replace Jianying. It wraps the real installed desktop app so an Agent can locate it, start it, focus it, inspect windows, capture screenshots, and list draft roots before higher-risk UI automation is added.

## Install

Prerequisites:

- Windows
- Jianying Pro installed
- Python 3.10+

Install locally:

```powershell
cd tools\cli-anything-jianying\agent-harness
C:\Users\九思\AppData\Local\Programs\Python\Python312\python.exe -m pip install -e .
```

If Jianying is installed somewhere unusual:

```powershell
$env:JIANYING_PATH="D:\JianyingPro\JianyingPro.exe"
```

## Commands

```powershell
cli-anything-jianying --json locate
cli-anything-jianying --json status
cli-anything-jianying --json windows
cli-anything-jianying --json launch
cli-anything-jianying --json focus
cli-anything-jianying --json screenshot -o .\jianying.png
cli-anything-jianying --json drafts
cli-anything-jianying session show
```

## Safety

The current command surface is read-only or app-control only. It does not delete drafts, modify media, publish videos, upload assets, log in, pay, or overwrite exports.

## AgentHub Integration

Register this as a CLI Profile:

- Name: `Jianying Pro CLI`
- Command: `cli-anything-jianying`
- Args template: `--json {{command}}`
- CWD policy: `agent_workspace`
- Input mode: `args`
- Output mode: `json`

For individual software commands, call:

- `locate`
- `status`
- `launch`
- `screenshot -o {{outputPath}}`
- `drafts`
