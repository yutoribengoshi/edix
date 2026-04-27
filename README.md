# Edix

**The AI-native Markdown editor for legal documents**

法律文書向けの Markdown プレビュー＋対話型校閲ツール。Claude Code 内 WebView でプレビュー、段落クリックでコメント、Claude が自動反映。

> Word プラグインの逆バージョン  
> Claude が主、Word は最終出力先

---

## 開発：関 智之 + Claude Code（2026）

弁護士の起案ワークフローを再発明するために構築。法律文書（準抗告・準備書面・意見書・陳述書・契約書レビュー等）に最適化。

## 起動

### スキル経由（推奨）
```
/edix [target_dir]   # Claude Code内
```
※現状のスキル名は `/preview-md`。後日 `/edix` にリネーム予定。

### ターミナル
```bash
lglmd [target_dir]                                    # ラッパー
python3 ~/dev/legal-jp-local/tools/md_preview/server.py [dir]
```

### Claude Code WebView
`.claude/launch.json` に登録 → `preview_start "Edix"` で表示。

---

## 主要機能

### プレビュー
- A4 Wordレイアウト（游明朝・25mmマージン・11pt・1.7行間）
- ページ区切り表示（297mm毎の薄線）
- ピンチイン/アウト（トラックパッド・タッチ・Safari全対応）
- CSS zoom方式（縮小時もレイアウト含めて中央寄せ）
- 起動時は画面幅に自動フィット

### コメント
- 段落ホバー → 💬 → クリックでポップアップ
- `<file>.md.comments.json` に保存
- Claudeに「コメント反映して」→ 自動でMarkdown編集
- pending / applied で状態管理
- サイドバー一覧 → クリックで該当段落へジャンプ

### 編集
- ✏️ ボタンで下部スライドアップ
- 境界バードラッグでリサイズ（高さ復元）
- 自動保存（600msデバウンス）／Cmd+S 即時
- プレビュー⇔エディタのスクロール同期
- 編集中ファイルの外部変更を検知して保護

### 検索（Cmd+F or 🔍）
- 全マッチハイライト＋現在マッチ強調
- 件数表示・Enter次/Shift+Enter前

### ファイル管理
- 更新日時表示・新しい順ソート
- コメントバッジ
- ライブリロード（SSE）

### 法律文書特化
- **岡口マクロ風自動番号**（`№` トグル）：h2=第１、h3=１、h4=(１)、h5=ア
- **強制改ページ**：`<!--page-break-->` または `---page---`
- **添付資料連番**：`添付資料【】` → `添付資料１, ２...`
- **目次自動生成**：`[TOC]`

### 印刷（🖨）
- A4縦・余白25mm
- ページ番号「- N / M -」
- UI要素全消し

---

## キーボードショートカット

| キー | 動作 |
|---|---|
| `Cmd+F` | 検索 |
| `Cmd++/-` | ズーム拡大/縮小 |
| `Cmd+0` | ズーム100%リセット |
| `Cmd+S` | 編集中の即時保存 |
| `Esc` | ポップアップ/検索/編集を順に閉じる |
| `Enter / Shift+Enter` | 検索：次へ/前へ |

---

## Markdown独自記法

```markdown
# タイトル

[TOC]

## 第1 申立ての趣旨

本文...

<!--page-break-->

## 第2 申立ての理由

| 番号 | 内容 |
|---|---|
| 添付資料【】 | 身元引受書 |
| 添付資料【】 | 上申書 |
```

---

## ディレクトリ構成

```
~/dev/edix/
├── server.py            # ThreadingHTTPServer + SSE
├── static/
│   ├── viewer.html
│   ├── viewer.js
│   └── style.css
└── README.md

~/.claude/skills/preview-md/SKILL.md     # スキル名は将来 edix/ にリネーム予定
~/bin/lglmd                              # シンボリックリンク
```

## 依存

```bash
pip install markdown pymdown-extensions
```

Python 3.9+。watchdog は不使用（標準ポーリングで実装）。

---

## ライセンス

未定（MIT予定）

## 作者

関 智之（弁護士・中央大学法学部講師）+ Claude Code

---

## ロードマップ

### v0.1（実装済）
- ✅ プレビュー・コメント・編集・ピンチズーム
- ✅ 検索・文字数・印刷
- ✅ 岡口マクロ・添付資料連番・改ページ

### v0.2（次期）
- [ ] スキル名・コマンド名を `edix` にリネーム
- [ ] PyPI / npm パッケージ化
- [ ] README英訳
- [ ] GitHub publish

### v0.3（拡張）
- [ ] MCP化（Claude自動連携）
- [ ] PDF直接出力
- [ ] 縦書きモード
- [ ] 複数ファイル比較ビュー

### v1.0（公開）
- [ ] Anthropic Skill Marketplace 登録
- [ ] 法律家向けテンプレ集
- [ ] メティス判例DB連携
