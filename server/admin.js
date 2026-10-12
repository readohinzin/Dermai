'use strict';
/* Page d'administration du fondateur (lecture seule) : constructions PURES, sans réseau, des blocs « fonctionnalités » et « quotas », et rapprochement des coûts officiels.
   Rien n'est inventé : chaque ligne vient de la configuration réellement lue par le serveur (variables d'environnement, valeurs par défaut du code, registre des fonctions capillaires).
   Jamais renvoyés : identifiants d'utilisateurs autorisés (seulement un MODE et un NOMBRE), clé API, valeurs brutes des variables. */
const config = require('./config');
const hair = require('./hair');

const KEY_OK = env => !!String(env.PERFECT_CORP_API_KEY || '').trim();
const SUPABASE_OK = env => !!config.publicSupabase(env);

/* Mode d'autorisation d'une liste d'utilisateurs (makeup, simulation, cheveux) : déduit du comportement réel de isXAllowed (« * » ouvre à tout compte connecté). */
function listMode(set) {
  if (set.has('*')) return { mode: 'all', label: 'Tous les utilisateurs', count: null };
  const n = [...set].filter(x => x !== '*').length;
  return n ? { mode: 'list', label: 'Liste restreinte', count: n } : { mode: 'none', label: 'Personne', count: 0 };
}

/* Prérequis techniques VÉRIFIABLES (configuration seulement). La fonction SQL de quota n'est PAS vérifiable sans réserver un crédit : elle est toujours signalée « non vérifiable ». */
function prerequisites(env, sqlFunction) {
  return [
    { id: 'perfectcorp_key', label: 'Clé Perfect Corp configurée', state: KEY_OK(env) ? 'ok' : 'missing' },
    { id: 'supabase', label: 'Comptes (Supabase) configurés', state: SUPABASE_OK(env) ? 'ok' : 'missing' },
    { id: 'sql', label: `Fonction SQL ${sqlFunction}`, state: 'unverifiable' }
  ];
}
/* État : closed (activation absente), blocked (activation présente mais prérequis ou liste manquant), configured (tout ce qui est vérifiable est en place). Jamais « disponible » : non vérifié. */
function stateOf(enabled, mode, prereqs) {
  if (!enabled) return 'closed';
  if (mode.mode === 'none' || prereqs.some(p => p.state === 'missing')) return 'blocked';
  return 'configured';
}

function featureRows(env = process.env) {
  const rows = [];
  const analysisPre = prerequisites(env, 'reserve_analysis');
  const analysisMode = { mode: 'signed_in', label: 'Tous les comptes connectés', count: null };
  rows.push({ id: 'analysis', name: 'Analyse cutanée', enabled: config.isAnalysisEnabled(env), enabledSource: 'DERMAI_ANALYSIS_ENABLED', authorization: analysisMode,
    prerequisites: analysisPre, state: stateOf(config.isAnalysisEnabled(env), analysisMode, analysisPre), note: 'Aucune liste d\'utilisateurs : tout compte connecté peut analyser, dans la limite de son quota.' });
  const lists = [
    ['simulation', 'Simulation cosmétique', config.isSimulationEnabled(env), 'DERMAI_SIMULATION_ENABLED', config.simulationAllowList(env), 'DERMAI_SIMULATION_ALLOWED_USER_IDS', 'reserve_simulation'],
    ['makeup', 'Maquillage (Studio Beauté)', config.isMakeupEnabled(env), 'DERMAI_MAKEUP_ENABLED', config.makeupAllowList(env), 'DERMAI_MAKEUP_ALLOWED_USER_IDS', 'reserve_makeup']
  ];
  for (const [id, name, enabled, src, set, listSrc, fn] of lists) {
    const mode = listMode(set), pre = prerequisites(env, fn);
    rows.push({ id, name, enabled, enabledSource: src, authorization: mode, authorizationSource: listSrc, prerequisites: pre, state: stateOf(enabled, mode, pre) });
  }
  /* Cheveux : un verrou et une liste communs, puis une ligne par fonction connue du registre, avec la raison d'une fermeture. */
  const hairEnabled = config.isHairEnabled(env), hairMode = listMode(config.hairAllowList(env)), hairPre = prerequisites(env, 'reserve_hair');
  const open = new Map(hair.activeFeatures(env).map(f => [f.id, f]));
  for (const id of hair.IDS) {
    const f = hair.FEATURES[id], active = open.get(id);
    const reason = active ? null : (!f.pathConfirmed && !config.isHairUnconfirmedAllowed(env) ? 'chemin REST non confirmé (DERMAI_HAIR_ALLOW_UNCONFIRMED absent)' : 'exclue par DERMAI_HAIR_FEATURES');
    const state = !active ? 'closed' : stateOf(hairEnabled, hairMode, hairPre);
    rows.push({ id: 'hair.' + id, name: `Cheveux : ${f.label}`, enabled: hairEnabled && !!active, enabledSource: 'DERMAI_HAIR_ENABLED', authorization: hairMode, authorizationSource: 'DERMAI_HAIR_ALLOWED_USER_IDS',
      prerequisites: hairPre, state, units: f.units, pathConfirmed: !!(active ? active.pathConfirmed : f.pathConfirmed), closedReason: reason });
  }
  return rows;
}

/* Origine d'une valeur de quota : « variable » si la variable est présente et valide (même règle que config.intIn), « défaut » si absente, « invalide » si présente mais ignorée. */
function sourceOf(env, name, min, max) {
  const raw = env[name];
  if (raw === undefined || String(raw).trim() === '') return 'default';
  const s = String(raw).trim();
  return /^\d+$/.test(s) && Number(s) >= min && Number(s) <= max ? 'variable' : 'invalid';
}
const SRC_LABEL = { variable: 'variable d\'environnement', default: 'valeur par défaut du code', invalid: 'variable invalide ignorée : valeur par défaut du code' };
function quotaRows(env = process.env) {
  const mk = (id, name, unit, q, limitVar, hoursVar, lim, def, note) => ({ id, name, unit, limit: q.limit, windowHours: q.windowSeconds / 3600,
    limitSource: SRC_LABEL[sourceOf(env, limitVar, lim[0], lim[1])], limitVariable: limitVar, windowSource: SRC_LABEL[sourceOf(env, hoursVar, 1, 8760)], windowVariable: hoursVar, defaults: def, note: note || null });
  return [
    mk('analysis', 'Analyse cutanée', 'analyses', config.analysisQuota(env), 'DERMAI_MAX_ANALYSES_PER_PERIOD', 'DERMAI_ANALYSIS_PERIOD_HOURS', [0, 1000], config.QUOTA_DEFAULTS && { limit: config.QUOTA_DEFAULTS.limit, hours: config.QUOTA_DEFAULTS.hours }),
    mk('simulation', 'Simulation cosmétique', 'simulations', config.simulationQuota(env), 'DERMAI_MAX_SIMULATIONS_PER_PERIOD', 'DERMAI_SIMULATION_PERIOD_HOURS', [0, 100], { limit: config.SIM_QUOTA_DEFAULTS.limit, hours: config.SIM_QUOTA_DEFAULTS.hours }),
    mk('makeup', 'Maquillage', 'essayages', config.makeupQuota(env), 'DERMAI_MAX_MAKEUP_PER_PERIOD', 'DERMAI_MAKEUP_PERIOD_HOURS', [0, 100], { limit: config.MAKEUP_QUOTA_DEFAULTS.limit, hours: config.MAKEUP_QUOTA_DEFAULTS.hours }),
    mk('hair', 'Cheveux (coiffure, couleur, extensions, franges, boucles, volume)', 'unités', config.hairQuota(env), 'DERMAI_MAX_HAIR_UNITS_PER_PERIOD', 'DERMAI_HAIR_PERIOD_HOURS', [0, 100], { limit: config.HAIR_QUOTA_DEFAULTS.units, hours: config.HAIR_QUOTA_DEFAULTS.hours },
      'Quota compté en unités Perfect Corp documentées, pas en nombre d\'essais : ' + hair.IDS.map(i => `${hair.FEATURES[i].label} ${hair.FEATURES[i].units}`).join(', ') + '.')
  ];
}

/* Identifiants techniques (derniers segments de chemin /task/<fonction>) que DERMAI appelle réellement, par catégorie. Sert UNIQUEMENT à rapprocher un coût officiel d'une fonction réelle. */
const slugOf = p => { const m = /\/task\/([a-z0-9-]+)\/?$/i.exec(String(p || '')); return m ? m[1].toLowerCase() : null; };
function dermaiSlugs() {
  const out = new Map();
  const add = (slug, cat, note) => { if (slug && !out.has(slug)) out.set(slug, { category: cat, note: note || null }); };
  add(slugOf(config.PERFECT_CORP_PATHS.skinTask), 'Analyse cutanée');
  add(slugOf(config.SIM_PATHS.task), 'Simulation', 'chemin appelé par DERMAI non confirmé par la documentation');
  add(slugOf(config.MAKEUP_PATHS.task), 'Maquillage');
  for (const id of hair.IDS) add(slugOf(hair.FEATURES[id].taskPath), 'Coiffure et couleur de cheveux', hair.FEATURES[id].pathConfirmed ? null : 'chemin appelé par DERMAI non confirmé');
  return out;
}
const CATEGORIES = ['Analyse cutanée', 'Simulation', 'Maquillage', 'Coiffure et couleur de cheveux'];
/* Rapprochement EXACT par identifiant technique : jamais par ressemblance de nom. Un coût sans correspondance est « non rapproché ». Aucun coût unique n'est attribué à une catégorie. */
function matchCosts(skus) {
  const map = dermaiSlugs(), groups = CATEGORIES.map(c => ({ category: c, items: [] })), unmatched = [];
  for (const s of skus) {
    const hit = s.slug && map.get(s.slug);
    if (hit) groups.find(g => g.category === hit.category).items.push(Object.assign({}, s, { matchNote: hit.note }));
    else unmatched.push(s);
  }
  return { groups, unmatched, expected: CATEGORIES.map(c => ({ category: c, slugs: [...map.entries()].filter(([, v]) => v.category === c).map(([k]) => k) })) };
}

module.exports = { listMode, prerequisites, stateOf, featureRows, quotaRows, sourceOf, slugOf, dermaiSlugs, matchCosts, CATEGORIES };
