'use strict';
/* Navigation : la page courante est dans l'adresse (rechargement, précédent / suivant) ; le logo ramène à l'accueil. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const app = fs.readFileSync(path.join(__dirname, '../js/app.js'), 'utf8');

test('N1 la page courante est écrite dans l\'adresse et restaurée au rechargement', () => {
  assert.match(app, /const hashOf=/);
  assert.match(app, /function readHash\(\)/);
  assert.match(app, /function syncHash\(replace\)/);
  assert.match(app, /if\(!noHash\)syncHash\(replace\)/);
  assert.match(app, /const initialRoute=readHash\(\);\s*if\(initialRoute\)\{state\.route=initialRoute\.route/);
  assert.match(app, /window\.addEventListener\(`popstate`/);
});

test('N2 une analyse en cours n\'est jamais restaurée ; seules les pages connues le sont', () => {
  assert.match(app, /if\(r===`analyzing`\)return\{route:`home`,param:null\}/);
  const m = app.match(/const RESTORABLE=new Set\(\[([^\]]*)\]\)/);
  assert.ok(m);
  assert.doesNotMatch(m[1], /analyzing/);
  for (const r of ['landing', 'login', 'signup', 'home', 'result', 'routine', 'actives', 'progress', 'profile', 'privacy']) assert.ok(m[1].includes('`' + r + '`'), r);
  assert.match(app, /RESTORABLE\.has\(r\)&&V\[r\]/);
});

test('N3 connecté et arrivé à la racine : son espace s\'ouvre ; une page choisie (ex. #landing) est respectée', () => {
  assert.match(app, /if\(u&&arrivedWithoutPage&&state\.route===`landing`\)\{go\(`home`/);
  assert.match(app, /bootAccount\(!initialRoute\)/);
});

test('N4 le logo DERMAI est un bouton vers la page d\'accueil, partout', () => {
  assert.doesNotMatch(app, /<span class="brand"/);
  const logos = app.match(/<button class="brand" type="button" data-go="landing" data-reset="1" aria-label="DERMAI, page d'accueil"/g) || [];
  assert.ok(logos.length >= 6, String(logos.length));
  assert.match(app, /<div class="m-brand">/, 'logo aussi en tête des pages de l\'application sur mobile');
  const css = fs.readFileSync(path.join(__dirname, '../css/components/nav.css'), 'utf8');
  assert.match(css, /button\.brand\{[^}]*min-height:var\(--tap\)/);
});
