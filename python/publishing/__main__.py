"""统一发布命令：accounts、groups、platform、publish。"""

from __future__ import annotations

import argparse
import json
import sys

from .accounts import list_account_groups, list_data_groups
from .batch import publish_batch
from .platforms import PublishError, describe_platform


def _dump(payload) -> None:
    sys.stdout.write(json.dumps(payload, ensure_ascii=False) + "\n")


def _progress(text: str) -> None:
    sys.stderr.write(f"MM_PROGRESS\t{text}\n")
    sys.stderr.flush()


def main() -> None:
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser(description="矩媒统一发布")
    sub = parser.add_subparsers(dest="command", required=True)
    accounts = sub.add_parser("accounts")
    accounts.add_argument("--group", default="")
    accounts.add_argument("--platform", default="")
    sub.add_parser("groups")
    platform = sub.add_parser("platform")
    platform.add_argument("name")
    sub.add_parser("publish")
    sub.add_parser("configure-accounts")
    args = parser.parse_args()
    try:
        if args.command == "configure-accounts":
            from platform_api.account_registry import save_registry
            _dump(save_registry(json.load(sys.stdin)))
            return
        if args.command == "groups":
            _dump(list_data_groups())
            return
        if args.command == "platform":
            _dump(describe_platform(args.name))
            return
        if args.command == "accounts":
            _dump({
                "account_groups": list_account_groups(args.group or None, args.platform or None),
            })
            return
        request = json.load(sys.stdin)
        _dump(publish_batch(request, progress=_progress))
    except PublishError as exc:
        _dump({"error": str(exc)})
        sys.exit(2)
    except Exception as exc:
        _dump({"error": str(exc)})
        sys.exit(1)


if __name__ == "__main__":
    main()
