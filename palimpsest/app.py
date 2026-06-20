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


def main():
    app = create_app()
    app.run()


if __name__ == "__main__":
    main()
