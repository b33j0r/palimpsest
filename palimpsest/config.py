from pathlib import Path
import tomllib

import pydantic


DEFAULT_CWD = Path("~/Projects/moneyscheme").expanduser()


class ProjectConfig(pydantic.BaseModel):
    examples_dir: Path = Path("examples")
    grammar_files: list[Path] = pydantic.Field(default_factory=list)


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
        return [self.resolve_project_path(path) for path in self.project.grammar_files]

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
