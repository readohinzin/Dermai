'use strict';
const { isDemoMode, publicSupabase } = require('../server/config');

/* Servi sur /api/config-js (chargé directement par index.html). Expose le booléen demoMode et, si elles sont configurées, les deux valeurs PUBLIQUES des comptes (URL du projet et clé anon) :
   aucun secret, jamais de clé service_role. Si ce script ne se charge pas, le frontend reste en mode démo. */
function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.statusCode = 405;
    res.setHeader('Allow', 'GET, HEAD');
    return res.end();
  }
  res.statusCode = 200;
  res.setHeader('Content-Type', 'text/javascript; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(req.method === 'HEAD' ? undefined : `window.DERMAI_CONFIG=${JSON.stringify(Object.assign({ demoMode: isDemoMode() }, publicSupabase()))};\n`);
}

module.exports = handler;
