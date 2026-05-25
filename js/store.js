/* store.js
 * 役割: localStorage(またはNodeのモック)に状態を永続化するシングルトン
 * - 全データを単一キーのJSONで管理
 * - DOM非依存 (Node環境ではglobalThis.localStorageをモックすればテスト可)
 */

import {
  STORAGE_KEY, DEFAULT_CATEGORIES, DEFAULT_TAGS, INITIAL_WATCH_KEYWORDS
} from "./config.js";
import { uid, dateOnly } from "./utils.js";

/** ブラウザならlocalStorage、それ以外はインメモリのフォールバック */
function getStorage() {
  if (typeof globalThis !== "undefined" && globalThis.localStorage) return globalThis.localStorage;
  // Nodeテスト用 簡易モック
  if (!getStorage._mem) {
    const mem = {};
    getStorage._mem = {
      getItem: (k) => (k in mem ? mem[k] : null),
      setItem: (k, v) => { mem[k] = String(v); },
      removeItem: (k) => { delete mem[k]; }
    };
  }
  return getStorage._mem;
}

export const Store = {
  state: null,

  initial() {
    return {
      version: 1,
      articles: [],
      memos: [],
      weekly_reviews: [],
      monthly_reviews: [],
      trend_observations: [],
      feeds: [],
      sync_logs: [],
      categories: DEFAULT_CATEGORIES.map((n, i) => ({
        category_id: uid("cat"),
        category_name: n,
        display_order: i,
        enabled: true
      })),
      tags: DEFAULT_TAGS.map((n) => ({
        tag_id: uid("tag"),
        tag_name: n,
        tag_type: "system",
        enabled: true
      })),
      keywords: INITIAL_WATCH_KEYWORDS.map((w) => ({ keyword: w, importance: "high" })),
      settings: {
        daily_article_limit: 10,
        weekly_review_day: 0,
        sync_mode: "manual",
        gas_url: "",
        ai_enabled: false,
        notifications_enabled: false,
        // 第2弾: マルチ端末同期 / RSS
        auto_pull_on_startup: false,
        cors_proxy_enabled: true,
        cors_proxy_url: "",
        // 第3弾: テーマ
        theme: "auto"
      },
      streak: {
        current: 0,
        longest: 0,
        total_active_days: 0,
        last_active_date: "",
        freeze_tokens: 1,
        freeze_last_grant: dateOnly(),
        history: []
      },
      sample_loaded: false
    };
  },

  load() {
    try {
      const raw = getStorage().getItem(STORAGE_KEY);
      this.state = raw ? JSON.parse(raw) : null;
    } catch (e) {
      console.error("Store.load failed:", e);
      this.state = null;
    }
    if (!this.state) this.state = this.initial();
    this.migrate();
    return this.state;
  },

  save() {
    try {
      getStorage().setItem(STORAGE_KEY, JSON.stringify(this.state));
    } catch (e) {
      console.error("Store.save failed:", e);
      // 上位レイヤがtoast表示する
    }
  },

  reset() {
    this.state = this.initial();
    this.save();
  },

  /** 将来のスキーマ変更時に差分を埋めるためのプレースホルダ */
  migrate() {
    if (typeof this.state.version !== "number") this.state.version = 1;
    // 必要なフィールド欠落を補完
    const defaults = this.initial();
    for (const k of Object.keys(defaults)) {
      if (this.state[k] === undefined) this.state[k] = defaults[k];
    }
    // settings ネストの欠落補完 (将来追加分含む)
    for (const k of Object.keys(defaults.settings)) {
      if (this.state.settings[k] === undefined) this.state.settings[k] = defaults.settings[k];
    }
  }
};
