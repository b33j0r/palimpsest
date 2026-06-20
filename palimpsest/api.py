from pathlib import Path
from typing import NamedTuple

from flask import Blueprint, abort, jsonify, request

from palimpsest.config import Config
from palimpsest.models import AppState, DirectoryListing, FileContent, FileEntry, GrammarFile


GRAMMAR_ADAPTERS = (
    {
        "id": "pest",
        "extensions": {".pest"},
        "filenames": set(),
    },
    {
        "id": "tree-sitter",
        "extensions": {".scm"},
        "filenames": {"grammar.js", "grammar.json"},
    },
    {
        "id": "lezer",
        "extensions": {".grammar"},
        "filenames": set(),
    },
)


class GrammarCandidate(NamedTuple):
    path: Path
    adapter: str | None = None
    parser: str | None = None


def create_api_blueprint(config: Config):
    blueprint = Blueprint("api", __name__, url_prefix="/api")

    @blueprint.get("/state")
    def state():
        return jsonify(AppState.from_config(config).model_dump(mode="json"))

    @blueprint.get("/files")
    def files():
        relative_path = request.args.get("path")
        target = _resolve_browser_path(config, relative_path)
        if not target.exists():
            abort(404, description="Path does not exist")
        if not target.is_dir():
            abort(400, description="Path is not a directory")

        listing = DirectoryListing(
            cwd=config.cwd,
            path=config.relative_to_cwd(target),
            absolute_path=target,
            entries=_list_entries(config, target),
        )
        return jsonify(listing.model_dump(mode="json"))

    @blueprint.get("/file")
    def file():
        relative_path = request.args.get("path")
        if not relative_path:
            abort(400, description="Missing path")

        target = _resolve_browser_path(config, relative_path)
        if not target.exists():
            abort(404, description="Path does not exist")
        if not target.is_file():
            abort(400, description="Path is not a file")

        return jsonify(_read_file(config, target).model_dump(mode="json"))

    @blueprint.put("/file")
    def save_file():
        payload = request.get_json(silent=True) or {}
        relative_path = payload.get("path")
        content = payload.get("content")

        if not relative_path:
            abort(400, description="Missing path")
        if not isinstance(content, str):
            abort(400, description="Missing content")

        target = _resolve_browser_path(config, relative_path)
        if not target.exists():
            abort(404, description="Path does not exist")
        if not target.is_file():
            abort(400, description="Path is not a file")

        target.write_text(content)
        return jsonify(_read_file(config, target).model_dump(mode="json"))

    @blueprint.get("/grammars")
    def grammars():
        grammar_files = [
            GrammarFile(
                name=path.name,
                path=config.relative_to_cwd(path),
                absolute_path=path,
                adapter=candidate.adapter or _detect_grammar_adapter(path),
                suffix=path.suffix,
                size=path.stat().st_size,
                parser=candidate.parser,
            )
            for candidate in _iter_grammar_files(config)
            for path in (candidate.path,)
        ]
        return jsonify([grammar.model_dump(mode="json") for grammar in grammar_files])

    return blueprint


def _read_file(config: Config, target: Path) -> FileContent:
    try:
        content = target.read_text()
    except UnicodeDecodeError:
        abort(415, description="File is not valid text")

    return FileContent(
        cwd=config.cwd,
        path=config.relative_to_cwd(target),
        absolute_path=target,
        name=target.name,
        suffix=target.suffix,
        size=target.stat().st_size,
        content=content,
    )


def _iter_grammar_files(config: Config):
    seen: set[Path] = set()
    for source in _iter_grammar_sources(config):
        for path in _iter_source_paths(config, source.path):
            if path in seen:
                continue
            seen.add(path)
            adapter = source.adapter or _detect_grammar_adapter(path)
            if adapter == "plain":
                continue
            yield GrammarCandidate(path=path, adapter=adapter, parser=source.parser)


def _iter_grammar_sources(config: Config):
    for path in config.project.grammar_files:
        yield GrammarCandidate(path=config.resolve_project_path(path))
    for parser in config.parser_configs:
        for path in parser.grammar_files:
            yield GrammarCandidate(
                path=config.resolve_project_path(path),
                adapter=parser.adapter,
                parser=parser.id,
            )
    for filetype in config.filetype_configs:
        parser_id = filetype.parser or filetype.id
        for path in filetype.grammar_files:
            yield GrammarCandidate(
                path=config.resolve_project_path(path),
                adapter="pest",
                parser=parser_id,
            )


def _iter_source_paths(config: Config, source: Path):
    if _has_glob(source):
        root = _glob_root(source)
        _ensure_inside_cwd(config, root)
        pattern = source.relative_to(root).as_posix()
        candidates = sorted(root.glob(pattern), key=lambda path: config.relative_to_cwd(path).casefold())
        return [path for path in candidates if path.is_file()]

    _ensure_inside_cwd(config, source)
    if source.is_file():
        return [source]
    if source.is_dir():
        return sorted(
            (path for path in source.rglob("*") if path.is_file()),
            key=lambda path: config.relative_to_cwd(path).casefold(),
        )
    return []


def _detect_grammar_adapter(path: Path) -> str:
    for adapter in GRAMMAR_ADAPTERS:
        if path.name in adapter["filenames"] or path.suffix in adapter["extensions"]:
            return adapter["id"]
    return "plain"


def _is_supported_grammar_file(path: Path) -> bool:
    return _detect_grammar_adapter(path) != "plain"


def _has_glob(path: Path) -> bool:
    return any(char in path.as_posix() for char in "*?[")


def _glob_root(path: Path) -> Path:
    parts = path.parts
    root_parts = []
    for part in parts:
        if any(char in part for char in "*?["):
            break
        root_parts.append(part)
    if not root_parts:
        return Path(".")
    return Path(*root_parts)


def _ensure_inside_cwd(config: Config, target: Path) -> None:
    try:
        target.relative_to(config.cwd)
    except ValueError:
        abort(400, description="Path must stay inside the configured cwd")


def _resolve_browser_path(config: Config, relative_path: str | None) -> Path:
    if relative_path:
        target = config.resolve_project_path(relative_path)
    else:
        target = config.examples_path

    _ensure_inside_cwd(config, target)
    return target


def _list_entries(config: Config, directory: Path) -> list[FileEntry]:
    entries = []
    for path in sorted(directory.iterdir(), key=_file_sort_key):
        stat = path.stat()
        entries.append(
            FileEntry(
                name=path.name,
                path=config.relative_to_cwd(path),
                kind="directory" if path.is_dir() else "file",
                size=None if path.is_dir() else stat.st_size,
                suffix=path.suffix,
            )
        )
    return entries


def _file_sort_key(path: Path):
    return (not path.is_dir(), path.name.casefold())
