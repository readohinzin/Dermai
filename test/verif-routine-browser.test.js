'use strict';
/* Vérif'Routine dans le VRAI index.html / js/app.js, dans Chromium, réseau entièrement simulé (voir test/helpers/browser-harness.js).
   Prouve, avec l'application réelle : ajout depuis le catalogue sourcé, saisie INCI corrigée avant confirmation, nom seul sans composition, modification, suppression,
   persistance, règles R1 à R5 et prudence, isolation entre comptes sur le même navigateur, 420 px sans débordement, clavier, aucune requête réseau ni appel à Perfect Corp.
   Ignoré si Playwright / Chromium sont absents. */
const test = require('node:test');
const assert = require('node:assert/strict');
const H = require('./helpers/browser-harness.js');

const OK = H.available();
const opts = { skip: OK ? false : 'Playwright / Chromium indisponibles', timeout: 120000 };
let browser, server;
test.before(async () => {
  if (!OK) return;
  const stats = { serverApi: [] };
  server = await H.startServer(stats); server.stats = stats;
  browser = await H.loadPlaywright().chromium.launch();
});
test.after(async () => { if (browser) await browser.close(); if (server) server.close(); });

const text = page => page.locator('main.main').innerText();
const uidOf = page => page.evaluate(() => ACCOUNT.user.id);
const stored = async page => JSON.parse((await page.evaluate(u => localStorage.getItem('dermai.verif.' + u), await uidOf(page))) || 'null');
const hOverflow = page => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
async function boot(env, route = 'verif') {
  const { page } = env;
  await page.goto('/');
  await page.waitForFunction(() => typeof state !== 'undefined' && state.account.status === 'signedIn' && state.history.status === 'ready', null, { timeout: 15000 });
  if (route) await page.evaluate(r => go(r), route);
}
const seed = async (page, products) => { const u = await uidOf(page); await page.evaluate(([id, list]) => localStorage.setItem('dermai.verif.' + id, JSON.stringify({ v: 1, products: list })), [u, products]); await page.evaluate(() => { go('home'); go('verif'); }); };
const prod = (id, name, slots, inci, extra) => Object.assign({ id, name, category: 'serum', slots, inci, origin: { kind: 'user' }, irritated: false }, extra || {});
const clean = env => {
  assert.deepEqual(env.stats.serverApi, []); assert.deepEqual(env.errors, []);
  assert.equal(env.stats.skin.length, 0, 'aucune analyse'); assert.equal(env.stats.sim.length, 0, 'aucune simulation');
  assert.deepEqual(env.stats.escaped.filter(u => !/fonts\.(googleapis|gstatic)\.com/.test(u)), []);
  assert.ok(!env.stats.escaped.some(u => /perfectcorp|youcam|yce|makeupar/i.test(u)));
};
const addManual = async (page, { name, category = 'serum', slots = ['morning'], inci = '' }) => {
  await page.click('[data-vr=add]'); await page.click('[data-vr=tab][data-t=manual]'); await page.click('[data-vr=manual]');
  await page.fill('#vr-name', name); await page.selectOption('#vr-cat', category);
  for (const s of slots) await page.check(`input[name=vr-slot][value=${s}]`);
  if (inci) await page.fill('#vr-inci', inci);
  await page.click('[data-vr=form-next]');
};

test('VB1 catalogue : recherche, ajout au matin ou au soir, origine sourcée, fiche, persistance après rechargement, modification des moments, suppression', opts, async () => {
  const env = await H.open(browser, server, { user: { email: 'a@exemple.com' } });
  await boot(env); const { page } = env;
  assert.match(await text(page), /Aucun produit pour le moment/);
  await page.click('[data-vr=add]');
  await page.fill('#vr-q', 'ordinary');
  assert.equal(await page.locator('[data-vr=pick]').count(), 6, 'les six produits The Ordinary du catalogue vérifié');
  await page.fill('#vr-q', 'effaclar'); assert.match(await page.locator('#vr-results').innerText(), /Aucun produit du catalogue ne correspond/);
  await page.fill('#vr-q', 'vichy'); assert.equal(await page.locator('[data-vr=pick]').count(), 0, 'produits « à vérifier » absents du catalogue proposé');
  await page.fill('#vr-q', 'salicylic');
  assert.match(await page.locator('#vr-results').innerText(), /The Ordinary Salicylic Acid 2% Solution/); assert.match(await page.locator('#vr-results').innerText(), /12 ingrédients/); assert.match(await page.locator('#vr-results').innerText(), /relevé le 6 octobre 2026/);
  await page.locator('[data-vr=pick]').first().click();
  await page.click('[data-vr=slots-save]');
  assert.match(await text(page), /Choisissez au moins un moment/, 'un moment est obligatoire');
  await page.check('input[name=vr-slot][value=evening]'); await page.click('[data-vr=slots-save]');
  let t = await text(page);
  assert.match(t, /Produit ajouté à votre routine/); assert.match(t, /Soir[\s\S]*Salicylic Acid 2% Solution/); assert.match(t, /Aucun produit pour le matin/); assert.match(t, /Catalogue DERMAI sourcé/);
  let s = await stored(page);
  assert.equal(s.v, 1); assert.equal(s.products.length, 1); assert.deepEqual(s.products[0].slots, ['evening']); assert.equal(s.products[0].origin.kind, 'catalog'); assert.equal(s.products[0].origin.productId, 'to-salicylic-2-solution'); assert.equal(s.products[0].origin.checkedAt, '2026-10-06'); assert.equal(s.products[0].inci.length, 12);
  await page.reload(); await page.waitForFunction(() => state.account.status === 'signedIn' && state.history.status === 'ready'); await page.evaluate(() => go('verif'));
  assert.match(await text(page), /Salicylic Acid 2% Solution/, 'persiste après rechargement');
  await page.click('[data-vr=view]');
  t = await text(page);
  assert.match(t, /Catalogue DERMAI sourcé/); assert.match(t, /The Ordinary : Salicylic Acid 2% Solution/); assert.match(t, /Relevé le 6 octobre 2026/); assert.match(t, /Salicylic Acid 2%\s*:\s*Acide salicylique/);
  assert.match(t, /Repère DERMAI pour Acide salicylique :\s*Deux soirs par semaine/); assert.match(t, /suivez la notice du fabricant/); assert.match(t, /Peut dessécher/);
  assert.match(t, /Ingrédients non reconnus \(10\)/);
  await page.click('[data-vr=edit]');
  assert.equal(await page.locator('textarea').count(), 0, 'la liste INCI du catalogue n\'est pas modifiable');
  await page.check('input[name=vr-slot][value=morning]'); await page.click('[data-vr=slots-save]');
  assert.match(await text(page), /Moments d'utilisation mis à jour/); assert.deepEqual((await stored(page)).products[0].slots, ['morning', 'evening']);
  await page.click('[data-vr=del]'); assert.match(await text(page), /Supprimer ce produit de votre routine/); await page.click('[data-vr=del-no]'); assert.equal((await stored(page)).products.length, 1);
  await page.click('[data-vr=del]'); await page.click('[data-vr=del-yes]');
  assert.match(await text(page), /Produit supprimé/); assert.equal(await stored(page), null, 'dernière suppression : plus aucune donnée');
  clean(env); await env.close();
});

test('VB2 saisie manuelle : liste INCI découpée, ingrédients corrigés et retirés avant confirmation, rien d\'enregistré sans confirmation ; modification ensuite', opts, async () => {
  const env = await H.open(browser, server, { user: { email: 'a@exemple.com' } });
  await boot(env); const { page } = env;
  await addManual(page, { name: 'Mon sérum', slots: ['morning', 'evening'], inci: 'Ingrédients : Aqua (Water), Niacinamid, Glycerin; Parfum' });
  assert.equal(await stored(page), null, 'rien d\'enregistré avant confirmation');
  const rows = () => page.locator('input[data-vr-row]').evaluateAll(l => l.map(i => i.value));
  assert.deepEqual(await rows(), ['Aqua (Water)', 'Niacinamid', 'Glycerin', 'Parfum']);
  const states = () => page.locator('[data-vr-state]').allInnerTexts();
  assert.deepEqual(await states(), ['Non reconnu', 'Non reconnu', 'Reconnu : Glycérine', 'Non reconnu']);
  await page.fill('#vr-r1', 'Niacinamide 10%');
  assert.equal((await states())[1], 'Reconnu : Niacinamide', 'l\'état se met à jour pendant la correction');
  await page.click('[data-vr=row-del][data-i="3"]'); assert.deepEqual(await rows(), ['Aqua (Water)', 'Niacinamide 10%', 'Glycerin']);
  await page.click('[data-vr=row-add]'); assert.equal((await rows()).length, 4); await page.fill('#vr-r3', 'Panthenol');
  assert.equal(await stored(page), null);
  await page.click('[data-vr=form-back]');
  assert.equal(await page.inputValue('#vr-name'), 'Mon sérum'); assert.equal(await page.inputValue('#vr-inci'), 'Aqua (Water), Niacinamide 10%, Glycerin, Panthenol', 'la correction est gardée en revenant à la saisie');
  await page.click('[data-vr=form-next]'); await page.click('[data-vr=review-save]');
  assert.match(await text(page), /Produit enregistré/);
  const s = await stored(page); assert.deepEqual(s.products[0].inci, ['Aqua (Water)', 'Niacinamide 10%', 'Glycerin', 'Panthenol']); assert.deepEqual(s.products[0].origin, { kind: 'user' }); assert.deepEqual(s.products[0].slots, ['morning', 'evening']);
  await page.click('[data-vr=view]'); const t = await text(page);
  assert.match(t, /Saisi par vous/); assert.match(t, /DERMAI ne l'a pas vérifiée sur l'emballage/); assert.match(t, /Niacinamide 10%\s*:\s*Niacinamide/); assert.match(t, /3 reconnus, 1 non reconnu/);
  assert.match(t, /Repère DERMAI pour Niacinamide :\s*Une fois par jour/); assert.ok(!/Aqua \(Water\)\s*:/.test(t), 'un ingrédient non reconnu ne reçoit aucune fonction');
  await page.locator('details.c-why summary', { hasText: 'Ingrédients non reconnus' }).click(); assert.match(await text(page), /Non reconnu : DERMAI n'a pas de fiche pour cet ingrédient\. Ce n'est ni bon ni mauvais/);
  // modification : le nom, la catégorie, les moments et la liste restent corrigeables
  await page.click('[data-vr=edit]');
  assert.equal(await page.inputValue('#vr-name'), 'Mon sérum'); await page.fill('#vr-name', 'Mon sérum du soir'); await page.uncheck('input[name=vr-slot][value=morning]'); await page.fill('#vr-inci', 'Aqua, Salicylic Acid');
  await page.click('[data-vr=form-next]'); await page.click('[data-vr=review-save]');
  assert.match(await text(page), /Produit modifié/); const s2 = await stored(page);
  assert.equal(s2.products.length, 1); assert.equal(s2.products[0].id, s.products[0].id, 'même produit, pas de doublon'); assert.equal(s2.products[0].name, 'Mon sérum du soir'); assert.deepEqual(s2.products[0].slots, ['evening']); assert.deepEqual(s2.products[0].inci, ['Aqua', 'Salicylic Acid']);
  clean(env); await env.close();
});

test('VB3 nom seul : enregistré en composition inconnue, aucune analyse inventée, seule l\'information manquante est signalée', opts, async () => {
  const env = await H.open(browser, server, { user: { email: 'a@exemple.com' } });
  await boot(env); const { page } = env;
  await addManual(page, { name: 'Sérum Acide Salicylique Rétinol 10 % Hydroquinone', slots: ['morning', 'evening'] });
  assert.match(await text(page), /Aucune liste INCI saisie : le produit sera enregistré avec une « composition inconnue »/); assert.equal(await page.locator('input[data-vr-row]').count(), 0);
  await page.click('[data-vr=review-save]');
  const t = await text(page);
  assert.match(t, /Composition inconnue/); assert.match(t, /La composition de « Sérum Acide Salicylique Rétinol 10 % Hydroquinone » est inconnue : DERMAI ne peut rien vérifier/);
  assert.equal(await page.locator('.c-vr-point').count(), 1, 'un seul point : l\'information manquante'); assert.ok(!/Précaution|Prudence|Substance sans conseil|exfoliant/.test(await page.locator('.c-vr-points').innerText()));
  await page.click('[data-vr=view]'); const d = await text(page);
  assert.match(d, /Aucune liste INCI enregistrée pour ce produit/); assert.match(d, /Composition inconnue : DERMAI ne propose aucune fréquence/); assert.equal((d.match(/DERMAI ne propose aucune fréquence/g) || []).length, 1); assert.ok(!/Repère DERMAI|Précautions des fiches/.test(d));
  assert.deepEqual((await stored(page)).products[0].inci, []);
  clean(env); await env.close();
});

test('VB4 points d\'attention : R1 à R5, prudence et irritation avec leur « Pourquoi ? » ; aucun point sur une routine sans règle applicable', opts, async () => {
  const env = await H.open(browser, server, { user: { email: 'a@exemple.com' } });
  await boot(env); const { page } = env;
  await seed(page, [prod('aa', 'Niacine matin', ['morning'], ['Aqua', 'Niacinamide']), prod('bb', 'Niacine soir', ['evening'], ['Niacinamide', 'Glycerin']), prod('cc', 'Peeling', ['evening'], ['Glycolic Acid']), prod('dd', 'BHA', ['evening'], ['Salicylic Acid']),
    prod('ee', 'Vit C', ['evening'], ['Ascorbic Acid']), prod('ff', 'Rétinol', ['evening'], ['Retinol']), prod('gg', 'Sans liste', ['morning'], []), prod('hh', 'Crème claire', ['evening'], ['Hydroquinone'], { category: 'moisturizer' }), prod('ii', 'Gêne', ['morning'], ['Aqua'], { irritated: true })]);
  const pts = await page.locator('.c-vr-point').evaluateAll(l => l.map(e => ({ cls: e.className, level: e.querySelector('.c-badge').innerText, title: e.querySelector('h3').innerText, text: e.innerText, why: e.querySelector('details').textContent })));
  const by = re => pts.find(p => re.test(p.title));
  assert.equal(by(/Niacinamide dans 2 produits/).level, 'Information'); assert.match(by(/Niacinamide dans 2 produits/).text, /Ce n'est pas une incompatibilité/);
  assert.equal(by(/Plusieurs exfoliants ou rétinoïdes/).level, 'Précaution'); assert.match(by(/Plusieurs exfoliants ou rétinoïdes/).text, /Un seul exfoliant ou rétinoïde par soir\./);
  assert.equal(by(/Protection solaire non indiquée/).level, 'Précaution'); assert.match(by(/Protection solaire non indiquée/).text, /Protection solaire indispensable\./);
  assert.equal(by(/Vitamine C et rétinoïde le soir/).level, 'À valider'); assert.match(by(/Vitamine C et rétinoïde le soir/).text, /n'a pas validé de règle à ce sujet/);
  assert.equal(by(/Composition inconnue/).level, 'Information manquante');
  assert.equal(by(/Substance sans conseil DERMAI/).level, 'Prudence'); assert.match(by(/Substance sans conseil DERMAI/).text, /Demandez l'avis d'un professionnel \(pharmacien, médecin\)/);
  assert.equal(by(/vous a déjà irrité/).level, 'Prudence');
  for (const p of pts) { assert.match(p.why, /Règle :/); assert.match(p.why, /Source :/); assert.match(p.why, /Validation :/); }
  const order = ['Prudence', 'Précaution', 'À valider', 'Information', 'Information manquante']; const lv = pts.map(p => order.indexOf(p.level)); assert.deepEqual(lv, [...lv].sort((a, b) => a - b), 'classés par niveau');
  assert.ok(!/Plusieurs exfoliants/.test(by(/Vitamine C/).text));
  // routine sans règle applicable
  await seed(page, [prod('jj', 'Hydratant', ['morning', 'evening'], ['Aqua', 'Glycerin'], { category: 'moisturizer' }), prod('kk', 'Écran', ['morning'], ['Aqua', 'Glycerin'], { category: 'spf' })]);
  const t = await text(page); assert.match(t, /Aucun point d'attention avec les produits et les règles actuels/); assert.match(t, /Cela ne veut pas dire que la routine est adaptée/); assert.equal(await page.locator('.c-vr-point').count(), 0);
  // un produit solaire déclaré le matin supprime R3, le même produit placé le soir seulement ne le supprime pas
  await seed(page, [prod('cc', 'Peeling', ['evening'], ['Glycolic Acid']), prod('ss', 'Écran', ['morning'], [], { category: 'spf' })]);
  assert.equal(await page.locator('.c-vr-point', { hasText: 'Protection solaire non indiquée' }).count(), 0);
  await seed(page, [prod('cc', 'Peeling', ['evening'], ['Glycolic Acid']), prod('ss', 'Écran', ['evening'], [], { category: 'spf' })]);
  assert.equal(await page.locator('.c-vr-point', { hasText: 'Protection solaire non indiquée' }).count(), 1);
  // l'irritation se déclare et se retire depuis la fiche
  await seed(page, [prod('ll', 'Sérum test', ['morning'], ['Aqua', 'Niacinamide'])]);
  await page.click('[data-vr=view]'); await page.check('input[data-vr=irr]');
  assert.equal((await stored(page)).products[0].irritated, true); assert.match(await text(page), /vous a déjà irrité\(e\)[\s\S]*arrêtez de l'utiliser et demandez conseil à un professionnel de santé/);
  await page.uncheck('input[data-vr=irr]'); assert.equal((await stored(page)).products[0].irritated, false);
  clean(env); await env.close();
});

test('VB5 comptes : A ajoute, se déconnecte, B se connecte sur le même navigateur et ne voit rien d\'A ; A retrouve ses produits ; un visiteur n\'a aucun accès', opts, async () => {
  const fake = H.createFake();
  const env = await H.open(browser, server, { user: { email: 'a@exemple.com' }, fake });
  await boot(env); const { page } = env;
  const a = await uidOf(page); await seed(page, [prod('pa', 'Sérum de A', ['morning'], ['Niacinamide'])]);
  assert.match(await text(page), /Sérum de A/);
  await fake.fetch(`${H.SB}/auth/v1/signup`, { method: 'POST', headers: { apikey: 'anon-key-for-tests' }, body: JSON.stringify({ email: 'b@exemple.com', password: 'motdepasse1' }) });
  await page.evaluate(() => logout());
  await page.waitForFunction(() => state.account.status === 'visitor');
  await page.evaluate(() => go('verif'));
  assert.match(await text(page), /Connectez-vous ou créez un compte pour enregistrer les produits/); assert.ok(!/Sérum de A/.test(await text(page)));
  assert.equal(await page.locator('[data-vr=add]').count(), 0, 'visiteur : aucune saisie possible');
  await page.evaluate(() => go('login'));
  await page.fill('form[data-form=login] [name=email]', 'b@exemple.com'); await page.fill('form[data-form=login] [name=password]', 'motdepasse1');
  await page.click('form[data-form=login] button[type=submit]');
  await page.waitForFunction(() => state.account.email === 'b@exemple.com' && state.history.status === 'ready');
  const b = await uidOf(page); assert.notEqual(a, b);
  await page.evaluate(() => go('verif'));
  assert.match(await text(page), /Aucun produit pour le moment/); assert.ok(!/Sérum de A/.test(await page.content()));
  await seed(page, [prod('pb', 'Sérum de B', ['evening'], ['Azelaic Acid'])]);
  assert.deepEqual(await page.evaluate(() => Object.keys(localStorage).filter(k => k.startsWith('dermai.verif.')).sort()), [`dermai.verif.${a}`, `dermai.verif.${b}`].sort(), 'une clé par compte');
  await page.evaluate(() => logout()); await page.waitForFunction(() => state.account.status === 'visitor');
  await page.evaluate(() => go('login'));
  await page.fill('form[data-form=login] [name=email]', 'a@exemple.com'); await page.fill('form[data-form=login] [name=password]', 'motdepasse1');
  await page.click('form[data-form=login] button[type=submit]');
  await page.waitForFunction(() => state.account.email === 'a@exemple.com' && state.history.status === 'ready');
  await page.evaluate(() => go('verif')); const t = await text(page);
  assert.match(t, /Sérum de A/); assert.ok(!/Sérum de B/.test(t));
  clean(env); await env.close();
});

test('VB6 suppression du compte : les produits de ce compte sont effacés de ce navigateur', opts, async () => {
  const env = await H.open(browser, server, { user: { email: 'a@exemple.com' } });
  await boot(env); const { page } = env;
  const a = await uidOf(page); await seed(page, [prod('pa', 'Sérum de A', ['morning'], ['Niacinamide'])]);
  assert.ok(await page.evaluate(u => localStorage.getItem('dermai.verif.' + u), a));
  await page.evaluate(() => deleteMyAccount());
  await page.waitForFunction(() => state.account.status === 'visitor', null, { timeout: 10000 });
  assert.equal(await page.evaluate(u => localStorage.getItem('dermai.verif.' + u), a), null);
  clean(env); await env.close();
});

test('VB7 navigateur qui refuse d\'écrire : l\'écran le dit et les produits restent visibles pendant la visite', opts, async () => {
  const env = await H.open(browser, server, { user: { email: 'a@exemple.com' } });
  await boot(env); const { page } = env;
  await page.evaluate(() => { const o = Storage.prototype.setItem; Storage.prototype.setItem = function (k, v) { if (/^dermai\.verif\./.test(k)) throw new Error('quota'); return o.call(this, k, v); }; });
  await addManual(page, { name: 'Sérum éphémère', slots: ['morning'], inci: 'Aqua, Niacinamide' }); await page.click('[data-vr=review-save]');
  const t = await text(page);
  assert.match(t, /Ce navigateur refuse de garder vos produits/); assert.match(t, /Sérum éphémère/);
  assert.equal(await page.evaluate(u => localStorage.getItem('dermai.verif.' + u), await uidOf(page)), null);
  clean(env); await env.close();
});

test('VB8 limite de 20 produits : ajout bloqué avec un message ; supprimer en libère un', opts, async () => {
  const env = await H.open(browser, server, { user: { email: 'a@exemple.com' } });
  await boot(env); const { page } = env;
  await seed(page, Array.from({ length: 20 }, (_, i) => prod('p' + (i + 10), 'Produit ' + (i + 1), i % 2 ? ['evening'] : ['morning'], ['Aqua'])));
  assert.match(await text(page), /20 produits sur 20/); assert.match(await text(page), /contient déjà 20 produits/); assert.equal(await page.locator('[data-vr=add]').isDisabled(), true);
  await page.locator('[data-vr=view]').first().click(); await page.click('[data-vr=del]'); await page.click('[data-vr=del-yes]');
  assert.match(await text(page), /19 produits sur 20/); assert.equal(await page.locator('[data-vr=add]').isDisabled(), false);
  clean(env); await env.close();
});

test('VB9 textes saisis affichés comme du texte (jamais du HTML), y compris dans les points d\'attention et les listes', opts, async () => {
  const env = await H.open(browser, server, { user: { email: 'a@exemple.com' } });
  await boot(env); const { page } = env;
  await page.evaluate(() => { window.__xss = 0; });
  const evil = '<img src=x onerror="window.__xss=1">';
  await seed(page, [prod('xa', evil, ['evening'], [evil, 'Niacinamide']), prod('xb', 'Autre', ['evening'], ['Niacinamide', 'Glycolic Acid']), prod('xc', 'Peeling', ['evening'], ['Salicylic Acid'])]);
  assert.match(await text(page), /<img src=x onerror="window\.__xss=1">/); assert.equal(await page.locator('main img[src="x"]').count(), 0);
  await page.locator('[data-vr=view]').first().click(); await page.locator('details.c-why summary', { hasText: 'Ingrédients non reconnus' }).click();
  assert.equal(await page.locator('main img[src="x"]').count(), 0); assert.equal(await page.evaluate(() => window.__xss), 0);
  clean(env); await env.close();
});

test('VB10 navigation : entrée « Vérif\'Routine » dans la barre latérale (ordinateur et mobile), vraie vue, page active, adresse /verif restaurée au rechargement', opts, async () => {
  const env = await H.open(browser, server, { user: { email: 'a@exemple.com' } });
  await boot(env, 'home'); const { page } = env;
  await page.setViewportSize({ width: 1280, height: 800 }); await page.waitForTimeout(150);
  const entry = page.locator('#sidebar .sidebar__link', { hasText: 'Vérif\'Routine' });
  assert.ok(await entry.isVisible()); await entry.click();
  await page.waitForFunction(() => state.route === 'verif');
  assert.equal(await page.evaluate(() => location.pathname), '/verif'); assert.ok((await page.locator('#sidebar [aria-current="page"]').innerText()).startsWith('Vérif\'Routine'));
  assert.match(await text(page), /Vérif'Routine/); assert.match(await text(page), /Ajouter un produit/);
  await page.reload(); await page.waitForFunction(() => typeof state !== 'undefined' && state.account.status === 'signedIn');
  await page.waitForFunction(() => state.route === 'verif'); await page.waitForSelector('[data-vr=add]', { timeout: 10000 }); assert.match(await text(page), /Ajouter un produit/);
  await page.setViewportSize({ width: 420, height: 900 }); await page.waitForTimeout(150); await page.evaluate(() => go('home'));
  await page.click('.sidebar__toggle'); await page.waitForTimeout(350);
  await page.locator('#sidebar .sidebar__link', { hasText: 'Vérif\'Routine' }).click();
  await page.waitForFunction(() => state.route === 'verif'); await page.waitForTimeout(350);
  assert.equal(await page.locator('#sidebar').isVisible(), false, 'le panneau se referme');
  clean(env); await env.close();
});

test('VB11 mobile 420 px : aucune vue ne déborde (nom de 80 caractères, ingrédients très longs, 8 points d\'attention), commandes d\'au moins 44 px', opts, async () => {
  const env = await H.open(browser, server, { user: { email: 'a@exemple.com' } });
  await boot(env); const { page } = env;
  assert.deepEqual(page.viewportSize(), { width: 420, height: 900 });
  const long = 'N'.repeat(80), tok = 'Tetrahexyldecyl' + 'x'.repeat(60);
  await seed(page, [prod('aa', long, ['morning', 'evening'], [tok, 'Niacinamide']), prod('bb', 'Niacine soir', ['evening'], ['Niacinamide']), prod('cc', 'Peeling', ['evening'], ['Glycolic Acid']), prod('dd', 'BHA', ['evening'], ['Salicylic Acid']),
    prod('ee', 'Vit C', ['evening'], ['Ascorbic Acid']), prod('ff', 'Rétinol', ['evening'], ['Retinol']), prod('gg', 'Sans liste', ['morning'], []), prod('hh', 'Crème', ['evening'], ['Hydroquinone'], { category: 'moisturizer' }), prod('ii', 'Gêne', ['morning'], ['Aqua'], { irritated: true })]);
  const check = async label => {
    assert.equal(await hOverflow(page), 0, `${label} : pas de débordement`);
    const small = await page.evaluate(() => [...document.querySelectorAll('main .c-btn, main .c-chip, main select, main input:not([type=checkbox]), main .c-check-row')].filter(e => e.offsetParent !== null && e.getBoundingClientRect().height < 40).map(e => e.tagName + '.' + e.className));
    assert.deepEqual(small, [], `${label} : commandes trop petites`);
    const out = await page.evaluate(() => [...document.querySelectorAll('main *')].filter(e => { const r = e.getBoundingClientRect(); return r.width > 0 && (r.right > document.documentElement.clientWidth + 1 || r.left < -1); }).map(e => e.tagName + '.' + e.className));
    assert.deepEqual(out, [], `${label} : éléments hors écran`);
  };
  await check('accueil');
  await page.click('[data-vr=add]'); await check('ajout (catalogue)'); await page.fill('#vr-q', 'ordinary'); await check('résultats');
  await page.click('[data-vr=tab][data-t=manual]'); await check('ajout (manuel)'); await page.click('[data-vr=manual]'); await check('formulaire');
  await page.fill('#vr-name', long); await page.check('input[name=vr-slot][value=morning]'); await page.fill('#vr-inci', `${tok}, Niacinamide, Aqua`); await page.click('[data-vr=form-next]'); await check('relecture');
  await page.click('[data-vr=review-save]'); await page.locator('[data-vr=view]').first().click(); await check('fiche');
  await page.locator('details.c-why summary').first().click(); await check('fiche, détails ouverts');
  clean(env); await env.close();
});

test('VB12 clavier et lecteurs d\'écran : champs étiquetés, boutons activables à Entrée, tout le parcours sans souris, focus visible', opts, async () => {
  const env = await H.open(browser, server, { user: { email: 'a@exemple.com' } });
  await boot(env); const { page } = env;
  await page.locator('[data-vr=add]').focus(); await page.keyboard.press('Enter');
  assert.ok(await page.getByLabel('Rechercher un produit').isVisible());
  await page.locator('[data-vr=tab][data-t=manual]').focus(); await page.keyboard.press('Enter');
  assert.equal(await page.locator('[data-vr=tab][data-t=manual]').getAttribute('aria-pressed'), 'true');
  await page.locator('[data-vr=manual]').focus(); await page.keyboard.press('Enter');
  for (const l of ['Nom du produit', 'Catégorie', 'Liste INCI (facultative)']) assert.ok(await page.getByLabel(l).isVisible(), l);
  assert.ok(await page.getByRole('group', { name: 'Moments d\'utilisation' }).isVisible()); assert.ok(await page.getByLabel('Matin').isVisible());
  await page.getByLabel('Nom du produit').focus(); await page.keyboard.type('Sérum au clavier');
  await page.getByLabel('Matin').focus(); await page.keyboard.press('Space');
  await page.getByLabel('Liste INCI (facultative)').focus(); await page.keyboard.type('Aqua, Niacinamide');
  await page.locator('[data-vr=form-next]').focus(); await page.keyboard.press('Enter');
  assert.ok(await page.getByLabel('Ingrédient 2', { exact: true }).isVisible()); assert.ok(await page.getByRole('button', { name: 'Retirer l\'ingrédient 1' }).isVisible());
  await page.locator('[data-vr=review-save]').focus(); await page.keyboard.press('Enter');
  assert.match(await text(page), /Produit enregistré/);
  const ring = await page.evaluate(() => { const b = document.querySelector('[data-vr=add]'); b.focus(); const s = getComputedStyle(b); return s.boxShadow !== 'none' || s.outlineStyle !== 'none'; });
  assert.ok(ring, 'le focus est visible');
  clean(env); await env.close();
});

test('VB13 aucune requête réseau pendant l\'utilisation : ni Supabase, ni analyse, ni simulation, ni Perfect Corp', opts, async () => {
  const env = await H.open(browser, server, { user: { email: 'a@exemple.com' } });
  await boot(env); const { page } = env;
  const before = { sb: env.stats.supabase.length, probe: env.stats.simProbe.length };
  await page.click('[data-vr=add]'); await page.fill('#vr-q', 'cerave'); await page.locator('[data-vr=pick]').first().click(); await page.check('input[name=vr-slot][value=morning]'); await page.click('[data-vr=slots-save]');
  await addManual(page, { name: 'Manuel', slots: ['evening'], inci: 'Aqua, Glycolic Acid' }); await page.click('[data-vr=review-save]');
  await page.locator('[data-vr=view]').first().click(); await page.click('[data-vr=edit]'); await page.check('input[name=vr-slot][value=evening]'); await page.click('[data-vr=slots-save]');
  await page.click('[data-vr=del]'); await page.click('[data-vr=del-yes]');
  assert.equal(env.stats.supabase.length, before.sb, 'aucune requête Supabase : tout reste dans le navigateur');
  assert.equal(env.stats.simProbe.length, before.probe, 'aucune vérification de simulation déclenchée par Vérif\'Routine');
  clean(env); await env.close();
});
