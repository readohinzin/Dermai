'use strict';
/* Page d'administration du fondateur : LECTURES Perfect Corp seulement (solde d'unités, coûts officiels). Deux GET, jamais de POST, jamais de tâche : aucune unité n'est dépensée par ce module.
   Contrat (source : scripts officiels du dépôt YouCam-API/skills, instantané du 2026-09-01, lus HORS dépôt DERMAI ; le README officiel les décrit « gratuits » ; la documentation en ligne n'a PAS pu être
   consultée) :
     solde   GET /s2s/v1.0/client/credit             → { results: [ { type, amount, … } ] } ; les unités dépensables sont les lots dont `type` commence par « Api » (convention du code officiel)
     coûts   GET /s2s/v2.0/credit/feature-cost       → { result: { skus: [ { description, amount, unit, proc_unit, run_task_url } ], next_token } } ; pagination page_size + starting_token
   Rien n'est complété : un champ absent ou invalide reste `null` et s'affiche « indisponible », jamais zéro. La forme de la réponse de l'HISTORIQUE (/s2s/v1.0/client/credit/history) n'est PAS connue :
   il n'est pas appelé, aucune consommation historique n'est calculée. La clé reste côté serveur ; rien de la réponse brute n'est renvoyé au navigateur (seulement des champs nettoyés). */
const { AnalysisError } = require('./errors');
const pc = require('./perfectcorp');
const { call, readJson, authHeaders, requireKey } = pc.shared;

const PATHS = { balance: '/s2s/v1.0/client/credit', featureCost: '/s2s/v2.0/credit/feature-cost' };
const SPENDABLE_PREFIX = 'Api';
const PAGE_SIZE = 20, MAX_PAGES = 10;
const clip = (v, n) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f<>]/g, ' ').trim().slice(0, n) : '');
const num = v => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const bad = (what, detail) => new AnalysisError('SERVICE_UNAVAILABLE', { status: 502, detail: `${what} : ${detail}` });

/* Solde : catégories (type → somme des montants du même type, comme le code officiel) et total des unités dépensables. Les catégories ne sont JAMAIS additionnées entre elles, sauf
   l'ensemble « Api » annoncé comme tel, avec sa source. `results` doit être une liste (même vide : aucun lot) ; sinon la forme est inconnue → erreur. */
async function getBalance(opts = {}) {
  const env = pc.makeEnv(opts);
  requireKey(env);
  const json = await call(env, 'status', env.baseUrl + PATHS.balance, { method: 'GET', headers: authHeaders(env) }, readJson);
  const list = json && json.results;
  if (!Array.isArray(list)) throw bad('solde', 'liste « results » absente ou de forme inconnue');
  const byType = new Map();
  for (const b of list) {
    if (!b || typeof b !== 'object' || Array.isArray(b)) continue;
    const type = clip(b.type, 60), amount = num(b.amount);
    if (!type || amount === null) continue;
    byType.set(type, (byType.get(type) || 0) + amount);
  }
  const categories = [...byType.entries()].map(([type, amount]) => ({ type, amount, spendable: type.startsWith(SPENDABLE_PREFIX) }));
  const spendableCats = categories.filter(c => c.spendable);
  return { categories, spendable: spendableCats.length ? spendableCats.reduce((n, c) => n + c.amount, 0) : null, rawCount: list.length };
}

/* Coûts officiels : toutes les pages (plafond MAX_PAGES), champs nettoyés. `slug` = fin du chemin /task/<fonction> (même règle que le code officiel), jamais l'URL complète. */
const slugFrom = u => { if (typeof u !== 'string' || !u.includes('/task/')) return null; const s = u.replace(/\/+$/, '').split('/task/').pop().toLowerCase(); return /^[a-z0-9][a-z0-9/_-]{0,59}$/.test(s) ? s : null; };
async function getFeatureCosts(opts = {}) {
  const env = pc.makeEnv(opts);
  requireKey(env);
  const skus = [];
  let token = null, pages = 0, truncated = false;
  do {
    const qs = `?page_size=${PAGE_SIZE}` + (token ? '&starting_token=' + encodeURIComponent(token) : '');
    const json = await call(env, 'status', env.baseUrl + PATHS.featureCost + qs, { method: 'GET', headers: authHeaders(env) }, readJson);
    const res = json && json.result;
    if (!res || typeof res !== 'object' || !Array.isArray(res.skus)) throw bad('coûts', 'liste « result.skus » absente ou de forme inconnue');
    pages++;
    for (const s of res.skus) {
      if (!s || typeof s !== 'object' || Array.isArray(s)) continue;
      skus.push({ description: clip(s.description, 160) || null, amount: num(s.amount), unit: clip(s.unit, 40) || null, procUnit: clip(s.proc_unit, 40) || null, slug: slugFrom(s.run_task_url) });
    }
    token = typeof res.next_token === 'string' && /^[A-Za-z0-9_.:+=/-]{1,300}$/.test(res.next_token) ? res.next_token : null;
    if (token && pages >= MAX_PAGES) { truncated = true; token = null; }
  } while (token);
  return { skus, pages, truncated };
}

module.exports = { getBalance, getFeatureCosts, PATHS, SPENDABLE_PREFIX, slugFrom };
