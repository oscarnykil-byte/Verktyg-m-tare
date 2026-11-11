// Gör att appen fungerar utan internet: alla filer sparas på enheten vid första besöket.
const CACHE = 'matverktyg-v4';
const FILES = [
  './',
  'index.html',
  'manifest.webmanifest',
  'css/app.css',
  'data/default-template.json',
  'icons/icon.svg',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'js/app.js',
  'js/db.js',
  'js/export.js',
  'js/fields.js',
  'js/photos.js',
  'js/quick.js',
  'js/summary.js',
  'js/template.js',
  'js/util.js',
  'js/views/common.js',
  'js/views/home.js',
  'js/views/room.js',
  'js/views/template-editor.js',
  'js/views/visit.js',
  'vendor/xlsx.mini.min.js',
  'vendor/jspdf.umd.min.js',
  'vendor/jspdf.plugin.autotable.min.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()));
});

async function fromNetwork(request, timeoutMs) {
  const ctrl = new AbortController();
  const timer = timeoutMs && setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(request, { signal: ctrl.signal, cache: 'no-cache' });
    if (res.ok) (await caches.open(CACHE)).put(request, res.clone());
    return res;
  } finally {
    clearTimeout(timer);
  }
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET' || new URL(request.url).origin !== location.origin) return;

  // Mallen hämtas helst färsk så att ändringar når säljarna direkt, men vänta inte länge vid dålig täckning.
  if (request.url.endsWith('default-template.json')) {
    event.respondWith(fromNetwork(request, 3000).catch(() => caches.match(request)));
    return;
  }

  // Övrigt: svara direkt från enheten och uppdatera i bakgrunden till nästa start.
  event.respondWith((async () => {
    const cached = await caches.match(request, { ignoreSearch: true });
    const fresh = fromNetwork(request).catch(() => null);
    if (cached) { event.waitUntil(fresh); return cached; }
    return (await fresh) || Response.error();
  })());
});
