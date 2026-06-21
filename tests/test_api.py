import tempfile
import unittest
from pathlib import Path

from palimpsest.app import create_app
from palimpsest.config import ProjectConfig


class ApiTests(unittest.TestCase):
    def make_client(self, project=None):
        self.tempdir = tempfile.TemporaryDirectory()
        self.addCleanup(self.tempdir.cleanup)
        root = Path(self.tempdir.name)
        (root / "examples").mkdir()
        (root / "examples" / "demo.txt").write_text("hello")
        app = create_app(
            cwd=root,
            project=project or ProjectConfig.model_validate({"examples_dir": "examples"}),
        )
        app.testing = True
        return app.test_client(), root

    def test_file_api_rejects_paths_outside_cwd(self):
        client, root = self.make_client()
        outside = root.parent / "outside.txt"

        response = client.get(f"/api/file?path={outside}")

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.get_json()["message"], "Path must stay inside the configured cwd")

    def test_save_file_returns_json_error_for_missing_content(self):
        client, _root = self.make_client()

        response = client.put("/api/file", json={"path": "examples/demo.txt"})

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.get_json()["message"], "Missing content")

    def test_health_reports_configured_parser_readiness(self):
        project = ProjectConfig.model_validate({
            "examples_dir": "examples",
            "parsers": {
                "demo": {
                    "adapter": "pest",
                    "grammar_files": ["examples/demo.pest"],
                    "build": {
                        "command": ["python", "-c", "print('ok')"],
                    },
                    "runtime": {
                        "module": "target/palimpsest/demo/parser.js",
                    },
                },
            },
        })
        client, root = self.make_client(project)
        (root / "examples" / "demo.pest").write_text("demo = _{ SOI ~ EOI }")

        response = client.get("/api/health")
        payload = response.get_json()

        self.assertEqual(response.status_code, 200)
        self.assertFalse(payload["ok"])
        self.assertEqual(payload["parsers"][0]["id"], "demo")
        self.assertTrue(payload["parsers"][0]["grammar_files"][0]["ok"])
        self.assertFalse(payload["parsers"][0]["runtime"]["ok"])

    def test_build_response_includes_diagnostics(self):
        project = ProjectConfig.model_validate({
            "examples_dir": "examples",
            "parsers": {
                "demo": {
                    "build": {
                        "command": ["python", "-c", "import sys; print('bad'); sys.exit(7)"],
                    },
                },
            },
        })
        client, _root = self.make_client(project)

        response = client.post("/api/parsers/demo/build")
        payload = response.get_json()

        self.assertEqual(response.status_code, 200)
        self.assertFalse(payload["ok"])
        self.assertEqual(payload["returncode"], 7)
        self.assertIn("bad", payload["stdout"])
        self.assertIn("elapsed_ms", payload)


if __name__ == "__main__":
    unittest.main()
