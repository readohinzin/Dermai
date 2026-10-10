'use strict';
/* Budget de temps GLOBAL d'une analyse. Un seul budget par requête, créé à l'entrée du handler (avant la première opération réseau) et
   passé à chaque étape : photo reçue, quota, fichier, envoi, tâche, polling, masques. Chaque étape vérifie ce qu'il reste avant de
   commencer et est interrompue à l'échéance ; aucune nouvelle opération ne démarre une fois le budget épuisé. Aucune répétition de
   requête n'est introduite. L'horloge est remplaçable par les tests (aucune attente réelle). */
const { TIME_BUDGET } = require('./config');

const clock = { now: () => Date.now() };

function createBudget({ totalMs = TIME_BUDGET.totalMs, minStepMs = TIME_BUDGET.minStepMs, minTaskMs = TIME_BUDGET.minTaskMs, now } = {}) {
  const read = typeof now === 'function' ? now : () => clock.now();
  const startedAt = read();
  const elapsed = () => read() - startedAt;
  const remaining = () => Math.max(0, totalMs - elapsed());
  return { totalMs, minStepMs, minTaskMs, elapsed, remaining, canStart: ms => remaining() >= ms };
}

module.exports = { createBudget, clock };
