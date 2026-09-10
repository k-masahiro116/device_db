"""Flask application for device_db demo."""

from __future__ import annotations

import mimetypes
from pathlib import Path

from flask import Flask, jsonify, render_template, request, send_file

import storage

app = Flask(__name__)
storage.ensure_data_files()


def _error(message: str, status: int = 400):
    return jsonify({"error": message}), status


def _parse_filters(args) -> dict[str, str]:
    filters: dict[str, str] = {}
    for key, value in args.items():
        if key.startswith("filter_") and value is not None:
            filters[key[len("filter_") :]] = str(value)
    return filters


@app.get("/")
def index():
    return render_template("index.html")


@app.get("/api/columns")
def api_list_columns():
    return jsonify({"columns": storage.load_columns()})


@app.post("/api/columns")
def api_create_column():
    payload = request.get_json(silent=True) or {}
    try:
        column = storage.create_column(payload)
    except ValueError as exc:
        return _error(str(exc))
    return jsonify(column), 201


@app.put("/api/columns/<column_key>")
def api_update_column(column_key: str):
    payload = request.get_json(silent=True) or {}
    try:
        column = storage.update_column(column_key, payload)
    except KeyError as exc:
        return _error(str(exc), 404)
    except ValueError as exc:
        return _error(str(exc))
    return jsonify(column)


@app.delete("/api/columns/<column_key>")
def api_delete_column(column_key: str):
    try:
        storage.delete_column(column_key)
    except KeyError as exc:
        return _error(str(exc), 404)
    return jsonify({"ok": True})


@app.put("/api/columns")
def api_reorder_columns():
    payload = request.get_json(silent=True) or {}
    keys = payload.get("keys")
    if not isinstance(keys, list):
        return _error("keys 配列が必要です")
    columns = storage.reorder_columns([str(k) for k in keys])
    return jsonify({"columns": columns})


@app.get("/columns")
def columns_page():
    return render_template("columns.html")


@app.get("/api/parts")
def api_list_parts():
    try:
        limit = int(request.args.get("limit", 50))
        offset = int(request.args.get("offset", 0))
    except ValueError:
        return _error("limit / offset は整数で指定してください")

    result = storage.list_parts(
        query=request.args.get("q", "") or "",
        filters=_parse_filters(request.args),
        sort=request.args.get("sort", "updated_at") or "updated_at",
        order=request.args.get("order", "desc") or "desc",
        limit=limit,
        offset=offset,
    )
    return jsonify(result)


@app.get("/api/parts/<part_id>")
def api_get_part(part_id: str):
    part = storage.get_part(part_id)
    if not part:
        return _error("部品が見つかりません", 404)
    return jsonify(part)


@app.post("/api/parts")
def api_create_part():
    payload = request.get_json(silent=True) or {}
    try:
        part = storage.create_part(payload)
    except ValueError as exc:
        return _error(str(exc))
    return jsonify(part), 201


@app.put("/api/parts/<part_id>")
def api_update_part(part_id: str):
    payload = request.get_json(silent=True) or {}
    try:
        part = storage.update_part(part_id, payload)
    except KeyError as exc:
        return _error(str(exc), 404)
    except ValueError as exc:
        return _error(str(exc))
    return jsonify(part)


@app.delete("/api/parts/<part_id>")
def api_delete_part(part_id: str):
    try:
        storage.delete_part(part_id)
    except KeyError as exc:
        return _error(str(exc), 404)
    return jsonify({"ok": True})


@app.post("/api/parts/<part_id>/files/<column_key>")
def api_upload_file(part_id: str, column_key: str):
    if "file" not in request.files:
        return _error("file フィールドが必要です")
    uploaded = request.files["file"]
    if not uploaded or not uploaded.filename:
        return _error("ファイルが選択されていません")

    content = uploaded.read()
    mime = uploaded.mimetype or mimetypes.guess_type(uploaded.filename)[0] or ""
    # Normalize common browser mime quirks
    name_lower = uploaded.filename.lower()
    if name_lower.endswith(".png"):
        mime = "image/png"
    elif name_lower.endswith(".pdf"):
        mime = "application/pdf"

    try:
        meta = storage.add_file(
            part_id,
            column_key,
            original_name=uploaded.filename,
            content=content,
            mime=mime,
        )
    except KeyError as exc:
        return _error(str(exc), 404)
    except ValueError as exc:
        return _error(str(exc))
    return jsonify(meta), 201


@app.get("/api/parts/<part_id>/files/<column_key>/<file_id>")
def api_download_file(part_id: str, column_key: str, file_id: str):
    try:
        _, meta = storage.find_file(part_id, column_key, file_id)
        path = storage.resolve_upload_path(meta["stored_name"])
    except (KeyError, ValueError) as exc:
        return _error(str(exc), 404)
    if not path.exists():
        return _error("ファイル実体が見つかりません", 404)
    return send_file(
        path,
        mimetype=meta.get("mime"),
        as_attachment=False,
        download_name=meta.get("original_name"),
    )


@app.delete("/api/parts/<part_id>/files/<column_key>/<file_id>")
def api_delete_file(part_id: str, column_key: str, file_id: str):
    try:
        storage.delete_file(part_id, column_key, file_id)
    except KeyError as exc:
        return _error(str(exc), 404)
    return jsonify({"ok": True})


if __name__ == "__main__":
    # macOS AirPlay Receiver が 5000 を使うため、デモは 5050 を既定にする
    app.run(debug=True, host="127.0.0.1", port=5050)
