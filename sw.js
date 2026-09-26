const CACHE_NAME = 'vfl-v7';
const ASSETS_TO_CACHE = [
  '/',
  '/index.html',
  '/script.js',
  'https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&display=swap'
];

// Install event - cache essential assets
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('Service Worker: Caching app shell');
      return cache.addAll(ASSETS_TO_CACHE).catch((err) => {
        console.log('Cache addAll error:', err);
      });
    })
  );
  self.skipWaiting();
});

// Activate event - clean up old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME) {
            console.log('Service Worker: Deleting old cache', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
  self.clients.claim();
});

// Fetch event - network first, fallback to cache
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET requests
  if (request.method !== 'GET') {
    return;
  }

  // Cache-first strategy for static assets
  if (url.pathname.endsWith('.js') || 
      url.pathname.endsWith('.css') || 
      url.pathname.endsWith('.woff2') ||
      url.pathname.endsWith('.ttf')) {
    event.respondWith(
      caches.match(request).then((response) => {
        return response || fetch(request).then((response) => {
          if (response.ok) {
            const cache = caches.open(CACHE_NAME);
            cache.then((c) => c.put(request, response.clone()));
          }
          return response;
        });
      }).catch(() => {
        return caches.match(request);
      })
    );
    return;
  }

  // Network-first strategy for API and dynamic content
  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response.ok) {
          const cache = caches.open(CACHE_NAME);
          cache.then((c) => c.put(request, response.clone()));
        }
        return response;
      })
      .catch(() => {
        return caches.match(request).then((response) => {
          return response || new Response('Offline - Content not available', {
            status: 503,
            statusText: 'Service Unavailable',
            headers: new Headers({
              'Content-Type': 'text/plain'
            })
          });
        });
      })
  );
});

// Message handler for cache updates
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
