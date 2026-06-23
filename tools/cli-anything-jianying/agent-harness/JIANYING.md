# Jianying Pro CLI-Anything Harness

## Source And Backend

- Target software: Jianying Pro desktop on Windows.
- Detected install: `D:\JianyingPro\JianyingPro.exe`.
- Current native command-line surface: no verified official CLI for project import/export was found.
- Backend strategy: use the real Jianying Pro executable for launch/focus/inspection, Windows APIs for process/window control, and Pillow ImageGrab for truthful screenshots of the real app window.

## Current Command Surface

This first harness is intentionally safe and non-destructive:

- `locate`: find the real Jianying executable.
- `status`: inspect installation, process, windows, and draft roots.
- `windows`: list candidate Jianying windows.
- `launch`: start the real app.
- `focus`: focus a visible app window.
- `screenshot`: capture the visible window to PNG.
- `drafts`: list known local draft root folders.

## Expansion Plan

The next production layer should add:

- draft project inventory and metadata parsing;
- safe backup and open-draft commands;
- macro-backed import/export commands;
- UI automation adapters for "import media", "create draft", and "export";
- verification commands that probe exported video duration, resolution, audio, and nonblank frames.

Destructive actions such as deleting drafts, overwriting exports, logging in, publishing, paid effects, or cloud sync remain outside this safe CLI surface.
