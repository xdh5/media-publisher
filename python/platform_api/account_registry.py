"""账号路由来自 Publisher 本地目录；凭据按引用读取，使用上下文隔离并行账号。"""

import json
import os
import re
from contextlib import contextmanager
from contextvars import ContextVar
from pathlib import Path

_current = ContextVar("publishing_account_env", default=None)
DATA_ROOT = Path(os.getenv("MEDIA_PUBLISHER_DIR", Path.cwd())) / "data"


def registry() -> dict:
    path = DATA_ROOT / "accounts.json"
    return json.loads(path.read_text(encoding="utf-8")) if path.is_file() else {"groups": [], "members": []}


def save_registry(value: dict, directory: Path | None = None) -> dict:
    """保存 Publisher 自有账号目录，不接受凭据正文。"""
    groups = value["groups"]
    members = value["members"]
    if not isinstance(groups, list) or not isinstance(members, list):
        raise ValueError("groups 和 members 必须是数组")
    groups = [{key: row[key] for key in ("code", "name", "enabled") if key in row} for row in groups]
    fields = ("group_code", "platform", "account_key", "connector", "connector_account_id", "platform_account_id", "credential_ref", "account_ref", "display_name", "enabled")
    members = [{key: row[key] for key in fields if key in row} for row in members]
    names = [str(row["name"]) for row in groups]
    if any(not re.fullmatch(r"[a-z][a-z0-9_]{0,63}", name) for name in names) or len(set(names)) != len(names):
        raise ValueError("账号组标识无效或重复")
    root = directory or DATA_ROOT
    root.mkdir(parents=True, exist_ok=True)
    path = root / "accounts.json"
    temporary = path.with_suffix(".json.tmp")
    temporary.write_text(json.dumps({"groups": groups, "members": members}, ensure_ascii=False, indent=2), encoding="utf-8")
    temporary.replace(path)
    return {"groups": len(groups), "members": len(members)}


def credential(ref: str) -> dict:
    raw = os.getenv("PUBLISHING_CREDENTIALS_JSON", "").strip()
    path = Path(os.getenv("PUBLISHING_CREDENTIALS_FILE", "") or DATA_ROOT / "credentials.json")
    values = json.loads(raw) if raw else (json.loads(path.read_text(encoding="utf-8")) if path.is_file() else {})
    selected = values.get(ref)
    if not isinstance(selected, dict):
        raise ValueError(f"缺少发布凭据引用：{ref}")
    return selected


def env_value(name: str) -> str:
    current = _current.get()
    if current is not None:
        return str(current.get(name, "")).strip()
    return os.getenv(name, "").strip()


def env_items():
    current = _current.get()
    return (current if current is not None else os.environ).items()


@contextmanager
def account_context(row: dict):
    key = str(row["account_key"])
    if not re.fullmatch(r"[a-z][a-z0-9_]{0,63}", key):
        raise ValueError(f"账号标识无效：{key}")
    values = credential(str(row["credential_ref"]))
    platform = row["platform"]
    connector_id = str(row["connector_account_id"])
    prefix = key.upper()
    mapped = {}
    if platform == "youtube":
        mapped = {
            f"{prefix}_YOUTUBE_CHANNEL_ID": connector_id,
            f"{prefix}_YOUTUBE_CHANNEL_TITLE": row.get("display_name", key),
            f"{prefix}_YOUTUBE_REFRESH_TOKEN": values.get("refresh_token", ""),
            "YOUTUBE_OAUTH_CLIENT_ID": values.get("client_id", ""),
            "YOUTUBE_OAUTH_CLIENT_SECRET": values.get("client_secret", ""),
        }
    else:
        mapped = {
            f"{prefix}_{platform.upper()}_ACCOUNT_ID": connector_id,
            f"{prefix}_{platform.upper()}_ACCOUNT_TITLE": row.get("display_name", key),
            "ZERNIO_API_KEY": values.get("api_key", ""),
            "zernio_api_key_meta": values.get("api_key", ""),
        }
    marker = _current.set(mapped)
    try:
        yield key
    finally:
        _current.reset(marker)


def verify_account(row: dict) -> dict:
    """查询真实授权账号并核验平台 ID，拒绝凭据与路由串号。"""
    from .cli import _accounts

    with account_context(row) as key:
        found = [item for item in _accounts(key, platform=row["platform"])
                 if item["account_id"] == row["connector_account_id"]]
        if row["platform"] == "youtube":
            from google_auth_httplib2 import AuthorizedHttp
            from googleapiclient.discovery import build

            from .youtube.publish_to_youtube import YouTubeHttp, _load_credentials
            transport = YouTubeHttp()
            try:
                service = build("youtube", "v3", http=AuthorizedHttp(_load_credentials(row["connector_account_id"], key), http=transport), cache_discovery=False)
                channels = service.channels().list(part="id", mine=True).execute().get("items", [])
                if row["platform_account_id"] not in {item["id"] for item in channels}:
                    raise ValueError(f"YouTube 授权与账号 {key} 不一致")
            finally:
                transport.close()
    if len(found) != 1 or found[0]["platform_account_id"] != row["platform_account_id"]:
        raise ValueError(f"账号 {row['account_key']} 的真实平台 ID 与数据库不一致")
    return {**row, **found[0], "account_key": row["account_key"], "login_status": "connected"}
