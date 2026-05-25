/* theme.js
 * 役割: ライト / ダーク / 自動 のテーマ管理
 *  - settings.theme: "light" | "dark" | "auto"
 *  - "auto" は prefers-color-scheme に追従
 *  - 設定変更時は即時反映、OS変更時もリスナーで追従
 *  - <html data-theme="..."> 属性を切り替えるだけ。CSS は base.css の [data-theme="light"] で対応
 */

import { Store } from "./store.js";

let mqlListener = null;

/** 現在の theme 設定を適用 ("light"|"dark"|"auto") */
export function applyTheme(theme) {
  const html = (typeof document !== "undefined") ? document.documentElement : null;
  if (!html) return;
  const resolved = resolveTheme(theme);
  html.setAttribute("data-theme", resolved);
  // theme-color メタも切り替え（PWAステータスバー色）
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", resolved === "light" ? "#fafaf9" : "#0f172a");
}

/** "auto" を OS設定で解決して "light" or "dark" を返す。純粋関数化のためにテスト可能 */
export function resolveTheme(theme, matchMediaImpl) {
  if (theme === "light" || theme === "dark") return theme;
  // auto / 未設定
  const mm = matchMediaImpl
    || (typeof window !== "undefined" && window.matchMedia
        ? window.matchMedia.bind(window)
        : null);
  if (!mm) return "dark"; // フォールバック
  return mm("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

/** Storeに保存して即時反映 */
export function setTheme(theme) {
  if (!["light", "dark", "auto"].includes(theme)) theme = "auto";
  Store.state.settings.theme = theme;
  Store.save();
  applyTheme(theme);
  rebindMediaListener();
}

/** OS変更を検知するリスナー (auto時のみ動作) */
export function rebindMediaListener() {
  if (typeof window === "undefined" || !window.matchMedia) return;
  const mql = window.matchMedia("(prefers-color-scheme: light)");
  // 既存リスナーを外す
  if (mqlListener) {
    try { mql.removeEventListener("change", mqlListener); } catch (_e) { /* old browsers */ }
  }
  mqlListener = () => {
    if (Store.state.settings.theme === "auto") applyTheme("auto");
  };
  try {
    mql.addEventListener("change", mqlListener);
  } catch (_e) {
    // 古いSafari fallback
    mql.addListener(mqlListener);
  }
}

/** 起動時に呼ぶ初期化 */
export function initTheme() {
  const theme = Store.state?.settings?.theme || "auto";
  applyTheme(theme);
  rebindMediaListener();
}
