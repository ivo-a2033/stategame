import os
from flask import Flask, send_from_directory, abort

BASE_DIR = os.path.abspath(os.path.dirname(__file__))

app = Flask(__name__, static_folder=None)


@app.route("/")
def index():
    return send_from_directory(BASE_DIR, "index.html")


@app.route("/assets/<path:filename>")
def assets(filename):
    # Serves everything inside the assets folder (including subfolders)
    return send_from_directory(os.path.join(BASE_DIR, "assets"), filename)


@app.route("/<path:filename>")
def root_js(filename):
    # Serves .js files that live in the project folder (e.g. /main.js)
    if not filename.endswith(".js"):
        abort(404)
    return send_from_directory(BASE_DIR, filename)


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    app.run(host="0.0.0.0", port=port, debug=True)