"""发布平台。预约方式和命令行平台码只在这里定义。"""

from __future__ import annotations

from dataclasses import dataclass

@dataclass(frozen=True)
class PlatformSpec:
    code: str
    cli: str
    label: str
    connector: str
    schedule: str
    partition_name: str
    qr_login: bool

_PLATFORMS = (
    PlatformSpec("douyin", "dy", "抖音", "browser", "browser_official", "抖音", True),
    PlatformSpec("kuaishou", "ks", "快手", "browser", "browser_official", "快手", True),
    PlatformSpec("toutiao", "tt", "头条", "browser", "browser_official", "头条", True),
    PlatformSpec("wechat_channels", "sph", "视频号", "browser", "browser_official", "视频号", True),
    PlatformSpec("bilibili", "blbl", "哔哩哔哩", "browser", "browser_official", "哔哩哔哩", True),
    PlatformSpec("youtube", "youtube", "YouTube", "official", "api_official", "", False),
    PlatformSpec("tiktok", "tiktok", "TikTok", "official", "api_official", "", False),
    PlatformSpec("instagram", "instagram", "Instagram", "official", "api_official", "", False),
    PlatformSpec("facebook", "facebook", "Facebook", "official", "api_official", "", False),
)

_ALIASES: dict[str, PlatformSpec] = {}
for _spec in _PLATFORMS:
    for _alias in (_spec.code, _spec.cli, _spec.label, _spec.partition_name):
        if _alias:
            _ALIASES[_alias.casefold()] = _spec
_ALIASES["yt"] = _ALIASES["youtube"]
_ALIASES["ytb"] = _ALIASES["youtube"]
_ALIASES["tk"] = _ALIASES["tiktok"]
_ALIASES["ig"] = _ALIASES["instagram"]
_ALIASES["ins"] = _ALIASES["instagram"]
_ALIASES["fb"] = _ALIASES["facebook"]
_ALIASES["头条号"] = _ALIASES["toutiao"]

class PublishError(Exception):
    """发布参数或账号组不满足统一发布要求。"""

def resolve_platform(raw: str) -> PlatformSpec:
    spec = _ALIASES.get(str(raw or "").strip().casefold())
    if spec is None:
        raise PublishError(f"未知平台：{raw}")
    return spec

def describe_platform(raw: str) -> dict:
    spec = resolve_platform(raw)
    return {
        "code": spec.code,
        "cli": spec.cli,
        "label": spec.label,
        "connector": spec.connector,
        "schedule": spec.schedule,
        "qr_login": spec.qr_login,
        "official": spec.connector == "official",
    }
