/*
 * Service worker de ProTerr.
 *
 * La app tiene que abrir sin señal, así que el shell se precachea al instalar y
 * todo lo demás usa "stale-while-revalidate": se sirve la copia local al
 * instante y se refresca en segundo plano cuando hay red.
 *
 * Los datos de terreno NO pasan por aquí: viven en IndexedDB.
 */
const CACHE = 'proterr-v1';
const SHELL = ['./', './index.html', './manifest.webmanifest', './icon.svg'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;

  event.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const cached = await cache.match(request);
      const network = fetch(request)
        .then((response) => {
          if (response.ok) cache.put(request, response.clone());
          return response;
        })
        .catch(() => cached ?? cache.match('./index.html'));
      return cached ?? network;
    }),
  );
});
