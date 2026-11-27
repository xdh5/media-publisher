"""为独立 Publisher 的 YouTube 频道生成 OAuth 凭据。"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import time
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from urllib.parse import urlparse

from google.oauth2.credentials import Credentials
from googleapiclient.discovery import build
from google_auth_oauthlib.flow import InstalledAppFlow


YOUTUBE_SCOPES = [
    "https://www.googleapis.com/auth/youtube.upload",
    "https://www.googleapis.com/auth/youtube.readonly",
    "https://www.googleapis.com/auth/youtube.force-ssl",
]

STATE_NAME = "oauth_state.json"
CALLBACK_NAME = "callback.url"


def _dir_of(path: Path) -> Path:
    return path.parent


def _open_system_browser(url: str) -> str:
    candidates = [
        Path(os.environ.get("PROGRAMFILES", r"C:\Program Files")) / "Google/Chrome/Application/chrome.exe",
        Path(os.environ.get("PROGRAMFILES", r"C:\Program Files")) / "Microsoft/Edge/Application/msedge.exe",
        Path(os.environ.get("PROGRAMFILES(X86)", r"C:\Program Files (x86)")) / "Microsoft/Edge/Application/msedge.exe",
    ]
    for exe in candidates:
        if exe.is_file():
            subprocess.Popen([str(exe), url], close_fds=True)
            return str(exe)
    subprocess.Popen(["cmd", "/c", "start", "", url])
    return "default"


def _save_credentials(flow: InstalledAppFlow, output: Path) -> None:
    credentials = flow.credentials
    output.write_text(credentials.to_json(), encoding="utf-8")
    if not credentials.refresh_token:
        raise SystemExit("这次授权没有返回 refresh_token，请撤掉应用权限后再授权一次")
    print(f"授权凭据已保存到：{output}", flush=True)


def _complete_with_callback(client_secret: Path, state_path: Path, callback: str, output: Path) -> None:
    state = json.loads(state_path.read_text(encoding="utf-8"))
    flow = InstalledAppFlow.from_client_secrets_file(str(client_secret), scopes=YOUTUBE_SCOPES)
    flow.redirect_uri = state["redirect_uri"]
    flow.code_verifier = state["code_verifier"]
    os.environ["OAUTHLIB_INSECURE_TRANSPORT"] = "1"
    flow.fetch_token(authorization_response=callback.strip())
    _save_credentials(flow, output)


def main() -> None:
    os.environ["OAUTHLIB_INSECURE_TRANSPORT"] = "1"
    parser = argparse.ArgumentParser(description="生成单个 YouTube 频道的 OAuth 凭据")
    parser.add_argument("--client-secret", type=Path)
    parser.add_argument("--output", type=Path)
    parser.add_argument("--inspect-token", type=Path)
    parser.add_argument("--configure-env", type=Path)
    parser.add_argument("--token-file", type=Path)
    parser.add_argument("--account", default="language_learning")
    parser.add_argument("--channel-id", default="")
    parser.add_argument("--channel-title", default="")
    parser.add_argument("--port", type=int, default=18765)
    parser.add_argument("--callback", default="", help="把 404 页地址栏完整 URL 粘贴过来即可换票")
    args = parser.parse_args()

    if args.configure_env:
        if not args.client_secret or not args.token_file or not args.channel_id:
            parser.error("写入环境配置时必须提供 --client-secret、--token-file 和 --channel-id")
        client_payload = json.loads(args.client_secret.read_text(encoding="utf-8"))
        client = client_payload.get("installed") or client_payload.get("web") or {}
        token = json.loads(args.token_file.read_text(encoding="utf-8"))
        prefix = args.account.strip().upper()
        updates = {
            "YOUTUBE_OAUTH_CLIENT_ID": str(client.get("client_id") or ""),
            "YOUTUBE_OAUTH_CLIENT_SECRET": str(client.get("client_secret") or ""),
            f"{prefix}_YOUTUBE_CHANNEL_ID": args.channel_id.strip(),
            f"{prefix}_YOUTUBE_CHANNEL_TITLE": args.channel_title.strip(),
            f"{prefix}_YOUTUBE_REFRESH_TOKEN": str(token.get("refresh_token") or ""),
        }
        missing = [name for name, value in updates.items() if not value and not name.endswith("_CHANNEL_TITLE")]
        if missing:
            parser.error(f"缺少必要凭据：{', '.join(missing)}")
        lines = args.configure_env.read_text(encoding="utf-8").splitlines() if args.configure_env.is_file() else []
        written = set()
        output = []
        for line in lines:
            key = line.split("=", 1)[0].strip() if "=" in line else ""
            if key in updates:
                output.append(f"{key}={updates[key]}")
                written.add(key)
            else:
                output.append(line)
        if output and output[-1]:
            output.append("")
        for key, value in updates.items():
            if key not in written:
                output.append(f"{key}={value}")
        args.configure_env.write_text("\n".join(output).rstrip() + "\n", encoding="utf-8")
        print("已写入本地 YouTube 配置：" + "、".join(updates))
        return

    if args.inspect_token:
        credentials = Credentials.from_authorized_user_file(
            str(args.inspect_token),
            scopes=YOUTUBE_SCOPES,
        )
        with build("youtube", "v3", credentials=credentials) as youtube:
            response = youtube.channels().list(part="id,snippet", mine=True).execute()
        channels = [
            {"channel_id": item["id"], "channel_title": item["snippet"]["title"]}
            for item in response.get("items", [])
        ]
        print(json.dumps(channels, ensure_ascii=False))
        return

    if not args.client_secret or not args.output:
        parser.error("生成授权时必须同时提供 --client-secret 和 --output")

    state_path = _dir_of(args.output) / STATE_NAME
    callback_path = _dir_of(args.output) / CALLBACK_NAME

    if args.callback:
        if not state_path.is_file():
            parser.error(f"找不到 {state_path}，需要先重新生成授权链接")
        _complete_with_callback(args.client_secret, state_path, args.callback, args.output)
        return

    redirect_uri = f"http://127.0.0.1:{args.port}/"
    flow = InstalledAppFlow.from_client_secrets_file(str(args.client_secret), scopes=YOUTUBE_SCOPES)
    flow.redirect_uri = redirect_uri
    auth_url, _ = flow.authorization_url(
        access_type="offline",
        prompt="consent",
        include_granted_scopes="true",
    )
    state_path.write_text(
        json.dumps(
            {
                "redirect_uri": redirect_uri,
                "code_verifier": flow.code_verifier,
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )
    if callback_path.exists():
        callback_path.unlink()

    class Handler(BaseHTTPRequestHandler):
        last_url = ""

        def do_GET(self) -> None:
            Handler.last_url = f"{redirect_uri.rstrip('/')}{self.path}"
            body = "<!doctype html><meta charset=utf-8><p>YouTube 授权成功，可以关闭此页面。</p>".encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, format: str, *log_args) -> None:
            print(format % log_args, flush=True)

    server = HTTPServer(("127.0.0.1", args.port), Handler)
    server.timeout = 1
    browser = _open_system_browser(auth_url)
    print(f"已用系统浏览器打开：{browser}", flush=True)
    print("请用 Chrome 或 Edge 登录 Daily Chinese Learning 并点允许。", flush=True)
    print("如果又是 404，把地址栏完整 URL 发给我，或写入：", callback_path, flush=True)
    print(auth_url, flush=True)

    deadline = time.time() + 600
    callback = ""
    while time.time() < deadline and not callback:
        server.handle_request()
        if Handler.last_url and "code=" in Handler.last_url:
            callback = Handler.last_url
            break
        if callback_path.is_file():
            text = callback_path.read_text(encoding="utf-8").strip()
            if "code=" in text:
                callback = text
                break
    server.server_close()
    if not callback:
        raise SystemExit("10 分钟内没有收到回调。404 时把地址栏完整链接发给我即可。")

    flow.fetch_token(authorization_response=callback)
    _save_credentials(flow, args.output)


if __name__ == "__main__":
    main()
