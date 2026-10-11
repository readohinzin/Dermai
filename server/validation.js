'use strict';
const { IMAGE } = require('./config');
const { AnalysisError } = require('./errors');

/* Lit le corps brut de la requête avec une limite stricte de taille.
   `timeoutMs` (facultatif) : durée maximale de la lecture, fournie par le handler d'après le budget global. À l'échéance la lecture s'arrête
   avec TIME_BUDGET (504) SANS détruire la connexion : le handler doit encore pouvoir envoyer sa réponse ; la suite de l'envoi est simplement
   écartée (req.resume()). Une fermeture ou une erreur du flux avant la fin donne UPLOAD_INTERRUPTED (400). Une seule issue (resolve ou reject),
   les écouteurs sont retirés ensuite sauf un 'error' neutre : sans lui, une erreur tardive du flux ferait tomber le processus. */
function readBody(req, maxBytes = IMAGE.maxBytes, { timeoutMs } = {}) {
  return new Promise((resolve, reject) => {
    const declared = Number(req.headers['content-length']);
    if (Number.isFinite(declared) && declared > maxBytes) {
      return reject(new AnalysisError('TOO_LARGE', { status: 413 }));
    }
    /* Requête déjà détruite ou interrompue (le client est parti pendant la vérification de session) : réponse immédiate, sans attendre la fenêtre de
       lecture. Un 'error' neutre est branché : une destruction avec erreur l'émet au tour suivant, et sans écouteur il ferait tomber le processus. */
    if (req.destroyed || req.errored) {
      req.on('error', () => {});
      return reject(new AnalysisError('UPLOAD_INTERRUPTED', { status: 400, cause: req.errored || null, detail: 'lecture de la photo : requête déjà interrompue' }));
    }
    if (timeoutMs !== undefined && !(timeoutMs > 0)) {
      return reject(new AnalysisError('TIME_BUDGET', { status: 504, detail: 'lecture de la photo : aucun temps disponible' }));
    }
    const chunks = [];
    let size = 0, settled = false, timer = null;
    const finish = (fn, value, drain) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      req.removeListener('data', onData); req.removeListener('end', onEnd); req.removeListener('close', onClose);
      if (drain && typeof req.resume === 'function') req.resume();   // écarte la suite de l'envoi sans fermer la connexion
      fn(value);
    };
    const onData = chunk => {
      size += chunk.length;
      if (size > maxBytes) {
        settled = true; clearTimeout(timer);
        req.removeListener('data', onData); req.removeListener('end', onEnd); req.removeListener('close', onClose);
        req.destroy();
        return reject(new AnalysisError('TOO_LARGE', { status: 413 }));
      }
      chunks.push(chunk);
    };
    const onEnd = () => finish(resolve, Buffer.concat(chunks), false);
    const interrupted = cause => finish(reject, new AnalysisError('UPLOAD_INTERRUPTED', { status: 400, cause, detail: 'lecture de la photo : flux interrompu' }), false);
    const onClose = () => interrupted(null);                      // fermeture avant 'end'
    const onError = err => {                                      // reste branché après la fin : voir plus haut
      if (settled) return;
      if (err && (err.code === 'ECONNRESET' || err.code === 'ERR_STREAM_PREMATURE_CLOSE' || err.message === 'aborted')) return interrupted(err);
      finish(reject, new AnalysisError('UNKNOWN', { cause: err }), false);
    };
    req.on('data', onData); req.on('end', onEnd); req.on('close', onClose); req.on('error', onError);
    if (timeoutMs !== undefined) {
      timer = setTimeout(() => finish(reject, new AnalysisError('TIME_BUDGET', { status: 504, detail: `lecture de la photo : échéance de ${Math.round(timeoutMs)} ms atteinte (${size} octets reçus)` }), true), timeoutMs);
    }
  });
}

const isJpeg = buf => buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;

/* On ne fait pas confiance au navigateur : type annoncé ET signature réelle du fichier. */
function validateImage(buffer, contentType) {
  if (!buffer || buffer.length === 0) throw new AnalysisError('NO_IMAGE', { status: 400 });
  const mime = String(contentType || '').split(';')[0].trim().toLowerCase();
  if (!IMAGE.allowedMime.includes(mime)) throw new AnalysisError('BAD_MIME', { status: 415 });
  if (buffer.length > IMAGE.maxBytes) throw new AnalysisError('TOO_LARGE', { status: 413 });
  if (!isJpeg(buffer)) throw new AnalysisError('BAD_MIME', { status: 415 });
  return { buffer, mime, size: buffer.length };
}

module.exports = { readBody, validateImage, isJpeg };
