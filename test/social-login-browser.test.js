'use strict';
/* Connexion Google dans le VRAI js/app.js, dans Chromium, réseau simulé (aucun Google, aucun Apple, Supabase factice). Ignoré si Playwright / Chromium sont absents. */
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
const text = page => page.evaluate(() => document.body.innerText);

test('SLB1 par défaut : aucun bouton Google ni Apple sur la connexion et l\'inscription', opts, async () => {
  server.stats.social = undefined;
  const env = await H.open(browser, server);
  const { page } = env;
  for (const route of ['login', 'signup']) {
    await page.goto('/'); await page.waitForFunction(() => typeof go === 'function' && state.account.status === 'visitor');
    await page.evaluate(r => go(r), route);
    assert.equal(await page.locator('[data-social]').count(), 0, route);
    assert.doesNotMatch(await text(page), /Continuer avec (Google|Apple)|ou avec votre adresse e-mail/);
  }
  assert.deepEqual(env.errors, []); await env.close();
});

test('SLB2 « google » ouvert : bouton Google seul, sur les deux écrans ; un clic envoie vers Supabase /authorize avec retour sur le site', opts, async () => {
  server.stats.social = ['google'];
  const env = await H.open(browser, server);
  const { page } = env;
  await page.goto('/'); await page.waitForFunction(() => typeof go === 'function' && state.account.status === 'visitor');
  for (const route of ['signup', 'login']) {
    await page.evaluate(r => go(r), route);
    assert.equal(await page.locator('[data-social=google]').count(), 1, route); assert.equal(await page.locator('[data-social=apple]').count(), 0, 'Apple non ouvert');
    assert.match(await text(page), /Continuer avec Google/); assert.match(await text(page), /ou avec votre adresse e-mail/);
    assert.equal(await page.locator('form[data-form] input[name=email]').count(), 1, 'le formulaire e-mail reste');
  }
  const req = page.waitForRequest(r => r.url().includes('/auth/v1/authorize'));
  await page.click('[data-social=google]');
  const u = new URL((await req).url());
  assert.equal(u.origin, H.SB); assert.equal(u.pathname, '/auth/v1/authorize'); assert.equal(u.searchParams.get('provider'), 'google');
  assert.equal(u.searchParams.get('redirect_to'), `http://127.0.0.1:${server.address().port}/`);
  assert.ok(!/anon-key/.test(u.toString()), 'aucune clé dans l\'adresse');
  assert.deepEqual(env.stats.serverApi, []);
  assert.ok(!env.stats.escaped.filter(x => !/fonts\.(googleapis|gstatic)\.com/.test(x)).some(x => /google|apple/i.test(x)), 'aucune requête directe vers Google ou Apple');
  server.stats.social = undefined; await env.close();
});

test('SLB3 retour de Google : session ouverte après vérification, bienvenue, adresse nettoyée, entrée dans l\'app', opts, async () => {
  server.stats.social = ['google'];
  const fake = H.createFake();
  const env = await H.open(browser, server, { fake });
  const { page } = env;
  const su = JSON.parse(await (await fake.fetch(`${H.SB}/auth/v1/signup`, { method: 'POST', headers: { apikey: 'anon-key-for-tests' }, body: JSON.stringify({ email: 'g@exemple.com', password: 'motdepasse1' }) })).text());
  await page.goto(`/#access_token=${su.access_token}&refresh_token=${su.refresh_token}&expires_in=3600&provider_token=ya29.test&token_type=bearer`);
  await page.waitForFunction(() => typeof state !== 'undefined' && state.account.status === 'signedIn', null, { timeout: 15000 });
  assert.equal(await page.evaluate(() => state.account.email), 'g@exemple.com');
  await page.waitForFunction(() => /Vous êtes connecté\. Bienvenue/.test(document.body.innerText), null, { timeout: 5000 });
  assert.doesNotMatch(await page.evaluate(() => location.href), /access_token|provider_token/, 'les jetons ne restent pas dans la barre d\'adresse');
  assert.ok(['onb', 'home'].includes(await page.evaluate(() => state.route)), 'dans l\'app (questionnaire de départ ou accueil), plus sur la connexion');
  assert.doesNotMatch(await text(page), /Votre adresse e-mail est confirmée/);
  assert.deepEqual(env.errors, []); server.stats.social = undefined; await env.close();
});

test('SLB4 refus chez Google : retour sur la connexion avec un message propre, aucune session', opts, async () => {
  server.stats.social = ['google'];
  const env = await H.open(browser, server);
  const { page } = env;
  await page.goto('/#error=access_denied&error_code=access_denied&error_description=Access+denied+by+user');
  await page.waitForFunction(() => typeof state !== 'undefined' && state.route === 'login', null, { timeout: 15000 });
  assert.match(await text(page), /Connexion annulée\. Vous pouvez réessayer, ou utiliser votre adresse e-mail\./);
  assert.doesNotMatch(await text(page), /Access denied|error_description/);
  assert.equal(await page.evaluate(() => state.account.status), 'visitor');
  assert.equal(await page.evaluate(() => localStorage.getItem('dermai.session')), null);
  server.stats.social = undefined; await env.close();
});
