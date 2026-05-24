/* service-worker.js
 * 役割: アプリの静的アセットをキャッシュし、オフライン起動と高速化を実現
 * 戦略: install時にプリキャッシュ → fetch時は Cache First (HTML系は Network First)
 * バージョンを更新するとクライアントが新しいSWに更新される
 */

const CACHE_VERSION = "insight-intake-v1.0.0";
const PRECACHE_ASSETS = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./icons/icon.svg",

  "./styles/base.css",
  "./styles/layout.css",
  "./styles/components.css",
  "./styles/views.css",

  "./js/app.js",
  "./js/config.js",
  "./js/utils.js",
  "./js/store.js",
  "./js/classifier.js",
  "./js/streak.js",
  "./js/articles.js",
  "./js/memos.js",
  "./js/reviews.js",
  "./js/exporter.js",
  "./js/sync.js",
  "./js/ui.js",
  "./js/samples.js",
  "./js/tests.js"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) => cache.addAll(PRECACHE_ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;

  // GAS等の外部APIはネットワークのみ (キャッシュしない)
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // HTMLは Network First (常に最新を試す → 失敗ならキャッシュ)
  if (req.mode === "navigate" || (req.destination === "document")) {
    event.respondWith(
      fetch(req).then((res) => {
        const copy = res.clone();
        caches.open(CACHE_VERSION).then((c) => c.put(req, copy));
        return res;
      }).catch(() => caches.match(req).then((cached) => cached || caches.match("./index.html")))
    );
    return;
  }

  // その他 (CSS/JS/画像) は Cache First
  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;
      return fetch(req).then((res) => {
        if (res.ok && res.type === "basic") {
          const copy = res.clone();
          caches.open(CACHE_VERSION).then((c) => c.put(req, copy));
        }
        return res;
      }).catch(() => cached);
    })
  );
});

self.addEventListener("message", (event) => {
  if (event.data === "SKIP_WAITING") self.skipWaiting();
});
