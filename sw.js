// Работа без сети. Код лежит в кэше своей версии целиком и подменяется только целиком:
// tools/deploy.py ставит в VERSION хэш файлов, новый service worker скачивает всё заново и удаляет старую версию.
// Иначе старые и новые файлы смешиваются, и модули не сходятся (белый экран).
// Фото в отдельном кэше, они не меняются и не перекачиваются при каждом обновлении.
const VERSION = 'f9013d1f49';
const CODE = `treni-${VERSION}`;
const IMG = 'treni-img'; // так же в app.js
const FILES = ['./', 'index.html', 'style.css', 'boot.js', 'app.js', 'core.js', 'catalog.js', 'manifest.webmanifest', 'icon-180.png', 'icon-512.png'];

self.addEventListener('install', e => e.waitUntil(
  caches.open(CODE).then(c => c.addAll(FILES.map(f => new Request(f, { cache: 'reload' })))).then(() => self.skipWaiting()),
));

self.addEventListener('activate', e => e.waitUntil(
  caches.keys().then(ks => Promise.all(ks.filter(k => k !== CODE && k !== IMG).map(k => caches.delete(k)))).then(() => self.clients.claim()),
));

self.addEventListener('fetch', e => {
  // Чужие адреса (GitHub API) не трогаем: только свой код и фото
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== location.origin) return;
  if (new URL(e.request.url).pathname.includes('/img/')) {
    e.respondWith(caches.open(IMG).then(async c => {
      const hit = await c.match(e.request);
      if (hit) return hit;
      const r = await fetch(e.request);
      if (r.ok) e.waitUntil(c.put(e.request, r.clone()));
      return r;
    }));
    return;
  }
  e.respondWith(caches.open(CODE).then(c => c.match(e.request, { ignoreSearch: true })).then(hit => hit || fetch(e.request)));
});
