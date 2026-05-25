/* app.js
 * 役割: アプリのエントリーポイント
 * - Store初期化
 * - ボトムナビ・ヘッダのイベント登録
 * - Service Worker登録 (PWA)
 * - 初回起動時のサンプル提案
 */

import { Store } from "./store.js";
import { route, renderStreakChip, toast, openAddArticleModal, openAddMemoModal } from "./ui.js";
import { handleStartupQuery } from "./share-handler.js";
import { pullAll } from "./sync.js";

function bootstrap() {
  Store.load();
  renderStreakChip();
  route("home");

  // ボトムナビ
  document.querySelectorAll("nav.bottom-nav button").forEach((b) => {
    b.addEventListener("click", () => route(b.dataset.route));
  });

  // ヘッダの設定ボタン
  const settingsBtn = document.getElementById("openSettings");
  if (settingsBtn) settingsBtn.addEventListener("click", () => route("settings"));

  // Share Target / shortcuts のクエリ処理 (初回描画後に発火)
  handleStartupQuery({ openAddArticleModal, openAddMemoModal, route });

  // 初回案内
  if (Store.state.articles.length === 0 && !Store.state.sample_loaded) {
    setTimeout(() => toast("『サンプルを読み込む』で操作感を試せます"), 600);
  }

  // 起動時の自動プル (マルチ端末同期)
  if (Store.state.settings.auto_pull_on_startup && Store.state.settings.gas_url) {
    setTimeout(async () => {
      const r = await pullAll();
      if (r.added + r.updated > 0) toast(`☁️ 自動プル: +${r.added} 更新${r.updated}`);
    }, 1200);
  }

  registerServiceWorker();
}

/** Service Worker登録 (HTTPS or localhost必須) */
function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  // file:// では動かないので明示的にスキップ
  if (location.protocol === "file:") {
    console.info("[SW] file:// では Service Worker は使えません。http(s) で開いてください。");
    return;
  }
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("./service-worker.js", { scope: "./" })
      .then((reg) => {
        console.info("[SW] registered:", reg.scope);
        // 更新検知
        reg.addEventListener("updatefound", () => {
          const newSW = reg.installing;
          if (newSW) newSW.addEventListener("statechange", () => {
            if (newSW.state === "installed" && navigator.serviceWorker.controller) {
              toast("新バージョンが利用可能です。再読み込みで反映");
            }
          });
        });
      })
      .catch((err) => console.warn("[SW] registration failed:", err));
  });
}

window.addEventListener("DOMContentLoaded", bootstrap);
