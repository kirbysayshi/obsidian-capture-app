const CACHE = 'obsidian-capture-v1';

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  event.respondWith(async function () {
    try {
      const response = await fetch(event.request);
      if (response.ok) {
        const cache = await caches.open(CACHE);
        cache.put(event.request, response.clone());
      }
      return response;
    } catch {
      return caches.match(event.request);
    }
  }());
});
