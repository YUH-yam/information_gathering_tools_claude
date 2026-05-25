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
import { addArticleQuick, pickTodayArticles, deleteArticle, updateArticle, inboxCount } from "./articles.js";
import { resolveTheme } from "./theme.js";
import { addMemoQuick } from "./memos.js";
import { generateWeeklyReview, generateMonthlyReview, renderWeeklyMarkdown } from "./reviews.js";
import { buildArticlesCSV } from "./exporter.js";
import { markActive, isTodayDone, missedYesterday } from "./streak.js";
import { TODAY_LIMIT } from "./config.js";
import { parseQuery, extractURL } from "./share-handler.js";
import { lastNDates, dailyCounts, importanceCounts, buildKPIs } from "./dashboard.js";
import { parseFeedXML, stripTags } from "./rss.js";
import { mergeRows } from "./sync.js";

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

    /* ---- share-handler ---- */
    assert("share: extractURL https", extractURL("見て https://example.com/x ←") === "https://example.com/x");
    assert("share: extractURL なし", extractURL("plain text") === "");
    const q1 = parseQuery("http://x/?shared_title=t&shared_text=u&shared_url=https%3A%2F%2Fa.b%2F");
    assert("share: parseQuery 共有", q1.action === "share" && q1.sharedTitle === "t" && q1.sharedURL === "https://a.b/");
    const q2 = parseQuery("http://x/?action=add");
    assert("share: parseQuery action=add", q2.action === "add");
    const q3 = parseQuery("http://x/?shared_text=see%20https%3A%2F%2Fy.com%20now");
    assert("share: text内URL救出", q3.sharedURL === "https://y.com");
    const q4 = parseQuery("http://x/");
    assert("share: パラメータ無しはaction空", q4.action === "");

    /* ---- dashboard 集計 ---- */
    const dts = lastNDates(7, new Date("2026-05-25T00:00:00"));
    assert("dashboard: lastNDates長さ", dts.length === 7);
    assert("dashboard: lastNDates最新が末尾", dts[dts.length-1] === "2026-05-25");
    assert("dashboard: lastNDates先頭が7日前", dts[0] === "2026-05-19");

    Store.state.articles = [];
    Store.state.memos = [];
    Store.state.weekly_reviews = [];
    Store.state.monthly_reviews = [];
    const fixedNow = new Date("2026-05-25T12:00:00");
    addArticleQuick({ title:"a1", url:"https://example.com/a", importance:"high" });
    addArticleQuick({ title:"a2", url:"https://example.com/b", importance:"mid" });
    addArticleQuick({ title:"a3", url:"https://example.com/c", importance:"low" });
    const imp = importanceCounts(Store.state.articles);
    assert("dashboard: 重要度集計", imp.find(x=>x.level==="high").count === 1
      && imp.find(x=>x.level==="mid").count === 1
      && imp.find(x=>x.level==="low").count === 1);

    const dc = dailyCounts(Store.state.articles, 30, fixedNow);
    assert("dashboard: dailyCounts長さ=30", dc.length === 30);
    assert("dashboard: 全件数の合計", dc.reduce((s,x)=>s+x.count,0) === 3);

    const kpi = buildKPIs(Store.state, 30, fixedNow);
    assert("dashboard: KPI 累計記事", kpi.total_articles === 3);
    assert("dashboard: KPI 30日件数", kpi.recent_articles === 3);
    assert("dashboard: KPI 平均/日", kpi.avg_per_day === 0.1);

    /* ---- RSS パース ---- */
    const rssSample = `<?xml version="1.0"?><rss><channel>
      <item><title>RSS記事1</title><link>https://a.example.com/1</link><description>summary1</description><pubDate>Mon, 25 May 2026 09:00:00 GMT</pubDate></item>
      <item><title><![CDATA[CDATAタイトル&特殊文字]]></title><link>https://a.example.com/2</link><description>desc2</description></item>
    </channel></rss>`;
    const rssItems = parseFeedXML(rssSample);
    assert("rss: 2件抽出", rssItems.length === 2);
    assert("rss: タイトル取得", rssItems[0].title === "RSS記事1");
    assert("rss: CDATA剥がし", rssItems[1].title === "CDATAタイトル&特殊文字");
    assert("rss: link取得", rssItems[0].link === "https://a.example.com/1");

    const atomSample = `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom">
      <entry><title>Atom記事1</title><link href="https://b.example.com/x"/><updated>2026-05-25T00:00:00Z</updated><summary>atom summary</summary></entry>
    </feed>`;
    const atomItems = parseFeedXML(atomSample);
    assert("rss: Atom 1件", atomItems.length === 1 && atomItems[0].title === "Atom記事1");
    assert("rss: Atom link属性", atomItems[0].link === "https://b.example.com/x");

    assert("rss: stripTags", stripTags("<p>hello <b>world</b></p>") === "hello world");
    assert("rss: 空入力", parseFeedXML("").length === 0);

    /* ---- マージ (LWW) ---- */
    const local = [
      { id: "a", updated_at: "2026-05-01T00:00:00Z", title: "local-a" },
      { id: "b", updated_at: "2026-05-10T00:00:00Z", title: "local-b" }
    ];
    const remote = [
      { id: "a", updated_at: "2026-05-20T00:00:00Z", title: "remote-a-newer" },
      { id: "c", updated_at: "2026-05-05T00:00:00Z", title: "remote-c" }
    ];
    const mergeResult = mergeRows(local, remote, "id");
    assert("merge: 件数=3", mergeResult.list.length === 3);
    assert("merge: 追加=1 更新=1", mergeResult.added === 1 && mergeResult.updated === 1);
    const aRow = mergeResult.list.find((x) => x.id === "a");
    assert("merge: aは新しい方が勝つ", aRow.title === "remote-a-newer");
    const bRow = mergeResult.list.find((x) => x.id === "b");
    assert("merge: bはローカル維持", bRow.title === "local-b");

    // タグの "|" 区切り → 配列復元
    const mergeResult2 = mergeRows([], [{ id: "x", updated_at: "2026-05-01T00:00:00Z", tags: "AI|CX|DX" }], "id");
    assert("merge: tags|を配列化", Array.isArray(mergeResult2.list[0].tags) && mergeResult2.list[0].tags.length === 3);

    /* ---- theme.js: resolveTheme は純粋関数 ---- */
    // 明示指定はそのまま返す
    assert("theme: light指定はlight", resolveTheme("light") === "light");
    assert("theme: dark指定はdark", resolveTheme("dark") === "dark");
    // auto: 注入したmatchMediaモックでOS設定をエミュレート
    const mmLight = (q) => ({ matches: q === "(prefers-color-scheme: light)" });
    const mmDark  = (q) => ({ matches: false });
    assert("theme: auto+OSがlight→light", resolveTheme("auto", mmLight) === "light");
    assert("theme: auto+OSがdark→dark", resolveTheme("auto", mmDark) === "dark");
    assert("theme: 不明値+OSがlight→light", resolveTheme("xxx", mmLight) === "light");
    // matchMedia不在のフォールバック
    assert("theme: matchMedia無し→darkにフォールバック", resolveTheme("auto", null) === "dark");

    /* ---- 記事ステータス: saved / inbox / discarded ---- */
    Store.state.articles = [];
    // 手動保存はデフォルトで saved
    const aSaved = addArticleQuick({ title: "manual", url: "https://example.com/manual" });
    assert("status: 手動保存はsaved", aSaved.ok && aSaved.article.status === "saved");
    // 明示的に inbox 指定 (RSS 経由を再現)
    const aInbox = addArticleQuick({ title: "rss item", url: "https://rss.example.com/1", status: "inbox" });
    assert("status: status=inbox指定が保持される", aInbox.ok && aInbox.article.status === "inbox");
    // inboxCount は inbox のみカウント
    assert("status: inboxCount=1", inboxCount() === 1);
    // 「今日見る」では inbox も表示される
    const todayArts = pickTodayArticles();
    const todayHasInbox = todayArts.some((x) => x.article_id === aInbox.article.article_id);
    assert("status: pickTodayはinboxも対象に含む", todayHasInbox);
    // discarded は除外
    aInbox.article.status = "discarded"; aInbox.article.archived_flag = true; Store.save();
    const todayArts2 = pickTodayArticles();
    assert("status: pickTodayはdiscardedを除外", !todayArts2.some((x) => x.article_id === aInbox.article.article_id));
    assert("status: inboxCountはdiscarded化で0", inboxCount() === 0);

    /* ---- 削除と保存解除 ---- */
    Store.state.articles = [];
    const aDel = addArticleQuick({ title: "to delete", url: "https://example.com/del" });
    const idDel = aDel.article.article_id;
    deleteArticle(idDel);
    assert("delete: 完全削除で配列から消える",
      !Store.state.articles.some((x) => x.article_id === idDel));

    // 保存解除: saved → inbox に戻す (UIロジックを模倣)
    Store.state.articles = [];
    const aUnsave = addArticleQuick({ title: "to unsave", url: "https://example.com/unsave" });
    aUnsave.article.status = "inbox";
    aUnsave.article.archived_flag = false;
    Store.save();
    const reread = Store.state.articles.find((x) => x.article_id === aUnsave.article.article_id);
    assert("unsave: saved→inboxへ戻せる", reread.status === "inbox");

    // 不要復元: discarded → inbox
    const aRestore = addArticleQuick({ title: "to restore", url: "https://example.com/restore" });
    aRestore.article.status = "discarded";
    aRestore.article.archived_flag = true;
    Store.save();
    // 復元処理を模倣
    aRestore.article.status = "inbox";
    aRestore.article.archived_flag = false;
    Store.save();
    const reread2 = Store.state.articles.find((x) => x.article_id === aRestore.article.article_id);
    assert("restore: discarded→inboxへ復元", reread2.status === "inbox" && reread2.archived_flag === false);

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
