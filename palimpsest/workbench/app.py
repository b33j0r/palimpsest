import sys

from flask import Flask

from palimpsest.config import get_config
from palimpsest.workbench.api import create_api_blueprint
from palimpsest.workbench.ui import create_ui_blueprint


def create_app(**config_overrides):
    config = get_config(**config_overrides)
    app = Flask("palimpsest")
    app.config["PALIMPSEST"] = config
    app.config["SEND_FILE_MAX_AGE_DEFAULT"] = 0
    app.register_blueprint(create_api_blueprint(config))
    app.register_blueprint(create_ui_blueprint(config))
    return app


def main(argv=None):
    from palimpsest.cli import main as cli_main

    return cli_main(["workbench", *(sys.argv[1:] if argv is None else argv)])

if __name__ == "__main__":
    main()
