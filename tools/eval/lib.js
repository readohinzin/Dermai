/* DermAI, outil INTERNE d'évaluation : compare ce que le moteur dit d'une photo à l'évaluation d'une personne, par groupe de teint. HORS PRODUCTION.
   Fonctions pures (aucun réseau, aucun disque) : testées sans navigateur. Aucune photo ici : l'outil lit un manifeste local (eval-data/, jamais dans git).

   POURQUOI : les repères du moteur (50 / 25 sur raw_score) sont provisoires et n'ont jamais été vérifiés sur des peaux foncées. Cet outil mesure, par groupe de teint et par mesure :
     - la FAUSSE RASSURANCE : la personne voit un problème marqué (niveau 2 ou 3) et le moteur dit « bon » (raw_score de 50 ou plus) : le cas de l'acné qui « n'est pas une préoccupation » ;
     - la fausse alerte, la sensibilité, la corrélation de rang ;
     - un seuil SUGGÉRÉ (jamais appliqué tout seul : une personne décide) ;
     - ce que les personnes voient et que le moteur ne mesure pas (marques après bouton, boutons de rasage, cicatrices, aspect cendré).
   RÈGLES : consentement écrit obligatoire par photo (sans lui, la photo est EXCLUE) ; retrait possible (withdrawn) ; identifiants pseudonymes ; évaluation à l'aveugle (l'interface cache le moteur
   tant que la personne n'a pas évalué) ; petit échantillon = « trop petit pour conclure ». */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api; else root.DermaiEval = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const HUMAN_METRICS = ['acne', 'pores', 'oiliness', 'texture', 'hydration', 'redness', 'pigmentation', 'wrinkles', 'radiance', 'darkCircle'];
  const HUMAN_ONLY = ['postAcneMarks', 'razorBumps', 'scars', 'ashiness'];
  const HUMAN_ONLY_LABELS = { postAcneMarks: 'Marques après bouton', razorBumps: 'Boutons de rasage', scars: 'Cicatrices', ashiness: 'Aspect cendré' };
  const LEVEL_LABELS = ['Aucun signe', 'Léger', 'Modéré', 'Marqué'];
  const GROUPS = [['light', 'Teints 1 à 3', 1, 3], ['medium', 'Teints 4 à 5', 4, 5], ['deep', 'Teints 6 à 10', 6, 10]];
  const MIN_N = 10;                 // en dessous : « trop petit pour conclure »
  const ENGINE_FLAG_BELOW = 50;     // repère DermAI provisoire (js/engine/data/decision.js, RAW_BANDS) : en dessous, le moteur voit un point à soutenir
  const ALERT_RATE = 0.3;           // fausse rassurance à partir de laquelle on signale un écart

  const isObj = v => v !== null && typeof v === 'object' && !Array.isArray(v);
  const isDate = d => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(Date.parse(d));
  const groupOf = monk => { const g = GROUPS.find(x => monk >= x[2] && monk <= x[3]); return g ? g[0] : null; };

  /* Valeur du moteur pour une mesure : raw_score si présent, sinon null (le score affiché est « encourageant » : on ne l'utilise pas pour comparer). */
  function engineValue(engine, metric) {
    const m = isObj(engine) && isObj(engine[metric]) ? engine[metric] : null;
    return m && typeof m.rawScore === 'number' && Number.isFinite(m.rawScore) && m.rawScore >= 0 && m.rawScore <= 100 ? m.rawScore : null;
  }

  /* Niveau retenu pour une mesure : médiane des évaluatrices (arrondie vers le haut en cas d'égalité : on ne minimise pas un signe). */
  function humanLevel(raters, metric) {
    const vals = Object.values(isObj(raters) ? raters : {}).map(r => (isObj(r) && isObj(r.levels) ? r.levels[metric] : undefined)).filter(v => Number.isInteger(v) && v >= 0 && v <= 3).sort((a, b) => a - b);
    if (!vals.length) return null;
    const mid = vals.length / 2;
    return vals.length % 2 ? vals[(vals.length - 1) / 2] : Math.ceil((vals[mid - 1] + vals[mid]) / 2);
  }

  /* Contrôle d'une ligne du manifeste. Renvoie { ok, reason, code } : sans consentement valide ou retirée, la photo est EXCLUE. */
  function checkItem(it) {
    if (!isObj(it)) return { ok: false, code: 'invalid', reason: 'ligne invalide' };
    if (typeof it.id !== 'string' || !/^[A-Za-z0-9_-]{1,32}$/.test(it.id)) return { ok: false, code: 'invalid', reason: 'identifiant invalide (lettres, chiffres, tiret, 32 au plus ; pseudonyme, jamais un nom)' };
    if (it.withdrawn === true) return { ok: false, code: 'withdrawn', reason: 'consentement retiré' };
    const c = it.consent;
    if (!isObj(c) || c.given !== true || !isDate(c.date) || typeof c.scope !== 'string' || !c.scope.trim()) return { ok: false, code: 'no_consent', reason: 'consentement absent ou incomplet (given, date AAAA-MM-JJ, scope)' };
    if (!Number.isInteger(it.monk) || it.monk < 1 || it.monk > 10) return { ok: false, code: 'invalid', reason: 'teint Monk (1 à 10) manquant' };
    if (typeof it.photo !== 'string' || !/^[\w.-]{1,80}\.(jpe?g|png|webp)$/i.test(it.photo)) return { ok: false, code: 'invalid', reason: 'nom de fichier photo invalide (fichier du dossier photos, sans chemin)' };
    return { ok: true, code: 'ok', reason: '' };
  }

  function spearman(xs, ys) {
    const n = xs.length; if (n < 5) return null;
    const rank = a => { const idx = a.map((v, i) => [v, i]).sort((p, q) => p[0] - q[0]), r = new Array(n); let i = 0; while (i < n) { let j = i; while (j + 1 < n && idx[j + 1][0] === idx[i][0]) j++; const avg = (i + j) / 2 + 1; for (let k = i; k <= j; k++) r[idx[k][1]] = avg; i = j + 1; } return r; };
    const rx = rank(xs), ry = rank(ys), mx = rx.reduce((a, b) => a + b, 0) / n, my = ry.reduce((a, b) => a + b, 0) / n;
    let sxy = 0, sxx = 0, syy = 0; for (let i = 0; i < n; i++) { sxy += (rx[i] - mx) * (ry[i] - my); sxx += (rx[i] - mx) ** 2; syy += (ry[i] - my) ** 2; }
    return sxx && syy ? Math.round((sxy / Math.sqrt(sxx * syy)) * 100) / 100 : null;
  }
  const rate = (a, b) => (b > 0 ? Math.round((a / b) * 100) / 100 : null);

  /* Seuil SUGGÉRÉ : valeur de raw_score en dessous de laquelle le moteur devrait voir un point à soutenir pour coller à l'évaluation humaine (précision équilibrée maximale). Null si l'échantillon est trop petit. */
  function suggestedCutoff(pairs) {
    const pos = pairs.filter(p => p.h >= 2), neg = pairs.filter(p => p.h <= 1);
    if (pairs.length < MIN_N || pos.length < 3 || neg.length < 3) return null;
    let best = null;
    for (let c = 5; c <= 95; c += 5) {
      const tp = pos.filter(p => p.v < c).length, tn = neg.filter(p => p.v >= c).length, bal = (tp / pos.length + tn / neg.length) / 2;
      if (!best || bal > best.balanced + 1e-9) best = { cutoff: c, balanced: Math.round(bal * 100) / 100 };
    }
    return best;
  }

  /* Statistiques d'une mesure dans un groupe. pairs : [{ h: niveau humain 0..3, v: raw_score }] */
  function metricStats(pairs) {
    const n = pairs.length, flagged = pairs.filter(p => p.h >= 2), clear = pairs.filter(p => p.h <= 1);
    const fn = flagged.filter(p => p.v >= ENGINE_FLAG_BELOW).length, tp = flagged.length - fn, fp = clear.filter(p => p.v < ENGINE_FLAG_BELOW).length;
    return {
      n, reliable: n >= MIN_N, humanFlagged: flagged.length,
      falseReassurance: rate(fn, flagged.length), falseAlarm: rate(fp, clear.length), sensitivity: rate(tp, flagged.length),
      spearman: spearman(pairs.map(p => p.h), pairs.map(p => 100 - p.v)), suggested: suggestedCutoff(pairs)
    };
  }

  /* items : lignes du manifeste { id, monk, consent, withdrawn, photo, engine: { <mesure>: { rawScore } }, raters: { <évaluatrice>: { levels: { <mesure>: 0..3 }, only: { <clé>: bool } } } }. */
  function compare(items) {
    const list = Array.isArray(items) ? items : [];
    const excluded = [], used = [];
    for (const it of list) { const c = checkItem(it); if (c.ok) used.push(it); else excluded.push({ id: isObj(it) && typeof it.id === 'string' ? it.id : '?', code: c.code, reason: c.reason }); }
    const groups = {}, humanOnly = {}, alerts = [];
    for (const [key, label] of GROUPS) {
      const g = used.filter(it => groupOf(it.monk) === key);
      const metrics = {};
      for (const m of HUMAN_METRICS) {
        const pairs = g.map(it => ({ h: humanLevel(it.raters, m), v: engineValue(it.engine, m) })).filter(p => p.h !== null && p.v !== null);
        const missingEngine = g.filter(it => humanLevel(it.raters, m) !== null && engineValue(it.engine, m) === null).length;
        metrics[m] = Object.assign(metricStats(pairs), { engineMissing: missingEngine });
        const s = metrics[m];
        if (s.reliable && s.falseReassurance !== null && s.falseReassurance >= ALERT_RATE) alerts.push({ group: key, metric: m, falseReassurance: s.falseReassurance, n: s.n, text: label + ' : pour « ' + m + ' », le moteur dit « bon » alors que l\'évaluation voit un signe modéré ou marqué dans ' + Math.round(s.falseReassurance * 100) + ' % des cas (n = ' + s.n + ').' });
      }
      const only = {};
      for (const k of HUMAN_ONLY) {
        const votes = g.map(it => { const r = Object.values(isObj(it.raters) ? it.raters : {}).map(x => (isObj(x) && isObj(x.only) ? x.only[k] : undefined)).filter(v => typeof v === 'boolean'); return r.length ? r.filter(Boolean).length * 2 >= r.length && r.some(Boolean) : null; }).filter(v => v !== null);
        only[k] = { n: votes.length, present: votes.filter(Boolean).length };
      }
      groups[key] = { label, n: g.length, reliable: g.length >= MIN_N, metrics };
      humanOnly[key] = only;
    }
    return { included: used.length, excluded, groups, humanOnly, alerts, minN: MIN_N, engineFlagBelow: ENGINE_FLAG_BELOW };
  }

  /* Accord entre évaluatrices : part de mesures évaluées au même niveau par toutes (exact), sur les photos évaluées par au moins deux personnes. null si aucune. */
  function interRater(items) {
    let same = 0, total = 0;
    for (const it of (Array.isArray(items) ? items : []).filter(i => checkItem(i).ok)) {
      const rs = Object.values(it.raters || {}); if (rs.length < 2) continue;
      for (const m of HUMAN_METRICS) { const v = rs.map(r => (isObj(r) && isObj(r.levels) ? r.levels[m] : undefined)).filter(x => Number.isInteger(x)); if (v.length >= 2) { total++; if (v.every(x => x === v[0])) same++; } }
    }
    return total ? { total, exact: rate(same, total) } : null;
  }

  return { HUMAN_METRICS, HUMAN_ONLY, HUMAN_ONLY_LABELS, LEVEL_LABELS, GROUPS, MIN_N, ENGINE_FLAG_BELOW, ALERT_RATE, groupOf, engineValue, humanLevel, checkItem, spearman, suggestedCutoff, metricStats, compare, interRater };
});
