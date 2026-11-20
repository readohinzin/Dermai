/* DermAI : service worker. Rôle : rendre l'application INSTALLABLE (iPhone, Android) et ouvrir une page claire hors ligne. Il ne garde JAMAIS de données de personne.
   - Jamais interceptés : méthodes autres que GET, tout /api/ (analyse, comptes, quotas), tout autre domaine (Supabase, polices), sw.js lui-même.
   - Pages et scripts (HTML, JS, CSS, JSON) : RÉSEAU d'abord, copie gardée seulement pour le hors ligne : un déploiement est vu tout de suite, jamais une version périmée.
   - Images, polices locales : copie d'abord, rafraîchie en arrière-plan.
   - Navigation hors ligne : dernière page d'accueil gardée, sinon /offline.html.
   Changer VERSION à chaque changement de ce fichier : les anciens caches sont supprimés à l'activation. */
const VERSION = 'dermai-v2';
const SHELL = VERSION + '-shell';
const RUNTIME = VERSION + '-runtime';
const PRECACHE = ['/offline.html', '/manifest.json', '/img/icons/icon-192.png', '/img/icons/icon-512.png'];
const MAX_RUNTIME_ENTRIES = 120;

self.addEventListener('install', event => {
  event.waitUntil(caches.open(SHELL).then(cache => cache.addAll(PRECACHE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith('dermai-') && k !== SHELL && k !== RUNTIME).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

const isStatic = url => /\.(?:png|jpe?g|webp|gif|svg|ico|woff2?|ttf)$/i.test(url.pathname);

async function trim(cache) {
  const keys = await cache.keys();
  for (let i = 0; i < keys.length - MAX_RUNTIME_ENTRIES; i++) await cache.delete(keys[i]);
}
async function remember(request, response) {
  if (!response || response.status !== 200 || response.type !== 'basic') return;
  const cache = await caches.open(RUNTIME);
  await cache.put(request, response.clone());
  await trim(cache);
}

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/') || url.pathname === '/sw.js') return;

  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).then(response => { if (url.pathname === '/' || url.pathname === '/index.html') remember(new Request('/'), response.clone()); return response; })
      .catch(async () => (await caches.match('/')) || (await caches.match('/offline.html')) || new Response('Hors ligne', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } })));
    return;
  }
  if (isStatic(url)) {
    event.respondWith(caches.match(request).then(hit => {
      const fresh = fetch(request).then(response => { remember(request, response.clone()); return response; });
      if (hit) { fresh.catch(() => {}); return hit; }
      return fresh;
    }).catch(() => caches.match(request)));
    return;
  }
  event.respondWith(fetch(request).then(response => { remember(request, response.clone()); return response; }).catch(async () => (await caches.match(request)) || new Response('', { status: 504 })));
});
