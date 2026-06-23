from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
from pathlib import Path


def _resolve_cli(name: str) -> list[str]:
    force = os.environ.get("CLI_ANYTHING_FORCE_INSTALLED", "").strip() == "1"
    path = shutil.which(name)
    if path:
        print(f"[_resolve_cli] Using installed command: {path}")
        return [path]
    if force:
        raise RuntimeError(f"{name} not found in PATH. Install with: pip install -e .")
    module = "cli_anything.jianying.jianying_cli"
    print(f"[_resolve_cli] Falling back to: {sys.executable} -m {module}")
    return [sys.executable, "-m", module]


class TestCliSubprocess:
    CLI_BASE = _resolve_cli("cli-anything-jianying")

    def _run(self, args: list[str], check: bool = True) -> subprocess.CompletedProcess[str]:
        return subprocess.run(self.CLI_BASE + args, capture_output=True, text=True, check=check)

    def test_help(self) -> None:
        result = self._run(["--help"])
        assert result.returncode == 0
        assert "locate" in result.stdout

    def test_locate_json(self) -> None:
        result = self._run(["--json", "locate"])
        data = json.loads(result.stdout)
        assert Path(data["path"]).exists()
        assert data["path"].lower().endswith("jianyingpro.exe")

    def test_status_json(self) -> None:
        result = self._run(["--json", "status"])
        data = json.loads(result.stdout)
        assert "running" in data
        assert "process_count" in data
        assert "window_count" in data
        assert "draft_roots" in data

    def test_drafts_json(self) -> None:
        result = self._run(["--json", "drafts"])
        data = json.loads(result.stdout)
        assert isinstance(data, list)
        assert any("com.lveditor.draft" in item["path"] for item in data)

    def test_launch_json(self) -> None:
        result = self._run(["--json", "launch"])
        data = json.loads(result.stdout)
        assert data["executable"]["path"].lower().endswith("jianyingpro.exe")
        assert data.get("already_running") is True or data.get("pid")
