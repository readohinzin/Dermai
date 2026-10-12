'use strict';
/* Simulation cosmétique avant/après (Perfect Corp, AI Skin Simulation). Fonction DISTINCTE de l'analyse de peau :
   elle réutilise seulement l'envoi de fichier (API fichier : file_id → PUT présigné) et les étapes communes (budget de temps, délais, erreurs)
   de server/perfectcorp.js ; elle n'appelle JAMAIS le point d'entrée d'analyse (/task/skin-analysis).
   Les éléments NON CONFIRMÉS de l'API (chemins, forme du corps de création, emplacement de l'image résultat) sont isolés ci-dessous et signalés ;
   voir server/config.js (SIM_PATHS) et le README (« Simulation »). Rien n'est inventé en silence : une réponse qui ne ressemble pas à ce qui est
   attendu donne SIM_RESULT_INVALID, jamais une image devinée. */
const { SIM_PATHS, SIM_CONCERNS, SIM_INTENSITY } = require('./config');
const { AnalysisError, fromPerfectCorpError } = require('./errors');
const pc = require('./perfectcorp');
const masks = require('./masks');
const { describeStructure } = require('./structure');
const { call, readJson, authHeaders, requireKey, budgetExhausted } = pc.shared;

/* Une seule préoccupation, dans la liste blanche. Renvoie le paramètre Perfect Corp, ou null. */
const concernParam = key => (typeof key === 'string' && Object.prototype.hasOwnProperty.call(SIM_CONCERNS, key) ? SIM_CONCERNS[key] : null);

/* NON CONFIRMÉ — forme du corps de création. D'après le schéma de l'outil officiel : l'image (src_file_id) et UNE intensité 0..1 sous le nom du
   paramètre de la préoccupation ; les autres intensités restent absentes (valeur par défaut du fournisseur = pas d'effet demandé). */
function buildTaskBody(fileId, param, intensity = SIM_INTENSITY) {
  return { src_file_id: fileId, [param]: intensity };
}

/* NON CONFIRMÉ — création de la tâche. Le seuil de temps est celui de l'analyse (crédit engagé : de quoi interroger au moins une fois). */
async function createSimulationTask({ fileId, param, intensity }, env) {
  requireKey(env);
  const json = await call(env, 'task', env.baseUrl + SIM_PATHS.task, {
    method: 'POST',
    headers: { ...authHeaders(env), 'Content-Type': 'application/json' },
    body: JSON.stringify(buildTaskBody(fileId, param, intensity))
  }, readJson, env.budget.minTaskMs);
  const taskId = json && json.data && json.data.task_id;
  if (!taskId) throw new AnalysisError('SIM_RESULT_INVALID', { status: 502, detail: 'simulation task : task_id absent de la réponse' });
  console.log('[DERMAI] Simulation task created');
  return taskId;
}

async function getSimulationTask(taskId, env) {
  requireKey(env);
  return call(env, 'status', env.baseUrl + SIM_PATHS.taskStatus(taskId), { method: 'GET', headers: authHeaders(env) }, readJson);
}

/* Polling borné (mêmes bornes que l'analyse) : jamais de boucle infinie, jamais de nouvelle création de tâche. */
async function pollSimulationTask(taskId, env) {
  const { intervalMs, maxAttempts, totalTimeoutMs } = env.polling;
  const start = env.now();
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (env.now() - start >= totalTimeoutMs) break;
    const json = await getSimulationTask(taskId, env);
    const status = json && json.data && json.data.task_status;
    if (status === 'success') { console.log('[DERMAI] Simulation task completed'); return json; }
    if (status === 'error') {
      const d = json.data || {};
      const detail = `simulation task error : ${JSON.stringify({ error: d.error, error_message: d.error_message })}`.slice(0, 500);
      throw new AnalysisError(fromPerfectCorpError(detail) || 'TASK_ERROR', { status: 422, detail });
    }
    if (attempt < maxAttempts) {
      if (env.budget.remaining() < intervalMs + env.budget.minStepMs) throw budgetExhausted('status', env, true);
      await env.sleep(intervalMs);
    }
  }
  throw new AnalysisError('TIMEOUT', { status: 504, detail: 'simulation : polling abandonné (délai dépassé)' });
}

/* Emplacement de l'image résultat : `data.results.url`, CONFIRMÉ par le premier essai réel (structure relevée dans les journaux : data.results.url,
   data.task_status, data.error). Les autres chemins ci-dessous ne sont que des repli prudents d'une liste FERMÉE (jamais une recherche récursive d'une
   chaîne qui ressemble à une URL) ; si aucun ne donne une URL https publique, la simulation est refusée (SIM_RESULT_INVALID) et la structure de la réponse
   est journalisée (chemins et types, jamais de valeur).
   L'URL est présignée, temporaire et propre à l'image : elle est renvoyée telle quelle au navigateur de l'utilisatrice connectée, qui l'affiche. Le
   serveur ne télécharge PAS l'image : le premier essai a montré qu'elle dépasse la limite de réponse d'une fonction Vercel (~4,5 Mo) une fois en base64. */
function extractResultUrl(envelope) {
  const d = envelope && envelope.data;
  const r = d && d.results;
  const candidates = [
    r && !Array.isArray(r) && r.url,
    Array.isArray(r) && r[0] && r[0].url,
    r && r.output && !Array.isArray(r.output) && r.output.url,
    Array.isArray(r && r.output) && r.output[0] && r.output[0].url,
    r && r.result_url,
    d && d.result_url
  ];
  for (const c of candidates) { const u = masks.safeUrl(c); if (u) return u; }
  return null;
}

/* Orchestration : fichier → tâche de simulation → polling → URL de l'image. Une seule tâche par appel. Renvoie { image (URL https), envelope }.
   `concern` : clé DERMAI déjà validée par le handler (revérifiée ici). */
async function simulate({ buffer, mime, concern, intensity = SIM_INTENSITY }, opts = {}) {
  const param = concernParam(concern);
  if (!param) throw new AnalysisError('SIM_INVALID_CONCERN', { status: 400 });
  const env = pc.makeEnv(opts);
  requireKey(env);
  const up = await pc.requestUploadUrl({ size: buffer.length, mime }, env);       // API fichier, la même que pour l'analyse
  await pc.uploadFile({ url: up.url, method: up.method, headers: up.headers, buffer, mime }, env);
  const taskId = await createSimulationTask({ fileId: up.fileId, param, intensity }, env);
  const envelope = await pollSimulationTask(taskId, env);
  /* Structure seulement (chemins et types, jamais de valeur ni d'URL) : si le chemin du résultat n'est pas celui attendu, ce journal est la seule
     trace exploitable de l'essai réel, qui ne doit pas être répété pour la retrouver. */
  const structure = JSON.stringify(describeStructure(envelope)).slice(0, 2000);
  console.log('[DERMAI] Simulation result structure', structure);
  const url = extractResultUrl(envelope);
  if (!url) throw new AnalysisError('SIM_RESULT_INVALID', { status: 502, detail: 'simulation : aucune URL de résultat reconnue dans la réponse ; structure ' + structure });
  return { image: url, envelope };
}

module.exports = { simulate, concernParam, buildTaskBody, extractResultUrl, createSimulationTask, pollSimulationTask };
