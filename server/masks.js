'use strict';
/* Localisation réelle des indicateurs : masques renvoyés par Perfect Corp (mask_urls), et rien d'autre.

   Perfect Corp renvoie, pour chaque métrique de data.results.output, un tableau `mask_urls` d'URL (temporaires, hébergées chez le
   fournisseur). Ce module :
     1. lit ces URL uniquement sur les 15 métriques connues (js/skin-model.js, METRICS), dans l'ordre et sans les fusionner ;
     2. télécharge chaque masque CÔTÉ SERVEUR (sans la clé API : ce sont des URL présignées), avec des limites strictes ;
     3. le renvoie au navigateur sous forme de data URL (l'URL d'origine ne quitte jamais le serveur).

   Aucune zone n'est jamais calculée ici : pas de score, pas de priorité, pas de type de peau, pas de règle anatomique.
   Pas de masque exploitable pour une métrique → la métrique est absente du résultat (le navigateur ne dessine rien).
   Un échec de téléchargement n'empêche jamais l'analyse : la localisation est un complément facultatif.
   Rien n'est stocké : le résultat ne part que dans la réponse de l'analyse en cours. */
const skinModel = require('../js/skin-model.js');

const LIMITS = {
  maxPerMetric: 4,                 // plusieurs masques par métrique : conservés (dans la limite)
  maxBytesEach: 1.5 * 1024 * 1024,
  maxBytesTotal: 2.6 * 1024 * 1024, // la réponse d'une fonction Vercel est limitée à ~4,5 Mo (base64 ≈ ×1,34)
  timeoutMs: 5000                  // délai unique : tous les masques sont téléchargés en parallèle
};
const api = { fetchImpl: (...a) => globalThis.fetch(...a) };

/* URL acceptable : https, sans identifiants, sans hôte local ou IP privée (le serveur ne doit jamais être détourné vers son réseau). */
function safeUrl(u) {
  if (typeof u !== 'string' || u.length > 4096) return null;
  let p;try { p = new URL(u); } catch (e) { return null; }
  if (p.protocol !== 'https:' || p.username || p.password || (p.port && p.port !== '443')) return null;
  const h = p.hostname.toLowerCase();
  if (h === 'localhost' || h.endsWith('.local') || h.endsWith('.internal')) return null;
  if (/^\d+\.\d+\.\d+\.\d+$/.test(h) || h.includes(':')) return null;          // IP littérale (v4 ou v6) : refusée
  return p.toString();
}

/* Références de masques par clé DERMAI, telles que renvoyées (ordre conservé). Aucune autre source. */
function maskRefs(envelope) {
  const out = envelope && envelope.data && envelope.data.results && envelope.data.results.output;
  if (!Array.isArray(out)) return [];
  const pcToKey = new Map(skinModel.METRICS);
  const refs = [];
  for (const el of out) {
    if (!el || typeof el !== 'object' || !pcToKey.has(el.type) || !Array.isArray(el.mask_urls)) continue;
    const urls = el.mask_urls.map(safeUrl).filter(Boolean).slice(0, LIMITS.maxPerMetric);
    if (urls.length) refs.push({ key: pcToKey.get(el.type), urls });
  }
  return refs;
}

/* Type réel d'après les octets (jamais d'après l'URL ou l'en-tête seul). */
function sniff(buf) {
  if (buf.length > 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'image/png';
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.length > 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  return null;
}

async function download(url, budget) {
  const ctl = new AbortController();const timer = setTimeout(() => ctl.abort(), LIMITS.timeoutMs);
  try {
    const res = await api.fetchImpl(url, { method: 'GET', redirect: 'follow', signal: ctl.signal });   // aucune clé API, aucun jeton
    if (!res || !res.ok) return null;
    if (res.url && !safeUrl(res.url)) return null;                                                    // redirection hors https : refusée
    const declared = Number(res.headers && res.headers.get && res.headers.get('content-length'));
    if (Number.isFinite(declared) && declared > Math.min(LIMITS.maxBytesEach, budget.left)) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (!buf.length || buf.length > LIMITS.maxBytesEach || buf.length > budget.left) return null;
    const mime = sniff(buf);if (!mime) return null;
    budget.left -= buf.length;
    return `data:${mime};base64,${buf.toString('base64')}`;
  } catch (e) {
    return null;
  } finally { clearTimeout(timer); }
}

/* { <clé DERMAI>: [dataURL, …] } ; seules les métriques avec au moins un masque téléchargé et reconnu y figurent.
   stats : nombres seulement, pour les logs (jamais d'URL). */
async function collect(envelope) {
  const refs = maskRefs(envelope);
  const budget = { left: LIMITS.maxBytesTotal };
  const stats = { metrics: refs.length, listed: refs.reduce((s, r) => s + r.urls.length, 0), kept: 0 };
  // tout en parallèle : la durée totale reste bornée par un seul délai (timeoutMs), l'ordre des masques est conservé
  const results = await Promise.all(refs.map(async r => [r.key, (await Promise.all(r.urls.map(u => download(u, budget)))).filter(Boolean)]));
  const localization = {};
  for (const [k, list] of results) if (list.length) { localization[k] = list; stats.kept += list.length; }
  return { localization, stats };
}

module.exports = { collect, maskRefs, safeUrl, sniff, LIMITS, api };
