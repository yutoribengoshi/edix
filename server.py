#!/usr/bin/env python3
"""
法律文書向け汎用Markdownプレビュアー（Claude Code 統合）

使い方:
    python3 server.py [target_dir]

target_dir を省略するとカレントディレクトリ。
ポートは 8765 から開始、衝突時は自動インクリメント。
"""
import os
import sys
import json
import time
import threading
import argparse
import re
from datetime import datetime
from pathlib import Path
from http.server import HTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse, unquote, parse_qs

import markdown

# ============================================================
# 設定
# ============================================================
DEFAULT_PORT = 8765
PORT_RANGE = 50  # 衝突時に試すポート数
SCRIPT_DIR = Path(__file__).resolve().parent
STATIC_DIR = SCRIPT_DIR / "static"
POLL_INTERVAL = 1.0  # ファイル監視ポーリング間隔（秒）

# バックアップ設定
BACKUP_DIR_NAME = ".edix-backup"
BACKUP_KEEP_GENERATIONS = 100  # 直近何世代まで保持
BACKUP_KEEP_DAYS = 30  # 何日経過したら削除

MD_EXTENSIONS = [
    'extra',           # tables, fenced_code, footnotes, etc.
    'toc',             # 目次
    'sane_lists',
    'pymdownx.tilde',  # ~~strikethrough~~
    'pymdownx.tasklist',
]

# ============================================================
# グローバル状態
# ============================================================
TARGET_DIR: Path = Path.cwd()
SSE_CLIENTS: list = []  # SSE 接続中のレスポンスストリーム
FILE_MTIMES: dict = {}  # path -> mtime
LOCK = threading.Lock()


# ============================================================
# Markdown レンダリング
# ============================================================
def add_paragraph_ids(html: str) -> str:
    """段落・見出しに data-paragraph-id を付与（コメント機能用）"""
    counter = [0]

    def replacer(m):
        counter[0] += 1
        tag, attrs = m.group(1), m.group(2) or ""
        return f'<{tag}{attrs} data-paragraph-id="p-{counter[0]}">'

    # h1-h6, p タグに付与
    pattern = re.compile(r'<(h[1-6]|p|li|blockquote)([^>]*)>')
    return pattern.sub(replacer, html)


def preprocess_markdown(md_text: str) -> str:
    """Markdown を HTML に変換する前の前処理：強制改ページ・添付資料連番・岡口番号"""
    # 強制改ページ：<!--page-break--> または ---page--- → <div class="page-break"></div>
    md_text = re.sub(
        r'^\s*(?:<!--\s*page-break\s*-->|---page---)\s*$',
        '<div class="page-break"></div>',
        md_text, flags=re.MULTILINE
    )

    # 添付資料連番：「添付資料【】」 を「添付資料１, 添付資料２, ...」に
    counter = [0]
    def attach_replacer(m):
        counter[0] += 1
        n = counter[0]
        # 全角数字に変換
        zenkaku = str.maketrans('0123456789', '０１２３４５６７８９')
        return f'添付資料{str(n).translate(zenkaku)}'
    md_text = re.sub(r'添付資料【】', attach_replacer, md_text)

    return md_text


def render_markdown(md_text: str) -> str:
    """Markdown→HTML変換"""
    md_text = preprocess_markdown(md_text)
    md = markdown.Markdown(
        extensions=MD_EXTENSIONS,
        extension_configs={
            'toc': {'permalink': False, 'baselevel': 1},
        }
    )
    html = md.convert(md_text)
    html = add_paragraph_ids(html)
    return html


# ============================================================
# ファイル監視
# ============================================================
def file_watcher():
    """1秒ごとに対象フォルダ内 .md の mtime をチェックし、変更があればSSEで通知"""
    global FILE_MTIMES
    while True:
        try:
            current = {}
            for p in TARGET_DIR.rglob("*.md"):
                if any(part.startswith(".") for part in p.parts):
                    continue
                try:
                    current[str(p)] = p.stat().st_mtime
                except OSError:
                    continue

            with LOCK:
                changed = []
                for path, mtime in current.items():
                    if path not in FILE_MTIMES or FILE_MTIMES[path] != mtime:
                        changed.append(path)
                FILE_MTIMES = current

            if changed:
                notify_sse({"type": "file_changed", "files": [
                    str(Path(p).relative_to(TARGET_DIR)) for p in changed
                ]})
        except Exception as e:
            print(f"[watcher error] {e}", file=sys.stderr)

        time.sleep(POLL_INTERVAL)


def notify_sse(data: dict):
    """全SSEクライアントに通知"""
    msg = f"data: {json.dumps(data, ensure_ascii=False)}\n\n"
    with LOCK:
        dead = []
        for client in SSE_CLIENTS:
            try:
                client.wfile.write(msg.encode("utf-8"))
                client.wfile.flush()
            except Exception:
                dead.append(client)
        for d in dead:
            SSE_CLIENTS.remove(d)


# ============================================================
# コメント管理
# ============================================================
def comments_path(md_path: Path) -> Path:
    """対応する comments.json のパス"""
    return md_path.with_suffix(md_path.suffix + ".comments.json")


# ============================================================
# 自動バックアップ
# ============================================================
def backup_dir() -> Path:
    """バックアップディレクトリのパス（target_dir 配下）"""
    return TARGET_DIR / BACKUP_DIR_NAME


def make_backup(md_path: Path) -> Path:
    """ファイル保存時のスナップショット作成。返り値はバックアップファイルパス。"""
    if not md_path.exists():
        return None
    bdir = backup_dir()
    bdir.mkdir(exist_ok=True)
    # サブディレクトリ構造を平坦化（区切りを __ に）
    rel = md_path.relative_to(TARGET_DIR)
    flat_name = str(rel).replace(os.sep, "__")
    ts = datetime.now().strftime("%Y%m%d-%H%M%S")
    bk = bdir / f"{ts}__{flat_name}"
    try:
        bk.write_bytes(md_path.read_bytes())
    except Exception as e:
        print(f"[backup error] {e}", file=sys.stderr)
        return None
    return bk


def cleanup_backups():
    """保持ポリシーに従って古いバックアップを削除。
    - 各ファイルにつき直近 BACKUP_KEEP_GENERATIONS 世代まで保持
    - BACKUP_KEEP_DAYS を超えたものは削除
    """
    bdir = backup_dir()
    if not bdir.exists():
        return
    now = time.time()
    age_threshold = BACKUP_KEEP_DAYS * 86400

    # ファイル名（接尾辞）でグルーピング
    groups = {}
    for f in bdir.iterdir():
        if not f.is_file():
            continue
        name = f.name
        # 形式: YYYYMMDD-HHMMSS__<flat_name>
        parts = name.split("__", 1)
        if len(parts) < 2:
            continue
        suffix = parts[1]
        groups.setdefault(suffix, []).append(f)

    for suffix, files in groups.items():
        # 新しい順にソート
        files.sort(key=lambda p: p.stat().st_mtime, reverse=True)
        for i, f in enumerate(files):
            try:
                age = now - f.stat().st_mtime
                if i >= BACKUP_KEEP_GENERATIONS or age > age_threshold:
                    f.unlink()
            except Exception:
                pass


def list_backups(md_path: Path) -> list:
    """指定 md ファイルのバックアップ一覧を新しい順で返す"""
    bdir = backup_dir()
    if not bdir.exists():
        return []
    rel = md_path.relative_to(TARGET_DIR)
    flat_name = str(rel).replace(os.sep, "__")
    candidates = []
    for f in bdir.iterdir():
        if not f.is_file():
            continue
        if f.name.endswith(f"__{flat_name}"):
            candidates.append(f)
    candidates.sort(key=lambda p: p.stat().st_mtime, reverse=True)
    return [
        {
            "filename": c.name,
            "timestamp": datetime.fromtimestamp(c.stat().st_mtime).isoformat(timespec="seconds"),
            "size": c.stat().st_size,
        }
        for c in candidates
    ]


def restore_backup(md_path: Path, backup_filename: str) -> bool:
    """バックアップから復元。成功時 True。復元前に現状もバックアップ。"""
    bdir = backup_dir()
    bk = bdir / backup_filename
    if not bk.exists() or not bk.is_file():
        return False
    # 復元前に現状をバックアップ
    make_backup(md_path)
    md_path.write_bytes(bk.read_bytes())
    return True


def load_comments(md_path: Path) -> dict:
    cp = comments_path(md_path)
    if cp.exists():
        try:
            return json.loads(cp.read_text(encoding="utf-8"))
        except Exception:
            pass
    return {
        "file": md_path.name,
        "version": 1,
        "comments": []
    }


def save_comments(md_path: Path, data: dict):
    cp = comments_path(md_path)
    cp.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


# ============================================================
# HTTP ハンドラ
# ============================================================
class Handler(BaseHTTPRequestHandler):

    def log_message(self, fmt, *args):
        # ログを抑制（デフォルトはstderrに毎リクエスト出る）
        pass

    def _send(self, code: int, body: bytes, content_type: str = "text/html; charset=utf-8",
              headers: dict = None):
        self.send_response(code)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        if headers:
            for k, v in headers.items():
                self.send_header(k, v)
        self.end_headers()
        self.wfile.write(body)

    def _send_json(self, code: int, data):
        body = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self._send(code, body, "application/json; charset=utf-8")

    def _send_file(self, path: Path, content_type: str = None):
        if not path.exists() or not path.is_file():
            self._send(404, b"Not Found", "text/plain")
            return
        body = path.read_bytes()
        if content_type is None:
            ext = path.suffix.lower()
            content_type = {
                ".html": "text/html; charset=utf-8",
                ".js":   "application/javascript; charset=utf-8",
                ".css":  "text/css; charset=utf-8",
                ".json": "application/json; charset=utf-8",
            }.get(ext, "application/octet-stream")
        self._send(200, body, content_type)

    def _list_md_files(self) -> list:
        """対象フォルダ内の .md ファイル一覧（隠しフォルダ除外）"""
        files = []
        for p in sorted(TARGET_DIR.rglob("*.md")):
            if any(part.startswith(".") for part in p.parts):
                continue
            if p.name.endswith(".comments.json"):
                continue
            try:
                rel = p.relative_to(TARGET_DIR)
                files.append({
                    "path": str(rel),
                    "name": p.name,
                    "size": p.stat().st_size,
                    "mtime": p.stat().st_mtime,
                    "comments_count": len(load_comments(p)["comments"]),
                })
            except Exception:
                continue
        return files

    def _resolve_md(self, path_str: str) -> Path:
        """安全にmdファイルパスを解決（ディレクトリトラバーサル防止）"""
        p = (TARGET_DIR / path_str).resolve()
        if not str(p).startswith(str(TARGET_DIR.resolve())):
            raise ValueError("Outside of target dir")
        if not p.exists() or p.suffix != ".md":
            raise ValueError("Not a markdown file")
        return p

    def do_GET(self):
        url = urlparse(self.path)
        path = unquote(url.path)

        # トップページ
        if path == "/" or path == "/index.html":
            self._send_file(STATIC_DIR / "viewer.html")
            return

        # 静的ファイル
        if path.startswith("/static/"):
            rel = path[len("/static/"):]
            self._send_file(STATIC_DIR / rel)
            return

        # API: ファイル一覧
        if path == "/api/files":
            self._send_json(200, {
                "target_dir": str(TARGET_DIR),
                "files": self._list_md_files()
            })
            return

        # API: 元 Markdown 取得
        if path.startswith("/api/file/"):
            try:
                md = self._resolve_md(path[len("/api/file/"):])
                self._send_json(200, {
                    "path": str(md.relative_to(TARGET_DIR)),
                    "content": md.read_text(encoding="utf-8")
                })
            except Exception as e:
                self._send_json(404, {"error": str(e)})
            return

        # API: HTMLレンダリング結果
        if path.startswith("/api/render/"):
            try:
                md = self._resolve_md(path[len("/api/render/"):])
                html = render_markdown(md.read_text(encoding="utf-8"))
                self._send_json(200, {
                    "path": str(md.relative_to(TARGET_DIR)),
                    "html": html,
                    "comments": load_comments(md)["comments"],
                })
            except Exception as e:
                self._send_json(404, {"error": str(e)})
            return

        # API: バックアップ一覧
        if path.startswith("/api/backups/"):
            try:
                md = self._resolve_md(path[len("/api/backups/"):])
                self._send_json(200, {
                    "path": str(md.relative_to(TARGET_DIR)),
                    "backups": list_backups(md)
                })
            except Exception as e:
                self._send_json(404, {"error": str(e)})
            return

        # API: バックアップ本体取得
        if path.startswith("/api/backup-content/"):
            try:
                rest = path[len("/api/backup-content/"):]
                bk_path = backup_dir() / rest
                if not bk_path.exists() or not bk_path.is_file():
                    self._send_json(404, {"error": "not found"})
                    return
                # 安全：backup_dir 配下に限定
                bk_path = bk_path.resolve()
                if not str(bk_path).startswith(str(backup_dir().resolve())):
                    self._send_json(403, {"error": "forbidden"})
                    return
                self._send_json(200, {
                    "filename": bk_path.name,
                    "content": bk_path.read_text(encoding="utf-8"),
                })
            except Exception as e:
                self._send_json(500, {"error": str(e)})
            return

        # API: コメント取得
        if path.startswith("/api/comments/"):
            try:
                md = self._resolve_md(path[len("/api/comments/"):])
                self._send_json(200, load_comments(md))
            except Exception as e:
                self._send_json(404, {"error": str(e)})
            return

        # SSE
        if path == "/events":
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream; charset=utf-8")
            self.send_header("Cache-Control", "no-cache")
            self.send_header("Connection", "keep-alive")
            self.end_headers()
            with LOCK:
                SSE_CLIENTS.append(self)
            try:
                # 接続維持: 30秒ごとにping
                self.wfile.write(b": connected\n\n")
                self.wfile.flush()
                while True:
                    time.sleep(30)
                    try:
                        self.wfile.write(b": ping\n\n")
                        self.wfile.flush()
                    except Exception:
                        break
            except Exception:
                pass
            finally:
                with LOCK:
                    if self in SSE_CLIENTS:
                        SSE_CLIENTS.remove(self)
            return

        self._send(404, b"Not Found", "text/plain")

    def do_POST(self):
        url = urlparse(self.path)
        path = unquote(url.path)

        # API: ファイル保存（編集機能・自動バックアップ付き）
        if path.startswith("/api/file/"):
            try:
                md = self._resolve_md(path[len("/api/file/"):])
                length = int(self.headers.get("Content-Length", 0))
                body = self.rfile.read(length).decode("utf-8")
                payload = json.loads(body)
                content = payload.get("content", "")
                # 上書き前にバックアップ
                bk = make_backup(md) if md.exists() else None
                md.write_text(content, encoding="utf-8")
                # 古いバックアップを掃除（軽い処理）
                try:
                    cleanup_backups()
                except Exception:
                    pass
                self._send_json(200, {
                    "path": str(md.relative_to(TARGET_DIR)),
                    "saved": True,
                    "size": len(content),
                    "backup": bk.name if bk else None,
                    "saved_at": datetime.now().isoformat(timespec="seconds")
                })
            except Exception as e:
                self._send_json(500, {"error": str(e)})
            return

        # API: バックアップから復元
        if path.startswith("/api/restore/"):
            try:
                md = self._resolve_md(path[len("/api/restore/"):])
                length = int(self.headers.get("Content-Length", 0))
                body = self.rfile.read(length).decode("utf-8")
                payload = json.loads(body)
                bk_name = payload.get("backup", "")
                if not bk_name:
                    self._send_json(400, {"error": "backup filename required"})
                    return
                ok = restore_backup(md, bk_name)
                if ok:
                    self._send_json(200, {"restored": True, "backup": bk_name})
                else:
                    self._send_json(404, {"error": "backup not found"})
            except Exception as e:
                self._send_json(500, {"error": str(e)})
            return

        # API: コメント保存
        if path.startswith("/api/comments/"):
            try:
                md = self._resolve_md(path[len("/api/comments/"):])
                length = int(self.headers.get("Content-Length", 0))
                body = self.rfile.read(length).decode("utf-8")
                payload = json.loads(body)

                data = load_comments(md)

                if payload.get("action") == "add":
                    new_comment = {
                        "id": f"c{int(time.time()*1000)}",
                        "paragraph_id": payload.get("paragraph_id"),
                        "paragraph_text_snapshot": payload.get("paragraph_text_snapshot", ""),
                        "comment": payload.get("comment", ""),
                        "created_at": datetime.now().isoformat(timespec="seconds"),
                        "status": "pending"
                    }
                    data["comments"].append(new_comment)

                elif payload.get("action") == "update":
                    cid = payload.get("id")
                    for c in data["comments"]:
                        if c["id"] == cid:
                            if "comment" in payload:
                                c["comment"] = payload["comment"]
                            if "status" in payload:
                                c["status"] = payload["status"]
                            break

                elif payload.get("action") == "delete":
                    cid = payload.get("id")
                    data["comments"] = [c for c in data["comments"] if c["id"] != cid]

                save_comments(md, data)
                self._send_json(200, data)

                # SSEで通知
                notify_sse({
                    "type": "comments_updated",
                    "file": str(md.relative_to(TARGET_DIR))
                })

            except Exception as e:
                self._send_json(500, {"error": str(e)})
            return

        self._send(404, b"Not Found", "text/plain")


# ============================================================
# メイン
# ============================================================
def find_free_port(start: int) -> int:
    import socket
    for offset in range(PORT_RANGE):
        port = start + offset
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            try:
                s.bind(("127.0.0.1", port))
                return port
            except OSError:
                continue
    raise RuntimeError(f"No free port in {start}..{start+PORT_RANGE}")


# 簡易マルチスレッドHTTPサーバー（SSEのため）
from http.server import ThreadingHTTPServer


def main():
    global TARGET_DIR

    parser = argparse.ArgumentParser(description="法律文書向け Markdown プレビュアー")
    parser.add_argument("target_dir", nargs="?", default=".",
                        help="対象ディレクトリ（既定: カレント）")
    parser.add_argument("--port", type=int, default=DEFAULT_PORT)
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--no-browser", action="store_true",
                        help="ブラウザ自動起動を抑制")
    args = parser.parse_args()

    TARGET_DIR = Path(args.target_dir).resolve()
    if not TARGET_DIR.is_dir():
        print(f"ERROR: {TARGET_DIR} is not a directory", file=sys.stderr)
        sys.exit(1)

    port = find_free_port(args.port)

    # ファイル監視スレッド起動
    watcher_thread = threading.Thread(target=file_watcher, daemon=True)
    watcher_thread.start()

    server = ThreadingHTTPServer((args.host, port), Handler)

    url = f"http://{args.host}:{port}/"
    print(f"Markdown Preview Server")
    print(f"  Target: {TARGET_DIR}")
    print(f"  URL:    {url}")
    print(f"  Static: {STATIC_DIR}")
    print()
    print("Press Ctrl+C to stop.")

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nShutting down...")
        server.shutdown()


if __name__ == "__main__":
    main()
