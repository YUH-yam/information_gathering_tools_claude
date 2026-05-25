# 時流インサイト・ログ (Insight Intake)

国内外の時流を、低い認知負荷で集め、示唆に変えるための個人用インテリジェンスツール。

「情報を集めるツールではなく、情報を示唆に変換するツール」をコンセプトに、忙しい20〜30代ビジネスパーソンが**スマホで毎日1〜5分**だけ使い続けられるよう設計した PWA。

---

## 特長

- スマホ最適化された PWA（ホーム画面に追加してネイティブアプリのように使える）
- **共有シート対応**：スマホのブラウザから「共有」→ 本アプリで即保存（Web Share Target API）
- **アプリアイコン長押しメニュー**：URL保存／メモ／振り返り／ダッシュボードへ直接ジャンプ
- **ダッシュボード**：日次推移・カテゴリ別・タグ Top10・ストリークカレンダーを SVG で可視化（依存ライブラリゼロ）
- **RSS 自分で登録**：任意のフィードを追加して一括取得（GAS or 公開CORSプロキシ経由でCORS回避）
- **マルチ端末同期**：GAS 経由で複数端末のデータを共有（Last-Write-Wins マージ）
- データはすべて端末の localStorage に保存（オフラインでも動く）
- 任意で Google スプレッドシート連携（GAS Web App URL を設定するだけ）
- AI なし・無料・低コストで運用可能（要件に従いルールベースで自動分類）
- 三日坊主を防ぐ仕組みを最初から組み込み
- 9 画面構成（ホーム / 今日見る / 保存 / メモ / 振り返り［週次/月次/観測/ダッシュボード］ / トレンド観測 / 設定 / 同期状況）

---

## 三日坊主防止の仕組み

- **今日の最小ミッション**：1記事チェック または 1メモだけでOK。「未読○件」は一切表示しない
- **ストリーク表示**：連続日数・最長日数・累計日数の3指標
- **お休み券（Freeze）**：1週間ごとに1枚自動補充（上限2枚）。1日休んでもストリーク継続
- **Never miss twice バナー**：昨日触らなかったときに優しい復帰ガードを表示
- **マイルストーン祝福**：3日 / 7日 / 30日 / 100日の節目でメッセージ
- **失っても累計は残る**：途切れても「これまでの累計日数」が残るので心理的負担が少ない

---

## 起動方法

PWA はセキュリティ仕様上、`file://` で直接開いても Service Worker が動きません。HTTP(S) 配信が必要です。

### ローカルで試す

zip を解凍したフォルダに入り、以下のいずれかを実行します。

```bash
# Python 3 がある場合
cd insight-intake
python3 -m http.server 8000

# Node がある場合
cd insight-intake
npx serve .
```

ブラウザで `http://localhost:8000` を開きます。

### スマホで使う（推奨）

GitHub Pages / Netlify / Vercel / Cloudflare Pages など、無料の静的サイトホスティングに `insight-intake/` をデプロイしてください。HTTPS で配信すれば、スマホで開いて「ホーム画面に追加」するだけでアプリのように起動します。

- iOS Safari: 共有ボタン → 「ホーム画面に追加」
- Android Chrome: メニュー → 「アプリをインストール」

ホーム画面から起動するとアドレスバーが消え、スプラッシュ画面付きでネイティブアプリと同等の体験になります。

---

## 主要機能

### ホーム
- 今日のミッション表示（達成済みは ✅）
- ストリーク・累計・お休み券残数
- ピックアップ記事（最大10件・重要度順）
- 今週の傾向タグ
- ショートカット（URL保存、メモ、レビュー、トレンド）

### 今日見る
- 最大10件の重要記事（自動スコア順）
- ワンクリックで「保存／不要／深掘り／メモ」
- 元記事を新規タブで開く

### 保存記事
- 検索（タイトル・概要・メモ）
- 重要度フィルタ
- カテゴリチップ絞り込み
- 重要度ブースト

### 気づきメモ
- 最小入力（「何が起きているか」のみ必須）
- 詳細フィールド（なぜ重要 / 仕事への示唆 / 次に調べること / 施策アイデア）を折りたたみで提供
- 関連記事と紐づけ可

### 振り返り（週次 / 月次 / 観測 / ダッシュボード）
- 週次：過去7日の保存記事・メモから Markdown 下書きを自動生成
- 月次：過去30日のテーマ・カテゴリ・タグ集計
- 観測：外部トレンドサイトを見た気づきを残す（テンプレ付き）
- ダッシュボード：KPI（累計/30日件数/1日平均）、日次保存数、ストリークカレンダー、カテゴリ別件数、タグ Top10、重要度シェアを SVG で表示
- Markdown コピー / .md ダウンロード対応

### 設定
- 1日の記事表示数（推奨10件）
- 週次レビュー曜日
- 通知の許可申請
- GAS Web App URL の設定
- JSON バックアップ / CSV エクスポート / 復元
- サンプルデータ読み込み
- 自動テスト実行

---

## ファイル構成

```
insight-intake/
├── index.html              # 骨格のみ。中身は JS で描画
├── manifest.webmanifest    # PWA メタ
├── service-worker.js       # オフライン対応（Cache First + Network First）
├── icons/
│   └── icon.svg            # アプリアイコン（SVG）
├── gas/
│   ├── Code.gs             # GASスクリプト本体（doPost / doGet / RSSプロキシ）
│   └── SETUP.md            # GASデプロイ手順書
├── styles/
│   ├── base.css            # CSS 変数 / リセット / 基本タイポ
│   ├── layout.css          # ヘッダ / メイン / ボトムナビ
│   ├── components.css      # btn / card / pill / modal / toast など
│   └── views.css           # 記事カード / 設定行 / 画面専用パーツ
└── js/
    ├── app.js              # エントリーポイント / SW 登録
    ├── config.js           # 定数・ルールの一元管理
    ├── utils.js            # 純粋ユーティリティ
    ├── store.js            # localStorage 永続化
    ├── classifier.js       # 自動カテゴリ / タグ / 重要度
    ├── streak.js           # 三日坊主防止ロジック
    ├── articles.js         # 記事 CRUD / Today 抽出
    ├── memos.js            # 気づきメモ CRUD
    ├── reviews.js          # 週次 / 月次レビュー生成
    ├── exporter.js         # CSV / JSON / Markdown 出力
    ├── sync.js             # GAS 同期
    ├── ui.js               # View 層（DOM 描画 / ルーティング / モーダル）
    ├── samples.js          # サンプル記事の投入
    ├── share-handler.js    # Share Target API / shortcuts のクエリ処理
    ├── dashboard.js        # SVG可視化 (KPI/日次/カテゴリ/タグ/カレンダー)
    ├── rss.js              # RSS/Atom 取得・パース (GAS/CORSプロキシ切替)
    ├── feeds.js            # フィードCRUD・取得実行・articles投入
    └── tests.js            # 自動テスト
```

---

## データ管理

### ローカル保存

すべてのデータはブラウザの `localStorage` の単一キー (`insight_intake_v1`) に JSON で保存されます。同じブラウザの同じ端末で動くアプリ間でしか共有されません。

### バックアップとリストア

設定画面の「📦 JSONバックアップ」で全データを書き出し、「📥 JSON復元」で読み戻せます。端末を変える場合や定期バックアップに利用してください。

### Google スプレッドシート連携（任意）

設定画面の「GASコードを表示」のコードをスプレッドシートに紐づけた Google Apps Script に貼り付け、Web App としてデプロイし、出力された URL を「GAS Web App URL」欄に入力します。以降、記事・メモ・レビュー保存時に自動で追記されます。

- URL が空ならローカル完結。GAS が落ちてもアプリは動作する設計
- 失敗は同期状況画面のログに残り、「🔁 失敗分を再送信」で復旧可能

### CSV エクスポート

設定画面「📄 記事CSV」から articles シート相当の CSV を書き出せます。Excel / Numbers / Google スプレッドシートに直接読み込めます。

---

## 開発・テスト

### モジュール構成

ES Modules + ライブラリ依存ゼロ。ビルド不要。CSS は 4 ファイル、JS は 14 ファイルに役割分割されています。

### 自動テスト

主要ロジック（utils, classifier, articles, memos, reviews, exporter, streak）を 42 件カバー。

- **ブラウザから**: 設定画面の「🧪 自動テストを実行」
- **Node から**: `cd insight-intake && node ./run-tests.mjs`（Node 18 以上推奨）

```bash
# 簡易テストランナー（同梱されていない場合は以下の内容で作成）
cat > run-tests.mjs <<'EOF'
import { __runSelfTests } from "./js/tests.js";
const r = __runSelfTests();
console.log("\n=== SUMMARY ===");
console.log(r.summary);
process.exit(r.fail === 0 ? 0 : 1);
EOF
node ./run-tests.mjs
```

### 設定をいじる

`js/config.js` の以下を編集すれば挙動が変わります。

- `DEFAULT_CATEGORIES`: 初期カテゴリ
- `DEFAULT_TAGS`: 初期タグ
- `KEYWORD_RULES`: 自動カテゴリ / タグ判定ルール
- `IMPORTANT_KEYWORDS`: 重要度ブースト対象キーワード
- `TREND_LINKS`: 外部トレンドサイトのリンク集
- `INITIAL_WATCH_KEYWORDS`: Google Alerts 用キーワード
- `TODAY_LIMIT`: 「今日見る」の最大表示件数（既定 10）
- `FREEZE_MAX`, `FREEZE_GRANT_INTERVAL_DAYS`: お休み券の上限と補充間隔

### 同期 API のレコードスキーマ

`js/articles.js` 等で生成されるレコードのスキーマは、要件定義書のシート定義（articles / insight_memos / weekly_reviews / monthly_reviews / trend_observations / sync_logs）に準拠しています。

---

## 注意事項

- 本アプリは MVP（Must スコープ）の実装です。RSS 取得・AI 要約・AI 示唆生成は将来追加（要件 13.3 Could）
- AI を入れる場合は要件 9.3 / 9.4 のプロンプトを利用してください
- 重要判断の前は元記事を必ず確認してください（自動分類は誤る可能性があります）
- 著作権上の理由から、記事本文のスクレイピングは行いません（要件 5.3 / 13.4 Won't）
- 通知はブラウザのフォアグラウンドのみで動作します。バックグラウンド通知は PWA インストール後の OS 仕様に依存します
- 古いブラウザではモジュールが動かないことがあります（Chrome / Safari / Edge / Firefox の現行版を推奨）

---

## 共有シートで保存する（Web Share Target API）

スマホで PWA をインストール後、ブラウザの「共有」ボタンを押すと、共有先候補に「時流ログ」が出現します。選ぶとアプリが起動し、URL・タイトル・テキストが入力済みの状態で保存モーダルが開きます。ひと言メモを足して「保存する」を押せば完了。所要 5〜10 秒。

iOS Safari / Android Chrome の標準仕様に対応。共有メニューに出ない場合は、一度 PWA を「ホーム画面に追加」してから再試行してください。

## アプリアイコン長押しメニュー（Manifest Shortcuts）

ホーム画面のアプリアイコンを長押しすると、以下のショートカットメニューが出ます。

- URL保存
- メモを書く
- 振り返り
- ダッシュボード

それぞれ対応する画面・モーダルが直接起動します。Android Chrome / Edge / 一部のデスクトップで対応。iOS は OS 側がショートカット表示に対応していないことがありますが、PWA は通常通り起動できます。

---

## RSS 自分で登録

設定画面の「RSSフィード管理」から、任意のRSS/Atom URLを追加できます。

1. 「＋ 新しいRSSを追加」を開き、表示名・URL・カテゴリを入力 → 追加
2. 「📡 全フィードを取得」、または同期画面の「📡 RSS一括取得」で取得実行
3. 各フィード行で「📡」を押すと個別取得、「✅/⏸」で有効/無効切替

### CORS の壁と回避

ブラウザから直接他ドメインのRSSを fetch するとブロックされることが多いため、本アプリは以下の順でフォールバックします。

1. **GAS優先**: 設定画面の GAS Web App URL がある場合、GAS の `doGet(?fetch=URL)` 経由で取得
2. **公開CORSプロキシ**: 既定で `api.allorigins.win` を使用。設定でURL差し替え／OFF可能
3. **直接取得**: 上記がOFFのとき試行（成功するフィードは少数）

プライバシー / 安定性を重視するなら、GAS を設定して GAS 経由に統一するのが推奨です。

## マルチ端末同期

GAS Web App URL を設定済みなら、複数の端末で同じデータを共有できます。

- **書き込み**: 記事・メモ・レビュー保存時に自動でスプレッドシートへ追記
- **読み込み**: 設定または同期画面の「☁️ クラウドからプル」で全シートを取得
- **マージ**: 同一IDの行は `updated_at` が新しい方を勝たせる（Last-Write-Wins）
- **自動プル**: 設定で「起動時に自動プル」をONにするとアプリ起動時に自動取得

### GAS のセットアップ

詳細な手順は [`gas/SETUP.md`](./gas/SETUP.md) を参照してください（所要 5〜10分）。要約：

1. Googleスプレッドシートを新規作成
2. 拡張機能 → Apps Script を開く
3. [`gas/Code.gs`](./gas/Code.gs) の中身を貼り付けて保存
4. デプロイ → 新しいデプロイ → ウェブアプリ（アクセス: 全員 / 実行: 自分）
5. 発行されたURLを設定画面の「GAS Web App URL」に貼り付け

doPost（書き込み）に加え、doGet（シート取得 / RSSプロキシ）を1スクリプトで提供します。

---

## バージョン

v1.3.0（Stratum Design System v2026.1 のUI/UX原則を反映：タップ領域44px / フォーカス可視化 / prefers-reduced-motion / 日本語組版palt / モーション・スペース・zインデックスのトークン化。色とレイアウトは現状維持。iPhone PWA 上部問題は status-bar-style="default" + body padding-top:safe-area の二重防御で解決）

v1.2.1（GAS Code.gs / SETUP.md 独立ファイル化、iPhone Dynamic Island / 時計被り対応）

v1.2（第2弾拡張：RSS自登録 / マルチ端末同期 / GAS doGet）

v1.1（第1弾拡張：Share Target / Shortcuts / ダッシュボード）

v1.0 は MVP（要件定義書 Must + Should 実装相当）。

要件定義書 `情報収集ツール_要件定義書.md` の Must スコープ（13.1）+ Should スコープ（13.2）のうち実装可能なもの + 三日坊主防止強化の独自機能を含みます。
