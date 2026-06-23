# Test Plan

## Test Inventory Plan

- `test_core.py`: 5 unit tests planned.
- `test_full_e2e.py`: 5 installed CLI and real local backend tests planned.

## Unit Test Plan

- `core.session`
  - load default session when missing
  - save with locked JSON writer
  - record action and preserve undo history
- `utils.jianying_backend`
  - parse registry executable values
  - detect version folders

## E2E Test Plan

The E2E tests invoke the installed `cli-anything-jianying` command with `--json` and verify:

- help exits successfully;
- `locate` returns a real `JianyingPro.exe`;
- `status` returns process/window/draft-root fields;
- `drafts` returns known local draft roots;
- `launch` invokes the real Jianying executable or reuses an already-running process.

The screenshot command is verified manually in live acceptance because it depends on the real window being visible and unlocked.

## Realistic Workflow Scenarios

Workflow: Agent preflight before editing.

- Operations chained: locate -> status -> launch -> windows -> screenshot -> drafts.
- Verified: executable exists, process can be inspected, visible window can be captured, and draft roots are discoverable.

## Test Results

### Source-mode pytest

Command:

```powershell
C:\Users\九思\AppData\Local\Programs\Python\Python312\python.exe -m pytest cli_anything\jianying\tests -v -s
```

Result:

```text
10 passed in 5.46s
```

### Installed-command pytest

Command:

```powershell
$env:CLI_ANYTHING_FORCE_INSTALLED='1'
C:\Users\九思\AppData\Local\Programs\Python\Python312\python.exe -m pytest cli_anything\jianying\tests -v -s
```

Result:

```text
[_resolve_cli] Using installed command: C:\Users\九思\AppData\Local\Programs\Python\Python312\Scripts\cli-anything-jianying.EXE
10 passed in 2.44s
```

### Live smoke

Commands:

```powershell
C:\Users\九思\AppData\Local\Programs\Python\Python312\Scripts\cli-anything-jianying.exe --json locate
C:\Users\九思\AppData\Local\Programs\Python\Python312\Scripts\cli-anything-jianying.exe --json status
C:\Users\九思\AppData\Local\Programs\Python\Python312\Scripts\cli-anything-jianying.exe --json screenshot -o tmp\jianying-live-smoke.png
```

Verified:

- Located `D:\JianyingPro\JianyingPro.exe`.
- Detected Jianying Pro version `10.6.0.14057`.
- Detected a visible `剪映专业版` main window.
- Captured `tmp\jianying-live-smoke.png`.
- Screenshot dimensions: `1168x780`.
- Screenshot byte size: `326371`.
- Pixel validation: RGB mean `[68.64, 72.67, 77.57]`, channel extrema all `[0, 255]`, so the capture is nonblank.
