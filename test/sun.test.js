'use strict';
/* Lot 5 (peaux foncées) : protection solaire pour toutes les peaux (« le soleil fonce les marques »), critères de choix, préférence « sans trace blanche »,
   produits solaires « à vérifier » jamais recommandés. Aucun réseau. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const S = require('../js/engine/data/sun.js');
const P = require('../js/engine/products.js');
const C = require('../js/engine/data/catalog.js');
const DEMO = require('../js/engine/data/products.js');
const copy = require('../js/engine/copy.fr.js');
const Engine = require('../js/engine/index.js');
const D = require('../js/declared-concerns.js');
const { run, norm } = require('./helpers/engine.js');
const read = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

const FORBIDDEN = [/(?<![\p{L}])vous avez (?!indiqu|choisi)/iu, /vous souffrez/i, /(?<![\p{L}])traiter/i, /(?<![\p{L}])il faut/i, /malad/i, /patholog/i, /pr[ée]scri/i, /gu[ée]ri/i, /(?<![\p{L}])soigner/i,
  /[ée]claircir/i, /[ée]claircissant/i, /d[ée]pigment/i];
const SUN_ID = 'lrp-anthelios-uvmune-400-invisible-fluid';
const base = () => JSON.parse(JSON.stringify(C.PRODUCTS.find(p => p.id === SUN_ID)));
const valid = (id, sun, over) => Object.assign(base(), { id, active: true, status: 'validated', inci: ['Aqua', 'Glycerin', 'Parfum'], verification: undefined, inciNote: undefined, sun }, over || {});
const SUN = (spf, claimed) => ({ spf, filters: 'chemical', noWhiteCast: claimed ? { claimed: true, quote: 'Ne laisse pas de traces blanches', source: 'fiche fabricant' } : { claimed: false, quote: null, source: null } });
const spfMatch = r => r.productMatches.find(m => m.kind === 'spf');
const go = catalog => Engine.run(norm({ hydration: 30 }, { raw: 30 }), { goals: [], level: 'simple', cats: [] }, { catalog });

test('SU1 textes : nécessaire à toutes les peaux, « le soleil fonce les marques », critères de choix ; ton cosmétique', () => {
  const T = S.TEXT;
  assert.match(T.title, /pour toutes les peaux/); assert.match(T.rule, /Même une peau foncée a besoin d'une protection solaire/); assert.match(T.rule, /le soleil fonce les marques/);
  assert.equal(T.criteria.length, 5);
  assert.match(T.criteria.join(' '), /Indice 30 au minimum, de préférence 50/); assert.match(T.criteria.join(' '), /UVA et les UVB/); assert.match(T.criteria.join(' '), /sans trace blanche/);
  assert.match(T.criteria.join(' '), /liste d'ingrédients lisible/); assert.match(T.criteria.join(' '), /chaque matin, même par temps couvert/); assert.match(T.criteria.join(' '), /ne remplace pas l'ombre/);
  assert.match(T.criteria[1], /souvent un voile blanc sur peau foncée, sauf s'ils sont teintés/, 'hedge : « souvent », pas « toujours »');
  assert.match(T.selection, /DermAI ne l'a pas mesurée/);
  for (const t of [T.title, T.rule, T.criteriaTitle, T.selection, T.none, ...T.criteria]) { for (const re of FORBIDDEN) assert.doesNotMatch(t, re, t); assert.ok(!/[—–]/.test(t), t); }
});

test('SU2 modèle solaire : indice, type de filtres, mention de trace blanche citée et sourcée', () => {
  assert.deepEqual([S.spfNumber('50+'), S.spfNumber('30'), S.spfNumber(50), S.spfNumber('abc'), S.spfNumber(null), S.spfNumber('')], [50, 30, 50, null, null, null]);
  const p = (sun, extra) => Object.assign({ category: 'spf', demo: false, sun }, extra);
  assert.deepEqual(S.validate(p(SUN('50+', true))), []);
  assert.match(S.validate(p(undefined)).join(), /champ « sun » obligatoire/);
  assert.match(S.validate(p(SUN('abc', false))).join(), /indice invalide/);
  assert.match(S.validate(p(Object.assign(SUN('50', false), { filters: 'magique' }))).join(), /type de filtres invalide/);
  assert.match(S.validate(p(Object.assign(SUN('50', false), { noWhiteCast: { claimed: 'oui' } }))).join(), /booléen/);
  assert.match(S.validate(p({ spf: '50', filters: 'unknown', noWhiteCast: { claimed: true, quote: '', source: 'x' } })).join(), /citation et sa source/);
  assert.deepEqual(S.validate({ category: 'serum' }), [], 'seuls les produits solaires');
  assert.deepEqual(S.validate({ category: 'spf', demo: true }), [], 'démonstration : exemples fictifs');
  assert.equal(S.isSunOk(valid('x', SUN('50+', false))), true); assert.equal(S.isSunOk(valid('x', SUN('15', false))), false); assert.equal(S.isSunOk(valid('x', SUN('50', false), { inci: null })), false);
  assert.equal(S.claimsNoWhiteCast(valid('x', SUN('50', true))), true); assert.equal(S.claimsNoWhiteCast(valid('x', SUN('50', false))), false);
});

test('SU3 catalogue : le produit solaire relevé est « à vérifier », sourcé, et jamais recommandé', () => {
  assert.deepEqual(P.validateCatalog(C.PRODUCTS), []);
  const p = C.PRODUCTS.find(x => x.id === SUN_ID);
  assert.ok(p); assert.equal(p.category, 'spf'); assert.equal(p.status, 'to_verify'); assert.equal(p.active, false); assert.equal(p.inci, null); assert.deepEqual(p.offers, []);
  assert.equal(p.sun.noWhiteCast.claimed, true); assert.match(p.sun.noWhiteCast.quote, /ne laisse pas de traces blanches/); assert.equal(p.sun.filters, 'unknown', 'INCI non lue : type de filtres inconnu, rien d\'inventé');
  assert.ok(p.sources.length === 2 && p.sources.every(s => s.kind === 'manufacturer' && /^https:\/\/africa\.laroche-posay\.com\//.test(s.url) && s.checkedAt === '2026-11-20'));
  const missing = p.verification.missing.join(' | ');
  assert.match(missing, /Liste d'ingrédients \(INCI\)/); assert.match(missing, /Bénin et en Afrique de l'Ouest francophone NON établie/); assert.match(missing, /Aucune offre/);
  assert.equal(P.usable(C.PRODUCTS).filter(x => x.category === 'spf').length, 0, 'aucune protection solaire validée : aucune recommandée');
  for (const x of C.PRODUCTS.filter(y => y.category === 'spf')) assert.ok(x.status === 'to_verify' || (x.inci && x.inci.length && x.sun), x.id);
  assert.doesNotMatch(JSON.stringify(p), /[ée]claircis|d[ée]pigment/i);
  /* en réel, aucune protection solaire n'est proposée tant qu'elle est « à vérifier » */
  assert.equal(go(C.PRODUCTS).productMatches.filter(m => m.kind === 'spf').length, 0);
});

test('SU4 sélection : « sans trace blanche » (mention du fabricant) passe en premier ; indice < 30 ou sans liste INCI jamais proposé ; la démo reste', () => {
  const A = valid('a-solaire', SUN('50+', false)), B = valid('b-solaire', SUN('50+', true)), low = valid('c-solaire', SUN('15', true)), noList = valid('d-solaire', SUN('50', true), { inci: null });
  const r = spfMatch(go([A, B]));
  assert.equal(r.productId, 'b-solaire', 'la mention passe avant l\'ordre du catalogue'); assert.equal(r.selection.rule, 'white_cast');
  assert.match(P.whyOf(r), /ne laisse pas de trace blanche \(mention du fabricant, non mesurée par DermAI\)/);
  assert.equal(spfMatch(go([B, A])).productId, 'b-solaire');
  assert.equal(spfMatch(go([A])).productId, 'a-solaire', 'sans autre choix, un produit sain est proposé');
  assert.equal(spfMatch(go([low, noList])), undefined, 'indice 15 ou composition non vérifiable : rien');
  assert.equal(spfMatch(go([low, A])).productId, 'a-solaire');
  /* la préférence n'agit que sur la protection solaire : même fiche, autre étape, aucun effet */
  const tx = valid('e-gel', SUN('50', true), { category: 'moisturizer' });
  assert.equal(P.validateProduct(tx).filter(m => /solaire/.test(m)).length, 0);
  /* démonstration : l'exemple fictif est toujours proposé */
  const d = go(DEMO.PRODUCTS).productMatches.find(m => m.kind === 'spf'); assert.ok(d && d.demo === true);
  /* décisions du moteur inchangées : la préférence ne change ni priorités, ni routine */
  const a = go([A]), b = go([A, B]); assert.equal(JSON.stringify(a.priorities), JSON.stringify(b.priorities)); assert.equal(JSON.stringify(a.routinePlan), JSON.stringify(b.routinePlan));
});

test('SU5 le catalogue refuse un produit solaire sans son modèle', () => {
  const noSun = Object.assign(valid('f-solaire', SUN('50', false)), { sun: undefined });
  assert.match(P.validateProduct(noSun).join(), /champ « sun » obligatoire/);
  assert.match(P.validateProduct(valid('g-solaire', SUN('abc', false))).join(), /indice invalide/);
  assert.deepEqual(P.validateProduct(valid('h-solaire', SUN('50+', true))).filter(m => !/format|source|offre/i.test(m)), []);
});

test('SU6 affichage : rappel court sur chaque résultat, critères complets sur la page du programme', () => {
  const eng = run({}, { raw: 70 }, { goals: [] });
  const h = D.sunNote(eng);
  assert.ok(h.includes('data-sun-note')); assert.match(h.replace(/<[^>]+>/g, ' '), /le soleil fonce les marques/);
  assert.ok(D.top(eng).includes('data-sun-note')); assert.equal(D.sunNote(null), ''); assert.equal(D.sunNote({}) !== '', true);
  const care = read('js/care-program.js');
  assert.equal((care.match(/\$\{sunBlock\(\)\}(?:\$\{referralBlock\(\)\})?\$\{safety\(\)\}/g) || []).length, 2, 'les deux vues du programme (avant et pendant)');
  assert.match(care, /data-sun-block/);
});

test('SU7 câblage : module chargé avant ses lecteurs ; explication de la règle de sélection ; app.js inchangé', () => {
  const html = read('index.html'), at = s => html.indexOf('<script src="js/' + s + '"></script>');
  assert.ok(at('engine/data/prevention.js') < at('engine/data/sun.js') && at('engine/data/sun.js') < at('engine/products.js') && at('engine/data/sun.js') < at('declared-concerns.js'));
  assert.equal(typeof copy.selectionText({ rule: 'white_cast', candidates: 2 }), 'string'); assert.match(copy.selectionText({ rule: 'white_cast', candidates: 2 }), /^Parmi 2 protections solaires possibles/);
  assert.equal(Buffer.byteLength(read('js/app.js')), 149502, 'app.js : taille fixée, plafond non relevé');
});
