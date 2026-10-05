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

module.exports = { PERFECT_CORP_BASE_URL, PERFECT_CORP_PATHS, PERFECT_CORP_SKIN_ACTIONS, IMAGE, POLLING };
