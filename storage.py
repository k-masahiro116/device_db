"""JSON file storage with simple locking."""

from __future__ import annotations

import json
import os
import re
import uuid
from contextlib import contextmanager
from copy import deepcopy
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent
DATA_DIR = ROOT / "data"
PARTS_PATH = DATA_DIR / "parts.json"
COLUMNS_PATH = DATA_DIR / "columns.json"
UPLOADS_DIR = DATA_DIR / "uploads"

SYSTEM_KEYS = frozenset({"id", "name", "created_at", "updated_at", "assigned"})
KEY_PATTERN = re.compile(r"^[a-z][a-z0-9_]*$")
ALLOWED_COLUMN_TYPES = frozenset({"text", "textarea", "number", "file"})
ALLOWED_MIME = {
    "application/pdf": ".pdf",
    "image/png": ".png",
}
MAX_UPLOAD_BYTES = 10 * 1024 * 1024


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def ensure_data_files() -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    UPLOADS_DIR.mkdir(parents=True, exist_ok=True)
    if not PARTS_PATH.exists():
        _atomic_write(PARTS_PATH, {"parts": []})
    if not COLUMNS_PATH.exists():
        _atomic_write(COLUMNS_PATH, {"columns": []})


@contextmanager
def _file_lock(path: Path):
    lock_path = path.with_suffix(path.suffix + ".lock")
    lock_path.parent.mkdir(parents=True, exist_ok=True)
    fd = os.open(lock_path, os.O_CREAT | os.O_RDWR)
    try:
        try:
            import fcntl

            fcntl.flock(fd, fcntl.LOCK_EX)
        except ImportError:
            pass
        yield
    finally:
        try:
            import fcntl

            fcntl.flock(fd, fcntl.LOCK_UN)
        except ImportError:
            pass
        os.close(fd)


def _atomic_write(path: Path, data: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
        f.write("\n")
    os.replace(tmp, path)


def _read_json(path: Path) -> Any:
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def load_columns() -> list[dict[str, Any]]:
    ensure_data_files()
    with _file_lock(COLUMNS_PATH):
        data = _read_json(COLUMNS_PATH)
    columns = data.get("columns", [])
    return sorted(columns, key=lambda c: (c.get("order", 0), c.get("key", "")))


def save_columns(columns: list[dict[str, Any]]) -> None:
    ensure_data_files()
    with _file_lock(COLUMNS_PATH):
        _atomic_write(COLUMNS_PATH, {"columns": columns})


def column_map() -> dict[str, dict[str, Any]]:
    return {c["key"]: c for c in load_columns()}


def load_parts() -> list[dict[str, Any]]:
    ensure_data_files()
    with _file_lock(PARTS_PATH):
        data = _read_json(PARTS_PATH)
    return list(data.get("parts", []))


def save_parts(parts: list[dict[str, Any]]) -> None:
    ensure_data_files()
    with _file_lock(PARTS_PATH):
        _atomic_write(PARTS_PATH, {"parts": parts})


def normalize_value(value: Any, col_type: str) -> Any | None:
    if value is None:
        return None
    if col_type == "file":
        if not isinstance(value, list):
            return None
        return value or None
    if isinstance(value, str) and value.strip() == "":
        return None
    if col_type == "number":
        if isinstance(value, bool):
            return None
        if isinstance(value, (int, float)):
            return value
        try:
            text = str(value).strip()
            if text == "":
                return None
            if "." in text:
                return float(text)
            return int(text)
        except ValueError:
            return str(value).strip() or None
    return str(value).strip() or None


def sparse_part_fields(
    payload: dict[str, Any],
    columns: dict[str, dict[str, Any]],
    *,
    keep_files: bool = True,
) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for key, value in payload.items():
        if key in SYSTEM_KEYS:
            continue
        col = columns.get(key)
        if not col:
            continue
        if col["type"] == "file":
            if keep_files and isinstance(value, list) and value:
                result[key] = value
            continue
        normalized = normalize_value(value, col["type"])
        if normalized is not None:
            result[key] = normalized
    return result


def normalize_assigned(keys: Any, columns: dict[str, dict[str, Any]]) -> list[str]:
    if not isinstance(keys, list):
        return []
    seen: set[str] = set()
    result: list[str] = []
    for key in keys:
        text = str(key).strip()
        if text in columns and text not in seen:
            seen.add(text)
            result.append(text)
    return result


def infer_assigned(part: dict[str, Any], columns: dict[str, dict[str, Any]]) -> list[str]:
    if isinstance(part.get("assigned"), list):
        return normalize_assigned(part["assigned"], columns)
    # 既存データ移行: 値が入っているカタログキーを割り当て済みとみなす
    return [key for key in part.keys() if key in columns]


def attach_assigned(part: dict[str, Any], columns: dict[str, dict[str, Any]] | None = None) -> dict[str, Any]:
    cols = columns or column_map()
    enriched = dict(part)
    enriched["assigned"] = infer_assigned(enriched, cols)
    return enriched


def create_column(payload: dict[str, Any]) -> dict[str, Any]:
    key = str(payload.get("key", "")).strip()
    label = str(payload.get("label", "")).strip()
    col_type = str(payload.get("type", "text")).strip()

    if not KEY_PATTERN.match(key):
        raise ValueError("key は英小文字で始まり、英小文字・数字・アンダースコアのみ使用できます")
    if key in SYSTEM_KEYS:
        raise ValueError("システム予約キーは使えません")
    if not label:
        raise ValueError("label は必須です")
    if col_type not in ALLOWED_COLUMN_TYPES:
        raise ValueError("type は text / textarea / number / file のいずれかです")

    columns = load_columns()
    if any(c["key"] == key for c in columns):
        raise ValueError("同じ key のカラムが既に存在します")

    order = payload.get("order")
    if order is None:
        order = (max((c.get("order", 0) for c in columns), default=0) + 1)
    else:
        order = int(order)

    column = {"key": key, "label": label, "type": col_type, "order": order}
    columns.append(column)
    save_columns(columns)
    return column


def update_column(column_key: str, payload: dict[str, Any]) -> dict[str, Any]:
    columns = load_columns()
    index = next((i for i, c in enumerate(columns) if c.get("key") == column_key), None)
    if index is None:
        raise KeyError("カラムが見つかりません")

    column = dict(columns[index])
    if "label" in payload:
        label = str(payload.get("label", "")).strip()
        if not label:
            raise ValueError("名称は必須です")
        column["label"] = label
    if "order" in payload and payload.get("order") is not None:
        column["order"] = int(payload["order"])
    # type の変更は既存データ破壊の恐れがあるためデモでは不可

    columns[index] = column
    save_columns(columns)
    return column


def delete_column(column_key: str) -> None:
    columns = load_columns()
    target = next((c for c in columns if c.get("key") == column_key), None)
    if target is None:
        raise KeyError("カラムが見つかりません")

    columns = [c for c in columns if c.get("key") != column_key]
    save_columns(columns)

    parts = load_parts()
    changed = False
    for part in parts:
        part_changed = False
        if isinstance(part.get("assigned"), list) and column_key in part["assigned"]:
            part["assigned"] = [k for k in part["assigned"] if k != column_key]
            part_changed = True
        if column_key in part:
            if target.get("type") == "file":
                for meta in part.get(column_key) or []:
                    stored = meta.get("stored_name")
                    if stored:
                        _delete_file_on_disk(stored)
            del part[column_key]
            part_changed = True
        if part_changed:
            part["updated_at"] = utc_now_iso()
            changed = True
    if changed:
        save_parts(parts)


def reorder_columns(keys: list[str]) -> list[dict[str, Any]]:
    columns = load_columns()
    by_key = {c["key"]: c for c in columns}
    ordered: list[dict[str, Any]] = []
    seen: set[str] = set()
    for i, key in enumerate(keys):
        col = by_key.get(key)
        if not col or key in seen:
            continue
        updated = dict(col)
        updated["order"] = i + 1
        ordered.append(updated)
        seen.add(key)
    for col in columns:
        if col["key"] not in seen:
            updated = dict(col)
            updated["order"] = len(ordered) + 1
            ordered.append(updated)
            seen.add(col["key"])
    save_columns(ordered)
    return ordered


def get_part(part_id: str) -> dict[str, Any] | None:
    columns = column_map()
    for part in load_parts():
        if part.get("id") == part_id:
            return attach_assigned(part, columns)
    return None


def create_part(payload: dict[str, Any]) -> dict[str, Any]:
    name = str(payload.get("name", "")).strip()
    if not name:
        raise ValueError("名称（name）は必須です")

    columns = column_map()
    now = utc_now_iso()
    fields = sparse_part_fields(payload, columns, keep_files=False)
    assigned = normalize_assigned(payload.get("assigned"), columns)
    for key in fields:
        if key not in assigned:
            assigned.append(key)

    part = {
        "id": str(uuid.uuid4()),
        "name": name,
        "assigned": assigned,
        "created_at": now,
        "updated_at": now,
    }
    part.update(fields)
    parts = load_parts()
    parts.append(part)
    save_parts(parts)
    return attach_assigned(part, columns)


def update_part(part_id: str, payload: dict[str, Any]) -> dict[str, Any]:
    parts = load_parts()
    index = next((i for i, p in enumerate(parts) if p.get("id") == part_id), None)
    if index is None:
        raise KeyError("部品が見つかりません")

    existing = parts[index]
    if "name" in payload:
        name = str(payload.get("name", "")).strip()
        if not name:
            raise ValueError("名称（name）は必須です")
        existing["name"] = name

    columns = column_map()
    file_keys = {k for k, c in columns.items() if c["type"] == "file"}
    preserved_files = {k: deepcopy(existing[k]) for k in file_keys if k in existing}

    if "assigned" in payload:
        assigned = normalize_assigned(payload.get("assigned"), columns)
    else:
        assigned = infer_assigned(existing, columns)
    existing["assigned"] = assigned

    # Remove previous user-defined non-file keys, then re-apply from payload
    for key in list(existing.keys()):
        if key not in SYSTEM_KEYS and key not in file_keys:
            del existing[key]

    existing.update(sparse_part_fields(payload, columns, keep_files=False))
    for key, files in preserved_files.items():
        # 割り当てから外してもファイル実体は残す（再割り当て時のため）
        existing[key] = files

    # Allow clearing a non-file field by sending null
    for key, value in payload.items():
        if key in SYSTEM_KEYS or key not in columns:
            continue
        if columns[key]["type"] == "file":
            continue
        if value is None or (isinstance(value, str) and value.strip() == ""):
            existing.pop(key, None)

    existing["updated_at"] = utc_now_iso()
    parts[index] = existing
    save_parts(parts)
    return attach_assigned(existing, columns)


def _delete_file_on_disk(stored_name: str) -> None:
    path = UPLOADS_DIR / stored_name
    if path.exists() and path.is_file():
        path.unlink()


def delete_part(part_id: str) -> None:
    parts = load_parts()
    index = next((i for i, p in enumerate(parts) if p.get("id") == part_id), None)
    if index is None:
        raise KeyError("部品が見つかりません")

    part = parts.pop(index)
    columns = column_map()
    for key, col in columns.items():
        if col["type"] != "file":
            continue
        for meta in part.get(key, []) or []:
            stored = meta.get("stored_name")
            if stored:
                _delete_file_on_disk(stored)
    save_parts(parts)


def _text_columns(columns: dict[str, dict[str, Any]]) -> list[str]:
    return ["name", "id"] + [k for k, c in columns.items() if c["type"] in ("text", "textarea", "number")]


def _value_as_text(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, list):
        return " ".join(
            str(item.get("original_name", "")) for item in value if isinstance(item, dict)
        )
    return str(value)


def _matches_query(part: dict[str, Any], query: str, columns: dict[str, dict[str, Any]]) -> bool:
    if not query:
        return True
    q = query.casefold()
    for key in _text_columns(columns):
        if q in _value_as_text(part.get(key)).casefold():
            return True
    for key, col in columns.items():
        if col["type"] == "file" and q in _value_as_text(part.get(key)).casefold():
            return True
    return False


def _matches_filters(
    part: dict[str, Any],
    filters: dict[str, str],
    columns: dict[str, dict[str, Any]],
) -> bool:
    for key, raw in filters.items():
        if not raw:
            continue
        needle = raw.casefold()
        if key in ("name", "id", "created_at", "updated_at"):
            hay = _value_as_text(part.get(key)).casefold()
        elif key in columns:
            hay = _value_as_text(part.get(key)).casefold()
        else:
            continue
        if needle not in hay:
            return False
    return True


def _sort_key(part: dict[str, Any], sort: str, col_type: str) -> tuple:
    value = part.get(sort)
    empty = value is None or value == "" or value == []
    if empty:
        return (1, None)
    if col_type == "number":
        try:
            return (0, float(value))
        except (TypeError, ValueError):
            return (0, str(value))
    if col_type == "file":
        return (0, len(value) if isinstance(value, list) else 0)
    return (0, str(value).casefold())


def list_parts(
    *,
    query: str = "",
    filters: dict[str, str] | None = None,
    sort: str = "updated_at",
    order: str = "desc",
    limit: int = 50,
    offset: int = 0,
) -> dict[str, Any]:
    columns = column_map()
    filters = filters or {}
    items = [
        p
        for p in load_parts()
        if _matches_query(p, query, columns) and _matches_filters(p, filters, columns)
    ]

    if sort in SYSTEM_KEYS or sort in columns:
        col_type = "text"
        if sort in columns:
            col_type = columns[sort]["type"]
        elif sort in ("created_at", "updated_at"):
            col_type = "text"
        reverse = order.lower() != "asc"
        items.sort(key=lambda p: _sort_key(p, sort, col_type), reverse=reverse)

    total = len(items)
    limit = max(1, min(limit, 200))
    offset = max(0, offset)
    page = items[offset : offset + limit]
    return {
        "items": [attach_assigned(p, columns) for p in page],
        "total": total,
        "limit": limit,
        "offset": offset,
        "has_more": offset + len(page) < total,
    }


def add_file(
    part_id: str,
    column_key: str,
    *,
    original_name: str,
    content: bytes,
    mime: str,
) -> dict[str, Any]:
    if mime not in ALLOWED_MIME:
        raise ValueError("PDF または PNG のみアップロードできます")
    if len(content) > MAX_UPLOAD_BYTES:
        raise ValueError("ファイルサイズは 10MB 以下にしてください")
    if len(content) == 0:
        raise ValueError("空のファイルはアップロードできません")

    columns = column_map()
    col = columns.get(column_key)
    if not col or col["type"] != "file":
        raise ValueError("指定カラムはファイル型ではありません")

    parts = load_parts()
    index = next((i for i, p in enumerate(parts) if p.get("id") == part_id), None)
    if index is None:
        raise KeyError("部品が見つかりません")

    file_id = str(uuid.uuid4())
    ext = ALLOWED_MIME[mime]
    stored_name = f"{file_id}{ext}"
    ensure_data_files()
    (UPLOADS_DIR / stored_name).write_bytes(content)

    meta = {
        "id": file_id,
        "original_name": original_name,
        "stored_name": stored_name,
        "mime": mime,
        "size": len(content),
        "created_at": utc_now_iso(),
    }
    part = parts[index]
    files = list(part.get(column_key) or [])
    files.append(meta)
    part[column_key] = files
    assigned = infer_assigned(part, columns)
    if column_key not in assigned:
        assigned.append(column_key)
    part["assigned"] = assigned
    part["updated_at"] = utc_now_iso()
    parts[index] = part
    save_parts(parts)
    return meta


def find_file(part_id: str, column_key: str, file_id: str) -> tuple[dict[str, Any], dict[str, Any]]:
    part = get_part(part_id)
    if not part:
        raise KeyError("部品が見つかりません")
    files = part.get(column_key) or []
    for meta in files:
        if meta.get("id") == file_id:
            return part, meta
    raise KeyError("ファイルが見つかりません")


def delete_file(part_id: str, column_key: str, file_id: str) -> None:
    parts = load_parts()
    index = next((i for i, p in enumerate(parts) if p.get("id") == part_id), None)
    if index is None:
        raise KeyError("部品が見つかりません")

    part = parts[index]
    files = list(part.get(column_key) or [])
    target = next((f for f in files if f.get("id") == file_id), None)
    if not target:
        raise KeyError("ファイルが見つかりません")

    files = [f for f in files if f.get("id") != file_id]
    if files:
        part[column_key] = files
    else:
        part.pop(column_key, None)
    part["updated_at"] = utc_now_iso()
    parts[index] = part
    save_parts(parts)
    stored = target.get("stored_name")
    if stored:
        _delete_file_on_disk(stored)


def resolve_upload_path(stored_name: str) -> Path:
    path = (UPLOADS_DIR / stored_name).resolve()
    if not str(path).startswith(str(UPLOADS_DIR.resolve())):
        raise ValueError("不正なパスです")
    return path
