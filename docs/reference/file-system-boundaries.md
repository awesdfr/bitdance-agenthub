# File System Boundary Handling

Section 90 turns cross-platform file pitfalls into a record-only control-plane service. Agents can evaluate a target file or path before reading, writing, creating, deleting, or executing it.

## Covered Risks

- Encoding drift: non-UTF-8 text is flagged for UTF-8 transcoding.
- BOM handling: BOM markers are detected and stripped during ingestion unless explicitly preserved.
- Line endings: CRLF or mixed line endings are normalized to the configured default.
- Windows path length: paths near or over MAX_PATH are flagged with shallow-workspace guidance.
- Windows file locks: write/create/delete operations can be paused with user notification instead of retrying blindly.
- Large files: medium files use stream summaries, large files use metadata/specialized tools, and huge files are blocked from direct context loading.
- Binary files: known binary extensions are routed to metadata or specialized parsers.
- Special filenames: Windows-forbidden characters, trailing spaces/dots, and emoji are normalized before file creation.

## APIs

- `POST /api/file-boundaries/policies/seed`
- `GET /api/file-boundaries/policies?status=active`
- `POST /api/file-boundaries/evaluate`
- `GET /api/file-boundaries/evaluations?status=warning&operation=write`

## Safety Boundary

The service does not open, lock, modify, delete, or execute user files. It only records policy decisions and recommended actions that other runtime services can apply with the normal permission and resource-lock checks.
