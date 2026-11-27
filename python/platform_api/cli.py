"""矩媒官方平台命令行：账号查询与发布。"""

from __future__ import annotations

import argparse
import json
import sys

from platform_api.facebook.publish_to_facebook import (
    list_facebook_accounts,
    publish_to_facebook,
)
from platform_api.instagram.publish_to_instagram import (
    list_instagram_accounts,
    publish_to_instagram,
)
from platform_api.tiktok.publish_to_tiktok import (
    list_tiktok_accounts,
    publish_to_tiktok,
)
from platform_api.youtube.publish_to_youtube import (
    list_youtube_accounts,
    publish_to_youtube,
)


def _dump(payload: dict | list) -> None:
    sys.stdout.write(json.dumps(payload, ensure_ascii=False) + "\n")


def _accounts(group: str, platform: str | None = None) -> list[dict]:
    rows = []
    for item in (list_youtube_accounts(group) if platform in (None, "youtube") else []):
        rows.append({
            "platform": "youtube",
            "account_ref": item["account"],
            "account_id": item["channel_id"],
            "platform_account_id": item["channel_id"],
            "display_name": item["channel_title"],
        })
    for item in (list_tiktok_accounts(group) if platform in (None, "tiktok") else []):
        rows.append({
            "platform": "tiktok",
            "account_ref": item["account"],
            "account_id": item["account_id"],
            "platform_account_id": item["platform_account_id"],
            "display_name": item["account_title"],
        })
    for item in (list_instagram_accounts(group) if platform in (None, "instagram") else []):
        rows.append({
            "platform": "instagram",
            "account_ref": item["account"],
            "account_id": item["user_id"],
            "platform_account_id": item["platform_account_id"],
            "display_name": item["account_title"],
        })
    for item in (list_facebook_accounts(group) if platform in (None, "facebook") else []):
        rows.append({
            "platform": "facebook",
            "account_ref": item["account"],
            "account_id": item["page_id"],
            "platform_account_id": item["platform_account_id"],
            "display_name": item["page_name"],
        })
    return rows


def _publish(args: argparse.Namespace) -> dict:
    """独立命令从 Publisher 目录解析账号与凭据引用。"""
    from publishing.platforms import resolve_platform

    from .account_registry import account_context, registry

    data = registry()
    codes = {row["code"] for row in data["groups"] if row["name"] == args.phone and row.get("enabled", True)}
    platform = resolve_platform(args.platform).code
    matches = [row for row in data["members"] if row["group_code"] in codes
               and row["platform"] == platform and row.get("enabled", True)
               and args.account_id in {row.get("account_key"), row.get("connector_account_id")}]
    if len(matches) > 1:
        raise ValueError("账号匹配不唯一，请指定 account_key")
    if matches:
        row = matches[0]
        with account_context(row) as key:
            return _publish_with_credentials(argparse.Namespace(**{**vars(args), "phone": key, "account_id": row["connector_account_id"]}))
    return _publish_with_credentials(args)


def _publish_with_credentials(args: argparse.Namespace) -> dict:
    from publishing.platforms import resolve_platform
    platform = resolve_platform(args.platform).code
    group = str(args.phone).strip()
    account_id = str(args.account_id).strip()
    publish_at = str(args.publish_at or "").strip() or None
    if platform == "youtube":
        return publish_to_youtube(
            account_id,
            args.file,
            args.title,
            description=args.description or "",
            account=group,
            privacy_status=args.privacy,
            category_id=args.category_id, language=args.language,
            made_for_kids=args.made_for_kids, thumbnail_path=args.thumbnail_path or None,
            publish_at=publish_at,
            publication_id=args.publication_id or "",
        )
    if platform == "tiktok":
        return publish_to_tiktok(
            account_id,
            args.video_url,
            args.description or "",
            account=group,
            publish_at=publish_at,
        )
    if platform == "instagram":
        return publish_to_instagram(account_id, args.video_url, args.description or "", publish_at=publish_at)
    if platform == "facebook":
        return publish_to_facebook(
            account_id,
            args.video_url,
            args.description or "",
            title=args.title or "",
            publish_at=publish_at,
        )
    raise ValueError(f"不支持的官方平台：{platform}")


def main() -> None:
    parser = argparse.ArgumentParser(description="矩媒官方平台发布")
    sub = parser.add_subparsers(dest="command", required=True)

    accounts = sub.add_parser("accounts")
    accounts.add_argument("--group", required=True)

    publish = sub.add_parser("publish")
    publish.add_argument("-p", "--platform", required=True)
    publish.add_argument("--phone", required=True)
    publish.add_argument("--account-id", required=True)
    publish.add_argument("-f", "--file", default="")
    publish.add_argument("--video-url", default="")
    publish.add_argument("--title", default="")
    publish.add_argument("--description", default="")
    publish.add_argument("--publish-at", default="")
    publish.add_argument("--publication-id", default="")
    publish.add_argument("--privacy", default="public")

    publish.add_argument("--category-id", default="24")
    publish.add_argument("--language", default="zh")
    publish.add_argument("--made-for-kids", action="store_true")
    publish.add_argument("--thumbnail-path", default="")

    args = parser.parse_args()
    try:
        if args.command == "accounts":
            _dump(_accounts(args.group))
            return
        _dump(_publish(args))
    except Exception as exc:
        _dump({"error": str(exc)})
        sys.exit(1)


if __name__ == "__main__":
    main()
