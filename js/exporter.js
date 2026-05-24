/* exporter.js
 * 役割: ダウンロード/エクスポート/インポート/コピー (要件 7, 11.3, 20.3)
 * - articlesのCSV、全データのJSONバックアップ、Markdownダウンロード
 * - クリップボードAPIフォールバック
 * - 純粋関数 buildArticlesCSV はNodeでもテスト可能
 */

import { Store } from "./store.js";
import { dateOnly } from "./utils.js";

/** 配列をCSV化 (純粋関数) */
export function buildArticlesCSV(articles) {
  const cols = ["article_id","title","url","source_name","category","tags","importance","summary","user_memo","saved_at"];
  const rows = [cols.join(",")];
  articles.forEach((a) => {
    rows.push(cols.map((c) => {
      let v = a[c];
      if (Array.isArray(v)) v = v.join("|");
      v = String(v ?? "").replace(/"/g, '""');
      return `"${v}"`;
    }).join(","));
  });
  return rows.join("\n");
}

/** ファイルダウンロード (ブラウザ専用) */
export function downloadFile(filename, content, mime = "text/plain") {
  if (typeof document === "undefined") return; // Nodeテストではスキップ
  const blob = new Blob([content], { type: mime + ";charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 100);
}

export function exportArticlesCSV() {
  downloadFile(`articles_${dateOnly()}.csv`, buildArticlesCSV(Store.state.articles), "text/csv");
}

export function exportJSONBackup() {
  downloadFile(`insight_intake_backup_${dateOnly()}.json`,
    JSON.stringify(Store.state, null, 2), "application/json");
}

/** Fileオブジェクトを受けてJSON復元 (戻り値Promise) */
export function importJSONBackup(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("読み込み失敗"));
    reader.onload = (e) => {
      try {
        const obj = JSON.parse(e.target.result);
        if (!obj || typeof obj !== "object" || !Array.isArray(obj.articles)) {
          throw new Error("形式不正 (articles配列がありません)");
        }
        Store.state = obj;
        Store.save();
        resolve(obj);
      } catch (err) { reject(err); }
    };
    reader.readAsText(file);
  });
}

/** クリップボードコピー */
export function copyText(text) {
  return new Promise((resolve) => {
    if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(text).then(() => resolve(true), () => fallback());
    } else {
      fallback();
    }
    function fallback() {
      if (typeof document === "undefined") { resolve(false); return; }
      const ta = document.createElement("textarea");
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      let ok = false;
      try { ok = document.execCommand("copy"); } catch (_e) {}
      ta.remove();
      resolve(ok);
    }
  });
}
