"""读取矩媒 data/<账号组>/.env。不读取 media-factory 的环境文件。"""

from __future__ import annotations

import os
from pathlib import Path

from dotenv import load_dotenv


def matrix_data_root() -> Path:
    return Path(os.getenv("MEDIA_PUBLISHER_DIR", Path.cwd())) / "data"


def load_matrix_group_envs() -> None:
    root = matrix_data_root()
    if not root.is_dir():
        return
    for child in sorted(root.iterdir()):
        env_file = child / ".env"
        if child.is_dir() and env_file.is_file():
            load_dotenv(env_file, override=True)


def accounts_with_suffix(suffix: str, account: str | None = None) -> list[tuple[str, str]]:
    wanted = str(account or "").strip().lower()
    found = []
    from .account_registry import env_items
    for key, value in env_items():
        text = str(value or "").strip()
        if not key.endswith(suffix) or not text:
            continue
        slug = key[: -len(suffix)].lower()
        if not slug or (wanted and slug != wanted):
            continue
        found.append((slug, text))
    return sorted(found, key=lambda item: item[0])
