/* ui.js
 * 役割: 画面描画とイベントハンドリング (View層)
 * - DOMに依存
 * - 各画面 renderXxx は文字列ではなく直接innerHTMLを書き、ハンドラをbind
 * - モーダル / トースト / ルーティング
 */

import { Store } from "./store.js";
import {
  escapeHTML, domainOf, nowISO, frequencyMap, dateOnly
} from "./utils.js";
import { TODAY_LIMIT, TREND_LINKS, TREND_TEMPLATE, DEFAULT_CATEGORIES } from "./config.js";
import {
  addArticleQuick, updateArticle, pickTodayArticles, deleteArticle
} from "./articles.js";
import { addMemoQuick, deleteMemo } from "./memos.js";
import { generateWeeklyReview, generateMonthlyReview } from "./reviews.js";
import {
  exportArticlesCSV, exportJSONBackup, importJSONBackup, downloadFile, copyText
} from "./exporter.js";
import { syncRowAsync, loadGASCode, pullAll, GAS_CODE_URL, GAS_SETUP_URL } from "./sync.js";
import { addFeed, deleteFeed, updateFeed, fetchAllEnabled, fetchFeedAndStore } from "./feeds.js";
import { DEFAULT_CORS_PROXY } from "./rss.js";
import { isTodayDone, missedYesterday, StreakEvents, markActive } from "./streak.js";
import { loadSamples } from "./samples.js";
import { __runSelfTests } from "./tests.js";
import { renderDashboardHTML } from "./dashboard.js";
import { setTheme } from "./theme.js";

let currentRoute = "home";
// ルーター経由でレビュータブを切り替えるためのバッファ
let pendingReviewTab = null;

/* ---------- 小ヘルパ ---------- */
function $(sel, ctx = document) { return ctx.querySelector(sel); }
function $all(sel, ctx = document) { return Array.from(ctx.querySelectorAll(sel)); }
function bind(sel, fn, ev = "click", ctx = document) {
  const el = ctx.querySelector(sel); if (el) el.addEventListener(ev, fn);
}
export function toast(msg) {
  const t = document.createElement("div");
  t.className = "toast"; t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2100);
}
// StreakのイベントもToastに流す
StreakEvents.onMessage = toast;

/* ---------- ルーター ---------- */
export function route(name, opts = {}) {
  if (opts.tab) pendingReviewTab = opts.tab;
  currentRoute = name;
  $all("nav.bottom-nav button").forEach((b) => b.classList.toggle("active", b.dataset.route === name));
  const view = $("#view"); view.innerHTML = "";
  switch (name) {
    case "home": renderHome(view); break;
    case "today": renderToday(view); break;
    case "saved": renderSaved(view); break;
    case "memos": renderMemos(view); break;
    case "reviews": renderReviews(view); break;
    case "trends": renderTrends(view); break;
    case "settings": renderSettings(view); break;
    case "sync": renderSync(view); break;
    default: renderHome(view);
  }
  window.scrollTo({ top: 0, behavior: "instant" });
}

/* ---------- ヘッダーチップ更新 ---------- */
export function renderStreakChip() {
  const s = Store.state.streak;
  const el = $("#streakChip"); if (el) el.textContent = `🔥 ${s.current}日`;
}

/* ---------- 記事カードHTML (Today/Savedで共用) ---------- */
function renderArticleCardHTML(a) {
  const impClass = a.importance === "high" ? "pill-imp-high" : a.importance === "low" ? "pill-imp-low" : "pill-imp-mid";
  const impLabel = a.importance === "high" ? "高" : a.importance === "low" ? "低" : "中";
  const cat = a.category ? `<span class="pill pill-cat">${escapeHTML(a.category)}</span>` : "";
  const tags = (a.tags || []).slice(0, 3).map((t) => `<span class="pill pill-tag">${escapeHTML(t)}</span>`).join("");
  const src = a.source_name ? `<span class="pill">${escapeHTML(a.source_name)}</span>` : "";
  const summary = a.summary ? escapeHTML(a.summary).slice(0, 140) : "<span class='micro'>(要約なし)</span>";
  // status: "saved" | "inbox" | "discarded"
  const status = a.status || "saved";
  const statusPill =
    status === "inbox"     ? `<span class="pill pill-inbox">未判定</span>` :
    status === "discarded" ? `<span class="pill pill-discard">不要</span>` :
                             "";
  // 状態に応じた操作群
  let actions = "";
  if (status === "discarded") {
    // 不要 → 未判定に戻す/完全削除
    actions = `
      <button class="btn btn-ok" data-act="restore">↩ 復元 (未判定へ)</button>
      <button class="btn btn-danger" data-act="trash">🗑 完全削除</button>`;
  } else {
    // saved / inbox 共通
    actions = `
      <button class="btn btn-ok" data-act="save">📌 ${status === "saved" ? "保存済" : "保存する"}</button>
      <button class="btn btn-info" data-act="deep">🔍 深掘り</button>
      <button class="btn" data-act="memo">📝 メモ</button>
      <button class="btn btn-danger" data-act="discard">✕ 不要</button>`;
  }
  // 詳細メニュー内の操作（保存解除 / 完全削除など破壊的操作はここに集約）
  let detailActions = `
    <button class="btn" data-act="open">🔗 元記事を開く</button>
    <button class="btn" data-act="bump">⬆ 重要度↑</button>
    <button class="btn" data-act="review">📊 週次に送る</button>`;
  if (status === "saved") {
    detailActions += `<button class="btn" data-act="unsave">↩ 保存解除</button>`;
  }
  if (status !== "discarded") {
    detailActions += `<button class="btn btn-danger" data-act="trash">🗑 完全削除</button>`;
  }

  return `<div class="article" data-id="${a.article_id}">
    <div class="meta">
      <span class="pill ${impClass}">重要度: ${impLabel}</span>
      ${statusPill}${cat}${src}${tags}
    </div>
    <h3 class="title">${escapeHTML(a.title)}</h3>
    <div class="summary">${summary}</div>
    <div class="actions">${actions}</div>
    <details class="detail"><summary>詳細・操作</summary><div class="body">
      ${a.url ? `<div class="micro">URL: <a href="${escapeHTML(a.url)}" target="_blank" rel="noopener">${escapeHTML(a.url)}</a></div>` : ""}
      ${a.user_memo ? `<div style="margin-top:6px;">📝 ${escapeHTML(a.user_memo)}</div>` : ""}
      <div style="margin-top:8px; display:flex; gap:6px; flex-wrap:wrap;">${detailActions}</div>
    </div></details>
  </div>`;
}

function bindArticleCardHandlers() {
  $all(".article").forEach((card) => {
    const id = card.dataset.id;
    card.querySelectorAll("[data-act]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const a = Store.state.articles.find((x) => x.article_id === id);
        if (!a) return;
        const act = btn.dataset.act;
        if (act === "save") {
          // inbox → saved に確定。すでに saved の場合は何もしない（UI 上はボタン文言で示す）
          a.status = "saved";
          a.archived_flag = false;
          a.updated_at = nowISO();
          Store.save(); markActive(); toast("保存しました"); route(currentRoute);
        }
        else if (act === "unsave") {
          // 保存解除 → 未判定 (inbox) に戻す
          a.status = "inbox";
          a.archived_flag = false;
          a.updated_at = nowISO();
          Store.save(); toast("保存を解除しました（未判定）"); route(currentRoute);
        }
        else if (act === "discard") {
          a.status = "discarded"; a.archived_flag = true;
          a.updated_at = nowISO();
          Store.save(); markActive(); toast("不要に振り分けました"); route(currentRoute);
        }
        else if (act === "restore") {
          // 不要 → 未判定に復元
          a.status = "inbox"; a.archived_flag = false;
          a.updated_at = nowISO();
          Store.save(); toast("未判定に戻しました"); route(currentRoute);
        }
        else if (act === "trash") {
          if (!confirm("この記事を完全に削除しますか？元には戻せません。")) return;
          deleteArticle(id); toast("削除しました"); route(currentRoute);
        }
        else if (act === "deep") {
          a.use_cases = Array.from(new Set([...(a.use_cases || []), "深掘りする"]));
          a.review_target = true; Store.save(); markActive(); toast("深掘り対象に追加");
        }
        else if (act === "memo") { openAddMemoModal(a.article_id); }
        else if (act === "open") { if (a.url) window.open(a.url, "_blank", "noopener"); }
        else if (act === "bump") {
          a.user_importance_boost = (a.user_importance_boost || 0) + 15;
          updateArticle(a.article_id, {}); toast("重要度↑"); route(currentRoute);
        }
        else if (act === "review") {
          a.review_target = true; Store.save(); markActive(); toast("週次レビュー対象に追加");
        }
      });
    });
  });
}

/* ====================================================
   8.1 ホーム
   ==================================================== */
function renderHome(root) {
  const s = Store.state;
  const todayDone = isTodayDone();
  const missed = missedYesterday();
  const todayPicks = pickTodayArticles();
  const todayCount = todayPicks.length;

  let html = "";

  // Never miss twice バナー
  if (missed) {
    html += `<div class="banner">
      <b>昨日はお休みでしたね。</b> 今日<strong>1記事だけ</strong>確認すればストリーク継続です。
      <span class="freeze-chip">🛡 お休み券 残${s.streak.freeze_tokens}枚</span>
    </div>`;
  }

  // ミッション (最小目標)
  html += `<div class="hero">
    <h2>${todayDone ? "✅ 今日のミッション達成" : "🎯 今日のミッション"}</h2>
    <p>${todayDone
      ? "今日もお疲れさまでした。続きはまた明日でOK。"
      : "今日の重要記事を1件チェック or 1メモだけ書けばOK。所要1〜5分。"}</p>
  </div>`;

  // ストリーク
  html += `<div class="card">
    <div class="streak-card">
      <div class="item"><div class="num">🔥 ${s.streak.current}</div><div class="lbl">連続日数</div></div>
      <div class="item"><div class="num">🏆 ${s.streak.longest}</div><div class="lbl">最長</div></div>
      <div class="item"><div class="num">📅 ${s.streak.total_active_days}</div><div class="lbl">累計</div></div>
    </div>
    <div class="micro" style="margin-top:8px;">🛡 お休み券 ${s.streak.freeze_tokens}枚（1日休んでも継続。週1枚自動補充）</div>
  </div>`;

  // ショートカット
  html += `<div class="card">
    <div class="quick-grid">
      <button class="btn btn-primary" id="quickAdd">＋ URLを保存</button>
      <button class="btn btn-info" id="quickMemo">📝 メモを書く</button>
      <button class="btn" id="goToday">👀 おすすめ (${todayCount})</button>
      <button class="btn" id="goWeekly">📊 週次レビュー</button>
      <button class="btn" id="goDashboard">📈 ダッシュボード</button>
      <button class="btn" id="goTrends">🌐 トレンド</button>
    </div>
  </div>`;

  // ピックアップ
  const imp = todayPicks.slice(0, 3);
  html += `<h2 class="section-title">今日のピックアップ <span class="sub">最大${TODAY_LIMIT}件・重要度順</span></h2>`;
  if (imp.length === 0) {
    html += `<div class="card"><div class="empty">まだ記事がありません。<br>「＋ URLを保存」または「サンプルを読み込む」から始めましょう。</div>
      <button class="btn btn-block" id="loadSamples">📚 サンプルを読み込む</button>
    </div>`;
  } else {
    imp.forEach((a) => { html += renderArticleCardHTML(a); });
    html += `<button class="btn btn-ghost btn-block" id="goTodayMore">今日見るへ ▸</button>`;
  }

  // 今週傾向
  const weekAgo = new Date(); weekAgo.setDate(weekAgo.getDate() - 7);
  const wArts = Store.state.articles.filter((a) => (a.saved_at || a.created_at) >= weekAgo.toISOString());
  const tagFreq = frequencyMap(wArts, (a) => a.tags || []).slice(0, 3);
  html += `<h2 class="section-title">今週の傾向</h2>
    <div class="card">
      <div style="display:flex; gap:8px; flex-wrap:wrap;">
        ${tagFreq.length
          ? tagFreq.map(([t, c]) => `<span class="pill pill-tag">${escapeHTML(t)} ×${c}</span>`).join("")
          : `<div class="micro">今週はまだデータがありません。</div>`}
      </div>
    </div>`;

  root.innerHTML = html;

  bind("#quickAdd", () => openAddArticleModal());
  bind("#quickMemo", () => openAddMemoModal());
  bind("#goToday", () => route("today"));
  bind("#goWeekly", () => route("reviews"));
  bind("#goDashboard", () => route("reviews", { tab: "dashboard" }));
  bind("#goTrends", () => route("trends"));
  bind("#goTodayMore", () => route("today"));
  bind("#loadSamples", () => { loadSamples(); route("home"); });
  bindArticleCardHandlers();
}

/* ====================================================
   8.2 今日見る
   ==================================================== */
function renderToday(root) {
  const arts = pickTodayArticles();
  let html = `<h2 class="section-title">今日見るべき情報 <span class="sub">${arts.length}/${TODAY_LIMIT}件</span></h2>`;
  if (arts.length === 0) {
    html += `<div class="card"><div class="empty">記事がありません。「＋ URLを保存」から追加してみましょう。</div>
      <button class="btn btn-primary btn-block" id="quickAdd">＋ URLを保存</button>
    </div>`;
  } else {
    arts.forEach((a) => { html += renderArticleCardHTML(a); });
  }
  root.innerHTML = html;
  bind("#quickAdd", () => openAddArticleModal());
  bindArticleCardHandlers();
}

/* ====================================================
   8.3 保存記事
   ==================================================== */
function renderSaved(root) {
  // 全記事を母集合に。ステータスフィルタで「保存／未判定／不要」を切り替える
  const all = Store.state.articles;
  const savedCount  = all.filter((a) => (a.status || "saved") === "saved" && !a.archived_flag).length;
  const inboxCount  = all.filter((a) => a.status === "inbox" && !a.archived_flag).length;
  const discardCount = all.filter((a) => a.status === "discarded").length;
  let currentStatus = "saved"; // saved | inbox | discarded

  let html = `<h2 class="section-title">記事一覧</h2>
    <div class="card">
      <div class="chip-row" id="statusChips" role="tablist" aria-label="ステータス">
        <span class="chip selected" data-st="saved">📌 保存済 (${savedCount})</span>
        <span class="chip" data-st="inbox">📥 未判定 (${inboxCount})</span>
        <span class="chip" data-st="discarded">🗑 不要 (${discardCount})</span>
      </div>
      <div class="search-row" style="margin-top:8px;">
        <input type="text" id="srch" placeholder="キーワードで検索" />
        <select id="filterImp">
          <option value="">重要度すべて</option>
          <option value="high">高</option>
          <option value="mid">中</option>
          <option value="low">低</option>
        </select>
      </div>
      <div class="chip-row" id="catChips"></div>
    </div>
    <div id="savedList"></div>`;
  root.innerHTML = html;

  // ステータスチップ
  $all("#statusChips .chip", root).forEach((el) => {
    el.addEventListener("click", () => {
      $all("#statusChips .chip", root).forEach((x) => x.classList.remove("selected"));
      el.classList.add("selected");
      currentStatus = el.dataset.st;
      renderList();
    });
  });

  // カテゴリチップ
  const catChips = $("#catChips", root);
  ["", ...DEFAULT_CATEGORIES].forEach((c, idx) => {
    const el = document.createElement("span");
    el.className = "chip" + (idx === 0 ? " selected" : "");
    el.textContent = c || "すべて";
    el.dataset.cat = c;
    el.addEventListener("click", () => {
      $all("#catChips .chip", root).forEach((x) => x.classList.remove("selected"));
      el.classList.add("selected");
      renderList();
    });
    catChips.appendChild(el);
  });
  bind("#srch", () => renderList(), "input", root);
  bind("#filterImp", () => renderList(), "change", root);

  function renderList() {
    const q = ($("#srch", root).value || "").toLowerCase();
    const imp = $("#filterImp", root).value;
    const cat = $("#catChips .chip.selected", root)?.dataset.cat || "";
    const list = all.filter((a) => {
      const st = a.status || "saved";
      // ステータス一致
      if (currentStatus === "saved" && !(st === "saved" && !a.archived_flag)) return false;
      if (currentStatus === "inbox" && !(st === "inbox" && !a.archived_flag)) return false;
      if (currentStatus === "discarded" && st !== "discarded") return false;
      // 検索・フィルタ
      if (q && !((a.title || "").toLowerCase().includes(q)
        || (a.summary || "").toLowerCase().includes(q)
        || (a.user_memo || "").toLowerCase().includes(q))) return false;
      if (imp && a.importance !== imp) return false;
      if (cat && a.category !== cat) return false;
      return true;
    });
    const target = $("#savedList", root);
    if (list.length === 0) {
      const emptyMsg =
        currentStatus === "saved"     ? "保存済の記事はまだありません" :
        currentStatus === "inbox"     ? "未判定の記事はありません。RSS取得すると貯まります。" :
                                        "不要に振り分けた記事はありません";
      target.innerHTML = `<div class="empty">${emptyMsg}</div>`;
    } else {
      target.innerHTML = list.map(renderArticleCardHTML).join("");
    }
    bindArticleCardHandlers();
  }
  renderList();
}

/* ====================================================
   8.4 気づきメモ
   ==================================================== */
function renderMemos(root) {
  const memos = Store.state.memos;
  let html = `<h2 class="section-title">気づきメモ <span class="sub">${memos.length}件</span></h2>
    <button class="btn btn-primary btn-block" id="addMemo" style="margin-bottom:12px;">＋ メモを追加</button>`;
  if (memos.length === 0) {
    html += `<div class="empty">まだメモがありません。<br>記事カードの「📝 メモ」または上のボタンから追加できます。</div>`;
  } else {
    memos.forEach((m) => {
      const rel = m.related_article_id
        ? Store.state.articles.find((a) => a.article_id === m.related_article_id) : null;
      html += `<div class="memo" data-mid="${m.memo_id}">
        <div class="meta" style="display:flex;justify-content:space-between;align-items:center;">
          <span class="pill">${escapeHTML(new Date(m.created_at).toLocaleDateString())}</span>
          ${m.review_target ? '<span class="badge badge-info">週次対象</span>' : ''}
        </div>
        <h3>${escapeHTML(m.title)}</h3>
        <div class="summary" style="font-size:13px; color:var(--text);">${escapeHTML(m.what_happened || "")}</div>
        ${rel ? `<div class="micro micro-row">🔗 関連: ${escapeHTML(rel.title)}</div>` : ""}
        ${m.next_questions ? `<div class="micro micro-row">❓ ${escapeHTML(m.next_questions)}</div>` : ""}
        <div style="margin-top:8px; display:flex; gap:6px;">
          <button class="btn btn-danger" data-del="${m.memo_id}">削除</button>
        </div>
      </div>`;
    });
  }
  root.innerHTML = html;
  bind("#addMemo", () => openAddMemoModal());
  $all("[data-del]", root).forEach((b) => b.addEventListener("click", () => {
    if (!confirm("削除しますか？")) return;
    deleteMemo(b.dataset.del);
    route("memos");
  }));
}

/* ====================================================
   8.5 振り返り (週次/月次/トレンド観測)
   ==================================================== */
function renderReviews(root) {
  // pendingReviewTab があればそれを採用
  let activeTab = pendingReviewTab || "weekly";
  pendingReviewTab = null;
  const paint = () => {
    root.innerHTML = `<div class="tabs">
      <button data-t="weekly" class="${activeTab === 'weekly' ? 'active' : ''}">週次</button>
      <button data-t="monthly" class="${activeTab === 'monthly' ? 'active' : ''}">月次</button>
      <button data-t="trend" class="${activeTab === 'trend' ? 'active' : ''}">観測</button>
      <button data-t="dashboard" class="${activeTab === 'dashboard' ? 'active' : ''}">📊</button>
    </div><div id="rvBody"></div>`;
    $all(".tabs button", root).forEach((b) => b.addEventListener("click", () => { activeTab = b.dataset.t; paint(); }));
    const body = $("#rvBody", root);
    if (activeTab === "weekly") renderWeeklyBody(body);
    else if (activeTab === "monthly") renderMonthlyBody(body);
    else if (activeTab === "trend") renderTrendBody(body);
    else if (activeTab === "dashboard") body.innerHTML = renderDashboardHTML();
  };
  paint();
}
function renderWeeklyBody(body) {
  const list = Store.state.weekly_reviews;
  let html = `<div class="card card-soft">
    <div style="font-weight:700;">週次レビュー（過去7日）</div>
    <p class="micro" style="margin:4px 0 8px;">ボタンを押すと、自動でMarkdown下書きが生成されます。</p>
    <button class="btn btn-primary btn-block" id="genWeekly">📊 今週分を自動生成</button>
  </div>`;
  if (list.length === 0) html += `<div class="empty">まだレビューはありません</div>`;
  list.forEach((r) => {
    html += `<div class="card">
      <div class="meta"><span class="pill">${r.week_start} 〜 ${r.week_end}</span></div>
      <details class="detail" open>
        <summary>レビュー内容</summary>
        <div class="body"><pre class="review-md">${escapeHTML(r.markdown_output)}</pre>
          <div style="display:flex; gap:6px; flex-wrap:wrap; margin-top:8px;">
            <button class="btn" data-copy="${r.review_id}">Markdownをコピー</button>
            <button class="btn" data-dl="${r.review_id}">.md ダウンロード</button>
            <button class="btn btn-danger" data-rm="${r.review_id}">削除</button>
          </div>
        </div>
      </details>
    </div>`;
  });
  body.innerHTML = html;
  bind("#genWeekly", () => { generateWeeklyReview(); toast("週次レビューを生成しました"); route("reviews"); }, "click", body);
  $all("[data-copy]", body).forEach((b) => b.addEventListener("click", () => {
    const r = Store.state.weekly_reviews.find((x) => x.review_id === b.dataset.copy);
    if (r) copyText(r.markdown_output).then(() => toast("コピーしました"));
  }));
  $all("[data-dl]", body).forEach((b) => b.addEventListener("click", () => {
    const r = Store.state.weekly_reviews.find((x) => x.review_id === b.dataset.dl);
    if (r) downloadFile(`weekly_${r.week_end}.md`, r.markdown_output, "text/markdown");
  }));
  $all("[data-rm]", body).forEach((b) => b.addEventListener("click", () => {
    if (!confirm("削除しますか？")) return;
    const i = Store.state.weekly_reviews.findIndex((x) => x.review_id === b.dataset.rm);
    if (i >= 0) { Store.state.weekly_reviews.splice(i, 1); Store.save(); route("reviews"); }
  }));
}
function renderMonthlyBody(body) {
  const list = Store.state.monthly_reviews;
  let html = `<div class="card card-soft">
    <div style="font-weight:700;">月次レビュー（過去30日）</div>
    <p class="micro" style="margin:4px 0 8px;">関心の変化やテーマの繰り返しを振り返ります。</p>
    <button class="btn btn-primary btn-block" id="genMonthly">📊 今月分を自動生成</button>
  </div>`;
  if (list.length === 0) html += `<div class="empty">まだ月次レビューはありません</div>`;
  list.forEach((r) => {
    html += `<div class="card">
      <div class="meta"><span class="pill">${r.month}</span></div>
      <details class="detail" open>
        <summary>レビュー内容</summary>
        <div class="body"><pre class="review-md">${escapeHTML(r.markdown_output)}</pre>
          <div style="display:flex; gap:6px; flex-wrap:wrap; margin-top:8px;">
            <button class="btn" data-cm="${r.review_id}">Markdownをコピー</button>
            <button class="btn" data-dm="${r.review_id}">.md ダウンロード</button>
            <button class="btn btn-danger" data-rmm="${r.review_id}">削除</button>
          </div>
        </div>
      </details>
    </div>`;
  });
  body.innerHTML = html;
  bind("#genMonthly", () => { generateMonthlyReview(); toast("月次レビューを生成しました"); route("reviews"); }, "click", body);
  $all("[data-cm]", body).forEach((b) => b.addEventListener("click", () => {
    const r = Store.state.monthly_reviews.find((x) => x.review_id === b.dataset.cm);
    if (r) copyText(r.markdown_output).then(() => toast("コピーしました"));
  }));
  $all("[data-dm]", body).forEach((b) => b.addEventListener("click", () => {
    const r = Store.state.monthly_reviews.find((x) => x.review_id === b.dataset.dm);
    if (r) downloadFile(`monthly_${r.month}.md`, r.markdown_output, "text/markdown");
  }));
  $all("[data-rmm]", body).forEach((b) => b.addEventListener("click", () => {
    if (!confirm("削除しますか？")) return;
    const i = Store.state.monthly_reviews.findIndex((x) => x.review_id === b.dataset.rmm);
    if (i >= 0) { Store.state.monthly_reviews.splice(i, 1); Store.save(); route("reviews"); }
  }));
}
function renderTrendBody(body) {
  const obs = Store.state.trend_observations;
  let html = `<div class="card card-soft">
    <div style="font-weight:700;">トレンド観測メモ</div>
    <p class="micro" style="margin:4px 0 8px;">外部トレンドサイトを見て気づいたことを残します。</p>
    <button class="btn btn-primary btn-block" id="addTrend">＋ 観測メモを追加</button>
  </div>`;
  if (obs.length === 0) html += `<div class="empty">まだ観測メモはありません</div>`;
  obs.forEach((o) => {
    html += `<div class="card">
      <div class="meta">
        <span class="pill">${escapeHTML(o.tool_name || "未指定")}</span>
        <span class="pill">${escapeHTML(new Date(o.observed_at).toLocaleDateString())}</span>
      </div>
      <h3 style="margin:4px 0; font-size:14px;">${escapeHTML(o.topic || "(無題)")}</h3>
      <pre class="review-md">${escapeHTML(o.consumer_insight || "")}</pre>
      <button class="btn btn-danger" data-rmt="${o.observation_id}" style="margin-top:6px;">削除</button>
    </div>`;
  });
  body.innerHTML = html;
  bind("#addTrend", () => openTrendModal(), "click", body);
  $all("[data-rmt]", body).forEach((b) => b.addEventListener("click", () => {
    if (!confirm("削除しますか？")) return;
    const i = Store.state.trend_observations.findIndex((x) => x.observation_id === b.dataset.rmt);
    if (i >= 0) { Store.state.trend_observations.splice(i, 1); Store.save(); route("reviews"); }
  }));
}

/* ====================================================
   8.6 トレンドサイト集
   ==================================================== */
function renderTrends(root) {
  let html = `<h2 class="section-title">外部トレンド観測</h2>
    <div class="card">
      <p class="micro">外部の無料ツールを開いて、気づきを観測メモに残しましょう。</p>
      <div class="link-list">
        ${TREND_LINKS.map((l) => `<a href="${l.url}" target="_blank" rel="noopener">${escapeHTML(l.name)}<span class="arrow">↗</span></a>`).join("")}
      </div>
    </div>
    <h2 class="section-title">観測テンプレート</h2>
    <div class="card">
      <pre class="review-md">${escapeHTML(TREND_TEMPLATE)}</pre>
      <button class="btn btn-block" id="copyTrendT">テンプレートをコピー</button>
      <button class="btn btn-primary btn-block" id="newTrend" style="margin-top:6px;">＋ 観測メモを追加</button>
    </div>
    <h2 class="section-title">ウォッチキーワード</h2>
    <div class="card">
      <p class="micro" style="margin-bottom:8px;">Google Alertsに登録すると新着が届きます。</p>
      <div class="chip-row">
        ${Store.state.keywords.map((k) => `<span class="chip">${escapeHTML(k.keyword)}</span>`).join("")}
      </div>
    </div>`;
  root.innerHTML = html;
  bind("#copyTrendT", () => copyText(TREND_TEMPLATE).then(() => toast("コピーしました")));
  bind("#newTrend", () => openTrendModal());
}

/* ====================================================
   8.7 設定
   ==================================================== */
function renderSettings(root) {
  const st = Store.state.settings;
  root.innerHTML = `<h2 class="section-title">外観</h2>
    <div class="card">
      <div class="setting-row">
        <div>
          <div class="label">テーマ</div>
          <div class="desc">ライト / ダーク / 自動（端末設定に追従）</div>
        </div>
        <select id="themeSelect" style="width:auto; min-width: 120px;">
          <option value="auto" ${st.theme === "auto" ? "selected" : ""}>自動</option>
          <option value="light" ${st.theme === "light" ? "selected" : ""}>ライト</option>
          <option value="dark" ${st.theme === "dark" ? "selected" : ""}>ダーク</option>
        </select>
      </div>
    </div>

    <h2 class="section-title">設定</h2>
    <div class="card">
      <div class="setting-row">
        <div>
          <div class="label">1日に表示する記事数</div>
          <div class="desc">推奨は10件（疲れない量）</div>
        </div>
        <input type="number" min="1" max="50" id="dailyLimit" value="${st.daily_article_limit}" style="width:80px;" />
      </div>
      <div class="setting-row">
        <div>
          <div class="label">週次レビュー曜日</div>
          <div class="desc">レビューの目安となる曜日</div>
        </div>
        <select id="reviewDay" style="width:120px;">
          ${[["0","日"],["1","月"],["2","火"],["3","水"],["4","木"],["5","金"],["6","土"]]
            .map(([v,n]) => `<option value="${v}" ${st.weekly_review_day == v ? "selected" : ""}>${n}曜</option>`).join("")}
        </select>
      </div>
    </div>

    <h2 class="section-title">通知（任意）</h2>
    <div class="card">
      <p class="micro">ブラウザの許可ダイアログでONにすると、テスト通知が出ます（バックグラウンドはOS対応次第）。</p>
      <button class="btn btn-block" id="notifyEnable">${st.notifications_enabled ? "通知ON（再申請）" : "🔔 通知をONにする"}</button>
    </div>

    <h2 class="section-title">Googleスプレッドシート連携</h2>
    <div class="card">
      <p class="micro">GAS(Google Apps Script) Web App URL を貼ると、保存時に自動追記＋マルチ端末同期＋RSSプロキシが使えます。空欄ならローカルのみ。</p>
      <label class="field"><span class="lbl">GAS Web App URL</span>
        <input type="url" id="gasUrl" placeholder="https://script.google.com/macros/s/.../exec" value="${escapeHTML(st.gas_url || "")}" />
      </label>
      <button class="btn btn-block" id="saveGas">保存</button>
      <div class="micro" style="margin-top:8px;">
        📄 <a href="${GAS_SETUP_URL}" target="_blank" rel="noopener">セットアップ手順 (SETUP.md)</a>
        ／ <a href="${GAS_CODE_URL}" download>Code.gs をダウンロード</a>
      </div>
      <details class="detail" style="margin-top:10px;" id="gasDetails">
        <summary>GASコードを表示（コピペで設定）</summary>
        <div class="body">
          <pre class="review-md" id="gasCodeBox" style="max-height:280px; overflow:auto;">クリックして読み込み…</pre>
          <button class="btn" id="copyGas">📋 コードをコピー</button>
        </div>
      </details>
    </div>

    <h2 class="section-title">マルチ端末同期</h2>
    <div class="card">
      <p class="micro">GASを設定済みなら、複数の端末で同じデータを共有できます（最後の更新が勝つマージ方式）。</p>
      <div class="setting-row">
        <div>
          <div class="label">起動時に自動プル</div>
          <div class="desc">アプリ起動時にクラウドから最新を取得</div>
        </div>
        <label class="switch"><input type="checkbox" id="autoPull" ${st.auto_pull_on_startup ? "checked" : ""} /></label>
      </div>
      <button class="btn btn-info btn-block" id="manualPull" style="margin-top:8px;">☁️ いますぐクラウドからプル</button>
    </div>

    <h2 class="section-title">RSSフィード管理</h2>
    <div class="card">
      <p class="micro">RSS/Atom フィードを登録すると、設定画面または同期画面から一括取得できます。GAS未設定の場合は下記のCORSプロキシ経由で取得します。</p>
      <details class="detail">
        <summary>＋ 新しいRSSを追加</summary>
        <div class="body">
          <label class="field"><span class="lbl">表示名</span><input type="text" id="newFeedName" placeholder="例: ITmedia AI＋" /></label>
          <label class="field"><span class="lbl">RSS URL</span><input type="url" id="newFeedURL" placeholder="https://..." /></label>
          <label class="field"><span class="lbl">カテゴリ（任意）</span>
            <select id="newFeedCat">
              <option value="">自動判定</option>
              ${DEFAULT_CATEGORIES.map((c) => `<option>${c}</option>`).join("")}
            </select>
          </label>
          <button class="btn btn-primary btn-block" id="addFeedBtn">追加</button>
        </div>
      </details>
      <div id="feedList" style="margin-top:10px;"></div>
      <button class="btn btn-block" id="fetchAllBtn" style="margin-top:8px;">📡 全フィードを取得</button>
    </div>

    <h2 class="section-title">CORSプロキシ（RSS取得用）</h2>
    <div class="card">
      <p class="micro">GAS未設定でもRSSが取れるよう、公開プロキシ経由でフェッチします。第三者サービスのため、不要なら OFF にしてください。</p>
      <div class="setting-row">
        <div>
          <div class="label">CORSプロキシを使う</div>
          <div class="desc">OFFにするとGAS設定済みの場合のみRSS取得可</div>
        </div>
        <label class="switch"><input type="checkbox" id="proxyEnabled" ${st.cors_proxy_enabled !== false ? "checked" : ""} /></label>
      </div>
      <label class="field" style="margin-top:8px;"><span class="lbl">プロキシURL（空欄でデフォルト）</span>
        <input type="url" id="proxyURL" placeholder="${escapeHTML(DEFAULT_CORS_PROXY)}" value="${escapeHTML(st.cors_proxy_url || "")}" />
      </label>
      <button class="btn btn-block" id="saveProxy">保存</button>
      <div class="micro" style="margin-top:6px;">既定: <code>${escapeHTML(DEFAULT_CORS_PROXY)}</code>（最新の可用性は要確認）</div>
    </div>

    <h2 class="section-title">データ管理</h2>
    <div class="card">
      <div class="quick-grid">
        <button class="btn btn-info btn-block" id="expJson">📦 JSONバックアップ</button>
        <button class="btn btn-info btn-block" id="expCsv">📄 記事CSV</button>
        <button class="btn" id="impJsonBtn">📥 JSON復元</button>
        <input type="file" id="impJson" accept="application/json" style="display:none;" />
        <button class="btn" id="goSync">🔁 同期状況</button>
        <button class="btn btn-danger" id="resetAll">⚠ 全データ削除</button>
      </div>
    </div>

    <h2 class="section-title">サンプルデータ</h2>
    <div class="card">
      <button class="btn btn-block" id="loadSamples2">📚 サンプル記事を読み込む</button>
    </div>

    <h2 class="section-title">テスト</h2>
    <div class="card">
      <p class="micro">主要ロジック（分類・重要度・集計・重複・エクスポート・ストリーク）の自動テスト。</p>
      <button class="btn btn-block" id="runTests">🧪 自動テストを実行</button>
      <pre class="review-md test-result-box" id="testResult"></pre>
    </div>

    <p class="micro" style="text-align:center; margin-top:24px;">時流インサイト・ログ v1.0 / データはこの端末に保存されます</p>`;

  bind("#themeSelect", (e) => { setTheme(e.target.value); toast("テーマを変更しました"); }, "change");
  bind("#dailyLimit", (e) => {
    st.daily_article_limit = Math.max(1, Math.min(50, parseInt(e.target.value || "10", 10)));
    Store.save();
  }, "change");
  bind("#reviewDay", (e) => { st.weekly_review_day = parseInt(e.target.value, 10); Store.save(); }, "change");

  bind("#notifyEnable", async () => {
    if (!("Notification" in window)) { toast("このブラウザは通知に対応していません"); return; }
    const p = await Notification.requestPermission();
    if (p === "granted") {
      st.notifications_enabled = true; Store.save();
      try { new Notification("時流インサイト", { body: "通知を有効化しました。" }); } catch (_e) {}
      toast("通知をONにしました");
    } else toast("通知は許可されませんでした");
  });

  bind("#saveGas", () => {
    st.gas_url = $("#gasUrl").value.trim();
    Store.save(); toast("GAS URLを保存");
  });
  // GASコードを遅延ロード (details開いた瞬間に取得)
  let gasCodeCache = null;
  const gasDetails = $("#gasDetails");
  if (gasDetails) {
    gasDetails.addEventListener("toggle", async () => {
      if (gasDetails.open && !gasCodeCache) {
        gasCodeCache = await loadGASCode();
        const box = $("#gasCodeBox");
        if (box) box.textContent = gasCodeCache;
      }
    });
  }
  bind("#copyGas", async () => {
    if (!gasCodeCache) gasCodeCache = await loadGASCode();
    copyText(gasCodeCache).then(() => toast("コピーしました"));
  });

  // マルチ端末同期
  bind("#autoPull", (e) => { st.auto_pull_on_startup = e.target.checked; Store.save(); }, "change");
  bind("#manualPull", async () => {
    if (!st.gas_url) { toast("GAS URLを先に設定してください"); return; }
    toast("プル中…");
    const r = await pullAll();
    toast(`プル完了: 追加${r.added} 更新${r.updated}${r.errors.length?` エラー${r.errors.length}`:""}`);
    route(currentRoute);
  });

  // RSS フィード管理
  renderFeedList();
  bind("#addFeedBtn", () => {
    const n = $("#newFeedName").value.trim();
    const u = $("#newFeedURL").value.trim();
    const c = $("#newFeedCat").value;
    if (!u) { toast("URLを入力してください"); return; }
    const r = addFeed({ feed_name: n, feed_url: u, category: c });
    if (!r.ok) { toast("追加失敗: " + (r.reason || "不明")); return; }
    $("#newFeedName").value = ""; $("#newFeedURL").value = "";
    toast("フィードを追加しました");
    renderFeedList();
  });
  bind("#fetchAllBtn", async () => {
    const feeds = Store.state.feeds.filter((f) => f.enabled);
    if (feeds.length === 0) { toast("有効なフィードがありません"); return; }
    toast(`取得中… (${feeds.length}件)`);
    const r = await fetchAllEnabled();
    toast(`取得完了: +${r.total_added}件${r.errors.length?` (エラー${r.errors.length})`:""}`);
    renderFeedList();
    route(currentRoute);
  });

  // CORSプロキシ
  bind("#proxyEnabled", (e) => { st.cors_proxy_enabled = e.target.checked; Store.save(); }, "change");
  bind("#saveProxy", () => {
    st.cors_proxy_url = $("#proxyURL").value.trim();
    Store.save(); toast("プロキシ設定を保存");
  });

  function renderFeedList() {
    const list = Store.state.feeds;
    const box = $("#feedList");
    if (!box) return;
    if (list.length === 0) {
      box.innerHTML = `<div class="empty">まだフィードがありません</div>`;
      return;
    }
    box.innerHTML = list.map((f) => `
      <div class="feed-item" data-fid="${f.feed_id}">
        <div style="flex:1;">
          <div style="font-size:13px; font-weight:600;">${escapeHTML(f.feed_name)}</div>
          <div class="micro">${escapeHTML(f.feed_url)}</div>
          <div class="micro">${escapeHTML(f.category || "(自動)")}  ${f.last_status ? "・" + escapeHTML(f.last_status) : ""}</div>
        </div>
        <div style="display:flex; gap:4px;">
          <button class="btn" data-act="toggle" title="有効/無効">${f.enabled ? "✅" : "⏸"}</button>
          <button class="btn btn-info" data-act="fetch" title="このフィードを取得">📡</button>
          <button class="btn btn-danger" data-act="del" title="削除">✕</button>
        </div>
      </div>
    `).join("");
    box.querySelectorAll(".feed-item").forEach((row) => {
      const id = row.dataset.fid;
      row.querySelectorAll("[data-act]").forEach((b) => b.addEventListener("click", async () => {
        const f = Store.state.feeds.find((x) => x.feed_id === id);
        if (!f) return;
        if (b.dataset.act === "toggle") {
          updateFeed(id, { enabled: !f.enabled }); renderFeedList();
        } else if (b.dataset.act === "fetch") {
          toast("取得中…");
          const r = await fetchFeedAndStore(f);
          toast(r.ok ? `+${r.added}件取得` : `失敗: ${r.error}`);
          renderFeedList();
        } else if (b.dataset.act === "del") {
          if (!confirm("削除しますか？")) return;
          deleteFeed(id); renderFeedList();
        }
      }));
    });
  }
  bind("#expJson", () => exportJSONBackup());
  bind("#expCsv", () => exportArticlesCSV());
  bind("#impJsonBtn", () => $("#impJson").click());
  $("#impJson").addEventListener("change", (e) => {
    if (e.target.files[0]) {
      importJSONBackup(e.target.files[0])
        .then(() => { toast("バックアップを復元しました"); route(currentRoute); })
        .catch((err) => toast("インポート失敗: " + err.message));
    }
  });
  bind("#goSync", () => route("sync"));
  bind("#resetAll", () => {
    if (!confirm("本当に全データを削除しますか？")) return;
    Store.reset(); toast("初期化しました"); route("home");
  });
  bind("#loadSamples2", () => { loadSamples(); toast("サンプルを読み込みました"); route("home"); });

  bind("#runTests", () => {
    const r = __runSelfTests();
    const box = $("#testResult");
    box.classList.add("visible");
    box.textContent = r.summary + "\n\n" + r.lines.join("\n");
  });
}

/* ====================================================
   8.8 同期状況
   ==================================================== */
function renderSync(root) {
  const logs = Store.state.sync_logs.slice(-20).reverse();
  const errors = logs.filter((l) => l.status === "error").length;
  let html = `<h2 class="section-title">同期状況</h2>
    <div class="card">
      <div>GAS URL: ${Store.state.settings.gas_url ? "<span class='badge badge-ok'>設定済</span>" : "<span class='badge badge-warn'>未設定（ローカルのみ）</span>"}</div>
      <div style="margin-top:6px;">直近20件のうちエラー: ${errors}件</div>
      <div class="quick-grid" style="margin-top:8px;">
        <button class="btn btn-info" id="pullNow">☁️ クラウドからプル</button>
        <button class="btn btn-info" id="fetchAllSync">📡 RSS一括取得</button>
        <button class="btn" id="retryQueue">🔁 失敗分を再送信</button>
        <button class="btn" id="clearLogs">同期ログをクリア</button>
      </div>
    </div>`;
  html += logs.length === 0 ? `<div class="empty">同期ログはありません</div>` : logs.map((l) => `<div class="card" style="padding:10px;">
      <div class="meta">
        <span class="pill">${escapeHTML(l.sync_type)}</span>
        <span class="pill">${escapeHTML(l.target_sheet || "")}</span>
        <span class="badge ${l.status === 'ok' ? 'badge-ok' : l.status === 'error' ? 'badge-warn' : 'badge-info'}">${l.status}</span>
        <span class="micro">${new Date(l.synced_at).toLocaleString()}</span>
      </div>
      <div class="micro" style="margin-top:4px;">${escapeHTML((l.message || "").slice(0, 200))}</div>
    </div>`).join("");
  root.innerHTML = html;

  bind("#retryQueue", () => {
    const errs = Store.state.sync_logs.filter((l) => l.status === "error");
    if (errs.length === 0) { toast("再送するエラーはありません"); return; }
    Store.state.articles.forEach((a) => syncRowAsync("articles", a));
    toast(`再送信を試みました (articles=${Store.state.articles.length}件)`);
  });
  bind("#clearLogs", () => { Store.state.sync_logs = []; Store.save(); route("sync"); });
  bind("#pullNow", async () => {
    if (!Store.state.settings.gas_url) { toast("GAS URLを先に設定してください"); return; }
    toast("プル中…");
    const r = await pullAll();
    toast(`プル完了: 追加${r.added} 更新${r.updated}${r.errors.length?` エラー${r.errors.length}`:""}`);
    route("sync");
  });
  bind("#fetchAllSync", async () => {
    const feeds = Store.state.feeds.filter((f) => f.enabled);
    if (feeds.length === 0) { toast("有効なフィードがありません（設定→RSSフィード管理で追加）"); return; }
    toast(`取得中… (${feeds.length}件)`);
    const r = await fetchAllEnabled();
    toast(`取得完了: +${r.total_added}件${r.errors.length?` (エラー${r.errors.length})`:""}`);
    route("sync");
  });
}

/* ====================================================
   9. モーダル
   ==================================================== */
function openModal(html) {
  closeModal();
  const back = document.createElement("div");
  back.className = "modal-back"; back.id = "modalBack";
  back.innerHTML = `<div class="modal" id="modalBox">${html}</div>`;
  document.body.appendChild(back);
  back.addEventListener("click", (e) => { if (e.target === back) closeModal(); });
}
function closeModal() {
  const m = document.getElementById("modalBack"); if (m) m.remove();
}
window.__closeModal = closeModal; // モーダル内のonclick用

export function openAddArticleModal(preset = {}) {
  const t = escapeHTML(preset.title || "");
  const u = escapeHTML(preset.url || "");
  const s = escapeHTML(preset.summary || "");
  openModal(`
    <div class="close-row"><h3>＋ URLを保存</h3><button class="icon-btn" onclick="__closeModal()">×</button></div>
    <label class="field"><span class="lbl">URL（任意）</span><input type="url" id="m_url" placeholder="https://..." value="${u}" /></label>
    <label class="field"><span class="lbl">タイトル（必須）</span><input type="text" id="m_title" placeholder="例：生成AIの広告活用事例" value="${t}" /></label>
    <label class="field"><span class="lbl">概要・メモ（任意）</span><textarea id="m_summary" placeholder="ひとことでOK">${s}</textarea></label>
    <div class="micro" style="margin-bottom:8px;">カテゴリ・タグ・重要度は自動判定されます（後から変更可）。</div>
    <button class="btn btn-primary btn-block" id="m_submit">保存する</button>
  `);
  // 共有由来でタイトルが空の場合、フォーカスを当てて入力を促す
  setTimeout(() => { const ti = $("#m_title"); if (ti && !ti.value) ti.focus(); }, 50);
  bind("#m_submit", () => {
    const title = $("#m_title").value.trim();
    const url = $("#m_url").value.trim();
    const summary = $("#m_summary").value.trim();
    if (!title && !url) { toast("タイトルかURLを入力してください"); return; }
    const r = addArticleQuick({ title: title || domainOf(url) || "(タイトル未取得)", url, summary });
    if (!r.ok && r.reason === "duplicate") { toast("同じURLは保存済みです"); return; }
    closeModal();
    toast("保存しました");
    route(currentRoute);
  });
}
export function openAddMemoModal(relId = "") {
  const rel = relId ? Store.state.articles.find((a) => a.article_id === relId) : null;
  openModal(`
    <div class="close-row"><h3>📝 気づきメモ</h3><button class="icon-btn" onclick="__closeModal()">×</button></div>
    ${rel ? `<div class="micro" style="margin-bottom:6px;">🔗 関連: ${escapeHTML(rel.title)}</div>` : ""}
    <label class="field"><span class="lbl">何が起きているか（必須・ひとことでOK）</span><textarea id="mm_what" placeholder="例：CXがロイヤルティの主軸に。"></textarea></label>
    <details class="detail">
      <summary>詳しく書く（任意）</summary>
      <div class="body">
        <label class="field"><span class="lbl">なぜ重要か</span><textarea id="mm_why"></textarea></label>
        <label class="field"><span class="lbl">仕事・企画への示唆</span><textarea id="mm_imp"></textarea></label>
        <label class="field"><span class="lbl">次に調べること</span><textarea id="mm_next"></textarea></label>
        <label class="field"><span class="lbl">施策アイデア</span><textarea id="mm_act"></textarea></label>
      </div>
    </details>
    <button class="btn btn-primary btn-block" id="mm_submit">保存</button>
  `);
  bind("#mm_submit", () => {
    const w = $("#mm_what").value.trim();
    if (!w) { toast("「何が起きているか」を入力してください"); return; }
    const memo = addMemoQuick({ what_happened: w, related_article_id: relId });
    memo.why_important = $("#mm_why")?.value.trim() || "";
    memo.business_implication = $("#mm_imp")?.value.trim() || "";
    memo.next_questions = $("#mm_next")?.value.trim() || "";
    memo.action_ideas = $("#mm_act")?.value.trim() || "";
    Store.save();
    closeModal(); toast("メモを保存しました"); route(currentRoute);
  });
}
function openTrendModal() {
  openModal(`
    <div class="close-row"><h3>🌐 観測メモ</h3><button class="icon-btn" onclick="__closeModal()">×</button></div>
    <label class="field"><span class="lbl">見たツール</span>
      <select id="t_tool">
        ${TREND_LINKS.map((l) => `<option>${l.name}</option>`).join("")}
        <option>その他</option>
      </select>
    </label>
    <label class="field"><span class="lbl">気になったキーワード・話題</span><input type="text" id="t_topic" /></label>
    <label class="field"><span class="lbl">気づき（テンプレ自由活用OK）</span><textarea id="t_body" placeholder="${escapeHTML(TREND_TEMPLATE)}"></textarea></label>
    <button class="btn btn-primary btn-block" id="t_submit">保存</button>
  `);
  bind("#t_submit", () => {
    const tool = $("#t_tool").value;
    const obs = {
      observation_id: "obs_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 6),
      tool_name: tool,
      tool_url: (TREND_LINKS.find((l) => l.name === tool) || {}).url || "",
      observed_at: nowISO(),
      topic: $("#t_topic").value.trim(),
      region: "", category: "", trend_signal: "",
      consumer_insight: $("#t_body").value.trim(),
      business_implication: "", next_action: "",
      created_at: nowISO(), updated_at: nowISO()
    };
    Store.state.trend_observations.unshift(obs);
    Store.save(); markActive();
    syncRowAsync("trend_observations", obs);
    closeModal(); toast("観測メモを保存"); route(currentRoute);
  });
}
