/* reviews.js
 * 役割: 週次/月次レビューの自動集計とMarkdown下書き生成 (要件 6.11, 6.12)
 * - 純粋関数群とStore.state参照を分離
 * - 出力は markdown_output 文字列も含むレコード
 */

import { Store } from "./store.js";
import { uid, nowISO, dateOnly, frequencyMap, inRange } from "./utils.js";
import { markActive } from "./streak.js";
import { syncRowAsync } from "./sync.js";

/* --- 範囲フィルタ --- */
function rangeArticles(fromISO, toISO) {
  return inRange(Store.state.articles, fromISO, toISO, (a) => a.saved_at || a.created_at);
}
function rangeMemos(fromISO, toISO) {
  return inRange(Store.state.memos, fromISO, toISO, (m) => m.created_at);
}

/* --- 週次レビュー Markdown生成 (純粋関数) --- */
export function renderWeeklyMarkdown(ctx) {
  const { weekStart, weekEnd, arts, memos, importantArts, topTrends, tagFreq, catFreq } = ctx;
  const lines = [];
  lines.push(`# 週次レビュー (${weekStart} 〜 ${weekEnd})`);
  lines.push("");
  lines.push("## 1. 今週の主要トレンド");
  if (topTrends.length === 0) lines.push("- (今週の保存が少なく、トレンド集計できませんでした)");
  else topTrends.forEach((t, i) => lines.push(`${i + 1}. ${t}`));
  lines.push("");
  lines.push("## 2. 特に重要だった情報");
  if (importantArts.length === 0) lines.push("- (重要度「高」の記事はありません)");
  else importantArts.slice(0, 5).forEach((a) =>
    lines.push(`- [${a.title}](${a.url || "#"}) — ${a.source_name || ""}`));
  lines.push("");
  lines.push("## 3. 仕事・企画への示唆 (※ユーザーが追記)");
  lines.push("1. ");
  lines.push("2. ");
  lines.push("3. ");
  lines.push("");
  lines.push("## 4. 来週追うべきテーマ");
  const next = tagFreq.slice(0, 3).map((x) => `- ${x[0]}`).join("\n");
  lines.push(next || "- (未設定)");
  lines.push("");
  lines.push("## 5. 深掘りしたい問い");
  const qs = memos.flatMap((m) => (m.next_questions ? [`- ${m.next_questions}`] : []));
  if (qs.length) lines.push(qs.join("\n"));
  else lines.push("- (未設定)");
  lines.push("");
  lines.push("---");
  lines.push(`参考: 保存記事=${arts.length}件 / 重要=${importantArts.length}件 / メモ=${memos.length}件 / 主要カテゴリ=${(catFreq[0] || ["なし"])[0]}`);
  return lines.join("\n");
}

/** 週次レビューを生成して state に追加 */
export function generateWeeklyReview() {
  const end = new Date(); end.setHours(23, 59, 59, 999);
  const start = new Date(end); start.setDate(end.getDate() - 6); start.setHours(0, 0, 0, 0);
  const arts = rangeArticles(start.toISOString(), end.toISOString());
  const memos = rangeMemos(start.toISOString(), end.toISOString());
  const importantArts = arts.filter((a) => a.importance === "high");
  const tagFreq = frequencyMap(arts, (a) => a.tags || []);
  const catFreq = frequencyMap(arts, (a) => a.category);
  const topTrends = tagFreq.slice(0, 3).map(([t, c]) => `${t}（${c}件）`);

  const md = renderWeeklyMarkdown({
    weekStart: dateOnly(start), weekEnd: dateOnly(end),
    arts, memos, importantArts, topTrends, tagFreq, catFreq
  });

  const review = {
    review_id: uid("wrev"),
    week_start: dateOnly(start),
    week_end: dateOnly(end),
    top_trends: topTrends,
    important_articles: importantArts.map((a) => a.article_id),
    key_insights: memos.slice(0, 5).map((m) => m.memo_id),
    business_implications: "",
    next_watch_themes: tagFreq.slice(0, 3).map((x) => x[0]),
    deep_research_questions: memos.flatMap((m) => (m.next_questions ? [m.next_questions] : [])),
    discarded_themes: "",
    markdown_output: md,
    created_at: nowISO(),
    updated_at: nowISO()
  };
  Store.state.weekly_reviews.unshift(review);
  Store.save();
  markActive();
  syncRowAsync("weekly_reviews", review);
  return review;
}

/* --- 月次レビュー --- */
export function renderMonthlyMarkdown(ctx) {
  const { start, end, tagFreq, catFreq, important } = ctx;
  const lines = [];
  lines.push(`# 月次レビュー (${dateOnly(start)} 〜 ${dateOnly(end)})`);
  lines.push("");
  lines.push("## 主要テーマ");
  if (tagFreq.length === 0) lines.push("- (集計対象なし)");
  else tagFreq.slice(0, 5).forEach(([t, c]) => lines.push(`- ${t} (${c}件)`));
  lines.push("");
  lines.push("## カテゴリ別保存数");
  catFreq.forEach(([c, n]) => lines.push(`- ${c}: ${n}件`));
  lines.push("");
  lines.push("## 重要記事");
  important.slice(0, 10).forEach((a) => lines.push(`- [${a.title}](${a.url || "#"})`));
  lines.push("");
  lines.push("## 仕事・企画に使える論点 (※追記)");
  lines.push("- ");
  lines.push("");
  lines.push("## 来月のウォッチテーマ (※追記)");
  lines.push("- ");
  return lines.join("\n");
}

export function generateMonthlyReview() {
  const end = new Date(); end.setHours(23, 59, 59, 999);
  const start = new Date(end); start.setDate(end.getDate() - 29); start.setHours(0, 0, 0, 0);
  const arts = rangeArticles(start.toISOString(), end.toISOString());
  const tagFreq = frequencyMap(arts, (a) => a.tags || []);
  const catFreq = frequencyMap(arts, (a) => a.category);
  const important = arts.filter((a) => a.importance === "high");
  const md = renderMonthlyMarkdown({ start, end, tagFreq, catFreq, important });

  const rev = {
    review_id: uid("mrev"),
    month: dateOnly(end).slice(0, 7),
    top_themes: tagFreq.slice(0, 5).map((x) => x[0]),
    category_summary: catFreq.map(([c, n]) => `${c}:${n}`).join(", "),
    tag_summary: tagFreq.map(([t, c]) => `${t}:${c}`).join(", "),
    important_articles: important.map((a) => a.article_id),
    key_insights: "",
    business_implications: "",
    next_month_watch_themes: tagFreq.slice(0, 3).map((x) => x[0]),
    markdown_output: md,
    created_at: nowISO(),
    updated_at: nowISO()
  };
  Store.state.monthly_reviews.unshift(rev);
  Store.save();
  markActive();
  syncRowAsync("monthly_reviews", rev);
  return rev;
}
