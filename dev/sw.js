/* Countryside Ledger — service worker
   App shell is precached so the ledger opens in the aisles with no signal.
   Bump VERSION on every deploy to roll the cache.

   Cache storage is shared across the WHOLE origin, not per folder — so the live
   app and the /dev/ copy would otherwise delete each other's caches on every
   activate, and opening dev on the phone would strip the live app's offline
   ability in the aisles. Each one therefore namespaces its caches and only ever
   cleans up its own. The two prefixes are deliberately not prefixes of each
   other. This file is byte-identical in both places. */
const IN_DEV = /\/dev\//.test(self.registration.scope);
const PREFIX = IN_DEV ? 'csl-dev-' : 'csl-live-';
const VERSION = PREFIX + 'v27';
const RUNTIME = VERSION + '-runtime';
const LEGACY = 'countryside-ledger-';   // pre-split naming; only live clears it
const SHELL = [
  './',
  './index.html',
  './search.js',
  './manifest.webmanifest',
  './data/catalog.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/maskable-512.png',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  const mine = k => k.startsWith(PREFIX) || (!IN_DEV && k.startsWith(LEGACY));
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => mine(k) && k !== VERSION && k !== RUNTIME).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;

  // Navigations: try the network for freshness, fall back to the cached shell offline.
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req)
        .then(res => {
          const copy = res.clone();
          caches.open(VERSION).then(c => c.put('./index.html', copy));
          return res;
        })
        .catch(() => caches.match('./index.html'))
    );
    return;
  }

  // The dev copy takes its own files from the NETWORK first. Cache-first is
  // right for the live app in the aisles, but in dev it means an edit to
  // search.js or the catalog changes nothing until VERSION is bumped — the page
  // reloads while the engine behind it stays stale. Cache is still written, so
  // dev keeps working offline; it just stops lying about what it is running.
  if (IN_DEV && new URL(req.url).origin === self.location.origin) {
    e.respondWith(
      fetch(req).then(res => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(RUNTIME).then(c => c.put(req, copy));
        }
        return res;
      }).catch(() => caches.match(req))
    );
    return;
  }

  // Everything else (icons, manifest, Google Fonts): cache-first, fill the runtime cache on miss.
  e.respondWith(
    caches.match(req).then(hit => hit || fetch(req).then(res => {
      if (res.ok || res.type === 'opaque') {
        const copy = res.clone();
        caches.open(RUNTIME).then(c => c.put(req, copy));
      }
      return res;
    }).catch(() => hit))
  );
});
