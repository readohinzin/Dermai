'use strict';
/* Client Perfect Corp : File API v2.0, puis Skin Analysis v2.1.
   JPEG → file_id → PUT présigné → task_id → polling → JSON brut.
   Aucune normalisation ici : le JSON Perfect Corp est rendu tel quel au handler. */
const {
  PERFECT_CORP_BASE_URL, PERFECT_CORP_PATHS, PERFECT_CORP_SKIN_ACTIONS, POLLING
} = require('./config');
const { AnalysisError, fromPerfectCorpError } = require('./errors');

const sleepReal = ms => new Promise(r => setTimeout(r, ms));

/* Dépendances injectables pour les tests : aucun appel réseau réel n'est nécessaire. */
function makeEnv(opts = {}) {
  return {
    fetch: opts.fetch || globalThis.fetch,
    sleep: opts.sleep || sleepReal,
    now: opts.now || Date.now,
    apiKey: opts.apiKey !== undefined ? opts.apiKey : process.env.PERFECT_CORP_API_KEY,
    baseUrl: opts.baseUrl || PERFECT_CORP_BASE_URL,
    polling: { ...POLLING, ...(opts.polling || {}) }
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

async function doFetch(env, step, url, init) {
  try {
    return await env.fetch(url, init);
  } catch (err) {
    throw new AnalysisError('SERVICE_UNAVAILABLE', { status: 502, cause: err, detail: `${step} réseau : ${err && err.message}` });
  }
}

async function readJson(res, step) {
  try { return await res.json(); }
  catch (err) { throw new AnalysisError('SERVICE_UNAVAILABLE', { status: 502, cause: err, detail: `${step} : réponse JSON illisible` }); }
}

/* 1. File API : demande une URL d'upload présignée. Renvoie { fileId, url, method, headers }. */
async function requestUploadUrl({ size, mime, fileName = 'photo.jpg' }, env = makeEnv()) {
  requireKey(env);
  const res = await doFetch(env, 'file', env.baseUrl + PERFECT_CORP_PATHS.file, {
    method: 'POST',
    headers: { ...authHeaders(env), 'Content-Type': 'application/json' },
    body: JSON.stringify({ files: [{ content_type: mime, file_name: fileName, file_size: size }] })
  });
  if (!res.ok) throw await httpError(res, 'file');
  const json = await readJson(res, 'file');
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
  const res = await doFetch(env, 'upload', url, { method, headers: h, body: buffer });
  if (!res.ok) throw await httpError(res, 'upload');
  console.log('[DERMAI] Perfect Corp file uploaded');
}

/* 3. Création de la tâche (actions SD uniquement, résultat en JSON). Renvoie le task_id. */
async function createSkinAnalysisTask({ fileId, actions = PERFECT_CORP_SKIN_ACTIONS }, env = makeEnv()) {
  requireKey(env);
  const res = await doFetch(env, 'task', env.baseUrl + PERFECT_CORP_PATHS.skinTask, {
    method: 'POST',
    headers: { ...authHeaders(env), 'Content-Type': 'application/json' },
    body: JSON.stringify({ src_file_id: fileId, dst_actions: actions, format: 'json' })
  });
  if (!res.ok) throw await httpError(res, 'task');
  const json = await readJson(res, 'task');
  const taskId = json && json.data && json.data.task_id;
  if (!taskId) throw new AnalysisError('SERVICE_UNAVAILABLE', { status: 502, detail: 'task : task_id absent de la réponse' });
  console.log('[DERMAI] Task created');
  return taskId;
}

/* 4a. Un appel de statut. Renvoie le JSON brut de la réponse. */
async function getSkinAnalysisTask(taskId, env = makeEnv()) {
  requireKey(env);
  const res = await doFetch(env, 'status', env.baseUrl + PERFECT_CORP_PATHS.skinTaskStatus(taskId), {
    method: 'GET', headers: authHeaders(env)
  });
  if (!res.ok) throw await httpError(res, 'status');
  return readJson(res, 'status');
}

/* 4b. Polling borné : max tentatives, délai entre appels, timeout global. Jamais de boucle infinie. */
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
    if (attempt < maxAttempts) await env.sleep(intervalMs);
  }
  throw new AnalysisError('TIMEOUT', { status: 504, detail: `polling abandonné pour ${taskId}` });
}

/* Orchestration complète. Renvoie le JSON brut du dernier appel de statut. */
async function analyzeSkin({ buffer, mime }, opts = {}) {
  const env = makeEnv(opts);
  requireKey(env);
  const up = await requestUploadUrl({ size: buffer.length, mime }, env);
  await uploadFile({ url: up.url, method: up.method, headers: up.headers, buffer, mime }, env);
  const taskId = await createSkinAnalysisTask({ fileId: up.fileId }, env);
  return pollSkinAnalysisTask(taskId, env);
}

module.exports = {
  requestUploadUrl, uploadFile, createSkinAnalysisTask, getSkinAnalysisTask, pollSkinAnalysisTask, analyzeSkin, makeEnv
};
