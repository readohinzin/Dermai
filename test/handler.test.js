'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { Readable } = require('stream');
const { toUserMessage } = require('../server/errors');
const { validateImage, readBody } = require('../server/validation');

const handler = require('../api/skin-analysis.js');

function call(method, headers, data) {
  return new Promise(resolve => {
    const req = Readable.from(data ? [data] : []);
    req.method = method; req.headers = headers;
    const res = { setHeader() {}, end(b) { resolve({ status: this.statusCode, body: JSON.parse(b) }); } };
    handler(req, res);
  });
}

test('méthode GET refusée', async () => assert.equal((await call('GET', {})).status, 405));
test('image absente → 400', async () => assert.equal((await call('POST', { 'content-type': 'image/jpeg' })).status, 400));
test('mauvais MIME → 415', async () => assert.equal((await call('POST', { 'content-type': 'image/png' }, Buffer.from([0xff, 0xd8, 0xff, 1]))).status, 415));
test('faux JPEG → 415', async () => assert.equal((await call('POST', { 'content-type': 'image/jpeg' }, Buffer.from([1, 2, 3, 4]))).status, 415));

test('fichier trop volumineux → 413', async () => {
  const r = await call('POST', { 'content-type': 'image/jpeg', 'content-length': String(5 * 1024 * 1024) }, Buffer.from([0xff, 0xd8, 0xff]));
  assert.equal(r.status, 413);
  assert.equal(r.body.error, toUserMessage('TOO_LARGE'));
});

test('corps dépassant la limite sans content-length → refusé', async () => {
  const req = Readable.from([Buffer.alloc(3000), Buffer.alloc(3000)]);
  req.headers = {};
  await assert.rejects(readBody(req, 4000), { code: 'TOO_LARGE' });
});

test('JPEG valide accepté par validateImage', () => {
  assert.equal(validateImage(Buffer.from([0xff, 0xd8, 0xff, 0xe0]), 'image/jpeg').mime, 'image/jpeg');
});

test('sans clé API, le handler répond une erreur générique sans détail technique', async () => {
  const saved = process.env.PERFECT_CORP_API_KEY; delete process.env.PERFECT_CORP_API_KEY;
  const r = await call('POST', { 'content-type': 'image/jpeg' }, Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1]));
  if (saved !== undefined) process.env.PERFECT_CORP_API_KEY = saved;
  assert.equal(r.status, 503);
  assert.equal(r.body.error, toUserMessage('SERVICE_UNAVAILABLE'));
  assert.ok(!/PERFECT_CORP|key/i.test(r.body.error));
});
