from pathlib import Path

from palimpsest.highlight.config import BuildPreset, ParserBuildConfig, ParserConfig


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
