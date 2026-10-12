'use strict';
/* Page d'administration PRIVÉE du fondateur : lecture seule. GET uniquement, par section (?section=access|features|quotas|credit|costs).
   Accès : session Supabase vérifiée (même mécanisme que les autres fonctions) PUIS identifiant du compte dans la liste fermée DERMAI_ADMIN_USER_IDS (« * » refusé, liste invalide refusée en entier).
   TOUT refus (jeton absent ou invalide, Supabase injoignable, compte non listé, liste absente) renvoie la MÊME réponse 404, sans aucun contenu : la route n'existe pas pour qui n'est pas autorisé.
   Seul un fondateur authentifié peut obtenir un 405 (méthode autre que GET). Aucune écriture, aucun paramètre ne désigne un utilisateur, aucune donnée individuelle, aucun secret : seulement la
   configuration serveur (modes et nombres, jamais d'identifiants), les quotas configurés, et deux LECTURES gratuites chez Perfect Corp (solde, coûts officiels).
   Réponses jamais mises en cache par un intermédiaire (private, no-store, Vary: Authorization). Les lectures fournisseur sont mémorisées EN MÉMOIRE du serveur (solde 60 s, coûts 10 min, erreurs 15 s)
   pour ne pas solliciter Perfect Corp à chaque affichage : cette mémoire n'est lue qu'APRÈS le contrôle d'accès. */
const auth = require('../server/auth');
const { AnalysisError, toUserMessage } = require('../server/errors');
const { isAdminAllowed } = require('../server/config');
const admin = require('../server/admin');
const billing = require('../server/perfectcorp-billing');
const perfectcorp = require('../server/perfectcorp');
const { createBudget } = require('../server/budget');

const SECTIONS = ['access', 'features', 'quotas', 'credit', 'costs'];
const TTL = { credit: 60 * 1000, costs: 10 * 60 * 1000, error: 15 * 1000 };
const memo = new Map();
const BUDGET_MS = 20000;

function headers(res) {
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('Vary', 'Authorization');
  res.setHeader('X-Robots-Tag', 'noindex');
}
function notFound(res) {
  headers(res);
  res.statusCode = 404;
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.end('Not found');
}
function send(res, status, body) {
  headers(res);
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(body));
}
/* Cause d'indisponibilité d'une lecture fournisseur : un code court, jamais le détail ni la réponse brute. */
function reasonOf(err) {
  if (!(err instanceof AnalysisError)) return 'unavailable';
  if (err.code === 'TIME_BUDGET') return 'timeout';
  const d = String(err.detail || '');
  if (/forme inconnue/.test(d)) return 'malformed';
  if (/HTTP \d+/.test(d)) return 'provider_error';
  if (/réseau/.test(d)) return 'network';
  return 'unavailable';
}
async function remembered(key, load) {
  const hit = memo.get(key);
  if (hit && Date.now() - hit.at < (hit.error ? TTL.error : TTL[key])) return Object.assign({}, hit.value, { cached: true });
  let value, error = false;
  try { value = Object.assign({ status: 'ok' }, await load(), { fetchedAt: new Date().toISOString() }); }
  catch (err) { error = true; value = { status: 'unavailable', reason: reasonOf(err), fetchedAt: new Date().toISOString() }; console.warn('[DERMAI] Admin read failed:', key, reasonOf(err)); }
  memo.set(key, { at: Date.now(), value, error });
  return Object.assign({}, value, { cached: false });
}

async function section(name) {
  const now = new Date().toISOString();
  if (name === 'access') return { ok: true, admin: true };
  if (name === 'features') return { ok: true, generatedAt: now, source: 'configuration lue par le serveur à chaque requête', features: admin.featureRows() };
  if (name === 'quotas') return { ok: true, generatedAt: now, source: 'configuration lue par le serveur à chaque requête', quotas: admin.quotaRows() };
  if (!perfectcorp.isConfigured()) return { ok: true, [name]: { status: 'unavailable', reason: 'key_missing', fetchedAt: now } };
  if (name === 'credit') return { ok: true, credit: await remembered('credit', () => billing.getBalance({ budget: createBudget({ totalMs: BUDGET_MS }) })) };
  return { ok: true, costs: await remembered('costs', async () => {
    const r = await billing.getFeatureCosts({ budget: createBudget({ totalMs: BUDGET_MS }) });
    return Object.assign({ total: r.skus.length, pages: r.pages, truncated: r.truncated }, admin.matchCosts(r.skus));
  }) };
}

async function handler(req, res) {
  const budget = createBudget({ totalMs: BUDGET_MS });
  let user;
  try { user = await auth.verifyUser(req, process.env, { budget }); }
  catch (err) { console.warn('[DERMAI] Admin refused:', err instanceof AnalysisError ? err.code : 'auth'); return notFound(res); }
  if (!isAdminAllowed(user.id)) { console.warn('[DERMAI] Admin refused: not allowed'); return notFound(res); }
  if (req.method !== 'GET') { res.setHeader('Allow', 'GET'); return send(res, 405, { ok: false, error: toUserMessage('METHOD_NOT_ALLOWED') }); }
  let names;
  try { names = new URL(req.url || '', 'http://x').searchParams.getAll('section'); } catch (e) { names = []; }
  if (names.length !== 1 || !SECTIONS.includes(names[0])) return send(res, 400, { ok: false, error: 'Section inconnue.' });
  try { return send(res, 200, await section(names[0])); }
  catch (err) { console.error('[DERMAI] Admin failed:', err instanceof AnalysisError ? err.code : 'unknown'); return send(res, 500, { ok: false, error: toUserMessage('UNKNOWN') }); }
}

module.exports = handler;
module.exports._memo = memo;
module.exports._reasonOf = reasonOf;
