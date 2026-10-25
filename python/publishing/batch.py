"""把多条视频发到一个账号组的多个平台。"""

from __future__ import annotations

from .accounts import resolve_group_accounts
from .platforms import PublishError, PlatformSpec, resolve_platform
from .runner import run_browser_publish
from .schedule import resolve_timings


def _text(value: object) -> str:
    return str(value or "").strip()


def _target_from_item(item: dict, platform: str) -> dict:
    if not isinstance(item, dict):
        raise PublishError("视频条目必须是对象")
    title = _text(item.get("title"))
    if not title:
        raise PublishError("视频缺少 title")
    return {
        "platform": platform,
        "account_key": _text(item.get("account_key")),
        "title": title,
        "description": _text(item.get("description")),
        "file": _text(item.get("file")),
        "thumbnail_path": _text(item.get("thumbnail_path")),
        "video_url": _text(item.get("video_url")),
        "tags": _text(item.get("tags")),
        "bt2": _text(item.get("bt2") or item.get("short_title")),
        "publication_id": _text(item.get("publication_id")),
        "creative_statement": _text(item.get("creative_statement") or item.get("creativeStatement")),
        "draft": item.get("draft") is True,
        "sph_product_id": _text(item.get("sph_product_id") or item.get("sphProductId")),
        "client_ref": _text(item.get("client_ref")),
    }


def expand_request(request: dict) -> list[dict]:
    """items × platforms 展开成逐条目标。已经带 targets 时直接使用。"""
    if not isinstance(request, dict):
        raise PublishError("发布请求必须是对象")
    raw_targets = request.get("targets")
    if raw_targets is not None:
        if not isinstance(raw_targets, list) or not raw_targets:
            raise PublishError("targets 至少要有一条")
        targets = []
        for item in raw_targets:
            if not isinstance(item, dict):
                raise PublishError("targets 中的每一项必须是对象")
            targets.append(_target_from_item(item, resolve_platform(item.get("platform")).code))
        return targets
    platforms = request.get("platforms")
    items = request.get("items")
    if not isinstance(platforms, list) or not platforms:
        raise PublishError("platforms 至少要指定一个平台")
    if not isinstance(items, list) or not items:
        raise PublishError("items 至少要有一条视频")
    specs = []
    for name in platforms:
        spec = resolve_platform(name)
        if spec not in specs:
            specs.append(spec)
    targets = []
    for item in items:
        for spec in specs:
            targets.append(_target_from_item(item if isinstance(item, dict) else {}, spec.code))
    return targets


def _check_target(target: dict, spec: PlatformSpec) -> None:
    if (spec.connector == "browser" or spec.code == "youtube") and not target["file"]:
        raise PublishError(f"发布到 {spec.code} 需要本地 file")
    if spec.connector == "official" and spec.code != "youtube" and not target["video_url"]:
        raise PublishError(f"发布到 {spec.code} 需要公网 video_url")
    if spec.code == "wechat_channels" and target["bt2"]:
        length = len(target["bt2"])
        if length < 6 or length > 16:
            raise PublishError(f"视频号短标题须为 6～16 字，当前 {length} 字：{target['title']}")


def _publish_official(target: dict, account: dict, spec: PlatformSpec, timing: dict) -> dict:
    if account.get("credential_ref"):
        from platform_api.account_registry import account_context
        with account_context(account) as key:
            return _publish_official_with_context(target, {**account, "account_group": key}, spec, timing)
    return _publish_official_with_context(target, account, spec, timing)


def _publish_official_with_context(target: dict, account: dict, spec: PlatformSpec, timing: dict) -> dict:
    from platform_api.facebook.publish_to_facebook import publish_to_facebook
    from platform_api.instagram.publish_to_instagram import publish_to_instagram
    from platform_api.tiktok.publish_to_tiktok import publish_to_tiktok
    from platform_api.youtube.publish_to_youtube import publish_to_youtube

    publish_at = timing["cli_publish_at"]
    description = target["description"] or target["title"]
    if spec.code == "youtube":
        return publish_to_youtube(
            account["account_id"],
            target["file"],
            target["title"],
            description=description,
            account=account["account_group"],
            privacy_status="public",
            publish_at=publish_at,
            publication_id=target["publication_id"],
            thumbnail_path=target["thumbnail_path"] or None,
        )
    if spec.code == "tiktok":
        return publish_to_tiktok(
            account["account_id"],
            target["video_url"],
            description,
            account=account["account_group"],
            publish_at=publish_at,
        )
    if spec.code == "instagram":
        return publish_to_instagram(account["account_id"], target["video_url"], description, publish_at=publish_at)
    if spec.code == "facebook":
        return publish_to_facebook(
            account["account_id"],
            target["video_url"],
            target["description"],
            title=target["title"],
            publish_at=publish_at,
        )
    raise PublishError(f"不支持的官方平台：{spec.code}")


def _publish_browser(target: dict, account: dict, spec: PlatformSpec, timing: dict) -> dict:
    if target["draft"] and timing["publish_mode"] == "scheduled":
        raise PublishError(f"{spec.label}预约发布不能同时保存草稿")
    arguments = [
        "publish", "-p", spec.cli,
        "-f", target["file"],
        "--title", target["title"],
        "--description", target["description"] or target["title"],
        "--name", target["title"],
        "--phone", account["account_group"],
        "--creative-statement", target["creative_statement"] or "ai_generated",
    ]
    if target["tags"]:
        arguments.extend(["--tags", target["tags"]])
    if target["bt2"]:
        arguments.extend(["--bt2", target["bt2"]])
    if timing["cli_publish_at"]:
        arguments.extend(["--publish-at", timing["cli_publish_at"]])
    if target["draft"]:
        arguments.append("--draft")
    if spec.code == "wechat_channels" and target["sph_product_id"]:
        arguments.extend(["--sph-product-id", target["sph_product_id"]])
    payload = run_browser_publish(arguments)
    status = str(payload.get("resultStatus") or payload.get("status") or "success")
    if payload.get("status") is False or status in {"needs_attention", "failed", "failure"}:
        raise RuntimeError(f"{spec.label}发布未成功：{payload.get('message') or status}")
    if timing["publish_mode"] == "scheduled" and spec.schedule == "browser_official" and payload.get("officialScheduled") is not True:
        raise RuntimeError(f"{spec.label}未确认平台官方预约成功，不能把应用内定时记为成功")
    return payload


def publish_batch(request: dict, progress=None, *, account_routes: dict | None = None) -> dict:
    """发布 targets，或把 items 发到全部 platforms。单条失败不会中断其余目标。"""
    account_group = str((request or {}).get("account_group") or "").strip()
    if not account_group:
        raise PublishError("account_group 不能为空")
    targets = expand_request(request)
    specs = []
    for target in targets:
        spec = resolve_platform(target["platform"])
        _check_target(target, spec)
        if spec not in specs:
            specs.append(spec)
    timings = resolve_timings(
        specs,
        request.get("publish_mode"),
        request.get("publish_at"),
        request.get("publish_at_by_platform"),
    )
    accounts = account_routes or resolve_group_accounts(account_group, specs)
    expanded = []
    for target in targets:
        if target["account_key"]:
            expanded.append(target)
            continue
        matches = {
            row["account_key"]: row for row in accounts.values()
            if row.get("account_key") and row.get("platform") == target["platform"]
        }
        if matches:
            expanded.extend({**target, "account_key": key} for key in matches)
        else:
            expanded.append(target)
    targets = expanded
    published = []
    failed = []
    total = len(targets)
    for index, target in enumerate(targets, start=1):
        spec = resolve_platform(target["platform"])
        timing = timings[spec.code]
        if target["draft"] and timing["publish_mode"] == "scheduled":
            failed.append({
                "platform": spec.code,
                "title": target["title"],
                "client_ref": target["client_ref"],
                "error": f"{spec.label}预约发布不能同时保存草稿",
            })
            continue
        if progress:
            progress(f"正在发布 {index}/{total}：{spec.code} - {target['title']}")
        try:
            account = accounts.get(target["account_key"] or spec.code)
            if not account:
                raise PublishError(f"请为 {spec.label} 指定唯一的 account_key")
            if account.get("platform") and account["platform"] != spec.code:
                raise PublishError(f"账号 {target['account_key']} 不属于 {spec.label}")
            if account.get("error"):
                raise PublishError(str(account["error"]))
            if spec.connector == "official":
                result = _publish_official(target, account, spec, timing)
            else:
                result = _publish_browser(target, account, spec, timing)
        except Exception as exc:
            failed.append({
                "platform": spec.code,
                "title": target["title"],
                "client_ref": target["client_ref"],
                "error": str(exc),
            })
            continue
        published.append({
            "platform": spec.code,
            "title": target["title"],
            "client_ref": target["client_ref"],
            "account_id": account["account_id"],
            "platform_account_id": account["platform_account_id"],
            "account_key": account.get("account_key", ""),
            "publish_mode": timing["publish_mode"],
            "publish_at": timing["publish_at"],
            "result": result,
        })
    if not published and failed:
        status = "failed"
    elif failed:
        status = "partial"
    else:
        status = "success"
    return {
        "status": status,
        "account_group": account_group,
        "publish_timings": timings,
        "published": published,
        "failed": failed,
    }
