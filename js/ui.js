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
  addArticleQuick, updateArticle, pickTodayArticles
} from "./articles.js";
import { addMemoQuick, deleteMemo } from "./memos.js";
import { generateWeeklyReview, generateMonthlyReview } from "./reviews.js";
import {
  exportArticlesCSV, exportJSONBackup, importJSONBackup, downloadFile, copyText
} from "./exporter.js";
import { syncRowAsync, getGASSnippet } from "./sync.js";
import { isTodayDone, missedYesterday, StreakEvents, markActive } from "./streak.js";
import { loadSamples } from "./samples.js";
import { __runSelfTests } from "./tests.js";

let currentRoute = "home";

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
export function route(name) {
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
  return `<div class="article" data-id="${a.article_id}">
    <div class="meta">
      <span class="pill ${impClass}">重要度: ${impLabel}</span>
      ${cat}${src}${tags}
    </div>
    <h3 class="title">${escapeHTML(a.title)}</h3>
    <div class="summary">${summary}</div>
    <div class="actions">
      <button class="btn btn-ok" data-act="save">📌 保存</button>
      <button class="btn btn-info" data-act="deep">🔍 深掘り</button>
      <button class="btn" data-act="memo">📝 メモ</button>
      <button class="btn btn-danger" data-act="discard">✕ 不要</button>
    </div>
    ${a.url ? `<details class="detail"><summary>詳細・元記事</summary><div class="body">
      <div class="micro">URL: <a href="${escapeHTML(a.url)}" target="_blank" rel="noopener">${escapeHTML(a.url)}</a></div>
      ${a.user_memo ? `<div style="margin-top:6px;">📝 ${escapeHTML(a.user_memo)}</div>` : ""}
      <div style="margin-top:8px; display:flex; gap:6px; flex-wrap:wrap;">
        <button class="btn" data-act="open">🔗 元記事を開く</button>
        <button class="btn" data-act="bump">⬆ 重要度↑</button>
        <button class="btn" data-act="review">📊 週次に送る</button>
      </div>
    </div></details>` : ""}
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
        if (act === "save") { a.status = "saved"; Store.save(); markActive(); toast("保存しました"); }
        else if (act === "discard") {
          a.status = "discarded"; a.archived_flag = true;
          Store.save(); markActive(); toast("不要に振り分けました"); route(currentRoute);
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

  // 外部トレンド
  html += `<h2 class="section-title">外部トレンド観測</h2>
    <div class="card">
      <button class="btn btn-block" id="goTrends">🌐 トレンドサイトを見る</button>
    </div>`;

  root.innerHTML = html;

  bind("#quickAdd", () => openAddArticleModal());
  bind("#quickMemo", () => openAddMemoModal());
  bind("#goToday", () => route("today"));
  bind("#goWeekly", () => route("reviews"));
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
  const all = Store.state.articles.filter((a) => !a.archived_flag);
  let html = `<h2 class="section-title">保存した記事 <span class="sub">${all.length}件</span></h2>
    <div class="card">
      <div class="search-row">
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
      if (q && !((a.title || "").toLowerCase().includes(q)
        || (a.summary || "").toLowerCase().includes(q)
        || (a.user_memo || "").toLowerCase().includes(q))) return false;
      if (imp && a.importance !== imp) return false;
      if (cat && a.category !== cat) return false;
      return true;
    });
    const target = $("#savedList", root);
    target.innerHTML = list.length === 0
      ? `<div class="empty">該当する記事はありません</div>`
      : list.map(renderArticleCardHTML).join("");
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
  let activeTab = "weekly";
  const paint = () => {
    root.innerHTML = `<div class="tabs">
      <button data-t="weekly" class="${activeTab === 'weekly' ? 'active' : ''}">週次</button>
      <button data-t="monthly" class="${activeTab === 'monthly' ? 'active' : ''}">月次</button>
      <button data-t="trend" class="${activeTab === 'trend' ? 'active' : ''}">トレンド観測</button>
    </div><div id="rvBody"></div>`;
    $all(".tabs button", root).forEach((b) => b.addEventListener("click", () => { activeTab = b.dataset.t; paint(); }));
    const body = $("#rvBody", root);
    if (activeTab === "weekly") renderWeeklyBody(body);
    else if (activeTab === "monthly") renderMonthlyBody(body);
    else renderTrendBody(body);
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
  root.innerHTML = `<h2 class="section-title">設定</h2>
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
      <p class="micro">GAS(Google Apps Script) Web App URL を貼ると、保存時に自動追記されます。空欄ならローカルのみ。</p>
      <label class="field"><span class="lbl">GAS Web App URL</span>
        <input type="url" id="gasUrl" placeholder="https://script.google.com/macros/s/.../exec" value="${escapeHTML(st.gas_url || "")}" />
      </label>
      <button class="btn btn-block" id="saveGas">保存</button>
      <details class="detail" style="margin-top:10px;">
        <summary>GASコードを表示（コピペで設定）</summary>
        <div class="body">
          <pre class="review-md">${escapeHTML(getGASSnippet())}</pre>
          <button class="btn" id="copyGas">コードをコピー</button>
        </div>
      </details>
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
  bind("#copyGas", () => copyText(getGASSnippet()).then(() => toast("コピーしました")));
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
      <button class="btn btn-block" id="retryQueue" style="margin-top:8px;">🔁 失敗分を再送信</button>
      <button class="btn btn-block" id="clearLogs" style="margin-top:6px;">同期ログをクリア</button>
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

function openAddArticleModal() {
  openModal(`
    <div class="close-row"><h3>＋ URLを保存</h3><button class="icon-btn" onclick="__closeModal()">×</button></div>
    <label class="field"><span class="lbl">URL（任意）</span><input type="url" id="m_url" placeholder="https://..." /></label>
    <label class="field"><span class="lbl">タイトル（必須）</span><input type="text" id="m_title" placeholder="例：生成AIの広告活用事例" /></label>
    <label class="field"><span class="lbl">概要・メモ（任意）</span><textarea id="m_summary" placeholder="ひとことでOK"></textarea></label>
    <div class="micro" style="margin-bottom:8px;">カテゴリ・タグ・重要度は自動判定されます（後から変更可）。</div>
    <button class="btn btn-primary btn-block" id="m_submit">保存する</button>
  `);
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
function openAddMemoModal(relId = "") {
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
