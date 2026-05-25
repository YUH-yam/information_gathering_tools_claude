/* share-handler.js
 * 役割: 起動時のURLクエリパラメータを処理する
 *  - Share Target API (?shared_title, ?shared_text, ?shared_url) からの共有受け取り
 *  - manifest.shortcuts (?action=add|memo|reviews|dashboard) からのアクション起動
 * - パース部分は純粋関数。Nodeでもテスト可能
 */

/** URL文字列っぽいものを取り出す (純粋関数) */
export function extractURL(text) {
  if (!text) return "";
  const m = String(text).match(/https?:\/\/[^\s<>"')]+/);
  return m ? m[0] : "";
}

/** URLSearchParams or URL文字列を { action, sharedTitle, sharedText, sharedURL } に正規化 */
export function parseQuery(href) {
  let params;
  try {
    params = new URL(href, "http://example/").searchParams;
  } catch (_e) {
    return { action: "", sharedTitle: "", sharedText: "", sharedURL: "" };
  }
  const sharedTitle = params.get("shared_title") || "";
  const sharedText = params.get("shared_text") || "";
  const rawURL = params.get("shared_url") || "";
  const action = params.get("action") || (sharedTitle || sharedText || rawURL ? "share" : "");
  // 共有された URL が空でも text 側に含まれているケースを救う (Twitter等)
  const sharedURL = rawURL || extractURL(sharedText) || extractURL(sharedTitle);
  return { action, sharedTitle, sharedText, sharedURL };
}

/** URLからクエリパラメータを除去 (履歴を綺麗に) */
export function cleanURL() {
  if (typeof history === "undefined" || typeof location === "undefined") return;
  try {
    const u = new URL(location.href);
    let dirty = false;
    ["shared_title","shared_text","shared_url","action"].forEach((k) => {
      if (u.searchParams.has(k)) { u.searchParams.delete(k); dirty = true; }
    });
    if (dirty) history.replaceState({}, "", u.toString());
  } catch (_e) { /* noop */ }
}

/**
 * 起動時に1度だけ実行。
 * @param handlers {openAddArticleModal, openAddMemoModal, route}
 */
export function handleStartupQuery(handlers) {
  if (typeof location === "undefined") return;
  const { action, sharedTitle, sharedText, sharedURL } = parseQuery(location.href);
  if (!action) return;

  switch (action) {
    case "share":
      handlers.openAddArticleModal({
        title: sharedTitle || "",
        url: sharedURL || "",
        summary: sharedText && sharedText !== sharedURL ? sharedText : ""
      });
      break;
    case "add":
      handlers.openAddArticleModal({});
      break;
    case "memo":
      handlers.openAddMemoModal();
      break;
    case "reviews":
      handlers.route("reviews");
      break;
    case "dashboard":
      handlers.route("reviews", { tab: "dashboard" });
      break;
    default:
      // 未知のactionは無視
      break;
  }
  cleanURL();
}
