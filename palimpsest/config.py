from pathlib import Path
import tomllib
from typing import Any

import pydantic


DEFAULT_CWD = Path("~/Projects/moneyscheme").expanduser()


class ParserBuildConfig(pydantic.BaseModel):
    command: str | list[str] | None = None
    cwd: Path | None = None
    outputs: list[Path] = pydantic.Field(default_factory=list)


class ParserConfig(pydantic.BaseModel):
    id: str = ""
    adapter: str = "pest"
    grammar_files: list[Path] = pydantic.Field(default_factory=list)
    build: ParserBuildConfig = pydantic.Field(default_factory=ParserBuildConfig)
    highlight_captures: dict[str, str] = pydantic.Field(default_factory=dict)


class FiletypeConfig(pydantic.BaseModel):
    id: str = ""
    extensions: list[str] = pydantic.Field(default_factory=list)
    parser: str | None = None
    grammar_files: list[Path] = pydantic.Field(default_factory=list)
    highlight_captures: dict[str, str] = pydantic.Field(default_factory=dict)


class ProjectConfig(pydantic.BaseModel):
    examples_dir: Path = Path("examples")
    grammar_files: list[Path] = pydantic.Field(default_factory=list)
    parsers: list[ParserConfig] = pydantic.Field(default_factory=list)
    filetypes: list[FiletypeConfig] = pydantic.Field(default_factory=list)

    @pydantic.model_validator(mode="before")
    @classmethod
    def flatten_named_tables(cls, data: Any):
        if not isinstance(data, dict):
            return data

        normalized = dict(data)
        for key in ("parsers", "filetypes"):
            normalized[key] = _flatten_named_config_table(normalized.get(key), key[:-1])
        return normalized


class Config(pydantic.BaseModel):
    model_config = pydantic.ConfigDict(validate_assignment=True)

    cwd: Path = DEFAULT_CWD
    config_path: Path | None = None
    project: ProjectConfig = pydantic.Field(default_factory=ProjectConfig)

    @pydantic.field_validator("cwd", "config_path", mode="before")
    @classmethod
    def expand_path(cls, value):
        if value is None:
            return value
        return Path(value).expanduser()

    @pydantic.model_validator(mode="after")
    def resolve_paths(self):
        object.__setattr__(self, "cwd", self.cwd.resolve())
        if self.config_path is None:
            object.__setattr__(self, "config_path", self.cwd / "palimpsest.toml")
        else:
            object.__setattr__(self, "config_path", self.config_path.resolve())
        return self

    @property
    def examples_path(self) -> Path:
        return self.resolve_project_path(self.project.examples_dir)

    @property
    def grammar_paths(self) -> list[Path]:
        grammar_files = list(self.project.grammar_files)
        for parser in self.project.parsers:
            grammar_files.extend(parser.grammar_files)
        for filetype in self.project.filetypes:
            grammar_files.extend(filetype.grammar_files)
        return [self.resolve_project_path(path) for path in grammar_files]

    @property
    def parser_configs(self) -> list[ParserConfig]:
        return self.project.parsers

    @property
    def filetype_configs(self) -> list[FiletypeConfig]:
        return self.project.filetypes

    def resolve_project_path(self, path: Path | str) -> Path:
        candidate = Path(path).expanduser()
        if not candidate.is_absolute():
            candidate = self.cwd / candidate
        return candidate.resolve()

    def relative_to_cwd(self, path: Path) -> str:
        return path.resolve().relative_to(self.cwd).as_posix()


def get_config(**overrides) -> Config:
    cwd = overrides.pop("cwd", DEFAULT_CWD)
    config_path = overrides.pop("config_path", None)
    config = Config(cwd=cwd, config_path=config_path)

    if config.config_path and config.config_path.exists():
        with config.config_path.open("rb") as config_file:
            data = tomllib.load(config_file)
        config = Config(
            cwd=overrides.pop("cwd", config.cwd),
            config_path=overrides.pop("config_path", config.config_path),
            project=ProjectConfig.model_validate(data),
            **overrides,
        )
    elif overrides:
        config = config.model_copy(update=overrides)

    return config


def _flatten_named_config_table(value: Any, fallback_prefix: str) -> list[dict[str, Any]]:
    if value is None:
        return []
    if isinstance(value, list):
        return [dict(item) for item in value if isinstance(item, dict)]
    if not isinstance(value, dict):
        return []

    flattened = []
    for name, entries in value.items():
        if isinstance(entries, list):
            named_entries = entries
        elif isinstance(entries, dict):
            named_entries = [entries]
        else:
            continue

        for index, entry in enumerate(named_entries):
            if not isinstance(entry, dict):
                continue
            normalized = dict(entry)
            normalized.setdefault("id", name if index == 0 else f"{name}-{index + 1}")
            flattened.append(normalized)

    if not flattened and value:
        normalized = dict(value)
        normalized.setdefault("id", fallback_prefix)
        return [normalized]
    return flattened
