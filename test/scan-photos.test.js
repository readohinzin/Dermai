'use strict';
/* Photos de scan gardées dans le compte, au choix de l'utilisatrice : client js/account.js contre un faux Supabase (aucun réseau).
   Les vraies règles d'accès (RLS du Storage) sont éprouvées dans scan-photos-db.test.js. */
const test = require('node:test');
const assert = require('node:assert/strict');
const Account = require('../js/account.js');
const { createFake, memoryStorage } = require('./helpers/fake-supabase.js');

const URL = 'https://demo.supabase.co', KEY = 'public-anon-key';
function setup() {
  const fake = createFake();
  const mk = st => Account.create({ url: URL, anonKey: KEY, fetch: fake.fetch, storage: st || memoryStorage(), now: fake.state.now });
  return { fake, mk, acc: mk() };
}
const ID = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const jpeg = (size = 2048) => new Blob([new Uint8Array(size)], { type: 'image/jpeg' });
const M = Account.MSG;

test('PH1 choix de conservation : null au départ, puis oui / non ; seule la colonne keep_photos est écrite', async () => {
  const { acc, fake } = setup();
  await acc.signUp('a@exemple.com', 'motdepasse1');
  await acc.saveProfile({ goals: ['tone'], level: 'simple', comfort: { preferGentle: true }, exclusions: [] });
  assert.equal((await acc.loadProfile()).photos, null, 'pas encore demandé');
  assert.deepEqual(await acc.savePhotoChoice(true), { ok: true });
  const p = await acc.loadProfile();
  assert.equal(p.photos, true);
  assert.deepEqual(p.profile, { goals: ['tone'], level: 'simple', comfort: { preferGentle: true }, exclusions: [] }, 'préférences intactes');
  const patch = fake.log.filter(l => l.method === 'PATCH' && l.path.startsWith('/rest/v1/profiles')).pop();
  assert.deepEqual(patch.body, { keep_photos: true });
  assert.deepEqual(await acc.savePhotoChoice(false), { ok: true });
  assert.equal((await acc.loadProfile()).photos, false);
  assert.deepEqual(await acc.savePhotoChoice('oui'), { ok: false, error: M.photoChoiceFailed });
});

test('PH2 garder, lister, afficher : chemin <user_id>/<analyse>.jpg, JPEG seulement, lien temporaire jamais stocké', async () => {
  const { fake, mk } = setup(), store = memoryStorage(), acc = mk(store);
  await acc.signUp('a@exemple.com', 'motdepasse1');
  const uid = acc.user.id;
  assert.deepEqual(await acc.uploadPhoto(ID(1), jpeg()), { ok: true });
  assert.ok(fake.objects.has(`${uid}/${ID(1)}.jpg`));
  const up = fake.log.find(l => l.method === 'POST' && l.path.startsWith('/storage/v1/object/scan-photos/'));
  assert.equal(up.path, `/storage/v1/object/scan-photos/${uid}/${ID(1)}.jpg`);
  assert.equal(up.headers['content-type'], 'image/jpeg'); assert.equal(up.headers['x-upsert'], 'false');
  assert.deepEqual(await acc.uploadPhoto(ID(1), jpeg()), { ok: true }, 'nouvel essai : sans doublon ni remplacement');
  for (const [id, b] of [['pas-un-uuid', jpeg()], [ID(2), new Blob(['x'], { type: 'image/png' })], [ID(2), jpeg(4 * 1024 * 1024 + 1)], [ID(2), null]])
    assert.deepEqual(await acc.uploadPhoto(id, b), { ok: false, error: M.photoSaveFailed });
  assert.deepEqual(await acc.listPhotos(), { ok: true, ids: [ID(1)] });
  const u = await acc.photoUrls([ID(1), ID(9), 'x']);
  assert.equal(u.ok, true);
  assert.deepEqual(Object.keys(u.urls), [ID(1)], 'photo absente : aucun lien inventé');
  assert.match(u.urls[ID(1)], new RegExp(`^${URL}/storage/v1/object/sign/scan-photos/${uid}/${ID(1)}\\.jpg\\?token=`));
  assert.equal(fake.log.find(l => l.path === '/storage/v1/object/sign/scan-photos').body.expiresIn, 3600);
  assert.doesNotMatch(JSON.stringify(store.dump()), /storage\/v1|sign|jpg/, 'rien dans le stockage du navigateur (seule la session y est)');
});

test('PH3 cloisonnement : B ne voit, ne signe ni ne supprime les photos de A', async () => {
  const { fake, mk } = setup();
  const a = mk(), b = mk();
  await a.signUp('a@exemple.com', 'motdepasse1'); await b.signUp('b@exemple.com', 'motdepasse1');
  await a.uploadPhoto(ID(1), jpeg()); await b.uploadPhoto(ID(2), jpeg());
  assert.deepEqual(await b.listPhotos(), { ok: true, ids: [ID(2)] });
  assert.deepEqual((await b.photoUrls([ID(1)])).urls, {}, 'B demande la photo de A sous son propre dossier : rien');
  const tokB = await b.accessToken();
  const forged = await fake.fetch(`${URL}/storage/v1/object/sign/scan-photos`, { method: 'POST', headers: { apikey: KEY, authorization: 'Bearer ' + tokB }, body: JSON.stringify({ expiresIn: 60, paths: [`${a.user.id}/${ID(1)}.jpg`] }) });
  assert.equal(JSON.parse(await forged.text())[0].signedURL, null, 'chemin de A forgé par B : refusé');
  assert.deepEqual(await b.deletePhotos(), { ok: true, deleted: 1 });
  assert.ok(fake.objects.has(`${a.user.id}/${ID(1)}.jpg`), 'la photo de A est intacte');
});

test('PH4 « Supprimer mes photos » : toutes les photos partent, les analyses restent', async () => {
  const { acc, fake } = setup();
  await acc.signUp('a@exemple.com', 'motdepasse1');
  await acc.saveAnalysis({ id: ID(1), metrics: { acne: 70 }, engineVersion: '1.2.0' });
  await acc.uploadPhoto(ID(1), jpeg()); await acc.uploadPhoto(ID(2), jpeg());
  assert.deepEqual(await acc.deletePhotos(), { ok: true, deleted: 2 });
  assert.equal(fake.objects.size, 0);
  assert.equal((await acc.listAnalyses()).analyses.length, 1, 'historique intact');
  assert.deepEqual(await acc.deletePhotos(), { ok: true, deleted: 0 });
  fake.state.failStorage = true;
  assert.deepEqual(await acc.deletePhotos(), { ok: false, error: M.photosDeleteFailed });
});

test('PH5 suppression du compte : les photos sont effacées d\'abord ; si cela échoue, le compte n\'est pas supprimé', async () => {
  const { acc, fake } = setup();
  await acc.signUp('a@exemple.com', 'motdepasse1');
  await acc.uploadPhoto(ID(1), jpeg());
  fake.state.failStorage = true;
  assert.deepEqual(await acc.deleteAccount(), { ok: false, error: M.deleteFailed });
  assert.ok(fake.users.has('a@exemple.com') && fake.objects.size === 1, 'aucune photo orpheline, compte intact');
  fake.state.failStorage = false;
  assert.deepEqual(await acc.deleteAccount(), { ok: true });
  assert.equal(fake.objects.size, 0); assert.ok(!fake.users.has('a@exemple.com'));
  const order = fake.log.filter(l => l.path.startsWith('/storage/v1/object/scan-photos') && l.method === 'DELETE' || l.path === '/rest/v1/rpc/delete_my_account').map(l => l.path);
  assert.deepEqual(order.slice(-2), ['/storage/v1/object/scan-photos', '/rest/v1/rpc/delete_my_account']);
});

test('PH6 migration pas encore appliquée : rien ne casse, la fonction est simplement absente', async () => {
  const { acc, fake } = setup();
  fake.state.photosColumn = false; fake.state.photoBucket = false;
  await acc.signUp('a@exemple.com', 'motdepasse1');
  const p = await acc.loadProfile();
  assert.equal(p.ok, true); assert.equal(p.photos, undefined, 'colonne absente : pas de question, pas d\'interrupteur');
  assert.deepEqual(p.profile, { goals: [], level: '', comfort: { preferGentle: false }, exclusions: [] });
  assert.deepEqual(await acc.savePhotoChoice(true), { ok: false, error: M.photosUnavailable });
  assert.deepEqual(await acc.uploadPhoto(ID(1), jpeg()), { ok: false, error: M.photosUnavailable });
  assert.deepEqual(await acc.listPhotos(), { ok: true, ids: [], missing: true });
  assert.deepEqual(await acc.deleteAccount(), { ok: true }, 'sans bucket : aucune photo à effacer, la suppression du compte continue');
});

test('PH7 session absente ou expirée : message de session, jamais de détail technique', async () => {
  const { acc, fake } = setup();
  for (const f of [() => acc.uploadPhoto(ID(1), jpeg()), () => acc.listPhotos(), () => acc.deletePhotos(), () => acc.savePhotoChoice(true)])
    assert.deepEqual(await f(), { ok: false, error: M.sessionExpired });
  await acc.signUp('a@exemple.com', 'motdepasse1');
  fake.tokens.clear(); fake.refresh.clear();
  for (const f of [() => acc.uploadPhoto(ID(1), jpeg()), () => acc.listPhotos(), () => acc.photoUrls([ID(1)]), () => acc.deletePhotos()])
    assert.deepEqual(await f(), { ok: false, error: M.sessionExpired });
  for (const m of [M.photoChoiceFailed, M.photoSaveFailed, M.photosDeleteFailed, M.photosUnavailable]) assert.doesNotMatch(m, /storage|bucket|jwt|40\d|50\d|supabase/i);
});

/* Branchement dans l'interface (js/app.js) : vérifications statiques. Le parcours complet est éprouvé dans un navigateur (harnais). */
const fs = require('node:fs'), path = require('node:path');
const app = fs.readFileSync(path.join(__dirname, '../js/app.js'), 'utf8');
const between = (a, b) => app.slice(app.indexOf(a), app.indexOf(b, app.indexOf(a)));

test('PH8 interface : question posée sur le résultat tant que le choix n\'est pas fait, jamais de case pré-cochée', () => {
  assert.match(app, /const ask=!H&&signedIn\(\)&&state\.photos===null&&s\.blob\?/);
  assert.match(app, /state\.photos=r\.photos/, 'le choix vient du profil (null = pas encore demandé)');
  assert.match(between('function resetPrivateState', 'const softStatus'), /state\.photos=undefined/);
  const { DermaiPhotos } = require('../js/photos-view.js');
  const card = DermaiPhotos.ask(n => n, false);
  assert.match(card, /data-act="photo-choice" data-v="yes"/); assert.match(card, /data-act="photo-choice" data-v="no"/);
  assert.match(card, /changer d'avis à tout moment dans Confidentialité/);
});

test('PH9 interface : une photo n\'est gardée qu\'après « oui » et une fois l\'analyse enregistrée ; « non » la libère de la mémoire', () => {
  const keep = between('async function keepPhoto', 'async function photoChoice');
  assert.match(keep, /if\(state\.photos===false\)sc\.blob=null;/);
  assert.match(keep, /if\(state\.photos!==true\|\|!sc\.blob\|\|!sc\.saved\|\|!signedIn\(\)\)return;/);
  assert.match(keep, /ACCOUNT\.uploadPhoto\(sc\.rec\.id,b\)/);
  assert.match(between('async function saveScan', 'async function deleteHistory'), /sc\.saved=true;[^\n]*keepPhoto\(sc\)/);
  assert.match(between('async function photoChoice', 'async function attachPhotos'), /SCANS\.forEach\(keepPhoto\)/);
});

test('PH10 interface : jamais de photo, de lien signé ou de masque dans le navigateur au-delà de la mémoire ; historique et compte effacent les photos', () => {
  const code = app.replace(/\/\*[\s\S]*?\*\//g, '');
  assert.doesNotMatch(code, /(localStorage|sessionStorage)\.setItem\([^)]*(blob|signed|photoUrls|urls|rec)/i);
  assert.doesNotMatch(code, /history\.(push|replace)State\([^)]*photo/i);
  assert.match(between('async function deleteHistory', '/* Photos de scan'), /ACCOUNT\.deletePhotos\(\);[^]*ACCOUNT\.deleteAnalyses\(\)/, 'historique : photos d\'abord');
  assert.match(app, /if\(v===`photos`&&!DEMO_MODE\)\{deletePhotos\(\);break\}/);
  assert.match(app, /case `photo-keep`:photoChoice\(state\.photos!==true\);break;/);
  assert.doesNotMatch(between('async function keepPhoto', '/* Retour d\'un lien'), /localization|mask/i, 'les masques ne sont jamais gardés');
  const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
  assert.ok(html.indexOf('js/photos-view.js') > 0 && html.indexOf('js/photos-view.js') < html.indexOf('js/app.js'));
});
