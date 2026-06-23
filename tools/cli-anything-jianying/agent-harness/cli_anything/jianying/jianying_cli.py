from __future__ import annotations

import json
import shlex
from datetime import datetime
from pathlib import Path
from typing import Any

import click

from cli_anything.jianying import __version__
from cli_anything.jianying.core.session import Session
from cli_anything.jianying.utils import jianying_backend as backend


def _emit(ctx: click.Context, payload: dict[str, Any] | list[dict[str, Any]], human: str | None = None) -> None:
    if ctx.obj.get("json"):
        click.echo(json.dumps(payload, ensure_ascii=False, indent=2))
        return
    if human:
        click.echo(human)
    else:
        click.echo(json.dumps(payload, ensure_ascii=False, indent=2))


def _record(ctx: click.Context, name: str, payload: dict[str, Any]) -> None:
    session: Session = ctx.obj["session"]
    session.record_action(name, payload)
    if not ctx.obj.get("dry_run"):
        session.save()


def _handle_error(ctx: click.Context, exc: Exception) -> None:
    payload = {
        "status": "error",
        "error": str(exc),
        "type": exc.__class__.__name__,
    }
    if ctx.obj.get("json"):
        click.echo(json.dumps(payload, ensure_ascii=False, indent=2), err=True)
    else:
        click.echo(f"Error: {exc}", err=True)
    raise click.Abort()


@click.group(invoke_without_command=True)
@click.option("--json", "use_json", is_flag=True, help="Output machine-readable JSON.")
@click.option("--session", "session_path", type=click.Path(dir_okay=False), default=None, help="Session JSON path.")
@click.option("--dry-run", is_flag=True, help="Run without saving CLI session metadata.")
@click.version_option(__version__)
@click.pass_context
def cli(ctx: click.Context, use_json: bool, session_path: str | None, dry_run: bool) -> None:
    """CLI-Anything harness for the local Windows Jianying Pro app."""

    ctx.ensure_object(dict)
    ctx.obj.update(
        {
            "json": use_json,
            "session": Session(session_path),
            "dry_run": dry_run,
        }
    )
    if ctx.invoked_subcommand is None:
        ctx.invoke(repl)


@cli.command()
@click.pass_context
def locate(ctx: click.Context) -> None:
    """Locate the real Jianying Pro executable."""

    try:
        payload = backend.locate_executable()
        _record(ctx, "locate", {"path": payload["path"], "source": payload["source"]})
        _emit(ctx, payload, f"Jianying Pro: {payload['path']} ({payload['source']})")
    except Exception as exc:
        _handle_error(ctx, exc)


@cli.command()
@click.pass_context
def status(ctx: click.Context) -> None:
    """Show installation, process, window, and draft status."""

    try:
        payload = backend.status()
        _record(
            ctx,
            "status",
            {
                "running": payload["running"],
                "process_count": payload["process_count"],
                "window_count": payload["window_count"],
                "draft_root_count": len(payload["draft_roots"]),
            },
        )
        human = (
            f"running={payload['running']} processes={payload['process_count']} "
            f"windows={payload['window_count']} draft_roots={len(payload['draft_roots'])}"
        )
        _emit(ctx, payload, human)
    except Exception as exc:
        _handle_error(ctx, exc)


@cli.command("windows")
@click.pass_context
def windows_cmd(ctx: click.Context) -> None:
    """List candidate Jianying windows."""

    try:
        payload = backend.list_windows()
        _record(ctx, "windows", {"count": len(payload)})
        _emit(ctx, payload, f"{len(payload)} Jianying window candidate(s)")
    except Exception as exc:
        _handle_error(ctx, exc)


@cli.command()
@click.option("--focus/--no-focus", default=True, help="Focus the app after launch or reuse.")
@click.pass_context
def launch(ctx: click.Context, focus: bool) -> None:
    """Launch Jianying Pro or reuse the running process."""

    try:
        payload = backend.launch(focus=focus)
        _record(
            ctx,
            "launch",
            {
                "already_running": payload.get("already_running", False),
                "pid": payload.get("pid"),
                "process_count": len(payload.get("processes", [])),
            },
        )
        if payload.get("already_running"):
            human = f"Jianying Pro is already running ({len(payload.get('processes', []))} process(es))."
        else:
            human = f"Launched Jianying Pro with pid={payload.get('pid')}."
        _emit(ctx, payload, human)
    except Exception as exc:
        _handle_error(ctx, exc)


@cli.command()
@click.option("--hwnd", type=int, default=None, help="Specific window handle.")
@click.pass_context
def focus(ctx: click.Context, hwnd: int | None) -> None:
    """Focus a Jianying window."""

    try:
        payload = backend.focus_window(hwnd=hwnd)
        _record(ctx, "focus", {"hwnd": payload["hwnd"], "focused": payload["focused"]})
        _emit(ctx, payload, f"focused={payload['focused']} hwnd={payload['hwnd']}")
    except Exception as exc:
        _handle_error(ctx, exc)


@cli.command()
@click.option("-o", "--output", type=click.Path(dir_okay=False), default=None, help="PNG output path.")
@click.option("--hwnd", type=int, default=None, help="Specific window handle.")
@click.option("--focus-first/--no-focus-first", default=True, help="Focus before capture.")
@click.pass_context
def screenshot(ctx: click.Context, output: str | None, hwnd: int | None, focus_first: bool) -> None:
    """Capture the visible Jianying window as PNG."""

    try:
        if output is None:
            stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
            output = str(Path.home() / ".cli_anything" / "jianying" / "screenshots" / f"jianying-{stamp}.png")
        payload = backend.capture_window(output=output, hwnd=hwnd, focus_first=focus_first)
        _record(
            ctx,
            "screenshot",
            {
                "output": payload["output"],
                "width": payload["width"],
                "height": payload["height"],
                "file_size": payload["file_size"],
            },
        )
        _emit(ctx, payload, f"Screenshot: {payload['output']} ({payload['width']}x{payload['height']})")
    except Exception as exc:
        _handle_error(ctx, exc)


@cli.command()
@click.pass_context
def drafts(ctx: click.Context) -> None:
    """List known Jianying local draft roots."""

    try:
        payload = backend.draft_roots()
        _record(ctx, "drafts", {"count": len(payload), "draft_count": sum(item["draft_count"] for item in payload)})
        _emit(ctx, payload, f"{len(payload)} draft root(s)")
    except Exception as exc:
        _handle_error(ctx, exc)


@cli.group("session")
def session_group() -> None:
    """Inspect or edit CLI session metadata."""


@session_group.command("show")
@click.pass_context
def session_show(ctx: click.Context) -> None:
    session: Session = ctx.obj["session"]
    _emit(ctx, {"path": str(session.path), "data": session.data}, f"Session: {session.path}")


@session_group.command("undo")
@click.pass_context
def session_undo(ctx: click.Context) -> None:
    try:
        session: Session = ctx.obj["session"]
        payload = session.undo()
        if not ctx.obj.get("dry_run"):
            session.save()
        _emit(ctx, payload, "Session undo complete.")
    except Exception as exc:
        _handle_error(ctx, exc)


@session_group.command("redo")
@click.pass_context
def session_redo(ctx: click.Context) -> None:
    try:
        session: Session = ctx.obj["session"]
        payload = session.redo()
        if not ctx.obj.get("dry_run"):
            session.save()
        _emit(ctx, payload, "Session redo complete.")
    except Exception as exc:
        _handle_error(ctx, exc)


@cli.command()
@click.pass_context
def repl(ctx: click.Context) -> None:
    """Start a small interactive REPL."""

    if ctx.obj.get("json"):
        _emit(ctx, {"status": "repl_unavailable_in_json_mode"}, "REPL is not available in JSON mode.")
        return

    try:
        from cli_anything.jianying.utils.repl_skin import ReplSkin

        skin = ReplSkin("jianying", version=__version__)
        skin.print_banner()
    except Exception:
        click.echo(f"cli-anything-jianying {__version__}")

    commands = {
        "locate": backend.locate_executable,
        "status": backend.status,
        "windows": backend.list_windows,
        "drafts": backend.draft_roots,
    }
    click.echo("Commands: locate, status, windows, drafts, exit")
    while True:
        try:
            line = input("jianying> ").strip()
        except (EOFError, KeyboardInterrupt):
            click.echo("")
            return
        if not line:
            continue
        if line in {"exit", "quit"}:
            return
        name = shlex.split(line)[0]
        command = commands.get(name)
        if not command:
            click.echo(f"Unknown command: {name}")
            continue
        try:
            payload = command()
            click.echo(json.dumps(payload, ensure_ascii=False, indent=2))
        except Exception as exc:
            click.echo(f"Error: {exc}", err=True)


def main() -> None:
    cli()


if __name__ == "__main__":
    main()
