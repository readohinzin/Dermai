'use strict';
/* Client Perfect Corp : File API v2.0, puis Skin Analysis v2.1.
   JPEG → file_id → PUT présigné → task_id → polling → JSON brut.
   Aucune normalisation ici : le JSON Perfect Corp est rendu tel quel au handler. */
const {
  PERFECT_CORP_BASE_URL, PERFECT_CORP_PATHS, PERFECT_CORP_SKIN_ACTIONS, POLLING
} = require('./config');
const { AnalysisError, fromPerfectCorpError } = require('./errors');
const { createBudget } = require('./budget');

const sleepReal = ms => new Promise(r => setTimeout(r, ms));

/* Dépendances injectables pour les tests : aucun appel réseau réel n'est nécessaire. */
function makeEnv(opts = {}) {
  return {
    fetch: opts.fetch || globalThis.fetch,
    sleep: opts.sleep || sleepReal,
    now: opts.now || Date.now,
    apiKey: opts.apiKey !== undefined ? opts.apiKey : process.env.PERFECT_CORP_API_KEY,
    baseUrl: opts.baseUrl || PERFECT_CORP_BASE_URL,
    polling: { ...POLLING, ...(opts.polling || {}) },
    /* Budget global : celui du handler s'il est fourni, sinon un budget démarré ici (appels directs, tests). */
    budget: opts.budget || createBudget({ now: opts.now })
  };
}

function requireKey(env) {
  if (!env.apiKey) throw new AnalysisError('SERVICE_UNAVAILABLE', { status: 503, detail: 'PERFECT_CORP_API_KEY manquante' });
}

const authHeaders = env => ({ Authorization: `Bearer ${env.apiKey}` });

/* Traduit un statut HTTP en erreur DERMAI. Le corps n'est jamais renvoyé au client. */
async function httpError(res, step) {
  let body = '';
  try { body = (await res.text()).slice(0, 500); } catch (e) { /* ignoré */ }
  const detail = `${step} HTTP ${res.status} ${body}`;
  const code = res.status === 400 ? 'INVALID_IMAGE' : 'SERVICE_UNAVAILABLE';
  return new AnalysisError(fromPerfectCorpError(body) || code, { status: 502, detail });
}

/* Existence de la tâche chez le fournisseur, telle que le serveur peut l'affirmer :
     - étape status : « oui » (le task_id a été reçu) ;
     - étape task : « non » si la requête n'est JAMAIS partie (refus avant émission), « inconnu » si elle a été émise puis interrompue
       (le fournisseur a pu la traiter sans que la réponse nous parvienne) ;
     - étapes file et upload : « non » (aucune tâche n'a encore été demandée). */
function taskState(step, sent) {
  if (step === 'status') return 'oui';
  if (step === 'task') return sent ? 'inconnu' : 'non';
  return 'non';
}

/* Budget épuisé : erreur contrôlée, 504. Le détail (serveur seulement) donne l'étape et l'état de la tâche chez le fournisseur ;
   jamais l'identifiant de tâche. Aucune nouvelle opération n'est lancée après cette erreur. `sent` : la requête de l'étape avait été émise. */
function budgetExhausted(step, env, sent = false) {
  return new AnalysisError('TIME_BUDGET', { status: 504, detail: `budget de temps épuisé (étape ${step}, ${env.budget.elapsed()} ms écoulées, tâche créée : ${taskState(step, sent)})` });
}

/* Une étape réseau sous le budget global : refusée si le temps restant est insuffisant, interrompue (AbortController) à l'échéance, y compris
   pendant la lecture de la réponse. `parse` lit le corps (JSON) avant que le délai ne soit levé. `minMs` : temps restant minimal pour
   émettre la requête (minStepMs par défaut ; plus haut pour la création de la tâche, qui engage le crédit). Un refus avant émission ne
   laisse aucune requête partie ; une interruption après émission laisse l'état de la requête inconnu. */
async function call(env, step, url, init, parse, minMs = env.budget.minStepMs) {
  if (env.budget.remaining() < minMs) throw budgetExhausted(step, env, false);
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), env.budget.remaining());
  try {
    let res;
    try { res = await env.fetch(url, { ...init, signal: ctl.signal }); }
    catch (err) {
      if (ctl.signal.aborted) throw budgetExhausted(step, env, true);
      throw new AnalysisError('SERVICE_UNAVAILABLE', { status: 502, cause: err, detail: `${step} réseau : ${err && err.message}` });
    }
    if (!res.ok) throw await httpError(res, step);
    return parse ? await parse(res, step) : res;
  } catch (err) {
    if (ctl.signal.aborted && !(err instanceof AnalysisError && err.code === 'TIME_BUDGET')) throw budgetExhausted(step, env, true);
    throw err;
  } finally { clearTimeout(timer); }
}

async function readJson(res, step) {
  try { return await res.json(); }
  catch (err) { throw new AnalysisError('SERVICE_UNAVAILABLE', { status: 502, cause: err, detail: `${step} : réponse JSON illisible` }); }
}

/* 1. File API : demande une URL d'upload présignée. Renvoie { fileId, url, method, headers }. */
async function requestUploadUrl({ size, mime, fileName = 'photo.jpg' }, env = makeEnv()) {
  requireKey(env);
  const json = await call(env, 'file', env.baseUrl + PERFECT_CORP_PATHS.file, {
    method: 'POST',
    headers: { ...authHeaders(env), 'Content-Type': 'application/json' },
    body: JSON.stringify({ files: [{ content_type: mime, file_name: fileName, file_size: size }] })
  }, readJson);
  const file = json && json.data && json.data.files && json.data.files[0];
  const req0 = file && file.requests && file.requests[0];
  if (!file || !file.file_id || !req0 || !req0.url) {
    throw new AnalysisError('SERVICE_UNAVAILABLE', { status: 502, detail: 'file : file_id ou url absents de la réponse' });
  }
  console.log('[DERMAI] Perfect Corp upload URL obtained');
  return { fileId: file.file_id, url: req0.url, method: req0.method || 'PUT', headers: req0.headers || {} };
}

/* 2. PUT des octets JPEG reçus, sans aucune transformation. L'URL présignée ne reçoit pas la clé API. */
async function uploadFile({ url, method = 'PUT', headers = {}, buffer, mime }, env = makeEnv()) {
  const h = { ...headers };
  if (!Object.keys(h).some(k => k.toLowerCase() === 'content-type')) h['Content-Type'] = mime;
  await call(env, 'upload', url, { method, headers: h, body: buffer });
  console.log('[DERMAI] Perfect Corp file uploaded');
}

/* 3. Création de la tâche (actions SD uniquement, résultat en JSON). Renvoie le task_id. */
async function createSkinAnalysisTask({ fileId, actions = PERFECT_CORP_SKIN_ACTIONS }, env = makeEnv()) {
  requireKey(env);
  const json = await call(env, 'task', env.baseUrl + PERFECT_CORP_PATHS.skinTask, {
    method: 'POST',
    headers: { ...authHeaders(env), 'Content-Type': 'application/json' },
    body: JSON.stringify({ src_file_id: fileId, dst_actions: actions, format: 'json' })
  }, readJson, env.budget.minTaskMs);   // seuil plus haut : ne pas créer une tâche (crédit engagé) sans de quoi l'interroger au moins une fois
  const taskId = json && json.data && json.data.task_id;
  if (!taskId) throw new AnalysisError('SERVICE_UNAVAILABLE', { status: 502, detail: 'task : task_id absent de la réponse' });
  console.log('[DERMAI] Task created');
  return taskId;
}

/* 4a. Un appel de statut. Renvoie le JSON brut de la réponse. */
async function getSkinAnalysisTask(taskId, env = makeEnv()) {
  requireKey(env);
  return call(env, 'status', env.baseUrl + PERFECT_CORP_PATHS.skinTaskStatus(taskId), {
    method: 'GET', headers: authHeaders(env)
  }, readJson);
}

/* 4b. Polling borné : max tentatives, délai entre appels, plafond propre, ET budget global de la fonction. Jamais de boucle infinie.
   Pas de pause (ni de nouvel appel) quand le temps restant ne permettrait plus une interrogation complète après elle. */
async function pollSkinAnalysisTask(taskId, env = makeEnv()) {
  const { intervalMs, maxAttempts, totalTimeoutMs } = env.polling;
  const start = env.now();
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (env.now() - start >= totalTimeoutMs) break;
    const json = await getSkinAnalysisTask(taskId, env);
    const status = json && json.data && json.data.task_status;
    if (status === 'success') {
      console.log('[DERMAI] Task completed');
      return json;
    }
    if (status === 'error') {
      const d = json.data || {};
      const detail = `task error : ${JSON.stringify({ error: d.error, error_message: d.error_message })}`.slice(0, 500);
      throw new AnalysisError(fromPerfectCorpError(detail) || 'TASK_ERROR', { status: 422, detail });
    }
    if (attempt < maxAttempts) {
      if (env.budget.remaining() < intervalMs + env.budget.minStepMs) throw budgetExhausted('status', env, true);
      await env.sleep(intervalMs);
    }
  }
  throw new AnalysisError('TIMEOUT', { status: 504, detail: 'polling abandonné (délai dépassé)' });
}

/* Orchestration complète. Renvoie le JSON brut du dernier appel de statut. `opts.budget` : budget global du handler. */
async function analyzeSkin({ buffer, mime }, opts = {}) {
  const env = makeEnv(opts);
  requireKey(env);
  const up = await requestUploadUrl({ size: buffer.length, mime }, env);
  await uploadFile({ url: up.url, method: up.method, headers: up.headers, buffer, mime }, env);
  const taskId = await createSkinAnalysisTask({ fileId: up.fileId }, env);
  return pollSkinAnalysisTask(taskId, env);
}

/* Clé présente ? Vérifié avant de réserver le quota : une configuration manquante ne doit consommer l'analyse de personne. */
const isConfigured = (env = process.env) => !!env.PERFECT_CORP_API_KEY;

module.exports = {
  isConfigured, requestUploadUrl, uploadFile, createSkinAnalysisTask, getSkinAnalysisTask, pollSkinAnalysisTask, analyzeSkin, makeEnv
};
