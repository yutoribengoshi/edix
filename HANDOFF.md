# preview-md ハンドオフドキュメント

**作成日**: 2026-04-27
**作者**: 関 智之 + Claude Code（このチャット）
**目的**: 別チャットで preview-md の開発・公開準備を継続できるよう、現状と残タスクを整理

---

## 1. プロジェクト概要

法律文書（および汎用Markdown）のプレビューツール。Claude Code 内 WebView で動作。

**コア価値提案**:
- AIファーストのレビュー設計（段落コメント→Claudeが反映）
- 法律文書向けの本格Wordレイアウト（游明朝・A4・25mmマージン）
- ピンチズーム + サイドバイサイド編集 + スクロール同期
- ローカルファースト・依存最小

**Wordプラグインの逆発想**：Word上でClaudeを呼ぶのではなく、**Claudeが起案→人間がプレビューでレビュー→docx化**という流れ。

---

## 2. 実装済み機能（一覧）

### サーバー (`server.py`)
- HTTPサーバー（Python標準 `http.server` + ThreadingHTTPServer）
- Markdown レンダリング（`python-markdown` + `pymdown-extensions`）
- 段落単位の `data-paragraph-id` 自動付与
- ファイル監視（mtime ポーリング）+ SSE通知
- API: `/api/files`, `/api/file/<path>`, `/api/render/<path>`, `/api/comments/<path>`(GET/POST), `/events`
- POST `/api/file/<path>` でMarkdown直接書き戻し（編集機能用）
- ポート 8765（衝突時は自動インクリメント）

### フロントエンド (`viewer.html` / `viewer.js` / `style.css`)
- 法律文書 A4 Word レイアウト（游明朝・11pt・1.7em行間・25mmマージン・297mmページ区切り背景）
- ピンチズーム（CSS `zoom` プロパティ・wheel+ctrlKey / Safari gesture / touch 3対応）
- 段落クリック→コメントポップアップ・既存コメント表示・削除・status切替
- サイドバー（右）：ファイル一覧（更新日表示・コメントバッジ）、コメント一覧、サイドバー切替ボタン
- 編集モード：下部からスライドアップ・閉じるボタン・Esc対応・Cmd+S即時保存・600msデバウンス自動保存
- 編集ペイン上下リサイズ（境界ドラッグ・前回値復元）
- スクロール同期（プレビュー⇔エディタ・パーセンテージベース）
- ライブリロード（SSE）
- 印刷モード（@media print）
- ヘッダー sticky 配置・ズーム表示（ダブルクリックで100%リセット）
- 編集中のファイル外部更新時の保護（dirty なら上書きしない）

### スキル / コマンド
- `/preview-md` スキル（`~/.claude/skills/preview-md/SKILL.md`）
- `lglmd` シェルコマンド（`~/bin/lglmd` シンボリックリンク）

---

## 3. ファイル配置

```
~/dev/legal-jp-local/tools/md_preview/
├── server.py              # メインHTTPサーバー
├── static/
│   ├── viewer.html        # プレビュー画面
│   ├── viewer.js          # フロントエンドロジック
│   └── style.css          # 法律文書スタイル
├── README.md              # 使い方
└── HANDOFF.md             # このファイル

~/.claude/skills/preview-md/
└── SKILL.md               # /preview-md スキル定義

~/bin/lglmd                # 起動コマンド

~/Documents/.claude/launch.json  # Claude Code Preview 起動定義
```

---

## 4. 起動方法

### スキル経由（Claude Code）
```
/preview-md
```

### 直接コマンド
```bash
lglmd                              # CWDのMarkdown
lglmd /path/to/dir                 # 指定フォルダ
```

### Claude Code Preview MCP経由
`mcp__Claude_Preview__preview_start` で `MD Preview (日吉書面)` を起動

---

## 5. 残タスク（このチャットで未完）

### 命名・ブランディング
- [ ] 命名決定（候補：**Edith** / Marginal / Codex / Vellum / Inkblot）
- [ ] ロゴ作成
- [ ] アイコン

### ドキュメント
- [ ] README日本語版（既存あり、機能リスト最新化）
- [ ] README英語版（未作成）
- [ ] スクリーンショット
- [ ] デモGIF

### 配布
- [ ] `pyproject.toml` 作成（pipパッケージ化）
- [ ] `setup.cfg` or `pyproject.toml`
- [ ] バージョン管理（git tag）
- [ ] ライセンス選定（MIT vs AGPL vs 商用併用）

### GitHub
- [ ] リポジトリ作成（個人 or organization）
- [ ] CI/CD（GitHub Actions：lint/test）
- [ ] CONTRIBUTING.md
- [ ] CHANGELOG.md
- [ ] Issue/PR テンプレ

### 機能改善
- [ ] スクロール同期：パーセンテージ → 行ベース（精度向上）
- [ ] ダークモード切替
- [ ] 縦書きトグル
- [ ] 検索機能（Ctrl+F）
- [ ] PDF直接出力（weasyprint）
- [ ] 多言語対応（i18n）

### MCP化
- [ ] MCPサーバーラッパー作成
- [ ] ツール定義（`mcp__md_preview__*`）：start / list / get / save / get_comments / apply_comments / open_in_view
- [ ] Claude が自律的にコメント反映できるフロー

### その他
- [ ] Anthropic 公式に売り込み（Claude Code Skill）
- [ ] 法律業界向け SaaS化検討（Tier 3）

---

## 6. 既知の問題・改善余地

- A4幅 794px は固定値（96dpi 前提）。高DPI環境で微妙にずれる可能性
- Markdownラインベース同期未実装（パーセンテージで近似中）
- HTML混在Markdownのレンダリング未検証
- macOS以外での動作未確認（Windows/Linux）
- フォント `游明朝` は macOS 標準。他OSでフォールバック設定要

---

## 7. 関連プロジェクト

- **legal-jp-local（メティス）**: 関先生の判例DB＋4層ニューロンネット
  - パス：`~/dev/legal-jp-local/`
  - METIS_OVERVIEW.md / METIS_ROADMAP.md 参照
- **draft-* スキル群**: `~/.claude/skills/draft-*` 法律文書起案スキル
- **court-format スキル**: docx → 裁判所書式（岡口マクロ準拠）
- **メモリMCP**: `~/.claude/mcp/memory/` 案件・ノート保存

---

## 8. 次のチャットで使える情報

- このチャットで決めた設計思想：
  - 「Wordプラグインの逆」「AIファースト編集」
  - サイドバイサイド（編集時のみ下部スライドアップ）
  - ピンチズーム＋境界ドラッグ＋スクロール同期
  - コメントは comments.json で永続化
- 命名の候補：**Edith** が私のおすすめ（編集者・短い・覚えやすい）

---

## 9. 起動確認コマンド

```bash
# サーバー手動起動
~/dev/legal-jp-local/.venv/bin/python3 \
  ~/dev/legal-jp-local/tools/md_preview/server.py \
  /path/to/markdown/dir --no-browser

# 動作確認
curl http://localhost:8765/api/files
```

---

**作者**: 関 智之 + Claude Code
**ライセンス**: 未定
**対外公開**: 準備中
