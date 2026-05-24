/* utils.js
 * 役割: 副作用のない純粋ユーティリティ
 * - ID生成、日付、文字列処理、URL正規化、エスケープ
 * - DOMに依存しないのでNode環境でもテスト可能
 */

export function uid(prefix = "id") {
  return prefix + "_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 8);
}

export function nowISO() {
  return new Date().toISOString();
}

export function dateOnly(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** 2つのYYYY-MM-DDを日数差で返す (b - a) */
export function diffDays(aISO, bISO) {
  const a = new Date(aISO + "T00:00:00");
  const b = new Date(bISO + "T00:00:00");
  return Math.round((b - a) / 86400000);
}

/** HTMLエスケープ */
export function escapeHTML(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;"
  }[c]));
}

/** http/httpsだけ通すURL検証 */
export function safeURL(u) {
  try {
    const x = new URL(u);
    return (x.protocol === "http:" || x.protocol === "https:") ? x.toString() : "";
  } catch (_e) {
    return "";
  }
}

export function domainOf(u) {
  const ok = safeURL(u);
  if (!ok) return "";
  try { return new URL(ok).hostname; } catch (_e) { return ""; }
}

/** URLからutm系・hash・既知トラッキングを除去して正規化 */
export function normalizeURL(u) {
  const ok = safeURL(u);
  if (!ok) return "";
  try {
    const x = new URL(ok);
    x.hash = "";
    ["utm_source","utm_medium","utm_campaign","utm_term","utm_content","fbclid","gclid"]
      .forEach((p) => x.searchParams.delete(p));
    return x.toString();
  } catch (_e) {
    return ok;
  }
}

/** 配列 → 出現頻度の降順タプル [[key,count], ...] */
export function frequencyMap(arr, picker) {
  const map = {};
  arr.forEach((x) => {
    const vals = picker(x);
    (Array.isArray(vals) ? vals : [vals]).filter(Boolean).forEach((v) => {
      map[v] = (map[v] || 0) + 1;
    });
  });
  return Object.entries(map).sort((a, b) => b[1] - a[1]);
}

/** ISO期間で配列をフィルタするためのヘルパ (createdAtPicker指定可) */
export function inRange(items, fromISO, toISO, picker) {
  return items.filter((x) => {
    const t = picker(x);
    return t >= fromISO && t <= toISO;
  });
}

/** 値が空かどうか */
export function isBlank(v) {
  if (v === null || v === undefined) return true;
  if (typeof v === "string") return v.trim() === "";
  if (Array.isArray(v)) return v.length === 0;
  return false;
}
