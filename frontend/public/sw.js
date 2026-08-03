/* Safar PWA service worker — offline shell yang aman.
 * Prinsip: JANGAN pernah cache API (/v1) atau upload. Navigasi = network-first
 * (selalu segar saat online, update shell tercache). Aset ber-hash = cache-first. */
const CACHE = 'safar-shell-v2';

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  // Jangan sentuh API, upload, atau autentikasi — selalu jaringan langsung.
  if (url.pathname.startsWith('/v1') || url.pathname.startsWith('/uploads')) return;

  // Navigasi SPA: network-first; simpan index.html terbaru untuk fallback offline.
  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE);
      try {
        const net = await fetch(req);
        cache.put('/', net.clone());
        return net;
      } catch {
        return (await cache.match('/')) || Response.error();
      }
    })());
    return;
  }

  // Aset statik ber-hash & ikon/manifest: cache-first (isi cache saat pertama online).
  if (url.pathname.startsWith('/assets/') || url.pathname.startsWith('/icons/') || url.pathname.endsWith('.webmanifest')) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE);
      const cached = await cache.match(req);
      if (cached) return cached;
      try {
        const net = await fetch(req);
        if (net.ok) cache.put(req, net.clone());
        return net;
      } catch {
        return cached || Response.error();
      }
    })());
  }
});
