import os
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


class CargoWasmBindgenBuildPreset(BuildPreset):
    id = "cargo-wasm-bindgen"
    dependencies = ("cargo", "wasm-bindgen")

    def resolve(self, parser: ParserConfig) -> None:
        build = parser.build
        if not build.package:
            raise ValueError(
                f"Parser {parser.id!r} uses cargo-wasm-bindgen build preset without package"
            )

        profile = "release" if build.release else build.profile
        artifact_name = build.package.replace("-", "_")
        if build.wasm is None:
            build.wasm = Path("target") / build.target / profile / f"{artifact_name}.wasm"
        if build.out_dir is None:
            build.out_dir = Path("target") / "palimpsest" / parser.id

        generated_outputs = [
            build.out_dir / f"{build.out_name}.js",
            build.out_dir / f"{build.out_name}_bg.wasm",
        ]
        self.add_outputs(build, generated_outputs)

        if parser.runtime.module is None:
            parser.runtime.module = generated_outputs[0]

    def commands(self, build: ParserBuildConfig) -> list[list[str]]:
        if not build.package:
            raise ValueError("cargo-wasm-bindgen build preset requires package")
        if build.wasm is None:
            raise ValueError("cargo-wasm-bindgen build preset requires wasm")
        if build.out_dir is None:
            raise ValueError("cargo-wasm-bindgen build preset requires out_dir")

        cargo = ["cargo", "build", "-p", build.package, "--target", build.target]
        if build.release:
            cargo.append("--release")

        bindgen = [
            "wasm-bindgen",
            "--target",
            "web",
            "--out-dir",
            build.out_dir.as_posix(),
            "--out-name",
            build.out_name,
            build.wasm.as_posix(),
        ]
        return [cargo, bindgen]


class LezerBuildPreset(BuildPreset):
    id = "lezer"
    dependencies = ("npx",)

    def resolve(self, parser: ParserConfig) -> None:
        build = parser.build
        if not parser.grammar_files:
            raise ValueError(f"Parser {parser.id!r} uses lezer build preset without grammar_files")

        if build.grammar is None:
            build.grammar = parser.grammar_files[0]
        if build.out_dir is None:
            build.out_dir = Path("target") / "palimpsest" / parser.id

        generated_outputs = [
            build.out_dir / f"{build.out_name}.generated.js",
            build.out_dir / f"{build.out_name}.generated.terms.js",
            build.out_dir / f"{build.out_name}.js",
        ]
        self.add_outputs(build, generated_outputs)

        if parser.runtime.module is None:
            parser.runtime.module = generated_outputs[-1]
        if parser.runtime.parse_export == "parse_to_json":
            parser.runtime.parse_export = build.export_name

    def commands(self, build: ParserBuildConfig) -> list[list[str]]:
        if build.grammar is None:
            raise ValueError("lezer build preset requires grammar file")
        if build.out_dir is None:
            raise ValueError("lezer build preset requires out_dir")

        generated = build.out_dir / f"{build.out_name}.generated.js"
        module = build.out_dir / f"{build.out_name}.js"
        return [
            ["mkdir", "-p", build.out_dir.as_posix()],
            [
                "npx",
                "lezer-generator",
                "--output",
                generated.as_posix(),
                "--export",
                build.export_name,
                build.grammar.as_posix(),
            ],
            [
                "npx",
                "esbuild",
                generated.as_posix(),
                "--bundle",
                "--format=esm",
                f"--outfile={module.as_posix()}",
            ],
        ]


class TreeSitterBuildPreset(BuildPreset):
    id = "tree-sitter"
    dependencies = ("npx",)

    def resolve(self, parser: ParserConfig) -> None:
        build = parser.build
        if not parser.grammar_files:
            raise ValueError(
                f"Parser {parser.id!r} uses tree-sitter build preset without grammar_files"
            )

        if build.grammar is None:
            build.grammar = parser.grammar_files[0]
        if build.out_dir is None:
            build.out_dir = Path("target") / "palimpsest" / parser.id

        generated_outputs = [
            build.grammar.parent / "src" / "parser.c",
            build.grammar.parent / "src" / "grammar.json",
            build.grammar.parent / "src" / "node-types.json",
            build.out_dir / f"{build.out_name}.wasm",
            build.out_dir / f"{build.out_name}.js",
            build.out_dir / "web-tree-sitter.wasm",
        ]
        self.add_outputs(build, generated_outputs)

        if parser.runtime.module is None:
            parser.runtime.module = build.out_dir / f"{build.out_name}.js"
        if parser.runtime.parse_export == "parse_to_json":
            parser.runtime.parse_export = "createTreeSitterRuntime"

    def commands(self, build: ParserBuildConfig) -> list[list[str]]:
        if build.grammar is None:
            raise ValueError("tree-sitter build preset requires grammar file")
        if build.out_dir is None:
            raise ValueError("tree-sitter build preset requires out_dir")

        parser_wasm = build.out_dir / f"{build.out_name}.wasm"
        module = build.out_dir / f"{build.out_name}.js"
        engine_wasm = build.out_dir / "web-tree-sitter.wasm"
        grammar_dir = build.grammar.parent
        grammar_name = build.grammar.name
        grammar_parser_wasm = Path(os.path.relpath(parser_wasm, grammar_dir)).as_posix()
        return [
            ["mkdir", "-p", build.out_dir.as_posix()],
            [
                "sh",
                "-c",
                f"cd {shlex.quote(grammar_dir.as_posix())} && "
                f"npx tree-sitter generate {shlex.quote(grammar_name)}",
            ],
            [
                "sh",
                "-c",
                f"cd {shlex.quote(grammar_dir.as_posix())} && "
                f"npx tree-sitter build --wasm -o {shlex.quote(grammar_parser_wasm)} .",
            ],
            [
                "npx",
                "esbuild",
                "palimpsest/static/js/highlight/tree_sitter_runtime_entry.mjs",
                "--bundle",
                "--format=esm",
                "--outfile=" + module.as_posix(),
                "--external:fs",
                "--external:module",
                "--external:node:module",
            ],
            [
                "cp",
                "node_modules/web-tree-sitter/web-tree-sitter.wasm",
                engine_wasm.as_posix(),
            ],
        ]


BUILD_PRESETS = BuildPresetRegistry()
BUILD_PRESETS.register(CargoWasmBindgenBuildPreset())
BUILD_PRESETS.register(LezerBuildPreset())
BUILD_PRESETS.register(TreeSitterBuildPreset())
