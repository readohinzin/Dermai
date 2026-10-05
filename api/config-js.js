'use strict';
const { isDemoMode } = require('../server/config');

/* Servi sur /api/config-js (chargé directement par index.html). Expose uniquement le booléen demoMode : aucune autre variable,
   aucun secret. Si ce script ne se charge pas, le frontend reste en mode démo. */
function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.statusCode = 405;
    res.setHeader('Allow', 'GET, HEAD');
    return res.end();
  }
  res.statusCode = 200;
  res.setHeader('Content-Type', 'text/javascript; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(req.method === 'HEAD' ? undefined : `window.DERMAI_CONFIG=${JSON.stringify({ demoMode: isDemoMode() })};\n`);
}

module.exports = handler;
