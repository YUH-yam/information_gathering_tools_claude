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
   4. GAS スニペット (UI設定画面で表示・コピー)
   ============================================================ */

export function getGASSnippet() {
  return `// === Google Apps Script for 時流インサイト・ログ (v1.2) ===
// 1) スプレッドシートにバインドして貼り付け
// 2) デプロイ→新しいデプロイ→ウェブアプリ
// 3) アクセス: 全員 / 実行: 自分
// 4) 発行されたURLを設定画面の「GAS Web App URL」に貼り付け
//
// 機能:
//  doPost  - 行の書き込み (articles/memos/feeds/...)
//  doGet?sheet=...        - シート全件を取得 (マルチ端末同期)
//  doGet?fetch=RSS_URL    - RSS取得プロキシ (CORS回避)

function doPost(e) {
  const ss = SpreadsheetApp.getActive();
  const data = JSON.parse(e.postData.contents);
  const sheetName = data.sheet;
  const row = data.row;
  let sh = ss.getSheetByName(sheetName);
  if (!sh) sh = ss.insertSheet(sheetName);
  let headers = sh.getLastRow() > 0
    ? sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0]
    : Object.keys(row);
  if (sh.getLastRow() === 0) sh.appendRow(headers);
  Object.keys(row).forEach(k => { if (!headers.includes(k)) headers.push(k); });
  sh.getRange(1, 1, 1, headers.length).setValues([headers]);
  const arr = headers.map(h => {
    let v = row[h];
    if (Array.isArray(v)) v = v.join("|");
    if (v === undefined || v === null) v = "";
    return typeof v === "object" ? JSON.stringify(v) : v;
  });
  sh.appendRow(arr);
  return _json({ok:true, sheet:sheetName});
}

function doGet(e) {
  // RSSプロキシ
  if (e.parameter.fetch) {
    try {
      const res = UrlFetchApp.fetch(e.parameter.fetch, { muteHttpExceptions: true });
      return _json({ok: res.getResponseCode() === 200, xml: res.getContentText()});
    } catch(err) {
      return _json({ok:false, error: String(err)});
    }
  }
  // シート取得 (マルチ端末同期)
  if (e.parameter.sheet) {
    const ss = SpreadsheetApp.getActive();
    const sh = ss.getSheetByName(e.parameter.sheet);
    if (!sh || sh.getLastRow() === 0) return _json({ok:true, rows:[]});
    const values = sh.getDataRange().getValues();
    const headers = values[0];
    const rows = values.slice(1).map(r => {
      const o = {};
      headers.forEach((h, i) => { o[h] = r[i]; });
      return o;
    });
    return _json({ok:true, rows});
  }
  return _json({ok:false, error:"sheet/fetch どちらかのパラメータが必要"});
}

function _json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}`;
}
