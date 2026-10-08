/* Couche INTERPRÉTATION : normalized → signaux interprétables. Aucun score secondaire n'est créé.
   Deux lectures séparées, jamais mélangées :
     - AFFICHAGE : `score` = uiScore tel qu'affiché (SkinModel.displayScore), `uiBand` = bande d'affichage (SkinModel.scoreBand) ;
     - DÉCISION  : `value` = rawScore (base « raw »), `band` = repère DERMAI provisoire (data/decision.js). Seule la décision est lue par
                   les priorités, la personnalisation, la routine et la synthèse.
   Base de décision, par analyse : « raw » si chaque indicateur affiché a un rawScore exploitable ; sinon « ui » (compatibilité, par
   exemple une analyse ancienne de l'historique) : la décision lit alors le score affiché avec les anciens repères 61 / 31, et rien n'est
   inventé. Les deux bases ne sont jamais mélangées dans une même analyse.
   Les domaines regroupent et expliquent ; ils n'ont pas de score. */
(function (root, factory) {
  const isNode = typeof module === 'object' && module.exports;
  const E = root.DermaiEngine || {};
  const dep = isNode
    ? { skin: require('../skin-model.js'), data: require('./data/indicators.js'), decision: require('./data/decision.js') }
    : { skin: root.SkinModel, data: E.indicatorsData, decision: E.decisionData };
  const api = factory(dep);
  if (isNode) module.exports = api;
  else { const NS = (root.DermaiEngine = root.DermaiEngine || {}); NS.interpret = api; }
})(typeof self !== 'undefined' ? self : this, function (dep) {
  'use strict';
  const skin = dep.skin, data = dep.data, DEC = dep.decision;

  const isObj = v => v !== null && typeof v === 'object' && !Array.isArray(v);
  const BASES = ['normal', 'oily', 'dry', 'combination'];

  /* Type de peau (région whole seulement). Valeur inconnue : null, rien d'inventé. */
  function parseSkinType(whole) {
    const key = skin.skinTypeKey(whole);
    const label = skin.SKIN_TYPE_LABELS[key];
    if (!label) return null;
    const base = BASES.find(b => key === b || key.startsWith(b + ' ')) || null;
    return { key, label, base, redness: key.includes('redness') };
  }

  const view = v => { const score = skin.displayScore(v), band = skin.scoreBand(v); return { score, band: band ? band.key : null, bandLabel: band ? band.label : null }; };
  /* rawScore exploitable : nombre fini de 0 à 100, gardé tel quel (jamais arrondi). Sinon null. */
  const rawOf = v => (typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 100 ? v : null);
  const bandsOf = basis => (basis === 'raw' ? DEC.RAW_BANDS : DEC.LEGACY_UI_BANDS);
  function decisionBand(value, basis) {
    if (value === null) return null;
    const b = bandsOf(basis).find(x => value >= x.min);
    return { key: b.key, label: b.label };
  }

  function interpret(normalized) {
    const n = isObj(normalized) ? normalized : {};
    const base = skin.METRIC_KEYS.map(id => {
      const m = isObj(n[id]) ? n[id] : {};
      return { id, ui: view(m.uiScore), raw: rawOf(m.rawScore) };
    });
    const shown = base.filter(b => b.ui.score !== null);
    const basis = DEC.PREFERRED_BASIS === 'raw' && shown.length > 0 && shown.every(b => b.raw !== null) ? 'raw' : 'ui';
    const indicators = base.map((b, order) => {
      const meta = data.INDICATORS[b.id], available = b.ui.score !== null;
      const value = !available ? null : basis === 'raw' ? b.raw : b.ui.score;
      const band = decisionBand(value, basis), role = (DEC.ROLES[b.id] || { role: 'descriptive' });
      return { id: b.id, order, label: skin.METRIC_LABELS[b.id],
        score: b.ui.score, uiBand: b.ui.band, uiBandLabel: b.ui.band ? skin.INDICATOR_BAND_LABELS[b.ui.band] : null,   // affichage
        rawScore: available ? b.raw : null, value, band: band ? band.key : null, bandLabel: band ? band.label : null, basis,   // décision
        available, role: role.role, roleGoal: role.goal || null,
        domain: meta.domain, actionability: meta.actionability, confidence: meta.confidence };
    });
    const skinType = isObj(n.skinType) ? parseSkinType(n.skinType.whole) : null;
    const redness = indicators.find(i => i.id === 'redness');
    /* Mode confort / prudence : type de peau « Redness » ou repère de décision des rougeurs « low ». Ce n'est pas un diagnostic de sensibilité. */
    const comfortReasons = [];
    if (skinType && skinType.redness) comfortReasons.push('skin_type_redness');
    if (redness.band === 'low') comfortReasons.push('redness_low');
    return {
      indicators,
      basis,
      skinType,
      skinAge: skin.displayAge(n.skinAge),            // informatif seulement : jamais utilisé par le moteur
      global: view(n.globalScore),                    // contexte seulement : jamais recalculé, jamais une priorité
      context: { comfortMode: comfortReasons.length > 0, comfortReasons, skinBase: skinType ? skinType.base : null }
    };
  }

  return { interpret, parseSkinType, decisionBand };
});
