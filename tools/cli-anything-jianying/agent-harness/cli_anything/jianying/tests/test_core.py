from __future__ import annotations

from pathlib import Path

from cli_anything.jianying.core.session import Session
from cli_anything.jianying.utils import jianying_backend as backend


def test_path_from_registry_value_strips_arguments() -> None:
    parsed = backend._path_from_registry_value('"D:\\JianyingPro\\uninst.exe" /S')
    assert parsed == Path("D:\\JianyingPro\\uninst.exe")


def test_detect_version_from_versioned_parent(tmp_path: Path) -> None:
    version_dir = tmp_path / "10.6.0.14057"
    version_dir.mkdir()
    exe = version_dir / "JianyingPro.exe"
    exe.write_text("fake", encoding="utf-8")
    assert backend.detect_version(exe) == "10.6.0.14057"


def test_detect_version_from_sibling_version_dir(tmp_path: Path) -> None:
    (tmp_path / "10.6.0.14057").mkdir()
    exe = tmp_path / "JianyingPro.exe"
    exe.write_text("fake", encoding="utf-8")
    assert backend.detect_version(exe) == "10.6.0.14057"


def test_session_record_and_save(tmp_path: Path) -> None:
    path = tmp_path / "session.json"
    session = Session(path)
    session.record_action("status", {"running": False})
    session.save()

    loaded = Session(path)
    assert loaded.data["last_action"]["name"] == "status"
    assert loaded.data["last_action"]["payload"]["running"] is False


def test_session_undo(tmp_path: Path) -> None:
    path = tmp_path / "session.json"
    session = Session(path)
    session.record_action("first", {"value": 1})
    session.record_action("second", {"value": 2})
    restored = session.undo()
    assert restored["last_action"]["name"] == "first"
