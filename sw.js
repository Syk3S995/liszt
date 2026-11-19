// App shell cache: stale-while-revalidate. API- és Google-kéréseket nem cache-eljük.
// (Verzióemelést a CACHE név átírásával – szerkesztővel, ne PowerShell Get/Set-Content-tel, mert az elrontja az ékezeteket.)
const CACHE = 'liszt-v34';
const SHELL = ['./', 'index.html', 'style.css', 'app.js', 'store.js', 'sync.js', 'realtime.js', 'backend.js', 'icons.js', 'theme.js',
  'logic.js', 'config.js', 'manifest.webmanifest', 'icons/logo.svg', 'icons/icon-192.png','icons/icon-512.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin) return;
  if (url.pathname.endsWith('/api') || url.pathname.includes('/api/')) return;
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const cached = await cache.match(req, { ignoreSearch: true });
    const net = fetch(req).then((res) => {
      if (res.ok) cache.put(req, res.clone());
      return res;
    }).catch(() => null);
    if (cached) { net.catch(() => {}); return cached; }
    return (await net) || (req.mode === 'navigate' ? cache.match('index.html') : Response.error());
  })());
});
