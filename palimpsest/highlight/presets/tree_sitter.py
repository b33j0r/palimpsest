import os
import shlex
from pathlib import Path

from palimpsest.highlight.config import BuildPreset, ParserBuildConfig, ParserConfig


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
