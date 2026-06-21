import os
import shlex
import tomllib
from pathlib import Path
from typing import Any, Literal

import pydantic


class ParserBuildConfig(pydantic.BaseModel):
    command: str | list[str] | None = None
    preset: Literal["cargo-wasm-bindgen", "lezer", "tree-sitter"] | None = None
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
        if self.preset == "cargo-wasm-bindgen":
            if not self.package:
                raise ValueError("cargo-wasm-bindgen build preset requires package")
            if self.wasm is None:
                raise ValueError("cargo-wasm-bindgen build preset requires wasm")
            if self.out_dir is None:
                raise ValueError("cargo-wasm-bindgen build preset requires out_dir")

            cargo = ["cargo", "build", "-p", self.package, "--target", self.target]
            if self.release:
                cargo.append("--release")

            bindgen = [
                "wasm-bindgen",
                "--target",
                "web",
                "--out-dir",
                self.out_dir.as_posix(),
                "--out-name",
                self.out_name,
                self.wasm.as_posix(),
            ]
            return [cargo, bindgen]

        if self.preset == "lezer":
            if self.grammar is None:
                raise ValueError("lezer build preset requires grammar file")
            if self.out_dir is None:
                raise ValueError("lezer build preset requires out_dir")

            generated = self.out_dir / f"{self.out_name}.generated.js"
            module = self.out_dir / f"{self.out_name}.js"
            return [
                ["mkdir", "-p", self.out_dir.as_posix()],
                [
                    "npx",
                    "lezer-generator",
                    "--output",
                    generated.as_posix(),
                    "--export",
                    self.export_name,
                    self.grammar.as_posix(),
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

        if self.preset == "tree-sitter":
            if self.grammar is None:
                raise ValueError("tree-sitter build preset requires grammar file")
            if self.out_dir is None:
                raise ValueError("tree-sitter build preset requires out_dir")

            parser_wasm = self.out_dir / f"{self.out_name}.wasm"
            module = self.out_dir / f"{self.out_name}.js"
            engine_wasm = self.out_dir / "web-tree-sitter.wasm"
            grammar_dir = self.grammar.parent
            grammar_name = self.grammar.name
            grammar_parser_wasm = Path(os.path.relpath(parser_wasm, grammar_dir)).as_posix()
            return [
                ["mkdir", "-p", self.out_dir.as_posix()],
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

        return []

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


class ProjectConfig(pydantic.BaseModel):
    examples_dir: Path = Path("examples")
    grammar_files: list[Path] = pydantic.Field(default_factory=list)
    capture_maps: dict[str, dict[str, str]] = pydantic.Field(default_factory=dict)
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

    @pydantic.model_validator(mode="after")
    def resolve_highlight_captures(self):
        parser_captures = {}
        for parser in self.parsers:
            captures = self._resolve_capture_reference(
                parser.highlight_captures,
                f"parser {parser.id}",
            )
            parser.highlight_captures = captures
            parser_captures[parser.id] = captures

        for filetype in self.filetypes:
            parser_id = filetype.parser or filetype.id
            inherited = dict(parser_captures.get(parser_id, {}))
            captures = self._resolve_capture_reference(
                filetype.highlight_captures,
                f"filetype {filetype.id}",
            )
            inherited.update(captures)
            filetype.highlight_captures = inherited

        return self

    @pydantic.model_validator(mode="after")
    def resolve_build_presets(self):
        for parser in self.parsers:
            if parser.build.preset == "cargo-wasm-bindgen":
                _resolve_cargo_wasm_bindgen_build(parser)
            elif parser.build.preset == "lezer":
                _resolve_lezer_build(parser)
            elif parser.build.preset == "tree-sitter":
                _resolve_tree_sitter_build(parser)
        return self

    def _resolve_capture_reference(
        self,
        value: dict[str, str] | str | None,
        owner: str,
    ) -> dict[str, str]:
        if value is None:
            return {}
        if isinstance(value, str):
            if value not in self.capture_maps:
                raise ValueError(f"Unknown capture map {value!r} referenced by {owner}")
            return dict(self.capture_maps[value])
        return dict(value)


class Config(pydantic.BaseModel):
    model_config = pydantic.ConfigDict(validate_assignment=True)

    cwd: Path = Path.cwd()
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
    config_path = overrides.pop("config_path", None)
    cwd = overrides.pop("cwd", None)
    config = Config(cwd=cwd or Path.cwd(), config_path=config_path)

    if config_path is not None and cwd is None:
        config = Config(cwd=config.config_path.parent, config_path=config.config_path)

    if config.config_path and config.config_path.exists():
        with config.config_path.open("rb") as config_file:
            data = tomllib.load(config_file)
        config = Config(
            cwd=config.cwd,
            config_path=config.config_path,
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


def _resolve_cargo_wasm_bindgen_build(parser: ParserConfig):
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
    for output in generated_outputs:
        if output not in build.outputs:
            build.outputs.append(output)

    if parser.runtime.module is None:
        parser.runtime.module = generated_outputs[0]


def _resolve_lezer_build(parser: ParserConfig):
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
    for output in generated_outputs:
        if output not in build.outputs:
            build.outputs.append(output)

    if parser.runtime.module is None:
        parser.runtime.module = generated_outputs[-1]
    if parser.runtime.parse_export == "parse_to_json":
        parser.runtime.parse_export = build.export_name


def _resolve_tree_sitter_build(parser: ParserConfig):
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
    for output in generated_outputs:
        if output not in build.outputs:
            build.outputs.append(output)

    if parser.runtime.module is None:
        parser.runtime.module = build.out_dir / f"{build.out_name}.js"
    if parser.runtime.parse_export == "parse_to_json":
        parser.runtime.parse_export = "createTreeSitterRuntime"
