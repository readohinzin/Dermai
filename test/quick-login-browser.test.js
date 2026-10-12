'use strict';
/* Lien magique dans le VRAI js/app.js, dans Chromium, réseau simulé (aucun Google, Supabase factice). Ignoré si Playwright / Chromium sont absents. */
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

test('SLB1 lien magique : proposé sous le formulaire (connexion et inscription) ; une demande part avec l\'adresse saisie, message neutre, adresse conservée', opts, async () => {
  const fake = H.createFake();
  const env = await H.open(browser, server, { fake });
  const { page } = env;
  await page.goto('/'); await page.waitForFunction(() => typeof go === 'function' && state.account.status === 'visitor');
  for (const route of ['login', 'signup']) {
    await page.evaluate(r => go(r), route);
    assert.equal(await page.locator('[data-quick=magic]').count(), 1, route);
    assert.match(await text(page), /Recevoir un lien de connexion par e-mail/);
    assert.equal(await page.locator('[data-social]').count(), 0, 'aucun bouton de connexion tierce');
  }
  await page.fill('#f-mail', 'nouveau@exemple.com');
  await page.click('[data-quick=magic]');
  await page.waitForFunction(() => /Si cette adresse est valide, un lien de connexion vient d'être envoyé/.test(document.body.innerText));
  assert.deepEqual(fake.state.otpRequests, ['nouveau@exemple.com']);
  assert.equal(await page.inputValue('#f-mail'), 'nouveau@exemple.com', 'l\'adresse saisie est conservée');
  assert.equal(await page.evaluate(() => localStorage.getItem('dermai.session')), null, 'aucune session avant d\'avoir ouvert le lien');
  assert.deepEqual(env.stats.serverApi, []); assert.deepEqual(env.errors, []);
  await env.close();
});

test('SLB2 lien magique : adresse vide ou invalide = message, aucune demande ; double clic = une seule demande', opts, async () => {
  const fake = H.createFake();
  const env = await H.open(browser, server, { fake });
  const { page } = env;
  await page.goto('/'); await page.waitForFunction(() => typeof go === 'function' && state.account.status === 'visitor');
  await page.evaluate(() => go('login'));
  await page.click('[data-quick=magic]');
  await page.waitForFunction(() => /Saisissez une adresse e-mail valide/.test(document.body.innerText));
  assert.equal(fake.state.otpRequests, undefined, 'aucune demande sans adresse valide');
  await page.fill('#f-mail', 'pas-une-adresse'); await page.click('[data-quick=magic]');
  await page.waitForFunction(() => /Saisissez une adresse e-mail valide/.test(document.body.innerText));
  assert.equal(fake.state.otpRequests, undefined);
  await page.fill('#f-mail', 'ok@exemple.com');
  await page.evaluate(() => { const b = document.querySelector('[data-quick=magic]'); b.click(); b.click(); b.click(); });
  await page.waitForFunction(() => /un lien de connexion vient d'être envoyé/.test(document.body.innerText));
  assert.deepEqual(fake.state.otpRequests, ['ok@exemple.com'], 'une seule demande malgré trois clics');
  await env.close();
});

test('SLB3 ouverture du lien magique : connecté après vérification, « Vous êtes connecté. Bienvenue ! », adresse nettoyée ; lien expiré = message clair', opts, async () => {
  const fake = H.createFake();
  const env = await H.open(browser, server, { fake });
  const { page } = env;
  await fake.fetch(`${H.SB}/auth/v1/signup`, { method: 'POST', headers: { apikey: 'anon-key-for-tests' }, body: JSON.stringify({ email: 'm@exemple.com', password: 'motdepasse1' }) });
  await page.goto('/' + fake.magicLink('m@exemple.com'));
  await page.waitForFunction(() => typeof state !== 'undefined' && state.account.status === 'signedIn', null, { timeout: 15000 });
  assert.equal(await page.evaluate(() => state.account.email), 'm@exemple.com');
  await page.waitForFunction(() => /Vous êtes connecté\. Bienvenue/.test(document.body.innerText), null, { timeout: 5000 });
  assert.doesNotMatch(await page.evaluate(() => location.href), /access_token/, 'les jetons ne restent pas dans la barre d\'adresse');
  assert.doesNotMatch(await text(page), /Votre adresse e-mail est confirmée/);
  await page.goto('/' + fake.magicLink('inconnu@exemple.com'));
  await page.waitForFunction(() => typeof state !== 'undefined' && state.route === 'login', null, { timeout: 15000 });
  assert.match(await text(page), new RegExp('lien'), 'message de lien invalide ou expiré');
  assert.doesNotMatch(await text(page), /Connexion annulée/);
  assert.deepEqual(env.errors, []); await env.close();
});
