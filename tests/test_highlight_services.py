import tempfile
import unittest
from pathlib import Path

from palimpsest.config import Config, ProjectConfig
from palimpsest.highlight.services import build_highlighter, dependency_checks, project_highlight_health


class HighlightServiceTests(unittest.TestCase):
    def test_dependency_checks_use_build_preset_registry(self):
        config = Config(
            project=ProjectConfig.model_validate({
                "parsers": {
                    "demo": {
                        "build": {
                            "preset": "cargo-wasm-bindgen",
                            "package": "demo-parser",
                        },
                    },
                },
            })
        )

        names = [check["name"] for check in dependency_checks(config)]

        self.assertEqual(names, ["cargo", "wasm-bindgen"])

    def test_build_highlighter_returns_diagnostics(self):
        with tempfile.TemporaryDirectory() as tempdir:
            config = Config(
                cwd=Path(tempdir),
                project=ProjectConfig.model_validate({
                    "parsers": {
                        "demo": {
                            "build": {
                                "command": ["python", "-c", "print('built')"],
                            },
                        },
                    },
                }),
            )

            result, status = build_highlighter(config, "demo")

        self.assertEqual(status, 200)
        self.assertTrue(result["ok"])
        self.assertEqual(result["returncode"], 0)
        self.assertIn("built", result["stdout"])

    def test_project_highlight_health_reports_missing_runtime(self):
        with tempfile.TemporaryDirectory() as tempdir:
            config = Config(
                cwd=Path(tempdir),
                project=ProjectConfig.model_validate({
                    "parsers": {
                        "demo": {
                            "runtime": {
                                "module": "target/palimpsest/demo/parser.js",
                            },
                        },
                    },
                }),
            )

            health = project_highlight_health(config)

        self.assertFalse(health["ok"])
        self.assertFalse(health["parsers"][0]["runtime"]["ok"])

    def test_project_highlight_health_accepts_grammar_globs(self):
        with tempfile.TemporaryDirectory() as tempdir:
            root = Path(tempdir)
            (root / "src").mkdir()
            (root / "src" / "parser.rs").write_text("fn parser() {}\n")
            config = Config(
                cwd=root,
                project=ProjectConfig.model_validate({
                    "parsers": {
                        "demo": {
                            "grammar_files": ["src/**/*.rs"],
                        },
                    },
                }),
            )

            health = project_highlight_health(config)

        self.assertTrue(health["ok"])
        self.assertTrue(health["parsers"][0]["grammar_files"][0]["ok"])
        self.assertEqual(len(health["parsers"][0]["grammar_files"][0]["matches"]), 1)


if __name__ == "__main__":
    unittest.main()
