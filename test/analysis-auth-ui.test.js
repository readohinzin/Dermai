'use strict';
/* Côté navigateur : une analyse exige un compte. Visiteur → message humain + connexion ; connecté → le jeton de session accompagne la requête. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Account = require('../js/account.js');
const { createFake, memoryStorage } = require('./helpers/fake-supabase.js');
const app = fs.readFileSync(path.join(__dirname, '../js/app.js'), 'utf8');

test('AU1 visiteur : message humain et orientation vers la connexion, jamais d\'erreur technique', () => {
  assert.match(app, /const AUTH_NEEDED = `Connectez-vous pour analyser votre peau\.`/);
  assert.match(app, /const needsLogin=\(\)=>!DEMO_MODE&&state\.account\.status===`visitor`/);
  assert.match(app, /function askLogin\(\)\{state\.account\.info=AUTH_NEEDED;[^}]*go\(`login`/);
  assert.match(app, /if\(route===`scan`&&needsLogin\(\)\)\{[^}]*route=`login`/);                     // « Analyser ma peau » mène à la connexion
  assert.match(app, /case `scan-start`:if\(needsLogin\(\)\)\{askLogin\(\);break\}/);                // garde de dernier recours
  assert.match(app, /async function runRealAnalysis\(\)\{\s*const tok=\+\+anTok;\s*if\(needsLogin\(\)\)\{askLogin\(\);return\}/);   // aucune requête partie
  assert.match(app, /state\.route===`scan`\|\|state\.route===`analyzing`\)\{askLogin\(\);return\}/);          // adresse /scan ouverte directement
});

test('AU2 le démo n\'est pas concerné ; la navigation publique non plus (seule la route scan est redirigée)', () => {
  assert.match(app, /needsLogin=\(\)=>!DEMO_MODE/);
  const g = app.slice(app.indexOf('function go('), app.indexOf('anTok++', app.indexOf('function go(')));
  assert.equal((g.match(/route===`/g) || []).length, 2);                 // forgot (efface les messages) et scan (visiteur → connexion)
  assert.match(g, /route===`forgot`/); assert.match(g, /route===`scan`&&needsLogin\(\)/);
});

test('AU3 le jeton de session est envoyé au backend ; refus 401 du serveur → retour à la connexion sans détail', () => {
  assert.match(app, /const token=ACCOUNT\?await ACCOUNT\.accessToken\(\):null/);
  assert.match(app, /if\(token\)x\.setRequestHeader\(`Authorization`,`Bearer \$\{token\}`\)/);
  assert.match(app, /if\(x\.status===401\)return reject\(Object\.assign\(userError\(AUTH_NEEDED\),\{authRequired:true\}\)\)/);
  assert.match(app, /if\(err&&err\.authRequired\)\{if\(signedIn\(\)\)expireSession\(\);else askLogin\(\);return\}/);
});

test('AU4 accessToken : jeton de la session, rafraîchi près de l\'expiration, null sans session ; jamais d\'identifiant utilisateur envoyé', async () => {
  const fake = createFake(), st = memoryStorage();
  const acc = Account.create({ url: 'https://demo.supabase.co', anonKey: 'k', fetch: fake.fetch, storage: st, now: fake.state.now });
  assert.equal(await acc.accessToken(), null);
  await acc.signUp('a@exemple.com', 'motdepasse1');
  const t1 = await acc.accessToken(); assert.match(t1, /^[\w-]+\.[\w-]+\.[\w-]+$/);
  fake.state.advance(3590);                                           // à moins d'une minute de l'expiration
  const t2 = await acc.accessToken(); assert.notEqual(t2, t1, 'jeton rafraîchi');
  assert.ok(fake.log.some(l => l.path.includes('grant_type=refresh_token')));
  await acc.signOut(); assert.equal(await acc.accessToken(), null);
});
