/* ============================================================
   法律文書プレビュー — フロントエンドロジック
   ============================================================ */

const state = {
  files: [],
  currentFile: null,    // path
  currentHtml: null,
  currentMarkdown: "",  // 元の Markdown ソース
  currentComments: [],
  popup: null,
  zoom: parseFloat(localStorage.getItem("md_preview_zoom") || "1.0"),
  editMode: false,
  saveTimer: null,
  lastSavedContent: "",
};

// ============================================================
// DOM ヘルパー
// ============================================================
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

function el(tag, props = {}, children = []) {
  const e = document.createElement(tag);
  Object.entries(props).forEach(([k, v]) => {
    if (k === "class") e.className = v;
    else if (k === "html") e.innerHTML = v;
    else if (k.startsWith("on")) e.addEventListener(k.slice(2).toLowerCase(), v);
    else e.setAttribute(k, v);
  });
  children.forEach(c => {
    if (typeof c === "string") e.appendChild(document.createTextNode(c));
    else if (c) e.appendChild(c);
  });
  return e;
}

function escapeHtml(s) {
  return String(s).replace(/[<>&"]/g, c => ({
    "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;"
  }[c]));
}

// ============================================================
// API
// ============================================================
async function api(path, opts = {}) {
  const r = await fetch(path, opts);
  if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
  return r.json();
}

async function fetchFiles() {
  const data = await api("/api/files");
  state.files = data.files;
  $("#target-dir").textContent = data.target_dir;
  renderFileList();
}

async function loadFile(filePath) {
  const isFileChange = state.currentFile !== filePath;
  state.currentFile = filePath;
  const [renderData, fileData] = await Promise.all([
    api(`/api/render/${encodeURIComponent(filePath)}`),
    api(`/api/file/${encodeURIComponent(filePath)}`)
  ]);
  state.currentHtml = renderData.html;
  state.currentMarkdown = fileData.content;
  state.currentComments = renderData.comments || [];
  renderPreview();
  renderCommentList();
  highlightActiveFile();
  // エディタモードならテキストエリア更新
  if (state.editMode) {
    const ta = $("#editor-textarea");
    if (ta) {
      const isDirty = ta.value !== state.lastSavedContent;
      // ファイル切替時 or 編集してない時のみ上書き（編集中の内容保護）
      if (isFileChange || !isDirty) {
        ta.value = fileData.content;
        setEditorStatus("clean");
      } else {
        showToast("ファイルが外部から変更されました。編集中の内容を保護するため上書きしません");
      }
    }
  }
  state.lastSavedContent = fileData.content;
}

async function saveFile(content) {
  setEditorStatus("saving");
  try {
    const r = await fetch(`/api/file/${encodeURIComponent(state.currentFile)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content })
    });
    if (!r.ok) throw new Error(`${r.status}`);
    state.lastSavedContent = content;
    setEditorStatus("clean");
  } catch (e) {
    console.error(e);
    setEditorStatus("error");
  }
}

async function postComment(action, payload) {
  const r = await fetch(`/api/comments/${encodeURIComponent(state.currentFile)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, ...payload })
  });
  if (!r.ok) throw new Error("Failed to save comment");
  const data = await r.json();
  state.currentComments = data.comments;
  renderCommentList();
  attachPins();
  // ファイル一覧のバッジも更新
  fetchFiles();
}

// ============================================================
// レンダリング
// ============================================================
function formatRelativeDate(unixSec) {
  const d = new Date(unixSec * 1000);
  const now = new Date();
  const diff = (now - d) / 1000;
  if (diff < 60) return "たった今";
  if (diff < 3600) return `${Math.floor(diff/60)}分前`;
  if (diff < 86400) return `${Math.floor(diff/3600)}時間前`;
  if (diff < 604800) return `${Math.floor(diff/86400)}日前`;
  // 1週間以上前は YYYY-MM-DD
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function renderFileList() {
  const list = $("#file-list");
  list.innerHTML = "";
  // 更新日時の新しい順にソート
  const files = [...state.files].sort((a, b) => b.mtime - a.mtime);
  files.forEach(f => {
    const li = el("li", {
      onclick: () => loadFile(f.path),
      "data-path": f.path,
    }, [
      el("div", { class: "file-name", title: f.path }, [f.path]),
      el("div", { class: "file-meta" }, [
        el("span", { class: "file-date" }, [formatRelativeDate(f.mtime)]),
        f.comments_count > 0
          ? el("span", { class: "comment-badge" }, [`💬 ${f.comments_count}`])
          : el("span", {}, [""])
      ])
    ]);
    if (f.path === state.currentFile) li.classList.add("active");
    list.appendChild(li);
  });
}

function highlightActiveFile() {
  $$("#file-list li").forEach(li => {
    li.classList.toggle("active", li.dataset.path === state.currentFile);
  });
}

function renderPreview() {
  $("#empty-message").hidden = true;
  const area = $("#preview");
  area.hidden = false;
  area.innerHTML = state.currentHtml;
  attachPins();
  applyZoom();
  updateCharCount();
  // 岡口モードがONなら、新しいレンダリング後にも既存番号を除去
  if (document.body.classList.contains("auto-number")) {
    stripManualNumbers();
  }
}

// ============================================================
// 岡口番号モード時の手動番号除去
// ============================================================
const HEADING_NUMBER_PATTERNS = {
  H2: /^[\s　]*第[一二三四五六七八九十百千０-９0-9]+[\s　]*/,
  H3: /^[\s　]*[０-９0-9]+[\s　]*/,
  H4: /^[\s　]*[（(][０-９0-9]+[)）][\s　]*/,
  H5: /^[\s　]*[ア-ンｱ-ﾝ][\s　]+/,
};

function stripManualNumbers() {
  document.querySelectorAll("#preview h2, #preview h3, #preview h4, #preview h5").forEach(h => {
    const tag = h.tagName;
    const pattern = HEADING_NUMBER_PATTERNS[tag];
    if (!pattern) return;
    if (h.dataset.originalText === undefined) {
      h.dataset.originalText = h.textContent;
    }
    const stripped = h.textContent.replace(pattern, "");
    if (stripped !== h.textContent) {
      h.textContent = stripped;
    }
  });
}

function restoreManualNumbers() {
  document.querySelectorAll("#preview h2, #preview h3, #preview h4, #preview h5").forEach(h => {
    if (h.dataset.originalText !== undefined) {
      h.textContent = h.dataset.originalText;
    }
  });
}

// ============================================================
// 文字数カウント
// ============================================================
function updateCharCount() {
  const area = document.querySelector("#preview");
  const cc = $("#char-count");
  if (!area || !cc) return;
  // 表示テキストを取得（記号は含む）
  const text = (area.innerText || "").replace(/\s+/g, "");
  // 全角・半角ともに1文字としてカウント
  const chars = [...text].length;
  cc.textContent = `${chars.toLocaleString()}文字`;
}

// ============================================================
// 検索機能
// ============================================================
const searchState = {
  query: "",
  hits: [],
  index: -1,
};

function openSearch() {
  $("#search-bar").hidden = false;
  const input = $("#search-input");
  input.focus();
  input.select();
}

function closeSearch() {
  $("#search-bar").hidden = true;
  clearSearchHits();
  searchState.query = "";
  searchState.hits = [];
  searchState.index = -1;
  $("#search-info").textContent = "";
}

function clearSearchHits() {
  // <mark class="search-hit"> を解除
  document.querySelectorAll("#preview mark.search-hit, #preview mark.search-hit-active").forEach(m => {
    const parent = m.parentNode;
    parent.replaceChild(document.createTextNode(m.textContent), m);
    parent.normalize();
  });
}

function performSearch(query) {
  clearSearchHits();
  searchState.query = query;
  searchState.hits = [];
  searchState.index = -1;
  if (!query) {
    $("#search-info").textContent = "";
    return;
  }
  const area = document.querySelector("#preview");
  if (!area) return;
  // テキストノードを走査してハイライト
  const walker = document.createTreeWalker(area, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) => {
      // script/styleやコメントピン内のテキストは除外
      const p = node.parentElement;
      if (!p) return NodeFilter.FILTER_REJECT;
      if (p.classList.contains("comment-pin")) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    }
  });
  const nodes = [];
  let n;
  while ((n = walker.nextNode())) nodes.push(n);

  const lower = query.toLowerCase();
  nodes.forEach(node => {
    const text = node.nodeValue;
    const tl = text.toLowerCase();
    let pos = 0;
    let lastEnd = 0;
    const fragments = [];
    while ((pos = tl.indexOf(lower, pos)) !== -1) {
      if (pos > lastEnd) fragments.push(document.createTextNode(text.substring(lastEnd, pos)));
      const mark = document.createElement("mark");
      mark.className = "search-hit";
      mark.textContent = text.substring(pos, pos + query.length);
      fragments.push(mark);
      searchState.hits.push(mark);
      lastEnd = pos + query.length;
      pos = lastEnd;
    }
    if (fragments.length > 0) {
      if (lastEnd < text.length) fragments.push(document.createTextNode(text.substring(lastEnd)));
      const parent = node.parentNode;
      fragments.forEach(f => parent.insertBefore(f, node));
      parent.removeChild(node);
    }
  });

  if (searchState.hits.length > 0) {
    searchState.index = 0;
    activateSearchHit(0);
  }
  updateSearchInfo();
}

function activateSearchHit(i) {
  searchState.hits.forEach(m => {
    m.classList.remove("search-hit-active");
    m.classList.add("search-hit");
  });
  if (i >= 0 && i < searchState.hits.length) {
    const target = searchState.hits[i];
    target.classList.add("search-hit-active");
    target.classList.remove("search-hit");
    target.scrollIntoView({ behavior: "smooth", block: "center" });
  }
  updateSearchInfo();
}

function searchNext() {
  if (searchState.hits.length === 0) return;
  searchState.index = (searchState.index + 1) % searchState.hits.length;
  activateSearchHit(searchState.index);
}
function searchPrev() {
  if (searchState.hits.length === 0) return;
  searchState.index = (searchState.index - 1 + searchState.hits.length) % searchState.hits.length;
  activateSearchHit(searchState.index);
}
function updateSearchInfo() {
  const info = $("#search-info");
  if (!info) return;
  if (searchState.hits.length === 0 && searchState.query) {
    info.textContent = "0件";
  } else if (searchState.hits.length > 0) {
    info.textContent = `${searchState.index + 1} / ${searchState.hits.length}`;
  } else {
    info.textContent = "";
  }
}

function setupSearch() {
  $("#btn-search").addEventListener("click", openSearch);
  $("#search-close").addEventListener("click", closeSearch);
  $("#search-next").addEventListener("click", searchNext);
  $("#search-prev").addEventListener("click", searchPrev);
  let timer;
  $("#search-input").addEventListener("input", (e) => {
    clearTimeout(timer);
    timer = setTimeout(() => performSearch(e.target.value), 200);
  });
  $("#search-input").addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      if (e.shiftKey) searchPrev();
      else searchNext();
    } else if (e.key === "Escape") {
      e.preventDefault();
      closeSearch();
    }
  });
}

// ============================================================
// ズーム
// ============================================================
function applyZoom() {
  const area = document.querySelector("#preview");
  if (!area) return;
  // CSS の zoom プロパティ（レイアウトサイズも縮む・中央寄せが普通に効く）
  area.style.zoom = state.zoom;

  // 旧 transform 方式の後始末
  const wrapper = document.querySelector(".preview-wrapper");
  if (wrapper) {
    wrapper.style.transform = "";
    wrapper.style.marginLeft = "";
  }

  const pct = `${Math.round(state.zoom * 100)}%`;
  const lvl = $("#zoom-level");
  if (lvl) lvl.textContent = pct;
  localStorage.setItem("md_preview_zoom", String(state.zoom));
}

function setZoom(z) {
  state.zoom = Math.max(0.4, Math.min(2.5, z));
  applyZoom();
}

function zoomIn() { setZoom(state.zoom + 0.1); }
function zoomOut() { setZoom(state.zoom - 0.1); }
function zoomReset() { setZoom(1.0); }

/* 画面幅にフィット（A4幅 794px = 210mm@96dpi に対する倍率を計算） */
function zoomFitWidth() {
  const contentEl = document.querySelector(".content");
  if (!contentEl) return;
  const avail = contentEl.clientWidth - 8;
  const a4Width = 794;
  const z = Math.min(Math.max(avail / a4Width, 0.5), 2.5);
  setZoom(z);
}

/* ピンチアウト/イン（トラックパッド・タッチスクリーン両対応） */
function setupPinchZoom() {
  const target = document.querySelector(".content");
  if (!target) return;

  // ① Chromium/Edge/Firefox: トラックパッドのピンチは wheel + ctrlKey として届く
  target.addEventListener("wheel", (e) => {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      // deltaY が大きいほど早くズームする
      const factor = Math.exp(-e.deltaY * 0.01);
      setZoom(state.zoom * factor);
    }
  }, { passive: false });

  // ② Safari: gesture イベント
  let gestureStart = 1;
  target.addEventListener("gesturestart", (e) => {
    e.preventDefault();
    gestureStart = state.zoom;
  }, { passive: false });
  target.addEventListener("gesturechange", (e) => {
    e.preventDefault();
    setZoom(gestureStart * e.scale);
  }, { passive: false });
  target.addEventListener("gestureend", (e) => {
    e.preventDefault();
  }, { passive: false });

  // ③ タッチスクリーン: 2本指タッチによるピンチ
  let touchStartDist = 0;
  let touchStartZoom = 1;
  function dist(t1, t2) {
    const dx = t1.clientX - t2.clientX;
    const dy = t1.clientY - t2.clientY;
    return Math.sqrt(dx * dx + dy * dy);
  }
  target.addEventListener("touchstart", (e) => {
    if (e.touches.length === 2) {
      touchStartDist = dist(e.touches[0], e.touches[1]);
      touchStartZoom = state.zoom;
    }
  }, { passive: true });
  target.addEventListener("touchmove", (e) => {
    if (e.touches.length === 2 && touchStartDist > 0) {
      e.preventDefault();
      const d = dist(e.touches[0], e.touches[1]);
      setZoom(touchStartZoom * (d / touchStartDist));
    }
  }, { passive: false });
}

// ============================================================
// エディタ
// ============================================================
function setEditorStatus(status) {
  const el = $("#editor-status");
  if (!el) return;
  el.className = "editor-status " + status;
  el.textContent = {
    clean:  "● 保存済",
    dirty:  "● 未保存",
    saving: "● 保存中…",
    error:  "● エラー"
  }[status] || "●";
}

function toggleEditMode() {
  state.editMode = !state.editMode;
  document.body.classList.toggle("editor-open", state.editMode);
  $("#btn-toggle-edit").classList.toggle("active", state.editMode);
  const layout = document.querySelector(".layout");
  if (state.editMode) {
    if (state.currentMarkdown) {
      $("#editor-textarea").value = state.currentMarkdown;
      setEditorStatus("clean");
    }
    // 前回ドラッグで保存した高さを復元
    const savedH = parseFloat(localStorage.getItem("md_preview_editor_h"));
    if (savedH && savedH > 80) {
      layout.style.gridTemplateRows = `1fr ${savedH}px`;
    }
    setTimeout(() => $("#editor-textarea").focus(), 350);
  } else {
    // 閉じる時はインラインスタイルを除去（CSS のデフォルトに戻る）
    layout.style.gridTemplateRows = "";
  }
}

function closeEditMode() {
  if (!state.editMode) return;
  state.editMode = false;
  document.body.classList.remove("editor-open");
  $("#btn-toggle-edit").classList.remove("active");
  document.querySelector(".layout").style.gridTemplateRows = "";
}

function setupEditorResize() {
  const handle = document.getElementById("editor-resize-handle");
  if (!handle) return;
  let dragging = false;
  let startY = 0;
  let startHeightPx = 0;
  const layout = document.querySelector(".layout");

  handle.addEventListener("mousedown", (e) => {
    if (!state.editMode) return;
    dragging = true;
    startY = e.clientY;
    // 現在のエディタ行の実際の高さを取得
    const editorRect = document.getElementById("editor-pane").getBoundingClientRect();
    startHeightPx = editorRect.height;
    document.body.classList.add("resizing-editor");
    handle.classList.add("dragging");
    e.preventDefault();
  });

  document.addEventListener("mousemove", (e) => {
    if (!dragging) return;
    const delta = startY - e.clientY;  // 上に動かすと editor が大きくなる
    const minH = 80;
    const maxH = window.innerHeight - 200;
    const newHeight = Math.max(minH, Math.min(maxH, startHeightPx + delta));
    layout.style.gridTemplateRows = `1fr ${newHeight}px`;
    // ピンチで center を保つためズーム再計算（margin変動）
    applyZoom();
  });

  document.addEventListener("mouseup", () => {
    if (dragging) {
      dragging = false;
      document.body.classList.remove("resizing-editor");
      handle.classList.remove("dragging");
      // 高さを localStorage に保存
      const h = parseFloat(layout.style.gridTemplateRows.split(" ")[1]);
      if (h && !isNaN(h)) localStorage.setItem("md_preview_editor_h", String(h));
    }
  });

  // タッチデバイス対応
  handle.addEventListener("touchstart", (e) => {
    if (!state.editMode) return;
    dragging = true;
    startY = e.touches[0].clientY;
    startHeightPx = document.getElementById("editor-pane").getBoundingClientRect().height;
    document.body.classList.add("resizing-editor");
    handle.classList.add("dragging");
    e.preventDefault();
  }, { passive: false });
  document.addEventListener("touchmove", (e) => {
    if (!dragging || e.touches.length !== 1) return;
    const delta = startY - e.touches[0].clientY;
    const newHeight = Math.max(80, Math.min(window.innerHeight - 200, startHeightPx + delta));
    layout.style.gridTemplateRows = `1fr ${newHeight}px`;
    applyZoom();
    e.preventDefault();
  }, { passive: false });
  document.addEventListener("touchend", () => {
    if (dragging) {
      dragging = false;
      document.body.classList.remove("resizing-editor");
      handle.classList.remove("dragging");
    }
  });
}

function setupScrollSync() {
  const preview = document.querySelector(".content");
  const editor = document.getElementById("editor-textarea");
  if (!preview || !editor) return;

  let syncing = false;
  let resetTimer = null;

  function safeSync(fn) {
    if (syncing) return;
    syncing = true;
    fn();
    clearTimeout(resetTimer);
    resetTimer = setTimeout(() => { syncing = false; }, 80);
  }

  preview.addEventListener("scroll", () => {
    if (!state.editMode) return;
    safeSync(() => {
      const max = preview.scrollHeight - preview.clientHeight;
      if (max <= 0) return;
      const ratio = preview.scrollTop / max;
      const eMax = editor.scrollHeight - editor.clientHeight;
      editor.scrollTop = ratio * eMax;
    });
  });

  editor.addEventListener("scroll", () => {
    if (!state.editMode) return;
    safeSync(() => {
      const max = editor.scrollHeight - editor.clientHeight;
      if (max <= 0) return;
      const ratio = editor.scrollTop / max;
      const pMax = preview.scrollHeight - preview.clientHeight;
      preview.scrollTop = ratio * pMax;
    });
  });
}

function setupEditor() {
  const ta = $("#editor-textarea");
  if (!ta) return;
  ta.addEventListener("input", () => {
    setEditorStatus("dirty");
    clearTimeout(state.saveTimer);
    state.saveTimer = setTimeout(async () => {
      const content = ta.value;
      if (content === state.lastSavedContent) {
        setEditorStatus("clean");
        return;
      }
      await saveFile(content);
      // ファイル更新→自動でSSEで再レンダリング起こる
    }, 600); // 600ms デバウンス
  });

  // Cmd+S / Ctrl+S で即保存
  ta.addEventListener("keydown", (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "s") {
      e.preventDefault();
      clearTimeout(state.saveTimer);
      saveFile(ta.value);
    }
  });
}

function attachPins() {
  // 段落IDごとのコメント数マップ
  const counts = {};
  state.currentComments.forEach(c => {
    counts[c.paragraph_id] = (counts[c.paragraph_id] || 0) + 1;
  });

  // 全段落要素にピンをセット
  document.querySelectorAll('#preview [data-paragraph-id]').forEach(p => {
    // 既存のピン削除
    p.querySelectorAll('.comment-pin').forEach(x => x.remove());
    p.classList.remove('has-comment');

    const pid = p.dataset.paragraphId;
    const count = counts[pid] || 0;

    const pin = el("button", {
      class: "comment-pin" + (count ? " has-comment" : ""),
      title: count ? `${count}件のコメント` : "コメント追加",
      onclick: (e) => {
        e.stopPropagation();
        openCommentPopup(p);
      }
    }, [count ? String(count) : "💬"]);

    p.appendChild(pin);
    if (count) p.classList.add('has-comment');
  });
}

function renderCommentList() {
  const list = $("#comment-list");
  list.innerHTML = "";
  if (state.currentComments.length === 0) {
    list.appendChild(el("li", { class: "empty" }, ["（まだコメントはありません）"]));
    return;
  }
  state.currentComments.forEach(c => {
    const li = el("li", {
      onclick: () => scrollToParagraph(c.paragraph_id)
    }, [
      el("div", { class: "cm-snippet" }, [c.paragraph_text_snapshot.slice(0, 30) + "…"]),
      el("div", { class: "cm-text" }, [c.comment]),
      el("span", { class: "cm-status " + c.status }, [c.status === "applied" ? "✓ 反映済" : "未反映"])
    ]);
    list.appendChild(li);
  });
}

function scrollToParagraph(pid) {
  const p = document.querySelector(`[data-paragraph-id="${pid}"]`);
  if (p) {
    p.scrollIntoView({ behavior: "smooth", block: "center" });
    p.style.animation = "flash 1s";
    setTimeout(() => { p.style.animation = ""; }, 1000);
  }
}

// ============================================================
// コメントポップアップ
// ============================================================
function openCommentPopup(paragraph) {
  closePopup();

  const pid = paragraph.dataset.paragraphId;
  const text = paragraph.innerText.trim();
  const existing = state.currentComments.filter(c => c.paragraph_id === pid);

  const tpl = $("#comment-popup-template").content.cloneNode(true);
  const popup = tpl.querySelector(".comment-popup");

  // 既存コメント
  const existingArea = popup.querySelector(".comment-popup-existing");
  if (existing.length === 0) {
    existingArea.style.display = "none";
  } else {
    existing.forEach(c => {
      const item = el("div", { class: "existing-item" }, [
        el("div", { class: "existing-meta" }, [
          el("span", {}, [c.created_at.replace("T", " ")]),
          el("span", { class: "existing-status " + c.status }, [c.status])
        ]),
        el("div", { class: "existing-text" }, [c.comment]),
        el("div", { class: "existing-actions" }, [
          el("button", {
            onclick: async () => {
              if (!confirm("このコメントを削除しますか？")) return;
              await postComment("delete", { id: c.id });
              openCommentPopup(paragraph);
            }
          }, ["削除"]),
          c.status === "pending"
            ? el("button", {
                onclick: async () => {
                  await postComment("update", { id: c.id, status: "applied" });
                  openCommentPopup(paragraph);
                }
              }, ["反映済にする"])
            : el("button", {
                onclick: async () => {
                  await postComment("update", { id: c.id, status: "pending" });
                  openCommentPopup(paragraph);
                }
              }, ["未反映に戻す"])
        ])
      ]);
      existingArea.appendChild(item);
    });
  }

  popup.querySelector(".comment-popup-close").addEventListener("click", closePopup);
  popup.querySelector(".comment-popup-cancel").addEventListener("click", closePopup);
  popup.querySelector(".comment-popup-save").addEventListener("click", async () => {
    const ta = popup.querySelector(".comment-popup-input");
    const c = ta.value.trim();
    if (!c) return;
    await postComment("add", {
      paragraph_id: pid,
      paragraph_text_snapshot: text.slice(0, 200),
      comment: c
    });
    closePopup();
  });

  paragraph.appendChild(popup);
  state.popup = popup;
  popup.querySelector(".comment-popup-input").focus();
}

function closePopup() {
  if (state.popup) {
    state.popup.remove();
    state.popup = null;
  }
}

// ============================================================
// SSE（ライブリロード）
// ============================================================
function connectSSE() {
  const es = new EventSource("/events");
  es.onmessage = async (e) => {
    try {
      const msg = JSON.parse(e.data);
      if (msg.type === "file_changed") {
        if (state.currentFile && msg.files.includes(state.currentFile)) {
          // 現在のファイルが変更された → 再レンダリング
          await loadFile(state.currentFile);
          showToast("ファイル更新を検知 — リロードしました");
        }
        // ファイル一覧も更新
        fetchFiles();
      } else if (msg.type === "comments_updated") {
        if (state.currentFile === msg.file) {
          await loadFile(state.currentFile);
        }
      }
    } catch (err) {
      console.warn("SSE parse error", err);
    }
  };
  es.onerror = () => {
    es.close();
    setTimeout(connectSSE, 3000); // 再接続
  };
}

function showToast(text) {
  const toast = el("div", {
    style: "position:fixed;bottom:20px;right:20px;background:#333;color:white;padding:10px 18px;border-radius:6px;z-index:1000;font-size:13px;box-shadow:0 2px 8px rgba(0,0,0,0.3);"
  }, [text]);
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 3000);
}

// ============================================================
// 初期化
// ============================================================
function init() {
  $("#btn-print").addEventListener("click", () => window.print());
  $("#btn-toggle-comments").addEventListener("click", (e) => {
    document.body.classList.toggle("comments-hidden");
    e.currentTarget.classList.toggle("active");
  });
  $("#btn-reload").addEventListener("click", async () => {
    await fetchFiles();
    if (state.currentFile) await loadFile(state.currentFile);
  });

  // ズーム表示部分のダブルクリックで100%にリセット（ボタン削除のため代替）
  $("#zoom-level").addEventListener("dblclick", zoomReset);

  // ウィンドウサイズ変更時にマージン再計算
  let resizeTimer;
  window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => applyZoom(), 100);
  });

  setupPinchZoom();

  // 編集モード
  $("#btn-toggle-edit").addEventListener("click", toggleEditMode);
  $("#editor-close").addEventListener("click", closeEditMode);
  setupEditor();
  setupEditorResize();
  setupScrollSync();
  setupSearch();


  // サイドバー切替
  $("#btn-toggle-sidebar").addEventListener("click", (e) => {
    document.body.classList.toggle("sidebar-hidden");
    e.currentTarget.classList.toggle("active");
  });

  // 岡口マクロ風自動番号トグル
  const numberBtn = $("#btn-toggle-numbers");
  if (numberBtn) {
    // 前回状態の復元
    if (localStorage.getItem("md_preview_auto_number") === "true") {
      document.body.classList.add("auto-number");
      numberBtn.classList.add("active");
      // レンダリング後に既存番号を除去
      setTimeout(stripManualNumbers, 100);
    }
    numberBtn.addEventListener("click", (e) => {
      const on = document.body.classList.toggle("auto-number");
      e.currentTarget.classList.toggle("active", on);
      localStorage.setItem("md_preview_auto_number", String(on));
      if (on) stripManualNumbers();
      else restoreManualNumbers();
    });
  }

  // キーボードショートカット
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      // ポップアップが開いていればそれを閉じる、編集モードなら編集を閉じる
      if (state.popup) {
        closePopup();
      } else if (state.editMode) {
        closeEditMode();
      }
      return;
    }
    // Ctrl/Cmd + ズーム / 検索
    if (e.metaKey || e.ctrlKey) {
      if (e.key === "=" || e.key === "+") {
        e.preventDefault();
        zoomIn();
      } else if (e.key === "-") {
        e.preventDefault();
        zoomOut();
      } else if (e.key === "0") {
        e.preventDefault();
        zoomReset();
      } else if (e.key === "f") {
        e.preventDefault();
        openSearch();
      }
    }
  });

  // 外側クリックでポップアップ閉じる
  document.addEventListener("click", (e) => {
    if (state.popup && !state.popup.contains(e.target)
        && !e.target.classList.contains("comment-pin")) {
      closePopup();
    }
  });

  // 初期ズーム：保存値があればそれ、なければ画面幅にフィット
  const savedZoom = localStorage.getItem("md_preview_zoom");
  if (savedZoom) {
    applyZoom();
  }

  fetchFiles().then(() => {
    // 最初のファイルを自動表示
    if (state.files.length > 0) {
      loadFile(state.files[0].path);
    }
    // ロード後に zoom 未設定なら自動フィット
    if (!savedZoom) {
      setTimeout(zoomFitWidth, 200);
    }
  });

  connectSSE();
}

// CSS animation for highlight
const styleEl = document.createElement("style");
styleEl.textContent = `
@keyframes flash {
  0% { background: rgba(232, 168, 56, 0.4); }
  100% { background: transparent; }
}
`;
document.head.appendChild(styleEl);

document.addEventListener("DOMContentLoaded", init);
