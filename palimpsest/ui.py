from flask import Blueprint, make_response, render_template

from palimpsest.config import Config
from palimpsest.models import AppState


def create_ui_blueprint(config: Config):
    blueprint = Blueprint("ui", __name__)

    @blueprint.get("/")
    def index():
        state = AppState.from_config(config)
        response = make_response(render_template(
            "index.j2.html",
            app_name=state.app_name,
            state=state.model_dump(mode="json"),
        ))
        response.headers["Cache-Control"] = "no-store"
        return response

    return blueprint
