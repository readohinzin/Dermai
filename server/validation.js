'use strict';
const { IMAGE } = require('./config');
const { AnalysisError } = require('./errors');

/* Lit le corps brut de la requête avec une limite stricte de taille. */
function readBody(req, maxBytes = IMAGE.maxBytes) {
  return new Promise((resolve, reject) => {
    const declared = Number(req.headers['content-length']);
    if (Number.isFinite(declared) && declared > maxBytes) {
      return reject(new AnalysisError('TOO_LARGE', { status: 413 }));
    }
    const chunks = [];
    let size = 0;
    req.on('data', chunk => {
      size += chunk.length;
      if (size > maxBytes) {
        req.destroy();
        return reject(new AnalysisError('TOO_LARGE', { status: 413 }));
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', err => reject(new AnalysisError('UNKNOWN', { cause: err })));
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
