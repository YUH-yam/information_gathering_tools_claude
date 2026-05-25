/* dashboard.js
 * 役割: データ可視化（依存ライブラリゼロ・SVGで描画）
 * - KPI / 日次推移 / カテゴリ別 / タグTop10 / ストリークカレンダー
 * - 集計関数は純粋関数 (Nodeでテスト可)
 * - 描画関数は SVG 文字列を返す（DOM挿入は呼び出し側）
 */

import { Store } from "./store.js";
import { dateOnly, escapeHTML, frequencyMap } from "./utils.js";

/* ============================================================
   集計（純粋関数）
   ============================================================ */

/** 過去 N日 分の YYYY-MM-DD 配列 (古い→新しい) */
export function lastNDates(n, now = new Date()) {
  const arr = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(now.getDate() - i);
    arr.push(dateOnly(d));
  }
  return arr;
}

/** 日次の保存記事数 [{date, count}] */
export function dailyCounts(articles, days = 30, now = new Date()) {
  const dates = lastNDates(days, now);
  const bucket = {};
  dates.forEach((d) => { bucket[d] = 0; });
  articles.forEach((a) => {
    const t = a.saved_at || a.created_at;
    if (!t) return;
    const d = dateOnly(new Date(t));
    if (d in bucket) bucket[d]++;
  });
  return dates.map((d) => ({ date: d, count: bucket[d] }));
}

/** 重要度別件数 [{level, count}] */
export function importanceCounts(articles) {
  const map = { high: 0, mid: 0, low: 0 };
  articles.forEach((a) => {
    const lv = a.importance || "mid";
    if (lv in map) map[lv]++;
  });
  return [
    { level: "high", count: map.high },
    { level: "mid", count: map.mid },
    { level: "low", count: map.low }
  ];
}

/** KPI まとめ */
export function buildKPIs(state, days = 30, now = new Date()) {
  const cutoff = new Date(now); cutoff.setDate(now.getDate() - (days - 1)); cutoff.setHours(0, 0, 0, 0);
  const recentArts = state.articles.filter((a) => new Date(a.saved_at || a.created_at) >= cutoff);
  const recentMemos = state.memos.filter((m) => new Date(m.created_at) >= cutoff);
  const highCnt = recentArts.filter((a) => a.importance === "high").length;
  const avg = days > 0 ? (recentArts.length / days) : 0;
  return {
    total_articles: state.articles.length,
    total_memos: state.memos.length,
    total_reviews: state.weekly_reviews.length + state.monthly_reviews.length,
    recent_articles: recentArts.length,
    recent_memos: recentMemos.length,
    recent_high: highCnt,
    avg_per_day: Math.round(avg * 10) / 10
  };
}

/* ============================================================
   SVG 描画（純粋関数：state を受け取り SVG文字列を返す）
   ============================================================ */

const C = {
  axis: "#475569",
  grid: "#334155",
  text: "#cbd5e1",
  accent: "#f59e0b",
  bar: "#38bdf8",
  high: "#ef4444",
  mid: "#f59e0b",
  low: "#64748b",
  ok: "#10b981",
  empty: "#1e293b"
};

/** 棒グラフ (日次) */
export function svgDailyBars(daily, opts = {}) {
  const w = opts.w || 520;
  const h = opts.h || 140;
  const padL = 28, padR = 8, padT = 12, padB = 22;
  const innerW = w - padL - padR;
  const innerH = h - padT - padB;
  const max = Math.max(1, ...daily.map((d) => d.count));
  const barW = innerW / daily.length;

  const yticks = [0, Math.ceil(max / 2), max];
  const grid = yticks.map((v) => {
    const y = padT + innerH - (v / max) * innerH;
    return `<line x1="${padL}" y1="${y}" x2="${w - padR}" y2="${y}" stroke="${C.grid}" stroke-width="0.5"/>` +
           `<text x="${padL - 4}" y="${y + 3}" text-anchor="end" fill="${C.text}" font-size="9">${v}</text>`;
  }).join("");

  const bars = daily.map((d, i) => {
    const x = padL + i * barW + 0.5;
    const bh = (d.count / max) * innerH;
    const y = padT + innerH - bh;
    return `<rect x="${x}" y="${y}" width="${Math.max(1, barW - 1)}" height="${bh}" fill="${C.bar}" opacity="0.85">
      <title>${d.date} : ${d.count}件</title></rect>`;
  }).join("");

  // X軸 (先頭・中間・末尾だけラベル)
  const labels = [0, Math.floor(daily.length / 2), daily.length - 1].map((i) => {
    const d = daily[i]; if (!d) return "";
    const x = padL + i * barW + barW / 2;
    return `<text x="${x}" y="${h - 6}" text-anchor="middle" fill="${C.text}" font-size="9">${d.date.slice(5)}</text>`;
  }).join("");

  return `<svg viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="日次保存数">
    ${grid}${bars}${labels}
  </svg>`;
}

/** 横棒グラフ (カテゴリ別/タグ別) */
export function svgHorizontalBars(items, opts = {}) {
  if (items.length === 0) return `<div class="empty">データがありません</div>`;
  const w = opts.w || 520;
  const rowH = opts.rowH || 22;
  const padL = 100, padR = 36, padT = 4, padB = 4;
  const h = padT + padB + items.length * rowH;
  const max = Math.max(1, ...items.map((x) => x.count));
  const innerW = w - padL - padR;

  const rows = items.map((it, i) => {
    const y = padT + i * rowH;
    const bw = (it.count / max) * innerW;
    const label = String(it.label);
    const short = label.length > 14 ? label.slice(0, 13) + "…" : label;
    return `
      <text x="${padL - 6}" y="${y + rowH / 2 + 3}" text-anchor="end" fill="${C.text}" font-size="11">${escapeHTML(short)}</text>
      <rect x="${padL}" y="${y + 4}" width="${bw}" height="${rowH - 8}" rx="3" fill="${it.color || C.accent}">
        <title>${escapeHTML(label)}: ${it.count}件</title></rect>
      <text x="${padL + bw + 4}" y="${y + rowH / 2 + 3}" fill="${C.text}" font-size="10">${it.count}</text>
    `;
  }).join("");

  return `<svg viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="棒グラフ">${rows}</svg>`;
}

/** ストリーク・カレンダー (過去30日のヒートマップ) */
export function svgStreakCalendar(historySet, days = 30, now = new Date()) {
  const cellW = 16, cellH = 16, gap = 3;
  const cols = 10;
  const rows = Math.ceil(days / cols);
  const w = cols * (cellW + gap);
  const h = rows * (cellH + gap) + 18;
  const dates = lastNDates(days, now);

  const cells = dates.map((d, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const x = col * (cellW + gap);
    const y = row * (cellH + gap);
    const active = historySet.has(d);
    const isToday = d === dateOnly(now);
    return `<rect x="${x}" y="${y}" width="${cellW}" height="${cellH}" rx="3"
              fill="${active ? C.ok : C.empty}"
              stroke="${isToday ? C.accent : "none"}" stroke-width="${isToday ? 1.5 : 0}">
      <title>${d}${active ? " ✓" : ""}</title></rect>`;
  }).join("");

  const legend = `
    <rect x="0" y="${h - 12}" width="10" height="10" fill="${C.empty}" rx="2"/>
    <text x="14" y="${h - 3}" fill="${C.text}" font-size="9">未達</text>
    <rect x="50" y="${h - 12}" width="10" height="10" fill="${C.ok}" rx="2"/>
    <text x="64" y="${h - 3}" fill="${C.text}" font-size="9">達成</text>
    <rect x="100" y="${h - 12}" width="10" height="10" fill="${C.empty}" stroke="${C.accent}" stroke-width="1.5" rx="2"/>
    <text x="114" y="${h - 3}" fill="${C.text}" font-size="9">今日</text>
  `;

  return `<svg viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="ストリークカレンダー">
    ${cells}${legend}
  </svg>`;
}

/* ============================================================
   フル描画 (HTML文字列を返す)
   ============================================================ */

export function renderDashboardHTML() {
  const state = Store.state;
  const arts = state.articles;
  const kpi = buildKPIs(state);
  const daily = dailyCounts(arts);
  const impCnts = importanceCounts(arts);
  const catFreq = frequencyMap(arts, (a) => a.category).slice(0, 8);
  const tagFreq = frequencyMap(arts, (a) => a.tags || []).slice(0, 10);
  const historySet = new Set(state.streak.history || []);
  if (state.streak.last_active_date) historySet.add(state.streak.last_active_date);

  const kpiCards = [
    { label: "累計記事", num: kpi.total_articles },
    { label: "累計メモ", num: kpi.total_memos },
    { label: "30日 保存", num: kpi.recent_articles },
    { label: "30日 重要", num: kpi.recent_high },
    { label: "30日 メモ", num: kpi.recent_memos },
    { label: "1日平均", num: kpi.avg_per_day }
  ];

  const catItems = catFreq.map(([label, count]) => ({ label, count, color: C.bar }));
  const tagItems = tagFreq.map(([label, count]) => ({ label, count, color: "#c4b5fd" }));
  const impItems = impCnts.map((x) => ({
    label: x.level === "high" ? "高" : x.level === "low" ? "低" : "中",
    count: x.count,
    color: x.level === "high" ? C.high : x.level === "low" ? C.low : C.mid
  }));

  return `
    <div class="card card-soft">
      <div style="font-weight:700;">ダッシュボード</div>
      <p class="micro" style="margin:4px 0 0;">過去30日のあなたの情報収集を一目で。</p>
    </div>

    <div class="card">
      <div class="kpi-grid">
        ${kpiCards.map((k) => `<div class="kpi"><div class="kpi-num">${k.num}</div><div class="kpi-lbl">${k.label}</div></div>`).join("")}
      </div>
    </div>

    <h2 class="section-title">日次保存数 <span class="sub">直近30日</span></h2>
    <div class="card chart-card">${svgDailyBars(daily)}</div>

    <h2 class="section-title">ストリークカレンダー</h2>
    <div class="card chart-card">${svgStreakCalendar(historySet)}</div>

    <h2 class="section-title">カテゴリ別件数</h2>
    <div class="card chart-card">${svgHorizontalBars(catItems)}</div>

    <h2 class="section-title">タグ Top10</h2>
    <div class="card chart-card">${svgHorizontalBars(tagItems)}</div>

    <h2 class="section-title">重要度シェア</h2>
    <div class="card chart-card">${svgHorizontalBars(impItems)}</div>

    <p class="micro" style="text-align:center; margin-top:16px;">※ データは端末内のみで集計しています</p>
  `;
}
