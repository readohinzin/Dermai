'use strict';
/* Budget de temps GLOBAL d'une analyse. Un seul budget par requête, créé à l'entrée du handler (avant la première opération réseau) et
   passé à chaque étape : photo reçue, quota, fichier, envoi, tâche, polling, masques. Chaque étape vérifie ce qu'il reste avant de
   commencer et est interrompue à l'échéance ; aucune nouvelle opération ne démarre une fois le budget épuisé. Aucune répétition de
   requête n'est introduite. L'horloge est remplaçable par les tests (aucune attente réelle). */
const { TIME_BUDGET } = require('./config');
const { AnalysisError } = require('./errors');

const clock = { now: () => Date.now() };

function createBudget({ totalMs = TIME_BUDGET.totalMs, minStepMs = TIME_BUDGET.minStepMs, minTaskMs = TIME_BUDGET.minTaskMs, now } = {}) {
  const read = typeof now === 'function' ? now : () => clock.now();
  const startedAt = read();
  const elapsed = () => read() - startedAt;
  const remaining = () => Math.max(0, totalMs - elapsed());
  return { totalMs, minStepMs, minTaskMs, elapsed, remaining, canStart: ms => remaining() >= ms };
}

/* Délai d'UNE requête HTTP vers Supabase ET de la lecture COMPLÈTE de sa réponse. Le signal d'interruption reste actif jusqu'à clear() : un
   fetch qui a reçu ses en-têtes mais dont le corps ne vient pas (res.text()) est interrompu à l'échéance, ce qu'un minuteur annulé dès les
   en-têtes ne permettait pas. L'échéance est timeoutMs (jamais allongée), réduite au temps restant du budget global s'il est fourni.
   Si c'est le budget qui borne (il reste moins que timeoutMs), l'erreur d'expiration est TIME_BUDGET (504), sinon le code de
   disponibilité du module (503). clear() annule le minuteur et libère la requête (corps non lu compris) : à appeler dans un finally.
   Budget déjà épuisé : TIME_BUDGET (504) est levée AVANT de créer le contrôleur ou le minuteur : l'appelant n'émet alors aucune requête
   (`label` : nom de l'étape, pour le journal serveur). Sans budget fourni, rien ne change. */
function startDeadline({ timeoutMs, budget, label = 'requête' } = {}) {
  if (budget && !budget.canStart(1)) throw new AnalysisError('TIME_BUDGET', { status: 504, detail: `${label} : budget de temps épuisé avant émission` });
  const budgetBound = !!budget && budget.remaining() < timeoutMs;
  const limit = budget ? Math.min(timeoutMs, budget.remaining()) : timeoutMs;
  const ctl = new AbortController();
  let expired = false;
  const timer = setTimeout(() => { expired = true; ctl.abort(); }, limit);
  return {
    signal: ctl.signal,
    timedOut: () => expired,
    error: (fallbackCode, detail) => new AnalysisError(budgetBound ? 'TIME_BUDGET' : fallbackCode, { status: budgetBound ? 504 : 503, detail }),
    clear: () => { clearTimeout(timer); if (!ctl.signal.aborted) ctl.abort(); }
  };
}

module.exports = { createBudget, clock, startDeadline };
