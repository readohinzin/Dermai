'use strict';
/* Étape 28 : exporter (PDF créé sur l'appareil) et partager le résultat d'une analyse (js/export-pdf.js, js/export-view.js).
   Aucun réseau, aucune analyse Perfect Corp. Les valeurs sont des raw ; les textes montrent les scores AFFICHÉS (ui = raw + 8 dans ce helper). */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { M, Engine, norm } = require('./helpers/engine.js');
const C = require('../js/engine/data/catalog.js');
const copy = require('../js/engine/copy.fr.js');
const P = require('../js/export-pdf.js');
const read = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const code = f => read(f).replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:\\])\/\/.*$/gm, '$1');

/* Navigateur simulé minimal : js/export-view.js lit SkinModel, DermaiEngine et DermaiPdf. */
global.SkinModel = M; global.DermaiPdf = P;
global.DermaiEngine = Object.assign({}, Engine, { copy, decisionData: require('../js/engine/data/decision.js'), products: require('../js/engine/products.js') });
const X = require('../js/export-view.js').DermaiExport;

const rawOf = (over, fill = 85) => Object.fromEntries(M.METRIC_KEYS.map(k => [k, over[k] !== undefined ? over[k] : fill]));
const analysisOf = (over, fill, o = {}) => { const raw = rawOf(over, fill), ui = Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, Math.min(99, Math.round(v + 8))]));
  return norm(ui, Object.assign({ rawMap: raw, skin: 'Dry', global: 75, age: 37 }, o)); };
const scanOf = (over, o) => ({ normalized: analysisOf(over, 85, o), analyzedAt: '2026-10-10T09:30:00', real: true });
const ctxOf = (over, profile = {}, extra = {}) => { const s = scanOf(over), eng = Engine.run(s.normalized, Object.assign({ goals: [], level: 'simple', cats: [] }, profile), { catalog: C.PRODUCTS });
  return Object.assign({ eng, s, H: false, catalog: C.PRODUCTS }, extra); };

/* Lecture d'un PDF produit : table xref, objets, flux, textes (hexadécimaux WinAnsi → Unicode). */
const REV = { 0x80: '€', 0x85: '…', 0x8c: 'Œ', 0x9c: 'œ', 0x91: '‘', 0x92: '’', 0x93: '“', 0x94: '”', 0x95: '•', 0x96: '–', 0x97: '—' };
const dec = hexs => hexs.match(/../g).map(h => { const b = parseInt(h, 16); return REV[b] || String.fromCharCode(b); }).join('');
function parse(bytes) {
  const s = Buffer.from(bytes).toString('latin1'), sx = s.match(/startxref\n(\d+)\n%%EOF\n$/);
  assert.ok(sx, 'startxref et %%EOF en fin de fichier');
  const xs = Number(sx[1]), x = s.slice(xs).match(/^xref\n0 (\d+)\n((?:\d{10} \d{5} [nf] \n)+)trailer\n<< \/Size (\d+) \/Root 1 0 R \/Info 5 0 R >>/);
  assert.ok(x, 'table xref valide'); assert.equal(Number(x[1]), Number(x[3]));
  const offs = x[2].match(/\d{10} \d{5} [nf] \n/g).map(e => Number(e.slice(0, 10)));
  assert.equal(offs.length, Number(x[1]));
  for (let i = 1; i < offs.length; i++) assert.ok(s.slice(offs[i]).startsWith(i + ' 0 obj\n'), 'objet ' + i + ' à son offset');
  const pages = [...s.matchAll(/\/Type \/Page \/Parent/g)].length;
  const streams = [...s.matchAll(/<< \/Length (\d+) >>\nstream\n([\s\S]*?)\nendstream/g)].map(m => { assert.equal(m[2].length, Number(m[1]), 'longueur du flux'); return m[2]; });
  const text = streams.map(st => [...st.matchAll(/<([0-9a-f]+)> Tj/g)].map(m => dec(m[1])).join('\n')).join('\n');
  return { s, pages, streams, text, count: Number(x[1]) - 1 };
}
const pdfOf = (ctx, opts, env) => X.makePdf(ctx, opts, Object.assign({ Blob, now: () => new Date('2026-10-10T10:00:00Z') }, env || {}));
const bytesOfBlob = async b => new Uint8Array(await b.arrayBuffer());
/* JPEG minimal valide pour les marqueurs (SOI, SOF0 8 bits, EOI) : suffisant pour le lecteur de dimensions. */
const fakeJpeg = (w, h, comps = 3) => Uint8Array.from([0xff, 0xd8, 0xff, 0xc0, 0, 8 + 3 * comps, 8, h >> 8, h & 255, w >> 8, w & 255, comps, ...Array.from({ length: 3 * comps }, (_, i) => i), 0xff, 0xd9]);

test('EXP1 PDF : structure valide (xref, offsets, longueurs), A4, accents et caractères WinAnsi corrects', async () => {
  const out = P.build({ title: 'Résultat', footer: 'Pied', date: new Date('2026-10-10T10:00:00Z'), blocks: [{ t: 'title', sub: 'Analyse', date: 'Analyse du 10 octobre 2026' },
    { t: 'para', text: 'Œuvre « test » – d\'après l’analyse … 50 € · 37° ç é à ù ô î ï ü' }, { t: 'para', text: 'Emoji 😀 inconnu' }] });
  assert.equal(Buffer.from(out.slice(0, 8)).toString('latin1'), '%PDF-1.4');
  const p = parse(out);
  assert.equal(p.pages, 1);
  assert.match(p.s, /\/MediaBox \[0 0 595 842\]/);
  assert.match(p.s, /\/BaseFont \/Helvetica \/Encoding \/WinAnsiEncoding/);
  assert.ok(p.text.includes('Œuvre « test » – d\'après l’analyse … 50 € · 37° ç é à ù ô î ï ü'), 'accents, œ, «», –, ’, …, € conservés');
  assert.ok(p.text.includes('Emoji ? inconnu'), 'un caractère inconnu devient « ? » (jamais de corruption)');
  assert.deepEqual(P.encode('é€’'), [0xe9, 0x80, 0x92]);
  assert.equal(JSON.stringify(Array.from(P.build({ title: 'a', blocks: [], date: new Date(5) }))), JSON.stringify(Array.from(P.build({ title: 'a', blocks: [], date: new Date(5) }))), 'déterministe pour une date donnée');
});

test('EXP2 mise en page : largeurs Helvetica, retour à la ligne dans les marges, changement de page, pied de page sur chaque page', () => {
  assert.equal(require('node:fs').readFileSync(path.join(__dirname, '../js/export-pdf.js'), 'utf8').match(/const W = \[([^\]]*)\]/)[1].split(',').length, 95, 'les 95 caractères ASCII imprimables');
  assert.ok(Math.abs(P.measure('Hello', 10, false) - 22.78) < 0.05, 'Helvetica : H 722 + e 556 + l 222 + l 222 + o 556 = 2278');
  assert.ok(P.measure('Hello', 10, true) > P.measure('Hello', 10, false), 'le gras est mesuré plus large');
  assert.equal(P.measure('é', 10, false), P.measure('e', 10, false));
  const long = 'Aucun indicateur ne ressort comme priorité forte. '.repeat(12);
  for (const bold of [false, true]) for (const l of P.wrap(long, 10, bold, 300)) assert.ok(P.measure(l, 10, bold) <= 300 + 1e-9, 'ligne dans la marge');
  const blocks = [{ t: 'title', sub: 'S' }]; for (let i = 0; i < 90; i++) blocks.push({ t: 'para', text: 'Ligne ' + i + ' ' + long.slice(0, 120) });
  const out = P.build({ title: 'T', footer: 'Analyse cosmétique visuelle', date: new Date(0), blocks }), p = parse(out);
  assert.ok(p.pages >= 3, 'plusieurs pages : ' + p.pages);
  assert.equal([...p.text.matchAll(/Analyse cosmétique visuelle/g)].length, p.pages, 'le pied de page est sur chaque page');
  for (let i = 1; i <= p.pages; i++) assert.ok(p.text.includes(i + ' / ' + p.pages), 'numéro de page ' + i);
  for (const st of p.streams) for (const m of st.matchAll(/ rg (\d+(?:\.\d+)?) (\d+(?:\.\d+)?) Td </g)) if (Number(m[2]) !== 34) assert.ok(Number(m[2]) >= 55, 'le corps du texte reste au-dessus du pied de page');
});

test('EXP3 photo : seul un JPEG 8 bits gris ou RVB est embarqué, tel quel ; le reste est refusé', () => {
  assert.deepEqual(P.jpegInfo(fakeJpeg(120, 160)), { width: 120, height: 160, components: 3 });
  assert.deepEqual(P.jpegInfo(fakeJpeg(50, 40, 1)), { width: 50, height: 40, components: 1 });
  assert.equal(P.jpegInfo(fakeJpeg(50, 40, 4)), null, 'CMJN : refusé');
  assert.equal(P.jpegInfo(Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4])), null, 'PNG : refusé');
  assert.equal(P.jpegInfo(null), null);
  const img = { bytes: fakeJpeg(120, 160), width: 120, height: 160 };
  const out = P.build({ title: 'T', date: new Date(0), blocks: [{ t: 'hero', lines: [{ text: 'Bonjour', size: 12, bold: true }], image: img }] }), s = Buffer.from(out).toString('latin1');
  assert.ok(s.includes('/Subtype /Image /Width 120 /Height 160 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ' + img.bytes.length + ' >>\nstream\n'));
  assert.ok(Buffer.from(out).includes(Buffer.from(img.bytes)), 'octets de la photo conservés tels quels');
  assert.match(s, /\/XObject << \/Im1 \d+ 0 R >>/);
  assert.equal(parse(out).pages, 1);
  assert.doesNotMatch(Buffer.from(P.build({ title: 'T', date: new Date(0), blocks: [{ t: 'hero', lines: [{ text: 'x', size: 10, bold: false }], image: null }] })).toString('latin1'), /\/Subtype \/Image/);
});

test('EXP4 modèle : ce que l\'écran montre (scores affichés, axes, accompagnement, routine), jamais un raw ni un masque', async () => {
  const ctx = ctxOf({ hydration: 30, acne: 70, pores: 70 });
  const m = X.modelOf(ctx);
  assert.deepEqual([m.global.score, m.global.bandLabel, m.skin.label, m.age, m.date, m.slug], [75, 'Bien', 'Peau sèche', 37, '10 octobre 2026', 'dermai-analyse-2026-10-10.pdf']);
  assert.equal(m.indicators.length, 15);
  const ind = id => m.indicators.find(i => i.id === id);
  assert.deepEqual([ind('hydration').score, ind('hydration').level, ind('acne').score, ind('acne').level, ind('eyeBag').level], [38, 'Axe à soutenir', 78, 'Accompagnement léger', 'Information']);
  assert.deepEqual(m.priorities.map(p => [p.label, p.score, p.level]), [['Hydratation', 38, 'Axe à soutenir']]);
  assert.match(m.accompaniment, /^Acné \(78\) et pores \(78\) : ne sont pas des priorités dans cette analyse/);
  assert.match(m.strategy, /^Stratégie : soutenir hydratation \(38\)/);
  assert.deepEqual(m.routine.morning.map(s => s.label), ['Nettoyage doux', 'Soin d\'accompagnement', 'Hydratation', 'Protection solaire']);
  assert.match(m.routine.morning[1].detail, /Acné \(78\) et pores \(78\) : accompagnement léger.*Proposé par DERMAI : Niacinamide 10% \+ Zinc 1%/);
  assert.equal(m.routine.evening.length, 2);
  const pdf = await pdfOf(ctx, {}), p = parse(await bytesOfBlob(pdf.blob));
  for (const bad of [/rawScore|raw_score|raw_metrics/i, /\b42\.08|\b30\.0\b|\b70\.0\b/, /localization|mask/i]) { assert.doesNotMatch(JSON.stringify(m), bad); assert.doesNotMatch(p.text, bad); }
  assert.ok(p.text.includes('75/100') && p.text.includes('Peau sèche') && p.text.includes('Âge cutané estimé : 37 ans') && p.text.includes('Soin d\'accompagnement'));
  assert.ok(p.text.includes('Analyse cosmétique visuelle. DERMAI ne pose pas de diagnostic médical.'));
  assert.equal(pdf.withPhoto, false);
});

test('EXP5 analyse sans priorité ni accompagnement : texte d\'entretien, pas de section vide', async () => {
  const ctx = ctxOf({}), m = X.modelOf(ctx), p = parse(await bytesOfBlob((await pdfOf(ctx, {})).blob));
  assert.deepEqual(m.priorities, []); assert.equal(m.accompaniment, ''); assert.match(m.maintenance, /^DERMAI ne retient aucun besoin particulier\./);
  assert.ok(!p.text.includes('Accompagnement léger\n') || !m.accompaniment, 'aucune section d\'accompagnement vide');
  assert.ok(p.text.includes('DERMAI ne retient aucun besoin particulier.'));
  const none = X.modelOf(ctxOf({}, {}, {})), G = Object.assign({}, none, { global: { score: null, bandLabel: null } });
  assert.ok(X.blocksOf(G).some(b => b.t === 'hero' && b.lines.some(l => l.text === 'Score global indisponible')));
});

test('EXP6 analyse plus ancienne : priorités enregistrées à sa date, ni stratégie, ni routine, ni accompagnement recalculés', async () => {
  const ctx = ctxOf({ hydration: 30, acne: 70, pores: 70 }, {}, { H: true });
  ctx.s.rec = { priorities: [{ id: 'hydration', label: 'Hydratation', score: 38, band: 'mid' }], goals: ['hydration'] };
  const m = X.modelOf(ctx), p = parse(await bytesOfBlob((await pdfOf(ctx, {})).blob));
  assert.equal(m.H, true); assert.equal(m.routine, null); assert.equal(m.strategy, ''); assert.equal(m.accompaniment, '');
  assert.deepEqual(m.priorities.map(x => [x.label, x.score, x.level]), [['Hydratation', 38, 'Retenu par DERMAI']]);
  assert.deepEqual(m.goals, [copy.GOAL_LABELS.hydration]);
  assert.equal(m.indicators.find(i => i.id === 'acne').level, 'Niveau élevé', 'bandes d\'affichage de l\'analyse, pas les statuts d\'aujourd\'hui');
  assert.ok(p.text.includes('Analyse du 10 octobre 2026 · analyse précédente') && p.text.includes('Axes retenus à cette date'));
  assert.ok(p.text.includes('la routine de l\'application correspond à votre analyse la plus récente'));
  assert.ok(!p.text.includes('Votre routine\n'));
});

test('EXP7 vocabulaire : aucun mot médical ni promesse dans le document (hors la mention « pas un diagnostic »)', async () => {
  const FORBIDDEN = /gravité|maladie|traiter|traitement|guéri|guérison|disparition|garanti|aucune action|résultat assuré|élimine/i;
  for (const over of [{ hydration: 30, acne: 70, pores: 70 }, { acne: 40 }, {}, { acne: 12, redness: 20, pores: 41, pigmentation: 43 }]) {
    const p = parse(await bytesOfBlob((await pdfOf(ctxOf(over), {})).blob));
    assert.doesNotMatch(p.text.replace(/ce n'est pas un diagnostic médical/g, '').replace(/ne pose pas de diagnostic médical/g, ''), new RegExp(FORBIDDEN.source + '|diagnostic|médical', 'i'));
  }
});

test('EXP8 résumé de partage : texte court, scores affichés, aucune photo ni donnée brute', () => {
  const t = X.summaryOf(X.modelOf(ctxOf({ hydration: 30, acne: 70, pores: 70 })));
  assert.equal(t, 'Mon analyse DERMAI du 10 octobre 2026 : score global 75/100 (Bien). Peau sèche. Axes de soin : hydratation (38). Analyse cosmétique visuelle. DERMAI ne pose pas de diagnostic médical.');
  assert.ok(t.length < 400);
  assert.doesNotMatch(t, /raw|photo|http/i);
  const ctx = ctxOf({ hydration: 30 }, {}, { H: true }); ctx.s.rec = { priorities: [{ id: 'hydration', label: 'Hydratation', score: 38, band: 'mid' }], goals: [] };
  assert.match(X.summaryOf(X.modelOf(ctx)), /Axes retenus : hydratation \(38\)\./);
});

test('EXP9 photo en option : jamais sans la case cochée ; repassée par un canvas (sans EXIF) ; échec = document sans photo', async () => {
  const ctx = ctxOf({ acne: 70 }, {}, { blob: { fake: 'photo' } });
  let drawn = 0, created = 0;
  const jpeg = fakeJpeg(300, 400), env = { createImageBitmap: async () => ({ width: 3000, height: 4000, close() {} }),
    doc: { createElement: () => { created++; return { width: 0, height: 0, getContext: () => ({ fillRect() {}, drawImage: (b, x, y, w, h) => { drawn = [w, h]; } }), toBlob: cb => cb({ arrayBuffer: async () => jpeg.buffer.slice(jpeg.byteOffset, jpeg.byteOffset + jpeg.length) }) }; } } };
  const without = await pdfOf(ctx, { photo: false }, env);
  assert.equal(without.withPhoto, false); assert.equal(created, 0, 'case décochée : la photo n\'est même pas lue');
  assert.doesNotMatch(Buffer.from(await bytesOfBlob(without.blob)).toString('latin1'), /\/Subtype \/Image/);
  const withIt = await pdfOf(ctx, { photo: true }, env), bytes = await bytesOfBlob(withIt.blob);
  assert.equal(withIt.withPhoto, true); assert.equal(created, 1); assert.deepEqual(drawn, [675, 900], 'réduite à 900 px de côté au plus, ratio conservé');
  assert.match(Buffer.from(bytes).toString('latin1'), /\/Subtype \/Image \/Width 300 \/Height 400/);
  parse(bytes);
  const broken = await pdfOf(ctx, { photo: true }, { createImageBitmap: async () => { throw new Error('format inconnu'); }, doc: env.doc });
  assert.equal(broken.withPhoto, false);
  assert.doesNotMatch(Buffer.from(await bytesOfBlob(broken.blob)).toString('latin1'), /\/Subtype \/Image/);
  const noBlob = await pdfOf(ctxOf({ acne: 70 }), { photo: true }, env);
  assert.equal(noBlob.withPhoto, false, 'pas de photo disponible : rien d\'inclus');
  assert.equal(await X.photoOf(null, env), null);
  assert.equal(await X.photoOf({ x: 1 }, Object.assign({}, env, { doc: { createElement: () => ({ getContext: () => ({ fillRect() {}, drawImage() {} }), toBlob: cb => cb(null) }) } })), null);
});

/* ---------- Télécharger et partager (navigateur simulé) ---------- */
const fakeEnv = (nav, extra = {}) => { const log = { anchors: [], revoked: [], created: [] };
  const env = { Blob, File, now: () => new Date('2026-10-10T10:00:00Z'), setTimeout: (f, ms) => { log.timer = ms; f(); },
    URL: { createObjectURL: b => { log.created.push(b); return 'blob:fake/1'; }, revokeObjectURL: u => log.revoked.push(u) },
    doc: { location: { origin: 'https://dermai.example' }, body: { appendChild: a => log.anchors.push(a) }, createElement: () => ({ click() { this.clicked = true; }, remove() { this.removed = true; } }) }, nav };
  return Object.assign(env, extra, { log }); };

test('EXP10 télécharger : un lien temporaire vers le PDF, nommé avec la date de l\'analyse, libéré ensuite', async () => {
  const env = fakeEnv({}), r = await X.perform('download', ctxOf({ acne: 70 }), {}, env);
  assert.deepEqual([r.ok, r.message], [true, 'PDF téléchargé.']);
  const a = env.log.anchors[0];
  assert.deepEqual([a.download, a.href, a.clicked, a.removed], ['dermai-analyse-2026-10-10.pdf', 'blob:fake/1', true, true]);
  assert.equal(env.log.created[0].type, 'application/pdf');
  assert.deepEqual(env.log.revoked, ['blob:fake/1']); assert.equal(env.log.timer, 60000);
  assert.ok(env.log.created[0].size > 1000);
  const bad = fakeEnv({}, { URL: { createObjectURL() { throw new Error('x'); } } });
  assert.deepEqual((await X.perform('download', ctxOf({ acne: 70 }), {}, bad)).message, 'Le PDF n\'a pas pu être créé. Réessayez.');
});

test('EXP11 partager : fichier PDF si l\'appareil le permet, sinon texte, sinon presse-papiers, sinon téléchargement ; annuler n\'est pas une erreur', async () => {
  const ctx = ctxOf({ hydration: 30, acne: 70, pores: 70 });
  // 1. partage de fichier
  const calls = [], nav1 = { canShare: d => !!(d && d.files && d.files.length), share: async d => { calls.push(d); } };
  const r1 = await X.perform('share', ctx, {}, fakeEnv(nav1));
  assert.deepEqual([r1.ok, r1.via, r1.message], [true, 'file', '']);
  assert.equal(calls[0].files[0].name, 'dermai-analyse-2026-10-10.pdf'); assert.equal(calls[0].files[0].type, 'application/pdf');
  assert.equal(calls[0].title, 'Mon analyse DERMAI'); assert.match(calls[0].text, /^Mon analyse DERMAI du 10 octobre 2026 : score global 75\/100/);
  // 2. l'appareil ne partage pas de fichier : texte et adresse du site (jamais le résultat)
  const calls2 = [], nav2 = { canShare: () => false, share: async d => { calls2.push(d); } };
  const r2 = await X.perform('share', ctx, {}, fakeEnv(nav2));
  assert.deepEqual([r2.via, calls2[0].files, calls2[0].url], ['text', undefined, 'https://dermai.example']);
  // 3. pas de partage : presse-papiers
  const written = [], r3 = await X.perform('share', ctx, {}, fakeEnv({ clipboard: { writeText: async t => { written.push(t); } } }));
  assert.deepEqual([r3.via, r3.message], ['clipboard', 'Résumé copié : vous pouvez le coller où vous voulez.']);
  assert.match(written[0], /Mon analyse DERMAI du 10 octobre 2026[\s\S]*\nhttps:\/\/dermai\.example$/);
  // 4. ni partage ni presse-papiers : le PDF est téléchargé, et on le dit
  const env4 = fakeEnv({}), r4 = await X.perform('share', ctx, {}, env4);
  assert.deepEqual([r4.via, r4.message, env4.log.anchors.length], ['download', 'Le partage n\'est pas disponible ici : le PDF a été téléchargé.', 1]);
  // 5. annulation : silence ; autre erreur : message
  const abort = Object.assign(new Error('annulé'), { name: 'AbortError' });
  const r5 = await X.perform('share', ctx, {}, fakeEnv({ canShare: () => true, share: async () => { throw abort; } }));
  assert.deepEqual([r5.ok, r5.message, r5.via], [true, '', 'cancelled']);
  const r6 = await X.perform('share', ctx, {}, fakeEnv({ canShare: () => true, share: async () => { throw new Error('boom'); } }));
  assert.deepEqual([r6.ok, r6.message], [false, 'Le partage n\'a pas pu se faire. Vous pouvez télécharger le PDF.']);
});

test('EXP12 interface : la carte (photo décochée par défaut, seulement si une photo existe), rien en démonstration', () => {
  const eng = ctxOf({ acne: 70 }).eng, s = scanOf({ acne: 70 });
  const withPhoto = X.card(eng, Object.assign({}, s, { blob: { b: 1 } }), { catalog: C.PRODUCTS }), noPhoto = X.card(eng, s, { catalog: C.PRODUCTS });
  assert.match(withPhoto, /<input type="checkbox" data-export-photo>/); assert.doesNotMatch(withPhoto, /checked/);
  assert.match(withPhoto, /Inclure ma photo<small>Le fichier pourra circuler hors de DERMAI/);
  assert.doesNotMatch(noPhoto, /data-export-photo/);
  for (const h of [withPhoto, noPhoto]) {
    assert.match(h, /data-export="download">Télécharger en PDF<\/button>/); assert.match(h, /data-export="share">Partager<\/button>/);
    assert.match(h, /rien n'est envoyé à DERMAI ni enregistré/); assert.match(h, /data-export-status role="status" aria-live="polite"/);
  }
  assert.equal(X.card(eng, Object.assign({}, s, { blob: { b: 1 } }), { demo: true }), '', 'mode démonstration : aucune carte');
  const app = read('js/app.js'), html = read('index.html');
  assert.match(app, /\$\{DermaiExport\.card\(eng,s,\{H,demo:DEMO_MODE,catalog:catalogNow\(\)\}\)\}\s*\n\s*<div class="stack"><button class="c-btn c-btn--secondary c-btn--block" data-go="scan">/);
  assert.ok(Buffer.byteLength(app) < 150000, 'budget de app.js : ' + Buffer.byteLength(app));
  const order = [...html.matchAll(/<script src="([^"]+)"/g)].map(m => m[1]);
  assert.ok(order.indexOf('js/export-pdf.js') < order.indexOf('js/export-view.js') && order.indexOf('js/export-view.js') < order.indexOf('js/app.js') && order.indexOf('js/export-pdf.js') > order.indexOf('js/skin-model.js'));
  assert.match(read('css/styles.css'), /components\/export\.css/);
  assert.ok(fs.existsSync(path.join(__dirname, '../css/components/export.css')));
});

test('EXP13 confidentialité : aucun réseau, aucun stockage, aucun raw, aucun masque dans le code d\'export ; rien d\'enregistré', () => {
  for (const f of ['js/export-pdf.js', 'js/export-view.js']) {
    const noRead = code(f).replace(/env\.fetch\(src, \{ credentials: 'omit' \}\)/g, '');   // seule lecture permise : la photo DÉJÀ affichée du compte, en GET, sans cookie, sans corps
    assert.doesNotMatch(noRead, /\bfetch\(|XMLHttpRequest|sendBeacon|WebSocket|localStorage|sessionStorage|indexedDB|document\.cookie|supabase|Account\b|method:|body:/i, f + ' : aucun envoi, aucun stockage');
    assert.doesNotMatch(code(f), /rawScore|rawMetrics|raw_score|localization|\bmask|\.rawScore|interpretation\.indicators\[[^\]]*\]\.value/i, f + ' : aucune donnée de décision, aucun masque');
  }
  assert.equal((code('js/export-view.js').match(/env\.fetch\(/g) || []).length, 1, 'une seule lecture réseau : la photo du compte');
  assert.equal((code('js/export-pdf.js').match(/fetch/g) || []).length, 0);
  assert.doesNotMatch(code('js/export-view.js'), /location\.(href|search|hash)|history\.(push|replace)State/, 'aucune adresse contenant le résultat');
  assert.doesNotMatch(read('supabase/migrations/' + fs.readdirSync(path.join(__dirname, '../supabase/migrations')).sort().pop()), /export|share|pdf/i, 'aucune migration pour l\'export');
});

test('EXP14 le moteur ne change pas : l\'export ne lit que la sortie existante, et ne modifie pas l\'analyse ni le moteur', () => {
  const ctx = ctxOf({ hydration: 30, acne: 70, pores: 70 }), before = JSON.stringify([ctx.eng, ctx.s]);
  X.modelOf(ctx); X.blocksOf(X.modelOf(ctx), null); X.summaryOf(X.modelOf(ctx));
  assert.equal(JSON.stringify([ctx.eng, ctx.s]), before, 'aucune mutation de l\'analyse ni du résultat du moteur');
  for (const f of ['js/engine/index.js', 'js/engine/accompaniment.js', 'js/engine/priorities.js', 'js/engine/synthesis.js']) assert.doesNotMatch(code(f), /DermaiExport|DermaiPdf/, f);
});

test('EXP15 copier le résumé : texte court et adresse du site, sans fabriquer de PDF ; presse-papiers, sinon copie par sélection, sinon message', async () => {
  const ctx = ctxOf({ hydration: 30, acne: 70, pores: 70 });
  const written = [], env1 = fakeEnv({ clipboard: { writeText: async t => { written.push(t); } } });
  const r1 = await X.perform('copy', ctx, {}, env1);
  assert.deepEqual([r1.ok, r1.via, r1.message, r1.withPhoto], [true, 'copy', 'Résumé copié : vous pouvez le coller où vous voulez.', false]);
  assert.equal(written[0], 'Mon analyse DERMAI du 10 octobre 2026 : score global 75/100 (Bien). Peau sèche. Axes de soin : hydratation (38). Analyse cosmétique visuelle. DERMAI ne pose pas de diagnostic médical.\nhttps://dermai.example');
  assert.deepEqual([env1.log.created.length, env1.log.anchors.length], [0, 0], 'aucun PDF, aucun téléchargement');
  assert.doesNotMatch(written[0], /raw|photo|rawScore/i);
  // le presse-papiers moderne échoue (page non sécurisée, permission refusée) : copie par sélection
  const sel = [], doc = { location: { origin: 'https://dermai.example' }, body: { appendChild: e => sel.push(['append', e.value]) },
    createElement: () => ({ setAttribute() {}, style: {}, select() { sel.push(['select']); }, remove() { sel.push(['remove']); } }), execCommand: c => { sel.push([c]); return true; } };
  const r2 = await X.perform('copy', ctx, {}, { nav: { clipboard: { writeText: async () => { throw new Error('refusé'); } } }, doc });
  assert.deepEqual([r2.ok, r2.via], [true, 'copy']);
  assert.deepEqual(sel.map(x => x[0]), ['append', 'select', 'copy', 'remove']);
  assert.match(sel[0][1], /^Mon analyse DERMAI du 10 octobre 2026[\s\S]*\nhttps:\/\/dermai\.example$/);
  // aucune copie possible : message clair
  const r3 = await X.perform('copy', ctx, {}, { nav: {}, doc: Object.assign({}, doc, { execCommand: () => false }) });
  assert.deepEqual([r3.ok, r3.message], [false, 'La copie n\'a pas fonctionné. Vous pouvez télécharger le PDF à la place.']);
  const r4 = await X.perform('copy', ctx, {}, { nav: {}, doc: Object.assign({}, doc, { execCommand: () => { throw new Error('x'); } }) });
  assert.equal(r4.ok, false);
  // analyse plus ancienne : mêmes règles, axes enregistrés
  const old = ctxOf({ hydration: 30 }, {}, { H: true }); old.s.rec = { priorities: [{ id: 'hydration', label: 'Hydratation', score: 38, band: 'mid' }], goals: [] };
  const w2 = []; await X.perform('copy', old, {}, fakeEnv({ clipboard: { writeText: async t => { w2.push(t); } } }));
  assert.match(w2[0], /Axes retenus : hydratation \(38\)\./);
  // le bouton est sur la carte, avec le même texte que le résumé partagé
  const html = X.card(ctx.eng, ctx.s, { catalog: C.PRODUCTS });
  assert.match(html, /data-export="copy">Copier le résumé<\/button>/);
  assert.deepEqual([...html.matchAll(/data-export="(\w+)"/g)].map(m => m[1]), ['download', 'share', 'copy']);
  assert.match(code('js/export-view.js'), /execCommand\('copy'\)/);
  assert.doesNotMatch(code('js/export-view.js'), /localStorage|sessionStorage/, 'toujours aucun stockage');
});

/* ---------- Photo d'une analyse enregistrée, et boutons sur la routine et les soins recommandés ---------- */
const photoEnv = (extra = {}) => { let drawn = 0; const jpeg = fakeJpeg(300, 400);
  return Object.assign({ createImageBitmap: async () => ({ width: 3000, height: 4000, close() {} }),
    doc: { createElement: () => ({ width: 0, height: 0, getContext: () => ({ fillRect() {}, drawImage() { drawn++; } }), toBlob: cb => cb({ arrayBuffer: async () => jpeg.buffer.slice(jpeg.byteOffset, jpeg.byteOffset + jpeg.length) }) }) } }, extra); };

test('EXP16 photo d\'une analyse enregistrée : lue depuis l\'adresse du compte (celle de l\'écran), seulement si la case est cochée ; sinon un message clair', async () => {
  const URL = 'https://projet.supabase.co/storage/v1/object/sign/scan-photos/u/a.jpg?token=t', calls = [];
  const ok = { fetch: async (u, o) => { calls.push([u, o]); return { ok: true, blob: async () => ({ fake: 'jpeg' }) }; } };
  const ctx = ctxOf({ acne: 70 }, {}, { photoUrl: URL });
  const without = await pdfOf(ctx, { photo: false }, photoEnv(ok));
  assert.deepEqual([without.withPhoto, calls.length], [false, 0], 'case décochée : la photo n\'est même pas lue');
  const withIt = await pdfOf(ctx, { photo: true }, photoEnv(ok));
  assert.equal(withIt.withPhoto, true);
  assert.deepEqual(calls, [[URL, { credentials: 'omit' }]], 'une lecture, sans cookie');
  assert.match(Buffer.from(await bytesOfBlob(withIt.blob)).toString('latin1'), /\/Subtype \/Image \/Width 300 \/Height 400/);
  // la photo de la session passe avant l'adresse du compte
  calls.length = 0; await pdfOf(Object.assign({}, ctx, { blob: { b: 1 } }), { photo: true }, photoEnv(ok));
  assert.equal(calls.length, 0, 'un Blob en mémoire : aucune lecture réseau');
  // échecs : réponse refusée, réseau coupé, adresse non autorisée : PDF sans photo, et on le dit
  for (const env of [{ fetch: async () => ({ ok: false }) }, { fetch: async () => { throw new Error('réseau'); } }]) {
    const r = await pdfOf(ctx, { photo: true }, photoEnv(env)); assert.equal(r.withPhoto, false);
  }
  const bad = await pdfOf(Object.assign({}, ctx, { photoUrl: 'javascript:alert(1)' }), { photo: true }, photoEnv(ok));
  assert.equal(bad.withPhoto, false); assert.equal(calls.length, 0, 'jamais de lecture d\'une adresse hors https, blob et data');
  const dl = await X.perform('download', ctx, { photo: true }, fakeEnv({}, { fetch: async () => ({ ok: false }) }));
  assert.deepEqual([dl.ok, dl.message], [true, 'PDF téléchargé sans la photo : elle n\'a pas pu être ajoutée.']);
  const sh = await X.perform('share', ctx, { photo: true }, fakeEnv({ canShare: () => true, share: async () => {} }, { fetch: async () => ({ ok: false }), createImageBitmap: photoEnv().createImageBitmap }));
  assert.deepEqual([sh.ok, sh.via, sh.message], [true, 'file', 'PDF partagé sans la photo : elle n\'a pas pu être ajoutée.']);
  const fine = await X.perform('download', ctx, { photo: false }, fakeEnv({})); assert.equal(fine.message, 'PDF téléchargé.');
});

test('EXP17 la case « Inclure ma photo » apparaît aussi pour une analyse enregistrée (photo du compte), jamais pour une adresse non autorisée', () => {
  const ctx = ctxOf({ acne: 70 });
  const saved = X.card(ctx.eng, Object.assign({}, ctx.s, { photo: 'https://projet.supabase.co/storage/v1/object/sign/x.jpg?token=t' }), { catalog: C.PRODUCTS });
  assert.match(saved, /data-export-photo/); assert.doesNotMatch(saved, /checked/);
  assert.match(X.card(ctx.eng, Object.assign({}, ctx.s, { photo: 'blob:http://x/1' }), {}), /data-export-photo/);
  assert.match(X.card(ctx.eng, Object.assign({}, ctx.s, { photo: 'http://127.0.0.1:3000/a.png' }), {}), /data-export-photo/, 'bouclage local (développement)');
  for (const photo of ['', undefined, 'javascript:alert(1)', 'http://insecure.example/a.jpg', 'http://localhost.evil.example/a.jpg', '/img/x.jpg']) assert.doesNotMatch(X.card(ctx.eng, Object.assign({}, ctx.s, { photo }), {}), /data-export-photo/, String(photo));
});

test('EXP18 les trois boutons sont aussi sur la routine et sur les soins recommandés (même carte, titre adapté, même PDF)', () => {
  const ctx = ctxOf({ hydration: 30, acne: 70, pores: 70 });
  const r = X.card(ctx.eng, ctx.s, { kind: 'routine', catalog: C.PRODUCTS }), p = X.card(ctx.eng, ctx.s, { kind: 'products', catalog: C.PRODUCTS }), res = X.card(ctx.eng, ctx.s, { catalog: C.PRODUCTS });
  assert.match(r, /Garder ou partager votre routine/); assert.match(p, /Garder ou partager vos soins recommandés/); assert.match(res, /Garder ou partager votre résultat/);
  for (const h of [r, p, res]) assert.deepEqual([...h.matchAll(/data-export="(\w+)"/g)].map(m => m[1]), ['download', 'share', 'copy']);
  for (const h of [r, p]) assert.match(h, /Un seul PDF avec votre analyse, votre routine et les produits proposés/);
  assert.match(res, /Un PDF créé sur votre appareil/);
  assert.equal(X.card(ctx.eng, ctx.s, { kind: 'routine', demo: true }), '');
  const app = read('js/app.js');
  assert.match(app, /<div class="grid2">\$\{list\(`morning`,`am`,`sun`,`Matin`\)\}\$\{list\(`evening`,`pm`,`moon`,`Soir`\)\}<\/div>\s*\n\s*\$\{DermaiExport\.card\(eng,SCANS\[state\.latest\],\{kind:`routine`,demo:DEMO_MODE,catalog:catalogNow\(\)\}\)\}/);
  assert.match(app, /\$\{DermaiExport\.card\(eng,SCANS\[state\.latest\],\{kind:`products`,demo:DEMO_MODE,catalog:catalogNow\(\)\}\)\}\$\{foot\}/);
  assert.ok(Buffer.byteLength(app) < 150000, 'budget de app.js : ' + Buffer.byteLength(app));
});
