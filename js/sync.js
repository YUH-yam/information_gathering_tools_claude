/* sync.js
 * 役割: Google Apps Script Web App との双方向同期 (要件 7, 8 + 第2弾拡張)
 *  - 書き込み: syncRowAsync（既存）
 *  - 読み込み: pullSheet（新規） → マルチ端末同期の核
 *  - マージ: mergeRows（Last-Write-Wins、updated_atで比較）
 *  - 失敗ログは sync_logs に保存
 */

import { Store } from "./store.js";
import { uid, nowISO } from "./utils.js";

/* ============================================================
   1. 書き込み (既存)
   ============================================================ */

export function syncRowAsync(sheet, row) {
  const url = Store.state?.settings?.gas_url;
  if (!url) {
    pushLog({ sync_type: "local_only", target_sheet: sheet, status: "skipped", message: "GAS URL未設定" });
    return;
  }
  if (typeof fetch === "undefined") return;

  fetch(url, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify({ sheet, row })
  })
    .then((r) => r.text())
    .then((t) => pushLog({ sync_type: "row", target_sheet: sheet, status: "ok", message: t.slice(0, 200) }))
    .catch((err) => pushLog({ sync_type: "row", target_sheet: sheet, status: "error", message: String(err).slice(0, 300) }));
}

/* ============================================================
   2. 読み込み (新規・マルチ端末同期)
   ============================================================ */

/** GASから1シート分の行を取得（doGet?sheet=...）*/
export async function pullSheet(sheet) {
  const url = Store.state?.settings?.gas_url;
  if (!url) return { ok: false, error: "GAS URL未設定" };
  if (typeof fetch === "undefined") return { ok: false, error: "fetch未対応" };
  try {
    const r = await fetch(`${url}?sheet=${encodeURIComponent(sheet)}`, { method: "GET" });
    const txt = await r.text();
    const obj = JSON.parse(txt);
    if (!obj.ok) return { ok: false, error: obj.error || "不明" };
    return { ok: true, rows: obj.rows || [] };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/** 全シートをプルしてローカルにマージ。{added, updated, errors[]} */
export async function pullAll() {
  const targets = [
    { sheet: "articles", localKey: "articles", idKey: "article_id" },
    { sheet: "insight_memos", localKey: "memos", idKey: "memo_id" },
    { sheet: "weekly_reviews", localKey: "weekly_reviews", idKey: "review_id" },
    { sheet: "monthly_reviews", localKey: "monthly_reviews", idKey: "review_id" },
    { sheet: "trend_observations", localKey: "trend_observations", idKey: "observation_id" },
    { sheet: "feeds", localKey: "feeds", idKey: "feed_id" }
  ];
  let totalAdded = 0, totalUpdated = 0;
  const errors = [];
  for (const t of targets) {
    const r = await pullSheet(t.sheet);
    if (!r.ok) { errors.push({ sheet: t.sheet, error: r.error }); continue; }
    const merged = mergeRows(Store.state[t.localKey], r.rows, t.idKey);
    Store.state[t.localKey] = merged.list;
    totalAdded += merged.added;
    totalUpdated += merged.updated;
    pushLog({ sync_type: "pull", target_sheet: t.sheet, status: "ok",
              message: `+${merged.added} updated:${merged.updated}` });
  }
  Store.save();
  return { added: totalAdded, updated: totalUpdated, errors };
}

/** Last-Write-Wins マージ（純粋関数） */
export function mergeRows(local, remote, idKey) {
  const map = new Map();
  local.forEach((row) => { if (row[idKey]) map.set(row[idKey], row); });
  let added = 0, updated = 0;
  remote.forEach((row) => {
    if (!row || !row[idKey]) return;
    // タグ等が "|" 区切り文字列で来た場合は配列に戻す
    if (typeof row.tags === "string" && row.tags.length > 0) row.tags = row.tags.split("|");
    const exist = map.get(row[idKey]);
    if (!exist) {
      map.set(row[idKey], row);
      added++;
    } else {
      const a = new Date(exist.updated_at || exist.created_at || 0).getTime();
      const b = new Date(row.updated_at || row.created_at || 0).getTime();
      if (b > a) { map.set(row[idKey], row); updated++; }
    }
  });
  // updated_at desc で安定ソート
  const list = Array.from(map.values()).sort((x, y) => {
    return new Date(y.updated_at || y.created_at || 0).getTime() -
           new Date(x.updated_at || x.created_at || 0).getTime();
  });
  return { list, added, updated };
}

/* ============================================================
   3. ログ
   ============================================================ */

function pushLog({ sync_type, target_sheet, status, message }) {
  Store.state.sync_logs.push({
    sync_id: uid("sync"),
    sync_type, target_sheet, status, message,
    synced_at: nowISO()
  });
  if (Store.state.sync_logs.length > 500) {
    Store.state.sync_logs = Store.state.sync_logs.slice(-500);
  }
  Store.save();
}

/* ============================================================
   4. GAS スクリプトのパス情報
   GASコード本体は ./gas/Code.gs に分離 (一元管理)
   ============================================================ */

export const GAS_CODE_URL = "./gas/Code.gs";
export const GAS_SETUP_URL = "./gas/SETUP.md";

/** GAS コードを fetch して文字列で返す */
export async function loadGASCode() {
  if (typeof fetch === "undefined") return "// 取得不可 (fetch未対応)";
  try {
    const r = await fetch(GAS_CODE_URL);
    if (!r.ok) return `// 取得失敗 (HTTP ${r.status})`;
    return await r.text();
  } catch (e) {
    return "// 取得失敗: " + e.message;
  }
}
