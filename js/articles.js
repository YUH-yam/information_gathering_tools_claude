/* articles.js
 * 役割: 記事ドメインのCRUD + ピックアップロジック
 * - 保存・更新・削除
 * - 「今日見る」ピックアップ (重要度順、上限つき)
 * - Streak.markActive と sync をフック
 */

import { Store } from "./store.js";
import { uid, nowISO, normalizeURL, domainOf } from "./utils.js";
import { classifyArticle, buildClassificationContext, calculateImportance } from "./classifier.js";
import { markActive } from "./streak.js";
import { syncRowAsync } from "./sync.js";
import { TODAY_LIMIT } from "./config.js";

/** 記事を1件追加。重複(URL正規化一致)は弾く
 *  status="saved"（既定）: 手動保存。保存記事画面に表示
 *  status="inbox"        : RSS取得など自動取り込み。今日見るで判定するまで保存記事には入らない
 */
export function addArticleQuick({
  title, url, summary = "", source_name = "", category = "", tags = [],
  importance = "", user_memo = "", status = "saved"
}) {
  const state = Store.state;
  const norm = normalizeURL(url);
  if (norm && state.articles.some((a) => normalizeURL(a.url) === norm)) {
    return { ok: false, reason: "duplicate" };
  }
  const article = {
    article_id: uid("art"),
    title: title || "(タイトル未取得)",
    url: norm || "",
    source_name: source_name || domainOf(url) || "",
    source_type: norm ? "url" : "manual",
    source_url: "",
    published_at: "",
    fetched_at: nowISO(),
    saved_at: nowISO(),
    category, tags,
    importance,
    importance_score: 0,
    status, // "saved" | "inbox" | "discarded"
    summary,
    ai_summary: "",
    ai_insight: "",
    user_memo,
    use_cases: [],
    review_target: false,
    read_flag: false,
    archived_flag: false,
    created_at: nowISO(),
    updated_at: nowISO()
  };
  // 自動分類 (未指定フィールドのみ補完)
  const cls = classifyArticle(article, state);
  if (!article.category) article.category = cls.category;
  if (!article.tags || article.tags.length === 0) article.tags = cls.tags;
  if (!article.importance) {
    article.importance = cls.importance;
    article.importance_score = cls.importance_score;
  }

  state.articles.unshift(article);
  Store.save();
  markActive();
  syncRowAsync("articles", article);
  return { ok: true, article };
}

export function updateArticle(id, patch) {
  const a = Store.state.articles.find((x) => x.article_id === id);
  if (!a) return null;
  Object.assign(a, patch, { updated_at: nowISO() });
  // 再分類
  if (patch.title || patch.url) {
    const cls = classifyArticle(a, Store.state);
    if (!patch.category) a.category = cls.category;
    if (!patch.importance) {
      a.importance = cls.importance;
      a.importance_score = cls.importance_score;
    }
  }
  Store.save();
  syncRowAsync("articles", a);
  return a;
}

export function deleteArticle(id) {
  const i = Store.state.articles.findIndex((x) => x.article_id === id);
  if (i >= 0) {
    Store.state.articles.splice(i, 1);
    Store.save();
  }
}

/** ホーム/今日見るの記事抽出
 *  - inbox (未判定) と saved を対象に
 *  - inbox を優先 (重要度スコア + inboxボーナス) して上位N件
 *  - discarded / archived は除外
 */
export function pickTodayArticles(limit = TODAY_LIMIT) {
  const items = Store.state.articles.filter(
    (a) => !a.archived_flag && a.status !== "discarded"
  );
  const ctx = buildClassificationContext(Store.state);
  items.forEach((a) => {
    const cls = calculateImportance(a, ctx);
    // inbox（未判定）にはボーナス。先に判定してもらいたい
    const bonus = a.status === "inbox" ? 15 : 0;
    a._sort_score = cls.score + bonus;
  });
  items.sort((a, b) => b._sort_score - a._sort_score);
  return items.slice(0, limit);
}

/** 受信箱(inbox)の件数 */
export function inboxCount() {
  return Store.state.articles.filter((a) => a.status === "inbox" && !a.archived_flag).length;
}
