/* sync.js
 * 役割: Google Apps Script Web App との非同期同期 (要件 7, 8)
 * - 設定でGAS URLが空ならスキップ (ローカル完結)
 * - 失敗してもデータは消えない (sync_logsに記録、ローカル保存は先行)
 * - CORSプリフライト回避のため Content-Type は text/plain
 */

import { Store } from "./store.js";
import { uid, nowISO } from "./utils.js";

/** 1行を非同期で送信 (ブラウザのみ動作) */
export function syncRowAsync(sheet, row) {
  const url = Store.state?.settings?.gas_url;
  if (!url) {
    pushLog({ sync_type: "local_only", target_sheet: sheet, status: "skipped", message: "GAS URL未設定" });
    return;
  }
  if (typeof fetch === "undefined") return; // Nodeテスト時スキップ

  fetch(url, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify({ sheet, row })
  })
    .then((r) => r.text())
    .then((t) => pushLog({ sync_type: "row", target_sheet: sheet, status: "ok", message: t.slice(0, 200) }))
    .catch((err) => pushLog({ sync_type: "row", target_sheet: sheet, status: "error", message: String(err).slice(0, 300) }));
}

function pushLog({ sync_type, target_sheet, status, message }) {
  Store.state.sync_logs.push({
    sync_id: uid("sync"),
    sync_type, target_sheet, status, message,
    synced_at: nowISO()
  });
  // ログ肥大化を防ぐため500件で打ち切り
  if (Store.state.sync_logs.length > 500) {
    Store.state.sync_logs = Store.state.sync_logs.slice(-500);
  }
  Store.save();
}

/** 設定画面で表示するGASスニペット */
export function getGASSnippet() {
  return `// Google Apps Script: スプレッドシートにバインドして貼り付け、
// 「デプロイ→新しいデプロイ→ウェブアプリ」/ アクセス: 全員 / 実行: 自分
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
  return ContentService.createTextOutput(JSON.stringify({ok:true, sheet:sheetName}))
    .setMimeType(ContentService.MimeType.JSON);
}`;
}
