/* feeds.js
 * 役割: フィード(RSS情報源) CRUD と取得実行
 *  - feeds シート: feed_id, feed_name, feed_url, category, enabled, priority, last_fetched_at, last_status
 *  - 取得結果を articles に投入 (重複は addArticleQuick が弾く)
 */

import { Store } from "./store.js";
import { uid, nowISO, normalizeURL, domainOf } from "./utils.js";
import { fetchFeed, parseFeedXML, stripTags } from "./rss.js";
import { addArticleQuick } from "./articles.js";
import { syncRowAsync } from "./sync.js";

export function addFeed({ feed_name, feed_url, category = "", priority = "mid" }) {
  if (!feed_url) return { ok: false, reason: "URLが空" };
  const norm = normalizeURL(feed_url);
  if (!norm) return { ok: false, reason: "無効なURL" };
  if (Store.state.feeds.some((f) => normalizeURL(f.feed_url) === norm)) {
    return { ok: false, reason: "duplicate" };
  }
  const feed = {
    feed_id: uid("feed"),
    feed_name: feed_name || domainOf(feed_url) || "新規フィード",
    feed_url: norm,
    source_type: "rss",
    category,
    language: "",
    region: "",
    priority,
    enabled: true,
    last_fetched_at: "",
    last_status: "",
    created_at: nowISO(),
    updated_at: nowISO()
  };
  Store.state.feeds.unshift(feed);
  Store.save();
  syncRowAsync("feeds", feed);
  return { ok: true, feed };
}

export function updateFeed(id, patch) {
  const f = Store.state.feeds.find((x) => x.feed_id === id);
  if (!f) return null;
  Object.assign(f, patch, { updated_at: nowISO() });
  Store.save();
  syncRowAsync("feeds", f);
  return f;
}

export function deleteFeed(id) {
  const i = Store.state.feeds.findIndex((x) => x.feed_id === id);
  if (i >= 0) { Store.state.feeds.splice(i, 1); Store.save(); }
}

/** 1フィードを取得して articles に投入。{ok, added, skipped, error} */
export async function fetchFeedAndStore(feed) {
  const r = await fetchFeed(feed.feed_url);
  feed.last_fetched_at = nowISO();
  if (!r.ok) {
    feed.last_status = "error: " + (r.error || "unknown");
    Store.save();
    syncRowAsync("feeds", feed);
    return { ok: false, added: 0, skipped: 0, error: r.error };
  }
  const items = parseFeedXML(r.xml);
  let added = 0, skipped = 0;
  items.forEach((it) => {
    const title = stripTags(it.title);
    const url = stripTags(it.link);
    const summary = stripTags(it.summary).slice(0, 300);
    if (!url) { skipped++; return; }
    const res = addArticleQuick({
      title: title || url, url, summary,
      source_name: feed.feed_name,
      category: feed.category || ""
    });
    if (res.ok) added++; else skipped++;
  });
  feed.last_status = `ok: +${added} (skip ${skipped}) via ${r.via || "?"}`;
  Store.save();
  syncRowAsync("feeds", feed);
  return { ok: true, added, skipped };
}

/** 全有効フィードを順次取得 (直列、サーバ負荷配慮)。{total_added, errors[]} */
export async function fetchAllEnabled() {
  const feeds = Store.state.feeds.filter((f) => f.enabled);
  let totalAdded = 0;
  const errors = [];
  for (const f of feeds) {
    const r = await fetchFeedAndStore(f);
    if (!r.ok) errors.push({ feed: f.feed_name, error: r.error });
    else totalAdded += r.added;
  }
  return { total_added: totalAdded, errors, feed_count: feeds.length };
}
