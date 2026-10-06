'use strict';
/* =========================================================
   DERMAI, maquette interactive v2
   0. Configuration    1. Données fictives   2. Fournisseurs d'analyse
   3. Composants       4. Écrans             5. Navigation

   ARCHITECTURE CIBLE
   Frontend DERMAI -> Backend DERMAI -> SkinAnalysisProvider
   -> Perfect Corp (ou autre) -> JSON brut -> Normalizer
   -> Concern Engine -> Recommendation Engine -> Routine -> Produits
   La clé API du fournisseur ne doit JAMAIS apparaître ici :
   elle reste côté serveur.
   ========================================================= */

/* ---------- 0. CONFIGURATION ---------- */
/* Mode démo : vrai par défaut. Seul /api/config-js (servi par Vercel selon DERMAI_DEMO_MODE) peut le passer à faux, et uniquement
   avec demoMode === false explicite. Si config.js est absent ou illisible, on reste en démo. */
const DEMO_MODE = !(window.DERMAI_CONFIG && window.DERMAI_CONFIG.demoMode === false);   // true : données et photo fictives. false : appelle le backend DERMAI.
/* Mode réel : une seule photo frontale, réduite en JPEG côté navigateur, gardée en mémoire uniquement. */
const REAL_PHOTO = {maxSide:1600,maxBytes:4*1024*1024,quality:.9};   // maxBytes : même limite que le backend
const SCAN_ERR_GENERIC = `Nous n'avons pas pu analyser cette photo. Veuillez réessayer.`;
const AUTH_NEEDED = `Connectez-vous pour analyser votre peau.`;   // une analyse exige un compte : le serveur refuse toute requête sans session valide
/* Illustration de l'accueil et du mode démonstration : une personne fictive générée par IA, servie comme fichier (et non incluse dans le script) pour alléger le premier chargement. */
const PORTRAIT_SRC = `img/portrait.jpg`;       // Photo fictive de démonstration (personne générée par IA), intégrée. Remplaçable par un chemin, ex. `assets/portrait.jpg`.
/* Zones du visage, en coordonnées 300 x 375 (cadre 4:5). À ajuster selon la photo utilisée. */
const PORTRAIT_ZONES={
  front:{cx:150,cy:96,rx:50,ry:18},
  jg:{cx:106,cy:178,rx:24,ry:30},
  jd:{cx:194,cy:178,rx:24,ry:30},
  nez:{cx:150,cy:168,rx:12,ry:28},
  menton:{cx:150,cy:226,rx:24,ry:13},
  yg:{cx:120,cy:142,rx:21,ry:9},
  yd:{cx:180,cy:142,rx:21,ry:9}
};
/* Réglages pour la photo de démonstration intégrée (repère 300 x 300, photo carrée). */
const PHOTO_ZONES={
  front:{cx:153,cy:78,rx:46,ry:16},
  jg:{cx:97,cy:173,rx:26,ry:28},
  jd:{cx:209,cy:171,rx:26,ry:28},
  nez:{cx:151,cy:158,rx:20,ry:28},
  menton:{cx:153,cy:238,rx:30,ry:14},
  yg:{cx:112,cy:139,rx:27,ry:13},
  yd:{cx:190,cy:139,rx:27,ry:13}
};

/* ---------- 1. DONNÉES FICTIVES (mode démonstration) ---------- */
const demoScan=(id,date,short,day,globalScore,ui)=>({id,date,short,day,
  normalized:SkinModel.sanitizeNormalized({schemaVersion:SkinModel.SCHEMA_VERSION,normalized:Object.assign({globalScore,skinType:{whole:`Combination`}},
    Object.fromEntries(Object.entries(ui).map(([k,uiScore])=>[k,{uiScore}])))})});
const SCANS=[
  demoScan(0,`29 septembre`,`29 SEPT`,1,61,{pigmentation:22,pores:36,hydration:52,acne:63,oiliness:42,redness:69,texture:56,wrinkles:78}),
  demoScan(1,`30 octobre`,`30 OCT`,30,64,{pigmentation:39,pores:43,hydration:73,acne:76,oiliness:51,redness:74,texture:64,wrinkles:79}),
  demoScan(2,`30 novembre`,`30 NOV`,60,68,{pigmentation:48,pores:49,hydration:79,acne:82,oiliness:56,redness:78,texture:70,wrinkles:80})
];
/* Contenu éditorial statique de 4 indicateurs (conseils généraux). Aucun score ici. */
const CONCERNS={
  pigmentation:{label:`Pigmentation`,
    tips:[`Appliquez une protection solaire chaque matin, même par temps couvert.`,`Évitez de frotter ou de gratter la peau.`]},
  pores:{label:`Pores`,
    tips:[`Nettoyez le visage matin et soir avec un produit doux.`,`Évitez de presser ou de frotter la peau, cela peut l'irriter.`]},
  hydration:{label:`Hydratation`,
    tips:[`Appliquez votre hydratant sur peau légèrement humide.`,`Évitez les eaux de nettoyage trop chaudes.`]},
  acne:{label:`Acné`,
    tips:[`Laver régulièrement sa taie d'oreiller et nettoyer son téléphone fait partie d'une routine soignée.`,`Préférez des textures légères, non comédogènes.`]}
};
const CIDS=[`pigmentation`,`pores`,`hydration`,`acne`];
/* Exemple illustratif de la page d'accueil : trois scores globaux fictifs, passés par le même chemin que les vrais (SkinModel.globalSeries). */
const LANDING_EXAMPLE=(()=>{const g=SkinModel.globalSeries([61,64,68].map(v=>({globalScore:v})));return [`29 SEPT`,`30 OCT`,`30 NOV`].map((label,i)=>({v:g[i],label})).filter(p=>p.v!==null)})();
const CATS=[[`cleanser`,`Nettoyant`],[`serum`,`Sérum`],[`moisturizer`,`Hydratant`],[`spf`,`Protection solaire`],[`exfoliant`,`Exfoliant`],[`mask`,`Masque`]];
const state={route:`landing`,param:null,stack:[],user:DEMO_MODE?{name:`Amina`,email:`amina@exemple.com`}:{name:``,email:``},
  goals:DEMO_MODE?[`tone`,`oil_pores`,`hydration`]:[],noGoal:false,level:DEMO_MODE?`simple`:``,cats:DEMO_MODE?[`cleanser`,`moisturizer`]:[],
  scanStep:0,shots:[false,false,false],retake:false,run:0,latest:0,view:0,tab:`am`,done:{},filter:`all`,
  gentle:false,exclusions:[],cmpA:0,cmpB:1,prefs:{reminder:true,tips:true,keep:false},photo:``,
  scanStatus:`idle`,scanError:``,realBlob:null,realPreview:``};   // scanStatus : idle | capturing | uploading | processing | success | error
if(DEMO_MODE)try{state.photo=localStorage.getItem(`dermai_demo_photo`)||``}catch(e){}

/* ---------- 2. FOURNISSEURS D'ANALYSE ----------
   Le frontend ne parle qu'à `provider.analyzeSkin(images)`.
   Format normalisé attendu :
   { skinType, acne, pigmentation, pores, oiliness, hydration, redness, texture, wrinkles, global }
   Règle : si le fournisseur ne renvoie pas une valeur, elle reste null.
   Elle n'est JAMAIS inventée : l'interface masque alors l'indicateur. */
class SkinAnalysisProvider{
  async analyzeSkin(images){throw new Error(`analyzeSkin() non implémentée`)}
}
class MockProvider extends SkinAnalysisProvider{
  async analyzeSkin(images){
    await new Promise(r=>setTimeout(r,400));
    return SCANS[Math.min(state.run,SCANS.length-1)];
  }
}
class PerfectCorpProvider extends SkinAnalysisProvider{
  /* Appelle le backend DERMAI (jamais Perfect Corp directement).
     Le backend garde la clé API, envoie la photo et ne renvoie que la racine des scores (liste blanche). */
  /* `blob` : le JPEG de l'utilisateur (jamais PORTRAIT_SRC ni une photo de démonstration). */
  async analyzeSkin(blob,{onStatus=()=>{}}={}){
    if(!(blob instanceof Blob)||!blob.size)throw userError(`Aucune photo à analyser. Veuillez prendre une photo.`);
    if(blob.type!==`image/jpeg`)throw userError(`Format de photo non pris en charge. Utilisez une photo JPEG.`);
    const token=ACCOUNT?await ACCOUNT.accessToken():null;   // jeton de session Supabase (clé publique seulement) : le serveur le vérifie avant tout appel au fournisseur
    const payload=await postJpeg(blob,onStatus,token);
    const normalized=normalizeSkinResult(payload.result);
    if(!normalized)throw userError(SCAN_ERR_GENERIC);
    return toScan(normalized);
  }
}
const userError=m=>Object.assign(new Error(m),{userMessage:m});
/* XMLHttpRequest plutôt que fetch : seul moyen de savoir quand l'envoi est réellement terminé (uploading → processing). */
function postJpeg(blob,onStatus,token){
  return new Promise((resolve,reject)=>{
    const x=new XMLHttpRequest();
    x.open(`POST`,`/api/skin-analysis`);
    x.setRequestHeader(`Content-Type`,`image/jpeg`);
    if(token)x.setRequestHeader(`Authorization`,`Bearer ${token}`);
    x.timeout=65000;
    x.upload.onload=()=>onStatus(`processing`);
    x.onload=()=>{
      let j=null;try{j=JSON.parse(x.responseText)}catch(e){}
      if(x.status>=200&&x.status<300&&j&&j.ok)return resolve(j);
      if(x.status===401)return reject(Object.assign(userError(AUTH_NEEDED),{authRequired:true}));
      if(x.status===429)return reject(Object.assign(userError(j&&typeof j.error===`string`&&j.error?j.error:SCAN_ERR_GENERIC),{quota:true}));
      reject(userError(j&&typeof j.error===`string`&&j.error?j.error:x.status===413?`La photo est trop volumineuse. Veuillez en choisir une plus légère.`:SCAN_ERR_GENERIC));
    };
    x.onerror=()=>reject(userError(`Connexion impossible. Vérifiez votre réseau et réessayez.`));
    x.ontimeout=()=>reject(userError(`L'analyse prend trop de temps. Veuillez réessayer.`));
    onStatus(`uploading`);
    x.send(blob);
  });
}
/* Normalizer : le backend renvoie déjà le résultat normalisé (js/skin-model.js, partagé avec le serveur). Ici on le contrôle
   (version du schéma, champs connus, nombres finis) : null si la réponse n'a pas la forme attendue. Aucune donnée n'est inventée. */
function normalizeSkinResult(result){return SkinModel.sanitizeNormalized(result)}
/* Un scan = normalized (Perfect Corp renommé, contrôlé par sanitizeNormalized) + libellés de date. Aucun score n'est précalculé :
   les écrans lisent SkinModel (toResultView, compareScans, globalSeries), échelle unique 0-100 où 100 = meilleur. */
function toScan(normalized){
  const now=new Date();
  return Object.assign({id:null,real:true,saved:false,day:null,analyzedAt:now.toISOString()},SkinModel.scanLabels(now),{normalized});
}
/* Premier scan réel réussi : les analyses fictives sont retirées, démo et réel ne sont jamais mélangés dans l'historique. */
function commitRealScan(r){
  if(SCANS.some(s=>!s.real))SCANS.length=0;
  r.photo=state.realPreview;state.realPreview=``;   // l'aperçu passe de la photo en attente à l'analyse qu'il a produite
  r.id=SCANS.length;SCANS.push(r);
  const last=SCANS.length-1;
  state.latest=r.id;state.view=r.id;state.cmpA=Math.max(last-1,0);state.cmpB=last;   // la progression compare la dernière analyse à la précédente
  r.rec=recordOfScan(r);                                                              // photo, masque, task_id et rawScore n'en font jamais partie
  saveScan(r);                                                                        // sans attendre : le résultat s'affiche d'abord
}
const provider=DEMO_MODE?new MockProvider():new PerfectCorpProvider();
/* Moteur d'interprétation cosmétique (js/engine) : l'interface appelle run() et affiche. Aucune règle de priorité, d'actif ou de routine ici. */
const Engine=window.DermaiEngine;
/* Profil courant → moteur. Rien n'est mis en cache : toute modification (objectifs, niveau, confort) recalcule la routine à l'affichage suivant.
   L'analyse précédente (si elle existe) sert seulement à comparer, jamais de référence courante. */
/* Catalogue de produits : DÉMONSTRATION en mode démo, RÉEL (js/engine/data/catalog.js, vide tant qu'aucune donnée vérifiée n'existe) en mode réel. Jamais mélangés. */
const catalogNow=()=>DEMO_MODE?Engine.products.PRODUCTS:Engine.catalogData.PRODUCTS;
const engineFor=s=>{const i=SCANS.indexOf(s),prev=i>0?SCANS[i-1]:null;return Engine.run(s.normalized,{goals:s.rec&&i!==state.latest?s.rec.goals:state.goals,level:state.level,cats:state.cats,comfort:{preferGentle:state.gentle},exclusions:state.exclusions},Object.assign({catalog:catalogNow()},prev?{previous:prev.normalized}:{}))};
/* Mode réel : tant qu'aucune vraie analyse n'existe, les analyses fictives de SCANS ne sont jamais montrées comme celles de l'utilisateur. */
const noReal=()=>!DEMO_MODE&&!SCANS.some(s=>s.real);
if(!DEMO_MODE){SCANS.length=0;state.cmpA=0;state.cmpB=1}   // mode réel : aucune analyse fictive n'existe, même en mémoire (la démo seule les utilise)

/* ---------- 3. COMPOSANTS ---------- */
const $app=document.getElementById(`app`),$ov=document.getElementById(`overlay`);

/* ---------- Compte et profil persistant ----------
   Supabase Auth + table profiles via js/account.js (clé publique seulement, RLS côté base). Le profil (objectifs, niveau, approche douce,
   exclusions) est chargé UNE fois à la connexion puis tenu dans `state`, que tous les écrans lisent. Il n'est jamais copié dans le stockage local
   (seule la session d'authentification l'est). Mode démo : aucun compte. Aucune photo, aucun masque, aucun task_id n'est enregistré. */
const ACCOUNT=(!DEMO_MODE&&window.DermaiAccount&&window.DERMAI_CONFIG)?DermaiAccount.create({url:window.DERMAI_CONFIG.supabaseUrl,anonKey:window.DERMAI_CONFIG.supabaseAnonKey,storage:(()=>{try{return window.localStorage}catch(e){return null}})()}):null;
state.account={status:ACCOUNT&&ACCOUNT.available?`checking`:`off`,email:``,loading:false,busy:false,error:``,info:``,formEmail:``,recovery:false};   // off | checking | visitor | signedIn
state.save={status:`idle`,message:``};                                                                                            // idle | saving | saved | error
/* Historique des analyses (table skin_analyses, scores seulement) : état du chargement et de la dernière analyse enregistrée. */
const HISTORY_PAGE=20;
state.history={status:`idle`,hasMore:false,loadingMore:false,error:``,moreError:``};   // idle | loading | ready | error
state.analysisSave={scan:null,status:`idle`,message:``};                              // idle | visitor | saving | saved | error | skipped
const accountOn=()=>state.account.status!==`off`;
/* Visiteur (non connecté, comptes disponibles) : il peut naviguer, mais une analyse exige une connexion. Message humain puis écran de connexion. */
const needsLogin=()=>!DEMO_MODE&&state.account.status===`visitor`;
function askLogin(){state.account.info=AUTH_NEEDED;state.account.error=``;go(`login`,null,{reset:true})}
const signedIn=()=>state.account.status===`signedIn`;
let authEpoch=0;
/* Profil de l'application → forme enregistrée / chargée → état. Un seul endroit, aucune règle dupliquée : Engine.normalizeProfile assainit. */
const profileForSave=()=>{const n=Engine.normalizeProfile({goals:state.goals,level:state.level,exclusions:state.exclusions,comfort:{preferGentle:state.gentle}});return{goals:n.goals,level:state.level,comfort:n.comfort,exclusions:n.exclusions}};
function applyProfile(p){const n=Engine.normalizeProfile(p||{});state.goals=n.goals;state.noGoal=false;state.level=[`none`,`simple`,`full`].includes(p&&p.level)?p.level:``;state.gentle=!!n.comfort.preferGentle;state.exclusions=n.exclusions}
/* Retour à l'état visiteur : plus aucune donnée du compte précédent (objectifs, niveau, approche, exclusions, analyses de la session). */
function resetPrivateState(){
  state.goals=[];state.noGoal=false;state.level=``;state.gentle=false;state.exclusions=[];state.cats=[];state.done={};
  state.user.name=``;state.user.email=``;state.save={status:`idle`,message:``};
  state.history={status:`idle`,hasMore:false,loadingMore:false,error:``,moreError:``};state.analysisSave={scan:null,status:`idle`,message:``};
  if(!DEMO_MODE){SCANS.length=0;state.latest=0;state.view=0;state.cmpA=0;state.cmpB=1;clearReal()}
}
const softStatus=()=>{const el=document.getElementById(`saveStatus`);if(el)el.textContent=state.save.message};
/* Session invalide ou expirée (jeton refusé et non renouvelable) : retour visiteur, plus aucune donnée du compte, invitation à se reconnecter. */
function expireSession(){
  authEpoch++;ACCOUNT.signOut();
  state.account.status=`visitor`;state.account.email=``;state.account.loading=false;state.account.error=``;state.account.info=DermaiAccount.MSG.sessionExpired;
  resetPrivateState();go(`login`,null,{reset:true});
}
let saving=false,pendingSave=false;
async function persist(){
  if(!ACCOUNT||!signedIn())return;
  if(saving){pendingSave=true;return}
  saving=true;const epoch=authEpoch;
  state.save={status:`saving`,message:`Enregistrement…`};softStatus();
  do{
    pendingSave=false;
    const r=await ACCOUNT.saveProfile(profileForSave());
    if(epoch!==authEpoch||!signedIn())break;                       // déconnexion ou changement de compte pendant l'enregistrement
    if(!r.ok){if(r.error===DermaiAccount.MSG.sessionExpired){expireSession();break}state.save={status:`error`,message:r.error};softStatus();toast(r.error);break}
    state.save={status:pendingSave?`saving`:`saved`,message:pendingSave?`Enregistrement…`:`Préférences enregistrées.`};softStatus();
  }while(pendingSave);
  saving=false;
  if(epoch===authEpoch&&state.route===`profile`&&state.save.status===`error`)render(true);
}
async function enterSession(user,fresh){
  authEpoch++;state.account.status=`signedIn`;state.account.email=user.email;state.user.email=user.email;state.account.error=``;state.account.info=``;
  state.account.loading=true;
  if(fresh){applyProfile({})}
  const epoch=authEpoch,r=await ACCOUNT.loadProfile();
  if(epoch!==authEpoch)return;
  state.account.loading=false;
  if(r.ok){if(r.profile)applyProfile(r.profile);else applyProfile({});state.save={status:`idle`,message:``}}
  else if(r.error===DermaiAccount.MSG.sessionExpired){expireSession();return}
  else{state.save={status:`error`,message:r.error}}
  if(fresh)state.history={status:`ready`,hasMore:false,loadingMore:false,error:``,moreError:``};   // compte tout juste créé : aucun historique à charger
  else await loadHistory();
}
/* ---------- Historique persistant ---------- */
const newAnalysisId=()=>{try{if(window.crypto&&crypto.randomUUID)return crypto.randomUUID()}catch(e){}
  return `xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx`.replace(/[xy]/g,c=>{const r=Math.random()*16|0;return(c===`x`?r:(r&3|8)).toString(16)})};
const tsOf=s=>s.rec?Date.parse(s.rec.analyzedAt):s.id;
/* Une ligne enregistrée → un scan de l'application. Seuls les scores enregistrés sont relus (uiScore, 0-100) : aucune photo, aucun rawScore. */
function scanOfRecord(a){
  const n=SkinModel.sanitizeNormalized({schemaVersion:SkinModel.SCHEMA_VERSION,normalized:Object.assign({globalScore:a.globalScore,skinAge:a.skinAge,skinType:{whole:a.skinType}},
    Object.fromEntries(SkinModel.METRIC_KEYS.map(k=>[k,{uiScore:a.metrics[k]}])))});
  return n?Object.assign({id:null,real:true,saved:true,day:null,rec:a},SkinModel.scanLabels(new Date(a.analyzedAt)),{normalized:n}):null;
}
const reindex=()=>SCANS.forEach((s,i)=>{s.id=i});
/* Chargement de la première page (les plus récentes). Les analyses du compte remplacent celles de la session : jamais de mélange entre comptes. */
async function loadHistory(){
  const epoch=authEpoch;
  state.history={status:`loading`,hasMore:false,loadingMore:false,error:``,moreError:``};
  const r=await ACCOUNT.listAnalyses({limit:HISTORY_PAGE});
  if(epoch!==authEpoch)return;
  if(!r.ok){
    if(r.error===DermaiAccount.MSG.sessionExpired){expireSession();return}
    state.history={status:`error`,hasMore:false,loadingMore:false,error:r.error,moreError:``};
    return;
  }
  SCANS.length=0;
  r.analyses.slice().sort((a,b)=>Date.parse(a.analyzedAt)-Date.parse(b.analyzedAt)||(a.id<b.id?-1:1)).forEach(a=>{const sc=scanOfRecord(a);if(sc)SCANS.push(sc)});   // ordre chronologique explicite
  reindex();
  const last=SCANS.length-1;
  state.latest=Math.max(last,0);state.view=state.latest;state.cmpA=Math.max(last-1,0);state.cmpB=Math.max(last,0);
  state.history={status:`ready`,hasMore:r.hasMore,loadingMore:false,error:``,moreError:``};
}
async function retryHistory(){
  if(!signedIn())return;
  render(true);                                   // « Chargement de votre historique… »
  await loadHistory();
  if(signedIn())render(true);
}
/* « Voir plus » : page suivante, plus anciennes. Doublons écartés par identifiant ; les repères (analyse actuelle, comparaison) suivent leurs analyses. */
async function loadMoreHistory(){
  const H=state.history;
  if(!signedIn()||H.loadingMore||!H.hasMore)return;
  const epoch=authEpoch;H.loadingMore=true;H.moreError=``;render(true);
  const r=await ACCOUNT.listAnalyses({limit:HISTORY_PAGE,offset:SCANS.filter(s=>s.saved).length});
  if(epoch!==authEpoch)return;
  H.loadingMore=false;
  if(!r.ok){if(r.error===DermaiAccount.MSG.sessionExpired){expireSession();return}H.moreError=r.error;render(true);return}
  const have=new Set(SCANS.filter(s=>s.rec).map(s=>s.rec.id));
  const older=r.analyses.filter(a=>!have.has(a.id)).sort((a,b)=>Date.parse(a.analyzedAt)-Date.parse(b.analyzedAt)).map(scanOfRecord).filter(Boolean);
  SCANS.unshift(...older);reindex();
  const k=older.length;state.latest+=k;state.view+=k;state.cmpA+=k;state.cmpB+=k;
  H.hasMore=r.hasMore;render(true);
}
/* Enregistrement d'une analyse réelle réussie. Ne bloque jamais l'affichage du résultat ; une panne ne fait jamais perdre le résultat.
   Un identifiant propre à l'analyse (créé ici, pas le task_id du fournisseur) rend le nouvel essai et le double clic sans effet de doublon. */
const SAVE_FAIL=DermaiAccount.MSG.analysisSaveFailed;
const inflight=new Set();
const softAnalysisStatus=()=>{if(state.route===`result`)render(true)};
function recordOfScan(sc){
  const n=sc.normalized,r=viewOf(sc),metrics={};
  SkinModel.METRIC_KEYS.forEach(k=>{metrics[k]=SkinModel.displayScore(n[k]&&n[k].uiScore)});
  return{id:newAnalysisId(),analyzedAt:sc.analyzedAt,globalScore:r.global.score,skinType:(n.skinType&&n.skinType.whole)||null,skinAge:r.skinAge,metrics,
    priorities:engineFor(sc).priorities.items.map(m=>({id:m.indicator,label:m.label,score:m.score,band:m.band})),goals:[...state.goals],engineVersion:Engine.VERSION};
}
/* Une analyse n'est enregistrée que si tous ses scores présents sont exploitables (0-100) et qu'au moins un indicateur l'est : rien d'inventé. */
function isRecordable(sc){
  const n=sc.normalized,bad=v=>v!==null&&v!==undefined&&SkinModel.displayScore(v)===null;
  return SkinModel.METRIC_KEYS.some(k=>SkinModel.displayScore(n[k]&&n[k].uiScore)!==null)&&!SkinModel.METRIC_KEYS.some(k=>bad(n[k]&&n[k].uiScore))&&!bad(n.globalScore);
}
async function saveScan(sc){
  if(DEMO_MODE||!ACCOUNT||!ACCOUNT.available||!sc||sc.saved)return;
  if(!isRecordable(sc)){state.analysisSave={scan:sc,status:`skipped`,message:`Votre analyse est disponible, mais elle n'a pas été ajoutée à votre historique : certaines valeurs ne sont pas exploitables.`};softAnalysisStatus();return}
  if(!signedIn()){state.analysisSave={scan:sc,status:`visitor`,message:`Cette analyse n'est pas enregistrée : elle disparaîtra quand vous quitterez cette session. Créez un compte ou connectez-vous avant votre prochaine analyse pour conserver votre historique.`};softAnalysisStatus();return}
  if(!sc.rec)sc.rec=recordOfScan(sc);
  if(inflight.has(sc.rec.id))return;                                  // double clic ou événement répété : un seul envoi à la fois
  inflight.add(sc.rec.id);const epoch=authEpoch;
  state.analysisSave={scan:sc,status:`saving`,message:`Enregistrement de votre analyse…`};softAnalysisStatus();
  const r=await ACCOUNT.saveAnalysis(sc.rec);
  inflight.delete(sc.rec.id);
  if(epoch!==authEpoch||!signedIn())return;                           // déconnexion ou changement de compte pendant l'enregistrement
  if(r.ok){sc.saved=true;state.analysisSave={scan:sc,status:`saved`,message:`Analyse enregistrée dans votre historique.`}}
  else if(r.error===DermaiAccount.MSG.sessionExpired){expireSession();return}
  else state.analysisSave={scan:sc,status:`error`,message:SAVE_FAIL};
  softAnalysisStatus();
}
async function deleteHistory(){
  if(!DEMO_MODE&&signedIn()){
    const epoch=authEpoch,r=await ACCOUNT.deleteAnalyses();
    if(epoch!==authEpoch)return;
    if(!r.ok){if(r.error===DermaiAccount.MSG.sessionExpired){expireSession();return}toast(r.error);return}
  }
  SCANS.length=0;state.latest=0;state.view=0;state.cmpA=0;state.cmpB=1;state.analysisSave={scan:null,status:`idle`,message:``};
  state.history={status:`ready`,hasMore:false,loadingMore:false,error:``,moreError:``};
  toast(`Historique supprimé.`);if(state.route===`privacy`||state.route===`analyses`)render(true);
}
/* Retour d'un lien reçu par e-mail (confirmation d'adresse, mot de passe oublié). Les jetons du fragment d'adresse sont effacés de l'URL dès la lecture ;
   la session est ouverte après vérification auprès de Supabase (l'identité n'est jamais déduite du lien lui-même). */
async function handleAuthRedirect(redirect){
  if(redirect.kind!==`session`){state.account.status=`visitor`;state.account.error=DermaiAccount.MSG.linkInvalid;state.account.info=``;go(`login`,null,{reset:true,replace:true});return}
  const r=await ACCOUNT.acceptRedirect(redirect);
  if(!r.ok){state.account.status=`visitor`;state.account.error=r.error;state.account.info=``;go(`login`,null,{reset:true,replace:true});return}
  resetPrivateState();
  await enterSession(r.user,false);
  if(!signedIn())return;
  if(r.type===`recovery`){state.account.recovery=true;go(`reset`,null,{reset:true,replace:true});return}
  toast(DermaiAccount.MSG.emailConfirmed);go(`welcome`,null,{reset:true,replace:true});
}
async function bootAccount(arrivedWithoutPage,redirect){
  if(!ACCOUNT||!ACCOUNT.available)return;
  if(redirect){await handleAuthRedirect(redirect);return}
  const u=await ACCOUNT.restoreSession();
  if(u)await enterSession(u,false);else{state.account.status=`visitor`;if(state.route===`scan`||state.route===`analyzing`){askLogin();return}}
  /* Connecté, arrivé à la racine du site (aucune page dans l'adresse) : on ouvre directement son espace. Une page choisie (ex. #landing) est respectée. */
  if(u&&arrivedWithoutPage&&state.route===`landing`){go(`home`,null,{reset:true,replace:true});return}
  if([`landing`,`profile`,`home`,`result`,`concern`,`routine`,`actives`,`active`,`products`,`progress`,`analyses`,`privacy`].includes(state.route))render(true);
}
async function submitForgot(form){
  const email=(form.querySelector(`[name=email]`).value||``).trim(),btn=form.querySelector(`button[type=submit]`);
  state.account.formEmail=email;state.account.error=``;state.account.info=``;
  if(btn){btn.disabled=true;btn.textContent=`Envoi…`}
  const r=await ACCOUNT.requestPasswordReset(email);
  if(r.ok)state.account.info=r.message;else state.account.error=r.error;
  render();
}
async function submitReset(form){
  const pw=form.querySelector(`[name=password]`).value||``,pw2=form.querySelector(`[name=password2]`).value||``,btn=form.querySelector(`button[type=submit]`);
  state.account.error=``;state.account.info=``;
  if(pw!==pw2){state.account.error=`Les deux mots de passe ne sont pas identiques.`;render();return}
  if(btn){btn.disabled=true;btn.textContent=`Enregistrement…`}
  const r=await ACCOUNT.updatePassword(pw);
  form.querySelector(`[name=password]`).value=``;form.querySelector(`[name=password2]`).value=``;
  if(!r.ok){if(r.error===DermaiAccount.MSG.sessionExpired){expireSession();return}state.account.error=r.error;render();return}
  state.account.recovery=false;toast(r.message);go(`home`,null,{reset:true});
}
async function resendConfirmation(){
  const el=document.getElementById(`f-mail`),email=((el&&el.value)||state.account.formEmail||``).trim();
  state.account.formEmail=email;state.account.error=``;state.account.info=``;
  const r=await ACCOUNT.resendConfirmation(email);
  if(r.ok)state.account.info=r.message;else state.account.error=r.error;
  render();
}
async function deleteMyAccount(){
  toast(`Suppression en cours…`);const epoch=authEpoch;
  const r=await ACCOUNT.deleteAccount();
  if(epoch!==authEpoch)return;
  if(!r.ok){if(r.error===DermaiAccount.MSG.sessionExpired){expireSession();return}toast(r.error);return}
  authEpoch++;state.account.status=`visitor`;state.account.email=``;state.account.loading=false;state.account.recovery=false;
  resetPrivateState();go(`landing`,null,{reset:true});toast(`Votre compte a été supprimé.`);
}
async function submitAuth(kind,form){
  const email=(form.querySelector(`[name=email]`).value||``).trim(),pw=form.querySelector(`[name=password]`).value||``;
  const btn=form.querySelector(`button[type=submit]`);
  state.account.formEmail=email;state.account.error=``;state.account.info=``;
  if(btn){btn.disabled=true;btn.textContent=kind===`signup`?`Création…`:`Connexion…`}
  const r=kind===`signup`?await ACCOUNT.signUp(email,pw):await ACCOUNT.signIn(email,pw);
  form.querySelector(`[name=password]`).value=``;
  if(!r.ok){state.account.error=r.error;render();return}
  if(r.needsConfirmation){state.account.info=r.message;go(`login`,null,{replace:true});return}
  resetPrivateState();
  await enterSession(r.user,kind===`signup`);
  state.account.formEmail=``;
  if(kind===`signup`)go(`welcome`,null,{replace:true});else go(`home`,null,{reset:true});
}
async function logout(){
  await ACCOUNT.signOut();authEpoch++;
  state.account.status=`visitor`;state.account.email=``;state.account.loading=false;
  resetPrivateState();go(`landing`,null,{reset:true});toast(`Vous êtes déconnecté.`);
}
const esc=s=>String(s).replace(/[&<>"]/g,c=>({'&':`&amp;`,'<':`&lt;`,'>':`&gt;`,'"':`&quot;`}[c]));
const NB=`\u00a0`;
const fmt=n=>n.toLocaleString(`fr-FR`).replace(/[\u202f\u00a0\s]/g,NB)+NB+`FCFA`;
const ICONS={
  back:`<path d="M15 5l-7 7 7 7"/>`,chev:`<path d="M9 5l7 7-7 7"/>`,check:`<path d="M5 12.5l4.5 4.5L19 7.5"/>`,
  home:`<path d="M4 11l8-7 8 7v9a1 1 0 01-1 1h-4v-6H9v6H5a1 1 0 01-1-1z"/>`,
  scan:`<path d="M4 8V5a1 1 0 011-1h3M16 4h3a1 1 0 011 1v3M20 16v3a1 1 0 01-1 1h-3M8 20H5a1 1 0 01-1-1v-3"/><circle cx="12" cy="12" r="3"/>`,
  routine:`<path d="M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01"/>`,
  chart:`<path d="M4 19V5M4 19h16M8 15l4-4 3 3 5-6"/>`,user:`<circle cx="12" cy="8" r="4"/><path d="M4 20c1-4 4.5-6 8-6s7 2 8 6"/>`,
  sun:`<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5L19 19M5 19l1.5-1.5M17.5 6.5L19 5"/>`,
  moon:`<path d="M20 14.5A8 8 0 019.5 4 8 8 0 1020 14.5z"/>`,
  shield:`<path d="M12 3l7 3v5c0 4.5-3 8-7 10-4-2-7-5.5-7-10V6z"/>`,lock:`<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 018 0v3"/>`,
  trash:`<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>`,info:`<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>`,
  sparkle:`<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/>`,
  glasses:`<circle cx="7" cy="14" r="3.5"/><circle cx="17" cy="14" r="3.5"/><path d="M10.5 14h3M3.5 14L5 7M20.5 14L19 7"/>`,
  face:`<circle cx="12" cy="12" r="9"/><path d="M8.5 15h7M9 10h.01M15 10h.01"/>`,download:`<path d="M12 4v11M7 11l5 5 5-5M5 20h14"/>`,
  arrow:`<path d="M5 12h14M13 6l6 6-6 6"/>`,camera:`<path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>`,
  eye:`<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>`,
  layers:`<path d="M12 3l9 5-9 5-9-5zM3 13l9 5 9-5"/>`,out:`<path d="M15 4h4a1 1 0 011 1v14a1 1 0 01-1 1h-4M10 8l-4 4 4 4M6 12h10"/>`,
  image:`<rect x="3" y="4" width="18" height="16" rx="3"/><circle cx="9" cy="10" r="1.6"/><path d="M4 18l5-5 4 4 3-3 4 4"/>`
};
const ic=n=>`<svg class="ic" viewBox="0 0 24 24" aria-hidden="true">${ICONS[n]||``}</svg>`;
const photoSrc=()=>(!DEMO_MODE&&state.realPreview)||state.photo||PORTRAIT_SRC||``;   // affichage seulement : jamais utilisé pour un envoi
const demoTag=()=>DEMO_MODE?`<span class="c-badge c-badge--demo">Mode démonstration</span>`:``;

/* Portrait : photo fictive de démonstration (ou illustration d'attente) + zones d'analyse */
function placeholderSVG(style){
  return `<svg class="ph" viewBox="0 0 300 375" preserveAspectRatio="xMidYMid slice" aria-hidden="true" style="${style}">
   <rect width="300" height="375" class="ph-bg"/>
   <ellipse cx="150" cy="128" rx="92" ry="102" class="ph-hair"/>
   <path d="M30 375c8-52 56-76 120-76s112 24 120 76z" class="ph-cloth"/>
   <rect x="128" y="236" width="44" height="70" rx="18" class="ph-skin2"/>
   <ellipse cx="150" cy="158" rx="60" ry="78" class="ph-skin"/>
   <path d="M108 130q14-9 30 0M162 130q14-9 30 0" class="ph-line"/>
   <path d="M118 144q10 7 20 0M162 144q10 7 20 0" class="ph-line"/>
   <path d="M150 150c-1 14-3 22-8 30 6 5 10 5 16 0" class="ph-line" style="opacity:.5"/>
   <path d="M132 208q18 9 36 0q-18 12-36 0z" class="ph-lip"/>
  </svg>`;
}
function portrait({on=[],shift=0,cls=``,importBtn=false,photo,decor=false}={}){
  /* Mode réel : seule la photo de l'utilisateur est affichée (celle de l'analyse, ou la photo en attente pendant le scan). Ni zones ni notes :
     le backend ne renvoie aucune localisation. `decor` : visuel d'illustration de la page d'accueil du site uniquement (aucun score). */
  const live=!DEMO_MODE&&!decor;
  if(live)on=[];
  const src=live?(photo||(state.route===`scan`||state.route===`analyzing`?state.realPreview:``)):photoSrc(),st=shift?`transform:scale(1.14) translateX(${shift}%)`:``;
  const Zs=src?PHOTO_ZONES:PORTRAIT_ZONES,vb=src?`0 0 300 300`:`0 0 300 375`;
  const media=src?`<img src="${src}" alt="${live?`Votre photo`:`Photo de démonstration d'une personne fictive`}" style="${st}">`:live?`<div class="c-photo__placeholder">${ic(`image`)}<span>Votre photo apparaîtra ici</span></div>`:placeholderSVG(st);
  const zs=live?``:Object.keys(Zs).map(k=>{const z=Zs[k];return `<g class="z ${on.includes(k)?`on`:``}" data-z="${k}"><ellipse cx="${z.cx}" cy="${z.cy}" rx="${z.rx}" ry="${z.ry}"/></g>`}).join(``);
  const btn=importBtn&&DEMO_MODE&&!src?`<button class="importbtn" data-act="pick-photo">${ic(`image`)} Importer la photo de démonstration</button>`:``;
  return `<div class="portrait ${src?`sq`:``} ${cls}">${media}<svg class="zones" viewBox="${vb}" preserveAspectRatio="xMidYMid slice" aria-hidden="true">${zs}</svg>${btn}</div>`;
}
function bottle(type,color){
  const shapes={
    dropper:`<rect class="k" x="50" y="6" width="20" height="30" rx="5"/><rect class="k" x="54" y="30" width="12" height="16" opacity=".6"/><rect x="34" y="44" width="52" height="100" rx="12" fill="${color}"/><rect class="s" x="42" y="78" width="36" height="44" rx="4" opacity=".85"/><path class="l" d="M48 92h24M48 100h16"/>`,
    jar:`<rect class="k" x="16" y="60" width="88" height="28" rx="8"/><rect x="20" y="86" width="80" height="56" rx="12" fill="${color}"/><path class="l" d="M42 108h36M50 118h20"/>`,
    pump:`<rect class="k" x="42" y="14" width="40" height="14" rx="5"/><rect class="k" x="56" y="26" width="12" height="20" opacity=".6"/><rect x="34" y="44" width="52" height="100" rx="14" fill="${color}"/><rect class="s" x="42" y="80" width="36" height="42" rx="4" opacity=".85"/><path class="l" d="M48 94h24M48 102h16"/>`,
    tube:`<path d="M36 14h48l4 18H32z" fill="${color}" opacity=".7"/><rect x="32" y="30" width="56" height="104" rx="6" fill="${color}"/><rect class="k" x="40" y="132" width="40" height="18" rx="4"/><path class="l" d="M46 70h28M46 80h18"/>`
  };
  return `<svg class="bt" viewBox="0 0 120 160" aria-hidden="true">${shapes[type]||shapes.jar}</svg>`;
}
function spark(vals,{w=130,h=44}={}){
  const mn=Math.min(...vals)-6,mx=Math.max(...vals)+6;
  const pts=vals.map((v,i)=>[(i/((vals.length-1)||1))*(w-10)+5,h-5-((v-mn)/(mx-mn))*(h-10)]);
  const d=pts.map((p,i)=>(i?`L`:`M`)+p[0].toFixed(1)+` `+p[1].toFixed(1)).join(``);
  const l=pts[pts.length-1];
  return `<svg viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" aria-hidden="true"><path class="sp-l" d="${d}"/><circle class="sp-d" cx="${l[0]}" cy="${l[1]}" r="3.5"/></svg>`;
}
function gchart(points){
  const w=320,h=170,px=40,top=40,bot=44;
  const vals=points.map(p=>p.v),mn=Math.min(...vals)-8,mx=Math.max(...vals)+8;
  const P=points.map((p,i)=>[px+(i/((points.length-1)||1))*(w-2*px),top+(1-(p.v-mn)/(mx-mn))*(h-top-bot)]);
  let d=`M${P[0][0]} ${P[0][1]}`;
  for(let i=1;i<P.length;i++){const a=P[i-1],b=P[i],m=(a[0]+b[0])/2;d+=` C${m} ${a[1]} ${m} ${b[1]} ${b[0]} ${b[1]}`}
  const area=d+` L${P[P.length-1][0]} ${h-bot+10} L${P[0][0]} ${h-bot+10} Z`;
  return `<svg class="gchart" viewBox="0 0 ${w} ${h}" role="img" aria-label="Évolution du score global">
   <defs><linearGradient id="gg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" style="stop-color:var(--rose-deep);stop-opacity:.4"/><stop offset="1" style="stop-color:var(--rose-deep);stop-opacity:0"/></linearGradient></defs>
   <path d="${area}" fill="url(#gg)"/><path class="gl-line" d="${d}"/>
   ${P.map((p,i)=>`<circle class="gl-dot" cx="${p[0]}" cy="${p[1]}" r="5.5"/><text class="gv" x="${p[0]}" y="${p[1]-15}" text-anchor="middle">${points[i].v}</text><text class="gd" x="${p[0]}" y="${h-12}" text-anchor="middle">${points[i].label}</text>`).join(``)}</svg>`;
}
const emptyScan=(title,msg,opt={})=>{
  const H=state.history,loading=state.account.status===`checking`||H.status===`loading`;
  const body=loading?`<div class="c-empty">${ic(`chart`)}<h2 class="c-empty__title">Chargement de votre historique…</h2><p class="c-empty__text" role="status">Un instant.</p></div>`
    :H.status===`error`?`<div class="c-empty">${ic(`info`)}<h2 class="c-empty__title">${H.error}</h2><button class="c-btn c-btn--primary c-btn--block" data-act="retry-history">Réessayer</button></div>`
    :`<div class="c-empty">${ic(`chart`)}<h2 class="c-empty__title">${msg[0]}</h2><p class="c-empty__text">${msg[1]}</p><button class="c-btn c-btn--primary c-btn--block" data-go="scan">Analyser ma peau</button></div>`;
  return shell(`<div class="pagehead"><h1>${title}</h1></div><div class="c-card c-card--empty">${body}</div>`,opt);
};
const EMPTY_MSG=[`Aucune analyse pour le moment`,`Faites votre première analyse pour voir vos résultats ici.`];
/* Scores : toute l'interface lit SkinModel (normalized → uiScore / globalScore, échelle 0-100, 100 = meilleur). Aucun calcul de score ici. */
const viewOf=s=>SkinModel.toResultView(s.normalized);
/* Date lisible d'une analyse. Si plusieurs analyses tombent le même jour, l'heure (locale, celle réellement enregistrée) les distingue ; sinon la date seule suffit. */
const timeOf=s=>{const t=Date.parse(s.rec?s.rec.analyzedAt:s.analyzedAt);return Number.isNaN(t)?null:new Date(t).toLocaleTimeString(`fr-FR`,{hour:`2-digit`,minute:`2-digit`})};
const dateLabel=s=>{const t=!DEMO_MODE&&SCANS.filter(x=>x.date===s.date).length>1?timeOf(s):null;return t?`${s.date} · ${t}`:s.date};
const skinLabelOf=s=>{const r=viewOf(s);return r.skinType?r.skinType.label:null};
const skinLabel=r=>r.skinType?r.skinType.label:`Type de peau indisponible`;
const scoreHtml=(v,size)=>v.score===null?`<span class="c-score c-score--${size} c-score--null"><span class="c-score__value">–</span></span>`
  :`<span class="c-score c-score--${size} c-score--${v.band}"><span class="c-score__value">${v.score}</span><span class="c-score__unit">/100</span></span>`;
const bandBadge=v=>v.band?`<span class="c-badge c-badge--${v.band}">${v.bandLabel}</span>`:`<span class="c-badge c-badge--outline">Donnée indisponible</span>`;
const barHtml=v=>v.score===null?``:`<span class="c-bar c-bar--${v.band}" role="img" aria-label="${v.score} sur 100" style="--value:${v.score}"><span class="c-bar__fill"></span></span>`;
/* Points du score global : seules les analyses ayant un score global valide (jamais de 0 ni de point inventé). */
const globalPoints=()=>{const g=SkinModel.globalSeries(SCANS.map(x=>x.normalized));return SCANS.map((x,i)=>({v:g[i],label:x.short})).filter(p=>p.v!==null)};
const trendCard=()=>{
  const g=globalPoints();
  if(g.length<2)return ``;
  return `<section><div class="hd"><h2 class="h3">Progression</h2></div>
      <button class="mcard" data-go="progress" style="width:100%"><div class="r1"><b>Score global</b><span class="c-badge">${g.length} analyses</span></div><div class="r3"><span class="v">${g[0].v} → ${g[g.length-1].v}<small>/100</small></span>${spark(g.map(p=>p.v))}</div></button></section>`;
};
const disc=()=>`<div class="note">${ic(`info`)}<span>Analyse cosmétique visuelle et conseils de soin. Ce n'est pas un diagnostic médical.</span></div>`;
const planProductIds=()=>noReal()?new Set():new Set(engineFor(SCANS[state.latest]).productMatches.map(m=>m.productId));
const initial=()=>state.user.name.trim()?esc(state.user.name.trim().charAt(0).toUpperCase()):DEMO_MODE?`A`:ic(`user`);
const pad=n=>String(n).padStart(2,`0`);
const activeCard=(id,i,why)=>{const a=Engine.actives.byId(id);return `<div class="acard"><span class="idx">${pad(i+1)}</span><div class="grow"><b>${a.label}</b><p class="muted" style="margin:2px 0 8px">${a.summary}</p>${why?`<p class="muted" style="margin-bottom:8px"><span class="u-strong">Pourquoi cet actif ?</span> ${why}</p>`:``}<div class="chips">${a.targets.slice(0,4).map(t=>`<span class="c-badge">${SkinModel.METRIC_LABELS[t]}</span>`).join(``)}</div></div><button class="c-btn c-btn--tonal c-btn--sm" data-go="active:${a.id}">Découvrir</button></div>`};
const whyOf=(eng,id)=>{const e=eng.personalization.selectedActives.find(x=>x.activeId===id);return e?`${e.why} ${e.whyNow}`:``};
const stepName=st=>st.kind===`treatment`?st.activeLabel:{cleanse:`Nettoyant doux`,moisturize:`Hydratant`,spf:`Protection solaire`}[st.kind];
const stepSub=st=>st.kind===`moisturize`?st.texture:{cleanse:`Matin et soir`,spf:`Chaque matin`,treatment:Engine.copy.STEP_LABELS.treatment}[st.kind];

/* ---------- 4. ÉCRANS ---------- */
const NAV=[[`home`,`Accueil`,`home`],[`scan`,`Analyser`,`scan`],[`routine`,`Routine`,`routine`],[`progress`,`Progression`,`chart`],[`profile`,`Profil`,`user`]];
const TAB_OF={home:`home`,result:`home`,concern:`home`,scan:`scan`,routine:`routine`,actives:`routine`,active:`routine`,products:`routine`,progress:`progress`,profile:`profile`,analyses:`profile`,privacy:`profile`};
function shell(inner,{title=``,back=false}={}){
  const tab=TAB_OF[state.route];
  const navBtns=cls=>NAV.map(n=>`<button ${cls?`class="${cls}" `:``}data-go="${n[0]}" data-reset="1" ${tab===n[0]?`aria-current="page"`:``}>${ic(n[2])}<span>${n[1]}</span></button>`).join(``);
  return `<div class="app">
    <aside class="rail"><button class="brand" type="button" data-go="landing" data-reset="1" aria-label="DERMAI, page d'accueil">DERMAI</button><nav aria-label="Navigation principale">${navBtns()}</nav><small>Analyse cosmétique visuelle. DERMAI ne pose pas de diagnostic médical.</small></aside>
    <main class="main"><div class="m-brand"><button class="brand" type="button" data-go="landing" data-reset="1" aria-label="DERMAI, page d'accueil">DERMAI</button></div>${back?`<header class="top"><button class="iconbtn c-icon-btn" data-act="back" aria-label="Retour">${ic(`back`)}</button><b>${title}</b></header>`:``}${DEMO_MODE?`<div class="demo-row">${demoTag()}</div>`:``}${inner}</main>
    <nav class="nav c-bottomnav" aria-label="Navigation principale">${navBtns(`c-bottomnav__item`)}</nav>
  </div>`;
}
const V={};

/* Landing */
V.landing=()=>{
  return `<header class="l-top"><button class="brand" type="button" data-go="landing" data-reset="1" aria-label="DERMAI, page d'accueil">DERMAI</button>${signedIn()?`<button class="c-btn c-btn--tonal c-btn--sm" data-go="home" data-reset="1">Mon espace</button>`:accountOn()?`<button class="c-btn c-btn--tonal c-btn--sm" data-go="login">Se connecter</button>`:`<button class="c-btn c-btn--tonal c-btn--sm" data-go="home" data-reset="1">Se connecter</button>`}</header>
  <section class="hero"><div class="wrap hero-grid">
    <div>
      <p class="tagline">${ic(`sparkle`)} Analyse cosmétique assistée par IA</p>
      <h1 class="hero-h">Votre peau.<br>Votre analyse.<br>Votre routine.</h1>
      <p class="lead">Analysez visuellement votre peau et découvrez une routine personnalisée adaptée à vos besoins.</p>
      <div class="cta-row"><button class="c-btn c-btn--primary" data-go="${signedIn()?`scan`:`signup`}">Analyser ma peau</button><button class="c-btn c-btn--secondary" data-act="scroll" data-v="how">En savoir plus</button></div>
      ${DEMO_MODE?`<div style="margin-top:20px">${demoTag()}</div>`:``}
    </div>
    <div class="hero-art">
      <div class="facebox">${portrait({importBtn:true,decor:true})}</div>
      ${DEMO_MODE?``:`<p class="muted" style="margin-top:8px;text-align:center;font-size:13px">Illustration : personne fictive, aucun résultat réel.</p>`}
    </div>
  </div>
  <div class="wrap"><div class="flowstrip" aria-label="Le principe">
    <div><span class="ico">${ic(`camera`)}</span>Photo</div><div><span class="ico">${ic(`sparkle`)}</span>Intelligence artificielle</div><div><span class="ico">${ic(`eye`)}</span>Analyse</div><div><span class="ico">${ic(`routine`)}</span>Routine personnalisée</div>
  </div></div></section>

  <section class="sec alt" id="how"><div class="wrap">
    <h2>Comment ça marche</h2>
    <div class="steps3">
      <div class="s"><span class="num">1</span><div><h3>Trois photos</h3><p>De face, puis de profil, à la lumière naturelle. Environ une minute.</p></div></div>
      <div class="s"><span class="num">2</span><div><h3>Une analyse visuelle</h3><p>DERMAI repère les préoccupations visibles de votre peau et les classe par priorité.</p></div></div>
      <div class="s"><span class="num">3</span><div><h3>Une routine à votre mesure</h3><p>Des actifs, des gestes et des produits, dans l'ordre où les utiliser.</p></div></div>
    </div>
  </div></section>

  <section class="sec"><div class="wrap two">
    <div>
      <h2>Ce que DERMAI observe</h2>
      <p style="margin-top:14px">Quinze indicateurs visibles, lus sur l'ensemble du visage.</p>
      <div class="plist">
        ${SkinModel.METRIC_KEYS.map(k=>`<div><b>${SkinModel.METRIC_LABELS[k]}</b><span>${Engine.copy.INDICATOR_NOTES[k]||``}</span></div>`).join(``)}
      </div>
    </div>
    <div>
      <div class="facebox">${portrait({decor:true})}</div>
      ${DEMO_MODE?``:`<p class="muted" style="margin-top:8px;text-align:center;font-size:13px">Illustration : personne fictive, aucun résultat réel.</p>`}
    </div>
  </div></section>

  <section class="sec alt"><div class="wrap two rev">
    <div class="c-card">
      <p class="kicker">Comment votre routine est construite</p>
      <div class="rowlink" style="border-top:1px solid var(--line);margin-top:14px"><span class="idx">01</span><div class="grow"><b>Vos indicateurs les plus bas passent en priorité</b><span class="s">Trois priorités au maximum.</span></div></div>
      <div class="rowlink"><span class="idx">02</span><div class="grow"><b>Des actifs cosmétiques en lien avec ces priorités</b><span class="s">Introduits un par un, avec leurs précautions.</span></div></div>
      <div class="rowlink"><span class="idx">03</span><div class="grow"><b>Des étapes classées matin et soir</b><span class="s">Nettoyage, soin ciblé, hydratation, protection solaire.</span></div></div>
    </div>
    <div>
      <h2>Deux peaux ne se ressemblent pas</h2>
      <p style="margin-top:14px;max-width:30em">Vos objectifs, votre routine actuelle et votre analyse se combinent pour choisir les actifs qui comptent pour vous. Pas plus.</p>
    </div>
  </div></section>

  <section class="sec"><div class="wrap two">
    <div>
      <h2>Une routine claire, matin et soir</h2>
      <p style="margin-top:14px;max-width:30em">Chaque étape a un rôle et un ordre. Vous cochez au fil de la journée.</p>
    </div>
    <div class="c-card">
      <p class="kicker" style="display:flex;gap:8px;align-items:center;margin-bottom:6px">${ic(`sun`)} Matin</p>
      ${[`Nettoyage doux`,`Soin ciblé`,`Hydratation`,`Protection solaire`].map((t,i)=>`<div class="rowlink" ${i===0?`style="border-top:1px solid var(--line)"`:``}><span class="idx">${pad(i+1)}</span><div class="grow"><b>${t}</b></div></div>`).join(``)}
    </div>
  </div></section>

  <section class="sec alt"><div class="wrap two rev">
    <div class="c-card"><p class="kicker">Score global</p>${gchart(LANDING_EXAMPLE)}<p class="muted" style="margin-top:6px">Exemple illustratif, données fictives.</p></div>
    <div><h2>Votre peau évolue.</h2><p style="margin-top:14px;max-width:30em">Refaites une analyse quand vous voulez. DERMAI la compare à vos observations précédentes.</p></div>
  </div></section>

  <section class="sec"><div class="wrap two">
    <div><h2>Vos photos, votre contrôle</h2></div>
    <ul class="l-list">
      <li>${ic(`check`)}<span>Vos photos servent à analyser votre peau.</span></li>
      <li>${ic(`check`)}<span>Vous pourrez gérer vos données depuis votre profil.</span></li>
      <li>${ic(`check`)}<span>Les conditions détaillées seront précisées avant le lancement.</span></li>
    </ul>
  </div></section>

  <section class="sec alt" style="text-align:center"><div class="wrap"><h2>Commencez par une analyse</h2><div class="cta-row" style="justify-content:center;margin-top:26px"><button class="c-btn c-btn--primary" data-go="signup">Analyser ma peau</button></div></div></section>
  <footer class="foot"><div class="wrap">DERMAI fournit une analyse cosmétique visuelle et des recommandations de soin. Il ne remplace pas l'avis d'un professionnel de santé.</div></footer>`;
};

/* Inscription */
const demoSignup=()=>`<div class="flow"><div class="flowtop"><button class="iconbtn c-icon-btn" data-go="landing" aria-label="Retour">${ic(`back`)}</button><button class="brand" type="button" data-go="landing" data-reset="1" aria-label="DERMAI, page d'accueil" style="font-size:1.3rem">DERMAI</button></div>
  <div class="body"><h1>Créez votre compte</h1><p style="margin:10px 0 26px">Une minute suffit pour personnaliser votre expérience.</p>
  <div class="stack" style="gap:16px">
    <div class="c-field"><label class="c-field__label" for="f-name">Prénom</label><input class="c-input" id="f-name" autocomplete="given-name" value="${DEMO_MODE?`Amina`:``}"></div>
    <div class="c-field"><label class="c-field__label" for="f-mail">Email</label><input class="c-input" id="f-mail" type="email" autocomplete="email" value="${DEMO_MODE?`amina@exemple.com`:``}"></div>
    <div class="c-field"><label class="c-field__label" for="f-pw">Mot de passe</label><input class="c-input" id="f-pw" type="password" autocomplete="new-password" value="${DEMO_MODE?`motdepasse`:``}"></div>
    <button class="c-btn c-btn--primary c-btn--block" data-act="signup" style="margin-top:6px">Créer mon compte</button>
    <div class="or">ou</div>
    <button class="c-btn c-btn--secondary c-btn--block" data-act="signup">Continuer avec Google</button>
    <button class="c-btn c-btn--secondary c-btn--block" data-act="signup">Continuer avec Apple</button>
  </div><p class="muted" style="margin-top:22px">Maquette : aucun compte réel n'est créé.</p></div></div>`;
const authForm=kind=>{
  const signup=kind===`signup`,A=state.account;
  return `<div class="flow"><div class="flowtop"><button class="iconbtn c-icon-btn" data-go="landing" aria-label="Retour">${ic(`back`)}</button><button class="brand" type="button" data-go="landing" data-reset="1" aria-label="DERMAI, page d'accueil" style="font-size:1.3rem">DERMAI</button></div>
  <div class="body"><h1>${signup?`Créez votre compte`:`Content de vous revoir`}</h1><p style="margin:10px 0 22px">${signup?`Retrouvez vos objectifs et vos préférences sur vos prochains appareils.`:`Connectez-vous pour retrouver vos préférences.`}</p>
  ${A.info?`<div class="c-notice c-notice--success u-my-5" role="status">${ic(`check`)}<div>${A.info}</div></div>`:``}
  ${A.error?`<div class="c-notice u-my-5" role="alert">${ic(`info`)}<div>${A.error}</div></div>`:``}
  ${A.error===DermaiAccount.MSG.notConfirmed||A.info===DermaiAccount.MSG.needsConfirmation?`<p style="margin:-6px 0 14px"><button class="link" type="button" data-act="resend-confirmation">Renvoyer l'e-mail de confirmation</button></p>`:``}
  <form class="stack" style="gap:16px" data-form="${kind}" novalidate>
    <div class="c-field"><label class="c-field__label" for="f-mail">Adresse e-mail</label><input class="c-input" id="f-mail" name="email" type="email" inputmode="email" enterkeyhint="next" autocomplete="email" autocapitalize="none" spellcheck="false" value="${esc(A.formEmail)}" required></div>
    <div class="c-field"><label class="c-field__label" for="f-pw">Mot de passe</label><input class="c-input" id="f-pw" name="password" type="password" enterkeyhint="go" autocomplete="${signup?`new-password`:`current-password`}" required>${signup?`<p class="c-field__hint">8 caractères au minimum.</p>`:`<p style="margin-top:8px"><button class="link" type="button" data-go="forgot">Mot de passe oublié ?</button></p>`}</div>
    <button class="c-btn c-btn--primary c-btn--block" type="submit" style="margin-top:6px">${signup?`Créer mon compte`:`Se connecter`}</button>
  </form>
  <p style="margin-top:20px;text-align:center">${signup?`Déjà un compte ? <button class="link" data-go="login">Se connecter</button>`:`Pas encore de compte ? <button class="link" data-go="signup">Créer mon compte</button>`}</p>
  ${signup?`<p style="text-align:center"><button class="link" data-go="welcome">Continuer sans compte</button></p>`:``}
  <p class="muted" style="margin-top:14px">Seules vos préférences de personnalisation sont associées à votre compte. Vos photos ne sont pas enregistrées dans votre profil.</p></div></div>`;
};
/* Mot de passe oublié : un e-mail de Supabase contient un lien vers le site ; la réponse est la même que l'adresse existe ou non. */
V.forgot=()=>{
  const A=state.account;if(!accountOn())return V.login();
  return `<div class="flow"><div class="flowtop"><button class="iconbtn c-icon-btn" data-go="login" aria-label="Retour">${ic(`back`)}</button><button class="brand" type="button" data-go="landing" data-reset="1" aria-label="DERMAI, page d'accueil" style="font-size:1.3rem">DERMAI</button></div>
  <div class="body"><h1>Mot de passe oublié</h1><p style="margin:10px 0 22px">Saisissez l'adresse de votre compte. Nous vous enverrons un lien pour choisir un nouveau mot de passe.</p>
  ${A.info?`<div class="c-notice c-notice--success u-my-5" role="status">${ic(`check`)}<div>${A.info}</div></div>`:``}
  ${A.error?`<div class="c-notice u-my-5" role="alert">${ic(`info`)}<div>${A.error}</div></div>`:``}
  <form class="stack" style="gap:16px" data-form="forgot" novalidate>
    <div class="c-field"><label class="c-field__label" for="f-mail">Adresse e-mail</label><input class="c-input" id="f-mail" name="email" type="email" inputmode="email" enterkeyhint="go" autocomplete="email" autocapitalize="none" spellcheck="false" value="${esc(A.formEmail)}" required></div>
    <button class="c-btn c-btn--primary c-btn--block" type="submit" style="margin-top:6px">Envoyer le lien</button>
  </form>
  <p style="margin-top:20px;text-align:center"><button class="link" data-go="login">Retour à la connexion</button></p></div></div>`;
};
/* Nouveau mot de passe, après un lien de récupération : la session ouverte par le lien sert uniquement à cette modification. */
V.reset=()=>{
  const A=state.account;if(!signedIn()||!A.recovery)return V.login();
  return `<div class="flow"><div class="flowtop"><button class="brand" type="button" data-go="landing" data-reset="1" aria-label="DERMAI, page d'accueil" style="font-size:1.3rem">DERMAI</button></div>
  <div class="body"><h1>Nouveau mot de passe</h1><p style="margin:10px 0 22px">Choisissez un nouveau mot de passe pour ${esc(A.email)}.</p>
  ${A.error?`<div class="c-notice u-my-5" role="alert">${ic(`info`)}<div>${A.error}</div></div>`:``}
  <form class="stack" style="gap:16px" data-form="reset" novalidate>
    <div class="c-field"><label class="c-field__label" for="f-npw">Nouveau mot de passe</label><input class="c-input" id="f-npw" name="password" type="password" enterkeyhint="next" autocomplete="new-password" required><p class="c-field__hint">8 caractères au minimum.</p></div>
    <div class="c-field"><label class="c-field__label" for="f-npw2">Confirmer le mot de passe</label><input class="c-input" id="f-npw2" name="password2" type="password" enterkeyhint="go" autocomplete="new-password" required></div>
    <button class="c-btn c-btn--primary c-btn--block" type="submit" style="margin-top:6px">Enregistrer</button>
  </form></div></div>`;
};
V.signup=()=>DEMO_MODE?demoSignup():accountOn()?authForm(`signup`):`<div class="flow"><div class="flowtop"><button class="iconbtn c-icon-btn" data-go="landing" aria-label="Retour">${ic(`back`)}</button><button class="brand" type="button" data-go="landing" data-reset="1" aria-label="DERMAI, page d'accueil" style="font-size:1.3rem">DERMAI</button></div><div class="body"><h1>Bienvenue sur DERMAI</h1><p style="margin:10px 0 26px">Trois questions pour personnaliser votre expérience, puis votre première analyse.</p><button class="c-btn c-btn--primary c-btn--block" data-go="welcome">Commencer</button></div></div>`;
V.login=()=>accountOn()?authForm(`login`):V.signup();
V.welcome=()=>`<div class="flow" style="justify-content:center;text-align:center;align-items:center"><button class="brand" type="button" data-go="landing" data-reset="1" aria-label="DERMAI, page d'accueil" style="margin-bottom:34px">DERMAI</button><h1>Bienvenue sur DERMAI${state.user.name?`, ${esc(state.user.name)}`:``}</h1><p style="margin:16px 0 34px;max-width:24em">Trois questions pour mieux vous connaître, puis votre première analyse.</p><button class="c-btn c-btn--primary" data-go="onb:1">Commencer</button></div>`;

/* Onboarding */
V.onb=n=>{
  n=Number(n)||1;
  const top=`<div class="flowtop"><button class="iconbtn c-icon-btn" data-go="${n===1?`welcome`:`onb:`+(n-1)}" aria-label="Retour">${ic(`back`)}</button><div class="dots" aria-label="Question ${n} sur 3">${[1,2,3].map(i=>`<i class="${i<=n?`on`:``}"></i>`).join(``)}</div></div>`;
  let body=``;
  if(n===1) body=`<h1>Quels sont vos objectifs ?</h1><p style="margin:10px 0 8px">Facultatif. Vous pouvez en choisir jusqu'à 3. Un objectif indique ce que vous souhaitez travailler, pas un constat sur votre peau.</p><p class="muted" role="status" aria-live="polite" style="margin:0 0 16px"><b>${goalCount()}</b></p><div class="stack" style="gap:10px">${Engine.goalList().map(g=>`<button class="opt" data-act="goal" data-v="${g.id}" aria-pressed="${state.goals.includes(g.id)}"><span class="grow"><b>${g.label}</b></span><span class="tick">${ic(`check`)}</span></button>`).join(``)}<button class="opt" data-act="goal" data-v="none" aria-pressed="${state.noGoal}"><span class="grow"><b>${Engine.copy.NO_GOAL}</b></span><span class="tick">${ic(`check`)}</span></button></div>`;
  if(n===2) body=`<h1>Quelle est votre routine actuelle ?</h1><p style="margin:10px 0 22px">Pas de mauvaise réponse.</p><div class="stack" style="gap:10px">${[[`none`,`Aucune routine`,`Je n'ai pas de soins réguliers.`],[`simple`,`Routine simple`,`Je nettoie et j'hydrate.`],[`full`,`Routine complète`,`J'utilise plusieurs soins, dont des sérums.`]].map(o=>`<button class="opt" data-act="level" data-v="${o[0]}" aria-pressed="${state.level===o[0]}"><span class="grow"><b>${o[1]}</b><span class="s">${o[2]}</span></span><span class="tick">${ic(`check`)}</span></button>`).join(``)}</div>`;
  if(n===3) body=`<h1>Quels produits utilisez-vous ?</h1><p style="margin:10px 0 22px">Choisissez les catégories que vous utilisez déjà.</p><div class="stack" style="gap:10px">${CATS.map(c=>`<button class="opt" data-act="cat" data-v="${c[0]}" aria-pressed="${state.cats.includes(c[0])}"><span class="grow"><b>${c[1]}</b></span><span class="tick">${ic(`check`)}</span></button>`).join(``)}<button class="opt" data-act="cat" data-v="none" aria-pressed="${state.cats.includes(`none`)}"><span class="grow"><b>Aucun produit pour l'instant</b></span><span class="tick">${ic(`check`)}</span></button></div>`;
  const next=n<3?`<button class="c-btn c-btn--primary c-btn--block" data-go="onb:${n+1}">Continuer</button>`:`<button class="c-btn c-btn--primary c-btn--block" data-act="finish-onb">Terminer</button>`;
  return `<div class="flow">${top}<div class="body">${body}</div><div class="stack" style="margin-top:26px">${next}${n===3?`<button class="link" data-act="finish-onb" style="justify-content:center">Passer</button>`:``}</div></div>`;
};

/* Accueil */
V.home=()=>{
  if(noReal())return emptyScan(`Votre peau aujourd'hui`,EMPTY_MSG);
  const s=SCANS[state.latest],r=viewOf(s),g=r.global,eng=engineFor(s),P=eng.priorities,steps=eng.routinePlan.slots[state.tab===`am`?`morning`:`evening`],key=state.tab;
  const doneN=steps.filter((_,i)=>state.done[key+i]).length;
  const top2=P.items.slice(0,2).map(m=>m.label.toLowerCase()),stype=skinLabel(r);
  return shell(`
  <header class="hello"><div><p class="kicker">Bonjour${state.user.name?` ${esc(state.user.name)}`:``}</p><h1>Votre peau aujourd'hui</h1></div><button class="avatar" data-go="profile" data-reset="1" aria-label="Mon profil">${initial()}</button></header>
  <div class="grid2">
   <div class="col">
    <section class="skin-now"><div class="mf">${portrait({photo:s.photo})}</div>
      <div class="txt"><p class="kicker">Profil cutané</p><p class="big" style="font-size:${stype.length>16?`1.9rem`:`2.9rem`};margin:6px 0 10px">${stype}</p>${g.score===null?`<p class="muted">Score global indisponible</p>`:`<p class="muted">Score global <b style="color:var(--ink)">${g.score}/100</b></p><p style="margin-top:6px">${bandBadge(g)}</p>`}${top2.length?`<p class="muted" style="margin-top:6px">Priorités : ${top2.join(` et `)}.</p>`:`<p class="muted" style="margin-top:6px">Routine d'entretien.</p>`}</div>
      <button class="c-btn c-btn--primary c-btn--sm" data-go="result" data-act="setview" data-v="${state.latest}">Voir mon analyse</button></section>
    <section><div class="hd"><h2 class="h3">Vos priorités</h2></div>${P.items.length?`<p class="muted" style="margin-bottom:8px">Les indicateurs à soutenir en premier, d'après votre analyse.</p><ul class="c-list">${P.items.map(m=>`<li><button class="c-list-row" data-go="concern:${m.indicator}"><span class="c-list-row__main"><span class="c-list-row__title">${m.label}</span></span>${scoreHtml(m,`s`)}${bandBadge(m)}${ic(`chev`)}</button></li>`).join(``)}</ul>`:`<div class="c-notice c-notice--success">${ic(`check`)}<div><span class="c-notice__title">${Engine.copy.MAINTENANCE.title}</span>${Engine.copy.MAINTENANCE.text}</div></div>`}</section>
    <section><div class="hd"><h2 class="h3">Explorer</h2></div>
      <button class="rowlink" data-go="actives" style="border-top:1px solid var(--line)"><div class="grow"><b>Mes actifs</b><span class="s">Ceux de votre plan, et pourquoi</span></div>${ic(`chev`)}</button>
      <button class="rowlink" data-go="products"><div class="grow"><b>${DEMO_MODE?`Exemples de produits`:`Produits pour ma routine`}</b><span class="s">${DEMO_MODE?`Exemples de démonstration`:Engine.products.usable(catalogNow()).length?`Pour chaque étape de votre routine`:`Catalogue en préparation`}</span></div>${ic(`chev`)}</button></section>
   </div>
   <div class="col">
    <section><div class="hd"><h2 class="h3">Ma routine du jour</h2><span class="muted">${doneN} sur ${steps.length}</span></div>
      <div class="c-seg" role="group" aria-label="Moment de la journée"><button class="c-seg__btn" data-act="tab" data-v="am" aria-pressed="${state.tab===`am`}">${ic(`sun`)}Matin</button><button class="c-seg__btn" data-act="tab" data-v="pm" aria-pressed="${state.tab===`pm`}">${ic(`moon`)}Soir</button></div>
      <div style="margin-top:10px">${steps.map((st,i)=>`<div class="rowlink"><span class="idx">${pad(i+1)}</span><div class="grow"><b>${stepName(st)}</b><span class="s">${stepSub(st)}</span></div><button class="c-check" data-act="tick" data-v="${key+i}" aria-pressed="${!!state.done[key+i]}" aria-label="Marquer ${stepName(st)} comme fait">${ic(`check`)}</button></div>`).join(``)}</div>
      <button class="link" data-go="routine">Voir toute la routine</button></section>
    ${trendCard()}
    <section class="next"><div style="flex:1"><b>Nouvelle analyse</b><p class="muted">Refaites un scan quand vous le souhaitez.</p></div><button class="c-btn c-btn--tonal c-btn--sm" data-go="scan">Analyser</button></section>
   </div>
  </div>`);
};

/* Scan */
const TIPS=[[`glasses`,`Retirez vos lunettes`,`Pour voir le contour des yeux.`],[`sparkle`,`Évitez les filtres`,`Votre peau doit apparaître telle qu'elle est.`],[`sun`,`Placez-vous face à une lumière naturelle`,`Près d'une fenêtre, sans contre-jour.`],[`face`,`Gardez votre visage neutre`,`Sans sourire, cheveux dégagés.`]];
const tipsHtml=()=>TIPS.map(t=>`<div class="tip"><span class="ico">${ic(t[0])}</span><div><b>${t[1]}</b><p class="muted">${t[2]}</p></div></div>`).join(``);
const SHOT=[[`De face`,0],[`Profil gauche`,-7],[`Profil droit`,7]];
V.scan=()=>{
  const st=state.scanStep;
  const head=`<div class="flowtop" style="margin-bottom:10px"><button class="iconbtn c-icon-btn" data-act="scan-back" aria-label="Retour">${ic(`back`)}</button><b>${st===0?`Nouvelle analyse`:st===4?(DEMO_MODE?`Vos trois photos`:`Votre photo`):(DEMO_MODE?`Photo ${st} sur 3`:`Photo de face`)}</b></div>`;
  if(st===0) return `<div class="scan">${head}<div class="scan-grid" style="max-width:560px;margin:0 auto"><div><h1>Avant de commencer</h1><p style="margin:10px 0 8px">${DEMO_MODE?`Trois photos suffisent pour voir toutes les zones de votre visage, joues et côtés compris.`:`Une photo de face, bien éclairée, suffit pour analyser votre peau.`}</p>${tipsHtml()}<button class="c-btn c-btn--primary c-btn--block" data-act="scan-start" style="margin-top:26px">${DEMO_MODE?`Commencer le scan`:`Commencer`}</button><p class="muted" style="margin-top:14px;text-align:center">${DEMO_MODE?`Vos photos servent à analyser votre peau.`:`Votre photo est envoyée à notre service d'analyse pour obtenir vos résultats. DERMAI ne la conserve pas.`}</p>${DEMO_MODE?`<p style="text-align:center;margin-top:10px">${demoTag()}</p>`:``}</div></div></div>`;
  if(st===4) return `<div class="scan">${head}<div style="max-width:560px;margin:0 auto">${DEMO_MODE?`<div class="thumbs">${SHOT.map((s,i)=>`<div class="thumb"><div class="tf">${portrait({shift:s[1]})}</div><small>${s[0]}</small><button class="link" data-act="retake" data-v="${i}" style="min-height:36px;font-size:14px">Refaire</button></div>`).join(``)}</div>`:`<div class="c-preview">${portrait({})}<button class="c-btn c-btn--ghost c-btn--block" data-act="retake" data-v="0">Choisir une autre photo</button></div>`}
   ${DEMO_MODE?`<div class="c-notice c-notice--success u-my-5">${ic(`check`)}<div><span class="c-notice__title">Qualité de l'image : excellente</span>Lumière et cadrage corrects sur les trois photos.</div></div>`:state.scanError?`<div class="c-notice c-notice--error u-my-5" role="alert">${ic(`info`)}<div><span class="c-notice__title">${state.scanQuota?`Analyses momentanément indisponibles`:`Analyse impossible`}</span>${esc(state.scanError)}</div></div>`:`<div class="c-notice u-my-5">${ic(`check`)}<div><span class="c-notice__title">Photo prête</span>Le cadrage et la lumière sont vérifiés pendant l'analyse.</div></div>`}
   ${state.scanQuota?`<button class="c-btn c-btn--primary c-btn--block" data-go="home" data-reset="1">Retour à l'accueil</button>`:`<button class="c-btn c-btn--primary c-btn--block" data-go="analyzing">${state.scanError?`Réessayer`:`Analyser ma peau`}</button>`}</div></div>`;
  const s=SHOT[st-1];
  return `<div class="scan">${head}<div class="scan-grid"><div><div class="segs">${(DEMO_MODE?[1,2,3]:[1]).map(i=>`<i class="${i<=st?`on`:``}"></i>`).join(``)}</div>
   <h2 class="cam-h">${st===1?`Positionnez votre visage<br>au centre`:st===2?`Tournez doucement<br>la tête vers la droite`:`Tournez doucement<br>la tête vers la gauche`}</h2>
   <div class="cam" id="cam"><div class="feed">${portrait({shift:s[1]})}</div><div class="frame"></div>${DEMO_MODE?`<div class="scanline"></div>`:``}<div class="label"><span>${s[0]}</span></div>${DEMO_MODE?`<div class="qual"><span class="qd"><i></i><i></i><i></i></span><span id="qt">Vérification de la lumière…</span></div>`:``}<div class="flash" id="flash"></div></div>
   <p class="muted" style="text-align:center;margin:12px 0 18px">${DEMO_MODE?`Caméra simulée, photo de démonstration.`:`Prenez une photo de face ou choisissez-en une dans votre galerie.`}</p>
   ${DEMO_MODE?`<button class="shutter" data-act="shutter" aria-label="Prendre la photo"><i></i></button>`:`<button class="c-btn c-btn--primary c-btn--block" data-act="shutter">Ajouter une photo</button>`}</div>
   <aside class="scan-side"><h2>Pour une bonne analyse</h2><div style="margin-top:14px">${tipsHtml()}</div></aside></div></div>`;
};
const AN_STEPS=[`Hydratation`,`Texture`,`Pores`,`Pigmentation`,`Acné`];
const AN_ZONES=[[`front`],[`jg`,`jd`],[`nez`],[`yg`,`yd`],[`menton`]];
const AN_NAMES=[`Front`,`Joues`,`Nez`,`Contour des yeux`,`Menton`];
V.analyzing=()=>`<div class="an"><p class="pill-up">Analyse en cours</p><div class="an-portrait">${portrait({})}<div class="scanline"></div></div><p class="zonecap" id="zc" aria-live="polite">&nbsp;</p>${DEMO_MODE?``:`<p class="muted" style="margin-top:14px;text-align:center">Cela peut prendre un moment. Gardez cette page ouverte.</p>`}
  <ul class="an-steps" aria-live="polite"${DEMO_MODE?``:` style="visibility:hidden"`}>${AN_STEPS.map(t=>`<li><span class="dot">${ic(`check`)}</span>${t}</li>`).join(``)}</ul>
  ${DEMO_MODE?`<p style="margin-top:26px">${demoTag()}</p>`:``}</div>`;

/* Résultat */
/* Écran Résultat : lit uniquement SkinModel.toResultView(normalized) (échelle 0-100, 100 = meilleur). Aucun repli, aucune zone du visage. */
/* Les fréquences sont une suggestion de départ DERMAI (introduction progressive, selon la tolérance), jamais une recommandation du fournisseur d'analyse. */
const startHint=i=>`Suggestion de départ : ${i.frequency?i.frequency.charAt(0).toLowerCase()+i.frequency.slice(1):`selon votre tolérance`}.${i.note?` ${i.note}`:``} À adapter selon la tolérance de votre peau.`;
const SCORE_SENTENCE={good:`Votre analyse indique un état apparent plutôt favorable.`,mid:`Votre analyse indique quelques repères à soutenir.`,low:`Votre analyse indique plusieurs repères plus faibles.`};
/* Indicateurs informatifs (contour des yeux) : jamais de bande d'alerte ni d'incitation à l'action, un libellé neutre à la place. */
const infoBadge=()=>`<span class="c-badge c-badge--outline">${Engine.copy.INFO_LABEL}</span>`;
const isInfo=m=>m.actionability===`informative`;
const IND_TXT={good:`Ce repère est dans une bonne zone.`,mid:`Ce repère est plus faible : il peut être soutenu.`,low:`Ce repère est nettement plus faible : il peut être soutenu en priorité.`};
/* Objectifs : affichage commun (résultat, profil). Les libellés viennent du moteur, jamais les identifiants techniques. */
const goalCount=()=>`${state.goals.length}/3 objectifs sélectionnés`;
const goalBadges=()=>state.goals.length?`<div class="chips" style="margin-bottom:10px">${state.goals.map(id=>`<span class="c-badge">${Engine.copy.GOAL_LABELS[id]}</span>`).join(``)}</div>`:``;
/* Exclusions : architecture prête (état, moteur, recalcul), volontairement sans interface pour l'instant. Aucune information de santé n'est demandée. */
const exclusionsSection=()=>``;
V.result=()=>{
  if(noReal())return emptyScan(`Votre analyse`,EMPTY_MSG,{back:true,title:`Analyse`});
  const s=SCANS[state.view],r=viewOf(s),g=r.global,eng=engineFor(s),P=eng.priorities;
  /* Analyse plus ancienne : on montre ce qui avait été relevé à cette date (priorités et objectifs enregistrés), jamais recalculé avec les règles ou le profil d'aujourd'hui. */
  const H=!!s.rec&&s.id!==state.latest,noPhoto=!DEMO_MODE&&!s.photo;
  const stored=m=>Object.assign({},m,{bandLabel:(SkinModel.BANDS.find(b=>b.key===m.band)||{}).label});
  const hero=`<div class="c-card c-card--result c-result"><div class="c-result__hero">${noPhoto?``:`<div class="c-result__photo">${portrait({photo:s.photo})}</div>`}
      <div class="c-score-block"><span class="c-result__kicker">Score global</span>${g.score===null?`<p class="c-result__na">Score global indisponible</p>`:`${scoreHtml(g,`xl`)}${bandBadge(g)}`}</div></div>
      ${g.score===null?``:`<p class="c-result__sentence">${SCORE_SENTENCE[g.band]}</p>`}</div>`;
  const type=`<div class="c-card"><p class="c-disclaimer">Type de peau</p>${r.skinType?`<h2 class="c-card__title">${r.skinType.label}</h2><p class="c-card__text">${r.skinType.description}</p>`:`<p class="c-card__text">Type de peau indisponible.</p>`}
      ${r.skinAge===null?``:`<div class="c-result__age"><b>Âge cutané estimé : ${r.skinAge} ans</b><p class="c-disclaimer">Estimation cosmétique, ce n'est pas un âge biologique.</p></div>`}</div>`;
  const prio=H?s.rec.priorities.map(stored).map(m=>`<div class="c-concern-card c-concern-card--static"><div class="c-concern-card__head"><h3 class="c-concern-card__name">${m.label}</h3>${scoreHtml(m,`m`)}</div>${barHtml(m)}<div class="c-concern-card__foot">${bandBadge(m)}</div></div>`).join(``):P.items.map(m=>`<div class="c-concern-card c-concern-card--static"><div class="c-concern-card__head"><h3 class="c-concern-card__name">${m.label}</h3>${scoreHtml(m,`m`)}</div>${barHtml(m)}
      <div class="c-concern-card__foot">${bandBadge(m)}${m.objectiveMatch?`<span class="c-badge c-badge--outline">Votre objectif</span>`:``}</div><p class="c-card__text"><b>Pourquoi cette priorité ?</b> ${m.reason}</p><button class="link" data-go="concern:${m.indicator}">Voir le détail</button></div>`).join(``);
  const othersH=[...r.priorities,...r.others].sort((a,b)=>a.order-b.order).filter(m=>!s.rec||!H||!s.rec.priorities.some(p=>p.id===m.key)).map(m=>m.score===null
    ?`<li class="c-indicator c-indicator--na"><span class="c-indicator__name">${m.label}</span><span class="c-indicator__value">${bandBadge(m)}</span></li>`
    :`<li class="c-indicator"><span class="c-indicator__name">${m.label}</span><span class="c-indicator__value"><span class="c-indicator__score">${m.score}<small>/100</small></span>${bandBadge(m)}</span>${barHtml(m)}</li>`).join(``);
  const others=H?othersH:eng.interpretation.indicators.filter(i=>!P.items.some(p=>p.indicator===i.id)).map(m=>m.score===null
    ?`<li class="c-indicator c-indicator--na"><span class="c-indicator__name">${m.label}</span><span class="c-indicator__value">${bandBadge(m)}</span></li>`
    :isInfo(m)?`<li class="c-indicator"><span class="c-indicator__name">${m.label}</span><span class="c-indicator__value"><span class="c-indicator__score">${m.score}<small>/100</small></span>${infoBadge()}</span><span class="c-bar" role="img" aria-label="${m.score} sur 100" style="--value:${m.score}"><span class="c-bar__fill"></span></span></li>`
    :`<li class="c-indicator"><span class="c-indicator__name">${m.label}</span><span class="c-indicator__value"><span class="c-indicator__score">${m.score}<small>/100</small></span>${bandBadge(m)}</span>${barHtml(m)}</li>`).join(``);
  const sv=state.analysisSave,svBox=!DEMO_MODE&&sv.scan===s&&sv.status!==`idle`?`<div class="c-notice${sv.status===`saved`?` c-notice--success`:``}" role="status" aria-live="polite">${ic(sv.status===`saved`?`check`:`info`)}<div>${sv.message}${sv.status===`error`?` <button class="link" data-act="retry-analysis">Réessayer</button>`:``}</div></div>`:``;
  return shell(`
  <div class="pagehead"><p class="kicker">Analyse du ${dateLabel(s)}${H?` · analyse précédente`:``}</p><h1>${H?`Votre analyse du ${dateLabel(s)}`:`Votre analyse`}</h1><p>Une analyse cosmétique de l'état apparent de votre peau.</p></div>
  ${svBox?`<div style="margin-bottom:18px">${svBox}</div>`:``}
  <div class="grid2 lw">
   <div class="col sticky-d">${hero}${type}</div>
   <div class="col">
    <section><p class="kicker">Ce que DERMAI observe</p><div class="hd"><h2 class="h3">${H?`Repères à soutenir à cette date`:`Vos priorités`}</h2></div>${(H?s.rec.priorities.length:P.items.length)
      ?`<p class="muted" style="margin-bottom:14px">${H?`Ce que DERMAI avait relevé à cette date. Ces repères ne sont pas recalculés avec vos préférences ou les règles d'aujourd'hui.`:`Vos principaux repères à soutenir, d'après votre analyse.`} 100 correspond au meilleur état. Le score global est une information séparée : il ne détermine pas ces priorités.</p><div class="stack" style="gap:12px">${prio}</div>`
      :`<div class="c-notice c-notice--success">${ic(`check`)}<div><span class="c-notice__title">${Engine.copy.MAINTENANCE.title}</span>${Engine.copy.MAINTENANCE.text}</div></div>`}
    ${!H&&P.eyeInfo?`<div class="c-notice u-my-5">${ic(`info`)}<div>${P.eyeInfo}</div></div>`:``}</section>
    <section id="indicateurs"><div class="hd"><h2 class="h3">Autres indicateurs</h2></div><ul class="c-indicators">${others}</ul></section>
    ${H?`<section><p class="kicker">Ce que vous souhaitiez travailler</p><div class="hd"><h2 class="h3">Vos objectifs à cette date</h2></div>
      ${s.rec.goals.length?`<div class="chips" style="margin-bottom:10px">${s.rec.goals.map(id=>`<span class="c-badge">${Engine.copy.GOAL_LABELS[id]}</span>`).join(``)}</div>`:`<p class="muted" style="margin-bottom:10px">Aucun objectif choisi à cette date.</p>`}</section>
    <section><p class="kicker">Ce que DERMAI recommande</p><div class="hd"><h2 class="h3">Votre routine actuelle</h2></div>
      <p class="muted" style="margin-bottom:14px">La routine affichée dans l'application correspond à votre analyse la plus récente.</p>
      <button class="c-btn c-btn--primary c-btn--block" data-go="routine">Voir ma routine actuelle</button></section>`:`    <section><p class="kicker">Ce que vous souhaitez travailler</p><div class="hd"><h2 class="h3">Vos objectifs</h2></div>
      ${eng.personalization.goals.length?`${goalBadges()}<p class="muted" style="margin-bottom:10px">${goalCount()}. Un objectif indique ce que vous souhaitez travailler, pas un constat sur votre peau.</p><ul class="l-list" style="margin-top:0">${eng.personalization.goals.map(g=>`<li>${ic(`check`)}<span><b>${g.label}</b> : ${g.text}</span></li>`).join(``)}</ul>`
        :`<p class="muted" style="margin-bottom:10px">Aucun objectif choisi. Les objectifs sont facultatifs.</p>`}
      <button class="link" data-go="profile">${eng.personalization.goals.length?`Modifier mes objectifs`:`Choisir mes objectifs`}</button></section>
    <section><p class="kicker">Ce que DERMAI recommande</p><div class="hd"><h2 class="h3">Votre routine personnalisée</h2></div>
      <p style="color:var(--ink);margin-bottom:14px">${eng.personalization.headline}</p>
      <button class="c-btn c-btn--primary c-btn--block" data-go="routine">Voir ma routine personnalisée</button></section>`}
    <div class="stack"><button class="c-btn c-btn--secondary c-btn--block" data-go="scan">Faire une nouvelle analyse</button><button class="c-btn c-btn--ghost c-btn--block" data-go="analyses">Mes analyses</button></div>
    <p class="c-disclaimer">Analyse cosmétique de l'état apparent de la peau, ce n'est pas un diagnostic médical. Les résultats peuvent varier selon la lumière et la prise de vue.</p>
   </div>
  </div>`,{back:true,title:`Analyse`});
};

/* Préoccupation */
V.concern=id=>{
  id=SkinModel.METRIC_KEYS.includes(id)?id:`pigmentation`;
  const label=SkinModel.METRIC_LABELS[id],c=CONCERNS[id];   // c : conseils statiques, seulement pour 4 indicateurs
  if(noReal())return emptyScan(label,EMPTY_MSG,{back:true,title:label});
  const s=SCANS[state.view],r=viewOf(s),all=[...r.priorities,...r.others].sort((a,b)=>a.order-b.order),m=all.find(x=>x.key===id),info=(eng=>{const i=eng.interpretation.indicators.find(x=>x.id===id);return !!i&&isInfo(i)})(engineFor(s));
  const nav=`<div class="chips" style="margin-bottom:22px">${all.filter(x=>x.score!==null).map(x=>`<button class="c-chip" data-go="concern:${x.key}" aria-pressed="${x.key===id}">${x.label}</button>`).join(``)}</div>`;
  if(m.score===null)return shell(`${nav}<div class="pagehead"><h1>${label}</h1><p>Donnée indisponible pour cette analyse.</p></div>`,{back:true,title:label});
  const levers=Engine.actives.leversFor(id);
  return shell(`
  ${nav}
  <div class="grid2">
   <div class="col">
    <section><h1>${label}</h1><div class="c-score-block" style="margin:16px 0 12px">${info?`<span class="c-score c-score--xl"><span class="c-score__value">${m.score}</span><span class="c-score__unit">/100</span></span>${infoBadge()}`:`${scoreHtml(m,`xl`)}${bandBadge(m)}`}</div>${info?`<span class="c-bar" role="img" aria-label="${m.score} sur 100" style="--value:${m.score}"><span class="c-bar__fill"></span></span>`:barHtml(m)}<p style="margin-top:18px;font-size:18px;color:var(--ink)">${info?Engine.copy.INFO_TEXT:IND_TXT[m.band]}</p></section>
    <section class="facebox">${portrait({photo:s.photo})}</section>
   </div>
   <div class="col">
    ${levers.length?`<section><div class="hd"><h2 class="h3">Ce qui peut aider</h2></div><p class="muted" style="margin-bottom:14px">Actifs cosmétiques souvent utilisés pour cet indicateur. Ceux de votre plan sont dans « Ma routine ».</p><div class="stack" style="gap:12px">${levers.map((a,i)=>activeCard(a.id,i)).join(``)}</div></section>`
      :`<div class="c-notice">${ic(`info`)}<div>${Engine.copy.EYE_NOTE}</div></div>`}
    ${c?`<section><div class="hd"><h2 class="h3">Au quotidien</h2></div><ul class="l-list" style="margin-top:0">${c.tips.map(x=>`<li>${ic(`check`)}<span>${x}</span></li>`).join(``)}</ul></section>`:``}
    ${disc()}${info?`<button class="c-btn c-btn--primary c-btn--block" data-go="result">Voir mon analyse</button>`:`<button class="c-btn c-btn--primary c-btn--block" data-go="routine">Voir ma routine</button>`}
   </div>
  </div>`,{back:true,title:label});
};

/* Actifs : ceux du plan (moteur), avec la raison de chaque choix, et ceux mis de côté. */
V.actives=()=>{
  if(noReal())return emptyScan(`Mes actifs`,[`Aucun actif pour le moment`,`Vos recommandations apparaîtront après votre analyse.`],{back:true,title:`Actifs`});
  const eng=engineFor(SCANS[state.latest]),ap=eng.activePlan,chosen=[...ap.treatments,...ap.supports],others=eng.personalization.otherActives;
  const side=`<section><div class="hd"><h2 class="h3">Autres actifs</h2></div><p class="muted" style="margin-bottom:10px">Consultables, mais non retenus automatiquement.</p>${others.length?`<div class="stack" style="gap:10px">${others.map(d=>`<div class="c-card"><b>${d.label}</b><p class="c-card__text">${d.text}</p><button class="link" data-go="active:${d.activeId}">Découvrir cet actif</button></div>`).join(``)}</div>`:`<p class="muted">Aucun autre actif à signaler pour l'instant.</p>`}</section>`;
  return shell(`<div class="pagehead"><h1>Mes actifs</h1><p>Les actifs retenus d'après votre analyse, vos objectifs et votre niveau de routine. Ce sont des options cosmétiques, pas des soins médicaux.</p></div>
  <div class="grid2"><section><div class="hd"><h2 class="h3">Vos actifs recommandés</h2></div>${chosen.length?`<div class="stack" style="gap:12px">${chosen.map((a,i)=>activeCard(a.activeId,i,whyOf(eng,a.activeId))).join(``)}</div>`
    :`<div class="c-notice">${ic(`info`)}<div>Votre analyse ne fait pas ressortir de soin ciblé à ajouter pour l'instant.</div></div>`}</section>
  <div class="col">${side}${disc()}<button class="c-btn c-btn--primary c-btn--block" data-go="routine">Voir ma routine personnalisée</button></div></div>`,{back:true,title:`Actifs`});
};
const WHEN_FR={morning:`Matin`,evening:`Soir`,both:`Matin et soir`};
V.active=id=>{
  const A=Engine.actives;
  let a=A.byId(id);if(!a||!(A.isValidated(a)||a.consultable))a=A.validated()[0];
  return shell(`<div class="grid2 lw"><div class="col sticky-d"><div class="sand"><p class="kicker">${a.summary}</p><h1 style="margin:10px 0 12px">${a.label}</h1><p>${a.description}</p></div>${disc()}</div>
  <div class="col"><div class="kv">
   <div><h4>Indicateurs ciblés</h4><div class="chips" style="margin-top:8px">${a.targets.map(t=>`<span class="c-badge">${SkinModel.METRIC_LABELS[t]}</span>`).join(``)}</div></div>
   <div><h4>Moment d'utilisation</h4><p>${WHEN_FR[a.when]}</p></div>
   <div><h4>Introduction progressive</h4><p>${startHint(a.introduction)}</p></div>
   <div><h4>Précautions générales</h4><ul>${a.cautions.map(x=>`<li>${x}</li>`).join(``)}</ul></div>
  </div><button class="c-btn c-btn--primary c-btn--block" data-go="products">${DEMO_MODE?`Voir des exemples de produits`:`Voir les produits de ma routine`}</button></div></div>`,{back:true,title:a.label});
};

/* Routine : générée par le moteur (priorités, actifs, type de peau, niveau de routine). */
V.routine=()=>{
  if(noReal())return emptyScan(`Ma routine`,[`Aucune routine pour le moment`,`Faites votre première analyse pour obtenir une routine personnalisée.`],{back:true,title:`Routine`});
  const eng=engineFor(SCANS[state.latest]),R=eng.routinePlan,PZ=eng.personalization,pm=Object.fromEntries(eng.productMatches.map(m=>[m.stepId,m]));
  const sel=Object.fromEntries(PZ.selectedActives.map(x=>[x.activeId,x]));
  const whyBlock=st=>{const x=sel[st.activeId];if(!x)return ``;return `<details class="c-why"><summary>Pourquoi cet actif ?</summary><p>${x.why}</p><p>${x.whyNow}</p>${x.whyNot.map(n=>`<p>${n.text}</p>`).join(``)}</details>`};
  const list=(slot,key,icon,label)=>`<section><div class="hd"><h2 class="h3" style="display:flex;gap:10px;align-items:center">${ic(icon)}${label}</h2></div><div class="stack" style="gap:12px">${R.slots[slot].map((st,i)=>{
    const m=pm[st.id],p=m&&Engine.products.byId(m.productId,catalogNow());
    return `<div class="c-routine-step"><span class="c-routine-step__ord">${pad(i+1)}</span><div class="c-routine-step__body"><div class="c-routine-step__meta">${Engine.copy.STEP_LABELS[st.kind]}</div><div class="c-routine-step__name">${stepName(st)}</div><p class="c-routine-step__role">${st.reason}</p>
      ${st.kind===`treatment`?`<p class="c-routine-step__role">${startHint(st.introduction)}${st.slowDown?` ${Engine.copy.SLOW}`:``}</p>${whyBlock(st)}<button class="link" data-go="active:${st.activeId}">Découvrir cet actif</button>`:``}
      ${p?`<button class="link" data-act="product" data-v="${p.id}">${p.demo?`Exemple (démonstration) : `:`Produit proposé : `}${esc(p.name)}</button>`:``}</div>
      <button class="c-check" data-act="tick" data-v="${key+i}" aria-pressed="${!!state.done[key+i]}" aria-label="Marquer ${stepName(st)} comme fait">${ic(`check`)}</button></div>`}).join(``)}</div></section>`;
  const cautions=[...new Set(R.slots.morning.concat(R.slots.evening).filter(s=>s.kind===`treatment`).flatMap(s=>s.cautions))];
  return shell(`<div class="pagehead"><h1>Ma routine</h1><p>${R.summary}</p></div>
  <section class="sand" style="margin-bottom:28px"><h2 class="h3" style="margin-bottom:10px">Pourquoi cette routine ?</h2>
    <ul class="l-list" style="margin-top:0">${PZ.rationale.slice(0,3).map(r=>`<li>${ic(`check`)}<span>${r.text}</span></li>`).join(``)}</ul>
    ${PZ.approachNote?`<p class="muted" style="margin-top:10px">${PZ.approachNote}</p>`:``}${PZ.evolution.note?`<p class="muted" style="margin-top:10px">${PZ.evolution.note}</p>`:``}</section>
  <div class="grid2">${list(`morning`,`am`,`sun`,`Matin`)}${list(`evening`,`pm`,`moon`,`Soir`)}</div>
  <div class="grid2" style="margin-top:36px"><section class="sand"><h2 class="h3" style="margin-bottom:10px">À retenir</h2>
    <ul class="l-list" style="margin-top:0">${R.notes.map(n=>`<li>${ic(`check`)}<span>${n}</span></li>`).join(``)}${cautions.map(c=>`<li>${ic(`info`)}<span>${c}</span></li>`).join(``)}${DEMO_MODE&&eng.productMatches.length?`<li>${ic(`info`)}<span>${Engine.copy.NOTES.demoProducts}</span></li>`:``}</ul></section>
  <div class="col"><button class="rowlink" data-go="actives" style="border-top:1px solid var(--line)"><div class="grow"><b>Mes actifs</b><span class="s">Comprendre chaque choix</span></div>${ic(`chev`)}</button><button class="rowlink" data-go="profile"><div class="grow"><b>Modifier mes objectifs et mon niveau</b><span class="s">La routine se recalcule aussitôt</span></div>${ic(`chev`)}</button>${disc()}${!DEMO_MODE&&!Engine.products.usable(catalogNow()).length?`<p class="muted" style="margin-bottom:10px">Le catalogue de produits est en préparation : votre routine indique déjà les actifs à chercher.</p>`:``}<button class="c-btn c-btn--primary c-btn--block" data-go="products">${DEMO_MODE?`Voir des exemples de produits`:`Voir les produits de ma routine`}</button></div></div>`);
};

/* Produits : conséquence de la routine (jamais l'inverse). « Recommandés pour votre routine » = produits choisis par le moteur pour chaque étape ;
   « Autres produits » = le reste du catalogue, avec la raison réelle du moteur. Aucun score, aucun pourcentage. Données commerciales (prix, vendeur,
   lien) affichées seulement si elles existent et sont sourcées ; sinon « Données à venir ». Catalogue réel vide : état clair, aucun produit fictif. */
const SKIN_FR={all:`tous types de peau`,normal:`peau normale`,oily:`peau grasse`,dry:`peau sèche`,combination:`peau mixte`};
const CAT_FILTERS=[[`all`,`Tous`],[`cleanser`,`Nettoyants`],[`serum`,`Soins ciblés`],[`moisturizer`,`Hydratants`],[`spf`,`Protection solaire`]];
const fmtPrice=pr=>pr.currency===`XOF`?fmt(pr.amount):`${pr.amount.toLocaleString(`fr-FR`)}${NB}€`;
const priceLine=p=>{const c=Engine.products.commerceOf(p);return c.price?fmtPrice(c.price):`<span class="muted">Prix à venir</span>`};
const availBadge=c=>`<span class="c-badge${c.availability===`available`?` c-badge--good`:` c-badge--outline`}">${c.availabilityLabel}</span>`;
const mainActiveLabel=p=>{const id=Engine.products.primaryActive(p),a=id&&Engine.actives.byId(id);return a?a.label:null};
/* Image : produit de démonstration = illustration de flacon ; produit réel = sa photo si elle existe, sinon un cadre neutre « Image à venir » (jamais une fausse photo). */
const productMedia=p=>p.demo?bottle(p.type,p.color):(p.image&&p.image.src?`<img src="${esc(p.image.src)}" alt="${esc(p.image.alt)}" loading="lazy">`:`<div class="pimg-ph" role="img" aria-label="Image du produit à venir">${ic(`image`)}<span>Image à venir</span></div>`);
const slotsOf=steps=>[...new Set(steps.map(s=>s.stepId.startsWith(`morning`)?`Matin`:`Soir`))].join(` et `);
function productCard(p,o={}){
  const c=Engine.products.commerceOf(p),act=mainActiveLabel(p);
  return `<button class="pcard" data-act="product" data-v="${p.id}"><div class="pimg">${o.inPlan?`<span class="badge">Dans ma routine</span>`:``}${p.demo?`<span class="badge demo-b">Démo</span>`:``}${productMedia(p)}</div>
   <div class="pb"><div class="br">${esc(p.brand)}</div><div class="nm">${esc(p.name)}</div>
   <div class="role muted">${o.slots?`${o.slots} · `:``}${Engine.copy.PRODUCT_CATEGORY_LABELS[p.category]}${act?` · ${act}`:``}</div>
   <div class="pr">${availBadge(c)}<span>${priceLine(p)}</span></div>${o.reason?`<p class="why muted">${o.reason}</p>`:``}</div></button>`;
}
V.products=()=>{
  const f=state.filter,list=Engine.products.usable(catalogNow()),inF=p=>f===`all`||p.category===f;
  const head=`<div class="pagehead"><h1>${DEMO_MODE?`Exemples de produits`:`Produits pour ma routine`}</h1><p>${DEMO_MODE?`Un catalogue de démonstration, qui n'est pas personnalisé. Ceux de votre routine sont repérés.`:`DERMAI choisit d'abord les actifs de votre routine, puis les produits qui les contiennent.`}</p></div>`;
  if(!DEMO_MODE&&!list.length)return shell(`${head}<div class="c-card c-card--empty"><div class="c-empty">${ic(`layers`)}<h2 class="c-empty__title">Les produits arrivent bientôt</h2><p class="c-empty__text">DERMAI prépare son catalogue de produits. En attendant, votre routine indique déjà les types de soins et les actifs à chercher.</p><button class="c-btn c-btn--primary c-btn--block" data-go="${noReal()?`scan`:`routine`}">${noReal()?`Analyser ma peau`:`Voir ma routine`}</button></div></div><div style="margin-top:24px;max-width:520px">${disc()}</div>`,{back:true,title:`Produits`});
  const chips=`<div class="chips" style="margin-bottom:24px">${CAT_FILTERS.map(([v,name])=>`<button class="c-chip" data-act="filter" data-v="${v}" aria-pressed="${f===v}">${name}</button>`).join(``)}</div>`;
  const note=DEMO_MODE?`<div class="note" style="padding-top:0">${ic(`info`)}<span>Produits fictifs de démonstration. Le catalogue réel (Bénin et Afrique francophone) sera branché plus tard.</span></div>`:``;
  const foot=`<div style="margin-top:32px;max-width:520px">${disc()}<button class="c-btn c-btn--primary c-btn--block" data-go="progress">Suivre ma progression</button></div>`;
  if(noReal()){
    return shell(`${head}${note}<div class="c-notice u-my-5">${ic(`info`)}<div>Faites votre première analyse pour voir quels produits correspondent à votre routine.</div></div>${chips}<div class="pgrid">${list.filter(inF).map(p=>productCard(p)).join(``)}</div>${foot}`,{back:true,title:`Produits`});
  }
  const eng=engineFor(SCANS[state.latest]),view=Engine.products.catalogView(eng.routinePlan,eng.productMatches,catalogNow());
  const rec=view.recommended.map(r=>({p:Engine.products.byId(r.productId,catalogNow()),r})).filter(x=>inF(x.p));
  const oth=view.others.map(o=>({p:Engine.products.byId(o.productId,catalogNow()),o})).filter(x=>inF(x.p));
  return shell(`${head}${note}${chips}
   <section><div class="hd"><h2 class="h3">Recommandés pour votre routine</h2></div>${rec.length?`<div class="pgrid">${rec.map(x=>productCard(x.p,{inPlan:true,slots:slotsOf(x.r.steps)})).join(``)}</div>`:`<p class="muted">${view.recommended.length?`Aucun produit recommandé dans cette catégorie.`:`Aucun produit du catalogue ne correspond encore aux étapes de votre routine.`}</p>`}</section>
   ${oth.length?`<section style="margin-top:34px"><div class="hd"><h2 class="h3">Autres produits</h2></div><div class="pgrid">${oth.map(x=>productCard(x.p,{reason:x.o.text})).join(``)}</div></section>`:``}${foot}`,{back:true,title:`Produits`});
};
function productSheet(id){
  const p=Engine.products.byId(id,catalogNow());if(!p)return `<p class="muted">Ce produit n'est plus disponible dans le catalogue.</p><button class="link" data-act="close">Fermer</button>`;
  const A=Engine.actives,c=Engine.products.commerceOf(p);
  let why=`Produit de démonstration, non lié à votre analyse.`;
  if(!noReal()){
    const eng=engineFor(SCANS[state.latest]),view=Engine.products.catalogView(eng.routinePlan,eng.productMatches,catalogNow());
    const rec=view.recommended.find(r=>r.productId===id),oth=view.others.find(o=>o.productId===id);
    if(rec)why=`${slotsOf(rec.steps)} : ${rec.steps.map(s=>s.why).filter((w,i,a)=>a.indexOf(w)===i).join(` `)}`;
    else if(oth)why=`Non retenu pour votre routine actuelle. ${oth.text}`;
  }else if(!DEMO_MODE)why=`Faites votre première analyse pour savoir si ce produit correspond à votre routine.`;
  const act=mainActiveLabel(p),secondary=Engine.products.ids(p).filter(i=>i!==Engine.products.primaryActive(p));
  return `<div class="pimg" style="aspect-ratio:1.5/1;margin-bottom:18px">${productMedia(p)}</div>
  <p class="muted">${esc(p.brand)}${p.demo?`, produit de démonstration`:``}</p><h2 style="font-size:1.9rem;margin:4px 0 10px">${esc(p.name)}</h2>
  <p style="color:var(--ink);display:flex;gap:10px;align-items:center;flex-wrap:wrap">${availBadge(c)}<span>${priceLine(p)}</span></p>
  ${c.price?`<p class="muted" style="font-size:13px">Prix relevé le ${new Date(c.price.checkedAt).toLocaleDateString(`fr-FR`,{day:`numeric`,month:`long`,year:`numeric`})} (${esc(c.price.source)}).</p>`:``}
  <div class="c-card" style="margin:18px 0"><b>Pourquoi ce produit ?</b><p class="muted" style="margin-top:6px">${why}</p>${p.description?`<p class="muted" style="margin-top:8px">${esc(p.description)}</p>`:``}<p class="muted" style="margin-top:8px">${Engine.copy.PRODUCT_CATEGORY_LABELS[p.category]}. Convient à : ${p.skinTypes.map(t=>SKIN_FR[t]).join(`, `)}.</p></div>
  <div class="kv" style="margin-bottom:18px">${act?`<div><h4>Actif principal</h4><p>${act}</p></div>`:``}${secondary.length?`<div><h4>Autres actifs</h4><p>${secondary.map(i=>A.byId(i).label).join(`, `)}</p></div>`:``}<div><h4>Composition</h4><div class="chips" style="margin-top:6px">${p.ingredients.map(i=>`<span class="c-badge">${esc(i.label)}</span>`).join(``)}</div></div><div><h4>Vendeur</h4><p class="muted">${c.vendor?esc(c.vendor):`Données à venir.`}</p></div></div>
  <div class="stack">${c.buyable?`<a class="c-btn c-btn--primary c-btn--block" href="${esc(c.url)}" target="_blank" rel="noopener noreferrer">Voir où l'acheter</a>`:``}<button class="link" data-act="close" style="justify-content:center">Fermer</button></div>`;
}

/* Progression */
const cmpRow=(m,label)=>m.available
  ?`<li class="c-indicator"><span class="c-indicator__name">${label}</span><span class="c-indicator__value"><span class="c-indicator__score">${m.before} → ${m.after}<small>/100</small></span><span class="c-delta c-delta--${m.trend===`up`?`up`:m.trend===`down`?`down`:`flat`}">${m.trendLabel}${m.delta>0?` +${m.delta}`:m.delta<0?` −${-m.delta}`:``}</span></span></li>`
  :`<li class="c-indicator c-indicator--na"><span class="c-indicator__name">${label}</span><span class="c-indicator__value"><span class="c-badge c-badge--outline">Donnée indisponible</span></span></li>`;
V.progress=()=>{
  if(noReal())return emptyScan(`Votre évolution`,[`Aucune analyse pour le moment`,`Faites votre première analyse : vous pourrez ensuite suivre votre évolution.`]);
  if(!DEMO_MODE&&SCANS.length<2)return emptyScan(`Votre évolution`,SCANS[0].saved||state.account.status===`off`?[`Votre première analyse est enregistrée.`,`Faites une nouvelle analyse plus tard pour suivre votre évolution.`]:[`Votre première analyse n'est pas enregistrée.`,`Connectez-vous avant votre prochaine analyse : vous pourrez ensuite suivre votre évolution.`]);
  const lastIdx=SCANS.length-1,A=SCANS[Math.min(state.cmpA,lastIdx)],B=SCANS[Math.min(state.cmpB,lastIdx)];
  const opt=(sel)=>SCANS.map(s=>`<option value="${s.id}" ${s.id===sel?`selected`:``}>${dateLabel(s)}</option>`).join(``);
  const pts=globalPoints(),cmp=SkinModel.compareScans(A.normalized,B.normalized);
  return shell(`<div class="pagehead"><h1>Votre évolution</h1><p>Vos scores sont comparés d'une analyse à l'autre. 100 correspond au meilleur état. Ce sont des indicateurs de suivi cosmétique.</p></div>
  ${(ev=>ev.available&&ev.indicators.length?`<section class="sand" style="margin-bottom:24px"><div class="hd"><h2 class="h3">Vos priorités actuelles, depuis l'analyse précédente</h2></div><ul class="c-indicators">${ev.indicators.map(i=>`<li class="c-indicator"><span class="c-indicator__name">${i.label}</span><span class="c-indicator__value">${i.delta===null?`<span class="muted">Comparaison indisponible</span>`:`<span class="c-indicator__score">${i.previous} → ${i.current}<small>/100</small></span><span class="c-delta c-delta--${i.trend===`up`?`up`:i.trend===`down`?`down`:`flat`}">${Engine.copy.PERSONAL.trend[i.trend]}</span>`}</span></li>`).join(``)}</ul><p class="muted" style="margin-top:10px">${ev.note}</p></section>`:``)(engineFor(SCANS[SCANS.length-1]).personalization.evolution)}
  ${pts.length>=2?`<div class="c-card" style="margin-bottom:14px"><p class="kicker">Score global</p>${gchart(pts)}</div>`:`<div class="c-notice u-my-5">${ic(`info`)}<div>Pas assez de scores globaux valides pour tracer une courbe.</div></div>`}
  <div class="grid2" style="margin-top:30px"><section><div class="hd"><h2 class="h3">Avant, maintenant</h2></div>
   ${!DEMO_MODE&&!(A.photo&&B.photo)?`<div class="c-notice">${ic(`info`)}<div>Vos photos ne sont pas conservées avec vos analyses : la comparaison porte sur vos scores.</div></div>`:`<div class="cmp" id="cmpbox"><span class="tagl" style="left:14px">Avant</span><span class="tagl" style="right:14px">Maintenant</span>
    <div class="layer">${portrait({photo:B.photo})}</div>
    <div class="layer top" id="cmpTop">${portrait({photo:A.photo})}</div>
    <div class="handle" id="cmpH"></div><input type="range" id="cmp" min="0" max="100" value="50" aria-label="Faire glisser pour comparer avant et maintenant"></div>`}
   ${DEMO_MODE?`<p class="muted" style="margin-top:10px">Démonstration : les deux côtés montrent la même photo tant qu'il n'y a qu'une seule image. Vos vraies photos apparaîtront ici.</p>`:``}</section>
   <section><div class="hd"><h2 class="h3">Comparer deux analyses</h2></div>
    <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:8px"><label class="sr" for="sa">Avant</label><select class="sel" id="sa" data-change="cmpA">${opt(state.cmpA)}</select><label class="sr" for="sb">Maintenant</label><select class="sel" id="sb" data-change="cmpB">${opt(state.cmpB)}</select></div>
    <p class="muted" style="margin-bottom:8px">Du ${dateLabel(A)} au ${dateLabel(B)}. Stable : variation de 2 points ou moins.</p>
    ${(()=>{const x=skinLabelOf(A),y=skinLabelOf(B);return x&&y&&x!==y?`<p class="muted" style="margin-bottom:8px">Profil de peau indiqué par l'analyse : ${x} → ${y}</p>`:``})()}
    <p class="muted" style="margin-bottom:8px">Le score global est une information séparée de vos priorités : sa hausse ne signifie pas que tous vos repères se sont améliorés.</p>
    <ul class="c-indicators">${cmpRow(cmp.global,`<b>Score global</b>`)}${cmp.metrics.map(m=>cmpRow(m,m.label)).join(``)}</ul>
    ${disc()}<div class="stack"><button class="c-btn c-btn--primary c-btn--block" data-go="scan">Nouvelle analyse</button><button class="c-btn c-btn--secondary c-btn--block" data-go="analyses">Mes analyses</button></div></section></div>`);
};

/* Historique : une page de 20 analyses à la fois, les plus récentes d'abord. */
const historyMore=()=>{const H=state.history;return !DEMO_MODE&&H.hasMore?`<div style="padding-top:18px;border-top:1px solid var(--line)">${H.moreError?`<p class="c-notice" role="status" style="margin-bottom:10px">${H.moreError}</p>`:``}<button class="c-btn c-btn--secondary c-btn--block" data-act="more-history" ${H.loadingMore?`disabled`:``}>${H.loadingMore?`Chargement…`:`Voir plus d'analyses`}</button></div>`:``};
V.analyses=()=>noReal()?emptyScan(`Mes analyses`,signedIn()?[`Votre historique apparaîtra après votre première analyse.`,`Faites votre première analyse pour la retrouver ici.`]:EMPTY_MSG,{back:true,title:`Mes analyses`}):shell(`<div class="pagehead"><h1>Mes analyses</h1>${DEMO_MODE?`<p>Les analyses du 30 octobre et du 30 novembre sont simulées pour la démonstration.</p>`:``}</div>
  <div style="max-width:640px">${[...SCANS].sort((a,b)=>tsOf(b)-tsOf(a)||b.id-a.id).map(s=>{const r=viewOf(s),g=r.global;return `<div class="rowlink" style="align-items:flex-start;padding:22px 0;border-top:1px solid var(--line)"><div class="grow"><b style="font-family:var(--serif);font-weight:400;font-size:1.7rem;line-height:1.1">${dateLabel(s)}</b>${s.id===state.latest?` <span class="c-badge c-badge--outline">Analyse actuelle</span>`:``}<p class="muted" style="margin:4px 0 10px">${skinLabel(r)}</p><p style="margin-bottom:10px;display:flex;gap:8px;align-items:center;flex-wrap:wrap">${g.score===null?`<span class="muted">Score global indisponible</span>`:`<b>Score global ${g.score}/100</b>${bandBadge(g)}`}</p>${(pi=>pi.length?`<p class="c-disclaimer" style="margin-bottom:6px">${s.id===state.latest?`Priorités actuelles`:`Repères à soutenir à cette date`}</p><div class="chips">${pi.slice(0,2).map(m=>`<span class="c-badge">${m.label} ${m.score}/100</span>`).join(``)}</div>`:``)(s.rec&&s.id!==state.latest?s.rec.priorities:engineFor(s).priorities.items)}</div><button class="c-btn c-btn--tonal c-btn--sm" data-act="viewscan" data-v="${s.id}">Voir l'analyse</button></div>`}).join(``)}${historyMore()}</div>`,{back:true,title:`Mes analyses`});

/* Profil */
/* Bloc compte de la page Profil : visiteur, connecté (e-mail, état d'enregistrement, déconnexion) ou vérification en cours. Rien en mode démo. */
const accountSection=()=>{
  const A=state.account;
  if(A.status===`off`)return ``;
  if(A.status===`checking`)return `<section class="sand"><p class="kicker">Mon compte</p><p class="muted" style="margin-top:8px">Vérification de votre session…</p></section>`;
  if(A.status===`visitor`)return `<section class="sand"><p class="kicker">Mon compte</p><p style="color:var(--ink);margin:8px 0 14px">Créez votre compte pour retrouver vos préférences sur vos prochains appareils.</p><div class="stack"><button class="c-btn c-btn--primary c-btn--block" data-go="signup">Créer mon compte</button><button class="c-btn c-btn--secondary c-btn--block" data-go="login">Se connecter</button></div></section>`;
  return `<section class="sand"><p class="kicker">Mon compte</p><p style="color:var(--ink);margin:8px 0 4px">Connecté en tant que :</p><p class="big" style="font-size:1.3rem;overflow-wrap:anywhere;margin-bottom:10px">${esc(A.email)}</p>
    <p class="muted" id="saveStatus" role="status" aria-live="polite">${A.loading?`Chargement de votre profil…`:state.save.message}</p>
    ${state.save.status===`error`?`<button class="link" data-act="retry-save">Réessayer</button>`:``}
    <div class="stack" style="margin-top:12px"><button class="c-btn c-btn--secondary c-btn--block" data-act="logout">Se déconnecter</button></div></section>`;
};
const sw=(k,label,sub)=>`<div class="rowlink"><div class="grow"><b>${label}</b><span class="s">${sub}</span></div><button class="c-switch" role="switch" aria-checked="${state.prefs[k]}" data-act="pref" data-v="${k}" aria-label="${label}"></button></div>`;
V.profile=()=>{
  const none=noReal(),r=none?null:viewOf(SCANS[state.latest]);
  return shell(`<div class="hello"><div style="display:flex;gap:16px;align-items:center"><span class="avatar" style="width:64px;height:64px;font-size:2rem">${initial()}</span><div><h1 style="font-size:2.1rem">${esc(state.user.name)||`Mon profil`}</h1>${state.user.email&&!signedIn()?`<p class="muted">${esc(state.user.email)}</p>`:``}</div></div></div>
  <div class="grid2"><div class="col">
   ${accountSection()}
   <section class="sand"><p class="kicker">Profil cutané</p>${none?`<p class="muted" style="margin-top:8px">Disponible après votre première analyse.</p>`:`<p class="big" style="font-size:${skinLabel(r).length>16?`1.8rem`:`2.6rem`};margin:6px 0 14px">${skinLabel(r)}</p>${(pi=>pi.length?`<p class="c-disclaimer" style="margin-bottom:6px">Priorités</p><div class="chips">${pi.map(m=>`<span class="c-badge">${m.label} ${m.score}/100</span>`).join(``)}</div>`:``)(engineFor(SCANS[state.latest]).priorities.items)}`}</section>
   <section><div class="hd"><h2 class="h3">Mes objectifs</h2><span class="muted">${goalCount()}</span></div><p class="muted" style="margin-bottom:10px">Facultatif, trois au maximum. Un objectif indique ce que vous souhaitez travailler, pas un constat sur votre peau.</p>
     <div class="chips">${Engine.goalList().map(g=>`<button class="c-chip" data-act="goal" data-v="${g.id}" aria-pressed="${state.goals.includes(g.id)}">${g.label}</button>`).join(``)}<button class="c-chip" data-act="goal" data-v="none" aria-pressed="${state.noGoal}">${Engine.copy.NO_GOAL}</button></div></section>
   <section><div class="hd"><h2 class="h3">Mon niveau de routine</h2></div><p class="muted" style="margin-bottom:10px">Ce n'est pas un niveau de gravité : cela règle seulement le nombre de soins proposés.${state.level?``:` Par défaut : simple.`}</p>
     <div class="chips">${[`none`,`simple`,`full`].map(l=>`<button class="c-chip" data-act="level" data-v="${l}" aria-pressed="${state.level===l}">${Engine.copy.LEVEL_SHORT[l]}</button>`).join(``)}</div></section>
   <section><div class="hd"><h2 class="h3">Mon approche</h2></div>
     <div class="rowlink" style="border-top:1px solid var(--line)"><div class="grow"><b>Privilégier une approche douce</b><span class="s">Actifs doux, hydratation, barrière et protection solaire d'abord</span></div><button class="c-switch" role="switch" aria-checked="${state.gentle}" data-act="gentle" aria-label="Privilégier une approche douce"></button></div>
     ${exclusionsSection()}
     <p class="muted" style="margin-top:12px">Ma routine est recalculée automatiquement lorsque je modifie ces préférences. ${signedIn()?`Elles sont enregistrées avec votre compte.`:state.account.status===`visitor`?`Créez un compte pour les retrouver sur vos prochains appareils.`:`Elles ne sont pas enregistrées définitivement pour l'instant.`}</p>
     ${none?``:`<div style="margin-top:12px"><p style="color:var(--ink);margin-bottom:10px">${engineFor(SCANS[state.latest]).routinePlan.summary}</p><button class="c-btn c-btn--primary c-btn--block" data-go="routine">Voir ma routine personnalisée</button></div>`}</section>
   ${DEMO_MODE?`<section><div class="hd"><h2 class="h3">Préférences</h2></div>${sw(`reminder`,`Rappel de scan`,`Un message une fois par mois`)}</section>`:``}
  </div><div class="col">
   <section><button class="rowlink" data-go="analyses" style="border-top:1px solid var(--line)">${ic(`layers`)}<div class="grow"><b>Historique des analyses</b><span class="s">${none?`Aucune analyse`:`${SCANS.length} analyse${SCANS.length>1?`s`:``}`}</span></div>${ic(`chev`)}</button>
   <button class="rowlink" data-go="privacy">${ic(`shield`)}<div class="grow"><b>Confidentialité et données</b><span class="s">Photos, historique, compte</span></div>${ic(`chev`)}</button>
   ${DEMO_MODE?`<button class="rowlink" data-act="pick-photo">${ic(`image`)}<div class="grow"><b>Photo de démonstration</b><span class="s">${photoSrc()?`Importée. Touchez pour la remplacer.`:`Importer une image générée par IA (personne fictive)`}</span></div>${ic(`chev`)}</button>${state.photo?`<button class="rowlink" data-act="clear-photo">${ic(`trash`)}<div class="grow"><b>Retirer la photo de démonstration</b></div></button>`:``}`:``}
   ${accountOn()?``:`<button class="rowlink" data-act="confirm" data-v="account">${ic(`trash`)}<div class="grow"><b>Supprimer mon compte</b><span class="s">Action définitive</span></div></button>
   <button class="rowlink" data-go="landing" data-reset="1">${ic(`out`)}<div class="grow"><b>Se déconnecter</b></div></button>`}</section>
   <p class="muted">${DEMO_MODE?`DERMAI, maquette v2. Données fictives.`:`DERMAI : analyse cosmétique visuelle, pas un diagnostic médical.`}</p>
  </div></div>`);
};
V.privacy=()=>shell(`<div class="pagehead"><h1>Confidentialité</h1><p style="color:var(--ink);font-size:18px">${DEMO_MODE?`Vos photos sont utilisées pour analyser votre peau.`:`Votre photo sert uniquement à analyser votre peau. DERMAI ne la conserve pas.`}</p></div>
  <div class="grid2"><div class="col">
   <section><ul class="l-list" style="margin-top:0">${DEMO_MODE?`<li>${ic(`lock`)}<span>Vous pourrez gérer vos photos et vos données depuis cet écran.</span></li><li>${ic(`eye`)}<span>Les conditions précises seront détaillées ici avant le lancement.</span></li>`
     :`<li>${ic(`lock`)}<span>Si vous créez un compte, vos préférences (objectifs, niveau de routine, approche douce) sont associées à ce compte.</span></li><li>${ic(`eye`)}<span>Ces préférences servent uniquement à personnaliser votre expérience. Elles ne contiennent aucune information médicale.</span></li><li>${ic(`layers`)}<span>Si vous êtes connecté, vos analyses peuvent être enregistrées dans votre compte pour afficher votre historique et votre progression. Seuls vos scores, vos priorités du moment et vos objectifs de ce jour sont conservés.</span></li><li>${ic(`camera`)}<span>Pour obtenir l'analyse, votre photo est transmise à notre service d'analyse. DERMAI n'en garde aucune copie.</span></li><li>${ic(`image`)}<span>Vos photos d'analyse ne sont pas enregistrées dans votre profil, et vos photos originales ne sont pas non plus enregistrées avec vos analyses.</span></li><li>${ic(`shield`)}<span>Ces données sont associées à votre compte : vous seul pouvez accéder à vos analyses.</span></li><li>${ic(`lock`)}<span>Votre adresse e-mail et votre mot de passe sont gérés par notre service d'authentification. DERMAI ne voit ni ne conserve votre mot de passe.</span></li><li>${ic(`trash`)}<span>Vous pouvez supprimer votre historique d'analyses, ou votre compte entier (profil et analyses compris), depuis « Gérer mes données ».</span></li><li>${ic(`eye`)}<span>Une analyse nécessite un compte. Sans compte, rien n'est conservé d'une session à l'autre.</span></li>`}</ul></section>
   ${DEMO_MODE?`<section>${sw(`keep`,`Conserver mes photos`,`Pour comparer avant et maintenant`)}</section>`:``}
  </div><div class="col"><section><div class="hd"><h2 class="h3">Gérer mes données</h2></div>
   ${DEMO_MODE?`<button class="rowlink" data-act="confirm" data-v="photos" style="border-top:1px solid var(--line)">${ic(`camera`)}<div class="grow"><b>Supprimer mes photos</b><span class="s">Les analyses restent disponibles</span></div>${ic(`chev`)}</button>`:``}
   <button class="rowlink" data-act="confirm" data-v="history" ${DEMO_MODE?``:`style="border-top:1px solid var(--line)"`}>${ic(`layers`)}<div class="grow"><b>Supprimer mon historique</b><span class="s">Analyses et progression</span></div>${ic(`chev`)}</button>
   <button class="rowlink" data-act="toast" data-v="L'export de vos données n'est pas encore disponible.">${ic(`download`)}<div class="grow"><b>Exporter mes données</b><span class="s">${DEMO_MODE?`Un fichier avec toutes vos informations`:`Pas encore disponible`}</span></div>${ic(`chev`)}</button>
   ${DEMO_MODE?`<button class="rowlink" data-act="confirm" data-v="account">${ic(`trash`)}<div class="grow"><b>Supprimer mon compte</b><span class="s">Action définitive</span></div>${ic(`chev`)}</button>`:signedIn()?`<button class="rowlink" data-act="confirm" data-v="delete-account">${ic(`trash`)}<div class="grow"><b>Supprimer mon compte</b><span class="s">Profil et analyses compris, action définitive</span></div>${ic(`chev`)}</button>`:``}</section></div></div>`,{back:true,title:`Confidentialité`});

const CONFIRMS={
  photos:[`Supprimer vos photos ?`,`Vos photos seront effacées. Vos résultats d'analyse resteront disponibles.`,`Supprimer les photos`,`Photos supprimées (simulation)`],
  history:[`Supprimer votre historique ?`,`Vos analyses et votre progression seront effacées.`,`Supprimer l'historique`,`Historique supprimé (simulation)`],
  'delete-account':[`Supprimer votre compte ?`,`Votre compte, votre profil et toutes vos analyses seront supprimés définitivement. Cette action est irréversible.`,`Supprimer mon compte`,`Compte supprimé`],
  account:[`Supprimer votre compte ?`,`Votre compte et toutes vos données seront supprimés. Cette action est définitive.`,`Supprimer mon compte`,`Compte supprimé (simulation)`]
};

/* ---------- 5. NAVIGATION ET ACTIONS ---------- */
let timers=[],anTok=0;
const NOSTACK=new Set([`scan`,`analyzing`,`signup`,`login`,`welcome`,`onb`]);
function go(route,param=null,{reset=false,replace=false,keepScan=false,noHash=false}={}){
  if(route===`forgot`){state.account.error=``;state.account.info=``}
  if(route===`scan`&&needsLogin()){state.account.info=AUTH_NEEDED;state.account.error=``;route=`login`;param=null;reset=true}   // visiteur : pas d'analyse sans compte
  anTok++;timers.forEach(clearTimeout);timers=[];closeSheet();
  if(reset)state.stack=[];
  else if(!replace&&!NOSTACK.has(state.route)&&state.route!==route)state.stack.push({route:state.route,param:state.param});
  if(route===`scan`&&state.route!==`scan`&&!keepScan){state.scanStep=0;state.shots=[false,false,false];state.retake=false;if(!DEMO_MODE)clearReal()}
  if(!DEMO_MODE&&route!==`scan`&&route!==`analyzing`)clearReal();
  state.route=route;state.param=param;render();scrollTo(0,0);
  if(!noHash)syncHash(replace);
}
/* ---------- Adresse = page (rechargement et boutons précédent / suivant du navigateur) ----------
   La page courante est écrite dans l'adresse (/profile, /concern/acne…). Vercel renvoie toute adresse inconnue vers index.html (vercel.json).
   La page d'accueil du site est /accueil ; la racine « / » veut dire « aucune page choisie ». Une page « en cours » (analyse) n'est jamais restaurée.
   Les anciens liens avec « # » (/#scan) sont encore compris et convertis. */
const RESTORABLE=new Set([`landing`,`login`,`signup`,`welcome`,`onb`,`home`,`result`,`concern`,`routine`,`actives`,`active`,`progress`,`analyses`,`profile`,`privacy`,`products`,`scan`,`forgot`]);
const PATH_OF={landing:`accueil`};
const ROUTE_OF=Object.fromEntries(Object.entries(PATH_OF).map(([k,v])=>[v,k]));
const pathOf=(r,p)=>`/${PATH_OF[r]||r}${p!=null&&p!==``?`/${encodeURIComponent(p)}`:``}`;
function readLocation(){
  if(!/^https?:$/.test(location.protocol))return null;
  let seg=location.pathname.split(`/`).filter(Boolean);
  if(!seg.length){const h=(location.hash||``).replace(/^#/,``);if(!h)return null;const i=h.indexOf(`:`);seg=i<0?[h]:[h.slice(0,i),h.slice(i+1)]}   // ancien format /#route:param
  const r=ROUTE_OF[seg[0]]||seg[0];let p=null;
  if(seg.length>1){try{p=decodeURIComponent(seg.slice(1).join(`/`))}catch(e){return null}}
  if(r===`analyzing`)return{route:`home`,param:null};
  return RESTORABLE.has(r)&&V[r]?{route:r,param:p}:null;
}
function syncHash(replace){
  if(!/^https?:$/.test(location.protocol))return;
  const u=pathOf(state.route,state.param);if(location.pathname===u&&!location.hash)return;
  try{(replace?history.replaceState:history.pushState).call(history,null,``,u)}catch(e){/* adresse non modifiable : la navigation interne continue de fonctionner */}
}
function back(){const p=state.stack.pop();if(p){go(p.route,p.param,{replace:true})}else go(`home`,null,{replace:true})}
function render(keep){
  const y=window.scrollY;
  $app.classList.toggle(`still`,!!keep);
  $app.innerHTML=(V[state.route]||V.home)(state.param);
  after();
  if(keep)scrollTo(0,y);
}
function after(){
  if(state.route===`scan`&&state.scanStep>=1&&state.scanStep<=3){
    if(DEMO_MODE)timers.push(setTimeout(()=>{const c=document.getElementById(`cam`),q=document.getElementById(`qt`);if(c&&q){c.classList.add(`ready`);q.textContent=`Qualité de l'image : excellente`}},1000));
    else{const q=document.getElementById(`qt`);if(q)q.textContent=`Visage de face, bien éclairé`}
  }
  if(state.route===`analyzing`)runAnalysis();
  if(state.route===`progress`){
    const r=document.getElementById(`cmp`);
    if(r)r.addEventListener(`input`,()=>{document.getElementById(`cmpTop`).style.clipPath=`inset(0 ${100-r.value}% 0 0)`;document.getElementById(`cmpH`).style.left=r.value+`%`});
  }
}
function runAnalysis(){
  if(!DEMO_MODE)return runRealAnalysis();
  const tok=++anTok,lis=[...document.querySelectorAll(`.an-steps li`)],zc=document.getElementById(`zc`);
  const prom=provider.analyzeSkin(state.shots);
  let i=0;
  const tick=()=>{
    if(tok!==anTok)return;
    if(i>0)lis[i-1].className=`done`;
    if(i<lis.length){
      lis[i].className=`active`;
      if(zc)zc.textContent=AN_NAMES[i];
      AN_ZONES[i].forEach(z=>{const g=document.querySelector(`.an-portrait [data-z="${z}"]`);if(g)g.classList.add(`on`)});
      i++;timers.push(setTimeout(tick,1000));
    }else{
      if(zc)zc.innerHTML=`&nbsp;`;
      timers.push(setTimeout(()=>prom.then(r=>{
        if(tok!==anTok)return;
        if(r.id==null){r.id=SCANS.length;SCANS.push(r)}   // mode réel : le résultat normalisé rejoint l'historique
        state.latest=Math.max(state.latest,r.id);state.view=r.id;state.run++;go(`result`,null,{replace:true});
      }).catch(()=>{toast(`Analyse indisponible pour le moment`);go(`home`,null,{replace:true})}),700));
    }
  };
  tick();
}
function toast(m){const t=document.getElementById(`toast`);t.textContent=m;t.classList.add(`show`);clearTimeout(toast.t);toast.t=setTimeout(()=>t.classList.remove(`show`),2600)}
function sheet(html){$ov.innerHTML=`<div class="scrim" data-act="close"></div><div class="sheet" role="dialog" aria-modal="true">${html}</div>`;$ov.classList.add(`open`);document.body.style.overflow=`hidden`}
function closeSheet(){$ov.classList.remove(`open`);$ov.innerHTML=``;document.body.style.overflow=``}
function toggle(arr,v){const i=arr.indexOf(v);i>-1?arr.splice(i,1):arr.push(v)}
/* Import de la photo de démonstration : réduite et gardée dans ce navigateur uniquement. */
/* ---------- Mode réel : capture, état de la requête, erreurs ---------- */
const SCAN_STATUS_TXT={uploading:[`Envoi en cours`,`Envoi de votre photo…`],processing:[`Analyse en cours`,`Analyse de votre peau…`],success:[`Analyse terminée`,`Analyse terminée`]};
function setScanStatus(s){
  state.scanStatus=s;
  const t=SCAN_STATUS_TXT[s],pill=document.querySelector(`.an .pill-up`),zc=document.getElementById(`zc`);
  if(t&&pill)pill.textContent=t[0];
  if(t&&zc)zc.textContent=t[1];
}
function clearReal(){
  if(state.realPreview)URL.revokeObjectURL(state.realPreview);
  state.realBlob=null;state.realPreview=``;state.scanError=``;state.scanQuota=false;state.scanStatus=`idle`;
}
function pickRealPhoto(){
  let inp=document.getElementById(`realPhotoInput`);
  if(!inp){
    inp=document.createElement(`input`);
    inp.type=`file`;inp.id=`realPhotoInput`;inp.accept=`image/*`;inp.setAttribute(`capture`,`user`);inp.hidden=true;
    document.body.appendChild(inp);
  }
  state.scanStatus=`capturing`;
  inp.click();
}
/* Photo → JPEG réduit (une seule compression, côté navigateur). Jamais écrite dans localStorage. */
function jpegFromFile(file){
  return new Promise((resolve,reject)=>{
    const url=URL.createObjectURL(file),im=new Image();
    im.onerror=()=>{URL.revokeObjectURL(url);reject(userError(`Impossible de lire cette photo. Essayez une autre image.`))};
    im.onload=()=>{
      URL.revokeObjectURL(url);
      const w=im.naturalWidth,h=im.naturalHeight;
      if(!w||!h)return reject(userError(`Impossible de lire cette photo. Essayez une autre image.`));
      let k=Math.min(1,REAL_PHOTO.maxSide/Math.max(w,h)),q=REAL_PHOTO.quality;
      const attempt=()=>{
        const c=document.createElement(`canvas`);c.width=Math.max(1,Math.round(w*k));c.height=Math.max(1,Math.round(h*k));
        const g=c.getContext(`2d`);g.fillStyle=`#fff`;g.fillRect(0,0,c.width,c.height);g.drawImage(im,0,0,c.width,c.height);
        c.toBlob(b=>{
          if(!b||b.type!==`image/jpeg`)return reject(userError(`Impossible de préparer cette photo. Essayez une autre image.`));
          if(b.size<=REAL_PHOTO.maxBytes)return resolve(b);
          if(q>.6)q-=.1;else k*=.8;
          if(k<.2)return reject(userError(`La photo est trop volumineuse. Veuillez en choisir une plus légère.`));
          attempt();
        },`image/jpeg`,q);
      };
      attempt();
    };
    im.src=url;
  });
}
async function handleRealPhoto(file){
  if(!file){state.scanStatus=`idle`;return}
  try{
    const blob=await jpegFromFile(file);
    if(state.route!==`scan`)return;
    clearReal();
    state.realBlob=blob;state.realPreview=URL.createObjectURL(blob);
    state.shots=[true,false,false];state.retake=false;state.scanStep=4;
    render();scrollTo(0,0);
  }catch(err){
    state.scanStatus=`idle`;toast((err&&err.userMessage)||SCAN_ERR_GENERIC);
  }
}
/* Analyse réelle : l'état affiché suit la vraie requête (uploading → processing → success | error). */
async function runRealAnalysis(){
  const tok=++anTok;
  if(needsLogin()){askLogin();return}
  if(!state.realBlob){toast(`Aucune photo à analyser. Veuillez prendre une photo.`);go(`scan`,null,{replace:true});return}
  state.scanError=``;
  setScanStatus(`uploading`);
  try{
    const r=await provider.analyzeSkin(state.realBlob,{onStatus:s=>{if(tok===anTok)setScanStatus(s)}});
    if(tok!==anTok)return;
    setScanStatus(`success`);
    state.realBlob=null;   // la photo envoyée n'est plus conservée : seul l'aperçu reste en mémoire
    commitRealScan(r);
    state.run++;
    timers.push(setTimeout(()=>go(`result`,null,{replace:true}),500));
  }catch(err){
    if(tok!==anTok)return;
    if(err&&err.authRequired){if(signedIn())expireSession();else askLogin();return}   // session refusée par le serveur : retour à la connexion, sans message technique
    state.scanStatus=`error`;state.scanError=(err&&err.userMessage)||SCAN_ERR_GENERIC;state.scanQuota=!!(err&&err.quota);
    state.scanStep=4;state.retake=false;
    toast(state.scanError);
    go(`scan`,null,{replace:true,keepScan:true});
  }
}
function loadPhoto(file){
  if(!DEMO_MODE||!file)return;   // photo de démonstration uniquement : jamais de vrai visage dans localStorage
  const fr=new FileReader();
  fr.onload=()=>{const im=new Image();im.onload=()=>{
    const M=1100,k=Math.min(1,M/Math.max(im.width,im.height)),c=document.createElement(`canvas`);
    c.width=Math.round(im.width*k);c.height=Math.round(im.height*k);c.getContext(`2d`).drawImage(im,0,0,c.width,c.height);
    state.photo=c.toDataURL(`image/jpeg`,.86);
    try{localStorage.setItem(`dermai_demo_photo`,state.photo)}catch(e){}
    render(true);toast(`Photo de démonstration importée`);
  };im.src=fr.result};
  fr.readAsDataURL(file);
}

function act(a,v,el){
  switch(a){
    case `back`:back();break;
    case `close`:closeSheet();break;
    case `scroll`:document.getElementById(v).scrollIntoView({behavior:`smooth`});break;
    case `signup`:{const n=document.getElementById(`f-name`),m=document.getElementById(`f-mail`);state.user.name=(n&&n.value.trim())||(DEMO_MODE?`Amina`:``);state.user.email=(m&&m.value.trim())||(DEMO_MODE?`amina@exemple.com`:``);go(`welcome`);break}
    case `goal`:{const r=Engine.toggleGoal(state.goals,v);state.goals=r.goals;if(v===`none`)state.noGoal=true;else if(!r.limited)state.noGoal=false;if(r.limited)toast(Engine.copy.GOAL_LIMIT);render(true);if(!r.limited)persist();break}
    case `level`:state.level=v;render(true);persist();break;
    case `gentle`:state.gentle=!state.gentle;render(true);persist();break;
    case `logout`:logout();break;
    case `retry-save`:persist();break;
    case `resend-confirmation`:resendConfirmation();break;
    case `retry-analysis`:saveScan(state.analysisSave.scan);break;
    case `retry-history`:retryHistory();break;
    case `more-history`:loadMoreHistory();break;
    case `cat`:if(v===`none`)state.cats=state.cats.includes(`none`)?[]:[`none`];else{state.cats=state.cats.filter(c=>c!==`none`);toggle(state.cats,v)}render(true);break;
    case `finish-onb`:go(`home`,null,{reset:true});break;
    case `scan-start`:if(needsLogin()){askLogin();break}state.scanStep=1;render();scrollTo(0,0);break;
    case `scan-back`:if(!DEMO_MODE&&state.scanStep===4){state.scanStep=1;render()}else if(state.scanStep>=2&&state.scanStep<=3){state.scanStep--;render()}else if(state.scanStep===4&&!state.retake){state.scanStep=3;render()}else if(state.scanStep===1){state.scanStep=0;render()}else back();break;
    case `shutter`:{if(!DEMO_MODE){pickRealPhoto();break}const i=state.scanStep-1;document.getElementById(`flash`).classList.add(`go`);state.shots[i]=true;timers.push(setTimeout(()=>{state.scanStep=state.retake?4:(i<2?i+2:4);state.retake=false;render()},430));break}
    case `retake`:if(!DEMO_MODE){pickRealPhoto();break}state.shots[Number(v)]=false;state.scanStep=Number(v)+1;state.retake=true;render();scrollTo(0,0);break;
    case `tab`:state.tab=v;render(true);break;
    case `tick`:state.done[v]=!state.done[v];render(true);break;
    case `filter`:state.filter=v;render(true);break;
    case `product`:sheet(productSheet(v));break;
    case `setview`:state.view=Number(v);break;
    case `viewscan`:state.view=Number(v);go(`result`);break;
    case `pref`:state.prefs[v]=!state.prefs[v];render(true);break;
    case `pick-photo`:document.getElementById(`photoInput`).click();break;
    case `clear-photo`:state.photo=``;try{localStorage.removeItem(`dermai_demo_photo`)}catch(e){}render(true);toast(`Photo retirée`);break;
    case `toast`:closeSheet();toast(v);break;
    case `confirm`:{const c=CONFIRMS[v];sheet(`<h2 style="font-size:2rem;margin-bottom:10px">${c[0]}</h2><p style="margin-bottom:24px">${c[1]}</p><div class="stack"><button class="c-btn c-btn--primary c-btn--block" data-act="do-confirm" data-v="${v}">${c[2]}</button><button class="c-btn c-btn--secondary c-btn--block" data-act="close">Annuler</button></div>`);break}
    case `do-confirm`:closeSheet();if(v===`history`&&!DEMO_MODE){deleteHistory();break}if(v===`delete-account`){deleteMyAccount();break}toast(CONFIRMS[v][3]);if(v===`account`)timers.push(setTimeout(()=>go(`landing`,null,{reset:true}),1200));break;
  }
}
document.addEventListener(`click`,e=>{
  const el=e.target.closest(`[data-go],[data-act]`);if(!el)return;
  if(el.dataset.act&&el.dataset.go){act(el.dataset.act,el.dataset.v,el)}
  if(el.dataset.go){const [r,p]=el.dataset.go.split(`:`);go(r,p||null,{reset:!!el.dataset.reset});return}
  if(el.dataset.act)act(el.dataset.act,el.dataset.v,el);
});
document.addEventListener(`change`,e=>{
  if(e.target.id===`realPhotoInput`){const f=e.target.files&&e.target.files[0];e.target.value=``;handleRealPhoto(f);return}
  if(e.target.id===`photoInput`){loadPhoto(e.target.files&&e.target.files[0]);e.target.value=``;return}
  const k=e.target.dataset&&e.target.dataset.change;if(!k)return;
  state[k]=Number(e.target.value);render(true);
});
document.addEventListener(`submit`,e=>{const f=e.target&&e.target.dataset&&e.target.dataset.form;if(!f||!ACCOUNT)return;e.preventDefault();if(f===`forgot`)submitForgot(e.target);else if(f===`reset`)submitReset(e.target);else submitAuth(f,e.target)});
document.addEventListener(`keydown`,e=>{if(e.key===`Escape`)closeSheet()});
window.addEventListener(`popstate`,()=>{const h=readLocation();go(h?h.route:`landing`,h?h.param:null,{replace:true,noHash:true})});
const authRedirect=(!DEMO_MODE&&window.DermaiAccount)?DermaiAccount.readAuthRedirect(location.hash):null;
if(authRedirect)try{history.replaceState(null,``,`/`)}catch(e){}                                    // les jetons ne restent pas dans la barre d'adresse
const initialRoute=readLocation();
if(initialRoute&&location.hash)try{history.replaceState(null,``,pathOf(initialRoute.route,initialRoute.param))}catch(e){}
if(initialRoute){state.route=initialRoute.route;state.param=initialRoute.param}
render();
bootAccount(!initialRoute,authRedirect);
