from flask import Flask, Blueprint, render_template

from palimpsest.config import get_config

config = get_config()

app = Flask(__name__)
app.config.from_object(config)


@app.route("/")
def index():
    return render_template("index.j2.html", app_name="Palimpsest")


def main():
    app.run()


if __name__ == "__main__":
    main()
