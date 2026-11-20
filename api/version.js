'use strict';
/* Version déployée, lue par la bannière de mise à jour (js/update-banner.js) : elle compare cette valeur à celle vue au chargement de la page et propose « Mettre à jour » quand elle change.
   La version est l'identifiant du dernier commit déployé (VERCEL_GIT_COMMIT_SHA), sinon celui du déploiement (VERCEL_DEPLOYMENT_ID), sinon « dev » (jamais de mise à jour annoncée en local).
   Ces variables sont exposées par Vercel quand « Automatically expose System Environment Variables » est activé dans les réglages du projet (par défaut).
   Aucun secret, aucune donnée de personne : seulement cet identifiant public. Jamais mise en cache (no-store) : c'est tout l'intérêt de la page. GET et HEAD seulement. */
const SAFE = /^[A-Za-z0-9_.\-]{1,64}$/;

function currentVersion(env) {
  const e = env || process.env;
  for (const v of [e.VERCEL_GIT_COMMIT_SHA, e.VERCEL_DEPLOYMENT_ID]) if (typeof v === 'string' && SAFE.test(v)) return v.slice(0, 12 + (v.startsWith('dpl_') ? 20 : 0));
  return 'dev';
}

function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.statusCode = 405; res.setHeader('Allow', 'GET, HEAD'); return res.end(); }
  res.statusCode = 200;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  res.setHeader('X-Robots-Tag', 'noindex');
  res.end(req.method === 'HEAD' ? undefined : JSON.stringify({ version: currentVersion() }));
}

module.exports = handler;
module.exports.currentVersion = currentVersion;
