import unittest

import pydantic

from palimpsest.config import ProjectConfig


class HighlightCaptureConfigTests(unittest.TestCase):
    def test_inline_capture_maps_still_work(self):
        config = ProjectConfig.model_validate({
            "parsers": {
                "demo": {
                    "highlight_captures": {"symbol": "variable"},
                },
            },
        })

        self.assertEqual(config.parsers[0].highlight_captures, {"symbol": "variable"})

    def test_named_capture_map_references_resolve(self):
        config = ProjectConfig.model_validate({
            "capture_maps": {
                "demo": {"symbol": "variable"},
            },
            "parsers": {
                "demo": {
                    "highlight_captures": "demo",
                },
            },
        })

        self.assertEqual(config.parsers[0].highlight_captures, {"symbol": "variable"})

    def test_filetypes_inherit_parser_captures(self):
        config = ProjectConfig.model_validate({
            "capture_maps": {
                "demo": {"symbol": "variable"},
            },
            "parsers": {
                "demo": {
                    "highlight_captures": "demo",
                },
            },
            "filetypes": {
                "demo": {
                    "extensions": ["*.demo"],
                    "parser": "demo",
                },
            },
        })

        self.assertEqual(config.filetypes[0].highlight_captures, {"symbol": "variable"})

    def test_filetypes_can_inherit_by_matching_id(self):
        config = ProjectConfig.model_validate({
            "parsers": {
                "demo": {
                    "highlight_captures": {"symbol": "variable"},
                },
            },
            "filetypes": {
                "demo": {
                    "extensions": ["*.demo"],
                },
            },
        })

        self.assertEqual(config.filetypes[0].highlight_captures, {"symbol": "variable"})

    def test_filetype_captures_extend_parser_captures(self):
        config = ProjectConfig.model_validate({
            "parsers": {
                "demo": {
                    "highlight_captures": {"symbol": "variable"},
                },
            },
            "filetypes": {
                "demo": {
                    "extensions": ["*.demo"],
                    "parser": "demo",
                    "highlight_captures": {"handler": "function"},
                },
            },
        })

        self.assertEqual(
            config.filetypes[0].highlight_captures,
            {"symbol": "variable", "handler": "function"},
        )

    def test_unknown_capture_map_reference_fails(self):
        with self.assertRaises(pydantic.ValidationError) as error:
            ProjectConfig.model_validate({
                "parsers": {
                    "demo": {
                        "highlight_captures": "missing",
                    },
                },
            })

        self.assertIn("Unknown capture map 'missing'", str(error.exception))


class BuildPresetConfigTests(unittest.TestCase):
    def test_cargo_wasm_bindgen_preset_derives_build_paths(self):
        config = ProjectConfig.model_validate({
            "parsers": {
                "demo": {
                    "build": {
                        "preset": "cargo-wasm-bindgen",
                        "package": "demo-parser",
                    },
                },
            },
        })

        parser = config.parsers[0]

        self.assertEqual(
            parser.build.display_command(),
            "cargo build -p demo-parser --target wasm32-unknown-unknown && "
            "wasm-bindgen --target web --out-dir target/palimpsest/demo "
            "--out-name parser target/wasm32-unknown-unknown/debug/demo_parser.wasm",
        )
        self.assertEqual(
            [path.as_posix() for path in parser.build.outputs],
            [
                "target/palimpsest/demo/parser.js",
                "target/palimpsest/demo/parser_bg.wasm",
            ],
        )
        self.assertEqual(
            parser.runtime.module.as_posix(),
            "target/palimpsest/demo/parser.js",
        )

    def test_cargo_wasm_bindgen_preset_accepts_overrides(self):
        config = ProjectConfig.model_validate({
            "parsers": {
                "demo": {
                    "build": {
                        "preset": "cargo-wasm-bindgen",
                        "package": "demo-parser",
                        "release": True,
                        "wasm": "target/custom/demo.wasm",
                        "out_dir": "target/custom/palimpsest",
                        "out_name": "demo",
                    },
                    "runtime": {
                        "module": "target/custom/runtime.js",
                    },
                },
            },
        })

        parser = config.parsers[0]

        self.assertEqual(
            parser.build.preset_commands(),
            [
                [
                    "cargo",
                    "build",
                    "-p",
                    "demo-parser",
                    "--target",
                    "wasm32-unknown-unknown",
                    "--release",
                ],
                [
                    "wasm-bindgen",
                    "--target",
                    "web",
                    "--out-dir",
                    "target/custom/palimpsest",
                    "--out-name",
                    "demo",
                    "target/custom/demo.wasm",
                ],
            ],
        )
        self.assertEqual(
            [path.as_posix() for path in parser.build.outputs],
            [
                "target/custom/palimpsest/demo.js",
                "target/custom/palimpsest/demo_bg.wasm",
            ],
        )
        self.assertEqual(parser.runtime.module.as_posix(), "target/custom/runtime.js")

    def test_build_command_still_works_as_escape_hatch(self):
        config = ProjectConfig.model_validate({
            "parsers": {
                "demo": {
                    "build": {
                        "command": "make parser",
                    },
                },
            },
        })

        self.assertEqual(config.parsers[0].build.display_command(), "make parser")

    def test_lezer_preset_derives_build_paths(self):
        config = ProjectConfig.model_validate({
            "parsers": {
                "demo": {
                    "adapter": "lezer",
                    "grammar_files": ["src/demo.grammar"],
                    "build": {
                        "preset": "lezer",
                    },
                },
            },
        })

        parser = config.parsers[0]

        self.assertEqual(
            parser.build.display_command(),
            "mkdir -p target/palimpsest/demo && "
            "npx lezer-generator --output target/palimpsest/demo/parser.generated.js "
            "--export parser src/demo.grammar && "
            "npx esbuild target/palimpsest/demo/parser.generated.js --bundle --format=esm "
            "--outfile=target/palimpsest/demo/parser.js",
        )
        self.assertEqual(parser.runtime.parse_export, "parser")
        self.assertEqual(
            [path.as_posix() for path in parser.build.outputs],
            [
                "target/palimpsest/demo/parser.generated.js",
                "target/palimpsest/demo/parser.generated.terms.js",
                "target/palimpsest/demo/parser.js",
            ],
        )
        self.assertEqual(parser.runtime.module.as_posix(), "target/palimpsest/demo/parser.js")

    def test_lezer_preset_accepts_overrides(self):
        config = ProjectConfig.model_validate({
            "parsers": {
                "demo": {
                    "adapter": "lezer",
                    "grammar_files": ["src/demo.grammar"],
                    "build": {
                        "preset": "lezer",
                        "grammar": "grammars/custom.grammar",
                        "out_dir": "target/custom",
                        "out_name": "demo",
                        "export_name": "customParser",
                    },
                    "runtime": {
                        "module": "target/custom/runtime.js",
                        "parse_export": "customParser",
                    },
                },
            },
        })

        parser = config.parsers[0]

        self.assertEqual(
            parser.build.preset_commands(),
            [
                ["mkdir", "-p", "target/custom"],
                [
                    "npx",
                    "lezer-generator",
                    "--output",
                    "target/custom/demo.generated.js",
                    "--export",
                    "customParser",
                    "grammars/custom.grammar",
                ],
                [
                    "npx",
                    "esbuild",
                    "target/custom/demo.generated.js",
                    "--bundle",
                    "--format=esm",
                    "--outfile=target/custom/demo.js",
                ],
            ],
        )
        self.assertEqual(parser.runtime.module.as_posix(), "target/custom/runtime.js")
        self.assertEqual(parser.runtime.parse_export, "customParser")

    def test_cargo_wasm_bindgen_preset_requires_package(self):
        with self.assertRaises(pydantic.ValidationError) as error:
            ProjectConfig.model_validate({
                "parsers": {
                    "demo": {
                        "build": {
                            "preset": "cargo-wasm-bindgen",
                        },
                    },
                },
            })

        self.assertIn("uses cargo-wasm-bindgen build preset without package", str(error.exception))

    def test_lezer_preset_requires_grammar_file(self):
        with self.assertRaises(pydantic.ValidationError) as error:
            ProjectConfig.model_validate({
                "parsers": {
                    "demo": {
                        "adapter": "lezer",
                        "build": {
                            "preset": "lezer",
                        },
                    },
                },
            })

        self.assertIn("uses lezer build preset without grammar_files", str(error.exception))


if __name__ == "__main__":
    unittest.main()
