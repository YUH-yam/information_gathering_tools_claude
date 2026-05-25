/* rss.js
 * 役割: RSS/Atom フィードの取得とパース
 *  - パースは純粋関数 (DOMParser に依存。Node では fast-xml-parser 等は使わず手書き正規表現で代替)
 *  - 取得は GAS優先 → CORSプロキシのフォールバック
 *  - 不明なフィードは取得失敗を理由付きで返す
 *
 * 注意: 公開CORSプロキシは第三者サービスのため、ユーザーが設定で OFF にできる。
 */

import { Store } from "./store.js";
import { nowISO } from "./utils.js";

/* ============================================================
   1. XML パース (純粋関数)
   ============================================================ */

/** タグの中身を素朴に抜き出す（CDATAとHTMLエンティティ対応） */
function decodeText(s) {
  if (!s) return "";
  // CDATA を剥がす
  s = s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1");
  // 主要HTMLエンティティ
  s = s.replace(/&amp;/g, "&")
       .replace(/&lt;/g, "<")
       .replace(/&gt;/g, ">")
       .replace(/&quot;/g, '"')
       .replace(/&apos;/g, "'")
       .replace(/&#39;/g, "'")
       .replace(/&nbsp;/g, " ");
  return s.trim();
}

function extractTag(itemXml, tag) {
  // <tag ...>...</tag> または <tag .../>
  const re = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, "i");
  const m = itemXml.match(re);
  return m ? decodeText(m[1]) : "";
}

function extractAttr(itemXml, tag, attr) {
  const re = new RegExp(`<${tag}\\s[^>]*${attr}=["']([^"']+)["']`, "i");
  const m = itemXml.match(re);
  return m ? decodeText(m[1]) : "";
}

/** RSS2.0 または Atom の XML 文字列を items[{title,link,published,summary}] に変換 */
export function parseFeedXML(xml) {
  if (!xml || typeof xml !== "string") return [];
  // RSS2.0
  const items = [];
  const itemBlocks = xml.match(/<item\b[\s\S]*?<\/item>/gi) || [];
  itemBlocks.forEach((block) => {
    items.push({
      title: extractTag(block, "title"),
      link: extractTag(block, "link") || extractAttr(block, "link", "href"),
      published: extractTag(block, "pubDate") || extractTag(block, "dc:date") || "",
      summary: extractTag(block, "description") || extractTag(block, "content:encoded") || ""
    });
  });
  if (items.length > 0) return items;

  // Atom
  const entryBlocks = xml.match(/<entry\b[\s\S]*?<\/entry>/gi) || [];
  entryBlocks.forEach((block) => {
    items.push({
      title: extractTag(block, "title"),
      link: extractAttr(block, "link", "href") || extractTag(block, "id"),
      published: extractTag(block, "updated") || extractTag(block, "published") || "",
      summary: extractTag(block, "summary") || extractTag(block, "content") || ""
    });
  });
  return items;
}

/** タイトル/URL/サマリーから不要HTMLを除去（XSS対策・要約化） */
export function stripTags(s) {
  return decodeText(String(s || "").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}

/* ============================================================
   2. 取得ルーティング (GAS / CORSプロキシ)
   ============================================================ */

/** デフォルト CORS プロキシ (allorigins) - ユーザーが設定で差し替え可能 */
export const DEFAULT_CORS_PROXY = "https://api.allorigins.win/raw?url=";

/** 取得結果: {ok:bool, xml?, error?} */
export async function fetchFeed(rssURL) {
  if (typeof fetch === "undefined") return { ok: false, error: "fetch未対応環境" };
  if (!rssURL) return { ok: false, error: "URLが空" };

  const settings = Store.state?.settings || {};
  const gas = settings.gas_url;
  const useProxy = settings.cors_proxy_enabled !== false; // デフォルトON
  const proxy = settings.cors_proxy_url || DEFAULT_CORS_PROXY;

  // 1. GAS優先
  if (gas) {
    try {
      const r = await fetch(`${gas}?fetch=${encodeURIComponent(rssURL)}`, { method: "GET" });
      if (r.ok) {
        const text = await r.text();
        // GAS doGet は { ok, xml } の JSON で返す想定
        try {
          const obj = JSON.parse(text);
          if (obj && obj.ok && obj.xml) return { ok: true, xml: obj.xml, via: "gas" };
          if (obj && obj.error) throw new Error("GAS: " + obj.error);
        } catch (e) {
          // JSON でなければ XML 直返しと解釈
          if (text.includes("<rss") || text.includes("<feed") || text.includes("<item")) {
            return { ok: true, xml: text, via: "gas" };
          }
          throw e;
        }
      }
    } catch (e) {
      // GAS 失敗 → プロキシへ
    }
  }

  // 2. CORSプロキシ
  if (useProxy && proxy) {
    try {
      const r = await fetch(proxy + encodeURIComponent(rssURL));
      if (r.ok) {
        const text = await r.text();
        if (text && (text.includes("<rss") || text.includes("<feed") || text.includes("<item") || text.includes("<entry"))) {
          return { ok: true, xml: text, via: "proxy" };
        }
        return { ok: false, error: "プロキシ応答がRSS/Atomではありません" };
      }
      return { ok: false, error: `プロキシHTTP ${r.status}` };
    } catch (e) {
      return { ok: false, error: "プロキシ取得失敗: " + e.message };
    }
  }

  // 3. 直接 (公開フィードで CORS が緩い場合のみ成功)
  try {
    const r = await fetch(rssURL);
    if (r.ok) {
      const text = await r.text();
      return { ok: true, xml: text, via: "direct" };
    }
    return { ok: false, error: `直接HTTP ${r.status} (CORSの可能性)` };
  } catch (e) {
    return { ok: false, error: "取得失敗 (CORS): " + e.message };
  }
}
