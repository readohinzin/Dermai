'use strict';
/* Studio Beauté, volet CAPILLAIRE : appels Perfect Corp (liste des modèles, essai). Fonction DISTINCTE de l'analyse, de la simulation et du maquillage : elle réutilise seulement
   l'envoi de fichier (API fichier : file_id → PUT présigné) et les étapes communes (budget de temps, délais, erreurs) de server/perfectcorp.js.
   Une seule tâche par essai, aucune relance automatique : un résultat incertain (délai, réseau coupé après l'envoi) n'est jamais retenté, la tâche a pu être créée chez le fournisseur.
   Les photos viennent uniquement des octets reçus et validés par le handler, jamais d'une URL fournie par le navigateur. Chemins : voir server/hair.js (confirmés ou non, signalés).
   Consommation annoncée : voir FEATURES[].units ; AUCUN relevé réel (README). */
const { AnalysisError, fromPerfectCorpError, isProviderCreditError } = require('./errors');
const pc = require('./perfectcorp');
const { describeStructure } = require('./structure');
const H = require('./hair');
const { call, readJson, authHeaders, requireKey, budgetExhausted } = pc.shared;

const refine = err => (err instanceof AnalysisError && isProviderCreditError(err.detail) ? new AnalysisError('HR_PROVIDER_CREDIT', { status: 503, detail: err.detail, cause: err }) : err);

/* Liste des modèles d'une fonction (lecture seule : aucune tâche, aucune unité annoncée). `next` : jeton de page suivante renvoyé par le fournisseur lui-même
   (forme NON confirmée : le paramètre « starting_token » n'est ajouté que pour un jeton reçu d'une page précédente). */
async function listTemplates(feature, { next } = {}, opts = {}) {
  if (!feature || !feature.templatesPath) throw new AnalysisError('HR_INVALID_REQUEST', { status: 400, detail: 'cette fonction n\'a pas de modèles' });
  const env = pc.makeEnv(opts);
  requireKey(env);
  let json;
  const qs = next ? '?starting_token=' + encodeURIComponent(next) : '';
  try { json = await call(env, 'status', env.baseUrl + feature.templatesPath + qs, { method: 'GET', headers: authHeaders(env) }, readJson); }
  catch (err) { throw refine(err); }
  const parsed = H.parseTemplates(json);
  if (!parsed || !parsed.templates.length) {
    const structure = JSON.stringify(describeStructure(json)).slice(0, 2000);
    throw new AnalysisError('HR_TEMPLATES_UNAVAILABLE', { status: 502, detail: `${feature.id} : liste de modèles absente ou de forme inconnue ; structure ${structure}` });
  }
  return parsed;
}

async function createTask(feature, body, env) {
  requireKey(env);
  let json;
  try {
    json = await call(env, 'task', env.baseUrl + feature.taskPath, {
      method: 'POST', headers: { ...authHeaders(env), 'Content-Type': 'application/json' }, body: JSON.stringify(body)
    }, readJson, env.budget.minTaskMs);       // seuil plus haut : pas de tâche (crédit engagé) sans de quoi l'interroger au moins une fois
  } catch (err) { throw refine(err); }
  const taskId = json && json.data && json.data.task_id;
  if (!taskId) throw new AnalysisError('HR_RESULT_INVALID', { status: 502, detail: `${feature.id} : task_id absent de la réponse` });
  console.log('[DERMAI] Hair task created');
  return taskId;
}

async function getTask(feature, taskId, env) {
  requireKey(env);
  try { return await call(env, 'status', env.baseUrl + feature.taskPath + '/' + encodeURIComponent(taskId), { method: 'GET', headers: authHeaders(env) }, readJson); }
  catch (err) { throw refine(err); }
}

/* « success » termine, « error » échoue ; tout autre statut laisse continuer, dans les mêmes bornes que l'analyse. Jamais de boucle infinie ni de nouvelle création de tâche. */
async function pollTask(feature, taskId, env) {
  const { intervalMs, maxAttempts, totalTimeoutMs } = env.polling;
  const start = env.now();
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (env.now() - start >= totalTimeoutMs) break;
    const json = await getTask(feature, taskId, env);
    const status = json && json.data && json.data.task_status;
    if (status === 'success') { console.log('[DERMAI] Hair task completed'); return json; }
    if (status === 'error') {
      const d = json.data || {};
      const detail = `${feature.id} task error : ${JSON.stringify({ error: d.error, error_message: d.error_message })}`.slice(0, 500);
      const credit = isProviderCreditError(detail);
      throw new AnalysisError(credit ? 'HR_PROVIDER_CREDIT' : (fromPerfectCorpError(detail) || 'TASK_ERROR'), { status: credit ? 503 : 422, detail });
    }
    if (attempt < maxAttempts) {
      if (env.budget.remaining() < intervalMs + env.budget.minStepMs) throw budgetExhausted('status', env, true);
      await env.sleep(intervalMs);
    }
  }
  throw new AnalysisError('TIMEOUT', { status: 504, detail: `${feature.id} : polling abandonné (délai dépassé)` });
}

/* Essai : photo(s) → UNE tâche → polling → URL de l'image. `config` déjà validée par le handler (revalidée ici). Renvoie { image }. */
async function tryOn({ feature, buffer, refBuffer, mime, config }, opts = {}) {
  const env = pc.makeEnv(opts);
  requireKey(env);
  H.buildTaskBody(feature.id, config, { src: 'x', ref: 'x' });                 // revalide avant tout envoi
  const up = await pc.requestUploadUrl({ size: buffer.length, mime, fileName: 'selfie.jpg' }, env);
  await pc.uploadFile({ url: up.url, method: up.method, headers: up.headers, buffer, mime }, env);
  let refId = null;
  if (refBuffer) {
    const ref = await pc.requestUploadUrl({ size: refBuffer.length, mime, fileName: 'reference.jpg' }, env);
    await pc.uploadFile({ url: ref.url, method: ref.method, headers: ref.headers, buffer: refBuffer, mime }, env);
    refId = ref.fileId;
  }
  const taskId = await createTask(feature, H.buildTaskBody(feature.id, config, { src: up.fileId, ref: refId }), env);
  const envelope = await pollTask(feature, taskId, env);
  const url = H.extractResultUrl(envelope);
  if (!url) {
    const structure = JSON.stringify(describeStructure(envelope)).slice(0, 2000);
    throw new AnalysisError('HR_RESULT_INVALID', { status: 502, detail: `${feature.id} : aucune URL de résultat dans une forme documentée ; structure ${structure}` });
  }
  return { image: url };
}

module.exports = { tryOn, listTemplates, createTask, pollTask };
