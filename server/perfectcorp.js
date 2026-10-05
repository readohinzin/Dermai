'use strict';
/* Client Perfect Corp : File API v2.0 puis Skin Analysis v2.1.
   Étape 2 : squelette. L'implémentation arrive à l'étape 3. */
const { AnalysisError } = require('./errors');

/* Doit renvoyer le JSON brut du résultat (task_status === "success").
   Flux : POST file → PUT fichier → POST task (src_file_id, format json) → GET statut en boucle bornée. */
async function analyzeSkin(/* { buffer, mime } */) {
  throw new AnalysisError('NOT_IMPLEMENTED', { status: 501 });
}

module.exports = { analyzeSkin };
