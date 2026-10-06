'use strict';
/* Étape 12 : polish UX. Contrôles de source (les comportements sont validés en navigateur) : textes, absence de faux contrôles en mode réel, illustration servie comme fichier. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const app = fs.readFileSync(path.join(__dirname, '../js/app.js'), 'utf8');
const css = f => fs.readFileSync(path.join(__dirname, '../css', f), 'utf8');
const between = (a, b) => app.slice(app.indexOf(a), app.indexOf(b, app.indexOf(a)));

test('UX1 l\'illustration de l\'accueil est un fichier JPEG, plus une image intégrée au script (premier chargement allégé)', () => {
  assert.doesNotMatch(app, /data:image\/jpeg;base64/);
  assert.match(app, /const PORTRAIT_SRC = `img\/portrait\.jpg`/);
  const f = path.join(__dirname, '../img/portrait.jpg');
  const head = fs.readFileSync(f).subarray(0, 3);
  assert.deepEqual([...head], [0xff, 0xd8, 0xff]);
  assert.ok(Buffer.byteLength(app) < 150000, 'js/app.js reste léger');
});

test('UX2 accueil réel : l\'illustration et l\'exemple sont identifiés comme fictifs ; le démo n\'est pas modifié', () => {
  assert.equal((app.match(/Illustration : personne fictive, aucun résultat réel\./g) || []).length, 2);
  assert.match(app, /\$\{DEMO_MODE\?``:`<p class="muted"[^`]*Illustration : personne fictive/);
  assert.match(app, /Exemple illustratif, données fictives\./);
});

test('UX3 dates : l\'heure n\'apparaît que lorsque plusieurs analyses tombent le même jour, jamais en démo', () => {
  assert.match(app, /const dateLabel=s=>\{const t=!DEMO_MODE&&SCANS\.filter\(x=>x\.date===s\.date\)\.length>1\?timeOf\(s\):null;return t\?`\$\{s\.date\} · \$\{t\}`:s\.date\}/);
  assert.match(app, /toLocaleTimeString\(`fr-FR`,\{hour:`2-digit`,minute:`2-digit`\}\)/);
  assert.match(app, /Date\.parse\(s\.rec\?s\.rec\.analyzedAt:s\.analyzedAt\)/);   // l'heure réellement enregistrée, jamais inventée
  for (const spot of ['<b style="font-family:var(--serif)', '<option value="${s.id}"', 'Du ${dateLabel(A)} au ${dateLabel(B)}', '<p class="kicker">Analyse du ${dateLabel(s)}']) assert.ok(app.includes(spot) && app.slice(app.indexOf(spot), app.indexOf(spot) + 260).includes('dateLabel('), spot);
});

test('UX4 onboarding : compteur d\'objectifs et séparation « ce que vous souhaitez travailler / constat »', () => {
  assert.match(app, /pas un constat sur votre peau\.<\/p><p class="muted" role="status" aria-live="polite"[^>]*><b>\$\{goalCount\(\)\}<\/b>/);
  assert.match(app, /const goalCount=\(\)=>`\$\{state\.goals\.length\}\/3 objectifs sélectionnés`/);
});

test('UX5 analyse réelle : une seule action principale par état, libellés clairs, aucun faux indicateur', () => {
  const scan = between('V.scan=()=>', 'const AN_STEPS');
  assert.match(scan, /Ajouter une photo/);
  assert.match(scan, /Choisir une autre photo/);
  assert.match(scan, /\$\{DEMO_MODE\?`<div class="qual">/);                         // plus de pseudo-contrôle de lumière en mode réel
  assert.match(scan, /DERMAI ne la conserve pas\./);
  assert.match(scan, /Réessayer/);
  const an = between('V.analyzing=()=>', '/* Résultat */');
  assert.match(an, /Cela peut prendre un moment\. Gardez cette page ouverte\./);
  assert.doesNotMatch(an, /\d+\s?%|environ \d+|secondes?/i);                         // aucune durée ni pourcentage promis
});

test('UX6 profil et confidentialité réels : aucun réglage ni action factice', () => {
  const profile = between('V.profile=()=>', 'V.privacy=');
  assert.match(profile, /\$\{DEMO_MODE\?`<section><div class="hd"><h2 class="h3">Préférences<\/h2>/);          // « Rappel de scan » : démo seulement (aucun rappel n'existe)
  assert.match(profile, /state\.user\.email&&!signedIn\(\)/);                                                  // e-mail non répété
  assert.doesNotMatch(profile, /maquette v2\.\s*\$\{DEMO_MODE\?`Données fictives\.`:``\}/);
  const priv = between('V.privacy=', 'const CONFIRMS');
  assert.match(priv, /\$\{DEMO_MODE\?`<section>\$\{sw\(`keep`/);                                                // « Conserver mes photos » : démo seulement
  assert.match(priv, /\$\{DEMO_MODE\?`<button class="rowlink" data-act="confirm" data-v="photos"/);
  assert.match(priv, /signedIn\(\)\?`<button class="rowlink" data-act="confirm" data-v="delete-account">/);       // suppression réelle, proposée seulement à une personne connectée
  assert.doesNotMatch(priv, /Compte supprimé \(simulation\)/);
  assert.match(priv, /DERMAI n'en garde aucune copie/);
  assert.match(priv, /photos originales ne sont pas non plus enregistrées avec vos analyses/);
});

test('UX7 un message d\'erreur du serveur non textuel n\'est jamais affiché', () => {
  assert.match(app, /j&&typeof j\.error===`string`&&j\.error/);
});

test('UX8 CSS : cartes d\'actifs compactes sur mobile, contraste des numéros, lignes de priorités aérées', () => {
  assert.match(css('components/card.css'), /@media \(max-width:560px\)\{\s*\.acard\{flex-wrap:wrap\}/);
  assert.match(css('components/card.css'), /\.acard \.idx\{color:var\(--ink-3\)\}/);
  assert.match(css('components/list.css'), /@media \(max-width:400px\)\{\.c-list-row\{gap:var\(--s-2\)\}/);
});

test('UX9 microcopy : aucune formulation absolue ou médicale dans l\'interface', () => {
  const ui = app.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  assert.doesNotMatch(ui, /\b(élimine|guérit|guérir|corrige définitivement|garanti|miracle|disparaît définitivement)\b/i);
  assert.doesNotMatch(ui, /Votre diagnostic|nous diagnostiquons|traitement médical/i);
});
