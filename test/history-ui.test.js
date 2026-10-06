'use strict';
/* Historique et progression persistants : câblage de js/app.js (contrôles de source, comme account-ui.test.js) et règles de confidentialité. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Engine = require('../js/engine/index.js');
const app = fs.readFileSync(path.join(__dirname, '../js/app.js'), 'utf8');
const acct = fs.readFileSync(path.join(__dirname, '../js/account.js'), 'utf8');
const between = (a, b) => app.slice(app.indexOf(a), app.indexOf(b, app.indexOf(a)));

test('HU1 version du moteur déterministe (sémantique), enregistrée avec chaque analyse', () => {
  assert.match(Engine.VERSION, /^\d+\.\d+\.\d+$/);
  assert.match(app, /engineVersion:Engine\.VERSION/);
});

test('HU2 l\'enregistrement ne se fait qu\'en mode réel, après une analyse réussie, jamais en démo', () => {
  assert.match(between('async function saveScan', 'async function deleteHistory'), /if\(DEMO_MODE\|\|!ACCOUNT\|\|!ACCOUNT\.available/);
  const commit = between('function commitRealScan', 'const provider=');
  assert.match(commit, /saveScan\(r\)/);
  assert.equal((app.match(/saveScan\(/g) || []).length, 3, 'définition, commitRealScan, nouvel essai');
  // l'analyse démo n'appelle jamais saveScan : seule runRealAnalysis passe par commitRealScan, uniquement dans le chemin « succès »
  const real = between('async function runRealAnalysis', 'function loadPhoto');
  assert.ok(real.indexOf('commitRealScan(r)') < real.indexOf('catch(err)'));
  assert.doesNotMatch(between('function runAnalysis()', 'function toast'), /saveScan|commitRealScan|saveAnalysis/);
});

test('HU3 l\'enregistrement ne bloque pas l\'affichage du résultat et ne perd jamais le résultat', () => {
  assert.match(between('function commitRealScan', 'const provider='), /saveScan\(r\);\s*\/\/ sans attendre/);
  assert.doesNotMatch(between('function commitRealScan', 'const provider='), /await saveScan/);
  assert.match(acct, /Votre analyse est disponible, mais nous n\\'avons pas pu l\\'enregistrer dans votre historique\. Réessayez\./);
  assert.match(app, /data-act="retry-analysis">Réessayer/);
});

test('HU4 idempotence : identifiant propre à l\'analyse, envois simultanés écartés, jamais le task_id', () => {
  assert.match(app, /crypto\.randomUUID/);
  assert.match(between('async function saveScan', 'async function deleteHistory'), /if\(inflight\.has\(sc\.rec\.id\)\)return/);
  assert.match(acct, /resolution=ignore-duplicates/);
  assert.doesNotMatch(between('function recordOfScan', 'function isRecordable'), /task_?id|taskId/i);
  assert.doesNotMatch(acct.slice(acct.indexOf('function analysisToRow'), acct.indexOf('function analysisFromRow')), /task_?id|taskId/i);
});

test('HU5 la ligne enregistrée ne contient ni photo, ni masque, ni rawScore, ni JSON du fournisseur', () => {
  const rec = between('function recordOfScan', 'function isRecordable');
  assert.doesNotMatch(rec, /photo|realPreview|realBlob|mask|raw|blob/i);
  assert.match(rec, /displayScore/);               // scores affichés (0-100, 100 = meilleur) uniquement
  assert.match(acct, /liste blanche|Liste blanche/i);
});

test('HU6 une analyse échouée ou invalide ne crée aucune ligne', () => {
  assert.match(between('function isRecordable', 'async function saveScan'), /displayScore/);
  assert.match(app, /certaines valeurs ne sont pas exploitables/);
});

test('HU7 historique : tri explicite récent → ancien, page de 20, « Voir plus », états vide et erreur', () => {
  assert.match(app, /const HISTORY_PAGE=20/);
  assert.match(app, /sort\(\(a,b\)=>tsOf\(b\)-tsOf\(a\)/);
  assert.match(app, /data-act="more-history"/);
  assert.match(app, /Votre historique apparaîtra après votre première analyse\./);
  assert.match(app, /data-act="retry-history">Réessayer/);
  assert.match(acct, /order=analyzed_at\.desc,id\.desc/);
  assert.match(acct, /select=id,analyzed_at,global_score,skin_type,skin_age,metrics,priorities,goals_snapshot,engine_version/);
  assert.doesNotMatch(acct, /select=\*/);
});

test('HU8 anciennes analyses : priorités et objectifs enregistrés, jamais « Vos priorités actuelles »', () => {
  assert.match(app, /Repères à soutenir à cette date/);
  assert.match(app, /Vos objectifs à cette date/);
  assert.doesNotMatch(app, /Vos priorités actuelles(?!,)/);          // seul le titre de la progression « Vos priorités actuelles, depuis l'analyse précédente » existe
  assert.match(app, /s\.rec&&i!==state\.latest\?s\.rec\.goals:state\.goals/);
  assert.match(app, /s\.rec&&s\.id!==state\.latest\?s\.rec\.priorities:/);
});

test('HU9 progression : 1 analyse, 2 ou plus, données manquantes, type de peau, score global séparé, seuil inchangé', () => {
  assert.match(app, /Votre première analyse est enregistrée\./);
  assert.match(app, /Faites une nouvelle analyse plus tard pour suivre votre évolution\./);
  assert.match(app, /Profil de peau indiqué par l'analyse : \$\{x\} → \$\{y\}/);
  assert.match(app, /Le score global est une information séparée de vos priorités/);
  assert.match(app, /Donnée indisponible/);
  assert.match(app, /state\.cmpA=Math\.max\(last-1,0\)/);
  assert.match(require('fs').readFileSync(path.join(__dirname, '../js/skin-model.js'), 'utf8'), /TREND_STEP = 2/);
});

test('HU10 confidentialité : analyses dans le compte, photos non enregistrées, accès propre, aucune durée inventée', () => {
  const priv = between('V.privacy=', 'const CONFIRMS');
  assert.match(priv, /analyses peuvent être enregistrées dans votre compte/);
  assert.match(priv, /historique et votre progression/);
  assert.match(priv, /photos originales ne sont pas non plus enregistrées avec vos analyses/);
  assert.match(priv, /vous seul pouvez accéder à vos analyses/);
  assert.doesNotMatch(priv, /\b\d+\s*(jours|mois|ans)\b|pendant/i);
});

test('HU11 changement de compte et déconnexion : plus aucune analyse en mémoire ; suppression réelle, pas simulée', () => {
  assert.match(between('function resetPrivateState', 'const softStatus'), /SCANS\.length=0/);
  assert.match(between('function resetPrivateState', 'const softStatus'), /state\.analysisSave=/);
  assert.match(app, /case `do-confirm`:closeSheet\(\);if\(v===`history`&&!DEMO_MODE\)\{deleteHistory\(\);break\}/);
  assert.match(app, /await loadHistory\(\)/);
});
