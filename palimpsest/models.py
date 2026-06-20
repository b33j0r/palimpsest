from pathlib import Path
from typing import Literal

import pydantic

from palimpsest.config import Config


class AppState(pydantic.BaseModel):
    app_name: str = "Palimpsest"
    cwd: Path
    config_path: Path
    examples_dir: Path
    grammar_files: list[Path]

    @classmethod
    def from_config(cls, config: Config):
        return cls(
            cwd=config.cwd,
            config_path=config.config_path,
            examples_dir=config.examples_path,
            grammar_files=config.grammar_paths,
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
