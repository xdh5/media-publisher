"""账号路由来自数据库；凭据按引用读取，使用上下文隔离并行账号。"""

from contextlib import contextmanager
from contextvars import ContextVar
import json
import os
from pathlib import Path
import re

import requests

_current = ContextVar("publishing_account_env", default=None)
DATA_ROOT = Path(os.getenv("MEDIA_PUBLISHER_DIR", Path.cwd())) / "data"


def registry() -> dict:
    url = os.getenv("CLOUDFLARE_DATA_API_URL", "").strip()
    token = os.getenv("CLOUDFLARE_DATA_API_TOKEN", "").strip()
    if url and token:
        response = requests.get(
            f"{url.rstrip('/')}/v1/publishing-account-groups",
            headers={"Authorization": f"Bearer {token}"}, timeout=30,
        )
        response.raise_for_status()
        return response.json()
    path = DATA_ROOT / "accounts.json"
    return json.loads(path.read_text(encoding="utf-8")) if path.is_file() else {"groups": [], "members": []}


def credential(ref: str) -> dict:
    raw = os.getenv("PUBLISHING_CREDENTIALS_JSON", "").strip()
    path = Path(os.getenv("PUBLISHING_CREDENTIALS_FILE", "") or DATA_ROOT / "credentials.json")
    # 容器挂载同一工作区时，将宿主 Windows 凭据路径映射到子仓库的数据目录。
    configured = str(path).replace("\\", "/")
    marker = "/integrations/media-publisher/data/"
    if Path("/.dockerenv").exists() and re.match(r"^[A-Za-z]:/", configured) and marker in configured:
        mapped = (DATA_ROOT / configured.split(marker, 1)[1]).resolve()
        if not mapped.is_relative_to(DATA_ROOT.resolve()):
            raise ValueError("发布凭据路径超出数据目录")
        path = mapped
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
            from googleapiclient.discovery import build
            from google_auth_httplib2 import AuthorizedHttp
            from .youtube.publish_to_youtube import _load_credentials, YouTubeHttp
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
