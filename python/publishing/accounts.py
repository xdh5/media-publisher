"""从 data/<账号组> 读取浏览器会话和官方平台账号。"""

from __future__ import annotations

import os
from pathlib import Path

from .platforms import PublishError, resolve_platform
from .runner import matrix_root

_OFFICIAL_ENV_SUFFIXES = (
    "_YOUTUBE_CHANNEL_ID",
    "_TIKTOK_ACCOUNT_ID",
    "_INSTAGRAM_ACCOUNT_ID",
    "_FACEBOOK_ACCOUNT_ID",
)


def data_root() -> Path:
    return matrix_root() / "data"


def list_data_groups() -> list[str]:
    from platform_api.account_registry import registry
    configured = [str(row["name"]) for row in registry()["groups"] if row.get("enabled", True)]
    root = data_root()
    if not root.is_dir():
        return configured
    return sorted(set(configured + [item.name for item in root.iterdir() if item.is_dir() and ((item / "Partitions").is_dir() or (item / ".env").is_file())]))


def _official_env_ready(group: str) -> bool:
    """检查显式传入的账号组凭据环境变量。"""
    for key, value in os.environ.items():
        if not str(value or "").strip():
            continue
        for suffix in _OFFICIAL_ENV_SUFFIXES:
            if key.endswith(suffix) and key[: -len(suffix)].lower() == group:
                return True
    return False


def require_group(name: str) -> str:
    group = str(name or "").strip().casefold()
    import re
    if not re.fullmatch(r"[a-z][a-z0-9_]{0,63}", group):
        raise PublishError(f"账号组「{name}」标识无效")
    from platform_api.account_registry import registry
    if any(row["name"] == group and not row.get("enabled", True) for row in registry()["groups"]):
        raise PublishError(f"账号组「{group}」已停用")
    if group in list_data_groups():
        return group
    if (data_root() / group).is_dir() or _official_env_ready(group):
        return group
    groups = list_data_groups()
    if groups:
        raise PublishError(f"账号组「{name}」不在 data 中。现有账号组：{'、'.join(groups)}")
    raise PublishError("未配置账号组或对应的官方账号")


def _browser_accounts(group: str) -> list[dict]:
    directory = data_root() / group / "Partitions"
    if not directory.is_dir():
        return []
    accounts = []
    for entry in directory.iterdir():
        if not entry.is_dir():
            continue
        decoded = entry.name
        try:
            from urllib.parse import unquote

            decoded = unquote(entry.name)
        except Exception:
            decoded = entry.name
        if not decoded.startswith(group):
            continue
        try:
            spec = resolve_platform(decoded[len(group):])
        except PublishError:
            continue
        if spec.connector != "browser":
            continue
        accounts.append({
            "platform": spec.code,
            "label": spec.label,
            "connector": "browser",
            "account_group": group,
            "account_ref": group,
            "account_id": group,
            "platform_account_id": group,
            "display_name": group,
            "partition": f"persist:{group}{spec.partition_name}",
        })
    return accounts


def _official_accounts(group: str, platforms: set[str] | None = None) -> tuple[list[dict], str]:
    from platform_api.account_registry import registry, verify_account
    data = registry()
    codes = {row["code"] for row in data["groups"] if row["name"] == group and row.get("enabled", True)}
    members = [row for row in data["members"] if row["group_code"] in codes and row.get("account_key") and row.get("enabled", True)
               and resolve_platform(row["platform"]).connector == "official"
               and (platforms is None or row["platform"] in platforms)]
    if members:
        accounts = []
        for row in members:
            route = {**row, "account_group": group, "account_id": row["connector_account_id"]}
            try:
                accounts.append({**route, **verify_account(row)})
            except Exception as exc:
                accounts.append({**route, "error": str(exc)})
        return accounts, ""
    try:
        from platform_api.cli import _accounts as list_official_rows
        from platform_api.group_env import load_matrix_group_envs
        load_matrix_group_envs()
        rows = []
        for suffix in _OFFICIAL_ENV_SUFFIXES:
            platform = suffix[1:].split("_ACCOUNT_ID")[0].split("_CHANNEL_ID")[0].lower()
            if (platforms is None or platform in platforms) and os.getenv(group.upper() + suffix, "").strip():
                rows.extend(list_official_rows(group, platform=platform))
    except Exception as exc:
        return [], str(exc)
    accounts = []
    for row in rows:
        if not isinstance(row, dict):
            continue
        try:
            spec = resolve_platform(str(row.get("platform") or ""))
        except PublishError:
            continue
        account_id = str(row.get("account_id") or "").strip()
        if not account_id:
            continue
        accounts.append({
            "platform": spec.code,
            "label": spec.label,
            "connector": "official",
            "account_group": group,
            "account_ref": str(row.get("account_ref") or group).strip() or group,
            "account_id": account_id,
            "platform_account_id": str(row.get("platform_account_id") or account_id).strip(),
            "display_name": str(row.get("display_name") or account_id).strip(),
            "partition": "",
        })
    return accounts, ""


def list_account_groups(account_group: str | None = None, platform: str | None = None, *, selected_platforms: set[str] | None = None) -> list[dict]:
    groups = [require_group(account_group)] if account_group else list_data_groups()
    wanted = resolve_platform(platform).code if platform else ""
    snapshots = []
    for group in groups:
        official, error = _official_accounts(group, selected_platforms or ({wanted} if wanted else None))
        accounts = [
            item for item in [*_browser_accounts(group), *official]
            if not wanted or item["platform"] == wanted
        ]
        accounts.sort(key=lambda item: item["platform"])
        snapshots.append({
            "account_group": group,
            "accounts": accounts,
            "official_error": error,
        })
    return snapshots


def resolve_group_accounts(account_group: str, platforms: list) -> dict[str, dict]:
    snapshots = list_account_groups(account_group, selected_platforms={spec.code for spec in platforms})
    snapshot = snapshots[0]
    routes = {}
    for spec in platforms:
        matches = [item for item in snapshot["accounts"] if item["platform"] == spec.code]
        for item in matches:
            if item.get("account_key"):
                routes[item["account_key"]] = item
        if len(matches) != 1:
            if not matches:
                routes[spec.code] = {"error": snapshot["official_error"] or f"账号组「{account_group}」缺少 {spec.label} 账号"}
            continue
        routes[spec.code] = matches[0]
    return routes
