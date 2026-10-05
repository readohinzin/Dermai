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
  ANALYSIS_DISABLED: 'L\'analyse n\'est pas disponible pour le moment.',
  METHOD_NOT_ALLOWED: 'Requête non autorisée.',
  NOT_IMPLEMENTED: 'Le service d\'analyse est momentanément indisponible.',
  UNKNOWN: 'Nous n\'avons pas pu analyser cette photo. Veuillez réessayer.'
};

/* Le mapping des codes Perfect Corp sera complété à l'étape 3, à partir des codes documentés. */
function toUserMessage(code) {
  return MESSAGES[code] || MESSAGES.UNKNOWN;
}

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

module.exports = { AnalysisError, toUserMessage, fromPerfectCorpError, MESSAGES };
