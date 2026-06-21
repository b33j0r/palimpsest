import argparse
import sys

from flask import Flask

from palimpsest.api import create_api_blueprint
from palimpsest.config import get_config
from palimpsest.ui import create_ui_blueprint


def create_app(**config_overrides):
    config = get_config(**config_overrides)
    app = Flask(__name__)
    app.config["PALIMPSEST"] = config
    app.config["SEND_FILE_MAX_AGE_DEFAULT"] = 0
    app.register_blueprint(create_api_blueprint(config))
    app.register_blueprint(create_ui_blueprint(config))
    return app


def main(argv=None):
    args = _parse_args(argv)
    if args.host not in ("127.0.0.1", "localhost", "::1"):
        print(
            "Warning: Palimpsest can edit files and run configured project build commands. "
            f"Binding to {args.host!r} may expose those controls beyond this machine.",
            file=sys.stderr,
        )
    app = create_app(cwd=args.project_dir, config_path=args.config)
    app.run(host=args.host, port=args.port, debug=args.debug)


def _parse_args(argv=None):
    parser = argparse.ArgumentParser(
        prog="palimpsest",
        description="Run the Palimpsest grammar workbench for a project.",
    )
    parser.add_argument(
        "project_dir",
        nargs="?",
        help="Project directory to serve. Defaults to the current working directory.",
    )
    parser.add_argument(
        "-c",
        "--config",
        help="Path to palimpsest.toml. Defaults to palimpsest.toml in the project directory.",
    )
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=5000)
    parser.add_argument("--debug", action="store_true")
    return parser.parse_args(argv)


if __name__ == "__main__":
    main()
