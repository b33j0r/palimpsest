import tempfile
import unittest
from contextlib import redirect_stderr, redirect_stdout
from io import StringIO
from pathlib import Path
from unittest import mock

from palimpsest import cli


class CliTests(unittest.TestCase):
    def test_default_command_runs_workbench_compatibility_shortcut(self):
        with mock.patch("palimpsest.cli.create_app") as create_app:
            app = create_app.return_value
            exit_code = cli.main(["demo-project", "--port", "5050"])

        self.assertEqual(exit_code, 0)
        create_app.assert_called_once_with(cwd="demo-project", config_path=None)
        app.run.assert_called_once_with(host="127.0.0.1", port=5050, debug=False)

    def test_workbench_subcommand_runs_workbench(self):
        with mock.patch("palimpsest.cli.create_app") as create_app:
            app = create_app.return_value
            exit_code = cli.main(["workbench", "demo-project", "--debug"])

        self.assertEqual(exit_code, 0)
        create_app.assert_called_once_with(cwd="demo-project", config_path=None)
        app.run.assert_called_once_with(host="127.0.0.1", port=5000, debug=True)

    def test_highlight_check_reads_project_config(self):
        with tempfile.TemporaryDirectory() as tempdir:
            root = Path(tempdir)
            (root / "palimpsest.toml").write_text("examples_dir = \"examples\"\n")

            with redirect_stdout(StringIO()), redirect_stderr(StringIO()):
                exit_code = cli.main(["highlight", "check", tempdir])

        self.assertEqual(exit_code, 0)

    def test_highlight_build_runs_configured_command(self):
        with tempfile.TemporaryDirectory() as tempdir:
            root = Path(tempdir)
            (root / "palimpsest.toml").write_text(
                """
examples_dir = "examples"

[parsers.demo.build]
command = ["python", "-c", "print('built')"]
""".lstrip()
            )

            with redirect_stdout(StringIO()), redirect_stderr(StringIO()):
                exit_code = cli.main(["highlight", "build", "demo", tempdir])

        self.assertEqual(exit_code, 0)


if __name__ == "__main__":
    unittest.main()
