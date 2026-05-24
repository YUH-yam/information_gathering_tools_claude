/* tests.js
 * 役割: アプリ内とNodeの両方から呼べる自動テストランナー
 * - 主要ロジック (utils, classifier, articles, reviews, exporter, streak) を検証
 * - 副作用を切り離すため、テスト中はStoreをバックアップ→復元
 * - 戻り値: {pass, fail, summary, lines}
 */

import { Store } from "./store.js";
import {
  uid, nowISO, dateOnly, diffDays, escapeHTML,
  safeURL, normalizeURL, domainOf, frequencyMap, inRange, isBlank
} from "./utils.js";
import { detectCategory, detectTags, calculateImportance } from "./classifier.js";
import { addArticleQuick, pickTodayArticles } from "./articles.js";
import { addMemoQuick } from "./memos.js";
import { generateWeeklyReview, generateMonthlyReview, renderWeeklyMarkdown } from "./reviews.js";
import { buildArticlesCSV } from "./exporter.js";
import { markActive, isTodayDone, missedYesterday } from "./streak.js";
import { TODAY_LIMIT } from "./config.js";

export function __runSelfTests() {
  const lines = [];
  let pass = 0, fail = 0;
  const assert = (name, cond, detail = "") => {
    if (cond) { pass++; lines.push(`✓ ${name}`); }
    else { fail++; lines.push(`✗ ${name}${detail ? " -- " + detail : ""}`); }
  };

  // バックアップ
  Store.load();
  const backup = JSON.stringify(Store.state);

  try {
    Store.state = Store.initial();
    Store.save();

    /* ---- utils ---- */
    assert("utils: uid prefix", uid("test").startsWith("test_"));
    assert("utils: dateOnly format", /^\d{4}-\d{2}-\d{2}$/.test(dateOnly()));
    assert("utils: diffDays = 1", diffDays("2026-05-24", "2026-05-25") === 1);
    assert("utils: diffDays = -1", diffDays("2026-05-25", "2026-05-24") === -1);
    assert("utils: escapeHTML XSS", escapeHTML("<img src=x onerror=alert(1)>") === "&lt;img src=x onerror=alert(1)&gt;");
    assert("utils: safeURL accepts https", safeURL("https://example.com/") === "https://example.com/");
    assert("utils: safeURL rejects javascript", safeURL("javascript:alert(1)") === "");
    assert("utils: safeURL rejects garbage", safeURL("not a url") === "");
    assert("utils: normalizeURL utm除去", normalizeURL("https://example.com/?utm_source=x&a=1") === "https://example.com/?a=1");
    assert("utils: normalizeURL hash除去", normalizeURL("https://example.com/path#frag") === "https://example.com/path");
    assert("utils: domainOf", domainOf("https://www.example.com/x") === "www.example.com");
    assert("utils: isBlank", isBlank("") && isBlank("  ") && isBlank([]) && isBlank(null) && !isBlank("x"));
    const freq = frequencyMap([{t:["a","b"]},{t:["a"]},{t:["c"]}], (x) => x.t);
    assert("utils: frequencyMap", freq[0][0] === "a" && freq[0][1] === 2);

    /* ---- classifier ---- */
    assert("classifier: AI→DX/AI", detectCategory("生成AIエージェントの最新動向", "") === "DX/AI");
    assert("classifier: CX→マーケ", detectCategory("顧客体験NPSの設計", "") === "マーケティング/CX");
    assert("classifier: エネルギー", detectCategory("再エネと脱炭素の動向", "") === "エネルギー");
    assert("classifier: デフォルト", detectCategory("特になんでもないニュース", "") === "国内ビジネス");
    const tags = detectTags("生成AIで広告のCXを改善", "https://example.com/");
    assert("classifier: AI/生成AIタグ", tags.includes("AI/生成AI"));
    assert("classifier: CXタグ", tags.includes("CX"));
    assert("classifier: マーケタグ", tags.includes("マーケティング"));
    // 政策+AI+一次情報+focus一致+直近=60点台 → 中以上
    const imp1 = calculateImportance(
      { title:"生成AI 規制ガイドライン", url:"https://www.meti.go.jp/x", category:"政策・規制", tags:["政策"], saved_at: nowISO() },
      { focusCategories:["政策・規制"], savedTagFreq:{} });
    assert("classifier: 中以上(政策+AI+一次情報)", imp1.level !== "low" && imp1.score >= 60, "score="+imp1.score);

    // 複数ソース出現も足せば 高
    const imp1b = calculateImportance(
      { title:"生成AI 規制ガイドライン", url:"https://www.meti.go.jp/x", category:"政策・規制", tags:["政策"], saved_at: nowISO() },
      { focusCategories:["政策・規制"], savedTagFreq:{}, duplicateCount:2 });
    assert("classifier: 高判定(複数ソース込)", imp1b.level === "high", "score="+imp1b.score);
    const imp2 = calculateImportance(
      { title:"普通の話", url:"https://example.com/", category:"国内ビジネス", tags:[], saved_at: nowISO() },
      { focusCategories:[], savedTagFreq:{} });
    assert("classifier: 高ではない", imp2.level !== "high", "score="+imp2.score);

    /* ---- articles ---- */
    const r1 = addArticleQuick({ title:"テスト記事1", url:"https://example.com/x?utm_source=tw" });
    assert("articles: 保存ok", r1.ok && r1.article && r1.article.article_id);
    const before = Store.state.articles.length;
    const r2 = addArticleQuick({ title:"重複テスト", url:"https://example.com/x" }); // 正規化で同一
    assert("articles: 重複は弾く", r2.ok === false && r2.reason === "duplicate" && Store.state.articles.length === before);
    // ピックアップ上限
    Store.state.articles = [];
    for (let i = 0; i < 15; i++) addArticleQuick({ title: `pick${i}`, url: `https://example.com/p${i}` });
    assert("articles: pickToday <= TODAY_LIMIT", pickTodayArticles().length === TODAY_LIMIT);

    /* ---- memos ---- */
    const m = addMemoQuick({ what_happened: "検証用メモ" });
    assert("memos: 保存される", Store.state.memos.length === 1 && m.memo_id.startsWith("memo_"));

    /* ---- reviews ---- */
    const wr = generateWeeklyReview();
    assert("reviews: 週次Markdown", wr.markdown_output.includes("週次レビュー"));
    assert("reviews: 期間が含まれる", wr.markdown_output.includes(wr.week_start));
    const mr = generateMonthlyReview();
    assert("reviews: 月次Markdown", mr.markdown_output.includes("月次レビュー"));

    /* ---- exporter (純粋関数) ---- */
    const csv = buildArticlesCSV([{
      article_id:"a1", title:'カンマ,テスト', url:"https://example.com/", source_name:"ex",
      category:"DX/AI", tags:["AI","X"], importance:"high", summary:'"引用"あり', user_memo:"", saved_at: nowISO()
    }]);
    assert("exporter: CSVヘッダ", csv.startsWith("article_id,title"));
    assert("exporter: ダブルクォートエスケープ", csv.includes('""引用""'));
    assert("exporter: タグを|連結", csv.includes('"AI|X"'));

    /* ---- streak ---- */
    Store.state.streak = { current:0, longest:0, total_active_days:0, last_active_date:"", freeze_tokens:1, freeze_last_grant:dateOnly(), history:[] };
    markActive(); // 初回 → 1日
    assert("streak: 初回=1日", Store.state.streak.current === 1);
    assert("streak: isTodayDone", isTodayDone() === true);

    // 昨日に偽装 → 連続+1
    const yest = new Date(); yest.setDate(yest.getDate() - 1);
    Store.state.streak.last_active_date = dateOnly(yest);
    markActive();
    assert("streak: 連続+1", Store.state.streak.current === 2);

    // フリーズで穴埋め (gap=2)
    Store.state.streak.current = 5;
    Store.state.streak.freeze_tokens = 1;
    const dby = new Date(); dby.setDate(dby.getDate() - 2);
    Store.state.streak.last_active_date = dateOnly(dby);
    markActive();
    assert("streak: フリーズで継続", Store.state.streak.current === 6 && Store.state.streak.freeze_tokens === 0);

    // フリーズ無し2日空き → リセット
    Store.state.streak.current = 5;
    Store.state.streak.freeze_tokens = 0;
    const dby2 = new Date(); dby2.setDate(dby2.getDate() - 3);
    Store.state.streak.last_active_date = dateOnly(dby2);
    markActive();
    assert("streak: 3日空きでリセット=1", Store.state.streak.current === 1);

    // missedYesterday
    Store.state.streak.last_active_date = dateOnly(new Date(Date.now() - 86400000));
    assert("streak: missedYesterday=true", missedYesterday() === true);
    Store.state.streak.last_active_date = dateOnly();
    assert("streak: 今日触ったら missedYesterday=false", missedYesterday() === false);

    /* ---- 重要度: 海外トレンドブースト ---- */
    const impGlobal = calculateImportance(
      { title:"global trend", url:"https://example.com/", tags:["海外トレンド"], saved_at: nowISO() }, {});
    assert("classifier: 海外+直近で >=15", impGlobal.score >= 15);

    /* ---- renderWeeklyMarkdown 単体 ---- */
    const md = renderWeeklyMarkdown({
      weekStart:"2026-05-19", weekEnd:"2026-05-25",
      arts:[], memos:[], importantArts:[], topTrends:[], tagFreq:[], catFreq:[]
    });
    assert("reviews: 空でもMarkdown返る", md.includes("週次レビュー") && md.includes("2026-05-19"));

  } catch (e) {
    fail++; lines.push("✗ 例外発生: " + (e && e.message ? e.message : String(e)));
  } finally {
    Store.state = JSON.parse(backup);
    Store.save();
  }

  const summary = `テスト結果: ${pass} pass / ${fail} fail`;
  if (typeof console !== "undefined") {
    console.log(summary);
    lines.forEach((l) => console.log(l));
  }
  return { pass, fail, summary, lines };
}

// グローバル公開 (ブラウザのconsoleからも叩けるように)
if (typeof globalThis !== "undefined") {
  globalThis.__runSelfTests = __runSelfTests;
}
