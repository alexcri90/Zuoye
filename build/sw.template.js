/* Service worker di Zuòyè: rende l'app utilizzabile offline.
 * Gestisce solo richieste GET verso la propria origine; le chiamate all'API
 * del modello linguistico non passano mai dalla cache. */
const VERSION = '__VERSION__';
const SHELL = '__SHELL__';
const SHELL_CACHE = `zuoye-shell-${VERSION}`;
const DATA_CACHE = 'zuoye-data-v1';

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) => cache.addAll(SHELL))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((k) => k.startsWith('zuoye-shell-') && k !== SHELL_CACHE)
            .map((k) => caches.delete(k)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

async function cacheFirst(cacheName, request) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(request);
  if (hit) return hit;
  const response = await fetch(request);
  if (response.ok) cache.put(request, response.clone());
  return response;
}

async function networkFirst(request) {
  const cache = await caches.open(SHELL_CACHE);
  try {
    const response = await fetch(request);
    if (response.ok) cache.put('./', response.clone());
    return response;
  } catch {
    const hit = await cache.match('./');
    if (hit) return hit;
    throw new Error('offline');
  }
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith(networkFirst(request));
    return;
  }
  const scope = new URL(self.registration.scope).pathname;
  const rel = url.pathname.startsWith(scope) ? url.pathname.slice(scope.length) : url.pathname;
  if (rel.startsWith('hanzi/') || rel.startsWith('pdfjs/') || /(^|\/)assets\/pdf/.test(rel)) {
    event.respondWith(cacheFirst(DATA_CACHE, request));
    return;
  }
  if (rel.startsWith('assets/')) {
    event.respondWith(cacheFirst(SHELL_CACHE, request));
  }
});
