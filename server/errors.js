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
  METHOD_NOT_ALLOWED: 'Requête non autorisée.',
  NOT_IMPLEMENTED: 'Le service d\'analyse est momentanément indisponible.',
  UNKNOWN: 'Nous n\'avons pas pu analyser cette photo. Veuillez réessayer.'
};

/* Le mapping des codes Perfect Corp sera complété à l'étape 3, à partir des codes documentés. */
function toUserMessage(code) {
  return MESSAGES[code] || MESSAGES.UNKNOWN;
}

module.exports = { AnalysisError, toUserMessage, MESSAGES };
