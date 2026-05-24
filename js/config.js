/* config.js
 * 役割: アプリ全体で使う定数・初期データ・分類ルールの一元管理
 * ここを編集すれば挙動が変わる中央設定ファイル
 */

export const STORAGE_KEY = "insight_intake_v1";
export const TODAY_LIMIT = 10;

/* カテゴリ初期値 (要件 5.1) */
export const DEFAULT_CATEGORIES = [
  "国内ビジネス",
  "海外ビジネス",
  "マーケティング/CX",
  "DX/AI",
  "エネルギー",
  "生活者トレンド",
  "政策・規制",
  "競合・企業動向",
  "学習・キャリア"
];

/* タグ初期値 */
export const DEFAULT_TAGS = [
  "AI/生成AI", "CX", "マーケティング", "エネルギー", "海外トレンド",
  "DX", "リテール", "データ活用", "CRM", "CDP", "ロイヤルティ", "政策", "事例"
];

/* キーワード→カテゴリ/タグ判定ルール (要件 6.7) */
export const KEYWORD_RULES = [
  { cat: "DX/AI", tags: ["AI/生成AI"], words: ["AI","生成AI","LLM","ChatGPT","Claude","Gemini","エージェント","agent"] },
  { cat: "マーケティング/CX", tags: ["CX"], words: ["CX","顧客体験","NPS","カスタマーエクスペリエンス","ロイヤルティ"] },
  { cat: "マーケティング/CX", tags: ["マーケティング"], words: ["広告","マーケティング","CRM","CDP","リテールメディア","ブランド","コンバージョン"] },
  { cat: "エネルギー", tags: ["エネルギー"], words: ["電力","ガス","再エネ","脱炭素","energy","電気","エネルギー転換"] },
  { cat: "海外ビジネス", tags: ["海外トレンド"], words: ["Reuters","Bloomberg","TechCrunch","WSJ","FT","海外"] },
  { cat: "政策・規制", tags: ["政策"], words: ["規制","ガイドライン","政府","省庁","法案","パブコメ"] },
  { cat: "生活者トレンド", tags: ["事例"], words: ["Z世代","ミレニアル","インサイト","消費","ライフスタイル","トレンド"] },
  { cat: "DX/AI", tags: ["DX"], words: ["DX","デジタル変革","クラウド","SaaS","データ基盤"] }
];

/* 重要度ブースト用キーワード (要件 6.8) */
export const IMPORTANT_KEYWORDS = [
  "生成AI", "AIエージェント", "CX", "CRM", "CDP", "リテールメディア",
  "脱炭素", "エネルギー転換", "規制", "政府", "データ活用", "ロイヤルティ"
];

/* 外部トレンド観測リンク (要件 6.5) */
export const TREND_LINKS = [
  { name: "Google Trends", url: "https://trends.google.com/trends/" },
  { name: "Google Trends Trending now", url: "https://trends.google.com/trending" },
  { name: "TikTok Creative Center", url: "https://ads.tiktok.com/business/creativecenter/" },
  { name: "Pinterest Trends", url: "https://trends.pinterest.com/" },
  { name: "Reddit Popular", url: "https://www.reddit.com/r/popular/" },
  { name: "Exploding Topics", url: "https://explodingtopics.com/" },
  { name: "Trend Hunter", url: "https://www.trendhunter.com/" }
];

/* 観測メモのテンプレート (要件 6.5) */
export const TREND_TEMPLATE =
`【見たツール】
【気になったキーワード・話題】
【伸びている地域・層】
【なぜ伸びていると思うか】
【生活者インサイト】
【仕事・企画への示唆】
【次に調べること】`;

/* 初期ウォッチキーワード (要件 6.4) */
export const INITIAL_WATCH_KEYWORDS = [
  "生成AI マーケティング", "AIエージェント", "顧客体験 CX", "カスタマーエクスペリエンス",
  "リテールメディア", "ロイヤルティプログラム", "CRM", "CDP", "データ活用",
  "電力 小売", "都市ガス 脱炭素", "energy transition", "customer experience",
  "AI marketing", "retail media", "consumer trends", "digital transformation"
];

/* 三日坊主防止: マイルストーンの祝福メッセージ */
export const STREAK_MILESTONES = {
  3: "🎉 3日続きました！三日坊主の壁を突破！",
  7: "🏆 1週間達成！習慣化のスタート地点。",
  30: "🥇 30日達成！立派な習慣です。",
  100: "👑 100日達成！プロ仕様。"
};

/* お休み券 (Freeze) の上限と補充間隔 (日) */
export const FREEZE_MAX = 2;
export const FREEZE_GRANT_INTERVAL_DAYS = 7;
