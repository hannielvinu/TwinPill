// Offline support: the demo keeps working if the venue Wi-Fi drops.
// Network first (always fresh when online), cache as fallback; the core files are cached on first visit.
const CACHE = "twinpill-v1";
const CORE = ["./", "index.html", "css/style.css", "js/app.js", "js/search.js", "js/phonetic.js", "js/translit.js", "js/i18n.js",
  "js/voice.js", "js/ocr.js", "assets/icon.svg", "data/roots.json", "data/ingredients.json", "data/common_words.json",
  "data/stats.json", "data/atlas.json", "data/ranker.json", "data/metrics.json", "data/live.json",
  "data/p/ad.json", "data/p/ol.json", "data/p/ac.json", "data/p/bi.json", "data/p/do.json", "data/p/ze.json"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => Promise.allSettled(CORE.map((u) => c.add(u)))).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  const same = url.origin === location.origin;
  const font = /fonts\.(googleapis|gstatic)\.com$/.test(url.hostname);
  if (!same && !font) return;
  e.respondWith(
    fetch(req).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
      return res;
    }).catch(() => caches.match(req, { ignoreSearch: true }).then((r) => r || caches.match("index.html")))
  );
});
