import shlex
from abc import ABC, abstractmethod
from pathlib import Path

import pydantic


class ParserBuildConfig(pydantic.BaseModel):
    command: str | list[str] | None = None
    preset: str | None = None
    package: str | None = None
    target: str = "wasm32-unknown-unknown"
    profile: str = "debug"
    release: bool = False
    grammar: Path | None = None
    wasm: Path | None = None
    out_dir: Path | None = None
    out_name: str = "parser"
    export_name: str = "parser"
    cwd: Path | None = None
    outputs: list[Path] = pydantic.Field(default_factory=list)

    @property
    def has_build(self) -> bool:
        return self.command is not None or self.preset is not None

    def preset_commands(self) -> list[list[str]]:
        if not self.preset:
            return []
        return BUILD_PRESETS.get(self.preset).commands(self)

    def display_command(self) -> str | list[str] | None:
        if self.command is not None:
            return self.command
        commands = self.preset_commands()
        if commands:
            return " && ".join(shlex.join(command) for command in commands)
        return None


class ParserRuntimeConfig(pydantic.BaseModel):
    module: Path | None = None
    parse_export: str = "parse_to_json"


class ParserConfig(pydantic.BaseModel):
    id: str = ""
    adapter: str = "pest"
    grammar_files: list[Path] = pydantic.Field(default_factory=list)
    build: ParserBuildConfig = pydantic.Field(default_factory=ParserBuildConfig)
    runtime: ParserRuntimeConfig = pydantic.Field(default_factory=ParserRuntimeConfig)
    highlight_captures: dict[str, str] | str | None = None


class FiletypeConfig(pydantic.BaseModel):
    id: str = ""
    extensions: list[str] = pydantic.Field(default_factory=list)
    parser: str | None = None
    grammar_files: list[Path] = pydantic.Field(default_factory=list)
    highlight_captures: dict[str, str] | str | None = None


class CaptureMapResolver:
    def __init__(self, capture_maps: dict[str, dict[str, str]]):
        self.capture_maps = capture_maps

    def resolve(self, value: dict[str, str] | str | None, owner: str) -> dict[str, str]:
        if value is None:
            return {}
        if isinstance(value, str):
            if value not in self.capture_maps:
                raise ValueError(f"Unknown capture map {value!r} referenced by {owner}")
            return dict(self.capture_maps[value])
        return dict(value)


class BuildPreset(ABC):
    id: str
    dependencies: tuple[str, ...] = ()

    @abstractmethod
    def resolve(self, parser: ParserConfig) -> None:
        raise NotImplementedError

    @abstractmethod
    def commands(self, build: ParserBuildConfig) -> list[list[str]]:
        raise NotImplementedError

    def add_outputs(self, build: ParserBuildConfig, outputs: list[Path]) -> None:
        for output in outputs:
            if output not in build.outputs:
                build.outputs.append(output)


class BuildPresetRegistry:
    def __init__(self):
        self._presets: dict[str, BuildPreset] = {}

    def register(self, preset: BuildPreset) -> BuildPreset:
        self._presets[preset.id] = preset
        return preset

    def get(self, preset_id: str) -> BuildPreset:
        try:
            return self._presets[preset_id]
        except KeyError:
            raise ValueError(f"Unknown build preset {preset_id!r}") from None

    def dependencies_for(self, preset_id: str | None) -> tuple[str, ...]:
        if not preset_id:
            return ()
        return self.get(preset_id).dependencies


BUILD_PRESETS = BuildPresetRegistry()
