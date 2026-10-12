'use strict';
/* Après la création d'un compte, les questions (objectifs d'abord) s'ouvrent d'elles-mêmes.
   Cause corrigée : le déclencheur de la base crée à l'inscription une ligne de profil NEUTRE ; l'application la prenait pour « préférences déjà enregistrées » et ouvrait l'accueil.
   Tests : client de compte (pristine), puis parcours réels dans js/app.js, dans Chromium, réseau simulé (le faux Supabase imite le déclencheur). Navigateur ignoré si Playwright est absent. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Account = require('../js/account.js');
const H = require('./helpers/browser-harness.js');
const { createFake, memoryStorage } = require('./helpers/fake-supabase.js');

const URL = 'https://demo.supabase.co', KEY = 'public-anon-key';
const mk = fake => Account.create({ url: URL, anonKey: KEY, fetch: fake.fetch, storage: memoryStorage(), now: fake.state.now });
const profileOf = (goals, level, gentle, exclusions) => ({ goals, level, comfort: { preferGentle: !!gentle }, exclusions: exclusions || [] });

test('OB1 « pristine » : vrai pour la ligne neutre créée à l\'inscription et pour une ligne absente ; faux dès qu\'un objectif, un niveau, l\'approche douce ou une exclusion est enregistré', async () => {
  const fake = createFake(), acc = mk(fake);
  await acc.signUp('a@exemple.com', 'motdepasse1');
  assert.equal((await acc.loadProfile()).pristine, true, 'ligne neutre du déclencheur');
  for (const [label, p] of [['objectif', profileOf(['hydration'], '', false)], ['niveau', profileOf([], 'none', false)], ['approche douce', profileOf([], '', true)], ['exclusion', profileOf([], '', false, ['retinol'])], ['tout', profileOf(['tone'], 'full', true, ['x'])]]) {
    await acc.saveProfile(p); const r = await acc.loadProfile(); assert.equal(r.pristine, false, label); assert.deepEqual(r.profile, p, label + ' : le profil lui-même est rendu tel quel');
  }
  await acc.saveProfile(profileOf([], '', false)); assert.equal((await acc.loadProfile()).pristine, true, 'tout retiré : de nouveau neutre');
  fake.removeProfile(acc.user.id); const gone = await acc.loadProfile(); assert.equal(gone.profile, null); assert.equal(gone.pristine, true, 'ligne absente : rien d\'enregistré');
  const odd = await acc.loadProfile(); assert.ok(typeof odd.pristine === 'boolean');
});

test('OB2 le profil rendu par loadProfile reste inchangé (aucune clé ajoutée au profil, aucune écriture pour décider)', async () => {
  const fake = createFake(), acc = mk(fake);
  await acc.signUp('a@exemple.com', 'motdepasse1'); const before = fake.log.length;
  const r = await acc.loadProfile();
  assert.deepEqual(Object.keys(r.profile).sort(), ['comfort', 'exclusions', 'goals', 'level']);
  assert.ok(fake.log.slice(before).every(l => l.method === 'GET'), 'lecture seule');
});

test('OB3 source : une seule décision, dans enterSession, partagée par l\'inscription, la connexion et le lien reçu par e-mail ; js/app.js reste sous le plafond', () => {
  const app = fs.readFileSync(path.join(__dirname, '..', 'js/app.js'), 'utf8');
  assert.match(app, /state\.noProfile=!r\.profile\|\|r\.pristine;/);
  assert.match(app, /const afterAuth=o=>state\.noProfile\?go\(`onb`,`1`,o\):go\(`home`,null,o\);/);
  assert.equal((app.match(/afterAuth\(/g) || []).length, 2, 'deux appels seulement : inscription ou connexion par formulaire, lien reçu par e-mail ; une seule définition');
  assert.ok(Buffer.byteLength(app) < 150000);
});

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

const text = page => page.evaluate(() => document.getElementById('app').innerText);
const boot = async env => { await env.page.goto('/'); await env.page.waitForFunction(() => typeof go === 'function' && typeof state !== 'undefined' && state.account.status !== 'loading', null, { timeout: 15000 }); };
const submit = async (page, kind, email, pw) => {
  await page.evaluate(k => go(k), kind); await page.waitForSelector(`form[data-form=${kind}]`);
  await page.fill('#f-mail', email); await page.fill('#f-pw', pw); await page.click(`form[data-form=${kind}] button[type=submit]`);
};
const onOnboarding = page => page.waitForFunction(() => state.route === 'onb' && String(state.param) === '1', null, { timeout: 15000 });
const onHome = page => page.waitForFunction(() => state.route === 'home', null, { timeout: 15000 });
const clean = env => { assert.deepEqual(env.stats.serverApi, []); assert.deepEqual(env.errors, []); assert.deepEqual(env.stats.escaped.filter(u => !/fonts\.(googleapis|gstatic)\.com/.test(u)), []); };

test('OB4 création de compte (session ouverte tout de suite) : la page « Quels sont vos objectifs ? » s\'ouvre d\'elle-même, première des trois questions', opts, async () => {
  const env = await H.open(browser, server, {}); await boot(env); const { page } = env;
  await submit(page, 'signup', 'nouvelle@exemple.com', 'motdepasse1'); await onOnboarding(page);
  const t = await text(page); assert.match(t, /Quels sont vos objectifs \?/); assert.match(t, /Facultatif/); assert.match(t, /0\/3 objectifs sélectionnés/);
  assert.equal(await page.evaluate(() => state.account.status), 'signedIn');
  assert.equal([...env.fake.profiles.values()].length, 1, 'le déclencheur a bien créé la ligne neutre (condition réelle de la base)');
  clean(env); await env.close();
});

test('OB5 parcours complet : objectifs, routine, produits, Terminer → accueil ; la connexion suivante ouvre l\'accueil (préférences enregistrées), pas les questions', opts, async () => {
  const env = await H.open(browser, server, {}); await boot(env); const { page } = env;
  await submit(page, 'signup', 'nouvelle@exemple.com', 'motdepasse1'); await onOnboarding(page);
  await page.click('button.opt[data-v=hydration]'); await page.click('button.opt[data-v=tone]');
  await page.click('[data-go="onb:2"]'); await page.waitForSelector('button.opt[data-act=level]'); await page.click('button.opt[data-act=level][data-v=simple]');
  await page.click('[data-go="onb:3"]'); await page.click('[data-act=finish-onb]'); await onHome(page);
  await page.waitForFunction(() => state.save.status === 'saved', null, { timeout: 10000 });
  const row = [...env.fake.profiles.values()][0]; assert.deepEqual([row.goals, row.routine_level], [['hydration', 'tone'], 'simple']);
  await page.evaluate(() => logout()); await page.waitForFunction(() => state.account.status === 'visitor');
  await submit(page, 'login', 'nouvelle@exemple.com', 'motdepasse1'); await onHome(page);
  assert.notEqual(await page.evaluate(() => state.route), 'onb'); assert.deepEqual(await page.evaluate(() => state.goals), ['hydration', 'tone']);
  clean(env); await env.close();
});

test('OB6 compte resté neutre (rien enregistré) : la connexion ouvre les questions ; un compte avec au moins un objectif ouvre l\'accueil', opts, async () => {
  const env = await H.open(browser, server, { user: { email: 'neutre@exemple.com' } }); await boot(env); const { page } = env;
  await page.evaluate(() => logout()); await page.waitForFunction(() => state.account.status === 'visitor');
  await submit(page, 'login', 'neutre@exemple.com', 'motdepasse1'); await onOnboarding(page);
  assert.match(await text(page), /Quels sont vos objectifs \?/);
  /* même compte, objectif enregistré dans la base : accueil */
  const row = [...env.fake.profiles.values()][0]; row.goals = ['aging'];
  await page.evaluate(() => logout()); await page.waitForFunction(() => state.account.status === 'visitor');
  await submit(page, 'login', 'neutre@exemple.com', 'motdepasse1'); await onHome(page);
  assert.deepEqual(await page.evaluate(() => state.goals), ['aging']);
  clean(env); await env.close();
});

test('OB7 inscription avec confirmation par e-mail : message puis connexion ; le lien reçu ouvre les questions d\'elles-mêmes', opts, async () => {
  const fake = createFake({ confirmEmails: true });
  const env = await H.open(browser, server, { fake }); await boot(env); const { page } = env;
  await submit(page, 'signup', 'mail@exemple.com', 'motdepasse1');
  await page.waitForFunction(() => state.route === 'login' && /confirm/i.test(document.getElementById('app').innerText), null, { timeout: 15000 });
  assert.equal(await page.evaluate(() => state.account.status), 'visitor', 'pas encore de session');
  const link = fake.confirmLink('mail@exemple.com');
  await page.goto('/#' + link.slice(1)); await onOnboarding(page);
  assert.match(await text(page), /Quels sont vos objectifs \?/); assert.equal(await page.evaluate(() => state.account.status), 'signedIn');
  assert.ok(!(await page.evaluate(() => location.href)).includes('access_token'), 'jetons effacés de l\'adresse');
  clean(env); await env.close();
});

test('OB8 un rechargement de page ne ramène pas aux questions pour qui a déjà une session et des préférences ; « Passer » à la dernière question laisse l\'accueil', opts, async () => {
  const env = await H.open(browser, server, {}); await boot(env); const { page } = env;
  await submit(page, 'signup', 'nouvelle@exemple.com', 'motdepasse1'); await onOnboarding(page);
  await page.click('button.opt[data-v=hydration]'); await page.click('[data-go="onb:2"]'); await page.click('[data-go="onb:3"]'); await page.click('.link[data-act=finish-onb]'); await onHome(page);
  await page.waitForFunction(() => state.save.status === 'saved', null, { timeout: 10000 });
  await page.reload(); await page.waitForFunction(() => state.account.status === 'signedIn' && state.route === 'home', null, { timeout: 15000 });
  assert.notEqual(await page.evaluate(() => state.route), 'onb'); clean(env); await env.close();
});
