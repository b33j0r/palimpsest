from __future__ import annotations

import shutil
import shlex
import subprocess
import time
from pathlib import Path
from typing import Any

from palimpsest.config import Config
from palimpsest.highlight.config import BUILD_PRESETS


def project_highlight_health(config: Config) -> dict[str, Any]:
    parsers = [highlighter_health(config, parser) for parser in config.parser_configs]
    dependency_items = dependency_checks(config)
    return {
        "ok": all(parser["ok"] for parser in parsers) and all(
            check["ok"] for check in dependency_items
        ),
        "parsers": parsers,
        "dependencies": dependency_items,
    }


def highlighter_health(config: Config, parser) -> dict[str, Any]:
    grammar_files = [path_health(config, path, expected="file") for path in parser.grammar_files]
    runtime = None
    if parser.runtime.module is not None:
        runtime = path_health(config, parser.runtime.module, expected="file")

    outputs = [output_state(config, path) for path in parser_outputs(parser)]
    build_ready = not parser.build.has_build or all(
        check["ok"] for check in dependencies_for_build(parser)
    )
    ok = all(item["ok"] for item in grammar_files) and build_ready
    if runtime is not None:
        ok = ok and runtime["ok"]

    return {
        "id": parser.id,
        "adapter": parser.adapter,
        "ok": ok,
        "build_configured": parser.build.has_build,
        "build_command": parser.build.display_command(),
        "grammar_files": grammar_files,
        "runtime": runtime,
        "outputs": outputs,
    }


def path_health(
    config: Config,
    path: Path | str,
    *,
    expected: str,
    project_relative: bool = True,
) -> dict[str, Any]:
    target = config.resolve_project_path(path) if project_relative else Path(path).resolve()
    exists = target.exists()
    if expected == "directory":
        ok = target.is_dir()
    elif expected == "file":
        ok = target.is_file()
    else:
        ok = exists

    try:
        relative_path = config.relative_to_cwd(target)
    except ValueError:
        relative_path = target.as_posix()

    return {
        "ok": ok,
        "path": relative_path,
        "absolute_path": target.as_posix(),
        "exists": exists,
        "expected": expected,
    }


def dependency_checks(config: Config) -> list[dict[str, Any]]:
    checks = []
    seen = set()
    for parser in config.parser_configs:
        for check in dependencies_for_build(parser):
            key = check["name"]
            if key in seen:
                continue
            seen.add(key)
            checks.append(check)
    return checks


def dependencies_for_build(parser) -> list[dict[str, Any]]:
    names = list(BUILD_PRESETS.dependencies_for(parser.build.preset))
    if not names and isinstance(parser.build.command, list) and parser.build.command:
        names = [parser.build.command[0]]

    return [
        {
            "name": name,
            "ok": shutil.which(name) is not None,
            "path": shutil.which(name),
            "reason": f"Required by highlighter build preset {parser.build.preset!r}"
            if parser.build.preset
            else "Required by highlighter build command",
        }
        for name in names
    ]


def find_parser_config(config: Config, parser_id: str):
    return next((parser for parser in config.parser_configs if parser.id == parser_id), None)


def build_highlighter(config: Config, parser_id: str, *, timeout: int = 120) -> tuple[dict[str, Any], int]:
    parser = find_parser_config(config, parser_id)
    if parser is None:
        return {"ok": False, "message": "Parser is not configured"}, 404
    if not parser.build.has_build:
        return {"ok": False, "message": "Parser does not declare a build command"}, 400

    cwd = config.resolve_project_path(parser.build.cwd) if parser.build.cwd else config.cwd
    ensure_inside_cwd(config, cwd)

    command = parser.build.display_command()
    started = time.perf_counter()
    try:
        completed = run_highlighter_build(parser, cwd, timeout=timeout)
    except subprocess.TimeoutExpired as error:
        elapsed_ms = round((time.perf_counter() - started) * 1000)
        return {
            "ok": False,
            "parser": parser.id,
            "command": command if isinstance(command, str) else shlex.join(command),
            "cwd": cwd.as_posix(),
            "elapsed_ms": elapsed_ms,
            "returncode": None,
            "stdout": error.stdout or "",
            "stderr": f"Build timed out after {error.timeout} seconds.",
            "outputs": [output_state(config, path) for path in parser_outputs(parser)],
        }, 504
    except FileNotFoundError as error:
        elapsed_ms = round((time.perf_counter() - started) * 1000)
        return {
            "ok": False,
            "parser": parser.id,
            "command": command if isinstance(command, str) else shlex.join(command),
            "cwd": cwd.as_posix(),
            "elapsed_ms": elapsed_ms,
            "returncode": None,
            "stdout": "",
            "stderr": str(error),
            "outputs": [output_state(config, path) for path in parser_outputs(parser)],
        }, 500

    elapsed_ms = round((time.perf_counter() - started) * 1000)
    outputs = [output_state(config, path) for path in parser_outputs(parser)]
    return {
        "ok": completed.returncode == 0,
        "parser": parser.id,
        "command": command if isinstance(command, str) else shlex.join(command),
        "cwd": cwd.as_posix(),
        "elapsed_ms": elapsed_ms,
        "returncode": completed.returncode,
        "stdout": completed.stdout,
        "stderr": completed.stderr,
        "outputs": outputs,
    }, 200


def ensure_inside_cwd(config: Config, target: Path) -> None:
    target.relative_to(config.cwd)


def run_highlighter_build(parser, cwd: Path, *, timeout: int = 120) -> subprocess.CompletedProcess:
    if parser.build.command is not None:
        command = parser.build.command
        return subprocess.run(
            command if isinstance(command, list) else command,
            cwd=cwd,
            shell=isinstance(command, str),
            text=True,
            capture_output=True,
            timeout=timeout,
        )

    stdout = []
    stderr = []
    returncode = 0
    for command in parser.build.preset_commands():
        completed = subprocess.run(
            command,
            cwd=cwd,
            shell=False,
            text=True,
            capture_output=True,
            timeout=timeout,
        )
        stdout.append(completed.stdout)
        stderr.append(completed.stderr)
        returncode = completed.returncode
        if completed.returncode != 0:
            break

    return subprocess.CompletedProcess(
        args=parser.build.display_command(),
        returncode=returncode,
        stdout="".join(stdout),
        stderr="".join(stderr),
    )


def parser_outputs(parser) -> list[Path]:
    outputs = list(parser.build.outputs)
    if parser.runtime.module is not None and parser.runtime.module not in outputs:
        outputs.append(parser.runtime.module)
    return outputs


def output_state(config: Config, path: Path) -> dict[str, Any]:
    target = config.resolve_project_path(path)
    return {
        "path": target.as_posix(),
        "exists": target.exists(),
        "size": target.stat().st_size if target.exists() and target.is_file() else None,
    }
