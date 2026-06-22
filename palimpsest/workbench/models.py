from pathlib import Path
from typing import Literal

import pydantic

from palimpsest.config import Config


class ParserBuildState(pydantic.BaseModel):
    command: str | list[str] | None = None
    cwd: Path | None = None
    outputs: list[Path]


class ParserRuntimeState(pydantic.BaseModel):
    module: Path | None = None
    parse_export: str


class ParserState(pydantic.BaseModel):
    id: str
    adapter: str
    grammar_files: list[Path]
    build: ParserBuildState
    runtime: ParserRuntimeState
    highlight_captures: dict[str, str]


class FiletypeState(pydantic.BaseModel):
    id: str
    extensions: list[str]
    parser: str | None
    grammar_files: list[Path]
    highlight_captures: dict[str, str]


class AppState(pydantic.BaseModel):
    app_name: str = "Palimpsest"
    cwd: Path
    config_path: Path
    examples_dir: Path
    grammar_files: list[Path]
    parsers: list[ParserState]
    filetypes: list[FiletypeState]

    @classmethod
    def from_config(cls, config: Config):
        return cls(
            cwd=config.cwd,
            config_path=config.config_path,
            examples_dir=config.examples_path,
            grammar_files=config.grammar_paths,
            parsers=[
                ParserState(
                    id=parser.id,
                    adapter=parser.adapter,
                    grammar_files=[config.resolve_project_path(path) for path in parser.grammar_files],
                    build=ParserBuildState(
                        command=parser.build.display_command(),
                        cwd=config.resolve_project_path(parser.build.cwd) if parser.build.cwd else None,
                        outputs=[config.resolve_project_path(path) for path in parser.build.outputs],
                    ),
                    runtime=ParserRuntimeState(
                        module=config.resolve_project_path(parser.runtime.module) if parser.runtime.module else None,
                        parse_export=parser.runtime.parse_export,
                    ),
                    highlight_captures=parser.highlight_captures,
                )
                for parser in config.parser_configs
            ],
            filetypes=[
                FiletypeState(
                    id=filetype.id,
                    extensions=filetype.extensions,
                    parser=filetype.parser,
                    grammar_files=[config.resolve_project_path(path) for path in filetype.grammar_files],
                    highlight_captures=filetype.highlight_captures,
                )
                for filetype in config.filetype_configs
            ],
        )


class FileEntry(pydantic.BaseModel):
    name: str
    path: str
    kind: Literal["directory", "file"]
    size: int | None = None
    suffix: str = ""


class DirectoryListing(pydantic.BaseModel):
    cwd: Path
    path: str
    absolute_path: Path
    entries: list[FileEntry]


class FileContent(pydantic.BaseModel):
    cwd: Path
    path: str
    absolute_path: Path
    name: str
    suffix: str
    size: int
    content: str


class GrammarFile(pydantic.BaseModel):
    name: str
    path: str
    absolute_path: Path
    adapter: str
    suffix: str
    size: int
    parser: str | None = None
