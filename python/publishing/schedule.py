"""按平台把 now / 带时区 ISO 时间转成实际发布参数。"""

from __future__ import annotations

from datetime import datetime
from zoneinfo import ZoneInfo

from .platforms import PlatformSpec, PublishError

BEIJING = ZoneInfo("Asia/Shanghai")


def _beijing_iso(moment: datetime) -> str:
    return moment.astimezone(BEIJING).replace(microsecond=0).isoformat()


def _beijing_wall(moment: datetime) -> str:
    return moment.astimezone(BEIJING).strftime("%Y-%m-%d %H:%M:%S")


def _parse_zoned(value: str) -> datetime:
    text = str(value or "").strip()
    try:
        parsed = datetime.fromisoformat(text.replace("Z", "+00:00"))
    except ValueError as exc:
        raise PublishError("预约时间必须是带时区的 ISO 8601，例如 2026-10-15T20:00:00+08:00") from exc
    if parsed.tzinfo is None or parsed.utcoffset() is None:
        raise PublishError("预约时间必须包含时区，北京时间使用 +08:00")
    if parsed <= datetime.now(BEIJING):
        raise PublishError("预约时间必须是未来时间；立即发布请传 now")
    return parsed


def _timing(spec: PlatformSpec, mode: str, raw: str) -> dict:
    if mode == "immediate":
        if str(raw or "").strip().casefold() != "now":
            raise PublishError(f"平台 {spec.code} 立即发布时时间必须是 now")
        return {
            "platform": spec.code,
            "publish_mode": "immediate",
            "publish_at": _beijing_iso(datetime.now(BEIJING)),
            "cli_publish_at": None,
        }
    if spec.schedule == "unsupported":
        raise PublishError(f"{spec.label}不支持平台官方定时，只能立即发布")
    scheduled = _parse_zoned(raw)
    if spec.schedule == "browser_official":
        cli_value = _beijing_wall(scheduled)
    else:
        cli_value = str(raw).strip()
    return {
        "platform": spec.code,
        "publish_mode": "scheduled",
        "publish_at": _beijing_iso(scheduled),
        "cli_publish_at": cli_value,
    }


def resolve_timings(
    platforms: list[PlatformSpec],
    publish_mode: str | None,
    publish_at: str | None,
    by_platform: dict | None,
) -> dict[str, dict]:
    """解析各平台发布时间。映射里的 now 表示立即发布，ISO 时间表示预约。"""
    configured: dict[str, str] = {}
    if by_platform:
        if not isinstance(by_platform, dict):
            raise PublishError("publish_at_by_platform 必须是对象")
        from .platforms import resolve_platform

        for key, value in by_platform.items():
            spec = resolve_platform(str(key))
            configured[spec.code] = str(value or "").strip()
    selected = {spec.code for spec in platforms}
    unknown = sorted(set(configured) - selected)
    if unknown:
        raise PublishError(f"publish_at_by_platform 包含未选择的平台：{'、'.join(unknown)}")
    timings: dict[str, dict] = {}
    for spec in platforms:
        override = configured.get(spec.code)
        if override:
            mode = "immediate" if override.casefold() == "now" else "scheduled"
            timings[spec.code] = _timing(spec, mode, override)
            continue
        mode_text = str(publish_mode or "").strip().casefold()
        at_text = str(publish_at or "").strip()
        if not mode_text or not at_text:
            raise PublishError(
                f"平台 {spec.code} 没有发布时间；请传 publish_at_by_platform，或同时提供 publish_mode 与 publish_at"
            )
        if mode_text not in {"immediate", "scheduled"}:
            raise PublishError("publish_mode 只能是 immediate 或 scheduled")
        timings[spec.code] = _timing(spec, mode_text, at_text)
    return timings
