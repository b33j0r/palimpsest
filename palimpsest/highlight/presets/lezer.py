from pathlib import Path

from palimpsest.highlight.config import BuildPreset, ParserBuildConfig, ParserConfig


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
