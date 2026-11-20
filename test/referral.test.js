'use strict';
/* Lot 7 (peaux foncées) : cas préoccupants (lésion qui dure, cicatrice en relief qui grossit, grain de beauté qui change) : renvoi vers un dermatologue, SANS interprétation.
   Les situations sont reconnues par la personne, jamais déduites d'un score. Aucun réseau hors du banc d'essai du navigateur. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const R = require('../js/engine/data/referral.js');
const D = require('../js/declared-concerns.js');
const SkinModel = require('../js/skin-model.js');
const H = require('./helpers/browser-harness.js');
const { run } = require('./helpers/engine.js');
const read = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const strip = h => h.replace(/<[^>]+>/g, ' ').replace(/&#39;/g, '\'').replace(/&amp;/g, '&').replace(/\s+/g, ' ');
const ALL = () => [R.TEXT.title, R.TEXT.intro, R.TEXT.summary, ...R.TEXT.signs, R.TEXT.cannot, R.TEXT.access, R.TEXT.urgent, R.TEXT.acne];

test('RF1 les trois situations du brief, et rien de plus : lésion qui dure, cicatrice en relief, grain de beauté qui change', () => {
  const s = R.TEXT.signs.join(' | ');
  assert.match(s, /plaie ou une tache qui dure plus de quelques semaines/);
  assert.match(s, /cicatrice en relief qui grossit, dépasse la zone de la blessure, démange ou fait mal/);
  assert.match(s, /grain de beauté ou une tache brune ou noire qui change de taille, de forme ou de couleur, qui saigne ou qui démange/);
  assert.match(s, /sous les ongles, sur les paumes et sur les plantes des pieds/, 'les grains de beauté se regardent aussi là, sur peau foncée');
  assert.match(R.TEXT.intro, /demandez l'avis d'un dermatologue/);
  assert.match(R.TEXT.access, /médecin généraliste ou un pharmacien/); assert.doesNotMatch(R.TEXT.access, /\d+\s*(€|fcfa|xof)/i, 'aucun prix cité');
  assert.match(R.TEXT.urgent, /consultez en urgence/);
});

test('RF2 AUCUNE interprétation : ni nom de maladie, ni gravité, ni rassurance ; « chéloïde » écrit une seule fois, entre parenthèses', () => {
  const all = ALL().join(' ');
  assert.doesNotMatch(all, /cancer|m[ée]lanome|tumeur|b[ée]nin|malin|gravit|grave\b|rassur|probablement|s[ûu]rement|sans danger|pas inqui|inqui[èe]t/i);
  assert.equal((all.match(/ch[ée]lo[ïi]de/gi) || []).length, 1); assert.match(all, /\(par exemple une chéloïde\)/);
  assert.match(R.TEXT.cannot, /ne peut ni examiner votre peau, ni dire ce que c'est, ni poser de diagnostic/);
  /* « diagnostic » n'apparaît que dans cette négation */
  assert.equal((all.match(/diagnostic/gi) || []).length, 1);
  const forbidden = [/(?<![\p{L}])vous avez (?!indiqu|choisi)/iu, /vous souffrez/i, /(?<![\p{L}])traiter/i, /(?<![\p{L}])il faut/i, /malad/i, /patholog/i, /pr[ée]scri/i, /gu[ée]ri/i, /(?<![\p{L}])soigner/i, /[ée]claircir/i, /d[ée]pigment/i];
  for (const t of ALL()) { for (const re of forbidden) assert.doesNotMatch(t, re, t); assert.ok(!/[—–]/.test(t), t); }
});

test('RF3 écran Résultat : toujours présent, liste repliée, trois phrases de clôture ; une phrase de plus si l\'acné est un axe retenu', () => {
  const calm = run({}, { raw: 70 }, { goals: [] });
  const h = D.referralNote(calm), t = strip(h);
  assert.ok(h.includes('data-referral') && h.includes('<details')); assert.match(t, /Quand en parler à un dermatologue/); assert.match(t, /Voir ces situations/);
  for (const sign of R.TEXT.signs) assert.ok(t.includes(sign), sign);
  for (const c of R.CLOSING) assert.ok(t.includes(c), c);
  assert.ok(!h.includes('data-referral-acne'));
  const acne = run({ acne: 20 }, { rawMap: { acne: 20 }, rawFill: 80 }, { goals: [] });
  assert.ok(acne.priorities.items.some(p => p.indicator === 'acne'), 'témoin : acné retenue');
  assert.ok(D.referralNote(acne).includes('data-referral-acne')); assert.match(strip(D.referralNote(acne)), /Votre analyse retient l'acné parmi vos axes de soin/);
  assert.ok(D.top(calm).includes('data-referral'));
  for (const bad of [undefined, null, 0, 'x', {}, { priorities: null }, { priorities: { items: [null, 3] } }]) assert.doesNotThrow(() => D.referralNote(bad));
});

test('RF4 jamais déduit d\'un score : la liste est la même pour toutes les analyses ; seule la phrase sur l\'acné dépend d\'un axe retenu', () => {
  const noAcne = h => h.replace(/<p[^>]*data-referral-acne[\s\S]*?<\/p>/, '');
  const a = D.referralNote(run({}, { raw: 90 }, { goals: [] })), b = D.referralNote(run({ hydration: 5, pigmentation: 5 }, { rawMap: { hydration: 5, pigmentation: 5 }, rawFill: 90 }, { goals: ['tone'] })),
    c = D.referralNote(run({ acne: 5 }, { rawMap: { acne: 5 }, rawFill: 90 }, { goals: [] }));
  assert.equal(noAcne(a), noAcne(b)); assert.equal(noAcne(a), noAcne(c));
  assert.ok(!/(score|\/100|\d{2}\b)/.test(strip(a).replace(/DermAI/g, '')), 'aucune note chiffrée');
  assert.doesNotMatch(read('js/engine/data/referral.js').replace(/\/\*[\s\S]*?\*\//g, ''), /interpretation|indicators|rawScore|uiScore/);
});

test('RF5 page du programme : le même bloc dans les deux vues (avant et pendant) ; moteur et app.js inchangés', () => {
  const care = read('js/care-program.js');
  assert.equal((care.match(/\$\{referralBlock\(\)\}\$\{safety\(\)\}/g) || []).length, 2); assert.match(care, /data-referral-block/);
  const html = read('index.html'), at = s => html.indexOf('<script src="js/' + s + '"></script>');
  assert.ok(at('engine/data/referral.js') > 0 && at('engine/data/referral.js') < at('declared-concerns.js') && at('declared-concerns.js') < at('app.js'));
  assert.equal(Buffer.byteLength(read('js/app.js')), 149389, 'app.js : taille fixée, plafond non relevé');
  assert.doesNotMatch(read('js/engine/data/referral.js').replace(/\/\*[\s\S]*?\*\//g, ''), /fetch\(|XMLHttpRequest|localStorage|sessionStorage|document\.|window\./);
});

/* ---- navigateur : la vraie application ---- */
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
const ID = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const row = (id, day) => { const metrics = {}; SkinModel.METRIC_KEYS.forEach(k => { metrics[k] = 60 + day; }); metrics.acne = 30; return { id, analyzed_at: `2026-10-${String(day).padStart(2, '0')}T08:00:00.000Z`, global_score: 60, skin_type: 'combination', skin_age: 30, metrics, raw_metrics: {}, priorities: [], goals_snapshot: [], engine_version: 'test' }; };

test('RFB1 résultat : le bloc est visible, la liste s\'ouvre au toucher ; page du programme : même bloc ; aucune requête de plus', opts, async () => {
  const env = await H.open(browser, server, { user: { email: 'a@exemple.com' } });
  const { page } = env, uid = env.stats.session.user.id;
  env.fake.analyses.set(uid, [row(ID(1), 1), row(ID(2), 5)].map(r => Object.assign({ user_id: uid }, r)));
  await page.clock.setFixedTime(new Date('2026-10-12T09:00:00'));
  await page.goto('/');
  await page.waitForFunction(() => typeof state !== 'undefined' && state.account.status === 'signedIn' && state.history.status === 'ready', null, { timeout: 15000 });
  await page.evaluate(() => go('result'));
  await page.waitForSelector('[data-referral]');
  assert.match(await page.locator('[data-referral]').innerText(), /Quand en parler à un dermatologue/);
  assert.equal(await page.locator('[data-referral-acne]').count(), 1, 'acné retenue : phrase de plus');
  assert.equal(await page.locator('[data-referral] details').evaluate(d => d.open), false, 'liste repliée');
  await page.locator('[data-referral] summary').click();
  assert.equal(await page.locator('[data-referral] details').evaluate(d => d.open), true);
  const t = await page.locator('[data-referral] details').innerText();
  assert.match(t, /cicatrice en relief qui grossit/); assert.match(t, /grain de beauté/); assert.match(t, /sous les ongles/); assert.match(t, /DermAI ne peut ni examiner votre peau/);
  const before = [...env.stats.supabase];
  await page.evaluate(() => go('program'));
  await page.waitForSelector('[data-referral-block]');
  assert.match(await page.locator('[data-referral-block]').innerText(), /médecin généraliste ou un pharmacien/);
  assert.deepEqual(env.stats.serverApi, []); assert.deepEqual(env.errors, []); assert.equal(env.stats.skin.length, 0);
  void before;
  await env.close();
});
