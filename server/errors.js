'use strict';
/* Traduction des erreurs internes en messages destinés au consommateur.
   Les détails Perfect Corp restent dans les logs serveur, jamais dans la réponse. */

class AnalysisError extends Error {
  constructor(code, { status = 500, cause = null, detail = null } = {}) {
    super(code);
    this.code = code;
    this.status = status;
    this.cause = cause;
    this.detail = detail;      // diagnostic serveur uniquement
  }
}

const MESSAGES = {
  NO_IMAGE: 'Aucune photo reçue. Veuillez réessayer.',
  BAD_MIME: 'Format de photo non pris en charge. Utilisez une photo JPEG.',
  TOO_LARGE: 'La photo est trop volumineuse. Veuillez en choisir une plus légère.',
  INVALID_IMAGE: 'Impossible d\'analyser cette photo.',
  NO_FACE: 'Aucun visage exploitable n\'a été détecté.',
  FACE_TOO_SMALL: 'Veuillez vous rapprocher légèrement de la caméra.',
  BAD_LIGHTING: 'La lumière est insuffisante. Placez-vous dans un endroit mieux éclairé.',
  FACE_ANGLE: 'Veuillez vous placer face à la caméra.',
  SERVICE_UNAVAILABLE: 'Le service d\'analyse est momentanément indisponible.',
  TASK_ERROR: 'L\'analyse n\'a pas pu être terminée.',
  TIMEOUT: 'L\'analyse prend trop de temps. Veuillez réessayer.',
  UPLOAD_INTERRUPTED: 'L\'envoi de la photo a été interrompu. Veuillez réessayer.',
  TIME_BUDGET: 'L\'analyse prend plus de temps que prévu et n\'a pas pu être terminée. Réessayez dans quelques minutes.',
  ANALYSIS_DISABLED: 'L\'analyse n\'est pas disponible pour le moment.',
  AUTH_REQUIRED: 'Connectez-vous pour analyser votre peau.',
  QUOTA_EXCEEDED: 'Vous avez atteint le nombre d\'analyses disponibles pour le moment. Réessayez plus tard.',
  QUOTA_UNAVAILABLE: 'L\'analyse n\'est pas disponible pour le moment. Réessayez plus tard.',
  AUTH_UNAVAILABLE: 'Impossible de vérifier votre connexion pour le moment. Réessayez.',
  RESULT_NOT_FOUND: 'L\'analyse n\'a pas pu être terminée.',
  RESULT_INVALID: 'L\'analyse n\'a pas pu être terminée.',
  RESULT_AMBIGUOUS: 'L\'analyse n\'a pas pu être terminée.',
  SIM_DISABLED: 'La simulation n\'est pas disponible pour le moment.',
  SIM_INVALID_CONCERN: 'Choisissez l\'une des zones proposées.',
  SIM_QUOTA_EXCEEDED: 'Le nombre de simulations disponibles est atteint pour le moment. Réessayez plus tard.',
  SIM_QUOTA_UNAVAILABLE: 'La simulation n\'est pas disponible pour le moment. Réessayez plus tard.',
  SIM_RESULT_INVALID: 'La simulation n\'a pas pu être terminée.',
  SIM_TIMEOUT: 'La simulation prend plus de temps que prévu et n\'a pas pu être terminée. Réessayez dans quelques minutes.',
  SIM_AUTH_REQUIRED: 'Connectez-vous pour utiliser la simulation.',
  SIM_INVALID_IMAGE: 'Cette photo ne peut pas être utilisée pour la simulation.',
  SIM_UNAVAILABLE: 'La simulation n\'est pas disponible pour le moment. Réessayez plus tard.',
  MK_DISABLED: 'Le Studio Beauté n\'est pas disponible pour le moment.',
  MK_INVALID_REQUEST: 'Ces réglages de maquillage ne sont pas valides. Modifiez votre sélection et réessayez.',
  MK_INVALID_IMAGE: 'Cette photo ne peut pas être utilisée. Choisissez une photo de face, bien éclairée, JPEG ou PNG, de moins de 10 Mo.',
  MK_QUOTA_EXCEEDED: 'Le nombre d\'essayages disponibles est atteint pour le moment. Réessayez plus tard.',
  MK_QUOTA_UNAVAILABLE: 'Le Studio Beauté n\'est pas disponible pour le moment. Réessayez plus tard.',
  MK_RESULT_INVALID: 'L\'essayage n\'a pas pu être terminé.',
  MK_TASK_ERROR: 'L\'essayage n\'a pas pu être terminé. Essayez une autre photo.',
  MK_TIMEOUT: 'L\'essayage prend plus de temps que prévu et n\'a pas pu être terminé. Réessayez dans quelques minutes.',
  MK_AUTH_REQUIRED: 'Connectez-vous pour utiliser le Studio Beauté.',
  MK_UNAVAILABLE: 'Le Studio Beauté n\'est pas disponible pour le moment. Réessayez plus tard.',
  MK_PROVIDER_CREDIT: 'Le Studio Beauté n\'est pas disponible pour le moment. Réessayez plus tard.',
  HR_DISABLED: 'Les essais capillaires ne sont pas disponibles pour le moment.',
  HR_INVALID_REQUEST: 'Ces réglages ne sont pas valides. Modifiez votre sélection et réessayez.',
  HR_INVALID_IMAGE: 'Cette photo ne peut pas être utilisée. Choisissez une photo de face, bien éclairée, avec les cheveux et les épaules visibles.',
  HR_QUOTA_EXCEEDED: 'Le nombre d\'essais capillaires disponibles est atteint pour le moment. Réessayez plus tard.',
  HR_QUOTA_UNAVAILABLE: 'Les essais capillaires ne sont pas disponibles pour le moment. Réessayez plus tard.',
  HR_RESULT_INVALID: 'L\'essai n\'a pas pu être terminé.',
  HR_TASK_ERROR: 'L\'essai n\'a pas pu être terminé. Essayez une autre photo.',
  HR_TIMEOUT: 'L\'essai prend plus de temps que prévu et n\'a pas pu être terminé. Réessayez dans quelques minutes.',
  HR_AUTH_REQUIRED: 'Connectez-vous pour utiliser les essais capillaires.',
  HR_UNAVAILABLE: 'Les essais capillaires ne sont pas disponibles pour le moment. Réessayez plus tard.',
  HR_PROVIDER_CREDIT: 'Les essais capillaires ne sont pas disponibles pour le moment. Réessayez plus tard.',
  HR_TEMPLATES_UNAVAILABLE: 'Les modèles ne sont pas disponibles pour le moment. Réessayez plus tard.',
  METHOD_NOT_ALLOWED: 'Requête non autorisée.',
  NOT_IMPLEMENTED: 'Le service d\'analyse est momentanément indisponible.',
  UNKNOWN: 'Nous n\'avons pas pu analyser cette photo. Veuillez réessayer.'
};

/* Le mapping des codes Perfect Corp sera complété à l'étape 3, à partir des codes documentés. */
function toUserMessage(code) {
  return MESSAGES[code] || MESSAGES.UNKNOWN;
}

/* Messages de la simulation : les codes génériques (fournisseur, délais, session) sont reformulés pour ne jamais parler d'« analyse ». */
const SIM_REWRITE = { AUTH_REQUIRED: 'SIM_AUTH_REQUIRED', TIMEOUT: 'SIM_TIMEOUT', TIME_BUDGET: 'SIM_TIMEOUT', TASK_ERROR: 'SIM_RESULT_INVALID', SERVICE_UNAVAILABLE: 'SIM_UNAVAILABLE',
  INVALID_IMAGE: 'SIM_INVALID_IMAGE', UNKNOWN: 'SIM_RESULT_INVALID', NOT_IMPLEMENTED: 'SIM_UNAVAILABLE' };
const toSimulationMessage = code => toUserMessage(SIM_REWRITE[code] || code);

/* Messages du Studio Beauté : même principe, aucun message ne parle d'« analyse » ni ne révèle le fournisseur. */
const MK_REWRITE = { AUTH_REQUIRED: 'MK_AUTH_REQUIRED', TIMEOUT: 'MK_TIMEOUT', TIME_BUDGET: 'MK_TIMEOUT', TASK_ERROR: 'MK_TASK_ERROR', SERVICE_UNAVAILABLE: 'MK_UNAVAILABLE',
  INVALID_IMAGE: 'MK_INVALID_IMAGE', UNKNOWN: 'MK_RESULT_INVALID', NOT_IMPLEMENTED: 'MK_UNAVAILABLE', BAD_MIME: 'MK_INVALID_IMAGE', TOO_LARGE: 'MK_INVALID_IMAGE' };
const toMakeupMessage = code => toUserMessage(MK_REWRITE[code] || code);

/* Messages des essais capillaires : même principe (jamais « analyse », jamais le fournisseur). */
const HR_REWRITE = { AUTH_REQUIRED: 'HR_AUTH_REQUIRED', TIMEOUT: 'HR_TIMEOUT', TIME_BUDGET: 'HR_TIMEOUT', TASK_ERROR: 'HR_TASK_ERROR', SERVICE_UNAVAILABLE: 'HR_UNAVAILABLE',
  INVALID_IMAGE: 'HR_INVALID_IMAGE', UNKNOWN: 'HR_RESULT_INVALID', NOT_IMPLEMENTED: 'HR_UNAVAILABLE', BAD_MIME: 'HR_INVALID_IMAGE', TOO_LARGE: 'HR_INVALID_IMAGE' };
const toHairMessage = code => toUserMessage(HR_REWRITE[code] || code);

/* Reconnaissance prudente d'un code d'erreur Perfect Corp dans un texte (corps HTTP ou erreur de tâche).
   Les libellés ci-dessous sont des motifs de repérage, pas une liste officielle : à confirmer avec les
   erreurs réelles. Sans correspondance, l'appelant garde son code générique. */
const PATTERNS = [
  [/no[_ ]?face|face[_ ]?not[_ ]?found/i, 'NO_FACE'],
  [/face[_ ]?too[_ ]?small|too[_ ]?small/i, 'FACE_TOO_SMALL'],
  [/lighting|too[_ ]?dark|illumination/i, 'BAD_LIGHTING'],
  [/angle|pose|not[_ ]?frontal/i, 'FACE_ANGLE'],
  [/invalid[_ ]?api[_ ]?key|unauthorized|forbidden/i, 'SERVICE_UNAVAILABLE']
];
function fromPerfectCorpError(text) {
  const t = String(text || '');
  for (const [re, code] of PATTERNS) if (re.test(t)) return code;
  return null;
}

/* Crédits ou unités épuisés chez le fournisseur : motif de repérage prudent (libellés NON confirmés par un relevé réel), jamais montré au navigateur. */
const CREDIT_PATTERN = /insufficient[_ ]?(credit|unit|balance)|not[_ ]?enough[_ ]?(credit|unit)|out[_ ]?of[_ ]?(credit|unit)|(credit|unit)s?[_ ]?(exhausted|depleted)|exceed(ed)?[_ ]?(quota|limit)/i;
const isProviderCreditError = text => CREDIT_PATTERN.test(String(text || ''));

module.exports = { AnalysisError, toUserMessage, toSimulationMessage, toMakeupMessage, toHairMessage, fromPerfectCorpError, isProviderCreditError, MESSAGES };
