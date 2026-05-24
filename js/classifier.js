/* classifier.js
 * 役割: ルールベースの自動分類エンジン
 * - カテゴリ判定 / タグ付け / 重要度スコアリング (要件 6.7, 6.8, 15.1)
 * - 完全純粋関数。Store依存はinitArticleContext経由でstateを渡す
 */

import { KEYWORD_RULES, IMPORTANT_KEYWORDS } from "./config.js";
import { domainOf, normalizeURL } from "./utils.js";

/** タイトル/URLからカテゴリを判定 */
export function detectCategory(title = "", url = "") {
  const text = (title + " " + url).toLowerCase();
  for (const rule of KEYWORD_RULES) {
    if (rule.words.some((w) => text.includes(w.toLowerCase()))) return rule.cat;
  }
  return "国内ビジネス"; // デフォルト
}

/** タイトル/URLから推定タグを抽出 (既存タグは保持) */
export function detectTags(title = "", url = "", existing = []) {
  const text = (title + " " + url).toLowerCase();
  const set = new Set(existing);
  for (const rule of KEYWORD_RULES) {
    if (rule.words.some((w) => text.includes(w.toLowerCase()))) {
      rule.tags.forEach((t) => set.add(t));
    }
  }
  // 海外サイトの簡易判定
  const dom = domainOf(url);
  if (dom && !dom.endsWith(".jp") && !dom.includes("nikkei") && !dom.includes("itmedia")) {
    if (/com$|org$|net$|io$|co$/.test(dom)) set.add("海外トレンド");
  }
  return Array.from(set);
}

/** 重要度を計算 (要件 15.1)
 *  @param article {title, summary, url, category, tags, saved_at, user_importance_boost}
 *  @param opts    {focusCategories[], savedTagFreq{}, duplicateCount}
 *  @returns       {score 0-100, level "high"|"mid"|"low"}
 */
export function calculateImportance(article, opts = {}) {
  let score = 0;
  const text = ((article.title || "") + " " + (article.summary || "") + " " + (article.url || "")).toLowerCase();

  // 重点カテゴリ一致
  const userFocus = opts.focusCategories || [];
  if (article.category && userFocus.includes(article.category)) score += 20;

  // 重要キーワード一致
  if (IMPORTANT_KEYWORDS.some((k) => text.includes(k.toLowerCase()))) score += 20;

  // 保存済みテーマと関連 (タグ被り)
  const savedTags = opts.savedTagFreq || {};
  if (article.tags && article.tags.some((t) => savedTags[t] && savedTags[t] >= 2)) score += 15;

  // 一次情報・公的情報
  const dom = domainOf(article.url || "");
  if (/(go\.jp|gov$|gov\.|or\.jp|stat\.go\.jp)/.test(dom)) score += 15;

  // 海外先行トレンド
  if (article.tags?.includes("海外トレンド")) score += 10;

  // 複数ソースで出現
  if (opts.duplicateCount && opts.duplicateCount >= 2) score += 10;

  // 直近性
  if (article.saved_at) {
    const days = Math.max(0, Math.floor((Date.now() - new Date(article.saved_at).getTime()) / 86400000));
    if (days <= 1) score += 10;
    else if (days <= 3) score += 5;
  } else {
    score += 5;
  }

  // ユーザー手動補正
  if (article.user_importance_boost) score += article.user_importance_boost;

  score = Math.min(100, Math.max(0, score));
  const level = score >= 70 ? "high" : score >= 40 ? "mid" : "low";
  return { score, level };
}

/** state全体から、分類で参照する補助情報を作る */
export function buildClassificationContext(state) {
  const savedTagFreq = {};
  state.articles.forEach((a) =>
    (a.tags || []).forEach((t) => { savedTagFreq[t] = (savedTagFreq[t] || 0) + 1; })
  );
  const catFreq = {};
  state.articles.forEach((a) => {
    if (a.category) catFreq[a.category] = (catFreq[a.category] || 0) + 1;
  });
  const focusCategories = Object.entries(catFreq).sort((a, b) => b[1] - a[1]).slice(0, 3).map((x) => x[0]);
  return { savedTagFreq, focusCategories };
}

/** 1記事を一括分類 */
export function classifyArticle(article, state) {
  const cat = article.category || detectCategory(article.title, article.url);
  const tags = (article.tags && article.tags.length)
    ? article.tags
    : detectTags(article.title, article.url, article.tags || []);
  const ctx = buildClassificationContext(state);
  const dupCount = state.articles.filter(
    (a) => normalizeURL(a.url) === normalizeURL(article.url || "")
  ).length;
  const imp = calculateImportance(
    { ...article, category: cat, tags },
    { ...ctx, duplicateCount: dupCount }
  );
  return {
    category: cat,
    tags,
    importance: imp.level,
    importance_score: imp.score
  };
}
