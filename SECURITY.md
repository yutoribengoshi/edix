# Edix セキュリティモデル

## 想定する利用形態（前提）

Edix は **単一ユーザーが自分のローカルマシン上で起動して使うツール** として設計されています。
法律文書を扱う前提のため、依頼者情報・秘匿特権下の文書がファイルとして読み書きされます。

- 既定: `127.0.0.1` バインド・トークン認証なし
- 既定でリモート公開（`0.0.0.0` 等）は **拒否されます**（`--allow-remote` で明示的に許可した場合のみトークン認証付きで受け付け）

## 実装している防御

| 脅威 | 対策 |
|---|---|
| ディレクトリトラバーサル | `Path.is_relative_to()` による厳密なパス封じ込め（`startswith` 前方一致を使わない）。NUL文字・空文字も拒否 |
| シンボリックリンク経由の脱出 | ファイル列挙時に `is_symlink()` を弾く（`rglob` の `follow_symlinks=True` を使わない） |
| バックアップ閲覧API の悪用 | `/api/backup-content/` は `YYYYMMDD-HHMMSS__<name>.md` 形式のホワイトリストのみ受け付け、`.edix-backup/` 直下のみアクセス可 |
| DNS rebinding | `Host` ヘッダが `127.0.0.1:PORT` / `localhost:PORT` / `[::1]:PORT` でない場合は 403 |
| クロスサイト POST（CSRF） | `Origin` ヘッダ検証、`Sec-Fetch-Site` cross-site の拒否、`Content-Type: application/json` 必須化（simple-request 経路の遮断） |
| DoS（巨大ボディ） | POST の Content-Length が 10MB を超えれば拒否 |
| SSE 接続の浪費 | 同時接続を 32 で打ち切り |
| バックアップの非アトミック書き込み | `shutil.copy2` で一時ファイル経由 → `os.replace` |
| バックアップのパーミッション流出 | バックアップディレクトリ 0o700・ファイル 0o600 |
| バックアップの race condition | `make_backup` と `cleanup_backups` を `LOCK` で排他 |
| リモート公開時の無認証アクセス | `--allow-remote` 必須化 + ランダムトークン認証（Jupyter方式） |
| アクセス追跡不能 | POST と拒否イベントは stderr に `[edix YYYY-MM-DD HH:MM:SS] [LEVEL] ...` で記録 |

## 防御していないこと（既知の制限）

| 領域 | 現状 |
|---|---|
| 暗号化 | HTTP のみ。同一マシン内通信のみのためTLSは未実装 |
| ブラウザ XSS | プレビューに描画される HTML は markdown-py の出力であり、ユーザ自身のMarkdownを信頼する前提（一般的な markdown プレビューと同じモデル） |
| Markdown 本体の git 流出 | `.gitignore` で `*.comments.json` と `.edix-backup/` は除外しているが、Markdown 本体は対象外。守秘義務上、案件フォルダを公開リポジトリに置かないことはユーザー責任 |
| ファイルシステム ACL | OS のファイルパーミッションに依存。マルチユーザーマシンでの運用は想定しない |

## 推奨される運用

- **`--host 127.0.0.1`（既定）で運用する**。LAN や外部公開は推奨しない。
- 案件フォルダは **プライベートリポジトリ** または git 管理外で運用する。
- 終業時はプロセスを停止する（`Ctrl+C` または `pkill -f server.py`）。
- バックアップディレクトリ `.edix-backup/` を共有フォルダ（Dropbox/iCloud等）に置く場合は、暗号化フォルダを推奨。

## 脆弱性報告

セキュリティ上の問題を発見した場合は、Issue ではなく以下に直接連絡してください：

- GitHub: [@yutoribengoshi](https://github.com/yutoribengoshi)
