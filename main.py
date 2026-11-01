import os
from flask import Flask, send_from_directory

DOCS_DIR = os.path.join(os.path.abspath(os.path.dirname(__file__)), "docs")

app = Flask(__name__, static_folder=None)


@app.route("/")
def index():
    return send_from_directory(DOCS_DIR, "index.html")


@app.route("/<path:filename>")
def static_files(filename):
    return send_from_directory(DOCS_DIR, filename)


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    app.run(host="0.0.0.0", port=port, debug=True)