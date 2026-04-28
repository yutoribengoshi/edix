# Edix

> 起案のための、Markdown × Claude Code 環境
> 執筆動線にAIを割り込ませず、コメントで指示し、まとめて反映させる。

![Edix split view: preview + editor + AI chat](docs/03-split-view.png)

左がClaude Code（外部AIエージェント）、右上がA4プレビュー、右下がMarkdownソースエディタ。
この1画面で 起案 → レビュー → 修正指示 → 反映 → 再確認 まで完結する。

### Edix が解決する問題

「Word + AI アドイン」型はサイドバーAIで「執筆中に割り込まれる」設計のため、
契約書レビュー（相手方ドラフトを直す）には合うが、起案（準備書面・意見書・論文）には向かない。

Edix は逆方向で構成する：

| 動線 | Word + AI add-in | Edix |
|---|---|---|
| 執筆 | サイドバーAIに侵食される | Markdownエディタで完全独立 |
| AIへの指示 | サイドバーで会話 | 段落クリック → コメント → 後でまとめて反映 |
| AI処理タイミング | 同期（待つ） | 非同期（夜にまとめて等） |
| プレビュー | 編集ビューと同じ | A4プレビューを別領域で常時表示 |

執筆中はAIが視界に入らず、レビューしたい時だけ段落単位で指示する。
これは「読みながら指摘点だけ残して、後でまとめてAIに直させる」という法律実務の起案フローに合う。

---

### スクリーンショット

| 全体ビュー | 契約書レビュー | プレビュー＋編集 |
|---|---|---|
| ![overview](docs/01-overview.png) | ![review](docs/02-contract-review.png) | ![split](docs/03-split-view.png) |
| ファイル一覧・コメント・更新日 | AIに「○条をこう変えて」と指示 | 下からスライドアップする編集ペイン |

## ⚡ Quick Start

```bash
git clone https://github.com/yutoribengoshi/edix.git ~/dev/edix
pip install markdown pymdown-extensions python-docx
python3 ~/dev/edix/server.py [target_dir]    # → http://localhost:8765/
```

## 🎯 Use Cases

契約レビュー ・ 論文推敲 ・ 翻訳対比 ・ 仕様書 ・ 法律文書 ・ **AIに見せながら一緒に書きたい全員**

## ✨ 1画面に詰まっている機能

| 領域 | できること |
|---|---|
| 📄 プレビュー | A4 Word レイアウト・游明朝・ピンチズーム |
| 💬 コメント | 段落クリック→ポップアップ→保存→AI反映（IDは内容ハッシュで安定・段落追加で壊れない） |
| 📝 編集 | 下部スライドアップ・スクロール同期 |
| 💾 保存 | 自動保存（600ms）／Cmd+S／💾ボタン |
| 🛡️ バックアップ | 編集ごとに `.edix-backup/` に世代保存・100世代/30日まで |
| 🔄 復元 | 📚 履歴ボタンで世代一覧・ワンクリック復元 |
| 🔍 検索 | Cmd+F 全マッチハイライト |
| 📄 Word出力 | 📄ボタンで `.docx` ダウンロード（A4・游明朝・ページ番号付き） |
| 🖨 印刷 | A4・ページ番号・UI非表示 |
| 📑 拡張記法 | 目次 `[TOC]` ／ 改ページ ／ 自動連番 |
| 📁 サイドバー | ファイル一覧・更新日・コメントバッジ |

すべて画面切替なし。コメントしたら、AIに「反映して」と頼むだけ。

## 🔄 使い方：コメントしてAIに反映させる

これが Edix の本丸。読む → 指摘する → 任せる の3ステップ。

```
1. プレビューで読む
2. 気になる段落をクリック → 💬 → コメントを書く
   例：「東京地方裁判所 → 東京簡易裁判所及び東京地方裁判所 に変更」
3. AI チャットで「コメント反映して」と一言
```

そのあと AI が裏でやること：

```
comments.json を読む
  → 全コメントの pending を抽出
  → Markdown を1つずつ Edit
  → status を applied に更新
  → SSE でブラウザ自動リロード
```

### よくある使い方

| シーン | やること |
|---|---|
| 契約書レビュー | 各条項を読みながらコメント連打 → 夜にまとめて「全部反映して」 |
| 起案直し | 「この段落、もっと簡潔に」だけ書く → AIが文言を考えて反映 |
| 翻訳対比 | 「ここの訳語は◯◯が適切」 → 用語統一を任せる |
| 共同レビュー | 複数人でコメント → AIが全員分を一括処理 |

### 強み

| | |
|---|---|
| 📦 ローカルJSON | コメントは `<file>.md.comments.json` ／ git管理外で流出リスクなし |
| 🔁 二重適用防止 | pending のものだけ拾って applied に更新 |
| 🌙 遅延処理OK | コメントだけ残して、後でまとめて反映 |
| 🎯 段落単位 | 「あの辺の文章」じゃなく「この段落」で曖昧さゼロ |

<details>
<summary>📖 詳細を開く</summary>

### 起動方法
- **スキル**: `/preview-md [target_dir]`（将来 `/edix` にリネーム予定）
- **ターミナル**: `lglmd [target_dir]` または `python3 server.py [dir]`
- **Claude Code WebView**: `.claude/launch.json` 経由で `preview_start "Edix"`

### キーボードショートカット
| キー | 動作 |
|---|---|
| `Cmd+F` | 検索 |
| `Cmd+ +/-/0` | 拡大/縮小/100%リセット |
| `Cmd+S` | 編集中の即時保存 |
| `Esc` | ポップアップ/検索/編集を順に閉じる |
| `Enter / Shift+Enter` | 検索：次へ/前へ |
| `2本指ピンチ` | プレビューを拡大縮小 |

### Markdown 独自記法
| 記法 | 効果 |
|---|---|
| `[TOC]` | 目次自動生成 |
| `<!--page-break-->` / `---page---` | 強制改ページ（印刷時） |
| `項目【】` | 自動連番（`項目１, 項目２, ...`） |
| `№` ボタン（オプション） | 見出しに岡口マクロ風自動番号（第１/１/(１)/ア） |

### コメント反映フロー
1. プレビューの段落をクリック → 💬 → コメント入力
2. `<file>.md.comments.json` に保存
3. AI に「**コメント反映して**」と指示
4. AI が `comments.json` を読んで Markdown を Edit
5. SSE 経由でブラウザ自動リロード
6. status を pending → applied に更新

### 設計コンセプト
- **1画面で完結**：プレビュー・編集・コメント・AI反映を切替なしで
- **AI ファースト**：人がPDFで読むのではなく、AI に修正させることが前提
- **ローカルファースト**：ファイルは手元、git 管理しやすい
- **軽量**：Python 標準 + `markdown` 1個・5 分でインストール
- **CSS zoom 方式**：レイアウト含めて縮小（中央寄せが正しく効く）

### 既存ツールとの位置関係

「どれが優れている」ではなく「どこで差別化されるか」の整理：

| ツール | 強み | Edix が違う点 |
|---|---|---|
| Word + Claude for Word | 契約レビューの公式統合・Tracked changes | サイドバーAIが執筆中に割り込む。起案系に向かない |
| Cursor / Cline + Markdown | コードと同じ動線で書ける・拡張性高い | A4プレビュー・段落単位コメント・docx出力は自前で組む必要 |
| Obsidian + Smart Connections | ノートDB・グラフビュー | 段落単位の AI 指示プロトコルがない |
| VSCode + Markdown Preview Enhanced | 軽量・拡張豊富 | コメント機能・AI反映ワークフローは別途必要 |
| Notion AI | ブロック単位編集・AI内蔵 | クラウド前提・ローカルファイル/git管理ではない |
| **Edix** | 段落単位コメント + 外部エージェントによる非同期反映 + ローカルファースト | 法律文書の起案動線に特化 |

汎用 Markdown エディタとしては既存ツールと並ぶ程度。
Edix の独自性は **「Claude Code とコメントJSONで対話する、起案動線を壊さない反映プロトコル」** にある。

### ロードマップ
- v0.1 ✅ プレビュー・コメント・編集・検索・印刷・拡張記法・Word出力・自動バックアップ
- v0.2 — スキル名 `edix` リネーム / PyPI / README英訳 / 公開検討
- v0.3 — MCP化 / PDF出力 / 縦書き / 比較ビュー / 共同編集

</details>

## 🛠 Stack

Python 3.9+ / [`markdown`](https://python-markdown.github.io/) / [`pymdown-extensions`](https://facelessuser.github.io/pymdown-extensions/) / [`python-docx`](https://python-docx.readthedocs.io/)（docx出力用）/ 標準HTML/CSS/JS

## 🔒 セキュリティ

- 既定で `127.0.0.1` のみバインド・他マシンからは見えません
- `--host 0.0.0.0` 等のリモート公開は **既定で拒否**（`--allow-remote` 必須・自動でトークン認証）
- ディレクトリトラバーサル・DNS rebinding・CSRF への対策あり
- 案件フォルダを公開リポジトリに置かないのは利用者責任です

詳細は [SECURITY.md](SECURITY.md) を参照。

## 📜 License & Author

[MIT License](LICENSE) / [@yutoribengoshi](https://github.com/yutoribengoshi) + Claude Code
