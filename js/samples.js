/* samples.js
 * 役割: 初回起動を空っぽにせず、操作感を確認できるサンプルデータの投入
 * - 「ようこそ」記事を入れて、保存・タグ・重要度のUIを体感してもらう
 */

import { Store } from "./store.js";
import { addArticleQuick } from "./articles.js";

const WELCOME_SAMPLES = [
  {
    title: "ようこそ、時流インサイト・ログへ",
    summary: "このアプリは、忙しい毎日でも『見るべき情報』だけを残せます。下の📥で保存、📝でメモ、📊で振り返り。",
    category: "学習・キャリア",
    tags: ["事例"],
    importance: "high"
  },
  {
    title: "1日1記事だけでOK。三日坊主を防ぐ最小ミッション",
    summary: "未読を減らすことが目的ではありません。重要情報を拾い、示唆に変えることが目的です。",
    category: "学習・キャリア",
    tags: ["DX"],
    importance: "high"
  },
  {
    title: "週末に5分の振り返り：『今週の傾向』を確認",
    summary: "振り返りタブの『今週分を自動生成』で、Markdownの下書きが出ます。仕事の論点に変換しましょう。",
    category: "マーケティング/CX",
    tags: ["マーケティング"],
    importance: "mid"
  },
  {
    title: "サンプル：生成AIエージェントが顧客接点を変える可能性",
    summary: "AIエージェントは検索・購買・サポートを横断するため、CRM/CDPの設計思想に影響します。",
    category: "DX/AI",
    tags: ["AI/生成AI","CX"],
    importance: "high"
  },
  {
    title: "サンプル：リテールメディアと顧客データの統合",
    summary: "小売の広告ビジネスが成長。一次データを軸にした広告と購買体験の融合が起きています。",
    category: "マーケティング/CX",
    tags: ["マーケティング","リテール"],
    importance: "mid"
  },
  {
    title: "サンプル：脱炭素と都市ガス事業の構造変化",
    summary: "電力小売の競争激化と並行して、ガス会社のエネルギー転換戦略が問われています。",
    category: "エネルギー",
    tags: ["エネルギー"],
    importance: "mid"
  }
];

export function loadSamples() {
  WELCOME_SAMPLES.forEach((s) => addArticleQuick(s));
  Store.state.sample_loaded = true;
  Store.save();
}
