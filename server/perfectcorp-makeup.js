'use strict';
/* Studio Beauté : appel à AI Makeup Virtual Try-On V1.0 (Perfect Corp). Fonction DISTINCTE de l'analyse de peau et de la simulation : elle réutilise seulement l'envoi de
   fichier (API fichier : file_id → PUT présigné) et les étapes communes (budget de temps, délais, erreurs) de server/perfectcorp.js ; elle n'appelle JAMAIS
   /task/skin-analysis ni /task/skin-simulation.
   Une seule tâche par essayage, avec TOUS les effets dans un seul tableau. Aucune relance automatique : un résultat incertain (délai, réseau coupé après l'envoi) n'est jamais
   retenté, car la tâche a pu être créée chez le fournisseur. La photo vient uniquement des octets reçus et validés par le handler, jamais d'une URL fournie par le navigateur.
   Consommation annoncée : 1 unité par tâche, aucune unité en cas d'erreur de requête ou de traitement ; AUCUN relevé réel n'a encore été fait (README). */
const { MAKEUP_PATHS } = require('./config');
const { AnalysisError, fromPerfectCorpError, isProviderCreditError } = require('./errors');
const pc = require('./perfectcorp');
const { describeStructure } = require('./structure');
const M = require('./makeup');
const { call, readJson, authHeaders, requireKey, budgetExhausted } = pc.shared;

/* Un refus du fournisseur pour crédits ou unités épuisés devient MK_PROVIDER_CREDIT (503) : message neutre pour l'utilisatrice, détail seulement dans les journaux serveur. */
const refine = err => (err instanceof AnalysisError && isProviderCreditError(err.detail) ? new AnalysisError('MK_PROVIDER_CREDIT', { status: 503, detail: err.detail, cause: err }) : err);

async function createMakeupTask({ fileId, effects }, env) {
  requireKey(env);
  let json;
  try {
    json = await call(env, 'task', env.baseUrl + MAKEUP_PATHS.task, {
      method: 'POST',
      headers: { ...authHeaders(env), 'Content-Type': 'application/json' },
      body: JSON.stringify(M.buildTaskBody(fileId, effects))
    }, readJson, env.budget.minTaskMs);       // seuil plus haut : pas de tâche (crédit engagé) sans de quoi l'interroger au moins une fois
  } catch (err) { throw refine(err); }
  const taskId = json && json.data && json.data.task_id;
  if (!taskId) throw new AnalysisError('MK_RESULT_INVALID', { status: 502, detail: 'makeup task : task_id absent de la réponse' });
  console.log('[DERMAI] Makeup task created');
  return taskId;
}

async function getMakeupTask(taskId, env) {
  requireKey(env);
  try { return await call(env, 'status', env.baseUrl + MAKEUP_PATHS.taskStatus(taskId), { method: 'GET', headers: authHeaders(env) }, readJson); }
  catch (err) { throw refine(err); }
}

/* Statuts : « success » termine, « error » échoue ; tout autre statut (file d'attente, traitement en cours) laisse continuer, dans les mêmes bornes que l'analyse
   (nombre de tentatives, plafond propre, budget global). Jamais de boucle infinie, jamais de nouvelle création de tâche. */
async function pollMakeupTask(taskId, env) {
  const { intervalMs, maxAttempts, totalTimeoutMs } = env.polling;
  const start = env.now();
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (env.now() - start >= totalTimeoutMs) break;
    const json = await getMakeupTask(taskId, env);
    const status = json && json.data && json.data.task_status;
    if (status === 'success') { console.log('[DERMAI] Makeup task completed'); return json; }
    if (status === 'error') {
      const d = json.data || {};
      const detail = `makeup task error : ${JSON.stringify({ error: d.error, error_message: d.error_message })}`.slice(0, 500);
      throw new AnalysisError(isProviderCreditError(detail) ? 'MK_PROVIDER_CREDIT' : (fromPerfectCorpError(detail) || 'TASK_ERROR'), { status: isProviderCreditError(detail) ? 503 : 422, detail });
    }
    if (attempt < maxAttempts) {
      if (env.budget.remaining() < intervalMs + env.budget.minStepMs) throw budgetExhausted('status', env, true);
      await env.sleep(intervalMs);
    }
  }
  throw new AnalysisError('TIMEOUT', { status: 504, detail: 'makeup : polling abandonné (délai dépassé)' });
}

/* Orchestration : fichier → UNE tâche → polling → URL de l'image. `config` : sélection déjà validée par le handler (revalidée ici). Renvoie { image }. */
async function tryOn({ buffer, mime, config }, opts = {}) {
  const effects = M.buildEffects(config);
  const env = pc.makeEnv(opts);
  requireKey(env);
  const up = await pc.requestUploadUrl({ size: buffer.length, mime, fileName: 'selfie.jpg' }, env);
  await pc.uploadFile({ url: up.url, method: up.method, headers: up.headers, buffer, mime }, env);
  const taskId = await createMakeupTask({ fileId: up.fileId, effects }, env);
  const envelope = await pollMakeupTask(taskId, env);
  /* Structure seulement (chemins et types, jamais de valeur ni d'URL) : trace de diagnostic si la réponse n'a aucune forme documentée. */
  const url = M.extractResultUrl(envelope);
  if (!url) {
    const structure = JSON.stringify(describeStructure(envelope)).slice(0, 2000);
    throw new AnalysisError('MK_RESULT_INVALID', { status: 502, detail: 'makeup : aucune URL de résultat dans une forme documentée ; structure ' + structure });
  }
  return { image: url };
}

module.exports = { tryOn, createMakeupTask, pollMakeupTask };
