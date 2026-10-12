'use strict';
/* Configuration centralisée de l'intégration Perfect Corp. */

const PERFECT_CORP_BASE_URL = 'https://yce-api-01.makeupar.com';

const PERFECT_CORP_PATHS = {
  file: '/s2s/v2.0/file',
  skinTask: '/s2s/v2.1/task/skin-analysis',          // POST : création
  skinTaskStatus: id => `/s2s/v2.1/task/skin-analysis/${encodeURIComponent(id)}` // GET : statut
};

/* Actions SD uniquement. Ne jamais mélanger SD et HD dans une même requête. */
const PERFECT_CORP_SKIN_ACTIONS = [
  'wrinkle', 'acne', 'moisture', 'age_spot', 'radiance', 'redness', 'oiliness', 'pore',
  'texture', 'firmness', 'tear_trough', 'eye_bag', 'dark_circle_v2',
  'droopy_upper_eyelid', 'droopy_lower_eyelid', 'skin_type'
];

const IMAGE = {
  allowedMime: ['image/jpeg'],
  maxBytes: 4 * 1024 * 1024   // la limite de corps d'une fonction Vercel est d'environ 4,5 Mo
};

/* Budget de temps GLOBAL de /api/skin-analysis (voir server/budget.js). Il démarre à l'entrée du handler et couvre toutes les étapes réseau.
   maxDuration vaut 60 s (vercel.json) : 52 s laissent 8 s de marge pour l'envoi de la réponse et les variations de démarrage.
   minStartMs : temps restant minimal pour MENER l'analyse une fois le crédit réservé ; le handler y ajoute le délai maximal de la réservation
   elle-même (quota.TIMEOUT_MS) avant de la tenter. minStepMs : temps restant minimal pour commencer UNE étape réseau du fournisseur.
   minTaskMs : temps restant minimal pour CRÉER la tâche (étape qui engage le crédit chez le fournisseur) = 3 s pour au moins une interrogation
   de statut + 5 s pour la requête de création elle-même (même ordre de grandeur que les délais de session et de quota). minMasksMs : idem
   pour le téléchargement (facultatif) des masques. Valeurs de sécurité PROVISOIRES : elles réduisent le risque de créer une tâche que l'on ne
   pourrait pas suivre, elles ne garantissent pas la réussite (une requête peut toujours échouer ou être interrompue après son émission). */
const TIME_BUDGET = { totalMs: 52000, minStartMs: 15000, minStepMs: 3000, minTaskMs: 8000, minMasksMs: 3000 };

const POLLING = {
  intervalMs: 2000,
  maxAttempts: 25,
  totalTimeoutMs: 50000       // plafond du polling seul ; le budget global (TIME_BUDGET) est la vraie limite de la fonction
};

/* Verrous d'exploitation (variables d'environnement serveur, désactivés par défaut). */
const flag = v => ['1', 'true', 'yes', 'on'].includes(String(v || '').trim().toLowerCase());
/* Sans DERMAI_ANALYSIS_ENABLED, l'endpoint refuse toute analyse : aucun crédit Perfect Corp ne peut être consommé. */
const isAnalysisEnabled = (env = process.env) => flag(env.DERMAI_ANALYSIS_ENABLED);
/* Diagnostic uniquement : renvoie le JSON brut au navigateur. À laisser désactivé en production normale. */
const isDebugRawEnabled = (env = process.env) => flag(env.DERMAI_DEBUG_RAW);

/* Mode démonstration du frontend. Vrai par défaut : seules les valeurs explicites false/0/no/off le désactivent
   (variable absente, vide ou inconnue = démo). Lu à chaque requête de /api/config-js, par environnement Vercel. */
const isDemoMode = (env = process.env) => !['false', '0', 'no', 'off'].includes(String(env.DERMAI_DEMO_MODE || '').trim().toLowerCase());

/* Comptes (Supabase Auth). Seules deux variables PUBLIQUES sont exposées au navigateur : l'URL du projet et la clé « anon ».
   La clé service_role et tout autre secret ne sont jamais lus ici. Sans configuration valide, les comptes sont simplement indisponibles. */
const publicSupabase = (env = process.env) => {
  const url = String(env.SUPABASE_URL || '').trim().replace(/\/+$/, '');
  const anonKey = String(env.SUPABASE_ANON_KEY || '').trim();
  return /^https:\/\/[^/\s]+$/.test(url) && anonKey ? { supabaseUrl: url, supabaseAnonKey: anonKey } : null;
};

/* Quota d'analyses par utilisateur (appliqué par la base, voir supabase/migrations/20261008120000_analysis_quota.sql).
   DERMAI_MAX_ANALYSES_PER_PERIOD : nombre d'analyses autorisées par période (0 = aucune) ; DERMAI_ANALYSIS_PERIOD_HOURS : durée de la période.
   Valeurs techniques de sécurité, modifiables sans toucher au code. Absentes ou invalides : valeurs prudentes par défaut (jamais « illimité »). */
const QUOTA_DEFAULTS = { limit: 3, hours: 24 };
const intIn = (v, min, max, dflt) => { const s = String(v === undefined ? '' : v).trim(); return /^\d+$/.test(s) && Number(s) >= min && Number(s) <= max ? Number(s) : dflt; };
const analysisQuota = (env = process.env) => ({
  limit: intIn(env.DERMAI_MAX_ANALYSES_PER_PERIOD, 0, 1000, QUOTA_DEFAULTS.limit),
  windowSeconds: intIn(env.DERMAI_ANALYSIS_PERIOD_HOURS, 1, 8760, QUOTA_DEFAULTS.hours) * 3600
});

/* ───── Simulation cosmétique avant/après (AI Skin Simulation, Perfect Corp) ─────
   Fonction DISTINCTE de l'analyse : verrou, liste d'utilisateurs autorisés et quota propres. Désactivée par défaut, pour tout le monde.

   Établi (outil « AI-Skin-simulation » du dépôt officiel YouCam-API/beauty-skin-care-MCP, lhm.plugin.json v2.0) : l'entrée est une image
   (src_file_id issu de l'API fichier, ou src_file_url), plus une intensité facultative de 0 à 1 par préoccupation (0 = photo d'origine,
   1 = effet maximal) pour : wrinkle, radiance, oiliness, acne, eye_bags, dark_circle, spots, pores, texture, redness.
   NON CONFIRMÉ (la documentation REST n'était pas joignable depuis l'environnement de développement), à vérifier au premier essai contrôlé :
     - le chemin REST de création et de statut (SIM_PATHS) ;
     - la forme exacte du corps de création (server/perfectcorp-simulation.js, buildTaskBody) ;
     - l'emplacement de l'image résultat dans la réponse (extractResultUrl) ;
     - la durée d'une simulation et son coût en unités. */
const SIM_PATHS = {
  task: '/s2s/v2.0/task/skin-simulation',                                  // NON CONFIRMÉ — POST : création
  taskStatus: id => `/s2s/v2.0/task/skin-simulation/${encodeURIComponent(id)}`   // NON CONFIRMÉ — GET : statut
};
/* Préoccupations proposées : clé DERMAI → paramètre Perfect Corp. `oiliness` est volontairement ABSENT : son intensité AJOUTE de la brillance
   (sens inverse des autres) ; ce ne serait pas une amélioration. Une seule préoccupation par demande. */
const SIM_CONCERNS = {
  wrinkle: 'wrinkle', radiance: 'radiance', acne: 'acne', eye_bags: 'eye_bags', dark_circle: 'dark_circle',
  spots: 'spots', pores: 'pores', texture: 'texture', redness: 'redness'
};
/* Intensité de la simulation (0 = photo d'origine, 1 = effet maximal). Choisie côté serveur, jamais par le navigateur. Le premier essai à 0,5 (zone acné) n'a
   donné aucune différence visible ; le guide du fournisseur (résumé, non lu directement) décrit 0,7 à 1,0 comme l'effet marqué. Défaut 0,8, réglable sans modifier
   le code par DERMAI_SIMULATION_INTENSITY (nombre de 0,1 à 1 ; absent ou invalide : défaut). Valeur provisoire, à ajuster d'après les essais. */
const SIM_INTENSITY = 0.8;
const simulationIntensity = (env = process.env) => {
  const s = String(env.DERMAI_SIMULATION_INTENSITY === undefined ? '' : env.DERMAI_SIMULATION_INTENSITY).trim();
  const n = /^(?:0(?:\.\d{1,2})?|1(?:\.0{1,2})?|\.\d{1,2})$/.test(s) ? Number(s) : NaN;
  return n >= 0.1 && n <= 1 ? n : SIM_INTENSITY;
};

/* Verrou : sans DERMAI_SIMULATION_ENABLED, aucune simulation, aucun crédit. Même activé, seuls les comptes listés dans
   DERMAI_SIMULATION_ALLOWED_USER_IDS (identifiants Supabase séparés par des virgules) peuvent l'utiliser : liste vide = personne ; « * » = tout compte connecté (voir isSimulationAllowed). */
const isSimulationEnabled = (env = process.env) => flag(env.DERMAI_SIMULATION_ENABLED);
const simulationAllowList = (env = process.env) => new Set(String(env.DERMAI_SIMULATION_ALLOWED_USER_IDS || '').split(',').map(s => s.trim()).filter(Boolean));
/* La valeur « * » (seule, écrite explicitement) ouvre la simulation à TOUT compte connecté, vérifié par Supabase : choix délibéré, jamais un défaut.
   Le verrou DERMAI_SIMULATION_ENABLED reste nécessaire, et le quota reste PAR compte. Liste vide ou absente = personne. */
const isSimulationAllowed = (userId, env = process.env) => {
  if (typeof userId !== 'string' || !userId) return false;
  const list = simulationAllowList(env);
  return list.has('*') || list.has(userId);
};
/* Quota propre aux simulations (jamais celui des analyses). Défaut : une simulation par 24 h, jamais « illimité ». */
const SIM_QUOTA_DEFAULTS = { limit: 1, hours: 24 };
const simulationQuota = (env = process.env) => ({
  limit: intIn(env.DERMAI_MAX_SIMULATIONS_PER_PERIOD, 0, 100, SIM_QUOTA_DEFAULTS.limit),
  windowSeconds: intIn(env.DERMAI_SIMULATION_PERIOD_HOURS, 1, 8760, SIM_QUOTA_DEFAULTS.hours) * 3600
});


/* ───── Studio Beauté (AI Makeup Virtual Try-On V1.0, Perfect Corp) ─────
   Fonction DISTINCTE de l'analyse et de la simulation : verrou, liste d'utilisateurs autorisés et quota propres. Fermée par défaut, pour tout le monde.
   Chemins : ceux du contrat annoncé pour AI Makeup Virtual Try-On V1.0 (création POST, statut GET). La documentation officielle n'a PAS pu être ouverte depuis
   l'environnement de développement ; le schéma des effets vient de l'outil « AI-Makeup-Virtual-Try-On » du dépôt officiel YouCam-API/beauty-skin-care-MCP
   (voir server/makeup.js). Aucun appel réel n'a été fait : les éléments non vérifiés sont signalés dans le README (« Studio Beauté »). */
const MAKEUP_PATHS = {
  task: '/s2s/v2.0/task/makeup-vto',                                                    // POST : création
  taskStatus: id => `/s2s/v2.0/task/makeup-vto/${encodeURIComponent(id)}`               // GET : statut
};
/* Verrou : sans DERMAI_MAKEUP_ENABLED, aucun essayage, aucun crédit. Même activé, seuls les comptes listés dans DERMAI_MAKEUP_ALLOWED_USER_IDS (identifiants Supabase
   séparés par des virgules) peuvent l'utiliser : liste vide = personne ; « * » = tout compte connecté (choix explicite, jamais un défaut). */
const isMakeupEnabled = (env = process.env) => flag(env.DERMAI_MAKEUP_ENABLED);
const makeupAllowList = (env = process.env) => new Set(String(env.DERMAI_MAKEUP_ALLOWED_USER_IDS || '').split(',').map(s => s.trim()).filter(Boolean));
const isMakeupAllowed = (userId, env = process.env) => {
  if (typeof userId !== 'string' || !userId) return false;
  const list = makeupAllowList(env);
  return list.has('*') || list.has(userId);
};
/* Quota propre au maquillage (jamais celui des analyses ni des simulations) : réglable sans toucher au code d'affichage. Défaut prudent : 3 essayages par 24 h. */
const MAKEUP_QUOTA_DEFAULTS = { limit: 3, hours: 24 };
const makeupQuota = (env = process.env) => ({
  limit: intIn(env.DERMAI_MAX_MAKEUP_PER_PERIOD, 0, 100, MAKEUP_QUOTA_DEFAULTS.limit),
  windowSeconds: intIn(env.DERMAI_MAKEUP_PERIOD_HOURS, 1, 8760, MAKEUP_QUOTA_DEFAULTS.hours) * 3600
});

/* Studio Beauté, volet CAPILLAIRE (coiffure, couleur, extensions, franges, ondulations, volume) : verrou, liste de comptes et quota PROPRES, distincts du maquillage.
   Fermé par défaut. Le quota est compté en UNITÉS Perfect Corp documentées (coiffure et volume : 2, les autres : 1), pas en nombre de tâches : une coiffure pèse deux fois
   une couleur. DERMAI_HAIR_FEATURES (liste d'identifiants séparés par des virgules) restreint les fonctions ouvertes ; DERMAI_HAIR_ALLOW_UNCONFIRMED=1 ouvre aussi celles dont le
   chemin REST n'est pas confirmé par une source officielle consultée (voir server/hair.js). */
const isHairEnabled = (env = process.env) => flag(env.DERMAI_HAIR_ENABLED);
const hairAllowList = (env = process.env) => new Set(String(env.DERMAI_HAIR_ALLOWED_USER_IDS || '').split(',').map(s => s.trim()).filter(Boolean));
const isHairAllowed = (userId, env = process.env) => {
  if (typeof userId !== 'string' || !userId) return false;
  const list = hairAllowList(env);
  return list.has('*') || list.has(userId);
};
const isHairUnconfirmedAllowed = (env = process.env) => flag(env.DERMAI_HAIR_ALLOW_UNCONFIRMED);
const hairFeatureFilter = (env = process.env) => { const l = String(env.DERMAI_HAIR_FEATURES || '').split(',').map(s => s.trim()).filter(Boolean); return l.length ? new Set(l) : null; };
const HAIR_QUOTA_DEFAULTS = { units: 6, hours: 24 };
const hairQuota = (env = process.env) => ({
  limit: intIn(env.DERMAI_MAX_HAIR_UNITS_PER_PERIOD, 0, 100, HAIR_QUOTA_DEFAULTS.units),
  windowSeconds: intIn(env.DERMAI_HAIR_PERIOD_HOURS, 1, 8760, HAIR_QUOTA_DEFAULTS.hours) * 3600
});

module.exports = {
  analysisQuota, QUOTA_DEFAULTS, isDemoMode, publicSupabase, isAnalysisEnabled, isDebugRawEnabled, PERFECT_CORP_BASE_URL, PERFECT_CORP_PATHS, PERFECT_CORP_SKIN_ACTIONS, IMAGE, POLLING, TIME_BUDGET,
  SIM_PATHS, SIM_CONCERNS, SIM_INTENSITY, simulationIntensity, SIM_QUOTA_DEFAULTS, isSimulationEnabled, simulationAllowList, isSimulationAllowed, simulationQuota,
  MAKEUP_PATHS, MAKEUP_QUOTA_DEFAULTS, isMakeupEnabled, makeupAllowList, isMakeupAllowed, makeupQuota,
  HAIR_QUOTA_DEFAULTS, isHairEnabled, hairAllowList, isHairAllowed, isHairUnconfirmedAllowed, hairFeatureFilter, hairQuota
};
