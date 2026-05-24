/* memos.js
 * 役割: 気づきメモのCRUD (要件 6.10)
 * - 最小入力 (what_happened のみ) でもOK
 * - 詳細フィールドはオプション
 */

import { Store } from "./store.js";
import { uid, nowISO } from "./utils.js";
import { markActive } from "./streak.js";
import { syncRowAsync } from "./sync.js";

export function addMemoQuick({
  title = "", what_happened = "", related_article_id = "",
  tags = [], importance = "mid"
}) {
  const memo = {
    memo_id: uid("memo"),
    related_article_id,
    title: title || (what_happened.slice(0, 30) || "メモ"),
    category: "",
    tags,
    what_happened,
    why_important: "",
    business_implication: "",
    next_questions: "",
    action_ideas: "",
    importance,
    review_target: true,
    created_at: nowISO(),
    updated_at: nowISO()
  };
  Store.state.memos.unshift(memo);
  Store.save();
  markActive();
  syncRowAsync("insight_memos", memo);
  return memo;
}

export function updateMemo(id, patch) {
  const m = Store.state.memos.find((x) => x.memo_id === id);
  if (!m) return null;
  Object.assign(m, patch, { updated_at: nowISO() });
  Store.save();
  syncRowAsync("insight_memos", m);
  return m;
}

export function deleteMemo(id) {
  const i = Store.state.memos.findIndex((x) => x.memo_id === id);
  if (i >= 0) {
    Store.state.memos.splice(i, 1);
    Store.save();
  }
}
