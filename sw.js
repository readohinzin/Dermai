const CACHE_NAME = 'dermai-cache-v1';
const ASSETS_TO_CACHE = [
  '/',
  '/index.html', // ou '/index' selon comment tu l'appelles
  // Ajoute ici tes fichiers CSS et JS principaux, par exemple :
  '/css/style.css', 
  '/js/main.js'
];

// Installation du Service Worker et mise en cache des fichiers de base
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS_TO_CACHE);
    })
  );
});

// Interception des requêtes
self.addEventListener('fetch', (event) => {
  // 1. On ignore les requêtes Supabase et l'API (on laisse le réseau gérer)
  if (event.request.url.includes('supabase.co') || event.request.url.includes('/api/')) {
    return;
  }

  // 2. Pour le reste (HTML, CSS, JS, images), on utilise le cache en priorité
  event.respondWith(
    caches.match(event.request).then((response) => {
      return response || fetch(event.request);
    })
  );
});
