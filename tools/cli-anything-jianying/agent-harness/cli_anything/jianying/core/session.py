from __future__ import annotations

import copy
import json
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


DEFAULT_SESSION_PATH = Path.home() / ".cli_anything" / "jianying" / "session.json"


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _locked_save_json(path: str | os.PathLike[str], data: dict[str, Any], **dump_kwargs: Any) -> None:
    """Atomically write JSON with exclusive locking where the platform supports it."""

    target = Path(path)
    target.parent.mkdir(parents=True, exist_ok=True)
    try:
        file_obj = open(target, "r+", encoding="utf-8")
    except FileNotFoundError:
        file_obj = open(target, "w", encoding="utf-8")

    with file_obj as f:
        locked = False
        try:
            import fcntl  # type: ignore

            fcntl.flock(f.fileno(), fcntl.LOCK_EX)
            locked = True
        except (ImportError, OSError):
            pass
        try:
            f.seek(0)
            f.truncate()
            json.dump(data, f, ensure_ascii=False, indent=2, **dump_kwargs)
            f.flush()
        finally:
            if locked:
                fcntl.flock(f.fileno(), fcntl.LOCK_UN)  # type: ignore[name-defined]


def load_json(path: str | os.PathLike[str]) -> dict[str, Any]:
    target = Path(path)
    if not target.exists():
        created_at = now_iso()
        return {
            "created_at": created_at,
            "updated_at": created_at,
            "last_action": None,
            "undo_stack": [],
            "redo_stack": [],
        }
    with open(target, "r", encoding="utf-8") as f:
        return json.load(f)


class Session:
    def __init__(self, path: str | os.PathLike[str] | None = None) -> None:
        self.path = Path(path) if path else DEFAULT_SESSION_PATH
        self.data = load_json(self.path)
        self.modified = False

    def snapshot(self) -> None:
        undo_stack = self.data.setdefault("undo_stack", [])
        undo_stack.append(copy.deepcopy({k: v for k, v in self.data.items() if k not in {"undo_stack", "redo_stack"}}))
        if len(undo_stack) > 30:
            del undo_stack[:-30]
        self.data["redo_stack"] = []
        self.modified = True

    def record_action(self, name: str, payload: dict[str, Any]) -> None:
        self.snapshot()
        self.data["updated_at"] = now_iso()
        self.data["last_action"] = {
            "name": name,
            "payload": payload,
            "at": self.data["updated_at"],
        }
        self.modified = True

    def save(self) -> None:
        _locked_save_json(self.path, self.data)
        self.modified = False

    def undo(self) -> dict[str, Any]:
        undo_stack = self.data.setdefault("undo_stack", [])
        if not undo_stack:
            raise RuntimeError("Nothing to undo.")
        current = copy.deepcopy({k: v for k, v in self.data.items() if k not in {"undo_stack", "redo_stack"}})
        self.data.setdefault("redo_stack", []).append(current)
        restored = undo_stack.pop()
        self.data.update(restored)
        self.data["updated_at"] = now_iso()
        self.modified = True
        return self.data

    def redo(self) -> dict[str, Any]:
        redo_stack = self.data.setdefault("redo_stack", [])
        if not redo_stack:
            raise RuntimeError("Nothing to redo.")
        current = copy.deepcopy({k: v for k, v in self.data.items() if k not in {"undo_stack", "redo_stack"}})
        self.data.setdefault("undo_stack", []).append(current)
        restored = redo_stack.pop()
        self.data.update(restored)
        self.data["updated_at"] = now_iso()
        self.modified = True
        return self.data
