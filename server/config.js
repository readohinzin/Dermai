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

const POLLING = {
  intervalMs: 2000,
  maxAttempts: 25,
  totalTimeoutMs: 50000       // reste sous maxDuration (60 s, voir vercel.json)
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

module.exports = { analysisQuota, QUOTA_DEFAULTS, isDemoMode, publicSupabase, isAnalysisEnabled, isDebugRawEnabled, PERFECT_CORP_BASE_URL, PERFECT_CORP_PATHS, PERFECT_CORP_SKIN_ACTIONS, IMAGE, POLLING };
