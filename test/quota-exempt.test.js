'use strict';
/* Compte du fondateur sans limite de quota, pour les quatre fonctions payantes. Partie réglage + partie source (la réservation n'est évitée que pour un compte exempté,
   juste avant l'appel au fournisseur, et seulement là). Le comportement complet de la simulation est dans test/simulation-server.test.js (SIM-S11b). */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const config = require('../server/config.js');
const quota = require('../server/quota.js');
const read = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const ID = '11111111-1111-4111-8111-111111111111', OTHER = '22222222-2222-4222-8222-222222222222';

test('QE1 réglage : exempté = dans la liste du fondateur ET interrupteur actif (défaut) ; échec fermé sinon', () => {
  const env = x => Object.assign({ DERMAI_ADMIN_USER_IDS: ID }, x || {});
  assert.equal(config.isQuotaExempt(ID, env()), true); assert.equal(config.isQuotaExempt(ID.toUpperCase(), env()), true, 'casse sans importance');
  assert.equal(config.isQuotaExempt(OTHER, env()), false); assert.equal(config.isQuotaExempt(undefined, env()), false); assert.equal(config.isQuotaExempt('', env()), false); assert.equal(config.isQuotaExempt(null, env()), false);
  for (const off of ['0', 'false', 'off', 'no']) assert.equal(config.isQuotaExempt(ID, env({ DERMAI_ADMIN_QUOTA_EXEMPT: off })), false, off);
  for (const on of ['1', 'true', 'on', 'yes', '', undefined]) assert.equal(config.isQuotaExempt(ID, env({ DERMAI_ADMIN_QUOTA_EXEMPT: on })), true, String(on));
  assert.equal(config.isQuotaExempt(ID, {}), false, 'aucune liste : personne'); assert.equal(config.isQuotaExempt(ID, { DERMAI_ADMIN_USER_IDS: '*' }), false); assert.equal(config.isQuotaExempt(ID, { DERMAI_ADMIN_USER_IDS: ID + ',x' }), false, 'une entrée invalide invalide toute la liste');
  assert.equal(quota.isExempt(ID, env()), true); assert.equal(quota.isExempt(OTHER, env()), false);
});

test('QE2 source : chaque fonction payante ne saute la réservation que pour un compte exempté, après toutes les vérifications et juste avant le fournisseur', () => {
  const cases = [['api/skin-analysis.js', 'reserve', 'perfectcorp.analyzeSkin('], ['api/skin-simulation.js', 'reserveSimulation', 'simulation.simulate('], ['api/makeup-vto.js', 'reserveMakeup', 'studio.tryOn('], ['api/hair-vto.js', 'reserveHair', 'provider.tryOn(']];
  for (const [f, fn, provider] of cases) {
    const s = read(f), ex = s.indexOf('quota.isExempt(user.id)'), rs = s.indexOf('quota.' + fn + '(');
    assert.ok(ex > 0 && rs > ex, f + ' : test d\'exemption avant la réservation');
    assert.equal((s.match(/quota\.isExempt\(/g) || []).length, 1, f); assert.equal((s.match(new RegExp('quota\\.' + fn + '\\(', 'g')) || []).length, 1, f + ' : une seule réservation');
    assert.match(s.slice(ex, rs), /^quota\.isExempt\(user\.id\)\) console\.log\('\[DermAI\] [A-Za-z ]+ quota skipped \(founder account\)'\);\s*else \{ await /, f + ' : sinon, la réservation habituelle');
    assert.ok(!/user\.id|user\.email/.test(s.slice(ex, rs).replace('quota.isExempt(user.id)', '')), f + ' : aucune donnée de la personne dans le journal');
    assert.ok(rs < s.indexOf(provider, rs), f + ' : le fournisseur est appelé après');
  }
});
