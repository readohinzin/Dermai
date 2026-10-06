'use strict';
/* DIAGNOSTIC TEMPORAIRE : (1) observer les valeurs réelles des éléments { type: "skin_type" | "all" | "skin_age" }
   de data.results.output. Aucune interprétation : on ne fait qu'afficher ce que Perfect Corp renvoie.

   (2) repetitionLine() : compter les occurrences de chacun des 15 types de métriques connus (voir plus bas).

   Ne journalise QUE des champs scalaires de ces trois éléments : type, score, raw_score, ui_score, skin_type, region.
   Jamais : JSON brut, mask_urls, url, task_id, clé API, ni aucun autre champ. Les textes qui ressemblent à une URL ou qui sont
   trop longs sont masqués.

   À RETIRER après observation : supprimer ce fichier, son require et son appel dans api/skin-analysis.js, et son test
   (« DIAGNOSTIC TEMPORAIRE » dans test/handler.test.js). */

const TYPES = ['skin_type', 'all', 'skin_age'];
const FIELDS = ['type', 'score', 'raw_score', 'ui_score', 'skin_type', 'region'];

function show(el, field) {
  if (!Object.prototype.hasOwnProperty.call(el, field)) return '(absent)';
  const v = el[field];
  if (v === null) return 'null';
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : `<nombre non fini>`;
  if (typeof v === 'string') return v.length > 60 || /:\/\//.test(v) ? '<masqué>' : JSON.stringify(v);
  return `<${Array.isArray(v) ? 'tableau' : typeof v === 'boolean' ? 'booléen' : 'objet'}>`;   // booléen, objet, tableau : jamais de contenu
}

/* Renvoie les lignes à journaliser (vide si data.results.output n'est pas un tableau). */
function diagnosticLines(envelope) {
  const out = envelope && envelope.data && envelope.data.results && envelope.data.results.output;
  if (!Array.isArray(out)) return [];
  const counts = Object.fromEntries(TYPES.map(t => [t, 0]));
  const lines = [];
  out.forEach((el, i) => {
    if (el === null || typeof el !== 'object' || Array.isArray(el) || !TYPES.includes(el.type)) return;
    counts[el.type]++;
    lines.push(`[DERMAI][DIAG] output[${i}] ` + FIELDS.map(f => `${f}=${show(el, f)}`).join(' '));
  });
  lines.unshift(`[DERMAI][DIAG] éléments lus : ${TYPES.map(t => `${t}=${counts[t]}`).join(' ')} (sur ${out.length} éléments)`);
  return lines;
}

/* Comptage des répétitions par type : combien de fois chacun des 15 types de métriques connus du parseur apparaît dans
   data.results.output. Noms de types et nombres d'occurrences SEULEMENT (jamais de valeurs, d'URL ni de JSON brut).
   Les types inconnus sont ignorés. Aucune interprétation : un type à 2 ou plus n'est ni signalé ni corrigé ici. */
const METRIC_TYPES = require('../js/skin-model.js').METRICS.map(m => m[0]);

function repetitionLine(envelope) {
  const out = envelope && envelope.data && envelope.data.results && envelope.data.results.output;
  if (!Array.isArray(out)) return null;
  const counts = Object.fromEntries(METRIC_TYPES.map(t => [t, 0]));
  for (const el of out) {
    if (el === null || typeof el !== 'object' || Array.isArray(el)) continue;
    if (typeof el.type === 'string' && Object.prototype.hasOwnProperty.call(counts, el.type)) counts[el.type]++;
  }
  return `[DERMAI][DIAG] répétitions : ${METRIC_TYPES.map(t => `${t}=${counts[t]}`).join(', ')}`;
}

module.exports = { diagnosticLines, repetitionLine, TYPES, FIELDS, METRIC_TYPES };
