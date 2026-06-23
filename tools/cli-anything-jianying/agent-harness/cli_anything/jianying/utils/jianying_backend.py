from __future__ import annotations

import ctypes
import json
import os
import subprocess
import sys
import time
import winreg
from ctypes import wintypes
from pathlib import Path
from typing import Any, Callable


PROCESS_PATTERNS = ("Jianying", "JianyingPro", "CapCut", "JYAI")
TITLE_PATTERNS = ("Jianying", "CapCut", "\u526a\u6620")
DEFAULT_LAUNCH_ARGS = ["--src3"]


class BackendError(RuntimeError):
    pass


def _candidate_paths() -> list[tuple[str, str]]:
    candidates: list[tuple[str, str]] = []
    env_path = os.environ.get("JIANYING_PATH")
    if env_path:
        candidates.append((env_path, "env:JIANYING_PATH"))

    common = [
        r"D:\JianyingPro\JianyingPro.exe",
        r"D:\JianyingPro\10.6.0.14057\JianyingPro.exe",
        r"C:\Program Files\JianyingPro\JianyingPro.exe",
        r"C:\Program Files (x86)\JianyingPro\JianyingPro.exe",
        str(Path(os.environ.get("LOCALAPPDATA", "")) / "JianyingPro" / "JianyingPro.exe"),
        str(Path(os.environ.get("LOCALAPPDATA", "")) / "Programs" / "JianyingPro" / "JianyingPro.exe"),
    ]
    candidates.extend((path, "common-path") for path in common if path)

    candidates.extend(_registry_candidates())
    return candidates


def _registry_candidates() -> list[tuple[str, str]]:
    result: list[tuple[str, str]] = []
    roots = [
        (winreg.HKEY_CURRENT_USER, r"Software\Microsoft\Windows\CurrentVersion\Uninstall"),
        (winreg.HKEY_LOCAL_MACHINE, r"Software\Microsoft\Windows\CurrentVersion\Uninstall"),
        (winreg.HKEY_LOCAL_MACHINE, r"Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall"),
    ]
    for root, subkey in roots:
        try:
            with winreg.OpenKey(root, subkey) as key:
                for index in range(winreg.QueryInfoKey(key)[0]):
                    try:
                        child_name = winreg.EnumKey(key, index)
                        with winreg.OpenKey(key, child_name) as child:
                            display_name = _read_reg_value(child, "DisplayName") or ""
                            if not _looks_like_jianying(display_name):
                                continue
                            install_location = _read_reg_value(child, "InstallLocation")
                            display_icon = _read_reg_value(child, "DisplayIcon")
                            uninstall = _read_reg_value(child, "UninstallString")
                            for raw in (install_location, display_icon, uninstall):
                                if not raw:
                                    continue
                                path = _path_from_registry_value(raw)
                                if path:
                                    if path.name.lower() == "jianyingpro.exe":
                                        result.append((str(path), "registry"))
                                    else:
                                        result.append((str(path.parent / "JianyingPro.exe"), "registry"))
                    except OSError:
                        continue
        except OSError:
            continue
    return result


def _read_reg_value(key: Any, name: str) -> str | None:
    try:
        value, _ = winreg.QueryValueEx(key, name)
        return str(value)
    except OSError:
        return None


def _path_from_registry_value(raw: str) -> Path | None:
    cleaned = raw.strip().strip('"')
    if ".exe" in cleaned.lower():
        exe_index = cleaned.lower().find(".exe") + 4
        cleaned = cleaned[:exe_index]
    if not cleaned:
        return None
    return Path(cleaned)


def _looks_like_jianying(text: str) -> bool:
    lowered = text.lower()
    return any(pattern.lower() in lowered for pattern in PROCESS_PATTERNS) or "\u526a\u6620" in text


def locate_executable() -> dict[str, Any]:
    seen: set[str] = set()
    checked: list[str] = []
    for raw_path, source in _candidate_paths():
        path = Path(raw_path).expanduser()
        key = str(path).lower()
        if key in seen:
            continue
        seen.add(key)
        checked.append(str(path))
        if path.exists() and path.is_file():
            return {
                "path": str(path),
                "source": source,
                "version": detect_version(path),
                "checked": checked,
            }
    raise BackendError(
        "Jianying Pro executable was not found. Set JIANYING_PATH to JianyingPro.exe or install Jianying Pro."
    )


def detect_version(executable: Path) -> str | None:
    parent = executable.parent
    if parent.name and parent.name[0].isdigit():
        return parent.name
    version_dirs = [item.name for item in parent.iterdir() if item.is_dir() and item.name[:1].isdigit()]
    return sorted(version_dirs)[-1] if version_dirs else None


def list_processes() -> list[dict[str, Any]]:
    script = r"""
$items = Get-Process | Where-Object { $_.ProcessName -match 'Jianying|JianyingPro|CapCut|JYAI' -and $_.ProcessName -notmatch '^cli-anything' } |
  Select-Object ProcessName,Id,Path,MainWindowTitle
if ($items) { $items | ConvertTo-Json -Depth 4 } else { '[]' }
"""
    try:
        completed = subprocess.run(
            ["powershell", "-NoProfile", "-Command", script],
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            check=False,
        )
    except FileNotFoundError:
        return []
    if completed.returncode != 0 or not completed.stdout.strip():
        return []
    parsed = json.loads(completed.stdout)
    if isinstance(parsed, dict):
        parsed = [parsed]
    result: list[dict[str, Any]] = []
    for item in parsed:
        name = str(item.get("ProcessName") or "")
        if name.lower().startswith("cli-anything"):
            continue
        result.append(
            {
                "process_name": name,
                "pid": int(item.get("Id")),
                "path": item.get("Path"),
                "main_window_title": item.get("MainWindowTitle") or "",
            }
        )
    return result


def list_windows() -> list[dict[str, Any]]:
    if sys.platform != "win32":
        return []
    user32 = ctypes.windll.user32
    visible_pids = {process["pid"] for process in list_processes()}
    windows: list[dict[str, Any]] = []

    @ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)
    def callback(hwnd: int, lparam: int) -> bool:
        del lparam
        pid = wintypes.DWORD()
        user32.GetWindowThreadProcessId(hwnd, ctypes.byref(pid))
        title = _get_window_text(hwnd)
        class_name = _get_class_name(hwnd)
        matched = pid.value in visible_pids or _looks_like_jianying(title) or _looks_like_jianying(class_name)
        if matched:
            rect = _get_window_rect(hwnd)
            windows.append(
                {
                    "hwnd": int(hwnd),
                    "pid": int(pid.value),
                    "title": title,
                    "class_name": class_name,
                    "rect": rect,
                    "visible": bool(user32.IsWindowVisible(hwnd)),
                    "candidate": bool(rect and rect["right"] > rect["left"] and rect["bottom"] > rect["top"]),
                }
            )
        return True

    user32.EnumWindows(callback, 0)
    return windows


def _get_window_text(hwnd: int) -> str:
    user32 = ctypes.windll.user32
    length = user32.GetWindowTextLengthW(hwnd)
    if length <= 0:
        return ""
    buffer = ctypes.create_unicode_buffer(length + 1)
    user32.GetWindowTextW(hwnd, buffer, length + 1)
    return buffer.value


def _get_class_name(hwnd: int) -> str:
    user32 = ctypes.windll.user32
    buffer = ctypes.create_unicode_buffer(256)
    user32.GetClassNameW(hwnd, buffer, 256)
    return buffer.value


def _get_window_rect(hwnd: int) -> dict[str, int]:
    user32 = ctypes.windll.user32
    rect = wintypes.RECT()
    user32.GetWindowRect(hwnd, ctypes.byref(rect))
    return {
        "left": int(rect.left),
        "top": int(rect.top),
        "right": int(rect.right),
        "bottom": int(rect.bottom),
        "width": int(rect.right - rect.left),
        "height": int(rect.bottom - rect.top),
    }


def pick_window(hwnd: int | None = None) -> dict[str, Any]:
    windows = list_windows()
    if hwnd is not None:
        for window in windows:
            if window["hwnd"] == hwnd:
                return window
        raise BackendError(f"Jianying window handle not found: {hwnd}")
    visible_candidates = [window for window in windows if window["visible"] and window["candidate"]]
    if visible_candidates:
        return max(visible_candidates, key=_window_priority)
    if windows:
        return max(windows, key=_window_priority)
    raise BackendError("No Jianying window was found. Run `launch` first or open Jianying Pro.")


def _window_priority(window: dict[str, Any]) -> int:
    title = str(window.get("title") or "")
    rect = window.get("rect") or {}
    area = int(rect.get("width", 0)) * int(rect.get("height", 0))
    score = area
    if "\u526a\u6620\u4e13\u4e1a\u7248" in title:
        score += 10_000_000
    elif _looks_like_jianying(title):
        score += 1_000_000
    if "\u7248\u672c\u66f4\u65b0" in title:
        score -= 5_000_000
    return score


def focus_window(hwnd: int | None = None) -> dict[str, Any]:
    if sys.platform != "win32":
        raise BackendError("Window focus is only supported on Windows.")
    window = pick_window(hwnd)
    user32 = ctypes.windll.user32
    user32.ShowWindow(int(window["hwnd"]), 9)
    time.sleep(0.15)
    focused = bool(user32.SetForegroundWindow(int(window["hwnd"])))
    return {**window, "focused": focused}


def launch(focus: bool = True) -> dict[str, Any]:
    executable = locate_executable()
    processes = list_processes()
    if processes:
        result: dict[str, Any] = {
            "already_running": True,
            "executable": executable,
            "processes": processes,
        }
        if focus:
            try:
                result["focus"] = focus_window()
            except BackendError as exc:
                result["focus_error"] = str(exc)
        return result

    proc = subprocess.Popen(
        [executable["path"], *DEFAULT_LAUNCH_ARGS],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        cwd=str(Path(executable["path"]).parent),
    )
    time.sleep(3)
    result = {
        "already_running": False,
        "pid": proc.pid,
        "executable": executable,
        "processes": list_processes(),
    }
    if focus:
        try:
            result["focus"] = focus_window()
        except BackendError as exc:
            result["focus_error"] = str(exc)
    return result


def capture_window(output: str | os.PathLike[str], hwnd: int | None = None, focus_first: bool = True) -> dict[str, Any]:
    if focus_first:
        window = focus_window(hwnd)
    else:
        window = pick_window(hwnd)
    rect = window["rect"]
    if rect["width"] <= 0 or rect["height"] <= 0:
        raise BackendError(f"Window has invalid capture bounds: {rect}")
    try:
        from PIL import ImageGrab
    except ImportError as exc:
        raise BackendError("Pillow is required for screenshot capture. Install Pillow and retry.") from exc
    target = Path(output)
    target.parent.mkdir(parents=True, exist_ok=True)
    image = ImageGrab.grab(bbox=(rect["left"], rect["top"], rect["right"], rect["bottom"]))
    image.save(target)
    return {
        "output": str(target),
        "width": image.width,
        "height": image.height,
        "file_size": target.stat().st_size,
        "window": window,
    }


def draft_roots() -> list[dict[str, Any]]:
    base = Path(os.environ.get("LOCALAPPDATA", "")) / "JianyingPro" / "User Data" / "Projects"
    candidates = [
        base / "com.lveditor.draft",
        base / "com.lveditor.cloud.draft_2663442320202020",
        base / "com.lveditor.textTemplate.draft",
    ]
    result: list[dict[str, Any]] = []
    for path in candidates:
        if not path.exists():
            continue
        children = [child for child in path.iterdir() if child.is_dir()]
        result.append(
            {
                "path": str(path),
                "exists": True,
                "draft_count": len(children),
                "modified_at": path.stat().st_mtime,
            }
        )
    return result


def status() -> dict[str, Any]:
    executable: dict[str, Any] | None = None
    locate_error: str | None = None
    try:
        executable = locate_executable()
    except BackendError as exc:
        locate_error = str(exc)
    processes = list_processes()
    windows = list_windows()
    return {
        "executable": executable,
        "locate_error": locate_error,
        "running": bool(processes),
        "process_count": len(processes),
        "window_count": len(windows),
        "processes": processes,
        "windows": windows,
        "draft_roots": draft_roots(),
    }
