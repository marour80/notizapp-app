/* NotizApp Service Worker – App-Shell offline verfügbar machen. */
const CACHE = 'notizapp-v3';
const ASSETS = [
  '.',
  'index.html',
  'styles.css',
  'renderer.js',
  'core/config.js',
  'core/i18n.js',
  'core/model.js',
  'core/device.js',
  'core/supabase.js',
  'core/native.js',
  'core/store.js',
  'vendor/supabase.js',
  'vendor/qrcode.js',
  'manifest.webmanifest',
  'icons/icon.svg',
  'icons/icon-192.png',
  'icons/icon-512.png'
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  // Nur die eigene App-Shell. Supabase-API (andere Domain) immer live übers Netz.
  if (url.origin !== location.origin) return;
  // Netzwerk zuerst: online stets frisch (Updates erscheinen sofort),
  // offline → aus dem Cache. So gibt es keine veralteten Versionen.
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy)).catch(() => {});
        return res;
      })
      .catch(() => caches.match(e.request).then((hit) => hit || caches.match('index.html')))
  );
});
